#!/usr/bin/env node
'use strict';

const vm   = require('vm');
const fs   = require('fs');
const path = require('path');

const { Logger }        = require('./lib/logger');
const { MockClient }    = require('./lib/mock-client');
const { MockDocument }  = require('./lib/mock-document');
const { generateReport} = require('./lib/report');

// ── Node version guard ────────────────────────────────────────────────────────
const [nodeMajor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 18) {
  console.error(`Error: Node.js 18+ required (native fetch). You have v${process.version}`);
  process.exit(1);
}

// ── CLI argument parsing ──────────────────────────────────────────────────────
function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      flags[argv[i].slice(2)] = argv[i + 1] ?? true;
      i++;
    } else {
      positional.push(argv[i]);
    }
  }
  return { extension: positional[0], method: positional[1], flags };
}

const { extension: extArg, method: methodArg, flags } = parseArgs(process.argv.slice(2));

const USAGE = `
Usage: node tools/debugger/index.js <extension> <method> [options]

Extensions:
  Anime:  hianime, anikoto, justanime, animekai, animeheaven,
          animeparadise, animetsu, myronix, anidap
  Manga:  mangapark, mangapill, weebcentral, readcomiconline, weloma
  Novel:  novelfire, novelbuddy, bookreadfree

Methods:
  getPopular         --page <n>
  getLatestUpdates   --page <n>
  search             --query <q> --page <n>
  getDetail          --url <url>
  getVideoList       --url <url>
  getPageList        --url <url>

Options:
  --save <file>      Write report to this file   [default: debug-report.md]
  --preview <n>      Response body preview chars [default: 500]

Examples:
  node tools/debugger/index.js hianime getPopular --page 1
  node tools/debugger/index.js hianime search --query "naruto" --page 1
  node tools/debugger/index.js hianime getVideoList --url "https://hianime.ms/watch-..."
  node tools/debugger/index.js anikoto getDetail --url "https://anikototv.to/anime/..."
`;

if (!extArg || !methodArg) {
  console.log(USAGE);
  process.exit(0);
}

// ── Extension file lookup ─────────────────────────────────────────────────────
const EXTENSION_MAP = {
  hianime:         'anime/src/en/hianime.js',
  anikoto:         'anime/src/en/anikoto.js',
  justanime:       'anime/src/en/justanime.js',
  animekai:        'anime/src/en/animekai.js',
  animeheaven:     'anime/src/en/animeheaven.js',
  animeparadise:   'anime/src/en/animeparadise.js',
  animetsu:        'anime/src/en/animetsu.js',
  myronix:         'anime/src/en/myronix.js',
  anidap:          'anime/src/en/anidap.js',
  mangapark:       'manga/src/en/mangapark.js',
  mangapill:       'manga/src/en/mangapill.js',
  weebcentral:     'manga/src/en/weebcentral.js',
  readcomiconline: 'manga/src/en/readcomiconline.js',
  weloma:          'manga/src/ja/weloma.js',
  novelfire:       'novel/src/en/NovelFire.js',
  novelbuddy:      'novel/src/en/novelbuddy.js',
  bookreadfree:    'novel/src/en/bookReadFree.js',
};

const key = extArg.toLowerCase();
const relPath = EXTENSION_MAP[key];
if (!relPath) {
  console.error(`Unknown extension: "${extArg}"`);
  console.error('Known extensions:', Object.keys(EXTENSION_MAP).join(', '));
  process.exit(1);
}

const jsRoot  = path.resolve(__dirname, '../../javascript');
const extPath = path.join(jsRoot, relPath);

if (!fs.existsSync(extPath)) {
  console.error(`Extension file not found:\n  ${extPath}`);
  process.exit(1);
}

// ── Options ───────────────────────────────────────────────────────────────────
const method     = methodArg;
const urlArg     = flags.url   || null;
const pageArg    = parseInt(flags.page  || '1', 10);
const queryArg   = flags.query || '';
const saveFile   = flags.save  || 'debug-report.md';
const previewLen = parseInt(flags.preview || '500', 10);

// ── Logger ────────────────────────────────────────────────────────────────────
const logger = new Logger({ previewLen });

// ── Source placeholder (populated after the extension code runs) ──────────────
const sourceObj = {};

// ── VM context ────────────────────────────────────────────────────────────────
//
// Mangayomi injects these globals into the JS runtime.  We mock them here.
// Standard ECMAScript built-ins (Array, Object, Promise, JSON, …) are already
// present in every v8 context created by vm.createContext — we only need to
// add the host-specific ones.

class MockMProvider {
  get source()        { return sourceObj; }
  get supportsLatest(){ return true; }
}

class MockSharedPreferences {
  constructor() { this._store = {}; }
  get(key)           { return this._store[key] ?? null; }
  put(key, value)    { this._store[key] = value; }
  getString(key, def){ return this._store[key] ?? def ?? null; }
}

// Both Client and Document constructors *return* a different object so that
// the injected logger flows in without the extension needing to know about it.
function makeClientClass(log) {
  return class Client {
    constructor() { return new MockClient(log); }
  };
}

function makeDocumentClass() {
  return class Document {
    constructor(html) { return new MockDocument(html ?? ''); }
  };
}

const context = vm.createContext({
  // Extension-facing APIs
  MProvider:         MockMProvider,
  Client:            makeClientClass(logger),
  Document:          makeDocumentClass(),
  SharedPreferences: MockSharedPreferences,

  // Host globals not automatically present in a vm context
  console: {
    log:   (...a) => logger.info('[ext] '  + a.join(' ')),
    error: (...a) => logger.error('[ext] ' + a.join(' ')),
    warn:  (...a) => logger.warn('[ext] '  + a.join(' ')),
    info:  (...a) => logger.info('[ext] '  + a.join(' ')),
  },
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  queueMicrotask,
  URL,
  URLSearchParams,
  Buffer,
  atob:  globalThis.atob,
  btoa:  globalThis.btoa,
  fetch: (...args) => {
    // Extensions should use this.client, but if they call fetch directly we
    // at least log a warning so we know about it.
    logger.warn('Extension called fetch() directly — bypassing request logger');
    return globalThis.fetch(...args);
  },
});

// ── Load extension ────────────────────────────────────────────────────────────
const extCode = fs.readFileSync(extPath, 'utf8');

try {
  vm.runInContext(extCode, context, { filename: path.basename(extPath) });
} catch (err) {
  console.error('\n[FATAL] Extension failed to parse/execute:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
}

// Populate the source object now that mangayomiSources is defined
const src = context.mangayomiSources?.[0];
if (src) Object.assign(sourceObj, src);

// ── Create extension instance ─────────────────────────────────────────────────
let ext;
try {
  ext = new context.DefaultExtension();
} catch (err) {
  console.error('\n[FATAL] DefaultExtension constructor threw:', err.message);
  process.exit(1);
}

// ── Dispatch method call ──────────────────────────────────────────────────────
async function callMethod() {
  switch (method) {
    case 'getPopular':
      logger.info(`Calling getPopular(page=${pageArg})`);
      return ext.getPopular(pageArg);

    case 'getLatestUpdates':
      logger.info(`Calling getLatestUpdates(page=${pageArg})`);
      return ext.getLatestUpdates(pageArg);

    case 'search':
      if (!queryArg) throw new Error('--query is required for search');
      logger.info(`Calling search("${queryArg}", page=${pageArg})`);
      return ext.search(queryArg, pageArg, []);

    case 'getDetail':
      if (!urlArg) throw new Error('--url is required for getDetail');
      logger.info(`Calling getDetail("${urlArg}")`);
      return ext.getDetail(urlArg);

    case 'getVideoList':
      if (!urlArg) throw new Error('--url is required for getVideoList');
      logger.info(`Calling getVideoList("${urlArg}")`);
      return ext.getVideoList(urlArg);

    case 'getPageList':
      if (!urlArg) throw new Error('--url is required for getPageList');
      logger.info(`Calling getPageList("${urlArg}")`);
      return ext.getPageList(urlArg);

    case 'getFilterList':
      logger.info('Calling getFilterList()');
      return ext.getFilterList();

    case 'getSourcePreferences':
      logger.info('Calling getSourcePreferences()');
      return ext.getSourcePreferences();

    default:
      throw new Error(`Unknown method: "${method}". See --help for valid methods.`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const divider = '─'.repeat(60);
  process.stderr.write(`\n\x1b[1m${divider}\x1b[0m\n`);
  process.stderr.write('\x1b[1m  MANGAYOMI EXTENSION DEBUGGER\x1b[0m\n');
  process.stderr.write(`\x1b[1m${divider}\x1b[0m\n\n`);

  logger.info(`Extension : ${sourceObj.name ?? extArg} v${sourceObj.version ?? '?'}`);
  logger.info(`Base URL  : ${sourceObj.baseUrl ?? '?'}`);
  logger.info(`Method    : ${method}`);

  let result     = undefined;
  let fatalError = null;

  try {
    result = await callMethod();
    logger.result(result);
  } catch (err) {
    fatalError = err;
    logger.error('Method threw an uncaught error: ' + err.message);
    if (err.stack) logger.error(err.stack);
  }

  // ── Diagnostics ────────────────────────────────────────────────────────────
  process.stderr.write('\n');
  if (fatalError) {
    process.stderr.write('\x1b[31m[FAIL] Fatal error — see report for stack trace\x1b[0m\n');
  } else if (result === null || result === undefined) {
    process.stderr.write('\x1b[33m[WARN] Result is null/undefined — extension silently failed\x1b[0m\n');
    const lastReq = logger.requestLog[logger.requestLog.length - 1];
    if (lastReq) {
      if (lastReq.error) {
        process.stderr.write(`\x1b[33m       Last request had a network error: ${lastReq.error}\x1b[0m\n`);
      } else if (lastReq.status >= 400) {
        process.stderr.write(`\x1b[33m       Last request → HTTP ${lastReq.status}. Likely a block or auth issue.\x1b[0m\n`);
      } else {
        process.stderr.write('\x1b[33m       All requests returned 2xx — the problem is likely a CSS selector\x1b[0m\n');
        process.stderr.write('\x1b[33m       or regex mismatch. Check the response preview in the report.\x1b[0m\n');
      }
    } else {
      process.stderr.write('\x1b[33m       No HTTP requests were made at all.\x1b[0m\n');
    }
  } else if (Array.isArray(result) && result.length === 0) {
    process.stderr.write('\x1b[33m[WARN] Returned empty array — no items parsed\x1b[0m\n');
  } else if (result?.list?.length === 0) {
    process.stderr.write('\x1b[33m[WARN] Returned empty list — no items parsed\x1b[0m\n');
  } else {
    process.stderr.write('\x1b[32m[OK]   Success\x1b[0m\n');
    if (Array.isArray(result)) {
      process.stderr.write(`\x1b[32m       Returned ${result.length} item(s)\x1b[0m\n`);
    } else if (result?.list) {
      process.stderr.write(`\x1b[32m       Returned ${result.list.length} item(s), hasNextPage=${result.hasNextPage}\x1b[0m\n`);
    }
  }

  // ── Write report ────────────────────────────────────────────────────────────
  const report = generateReport({
    extension:  sourceObj.name ?? extArg,
    version:    sourceObj.version ?? '?',
    baseUrl:    sourceObj.baseUrl ?? '?',
    method,
    methodArgs: { url: urlArg, page: pageArg, query: queryArg },
    result,
    fatalError,
    logEntries: logger.entries,
    requestLog: logger.requestLog,
  });

  const reportPath = path.resolve(saveFile);
  fs.writeFileSync(reportPath, report, 'utf8');
  process.stderr.write(`\n\x1b[36m[REPORT] Saved to: ${reportPath}\x1b[0m\n`);
  process.stderr.write('\x1b[36m         Paste that file\'s contents to Claude for analysis.\x1b[0m\n\n');

  process.exit(fatalError ? 1 : 0);
}

main().catch(err => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});
