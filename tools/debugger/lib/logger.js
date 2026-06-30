'use strict';

const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  cyan:    '\x1b[36m',
  yellow:  '\x1b[33m',
  green:   '\x1b[32m',
  red:     '\x1b[31m',
  magenta: '\x1b[35m',
  gray:    '\x1b[90m',
};

const PREFIXES = {
  INFO:     `${C.cyan}[INFO]   ${C.reset} `,
  REQUEST:  `${C.yellow}[→ REQ]  ${C.reset} `,
  RESPONSE: `${C.green}[← RES]  ${C.reset} `,
  ERROR:    `${C.red}[ERROR]  ${C.reset} `,
  WARN:     `${C.yellow}[WARN]   ${C.reset} `,
  RESULT:   `${C.magenta}[RESULT] ${C.reset} `,
};

class Logger {
  constructor({ previewLen = 500 } = {}) {
    this.previewLen = previewLen;
    this.entries = [];
    this.requestLog = [];
    this._seq = 0;
  }

  _emit(level, message) {
    const entry = { time: new Date().toISOString(), level, message };
    this.entries.push(entry);
    process.stderr.write((PREFIXES[level] || `[${level}] `) + message + '\n');
  }

  info(msg)  { this._emit('INFO',  String(msg)); }
  warn(msg)  { this._emit('WARN',  String(msg)); }
  error(msg) { this._emit('ERROR', String(msg)); }

  startRequest(method, url, headers, body) {
    const seq = ++this._seq;
    const entry = {
      seq, method, url,
      headers: headers || {},
      requestBody: body || null,
      status: null, size: null, elapsed: null,
      preview: null, error: null,
    };
    this.requestLog.push(entry);

    this._emit('REQUEST', `#${seq} ${method} ${url}`);
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        this._emit('REQUEST', `        ${C.gray}${k}: ${v}${C.reset}`);
      }
    }
    if (body != null) {
      const b = typeof body === 'string' ? body : JSON.stringify(body);
      this._emit('REQUEST', `        ${C.gray}Body: ${b.substring(0, 200)}${b.length > 200 ? '…' : ''}${C.reset}`);
    }
    return entry;
  }

  finishRequest(entry, status, size, elapsed, responseBody) {
    entry.status  = status;
    entry.size    = size;
    entry.elapsed = elapsed;
    entry.preview = (responseBody || '').substring(0, this.previewLen);

    const ok   = status >= 200 && status < 300;
    const icon = ok ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
    const kb   = (size / 1024).toFixed(1);
    this._emit('RESPONSE', `${icon} #${entry.seq} ${C.bold}${status}${C.reset} (${elapsed}ms, ${kb} KB) ← ${entry.url}`);
  }

  failRequest(entry, err) {
    entry.error = err.message;
    this._emit('ERROR', `#${entry.seq} NETWORK FAIL — ${err.message}`);
  }

  result(value) {
    let str;
    try { str = JSON.stringify(value, null, 2); } catch { str = String(value); }
    const display = str && str.length > 800
      ? str.substring(0, 800) + '\n…(truncated — full value in report)'
      : (str || 'null');
    this._emit('RESULT', '\n' + display);
  }
}

module.exports = { Logger };
