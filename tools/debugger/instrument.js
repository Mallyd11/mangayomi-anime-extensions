#!/usr/bin/env node
'use strict';

// Adds (or removes) live debug logging from all extension JS files.
//
// Usage:
//   node tools/debugger/instrument.js           — add logging to all extensions
//   node tools/debugger/instrument.js --remove  — remove logging from all extensions
//
// After adding, push the changes to GitHub and reinstall the extension in mangayomi.
// Then run: node tools/debugger/log-server.js

const fs   = require('fs');
const path = require('path');

// ── The debug block injected into each extension ──────────────────────────────
//
// _debugLog_init() is called from the constructor. It monkey-patches this.client
// so every HTTP call is logged, and wraps each public method to log call/result.
// Logs are POSTed to 127.0.0.1:9727 (the log server). If the server is not
// running, the first attempt fails silently and logging self-disables — zero
// performance impact when you are not actively debugging.

const DEBUG_METHOD = `
  // ─── MANGAYOMI DEBUG LOGGING ─────────────────────────────────────────────────
  // Start server: node tools/debugger/log-server.js
  // Remove this block: node tools/debugger/instrument.js --remove
  _debugLog_init() {
    const LOG = 'http://127.0.0.1:9727/log';
    const _g  = this.client.get.bind(this.client);
    const _p  = this.client.post.bind(this.client);
    const _n  = () => (this.source && this.source.name) || 'ext';
    let _on   = true;

    // Fire-and-forget log sender using the original (unpatched) client.post
    const _send = (e) => {
      if (!_on) return;
      _p(LOG, { 'Content-Type': 'application/json' },
        JSON.stringify({ ext: _n(), time: Date.now(), ...e })
      ).catch(() => { _on = false; }); // server not running → self-disable
    };

    // Wrap client.get so every HTTP GET is logged
    this.client.get = async (url, h) => {
      _send({ level: 'REQ', msg: 'GET ' + url, data: { headers: h } });
      try {
        const r = await _g(url, h);
        _send({ level: 'RES', msg: 'GET ' + url + ' -> ' + r.statusCode,
                data: { bytes: (r.body||'').length, preview: (r.body||'').slice(0, 400) } });
        if (r.statusCode >= 400)
          _send({ level: 'WARN', msg: 'HTTP ' + r.statusCode + ' on GET ' + url + ' — possible block or auth issue' });
        return r;
      } catch (e) {
        _send({ level: 'ERR', msg: 'GET ' + url + ' threw: ' + e.message });
        throw e;
      }
    };

    // Wrap client.post — skip the log URL itself to prevent recursion
    this.client.post = async (url, h, b) => {
      if (url === LOG) return _p(url, h, b);
      _send({ level: 'REQ', msg: 'POST ' + url,
              data: { headers: h, body: String(b||'').slice(0, 200) } });
      try {
        const r = await _p(url, h, b);
        _send({ level: 'RES', msg: 'POST ' + url + ' -> ' + r.statusCode,
                data: { bytes: (r.body||'').length, preview: (r.body||'').slice(0, 200) } });
        return r;
      } catch (e) {
        _send({ level: 'ERR', msg: 'POST ' + url + ' threw: ' + e.message });
        throw e;
      }
    };

    // Wrap each public method so we log the call and the result (or NULL)
    for (const m of ['getPopular','getLatestUpdates','search','getDetail','getVideoList','getPageList']) {
      if (typeof this[m] !== 'function') continue;
      const orig = this[m].bind(this);
      this[m] = async (...a) => {
        _send({ level: 'CALL', msg: m + '(' + a.map(x => JSON.stringify(x)).join(', ') + ')' });
        try {
          const r = await orig(...a);
          const s = Array.isArray(r) ? 'array[' + r.length + ']'
                  : (r && r.list)    ? 'list[' + r.list.length + '] hasNextPage=' + r.hasNextPage
                  : r == null        ? 'NULL  <-- extension returned nothing, check logs above'
                  : typeof r;
          _send({ level: 'RESULT', msg: m + ' => ' + s });
          return r;
        } catch (e) {
          _send({ level: 'ERR', msg: m + ' threw uncaught error: ' + e.message });
          throw e;
        }
      };
    }

    _send({ level: 'INFO', msg: 'Debug logging active for ' + _n() });
  }
  // ─── END MANGAYOMI DEBUG LOGGING ─────────────────────────────────────────────
`;

const INIT_CALL   = '    this._debugLog_init();';
const BLOCK_START = '  // ─── MANGAYOMI DEBUG LOGGING';
const BLOCK_END   = '  // ─── END MANGAYOMI DEBUG LOGGING';

// Constructor block injected into extensions that don't have one (inline-client pattern).
// Marked so removeLogging() can find and delete it.
const CONSTRUCTOR_MARKER_START = '  // ─── DEBUG CONSTRUCTOR';
const CONSTRUCTOR_MARKER_END   = '  // ─── END DEBUG CONSTRUCTOR';
const INJECTED_CONSTRUCTOR = `  // ─── DEBUG CONSTRUCTOR (added by instrument.js — remove with --remove) ───
  constructor() {
    super();
    this.client = new Client();
    this._debugLog_init();
  }
  // ─── END DEBUG CONSTRUCTOR ───
`;

// ── File manipulation helpers ─────────────────────────────────────────────────

// Counts braces to find the closing } of a block starting at `openPos`
function findClosingBrace(src, openPos) {
  let depth = 0;
  for (let i = openPos; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { if (--depth === 0) return i; }
  }
  return -1;
}

// Strategy A: extension has `this.client = new Client();` in a constructor
function addLogging_withConstructor(src) {
  const CLIENT_LINE = 'this.client = new Client();';
  const clientIdx   = src.indexOf(CLIENT_LINE);
  if (clientIdx < 0) return null; // not this pattern

  // Insert _debugLog_init() call right after the client line
  const lineEnd = src.indexOf('\n', clientIdx);
  src = src.slice(0, lineEnd) + '\n' + INIT_CALL + src.slice(lineEnd);

  // Find constructor's closing brace and insert the debug method after it
  const constructorIdx = src.indexOf('constructor()');
  if (constructorIdx < 0) return null;
  const constructorClose = findClosingBrace(src, constructorIdx);
  if (constructorClose < 0) return null;

  const afterBrace = src.indexOf('\n', constructorClose);
  src = src.slice(0, afterBrace + 1) + DEBUG_METHOD + src.slice(afterBrace + 1);
  return src;
}

// Strategy B: extension has no constructor; uses `new Client().get(` / `const client = new Client()`
function addLogging_inlineClient(src) {
  const hasInlineGet  = src.includes('new Client().get(');
  const hasInlinePost = src.includes('new Client().post(');
  const hasConstClient = src.includes('const client = new Client()');
  if (!hasInlineGet && !hasInlinePost && !hasConstClient) return null;

  // Replace all inline Client usages so they go through this.client
  src = src.replace(/new Client\(\)\.get\(/g,  'this.client.get(');
  src = src.replace(/new Client\(\)\.post\(/g, 'this.client.post(');
  src = src.replace(/const client = new Client\(\);/g, 'const client = this.client;');

  // Find `class DefaultExtension` and insert a constructor as the first member
  const classIdx = src.indexOf('class DefaultExtension');
  if (classIdx < 0) return null;
  const classBodyOpen = src.indexOf('{', classIdx);
  if (classBodyOpen < 0) return null;

  const afterClassOpen = src.indexOf('\n', classBodyOpen);
  src = src.slice(0, afterClassOpen + 1) + INJECTED_CONSTRUCTOR + src.slice(afterClassOpen + 1);

  // Now find the injected constructor's closing brace and insert the debug method after it
  const constructorIdx = src.indexOf('constructor()');
  if (constructorIdx < 0) return null;
  const constructorClose = findClosingBrace(src, constructorIdx);
  if (constructorClose < 0) return null;

  const afterBrace = src.indexOf('\n', constructorClose);
  src = src.slice(0, afterBrace + 1) + DEBUG_METHOD + src.slice(afterBrace + 1);
  return src;
}

function addLogging(filePath, src) {
  if (src.includes(BLOCK_START)) return { src, changed: false, reason: 'already instrumented' };

  // Try strategy A first (has this.client in constructor)
  let patched = addLogging_withConstructor(src);

  // Fall back to strategy B (inline new Client() calls)
  if (patched === null) patched = addLogging_inlineClient(src);

  if (patched === null) return { src, changed: false, reason: 'could not detect Client usage pattern' };
  return { src: patched, changed: true };
}

function removeLogging(src) {
  if (!src.includes(BLOCK_START)) return { src, changed: false, reason: 'not instrumented' };

  // Remove the _debugLog_init() call (strategy A: it lives inside the original constructor)
  src = src.replace('\n' + INIT_CALL, '');

  // Remove the debug method block
  const methodStart = src.indexOf('\n  ' + BLOCK_START.trim());
  const methodEnd   = src.indexOf(BLOCK_END);
  if (methodStart >= 0 && methodEnd >= 0) {
    const endOfEndLine = src.indexOf('\n', methodEnd + BLOCK_END.length);
    src = src.slice(0, methodStart) + src.slice(endOfEndLine);
  }

  // Strategy B cleanup: remove the injected constructor block
  if (src.includes(CONSTRUCTOR_MARKER_START)) {
    const ctorStart = src.indexOf('\n  ' + CONSTRUCTOR_MARKER_START.trim());
    const ctorEnd   = src.indexOf(CONSTRUCTOR_MARKER_END);
    if (ctorStart >= 0 && ctorEnd >= 0) {
      const endOfCtorLine = src.indexOf('\n', ctorEnd + CONSTRUCTOR_MARKER_END.length);
      src = src.slice(0, ctorStart) + src.slice(endOfCtorLine);
    }
    // Revert this.client.get/post back to inline new Client() calls
    src = src.replace(/this\.client\.get\(/g,  'new Client().get(');
    src = src.replace(/this\.client\.post\(/g, 'new Client().post(');
    src = src.replace(/const client = this\.client;/g, 'const client = new Client();');
  }

  return { src, changed: true };
}

// ── Find all extension JS files ───────────────────────────────────────────────
const JS_ROOT  = path.resolve(__dirname, '../../javascript');
const extFiles = [];

function findJs(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findJs(full);
    else if (entry.name.endsWith('.js')) extFiles.push(full);
  }
}
findJs(JS_ROOT);

// ── Run ───────────────────────────────────────────────────────────────────────
const removing = process.argv.includes('--remove');
const mode     = removing ? 'remove' : 'add';

console.log(`\n${removing ? 'Removing' : 'Adding'} debug logging ${removing ? 'from' : 'to'} ${extFiles.length} extension files...\n`);

let changed = 0, skipped = 0, errors = 0;

for (const file of extFiles) {
  const rel = path.relative(JS_ROOT, file);
  let src;
  try { src = fs.readFileSync(file, 'utf8'); }
  catch (e) { console.log(`  [ERROR] Could not read ${rel}: ${e.message}`); errors++; continue; }

  const result = removing ? removeLogging(src) : addLogging(file, src);

  if (!result.changed) {
    console.log(`  [SKIP ] ${rel} — ${result.reason}`);
    skipped++;
    continue;
  }

  try {
    fs.writeFileSync(file, result.src, 'utf8');
    console.log(`  [OK   ] ${rel}`);
    changed++;
  } catch (e) {
    console.log(`  [ERROR] Could not write ${rel}: ${e.message}`);
    errors++;
  }
}

const line = '─'.repeat(50);
console.log(`\n${line}`);
console.log(`  ${changed} file(s) ${removing ? 'cleaned' : 'instrumented'}`);
if (skipped) console.log(`  ${skipped} file(s) skipped`);
if (errors)  console.log(`  ${errors}  file(s) had errors`);
console.log(line);

if (!removing && changed > 0) {
  console.log(`
Next steps:
  1. Review the changes with:  git diff javascript/
  2. Commit and push:          git add javascript/ && git commit -m "debug: add live logging"
  3. In mangayomi — go to the extension, tap the update/reinstall button
     so it downloads the new JS with logging code
  4. Start the log server:     node tools/debugger/log-server.js
  5. Use the extension in mangayomi — logs appear in the terminal live
  6. Ctrl+C to stop and get the shareable log file
`);
} else if (removing && changed > 0) {
  console.log(`
  Logging removed. Commit and push when ready:
    git add javascript/ && git commit -m "debug: remove live logging"
`);
}
