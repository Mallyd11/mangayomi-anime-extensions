#!/usr/bin/env node
'use strict';

// Mangayomi Extension Log Server
// Receives real-time logs from instrumented extensions running inside mangayomi.
//
// Usage:
//   node tools/debugger/log-server.js
//   node tools/debugger/log-server.js --port 9727   (default)
//   node tools/debugger/log-server.js --out my-session.log

const http = require('http');
const fs   = require('fs');
const path = require('path');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) args[process.argv[i].slice(2)] = process.argv[i + 1] ?? true;
}
const PORT    = parseInt(args.port || '9727', 10);
const outFile = path.resolve(args.out || 'mangayomi-debug.log');

// ── ANSI colors ───────────────────────────────────────────────────────────────
const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  cyan:    '\x1b[36m',
  yellow:  '\x1b[33m',
  green:   '\x1b[32m',
  red:     '\x1b[31m',
  magenta: '\x1b[35m',
  gray:    '\x1b[90m',
};

const LEVEL_COLOR = {
  REQ:    C.yellow,
  RES:    C.green,
  ERR:    C.red,
  WARN:   C.yellow,
  CALL:   C.cyan,
  RESULT: C.magenta,
  INFO:   C.gray,
};

// ── Log file ──────────────────────────────────────────────────────────────────
const sessionStart = new Date().toISOString();
fs.writeFileSync(outFile,
  `# Mangayomi Extension Debug Log\n# Session: ${sessionStart}\n# Port: ${PORT}\n\n`,
  'utf8'
);

// ── Formatting ────────────────────────────────────────────────────────────────
function formatTerminal(entry) {
  const ts    = new Date(entry.time || Date.now()).toISOString().slice(11, 23); // HH:MM:SS.mmm
  const level = (entry.level || 'INFO').toUpperCase();
  const ext   = entry.ext || 'ext';
  const msg   = entry.msg || '';
  const col   = LEVEL_COLOR[level] || C.reset;

  let line = `${C.dim}[${ts}]${C.reset} ${col}[${level.padEnd(6)}]${C.reset} ${C.bold}[${ext}]${C.reset} ${msg}`;

  if (entry.data) {
    const d = entry.data;
    if (d.preview) {
      // HTTP response body preview — show indented under the log line
      const preview = String(d.preview).replace(/\s+/g, ' ').slice(0, 320);
      line += `\n          ${C.gray}${preview}${C.reset}`;
    } else if (level === 'ERR' || level === 'RESULT') {
      try {
        const pretty = JSON.stringify(d, null, 2).split('\n').map(l => '          ' + l).join('\n');
        if (pretty.length < 800) line += `\n${C.gray}${pretty}${C.reset}`;
      } catch (_) {}
    }
  }
  return line;
}

function formatFile(entry) {
  const ts    = new Date(entry.time || Date.now()).toISOString();
  const level = (entry.level || 'INFO').toUpperCase().padEnd(6);
  const ext   = entry.ext || 'ext';
  const msg   = entry.msg || '';
  let line    = `[${ts}] [${level}] [${ext}] ${msg}`;
  if (entry.data && entry.data.preview) {
    line += '\n  BODY: ' + String(entry.data.preview).replace(/\s+/g, ' ').slice(0, 500);
  } else if (entry.data && Object.keys(entry.data).length) {
    try { line += '\n  DATA: ' + JSON.stringify(entry.data); } catch (_) {}
  }
  return line;
}

// ── HTTP server ───────────────────────────────────────────────────────────────
let totalEntries = 0;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // Health check — extensions call this to verify the server is up
  if (req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('pong');
    return;
  }

  // Main log endpoint
  if (req.url === '/log' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200); res.end('ok');
      totalEntries++;

      let entry;
      try { entry = JSON.parse(body); }
      catch (_) { entry = { level: 'RAW', msg: body.slice(0, 500) }; }

      process.stdout.write(formatTerminal(entry) + '\n');
      try { fs.appendFileSync(outFile, formatFile(entry) + '\n', 'utf8'); } catch (_) {}
    });
    return;
  }

  res.writeHead(404); res.end();
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n${C.red}[ERROR]${C.reset} Port ${PORT} is already in use.`);
    console.error(`Either another log server is running, or change the port with --port.\n`);
  } else {
    console.error(`\n${C.red}[ERROR]${C.reset}`, err.message);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  const line = '═'.repeat(58);
  console.log(`\n${C.bold}${line}${C.reset}`);
  console.log(`${C.bold}  MANGAYOMI EXTENSION LOG SERVER${C.reset}`);
  console.log(`${C.bold}${line}${C.reset}`);
  console.log(`  ${C.cyan}Listening${C.reset}  : http://127.0.0.1:${PORT}`);
  console.log(`  ${C.cyan}Log file${C.reset}   : ${outFile}`);
  console.log(`${line}`);
  console.log(`
  ${C.bold}Steps:${C.reset}
  1. Make sure extensions are instrumented (run instrument.js first)
  2. Push instrumented extensions to your GitHub repo
  3. In mangayomi, reinstall the extension (so it downloads the new code)
  4. Open the extension and reproduce the issue
  5. Logs appear here in real-time
  6. Press ${C.bold}Ctrl+C${C.reset} when done — a summary is printed and the log file is ready to share
`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
process.on('SIGINT', () => {
  const line = '═'.repeat(58);
  console.log(`\n\n${C.bold}${line}${C.reset}`);
  console.log(`${C.bold}  Session complete${C.reset}`);
  console.log(`${line}`);
  console.log(`  Entries captured : ${totalEntries}`);
  console.log(`  Log file         : ${outFile}`);
  console.log(`${line}`);
  console.log(`\n  ${C.green}Open ${path.basename(outFile)} and paste its contents to Claude.${C.reset}\n`);
  process.exit(0);
});
