const mangayomiSources = [
  {
    "name": "ReAnime",
    "id": 631942785,
    "baseUrl": "https://reanime.to",
    "lang": "en",
    "typeSource": "single",
    "iconUrl":
      "https://www.google.com/s2/favicons?sz=256&domain=https://reanime.to",
    "dateFormat": "",
    "dateFormatLocale": "",
    "isNsfw": false,
    "hasCloudflare": true,
    "sourceCodeUrl":
      "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/reanime.js",
    "apiUrl": "https://api.reanime.to",
    "version": "0.0.2",
    "isManga": false,
    "itemType": 1,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "additionalParams": "",
    "sourceCodeLanguage": 1,
    "notes": "",
    "pkgPath": "anime/src/en/reanime.js",
  },
];

// ════════════════════════════════════════════════════════════════════════════
//  Pure-JS crypto (SHA-256 / HMAC / PBKDF2 / AES-256-CBC)
//
//  Mangayomi runs extensions in QuickJS, which has neither WebCrypto
//  (crypto.subtle) nor WebAssembly.  The flixcloud stream payload is protected
//  by an AES-256-CBC key derived through PBKDF2 + a per-request WASM cipher, so
//  every primitive below is reimplemented from scratch.  Each one was validated
//  byte-for-byte against the browser's native crypto.subtle / WebAssembly.
// ════════════════════════════════════════════════════════════════════════════

const _K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function sha256(msg) {
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const l = msg.length, bitLen = l * 8;
  const total = (((l + 8) >> 6) + 1) << 6;
  const b = new Uint8Array(total);
  b.set(msg);
  b[l] = 0x80;
  for (let i = 0; i < 4; i++) b[total - 1 - i] = (bitLen >>> (8 * i)) & 0xff;
  const w = new Int32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++)
      w[i] = (b[off + 4 * i] << 24) | (b[off + 4 * i + 1] << 16) | (b[off + 4 * i + 2] << 8) | b[off + 4 * i + 3];
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const y = w[i - 2], s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0, bb = h1, c = h2, d = h3, e = h4, f = h5, g = h6, hh = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + _K256[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & bb) ^ (a & c) ^ (bb & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + bb) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + hh) | 0;
  }
  const out = new Uint8Array(32), hs = [h0, h1, h2, h3, h4, h5, h6, h7];
  for (let i = 0; i < 8; i++) {
    out[4 * i] = (hs[i] >>> 24) & 0xff; out[4 * i + 1] = (hs[i] >>> 16) & 0xff;
    out[4 * i + 2] = (hs[i] >>> 8) & 0xff; out[4 * i + 3] = hs[i] & 0xff;
  }
  return out;
}

function sha256Hex(str) {
  const bytes = sha256(utf8(str));
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

function hmacSha256(key, msg) {
  const blockSize = 64;
  let k = key;
  if (k.length > blockSize) k = sha256(k);
  const ki = new Uint8Array(blockSize), ko = new Uint8Array(blockSize);
  ki.set(k); ko.set(k);
  for (let i = 0; i < blockSize; i++) { ki[i] ^= 0x36; ko[i] ^= 0x5c; }
  const inner = new Uint8Array(blockSize + msg.length);
  inner.set(ki); inner.set(msg, blockSize);
  const ih = sha256(inner);
  const outer = new Uint8Array(blockSize + 32);
  outer.set(ko); outer.set(ih, blockSize);
  return sha256(outer);
}

// PBKDF2-HMAC-SHA256, single output block (dkLen <= 32).
function pbkdf2(password, salt, iterations, dkLen) {
  const block = new Uint8Array(salt.length + 4);
  block.set(salt);
  block[salt.length + 3] = 1;
  let u = hmacSha256(password, block);
  const t = u.slice();
  for (let i = 1; i < iterations; i++) {
    u = hmacSha256(password, u);
    for (let j = 0; j < 32; j++) t[j] ^= u[j];
  }
  return t.slice(0, dkLen);
}

// ── AES (decrypt only) ────────────────────────────────────────────────────────
const _AES_SBOX = new Uint8Array(256), _AES_INV = new Uint8Array(256);
(function () {
  let p = 1, q = 1;
  do {
    p = p ^ (p << 1) ^ ((p & 0x80) ? 0x11b : 0); p &= 0xff;
    q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff; if (q & 0x80) q ^= 0x09;
    const x = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4));
    _AES_SBOX[p] = (x & 0xff) ^ 0x63;
  } while (p !== 1);
  _AES_SBOX[0] = 0x63;
  for (let i = 0; i < 256; i++) _AES_INV[_AES_SBOX[i]] = i;
})();

function _gmul(a, b) {
  let r = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) r ^= a;
    const hi = a & 0x80; a = (a << 1) & 0xff; if (hi) a ^= 0x1b; b >>= 1;
  }
  return r;
}

function _aesExpandKey(key) {
  const Nk = 8, Nr = 14, w = new Array(4 * (Nr + 1));
  for (let i = 0; i < Nk; i++) w[i] = [key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]];
  let rcon = 1;
  for (let i = Nk; i < 4 * (Nr + 1); i++) {
    let t = w[i - 1].slice();
    if (i % Nk === 0) {
      t = [t[1], t[2], t[3], t[0]].map((x) => _AES_SBOX[x]);
      t[0] ^= rcon;
      rcon = ((rcon << 1) ^ ((rcon & 0x80) ? 0x1b : 0)) & 0xff;
    } else if (i % Nk === 4) {
      t = t.map((x) => _AES_SBOX[x]);
    }
    w[i] = w[i - Nk].map((x, j) => x ^ t[j]);
  }
  return w;
}

function _aesInvCipher(blk, w) {
  const Nr = 14;
  const s = [[], [], [], []];
  for (let i = 0; i < 16; i++) s[i % 4][(i / 4) | 0] = blk[i];
  const ark = (r) => { for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) s[row][c] ^= w[r * 4 + c][row]; };
  const isr = () => {
    for (let row = 1; row < 4; row++) {
      const t = [s[row][0], s[row][1], s[row][2], s[row][3]];
      for (let c = 0; c < 4; c++) s[row][c] = t[(c - row + 4) % 4];
    }
  };
  const isb = () => { for (let i = 0; i < 4; i++) for (let c = 0; c < 4; c++) s[i][c] = _AES_INV[s[i][c]]; };
  const imc = () => {
    for (let c = 0; c < 4; c++) {
      const a0 = s[0][c], a1 = s[1][c], a2 = s[2][c], a3 = s[3][c];
      s[0][c] = _gmul(a0, 14) ^ _gmul(a1, 11) ^ _gmul(a2, 13) ^ _gmul(a3, 9);
      s[1][c] = _gmul(a0, 9) ^ _gmul(a1, 14) ^ _gmul(a2, 11) ^ _gmul(a3, 13);
      s[2][c] = _gmul(a0, 13) ^ _gmul(a1, 9) ^ _gmul(a2, 14) ^ _gmul(a3, 11);
      s[3][c] = _gmul(a0, 11) ^ _gmul(a1, 13) ^ _gmul(a2, 9) ^ _gmul(a3, 14);
    }
  };
  ark(Nr);
  for (let r = Nr - 1; r >= 1; r--) { isr(); isb(); ark(r); imc(); }
  isr(); isb(); ark(0);
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = s[i % 4][(i / 4) | 0];
  return out;
}

function aesCbcDecrypt(key, iv, ct) {
  const w = _aesExpandKey(key);
  const out = new Uint8Array(ct.length);
  let prev = iv;
  for (let o = 0; o < ct.length; o += 16) {
    const blk = ct.slice(o, o + 16);
    const dec = _aesInvCipher(blk, w);
    for (let i = 0; i < 16; i++) out[o + i] = dec[i] ^ prev[i];
    prev = blk;
  }
  const pad = out[out.length - 1];
  return out.slice(0, out.length - (pad > 0 && pad <= 16 ? pad : 0));
}

// ── Encoding helpers ──────────────────────────────────────────────────────────
function utf8(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff) {
      const c2 = str.charCodeAt(++i);
      c = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(bytes);
}

function utf8Decode(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length;) {
    const c = bytes[i++];
    if (c < 0x80) s += String.fromCharCode(c);
    else if (c < 0xe0) s += String.fromCharCode(((c & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (c < 0xf0) s += String.fromCharCode(((c & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    else {
      const cp = ((c & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      const u = cp - 0x10000;
      s += String.fromCharCode(0xd800 + (u >> 10), 0xdc00 + (u & 0x3ff));
    }
  }
  return s;
}

const _B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64ToBytes(str) {
  str = str.replace(/[^A-Za-z0-9+/=]/g, "");
  const out = [];
  let buf = 0, bits = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === "=") break;
    const v = _B64.indexOf(ch);
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 0xff); }
  }
  return new Uint8Array(out);
}

// ════════════════════════════════════════════════════════════════════════════
//  Minimal WASM interpreter
//
//  flixcloud ships a tiny (~400-byte) WebAssembly module ("w_payload") with each
//  embed and randomizes its constants per request, so the cipher table can't be
//  hardcoded.  This interpreter executes the module's exported _s / _r functions
//  directly.  Validated against the native WebAssembly engine over many random
//  payloads + inputs.
// ════════════════════════════════════════════════════════════════════════════

function wasmModule(bytes) {
  const u8 = bytes;
  let pos = 0;
  const leb = () => { let r = 0, s = 0, b; do { b = u8[pos++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return r >>> 0; };
  const sleb = () => { let r = 0, s = 0, b; do { b = u8[pos++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80); if (s < 32 && (b & 0x40)) r |= (-1 << s); return r | 0; };

  const types = [], funcs = [], exports = {}, code = [], data = [];
  let mem = { min: 1 };
  pos = 8; // skip magic + version
  while (pos < u8.length) {
    const id = u8[pos++], size = leb(), secEnd = pos + size;
    if (id === 1) {
      const n = leb();
      for (let i = 0; i < n; i++) {
        pos++; // 0x60
        const np = leb(); const params = [];
        for (let j = 0; j < np; j++) params.push(u8[pos++]);
        const nr = leb(); const res = [];
        for (let j = 0; j < nr; j++) res.push(u8[pos++]);
        types.push({ params, res });
      }
    } else if (id === 3) {
      const n = leb();
      for (let i = 0; i < n; i++) funcs.push(leb());
    } else if (id === 5) {
      const n = leb();
      for (let i = 0; i < n; i++) { const fl = u8[pos++]; const mn = leb(); let mx = null; if (fl) mx = leb(); mem = { min: mn, max: mx }; }
    } else if (id === 6) {
      const n = leb();
      for (let i = 0; i < n; i++) { pos++; pos++; const op = u8[pos++]; if (op === 0x41) sleb(); pos++; }
    } else if (id === 7) {
      const n = leb();
      for (let i = 0; i < n; i++) {
        const nl = leb(); let nm = "";
        for (let j = 0; j < nl; j++) nm += String.fromCharCode(u8[pos++]);
        const kind = u8[pos++], idx = leb();
        exports[nm] = { kind, idx };
      }
    } else if (id === 10) {
      const n = leb();
      for (let i = 0; i < n; i++) {
        const cs = leb(), cend = pos + cs;
        const nl = leb(); let lc = 0;
        for (let j = 0; j < nl; j++) { const cnt = leb(); u8[pos++]; lc += cnt; }
        code.push({ localsCount: lc, bodyStart: pos, bodyEnd: cend });
        pos = cend;
      }
    } else if (id === 11) {
      const n = leb();
      for (let i = 0; i < n; i++) {
        leb(); // flag
        let off = 0; const op = u8[pos++]; if (op === 0x41) off = sleb(); pos++;
        const dl = leb(); const bb = u8.slice(pos, pos + dl); pos += dl;
        data.push({ off, bytes: bb });
      }
    }
    pos = secEnd;
  }

  const globals = [0];
  const M = new Uint8Array(Math.max(mem.min, 1) * 65536);
  data.forEach((d) => M.set(d.bytes, d.off));

  // advance past one instruction (immediates included)
  const skip = (p) => {
    const op = u8[p++];
    if (op === 0x02 || op === 0x03 || op === 0x04) return p + 1; // blocktype byte
    if (op === 0x0c || op === 0x0d || op === 0x10 || (op >= 0x20 && op <= 0x24)) { const sv = pos; pos = p; leb(); const np = pos; pos = sv; return np; }
    if (op === 0x41) { const sv = pos; pos = p; sleb(); const np = pos; pos = sv; return np; }
    if (op >= 0x28 && op <= 0x3e) { const sv = pos; pos = p; leb(); leb(); const np = pos; pos = sv; return np; }
    return p;
  };
  const matchEnd = (p) => {
    let depth = 0, q = p;
    while (q < u8.length) {
      const op = u8[q];
      if (op === 0x02 || op === 0x03 || op === 0x04) depth++;
      else if (op === 0x0b) { if (depth === 0) return q; depth--; }
      q = skip(q);
    }
    return u8.length;
  };

  function run(fidx, args) {
    const fn = code[fidx], ty = types[funcs[fidx]];
    const np = ty.params.length;
    const loc = new Int32Array(np + fn.localsCount);
    for (let i = 0; i < np; i++) loc[i] = args[i] | 0;
    const st = [], ctrl = [];
    let ip = fn.bodyStart;
    const END = fn.bodyEnd;
    const rdLeb = () => { let r = 0, s = 0, b; do { b = u8[ip++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return r >>> 0; };
    const rdSleb = () => { let r = 0, s = 0, b; do { b = u8[ip++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80); if (s < 32 && (b & 0x40)) r |= (-1 << s); return r | 0; };
    const branch = (k) => {
      const idx = ctrl.length - 1 - k, f = ctrl[idx];
      if (f.kind === 3) { ctrl.length = idx + 1; ip = f.start; }  // loop → jump to start
      else { ctrl.length = idx; ip = f.end + 1; }                  // block → jump past end
    };
    while (ip < END) {
      const op = u8[ip++];
      if (op === 0x02) { ip++; ctrl.push({ kind: 2, end: matchEnd(ip) }); }
      else if (op === 0x03) { ip++; ctrl.push({ kind: 3, start: ip, end: matchEnd(ip) }); }
      else if (op === 0x0b) { if (ctrl.length === 0) break; ctrl.pop(); }
      else if (op === 0x0c) { branch(rdLeb()); }
      else if (op === 0x0d) { const k = rdLeb(); if (st.pop()) branch(k); }
      else if (op === 0x0f) { break; }
      else if (op === 0x20) { st.push(loc[rdLeb()]); }
      else if (op === 0x21) { loc[rdLeb()] = st.pop(); }
      else if (op === 0x22) { loc[rdLeb()] = st[st.length - 1]; }
      else if (op === 0x23) { st.push(globals[rdLeb()]); }
      else if (op === 0x24) { globals[rdLeb()] = st.pop(); }
      else if (op === 0x41) { st.push(rdSleb()); }
      else if (op === 0x2d) { rdLeb(); const off = rdLeb(); const a = st.pop(); st.push(M[(a >>> 0) + off]); }
      else if (op === 0x3a) { rdLeb(); const off = rdLeb(); const v = st.pop(); const a = st.pop(); M[(a >>> 0) + off] = v & 0xff; }
      else if (op === 0x6a) { const b = st.pop(), a = st.pop(); st.push((a + b) | 0); }
      else if (op === 0x6b) { const b = st.pop(), a = st.pop(); st.push((a - b) | 0); }
      else if (op === 0x6c) { const b = st.pop(), a = st.pop(); st.push(Math.imul(a, b)); }
      else if (op === 0x71) { const b = st.pop(), a = st.pop(); st.push(a & b); }
      else if (op === 0x72) { const b = st.pop(), a = st.pop(); st.push(a | b); }
      else if (op === 0x73) { const b = st.pop(), a = st.pop(); st.push(a ^ b); }
      else if (op === 0x74) { const b = st.pop(), a = st.pop(); st.push((a << (b & 31)) | 0); }
      else if (op === 0x76) { const b = st.pop(), a = st.pop(); st.push((a >>> (b & 31)) | 0); }
      else if (op === 0x75) { const b = st.pop(), a = st.pop(); st.push((a >> (b & 31)) | 0); }
      else if (op === 0x4f) { const b = st.pop(), a = st.pop(); st.push((a >>> 0) >= (b >>> 0) ? 1 : 0); }
      else if (op === 0x49) { const b = st.pop(), a = st.pop(); st.push((a >>> 0) < (b >>> 0) ? 1 : 0); }
      else if (op === 0x48) { const b = st.pop(), a = st.pop(); st.push((a | 0) < (b | 0) ? 1 : 0); }
      else if (op === 0x46) { const b = st.pop(), a = st.pop(); st.push(a === b ? 1 : 0); }
      else if (op === 0x45) { const a = st.pop(); st.push(a === 0 ? 1 : 0); }
      else throw new Error("unsupported wasm opcode 0x" + op.toString(16));
    }
    return st.pop();
  }

  return {
    memory: M,
    call: (name, args) => run(exports[name].idx, args),
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  Extension
// ════════════════════════════════════════════════════════════════════════════

const PAGE_SIZE = 30;
const EMBED_HOST = "https://flixcloud.cc";

// The "latest aired" feed paginates by opaque cursor, while Mangayomi requests
// pages by number.  Mangayomi asks for pages sequentially as the user scrolls,
// so we remember the cursor that fetches each page.  page -> cursor ("" / null
// means "no cursor", i.e. the first page).
var _latestAiredCursors = {};

class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
  }

  getPreference(key) {
    return new SharedPreferences().get(key);
  }

  get supportsLatest() {
    return true;
  }

  get ua() {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  }

  getBaseUrl() {
    return (this.getPreference("reanime_base_url") || this.source.baseUrl).replace(/\/$/, "");
  }

  get apiUrl() {
    return (this.source.apiUrl || "https://api.reanime.to").replace(/\/$/, "");
  }

  // Headers for the public api.reanime.to host (no Cloudflare, no auth).
  get apiHeaders() {
    return {
      "User-Agent": this.ua,
      "Accept": "application/json",
      "Origin": this.getBaseUrl(),
      "Referer": this.getBaseUrl() + "/",
    };
  }

  // Headers for flixcloud.cc.  The embed validates the referring domain.
  get embedHeaders() {
    return {
      "User-Agent": this.ua,
      "Referer": this.getBaseUrl() + "/",
    };
  }

  async getJSON(url, headers) {
    const res = await this.client.get(url, headers || this.apiHeaders);
    if (res.statusCode !== 200 || !res.body) throw new Error("HTTP " + res.statusCode + " for " + url);
    return JSON.parse(res.body);
  }

  // ── Listing helpers ──────────────────────────────────────────────────────

  titleByPref(title) {
    if (!title) return "";
    const pref = this.getPreference("reanime_title_lang") || "romaji";
    if (pref === "english") return title.english || title.romaji || title.user_preferred || title.native || "";
    if (pref === "native") return title.native || title.romaji || title.english || "";
    return title.romaji || title.english || title.user_preferred || title.native || "";
  }

  posterOf(item) {
    const c = item.cover_image || {};
    return c.large || c.extra_large || c.medium || "";
  }

  mapResults(list) {
    const self = this;
    const out = [];
    (list || []).forEach(function (m) {
      if (!m || !m.anime_id) return;
      const name = self.titleByPref(m.title);
      if (!name) return;
      out.push({ name: name, link: m.anime_id, imageUrl: self.posterOf(m) });
    });
    return out;
  }

  async searchAPI(extraQuery, page) {
    const offset = (page - 1) * PAGE_SIZE;
    const url = this.apiUrl + "/api/v1/search?q=&limit=" + PAGE_SIZE + "&offset=" + offset + extraQuery;
    const data = await this.getJSON(url);
    const list = this.mapResults(data.results);
    const total = data.total || 0;
    return { list: list, hasNextPage: offset + PAGE_SIZE < total };
  }

  async getPopular(page) {
    // Empty query is ordered by popularity by default.
    return await this.searchAPI("", page);
  }

  async fetchLatestAired(cursor) {
    const url = this.apiUrl + "/api/v1/home/latest-aired?limit=" + PAGE_SIZE +
      (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
    return await this.getJSON(url);
  }

  async getLatestUpdates(page) {
    page = page || 1;
    // Resolve the cursor for this page.  Normally page N's cursor was cached when
    // page N-1 was fetched; for a cold deep-page request we walk forward from the
    // deepest page we already know.
    if (page > 1 && _latestAiredCursors[page] === undefined) {
      let p = 1;
      while (_latestAiredCursors[p + 1] !== undefined) p++;
      for (; p < page; p++) {
        const prev = await this.fetchLatestAired(p === 1 ? null : _latestAiredCursors[p]);
        _latestAiredCursors[p + 1] = prev.has_more ? (prev.next_cursor || null) : null;
        if (!prev.has_more) break;
      }
    }
    if (page > 1 && !_latestAiredCursors[page]) return { list: [], hasNextPage: false };

    const data = await this.fetchLatestAired(page === 1 ? null : _latestAiredCursors[page]);
    _latestAiredCursors[page + 1] = data.has_more ? (data.next_cursor || null) : null;
    return { list: this.mapResults(data.data), hasNextPage: !!data.has_more };
  }

  async search(query, page, filters) {
    try {
      if (query && query.length > 0) {
        const offset = (page - 1) * PAGE_SIZE;
        const url = this.apiUrl + "/api/v1/search?q=" + encodeURIComponent(query) +
          "&limit=" + PAGE_SIZE + "&offset=" + offset;
        const data = await this.getJSON(url);
        return { list: this.mapResults(data.results), hasNextPage: offset + PAGE_SIZE < (data.total || 0) };
      }
      return await this.searchAPI(this.buildFilterQuery(filters), page);
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  buildFilterQuery(filters) {
    let q = "";
    if (!filters) return q;
    try {
      // 0: genres (group), 1: format, 2: status, 3: season, 4: year
      const genres = [];
      if (filters[0] && filters[0].state) {
        for (const g of filters[0].state) if (g.state === true) genres.push(g.value);
      }
      if (genres.length) q += "&genre=" + genres.map(encodeURIComponent).join(",");

      const sel = (f) => (f && f.values && f.values[f.state] ? f.values[f.state].value : "");
      const fmt = sel(filters[1]); if (fmt) q += "&format=" + encodeURIComponent(fmt);
      const st = sel(filters[2]); if (st) q += "&status=" + encodeURIComponent(st);
      const se = sel(filters[3]); if (se) q += "&season=" + encodeURIComponent(se);
      const yr = sel(filters[4]); if (/^\d{4}$/.test(yr)) q += "&year=" + yr;
    } catch (e) { /* ignore malformed filter state */ }
    return q;
  }

  // ── Detail ───────────────────────────────────────────────────────────────

  statusCode(s) {
    switch ((s || "").toUpperCase()) {
      case "RELEASING": return 0;
      case "FINISHED": return 1;
      case "NOT YET RELEASED": return 4;
      case "CANCELLED": return 5;
      default: return 5;
    }
  }

  async getDetail(url) {
    const animeId = url.replace(/^.*\/anime\//, "").replace(/^\//, "");
    const info = await this.getJSON(this.apiUrl + "/api/v1/anime/" + animeId);

    const name = this.titleByPref(info.title);
    const cover = info.cover_image || {};
    const imageUrl = cover.extra_large || cover.large || cover.medium || "";
    const description = (info.description || "").replace(/<[^>]*>/g, "").replace(/\n{3,}/g, "\n\n").trim();
    const genre = info.genres || [];
    const status = this.statusCode(info.status);
    const anilistId = info.anilist_id;
    const isMovie = (info.format || "").toUpperCase() === "MOVIE";

    const chapters = [];
    if (anilistId) {
      const episodes = await this.fetchAllEpisodes(animeId);
      episodes.forEach((ep) => {
        const num = ep.episode_number;
        let title = ep.title || "";
        if (!title || /^episode\s*\d+$/i.test(title)) title = "";
        const chName = isMovie ? (title || name) : ("E" + num + (title ? " — " + title : ""));
        const aired = ep.aired ? Date.parse(ep.aired) : NaN;
        chapters.push({
          name: chName,
          // "<anilistId>|<epNumber>" — getVideoList resolves the stream from these.
          url: anilistId + "|" + num,
          dateUpload: isNaN(aired) ? null : "" + aired,
          thumbnailUrl: ep.thumbnail || null,
          scanlator: ep.is_filler ? "Filler" : null,
        });
      });
      chapters.reverse(); // newest first
    }

    return {
      name: name,
      imageUrl: imageUrl,
      description: description,
      genre: genre,
      status: status,
      link: this.getBaseUrl() + "/anime/" + animeId,
      chapters: chapters,
    };
  }

  async fetchAllEpisodes(animeId) {
    const all = [];
    let offset = 0;
    const limit = 100;
    for (let guard = 0; guard < 100; guard++) {
      const data = await this.getJSON(
        this.apiUrl + "/api/v1/anime/" + animeId + "/episodes?limit=" + limit + "&offset=" + offset
      );
      const batch = data.data || [];
      batch.forEach((e) => all.push(e));
      const total = data.total || all.length;
      offset += limit;
      if (offset >= total || batch.length === 0) break;
    }
    return all;
  }

  // ── Video list ─────────────────────────────────────────────────────────────

  async getVideoList(url) {
    const parts = url.split("|");
    const anilistId = parts[0];
    const epNum = parts[1];
    if (!anilistId || !epNum) return [];

    // The flix route lives on the Cloudflare-protected frontend host.  With
    // hasCloudflare=true Mangayomi solves the challenge in a WebView once and
    // reuses the cf_clearance cookie.  No custom User-Agent here: the cookie is
    // bound to the WebView's UA.
    const flixUrl = this.getBaseUrl() + "/api/flix/" + anilistId + "/" + epNum;
    let flix;
    try {
      const res = await this.client.get(flixUrl, { "Referer": this.getBaseUrl() + "/" });
      if (res.statusCode !== 200 || !res.body) return [];
      flix = JSON.parse(res.body);
    } catch (e) {
      return [];
    }

    const servers = (flix && flix.servers) || [];
    // Collapse to unique embed ids (most servers point at the same flixcloud
    // video, which itself carries both sub & dub audio tracks).
    const seen = {};
    const embeds = [];
    servers.forEach((s) => {
      const m = (s.dataLink || "").match(/\/e\/([A-Za-z0-9]+)/);
      if (!m) return;
      const aid = m[1];
      const label = s.serverName || "HD";
      if (seen[aid]) return;
      seen[aid] = true;
      embeds.push({ aid: aid, label: label });
    });

    const streams = [];
    for (const emb of embeds) {
      try {
        const resolved = await this.resolveEmbed(emb.aid);
        if (!resolved || !resolved.url) continue;
        streams.push({
          url: resolved.url,
          originalUrl: resolved.url,
          quality: emb.label + " · ReAnime",
          headers: { "User-Agent": this.ua, "Referer": EMBED_HOST + "/", "Origin": EMBED_HOST },
          subtitles: resolved.subtitles,
        });
      } catch (e) { /* skip this embed */ }
    }
    return streams;
  }

  // Resolve a flixcloud embed id into a playable HLS master URL + subtitles.
  // See memory/reanime-extension.md for the full scheme.
  async resolveEmbed(aid) {
    const pageRes = await this.client.get(EMBED_HOST + "/e/" + aid, this.embedHeaders);
    if (pageRes.statusCode !== 200 || !pageRes.body) return null;
    const html = pageRes.body;

    const seed = this.matchOne(html, /obfuscation_seed:"([0-9a-f]+)"/);
    const wPayload = this.matchOne(html, /w_payload:"([A-Za-z0-9+/=]+)"/);
    const frag1B64 = this.matchOne(html, /kf_[0-9a-f]+:"([^"]+)"/);
    const ivB64 = this.matchOne(html, /ivf_[0-9a-f]+:"([^"]+)"/);
    if (!seed || !wPayload || !frag1B64 || !ivB64) return null;

    // Field-name map derived from the seed (6 chained SHA-256 rounds).
    let e = seed;
    for (let i = 0; i < 3; i++) e = sha256Hex(e + i);
    let s = e;
    for (let i = 0; i < 3; i++) s = sha256Hex(s + i);
    const keyFrag2Field = s.slice(0, 16) + "_" + s.slice(16, 24);
    const tokenField = e.slice(48, 64) + "_" + e.slice(56, 64);

    const keyFrag2B64 = this.matchOne(html, this.fieldRx(keyFrag2Field));
    const token = this.matchOne(html, this.fieldRx(tokenField));
    if (!keyFrag2B64 || !token) return null;

    // The encrypted manifest + a key fragment arrive via a single-use, IP-bound
    // token endpoint.
    const tk = await this.getJSON(EMBED_HOST + "/api/m3u8/" + token, this.embedHeaders);
    const vKey = sha256Hex(token + "vid").slice(0, 10);
    const tKey = sha256Hex(token + "key").slice(0, 10);
    const cipherB64 = tk[vKey];
    const fragTB64 = tk[tKey];
    if (!cipherB64 || !fragTB64) return null;

    // 1) WASM cipher → 32 raw key bytes (E).
    const frag1 = b64ToBytes(frag1B64);
    const keyFrag2 = b64ToBytes(keyFrag2B64);
    const fragT = b64ToBytes(fragTB64);
    const g0 = parseInt(seed.slice(0, 8), 16) >>> 0;

    const wasm = wasmModule(b64ToBytes(wPayload));
    const k = frag1.length;
    const pA = 1000, pB = pA + k, pC = pB + k, pOut = pC + k;
    wasm.memory.set(frag1, pA);
    wasm.memory.set(keyFrag2, pB);
    wasm.memory.set(fragT, pC);
    wasm.call("_s", [g0]);
    wasm.call("_r", [pA, pB, pC, pOut, k]);
    const E = wasm.memory.slice(pOut, pOut + k);

    // 2) PBKDF2 + seed-xor + SHA-256 → AES-256 key.
    const seedBytes = utf8(seed);
    const dk = pbkdf2(E, seedBytes, 1000, 32);
    for (let i = 0; i < 32; i++) dk[i] ^= seed.charCodeAt(i % seed.length);
    const aesKey = sha256(dk);

    // 3) AES-256-CBC decrypt → the HLS master URL.
    const plain = aesCbcDecrypt(aesKey, b64ToBytes(ivB64), b64ToBytes(cipherB64));
    const m3u8 = utf8Decode(plain).trim();
    if (!/^https?:\/\//.test(m3u8)) return null;

    return { url: m3u8, subtitles: this.parseSubtitles(html) };
  }

  matchOne(str, rx) {
    const m = str.match(rx);
    return m ? m[1] : null;
  }

  // Build a regex for a (possibly quoted) object key → its string value.
  fieldRx(field) {
    const esc = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp('"?' + esc + '"?\\s*:\\s*"([^"]+)"');
  }

  parseSubtitles(html) {
    const block = this.matchOne(html, /subtitles:\[(.*?)\](?:,[a-zA-Z0-9_"])/);
    if (!block) return [];
    const subs = [];
    const rx = /\{url:"([^"]+)",language:"([^"]+)"/g;
    let m;
    while ((m = rx.exec(block)) !== null) {
      subs.push({ file: m[1], label: m[2] });
    }
    return subs;
  }

  // ── Filters & preferences ──────────────────────────────────────────────────

  selectValues(arr) {
    const out = [{ type_name: "SelectOption", name: "Any", value: "" }];
    arr.forEach((x) => out.push({ type_name: "SelectOption", name: x.name, value: x.value }));
    return out;
  }

  getFilterList() {
    const genres = [
      "Action", "Adventure", "Comedy", "Drama", "Ecchi", "Fantasy", "Horror",
      "Mahou Shoujo", "Mecha", "Music", "Mystery", "Psychological", "Romance",
      "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Suspense", "Thriller",
    ].map((g) => ({ type_name: "CheckBox", name: g, value: g }));

    return [
      { type_name: "GroupFilter", name: "Genres", state: genres },
      {
        type_name: "SelectFilter", name: "Format", state: 0,
        values: this.selectValues([
          { name: "TV", value: "TV" }, { name: "Movie", value: "MOVIE" },
          { name: "ONA", value: "ONA" }, { name: "OVA", value: "OVA" },
          { name: "Special", value: "SPECIAL" }, { name: "TV Short", value: "TV_SHORT" },
          { name: "Music", value: "MUSIC" },
        ]),
      },
      {
        type_name: "SelectFilter", name: "Status", state: 0,
        values: this.selectValues([
          { name: "Releasing", value: "Releasing" }, { name: "Finished", value: "Finished" },
          { name: "Not Yet Released", value: "Not Yet Released" }, { name: "Cancelled", value: "Cancelled" },
        ]),
      },
      {
        type_name: "SelectFilter", name: "Season", state: 0,
        values: this.selectValues([
          { name: "Winter", value: "WINTER" }, { name: "Spring", value: "SPRING" },
          { name: "Summer", value: "SUMMER" }, { name: "Fall", value: "FALL" },
        ]),
      },
      {
        type_name: "SelectFilter", name: "Year", state: 0,
        values: this.selectValues(this.yearOptions()),
      },
    ];
  }

  yearOptions() {
    const current = new Date().getFullYear() + 1;
    const out = [];
    for (let y = current; y >= 1960; y--) out.push({ name: "" + y, value: "" + y });
    return out;
  }

  getSourcePreferences() {
    return [
      {
        key: "reanime_base_url",
        editTextPreference: {
          title: "Override base URL",
          summary: "Change if the site moves to a new domain",
          value: "https://reanime.to",
          dialogTitle: "Override base URL",
          dialogMessage: "",
        },
      },
      {
        key: "reanime_title_lang",
        listPreference: {
          title: "Preferred title language",
          summary: "",
          valueIndex: 0,
          entries: ["Romaji", "English", "Native"],
          entryValues: ["romaji", "english", "native"],
        },
      },
    ];
  }
}
