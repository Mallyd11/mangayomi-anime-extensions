const mangayomiSources = [
  {
    "name": "1Anime",
    "id": 384756102,
    "lang": "en",
    "baseUrl": "https://1anime.app",
    "apiUrl": "",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://1anime.app",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.3.0",
    "pkgPath": "anime/src/en/oneanime.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": false,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/oneanime.js",
    "dateFormat": "",
    "dateFormatLocale": "",
    "additionalParams": "",
    "sourceCodeLanguage": 1,
    "notes": "Made by MallyD11  https://github.com/Mallyd11/mangayomi-anime-extensions",
  },
];

// The flixcloud embed player (see flixEmbed) protects the playlist URL with an AES-256-CBC key
// derived through PBKDF2 plus a tiny per-request WebAssembly cipher. Mangayomi runs
// extensions in QuickJS, which has neither WebCrypto nor WebAssembly, so every primitive is
// reimplemented here (ported from the ReAnime extension, which reads the same player; each
// was validated byte-for-byte against the browser's native crypto and WebAssembly).
var OA_FLIX = (function () {
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
  const Nk = key.length >> 2, Nr = Nk + 6, w = new Array(4 * (Nr + 1));
  for (let i = 0; i < Nk; i++) w[i] = [key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]];
  let rcon = 1;
  for (let i = Nk; i < 4 * (Nr + 1); i++) {
    let t = w[i - 1].slice();
    if (i % Nk === 0) {
      t = [t[1], t[2], t[3], t[0]].map((x) => _AES_SBOX[x]);
      t[0] ^= rcon;
      rcon = ((rcon << 1) ^ ((rcon & 0x80) ? 0x1b : 0)) & 0xff;
    } else if (Nk > 6 && i % Nk === 4) {
      t = t.map((x) => _AES_SBOX[x]);
    }
    w[i] = w[i - Nk].map((x, j) => x ^ t[j]);
  }
  return w;
}

function _aesInvCipher(blk, w) {
  const Nr = (w.length >> 2) - 1;
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

function aesCbcDecrypt(key, iv, ct, keepPadding) {
  const w = _aesExpandKey(key);
  const out = new Uint8Array(ct.length);
  let prev = iv;
  for (let o = 0; o < ct.length; o += 16) {
    const blk = ct.slice(o, o + 16);
    const dec = _aesInvCipher(blk, w);
    for (let i = 0; i < 16; i++) out[o + i] = dec[i] ^ prev[i];
    prev = blk;
  }
  if (keepPadding) return out;
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
function bytesToB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = i + 1 < bytes.length ? bytes[i + 1] : 0, b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    s += _B64[b0 >> 2];
    s += _B64[((b0 & 3) << 4) | (b1 >> 4)];
    s += i + 1 < bytes.length ? _B64[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    s += i + 2 < bytes.length ? _B64[b2 & 63] : "=";
  }
  return s;
}
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
  return { sha256: sha256, sha256Hex: sha256Hex, pbkdf2: pbkdf2, aesCbcDecrypt: aesCbcDecrypt,
    utf8: utf8, utf8Decode: utf8Decode, b64ToBytes: b64ToBytes, wasmModule: wasmModule };
})();

// English audio for the Dub entry (see englishAudioEdl). The mirror is fixed because the
// playlist's own host is often one that iOS's TLS stack cannot reach; the key unwraps the
// fake image header the CDN puts on segments requested with an image extension.
var OA_SEGMENT_HOST = "vault-93.rundowncdn.top";
var OA_WRAP_KEY = [0x9d, 0x2a, 0xf1, 0x47, 0xb3, 0x8e, 0x5c, 0x70, 0xa6, 0x19, 0xe4, 0x3b, 0xd8, 0x62, 0x0f, 0xc5];
// ~2.8 hours of 4 s segments. A movie of 2 h is ~1800 parts (~230 KB of URL); beyond this
// the plain file is used rather than hand the player an unreasonably large URL.
var OA_MAX_AUDIO_SEGMENTS = 2500;

class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
  }

  get ua() {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
  }

  get headers() {
    return {
      "User-Agent": this.ua,
      "Accept": "application/json",
      "Referer": this.source.baseUrl + "/",
    };
  }

  // ── Listings ──────────────────────────────────────────────────────────────

  get supportsLatest() { return true; }

  async listApi(params) {
    var url = this.source.baseUrl + "/api/animes?" + params;
    var res = await this.client.get(url, this.headers);
    var json = JSON.parse(res.body);
    var info = json.page_info || {};
    return {
      list: this.parseAnimeList(json.data || []),
      hasNextPage: !!info.has_next_page,
    };
  }

  animeTitle(item) {
    var t = (item && item.title) || {};
    if (typeof t === "string") return t;
    return t.english || t.romaji || t.native || "";
  }

  posterOf(item) {
    var p = (item && item.poster) || {};
    return p.large || p.medium || p.small || "";
  }

  parseAnimeList(items) {
    var list = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      list.push({
        name: this.animeTitle(item),
        link: String(item.id),
        imageUrl: this.posterOf(item),
      });
    }
    return list;
  }

  async getPopular(page) {
    try {
      return await this.listApi("page=" + page + "&perPage=24&sort=POPULARITY_DESC&is_adult=0");
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  // "Recently aired" is the site's own ordering for episodes that just landed.
  async getLatestUpdates(page) {
    try {
      return await this.listApi("page=" + page + "&perPage=24&sort=LAST_SUBDUB_EPISODE_DESC&is_adult=0");
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    var params = ["page=" + page, "perPage=24", "is_adult=0"];
    var sort = "POPULARITY_DESC";
    var audio = "";

    if (filters && Array.isArray(filters)) {
      for (var i = 0; i < filters.length; i++) {
        var f = filters[i];
        if (f.type_name === "SelectFilter") {
          var opt = f.values && f.values[f.state];
          var v = opt ? opt.value : "";
          if (!v) continue;
          if (f.name === "Sort") sort = v;
          else if (f.name === "Format") params.push("format_in=" + encodeURIComponent(v));
          else if (f.name === "Status") params.push("status_in=" + encodeURIComponent(v));
          else if (f.name === "Season") params.push("season=" + encodeURIComponent(v));
          else if (f.name === "Year") params.push("season_year=" + encodeURIComponent(v));
          else if (f.name === "Audio") audio = v;
        } else if (f.type_name === "GroupFilter" && f.name === "Genres") {
          var gs = f.state || [];
          for (var g = 0; g < gs.length; g++) {
            if (gs[g].state === true) params.push("genres_in=" + encodeURIComponent(gs[g].value));
          }
        }
      }
    }

    if (query && query.trim().length) params.push("search=" + encodeURIComponent(query.trim()));
    if (audio === "sub" || audio === "both") params.push("has_sub=1");
    if (audio === "dub" || audio === "both") params.push("has_dub=1");
    params.push("sort=" + sort);

    try {
      return await this.listApi(params.join("&"));
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  // ── Detail ────────────────────────────────────────────────────────────────

  statusCode(status) {
    return ({
      "RELEASING": 0,
      "FINISHED": 1,
      "NOT_YET_RELEASED": 4,
      "CANCELLED": 5,
      "HIATUS": 6,
    }[status]);
  }

  stripHtml(str) {
    return (str || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;/g, "'")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // Accepts a bare AniList id or a full /anime/<id> or /watch/<id> URL.
  extractId(url) {
    var m = String(url).match(/(\d+)(?:[^\d]*)$/);
    return m ? m[1] : String(url);
  }

  toEpochMs(dateStr) {
    if (!dateStr) return null;
    var t = Date.parse(dateStr);
    return isNaN(t) ? null : String(t);
  }

  async getDetail(url) {
    var id = this.extractId(url);
    var base = this.source.baseUrl;

    // The two calls are independent; the detail payload is the slow one (~200 KB).
    var results = await Promise.all([
      this.client.get(base + "/api/anime/" + id, this.headers),
      this.client.get(base + "/api/episodes-id?id=" + id, this.headers),
    ]);
    var meta = JSON.parse(results[0].body);
    var epJson = JSON.parse(results[1].body);

    var thumbs = true;
    try {
      var pref = new SharedPreferences().get("oneanime_pref_ep_thumbnails");
      if (pref === false) thumbs = false;
    } catch (e) {}

    var audioPref = this.audioPref();
    var split = this.splitEpisodes();
    var self = this;
    var eps = epJson.episodes || [];
    var chapters = [];
    for (var i = 0; i < eps.length; i++) {
      var ep = eps[i];
      // Placeholder entries (no sub and no dub) have nothing to play.
      if (!ep.sub && !ep.dub) continue;
      // "Sub only" / "Dub only" hide the episodes that lack that version (dubs lag behind
      // the subs on airing shows, so this is what makes a Dub-only list useful).
      if (audioPref === "sub" && !ep.sub) continue;
      if (audioPref === "dub" && !ep.dub) continue;

      var label = "Episode " + ep.number;
      if (ep.title && !/^Episode\s+\d+$/i.test(ep.title)) label += " - " + ep.title;

      var img = ep.image || "";
      // <anilist id the stream API wants>|<episode number>|<sub flag><dub flag>[|<s or d>]
      var epUrl = (ep.anilistId || id) + "|" + ep.number + "|" + (ep.sub ? "1" : "0") + (ep.dub ? "1" : "0");
      var mk = function (name, url, scanlator) {
        return {
          name: name,
          url: url,
          dateUpload: self.toEpochMs(ep.date),
          scanlator: scanlator,
          thumbnailUrl: thumbs && /^https?:/.test(img) ? img : null,
          description: ep.description || null,
        };
      };
      if (split && ep.sub && ep.dub && audioPref !== "sub" && audioPref !== "dub") {
        // Pushed Dub first because the list is reversed below, which puts Sub on top.
        chapters.push(mk(label + " (Dub)", epUrl + "|d", "Dub"));
        // No suffix: this is the link the combined chapter always had, so an existing one
        // (with its watch progress) becomes the Sub chapter instead of a third copy.
        chapters.push(mk(label, epUrl, "Sub"));
      } else {
        chapters.push(mk(label, epUrl, ep.sub && ep.dub ? "Sub & Dub" : (ep.sub ? "Sub" : "Dub")));
      }
    }

    var studios = [];
    var ss = meta.studios || [];
    for (var s = 0; s < ss.length; s++) {
      if (ss[s].is_main && ss[s].studio) studios.push(ss[s].studio.name);
    }

    var genres = [];
    var gs = meta.genres || [];
    for (var g = 0; g < gs.length; g++) genres.push(gs[g].name);

    return {
      name: this.animeTitle(meta),
      imageUrl: this.posterOf(meta),
      description: this.stripHtml(meta.description),
      genre: genres,
      author: studios.join(", "),
      status: this.statusCode(meta.status),
      link: base + "/anime/" + id,
      chapters: chapters.reverse(),
    };
  }

  // ── Stream extraction ─────────────────────────────────────────────────────
  //
  // The site's player no longer reads /api/stream (its cipher keys rotated and the site's own
  // watch page now fails to decrypt it too: "invalid tag"). It asks /api/zen-embed for a
  // flixcloud embed page and everything comes from that page: the video id, the subtitle list
  // and a fresh, IP-bound token that unlocks the encrypted playlist URL (see OA_FLIX). The
  // token inside that playlist URL also opens the direct MKV download link the extension has
  // always played, so the rest of the extension is unchanged.

  matchOne(str, rx) {
    var m = String(str || "").match(rx);
    return m ? m[1] : null;
  }

  fieldRx(field) {
    var esc = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp('"?' + esc + '"?\\s*:\\s*"([^"]+)"');
  }

  // base + a relative reference such as "../abc/audio/english.m3u8".
  resolveUrl(uri, base) {
    if (/^https?:\/\//i.test(uri)) return uri;
    var origin = (base.match(/^(https?:\/\/[^\/]+)/) || [])[1] || "";
    if (uri.charAt(0) === "/") return origin + uri;
    var dir = base.split("?")[0].slice(origin.length).split("/").slice(0, -1);
    var rel = uri.split("/");
    for (var i = 0; i < rel.length; i++) {
      if (rel[i] === "..") { if (dir.length > 1) dir.pop(); }
      else if (rel[i] !== ".") dir.push(rel[i]);
    }
    return origin + dir.join("/");
  }

  // A playlist is served either plain (#EXTM3U...) or as base64(text XOR key).
  playlistText(body, pk) {
    var t = String(body || "").trim();
    if (t.indexOf("#EXTM3U") === 0) return t;
    var raw = OA_FLIX.b64ToBytes(t);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw[i] ^ pk[i % pk.length];
    return OA_FLIX.utf8Decode(out);
  }

  // The subtitle entries of the embed page ({url:"...",language:"English (Full Subtitles)",
  // format:"ass",default:true}), reshaped like the old API's: label without the language
  // wrapper, lang "eng" for English. The list includes the signs-and-songs track itself now.
  parseEmbedSubtitles(html) {
    var out = [];
    var at = html.indexOf("subtitles:[");
    if (at < 0) return out;
    // Ends at "}]", not the first "]": release-group tags such as "[drawn-reality]" sit in names.
    var end = html.indexOf("}]", at);
    var block = html.slice(at + 11, end < 0 ? at + 11 : end + 1);
    var items = block.match(/\{[^{}]*\}/g) || [];
    for (var i = 0; i < items.length; i++) {
      var url = this.matchOne(items[i], /url:"([^"]+)"/);
      var language = this.matchOne(items[i], /language:"([^"]*)"/) || "";
      if (!url) continue;
      var english = /^english/i.test(language);
      var label = language.replace(/^English\s*\((.*)\)\s*$/i, "$1") || language;
      out.push({
        url: url,
        label: label,
        lang: english ? "eng" : language.split(/[\s(]/)[0].toLowerCase(),
      });
    }
    return out;
  }

  async flixEmbed(anilistId, episode, provider) {
    var base = this.source.baseUrl;
    var ze = await this.client.get(base + "/api/zen-embed?anilistId=" + anilistId +
      "&episodeNumber=" + encodeURIComponent(episode) + "&providerName=" + provider, {
      "User-Agent": this.ua,
      "Accept": "application/json",
      "Referer": base + "/watch/" + anilistId,
    });
    if (ze.statusCode !== 200) {
      var why = String(ze.body || "").replace(/\s+/g, " ").slice(0, 120);
      throw new Error("HTTP " + ze.statusCode + (why ? " " + why : ""));
    }
    var playerUrl = JSON.parse(ze.body).playerUrl;
    if (!playerUrl) throw new Error("no player for this episode");

    var page = await this.client.get(playerUrl, { "User-Agent": this.ua, "Referer": base + "/" });
    var html = page.body || "";
    if (page.statusCode !== 200 || !html) throw new Error("embed page HTTP " + page.statusCode);

    var seed = this.matchOne(html, /obfuscation_seed:"([0-9a-f]+)"/);
    var wPayload = this.matchOne(html, /w_payload:"([A-Za-z0-9+\/=]+)"/);
    var frag1B64 = this.matchOne(html, /kf_[0-9a-f]+:"([^"]+)"/);
    var ivB64 = this.matchOne(html, /ivf_[0-9a-f]+:"([^"]+)"/);
    if (!seed || !wPayload || !frag1B64 || !ivB64) throw new Error("embed page changed (no key data)");

    // Field names are derived from the seed by six chained SHA-256 rounds.
    var e = seed;
    for (var i = 0; i < 3; i++) e = OA_FLIX.sha256Hex(e + i);
    var s = e;
    for (var j = 0; j < 3; j++) s = OA_FLIX.sha256Hex(s + j);
    var keyFrag2B64 = this.matchOne(html, this.fieldRx(s.slice(0, 16) + "_" + s.slice(16, 24)));
    var token = this.matchOne(html, this.fieldRx(e.slice(48, 64) + "_" + e.slice(56, 64)));
    if (!keyFrag2B64 || !token) throw new Error("embed page changed (no key fields)");

    // Single-use, IP-bound: one request per embed.
    var tr = await this.client.get("https://flixcloud.cc/api/m3u8/" + token, {
      "User-Agent": this.ua,
      "Accept": "application/json",
      "Referer": playerUrl,
    });
    if (tr.statusCode !== 200) throw new Error("token HTTP " + tr.statusCode);
    var tk = JSON.parse(tr.body);
    var cipherB64 = tk[OA_FLIX.sha256Hex(token + "vid").slice(0, 10)];
    var fragTB64 = tk[OA_FLIX.sha256Hex(token + "key").slice(0, 10)];
    if (!cipherB64 || !fragTB64) throw new Error("incomplete token response");

    var wasm = OA_FLIX.wasmModule(OA_FLIX.b64ToBytes(wPayload));
    var frag1 = OA_FLIX.b64ToBytes(frag1B64);
    var keyFrag2 = OA_FLIX.b64ToBytes(keyFrag2B64);
    var fragT = OA_FLIX.b64ToBytes(fragTB64);
    var k = frag1.length;
    var pA = 1000, pB = pA + k, pC = pB + k, pOut = pC + k;
    wasm.memory.set(frag1, pA);
    wasm.memory.set(keyFrag2, pB);
    wasm.memory.set(fragT, pC);
    wasm.call("_s", [parseInt(seed.slice(0, 8), 16) >>> 0]);
    wasm.call("_r", [pA, pB, pC, pOut, k]);
    var E = wasm.memory.slice(pOut, pOut + k);
    var pkPtr = wasm.call("_c", []);
    var pk = wasm.memory.slice(pkPtr, pkPtr + 32);

    var dk = OA_FLIX.pbkdf2(E, OA_FLIX.utf8(seed), 1000, 32);
    for (var d = 0; d < 32; d++) dk[d] ^= seed.charCodeAt(d % seed.length);
    var aesKey = OA_FLIX.sha256(dk);
    var master = OA_FLIX.utf8Decode(OA_FLIX.aesCbcDecrypt(aesKey, OA_FLIX.b64ToBytes(ivB64), OA_FLIX.b64ToBytes(cipherB64))).trim();
    if (!/^https?:\/\//.test(master)) throw new Error("playlist URL did not decrypt");

    var videoId = this.matchOne(html, /video_id:"([0-9a-f-]{36})"/) || this.matchOne(master, /\/_v7\/([0-9a-f-]{36})\//);
    var jwt = this.matchOne(master, /[?&]token=([^&]+)/);
    var origin = master.split("/_v7/")[0];
    if (!videoId || !jwt) throw new Error("no video id in the playlist URL");

    return {
      master: master,
      pk: pk,
      dl: origin + "/download/" + videoId + "?token=" + jwt,
      subtitles: this.parseEmbedSubtitles(html),
    };
  }

  // The site's own Source menu lists ZenV2 and Zen as "Official Server". They are the same
  // flixcloud video on two CDN mirrors (fetch8 / fetch9), so a server here is only the first
  // hop of the download link - which is what to switch when one mirror is blocked or slow on
  // someone's network. The menu also lists Pahe, Zone, Senshi, Anitaku, AnimeVerse and
  // AnimeHeaven, but on every title and episode checked (2026-09-21) they fail on the
  // site's own backend (dead upstream hosts, 522s, a 403, "no matching anime"), so there is
  // nothing to play and they are deliberately not offered.
  get KNOWN_SERVERS() { return ["ZenV2", "Zen"]; }

  readPref(key, fallback) {
    var v;
    try { v = new SharedPreferences().get(key); } catch (e) {}
    return v === undefined || v === null || v === "" ? fallback : v;
  }

  // "sub_dub" | "dub_sub" | "sub" | "dub", matching AniKoto's own preference. An unset or
  // unknown value reads as "sub_dub".
  audioPref() {
    var a = this.readPref("oneanime_pref_audio", "sub_dub");
    var valid = ["sub_dub", "dub_sub", "sub", "dub"];
    return valid.indexOf(a) >= 0 ? a : "sub_dub";
  }

  // Sub and Dub sit in the exact same file here - every stream carries both audio tracks
  // and every subtitle - so unlike AniKoto's genuinely separate sub/dub sources, this never
  // changes which bytes get fetched, only which labelled entries appear in the picker and
  // in what order. Mangayomi auto-plays the FIRST entry, so order is what "Sub then Dub" /
  // "Dub then Sub" actually control; picking either entry opens the identical stream, so
  // switching tracks for real is the player's own audio menu, same as if there were only one.
  entryKinds(hasSub, hasDub, audio) {
    if (audio === "sub") return hasSub ? ["Sub"] : (hasDub ? ["Dub"] : []);
    if (audio === "dub") return hasDub ? ["Dub"] : (hasSub ? ["Sub"] : []);
    if (!hasSub) return hasDub ? ["Dub"] : [];
    if (!hasDub) return ["Sub"];
    return audio === "dub_sub" ? ["Dub", "Sub"] : ["Sub", "Dub"];
  }

  // The servers the viewer ticked (both by default), in KNOWN_SERVERS order, with the
  // "play first" choice moved to the front. Nothing is dropped by the reordering.
  enabledServers() {
    var all = this.KNOWN_SERVERS;
    var ticked = this.readPref("oneanime_pref_servers", null);
    var picked = all.filter(function (s) { return ticked && ticked.indexOf(s) >= 0; });
    if (!picked.length) picked = all.slice();
    var first = this.readPref("oneanime_pref_server", "auto");
    if (picked.indexOf(first) > 0) {
      picked = [first].concat(picked.filter(function (s) { return s !== first; }));
    }
    return picked;
  }

  headerValue(headers, name) {
    if (!headers) return "";
    var want = name.toLowerCase();
    for (var k in headers) {
      if (String(k).toLowerCase() === want) return String(headers[k] || "");
    }
    return "";
  }

  // The tokenised link's path carries no extension, and the token is bound to that exact
  // path - appending anything to it, even before the query string, answers 400 Bad Request.
  // Confirmed the hard way: the app opens a video's originalUrl (not url) the very first
  // time a fresh player screen appears, before any server switch is possible - on Windows a
  // 400 there left the player stuck on its buffering spinner forever (mpv had already given
  // up, with nothing queued to retry). v0.1.3 papered over the downloader's extension check
  // with a ".mkv" alias of that same broken path; this resolves the *real* file the link
  // redirects to instead, which already ends in a genuine ".mkv" on its own and is always
  // safe to open directly, whichever field it ends up in.
  async resolveDirectUrl(downloadUrl, headers) {
    try {
      var c = new Client({ "useDartHttpClient": true, "followRedirects": false });
      var h = {};
      for (var k in headers) h[k] = headers[k];
      h["Range"] = "bytes=0-0";
      var res = await c.get(downloadUrl, h);
      var loc = this.headerValue(res.headers, "location");
      if (res.statusCode >= 300 && res.statusCode < 400 && /^https?:\/\//.test(loc)) return loc;
    } catch (e) {}
    return null;
  }

  // The master m3u8 carries the real resolution and the separate English audio rendition.
  // Resolution is not safe to assume - almost everything on this backend is 1080p, but an
  // obscure 2004 title (id 634) serves 712x478 - so it is read live. The playlist arrives
  // encrypted (see playlistText); `audio` is the absolute URL of the English rendition's
  // playlist, or null when the episode has none (some episodes list only the Japanese track).
  async masterInfo(masterUrl, headers, pk) {
    var info = { res: "", audio: null };
    try {
      var res = await this.client.get(masterUrl, headers);
      var body = this.playlistText(res.body, pk);
      var m = body.match(/RESOLUTION=\d+x(\d+)/);
      if (m) info.res = m[1] + "p";
      var lines = body.split("\n");
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i];
        if (l.indexOf("#EXT-X-MEDIA:TYPE=AUDIO") !== 0) continue;
        var lang = (l.match(/LANGUAGE="([^"]*)"/) || [])[1] || "";
        var name = (l.match(/NAME="([^"]*)"/) || [])[1] || "";
        var uri = (l.match(/URI="([^"]*)"/) || [])[1];
        if (uri && (/^en/i.test(lang) || /english/i.test(name))) {
          info.audio = this.resolveUrl(uri, masterUrl);
          break;
        }
      }
      // Only AAC was measured to line up; anything else keeps the plain file.
      var codecs = (body.match(/CODECS="([^"]*)"/) || [])[1] || "";
      if (codecs && codecs.indexOf("mp4a") < 0) info.audio = null;
    } catch (e) {}
    return info;
  }

  // The presentation timestamp (seconds) of the first audio packet in a rendition's first
  // segment, or null when it cannot be read. It is NOT a constant: most episodes start at
  // 1.4 s (ffmpeg's MPEG-TS default) but One Piece E1 starts at 0.965, and using 1.4 there
  // put the English audio 440 ms off the picture (measured by cross-correlating the
  // rendered audio against the MKV's own English track; with the true value the offset is
  // 0 ms, deep into the episode too). The MKV's tracks all start at 0, so the first
  // sample of the rendition belongs at time 0.
  //
  // The extension only sees response bodies as text, so the segment is requested in its
  // listed form (".png" / ".webp", served as image/* with no charset, which arrives one
  // character per byte). The CDN disguises those: an 8-byte PNG signature (or a 12-byte
  // RIFF/WEBP header) followed by the MPEG-TS XORed with a fixed 16-byte key. A PES header
  // carries the PTS in five bytes (33 bits, 90 kHz); the first sits within the first
  // kilobyte. Everything is sanity-checked, so a client that decodes differently yields null.
  async firstPts(segUrl, headers) {
    try {
      var h = {};
      for (var k in headers) h[k] = headers[k];
      h["Range"] = "bytes=0-1023";
      var res = await this.client.get(segUrl, h);
      var s = res.body || "";
      if ((res.statusCode !== 206 && res.statusCode !== 200) || s.length < 1024) {
        this._ptsWhy = "HTTP " + res.statusCode + ", " + s.length + " chars";
        return null;
      }
      var raw = [];
      for (var i = 0; i < 1024; i++) {
        var c = s.charCodeAt(i);
        if (c > 255) { this._ptsWhy = "char " + c + " at " + i; return null; }
        raw.push(c);
      }
      var skip = 0;
      if (raw[0] === 0x89 && raw[1] === 0x50 && raw[2] === 0x4e && raw[3] === 0x47) skip = 8;
      else if (raw[0] === 0x52 && raw[1] === 0x49 && raw[2] === 0x46 && raw[3] === 0x46) skip = 12;
      if (!skip) { this._ptsWhy = "head " + raw.slice(0, 4).join(","); return null; }
      var n = 1024 - skip, ts = [];
      for (var j = 0; j < n; j++) ts.push(raw[j + skip] ^ OA_WRAP_KEY[j & 15]);
      if (ts[0] !== 0x47 || ts[188] !== 0x47) { this._ptsWhy = "not TS"; return null; }
      for (var p = 0; p + 188 <= n; p += 188) {
        if (ts[p] !== 0x47) return null;
        var afc = (ts[p + 3] >> 4) & 3;
        if (!(ts[p + 1] & 0x40) || afc === 0 || afc === 2) continue; // no payload start here
        var o = p + 4 + (afc === 3 ? ts[p + 4] + 1 : 0);
        if (o + 14 > n) continue;
        if (ts[o] !== 0 || ts[o + 1] !== 0 || ts[o + 2] !== 1) continue; // not a PES header
        if ((ts[o + 7] >> 6) < 2) continue; // carries no PTS
        var pts = ((ts[o + 9] >> 1) & 7) * 1073741824 + ts[o + 10] * 4194304 +
          (ts[o + 11] >> 1) * 32768 + ts[o + 12] * 128 + (ts[o + 13] >> 1);
        var sec = pts / 90000;
        return sec >= 0 && sec < 60 ? sec : null;
      }
    } catch (e) {}
    return null;
  }

  // The English audio as the body of an mpv EDL (without the "edl://" prefix and without
  // the video): one lazily-opened part per segment, each carrying its own start= because
  // mpv cannot learn where an unopened segment starts (without it every segment after the
  // first reads as out of range). Opening them all up front instead costs ~2.6 segments/s,
  // i.e. minutes of frozen spinner. Segments are requested as ".ts", which the CDN answers
  // with raw unwrapped MPEG-TS (the disguised forms are not playable by ordinary players),
  // from a fixed rundowncdn mirror: atomic4cdn mirrors fail their TLS handshake under the
  // mbedtls stack iOS uses (ReAnime hit this), and rundowncdn answered every test. Needs only
  // the Referer the stream already carries. Returns null when anything cannot be confirmed
  // (no playlist, first timestamp unreadable, mirror refuses): the caller then falls back to
  // the plain file, which always plays.
  async englishAudioEdl(playlistUrl, headers, pk) {
    try {
      var res = await this.client.get(playlistUrl, headers);
      if (res.statusCode !== 200) return this.why("audio playlist HTTP " + res.statusCode);
      var pbase = playlistUrl.split("?")[0];
      pbase = pbase.slice(0, pbase.lastIndexOf("/") + 1);
      var lines = this.playlistText(res.body, pk).split("\n");
      var segs = [], dur = null;
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i].replace(/\r$/, "");
        var m = l.match(/^#EXTINF:([\d.]+)/);
        if (m) { dur = m[1]; continue; }
        if (l && l.charAt(0) !== "#" && dur !== null) {
          segs.push({ url: /^https?:/i.test(l) ? l : pbase + l, dur: dur });
          dur = null;
        }
      }
      if (!segs.length || segs.length > OA_MAX_AUDIO_SEGMENTS) return this.why(segs.length + " audio segments");

      var pts0 = await this.firstPts(segs[0].url, headers);
      // Unreadable in some environments (the app's client): 1.4 s is what ffmpeg gives
      // almost every episode (only a few such as One Piece differ, by under half a second),
      // which beats losing the English audio altogether.
      if (pts0 === null) pts0 = 1.4;

      var urls = [];
      for (var s = 0; s < segs.length; s++) {
        urls.push(segs[s].url.split("?")[0].replace(/\.[A-Za-z0-9]+$/, ".ts")
          .replace(/^(https?:\/\/)[^\/]+/i, "$1" + OA_SEGMENT_HOST));
      }
      var probe = {};
      for (var k in headers) probe[k] = headers[k];
      probe["Range"] = "bytes=0-187";
      var check = null;
      try {
        check = await this.client.get(urls[0], probe);
      } catch (e) {} // unverifiable from here; the player has its own network stack
      if (check && check.statusCode !== 200 && check.statusCode !== 206) return this.why("audio mirror HTTP " + check.statusCode);

      var at = pts0;
      var parts = ["!delay_open,media_type=audio,codec=aac", "!track_meta,lang=eng,title=English"];
      for (var u = 0; u < urls.length; u++) {
        parts.push("%" + urls[u].length + "%" + urls[u] + ",start=" + at.toFixed(4) + ",length=" + segs[u].dur);
        at += parseFloat(segs[u].dur);
      }
      return parts.join(";");
    } catch (e) {
      return this.why("audio error " + (e && e.message ? e.message : e));
    }
  }

  // Why the Dub entry fell back to the plain file, shown in its label (the fallbacks are
  // otherwise silent, which made an in-app-only failure impossible to see). Always null.
  why(reason) {
    this._why = String(reason).slice(0, 60);
    return null;
  }

  // Mangayomi reads the default audio and subtitle from the FIRST entry of a list and
  // re-applies the last-used track when another entry is picked, so choosing Sub or Dub
  // inside the player cannot change them. Listing each episode twice does: each one is its
  // own player session, led by its own kind.
  splitEpisodes() {
    var v = this.readPref("oneanime_pref_split", false);
    return v === true || v === "true";
  }

  // Moves the kind the episode was opened as to the front of the entries.
  leadKinds(kinds, lead) {
    var want = lead === "d" ? "Dub" : (lead === "s" ? "Sub" : "");
    if (!want || kinds.indexOf(want) <= 0) return kinds;
    return [want].concat(kinds.filter(function (k) { return k !== want; }));
  }

  dubAudioEnabled() {
    var v = this.readPref("oneanime_pref_dub_audio", true);
    return v !== false && v !== "false";
  }

  // The MKV embeds several English tracks, and the file's own "default" flag on them is not
  // reliable - Death Note E1 flags "Signs & Songs" (translates only on-screen text, meant to
  // accompany dub audio) as default instead of the real dialogue track sitting right next to
  // it. Mangayomi lets an extension force a different default via Video.subtitles: if that
  // list is non-empty, the app selects from IT at video-open time instead of trusting the
  // file - so ranking one candidate from the API's own subtitle list (already in `data`, no
  // extra request) and handing over just that one is enough to fix the default, while every
  // embedded track (all languages) stays reachable from the player's own subtitle menu as
  // always. Signs/songs-only and title-card-only tracks never win, even as a last resort -
  // the AI-generated dub captions are a lower-priority fallback but at least are dialogue.
  rankSubtitle(label) {
    label = String(label || "").toLowerCase();
    // Fansub groups abbreviate "Signs & Songs" many ways ("S&S", "SS", "Signs/Songs"...).
    if (/\bs\s*(&|\+|and)\s*s\b|sign|song|episode name|title.?card/.test(label)) return 0;
    if (/dubtitle|\bcc\b|closed.?caption/.test(label)) return 1;
    if (/\bfull\b|\bdialog(ue)?\b/.test(label)) return 3;
    return 2;
  }

  fullEnglishSubtitle(subs) {
    var best = null, bestRank = 0;
    for (var i = 0; i < (subs || []).length; i++) {
      var s = subs[i];
      var lang = String(s.lang || "").toLowerCase();
      if (!s.url || (lang !== "eng" && lang !== "en" && lang.indexOf("english") < 0)) continue;
      var rank = this.rankSubtitle(s.label);
      if (rank > bestRank) { bestRank = rank; best = s; }
    }
    return best;
  }

  // For Dub-first listings the default subtitle is the English signs-and-songs track (it
  // only translates on-screen text and lyrics, which is all a viewer hearing the English dub
  // needs), not the full dialogue track that would just repeat what is being said. Only a
  // track the API actually offers can be forced: the embedded S&S track is not reachable
  // through Video.subtitles, so when the API does not list one nothing is forced and the
  // file's own default flag decides.
  signsSongsSubtitle(subs) {
    for (var i = 0; i < (subs || []).length; i++) {
      var s = subs[i];
      var lang = String(s.lang || "").toLowerCase();
      if (!s.url || (lang !== "eng" && lang !== "en" && lang.indexOf("english") < 0)) continue;
      if (/\bs\s*(&|\+|and)\s*s\b|sign|song/.test(String(s.label || "").toLowerCase())) return s;
    }
    return null;
  }

  // Does a leading chunk of an .ass file look like a signs-and-songs track? Its first events
  // are opening/ending lyrics and on-screen signs (styles such as OP_Eng, DN OP, Signs 2),
  // never ordinary dialogue; a full track gives itself away with a dialogue style.
  looksLikeSignsSongs(body) {
    if (String(body).indexOf("[Script Info]") < 0) return false;
    var lines = String(body).split("\n"), seen = 0, positive = false;
    for (var i = 0; i < lines.length && seen < 12; i++) {
      if (lines[i].indexOf("Dialogue:") !== 0) continue;
      var style = (lines[i].split(",")[3] || "").trim();
      // Only complete lines count: the chunk is cut mid-line.
      if (lines[i].split(",").length < 10) continue;
      seen++;
      if (/^(default|dialogue|main|italics?|thoughts?|narrat\w*|internal|flashback)/i.test(style)) return false;
      if (/(^|[^a-z])(op|ed|signs?|songs?|kara\w*|lyrics?|title|ts)([^a-z]|$)/i.test(style)) positive = true;
    }
    return seen >= 2 && positive;
  }

  // The site's subtitle list is incomplete: the MKV embeds a separate signs-and-songs track
  // and the CDN serves it as its own file, but the list often omits it (Death Note E1 lists
  // only the AI dub captions; Attack on Titan lists only the full track). On every title
  // checked the files sit side by side, signs and songs at eng_3.ass next to the full
  // eng_4.ass, and one token opens the whole directory. So when the list does not offer
  // one, the neighbours of the full track (and eng_3) are fetched a few KB at a time and
  // kept only if their content looks like signs and songs - a wrong guess forces nothing.
  async discoverSignsSongs(subs, headers) {
    try {
      var dir = null, query = "", prefix = "", anchor = 0;
      for (var i = 0; i < (subs || []).length; i++) {
        var m = String(subs[i].url || "").match(/^(https?:\/\/[^?]*\/subtitles\/[^\/?]+\/)([^\/?]+?)(?:\?(.*))?$/);
        if (!m) continue;
        if (!dir) { dir = m[1]; query = m[3] || ""; }
        var n = m[2].match(/^(.*?)eng_(\d+)\.ass$/);
        var lang = String(subs[i].lang || "").toLowerCase();
        if (n && /^en/.test(lang) && this.rankSubtitle(subs[i].label) >= 2) {
          dir = m[1]; query = m[3] || ""; prefix = n[1]; anchor = parseInt(n[2], 10);
          break;
        }
      }
      if (!dir) return null;
      // Neighbours of the full track (either side: Koi Kaze has the full track at eng_3 and
      // its signs and songs at eng_4), then eng_3. Never the full track itself.
      var tries = [];
      if (anchor > 1) tries.push(anchor - 1);
      if (anchor > 0) tries.push(anchor + 1);
      if (tries.indexOf(3) < 0 && anchor !== 3) tries.push(3);

      // A signs-and-songs track is a fraction of the full one. Its size, when both can be
      // read, rules out a neighbour that is just another full variant starting with a sign.
      var anchorTotal = 0;
      if (anchor) {
        try {
          var ar = await this.client.get(dir + prefix + "eng_" + anchor + ".ass" + (query ? "?" + query : ""), { "Range": "bytes=0-0" });
          anchorTotal = parseInt((this.headerValue(ar.headers, "content-range").split("/")[1] || "0"), 10) || 0;
        } catch (e) {}
      }
      // The extension's own HTTP client can fail where the player's does not (the app's
      // default client is a different stack), so a probe that THROWS proves nothing. If
      // none of them could be read at all, the first neighbour is used unverified - it is
      // the signs-and-songs file on every title but Koi Kaze - rather than losing it.
      var ruledOut = {};
      for (var k = 0; k < tries.length; k++) {
        var url = dir + prefix + "eng_" + tries[k] + ".ass" + (query ? "?" + query : "");
        var res;
        try {
          res = await this.client.get(url, { "Range": "bytes=0-6143" });
        } catch (e) {
          continue;
        }
        // Only a file that was read and is plainly something else rules a neighbour out; a
        // refusal or odd status from the extension's own client says nothing about the file.
        if (res.statusCode !== 200 && res.statusCode !== 206) continue;
        var total = parseInt((this.headerValue(res.headers, "content-range").split("/")[1] || "0"), 10) || 0;
        if (!this.looksLikeSignsSongs(res.body || "") || (anchorTotal && total && total >= anchorTotal * 0.9)) {
          ruledOut[tries[k]] = true;
          continue;
        }
        return { url: url, label: "Signs & Songs" };
      }
      // Nothing confirmed: take the first neighbour that was not ruled out.
      for (var g = 0; g < tries.length; g++) {
        if (!ruledOut[tries[g]]) return { url: dir + prefix + "eng_" + tries[g] + ".ass" + (query ? "?" + query : ""), label: "Signs & Songs" };
      }
    } catch (e) {}
    return null;
  }

  // The one subtitle forced on at video-open time: signs and songs when the list leads with
  // Dub (the English dub already says the dialogue), the full English dialogue otherwise.
  async defaultSubtitles(raw, first, headers) {
    var pick = first === "Dub" ? this.signsSongsSubtitle(raw) : this.fullEnglishSubtitle(raw);
    if (!pick && first === "Dub") pick = await this.discoverSignsSongs(raw, headers);
    return pick ? [{ file: pick.url, label: pick.label || "English" }] : [];
  }

  // Everything one server contributes, before it is turned into picker entries. One fetch
  // covers every kind (["Sub"], ["Dub"], or both, already ordered), since they are the same
  // file - fetching the API a second time for the other audio label would return
  // byte-identical bytes. The requested subOrDub value only has to be one the episode
  // actually has; which one is irrelevant to the result.
  async serverBase(anilistId, episode, server, kinds) {
    try {
      var data = await this.flixEmbed(anilistId, episode, server);
      var dl = data.dl;

      // The CDN wants just a Referer. No User-Agent: it does not check it, and mpv splits its
      // header list on commas, which a browser UA ("KHTML, like Gecko") would break.
      var headers = { "Referer": "https://flixcloud.cc/" };

      // The tokenised link is good for 6 hours and the CDN re-signs it on every request, so
      // it is what plays and what a queued or retried download uses. It is dead 15 minutes
      // after this direct file link is issued (404, mid-file ranges included) - reopen the
      // episode if a very long session outlives that.
      var results = await Promise.all([
        this.resolveDirectUrl(dl, headers),
        this.masterInfo(data.master, headers, data.pk),
      ]);
      var info = results[1] || { res: "", audio: null };

      return {
        base: {
          server: server,
          dl: dl,
          direct: results[0],
          res: info.res,
          audio: info.audio,
          headers: headers,
          pk: data.pk,
          rawSubs: data.subtitles || [],
          subs: [],
        },
      };
    } catch (e) {
      return { error: server + ": " + (e && e.message ? e.message : String(e)) };
    }
  }

  // Turns one server's base into picker entries.
  //
  // Sub is the plain file: its first audio track is the Japanese original.
  //
  // Dub, when the English audio could be confirmed (audioBody), is the same file with the
  // site's separate English audio placed FIRST: an mpv EDL of two stream sets, English
  // audio then the MKV. The tracks are then English (1, the default: the first audio track
  // wins when no language is preferred), Japanese (2), the file's own English (3), and every
  // embedded subtitle exactly as in the plain file. Mangayomi remembers the last-used track
  // by ID and re-applies it when another entry is picked, so ID 1 meaning "this entry's
  // language" in both entries is what lets switching Sub <-> Dub in the player change the
  // audio. When it could not be confirmed, Dub is just the plain file again.
  //
  // originalUrl is what the app plays on the first open of a fresh player screen (url only
  // after a switch), so for the EDL entry both fields are the EDL. It is not downloadable
  // (the downloader fetches url and gates on originalUrl ending in a video extension), so
  // when no plain entry is listed (Dub only) a plain "Dub (file)" entry is added for
  // downloads, and as a fallback should the EDL misbehave on a device.
  //
  // Plain Sub and Dub share one url/originalUrl - same file - but the app's own JS bridge
  // (eval/javascript/service.dart getVideoList()) deduplicates the RAW list by that
  // (url, originalUrl) pair alone, before it ever looks at quality: two identical pairs
  // collapse into one, silently - confirmed live, v0.1.5 lost the second entry per server
  // that way. A URL fragment ("#sub"/"#dub") makes each pair unique without changing what
  // gets requested: fragments are stripped by every HTTP client before the request line is
  // built, so the network call, the CDN's signature check, and Uri.path (what the
  // downloader's extension check reads) are all untouched.
  entriesFor(base, kinds, audioBody) {
    var label = base.server + (base.res ? " " + base.res : "");
    var self = this;
    function plain(kind, tag, name) {
      return {
        url: base.dl + tag,
        originalUrl: (base.direct || base.dl) + tag,
        quality: label + " · " + name,
        headers: base.headers,
        subtitles: base.subs,
      };
    }
    var out = [];
    for (var i = 0; i < kinds.length; i++) {
      var kind = kinds[i];
      if (kind === "Dub" && !audioBody && this._why) {
        out.push(plain(kind, "#dub", "Dub (Japanese audio: " + this._why + ")"));
        continue;
      }
      if (kind === "Dub" && audioBody) {
        var edl = "edl://!new_stream;" + audioBody + ";!new_stream;%" + base.dl.length + "%" + base.dl;
        out.push({
          url: edl,
          originalUrl: edl,
          quality: label + " · Dub" + (kinds[0] === "Dub" && !(base.subs || []).length ? " (no Signs & Songs found)" : ""),
          headers: base.headers,
          subtitles: base.subs,
        });
      } else {
        out.push(plain(kind, "#" + kind.toLowerCase(), kind));
      }
    }
    if (audioBody && kinds.indexOf("Sub") < 0) out.push(plain("Dub", "#dubfile", "Dub (file)"));
    return out;
  }

  async getVideoList(url) {
    var parts = String(url).split("|");
    var anilistId = parts[0];
    var episode = parts[1];
    var flags = parts[2] || "11";
    if (!/^\d+$/.test(anilistId) || !episode) return [];

    var hasSub = flags.charAt(0) !== "0", hasDub = flags.charAt(1) !== "0";
    var kinds = this.leadKinds(this.entryKinds(hasSub, hasDub, this.audioPref()),
      parts[3] || (hasSub && hasDub && this.splitEpisodes() ? "s" : ""));
    if (!kinds.length) return [];

    // Ticked servers first; the others only as a rescue lane. An episode that refuses to
    // play is worse than one that plays on a server the viewer did not tick.
    var enabled = this.enabledServers();
    var rescue = this.KNOWN_SERVERS.filter(function (s) { return enabled.indexOf(s) < 0; });
    var tiers = rescue.length ? [enabled, rescue] : [enabled];

    var self = this;
    var errors = [];

    for (var t = 0; t < tiers.length; t++) {
      var servers = tiers[t];
      // Every server in the tier is asked at once (the site's own player makes two calls per
      // episode as well), so each one contributing a Sub and/or Dub entry costs no extra
      // requests - the picker ends up showing every combination the tier can offer, not just
      // whichever server happened to answer first.
      var results = await Promise.all(servers.map(function (server) {
        return self.serverBase(anilistId, episode, server, kinds);
      }));
      var bases = [];
      for (var r = 0; r < results.length; r++) {
        if (results[r].base) bases.push(results[r].base);
        else if (errors.indexOf(results[r].error) < 0) errors.push(results[r].error);
      }
      if (!bases.length) continue;

      // Same subtitles on every server (same video id), decided once; the default follows
      // which kind leads the list (see splitEpisodes).
      var subs = await this.defaultSubtitles(bases[0].rawSubs, kinds[0], bases[0].headers);
      for (var q = 0; q < bases.length; q++) bases[q].subs = subs;

      // The English audio is the same on every server (same video id, only the first hop
      // differs), so it is built once and shared: one playlist fetch, one timestamp read.
      var audioBody = null;
      this._why = "";
      this._ptsWhy = "";
      if (kinds.indexOf("Dub") >= 0) {
        if (!this.dubAudioEnabled()) {
          this._why = "English audio is off";
        } else {
          for (var b = 0; b < bases.length && !audioBody; b++) {
            if (bases[b].audio) audioBody = await this.englishAudioEdl(bases[b].audio, bases[b].headers, bases[b].pk);
          }
          if (!audioBody && !this._why) this._why = "no English audio listed";
        }
      }

      var videos = [];
      for (var e = 0; e < bases.length; e++) videos = videos.concat(this.entriesFor(bases[e], kinds, audioBody));
      return videos;
    }
    // Throw rather than return []: the player then shows the reason with a Retry button
    // instead of a bare "video list is empty".
    throw new Error("1Anime has no playable stream for this episode (" + errors.join("; ") + ")");
  }

  // ── Filters & preferences ─────────────────────────────────────────────────

  getFilterList() {
    var genres = ["Action", "Adventure", "Comedy", "Drama", "Ecchi", "Fantasy",
      "Horror", "Mahou Shoujo", "Mecha", "Music", "Mystery", "Psychological",
      "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller"];

    var years = [{ type_name: "SelectOption", name: "Any", value: "" }];
    var now = new Date().getFullYear();
    for (var y = now + 1; y >= 1990; y--) {
      years.push({ type_name: "SelectOption", name: String(y), value: String(y) });
    }

    return [
      { type_name: "SelectFilter", name: "Sort", state: 0, values: [
        { type_name: "SelectOption", name: "Popularity",     value: "POPULARITY_DESC" },
        { type_name: "SelectOption", name: "Trending",       value: "TRENDING_DESC" },
        { type_name: "SelectOption", name: "Score",          value: "SCORE_DESC" },
        { type_name: "SelectOption", name: "Favorites",      value: "FAVORITES_DESC" },
        { type_name: "SelectOption", name: "Newest",         value: "START_DATE_DESC" },
        { type_name: "SelectOption", name: "Oldest",         value: "START_DATE_ASC" },
        { type_name: "SelectOption", name: "Title (A-Z)",    value: "TITLE_ROMAJI" },
        { type_name: "SelectOption", name: "Most episodes",  value: "EPISODES_DESC" },
        { type_name: "SelectOption", name: "Recently aired", value: "LAST_SUBDUB_EPISODE_DESC" },
      ]},
      { type_name: "SelectFilter", name: "Format", state: 0, values: [
        { type_name: "SelectOption", name: "Any",      value: "" },
        { type_name: "SelectOption", name: "TV",       value: "TV" },
        { type_name: "SelectOption", name: "TV Short", value: "TV_SHORT" },
        { type_name: "SelectOption", name: "Movie",    value: "MOVIE" },
        { type_name: "SelectOption", name: "OVA",      value: "OVA" },
        { type_name: "SelectOption", name: "ONA",      value: "ONA" },
        { type_name: "SelectOption", name: "Special",  value: "SPECIAL" },
        { type_name: "SelectOption", name: "Music",    value: "MUSIC" },
      ]},
      { type_name: "SelectFilter", name: "Status", state: 0, values: [
        { type_name: "SelectOption", name: "Any",       value: "" },
        { type_name: "SelectOption", name: "Airing",    value: "RELEASING" },
        { type_name: "SelectOption", name: "Finished",  value: "FINISHED" },
        { type_name: "SelectOption", name: "Upcoming",  value: "NOT_YET_RELEASED" },
        { type_name: "SelectOption", name: "Cancelled", value: "CANCELLED" },
        { type_name: "SelectOption", name: "Hiatus",    value: "HIATUS" },
      ]},
      { type_name: "SelectFilter", name: "Season", state: 0, values: [
        { type_name: "SelectOption", name: "Any",    value: "" },
        { type_name: "SelectOption", name: "Winter", value: "WINTER" },
        { type_name: "SelectOption", name: "Spring", value: "SPRING" },
        { type_name: "SelectOption", name: "Summer", value: "SUMMER" },
        { type_name: "SelectOption", name: "Fall",   value: "FALL" },
      ]},
      { type_name: "SelectFilter", name: "Year", state: 0, values: years },
      { type_name: "SelectFilter", name: "Audio", state: 0, values: [
        { type_name: "SelectOption", name: "Any",       value: "" },
        { type_name: "SelectOption", name: "Subbed",    value: "sub" },
        { type_name: "SelectOption", name: "Dubbed",    value: "dub" },
        { type_name: "SelectOption", name: "Sub & Dub", value: "both" },
      ]},
      {
        type_name: "GroupFilter",
        name: "Genres",
        state: genres.map(function (g) {
          return { type_name: "CheckBox", name: g, value: g, state: false };
        }),
      },
    ];
  }

  getSourcePreferences() {
    return [
      {
        key: "oneanime_pref_servers",
        multiSelectListPreference: {
          title: "Servers",
          summary: "Servers listed in the player's picker. ZenV2 and Zen are two mirrors of the same stream, so if one buffers or will not start, switch to the other in the player. A server you untick is only used if the ticked ones fail.",
          values: ["ZenV2", "Zen"],
          entries: ["ZenV2 (fetch8 mirror)", "Zen (fetch9 mirror)"],
          entryValues: ["ZenV2", "Zen"],
        },
      },
      {
        key: "oneanime_pref_server",
        listPreference: {
          title: "Server to play first",
          summary: "The server the player starts with, and the one downloads use. Auto starts with ZenV2.",
          valueIndex: 0,
          entries: ["Auto (ZenV2)", "ZenV2", "Zen"],
          entryValues: ["auto", "ZenV2", "Zen"],
        },
      },
      {
        key: "oneanime_pref_audio",
        listPreference: {
          title: "Preferred audio",
          summary: "Sub and Dub both show up in the player's quality list; this orders them (Mangayomi plays whichever is first), picks the default subtitle (Sub first: full English dialogue; Dub first: English signs & songs when the site offers it) and, for the -only options, hides episodes missing that version. Sub starts with the Japanese audio and Dub with the English audio; either can be switched from the player's audio menu.",
          valueIndex: 0,
          entries: [
            "Sub then Dub (Sub plays, Dub as backup)",
            "Dub then Sub (Dub plays, Sub as backup)",
            "Sub only",
            "Dub only",
          ],
          entryValues: ["sub_dub", "dub_sub", "sub", "dub"],
        },
      },
      {
        key: "oneanime_pref_split",
        checkBoxPreference: {
          title: "Sub and Dub as separate episodes",
          summary: "Lists every episode that has both twice, once per version. Opening the Dub one starts with the English audio and the English signs & songs subtitle; opening the Sub one starts with the Japanese audio and the full English subtitle. Mangayomi keeps your last audio and subtitle choice when you switch between Sub and Dub inside the player, so this is the reliable way to get those defaults. Refresh the anime after changing it.",
          value: false,
        },
      },
      {
        key: "oneanime_pref_dub_audio",
        checkBoxPreference: {
          title: "English audio on Dub",
          summary: "The Dub entry plays the site's separate English audio with the picture, so choosing Dub starts in English. Turn this off if Dub will not play or buffers: Dub then opens the same file as Sub, with both audio tracks in the player's audio menu.",
          value: true,
        },
      },
      {
        key: "oneanime_pref_ep_thumbnails",
        checkBoxPreference: {
          title: "Episode thumbnails",
          summary: "Show a thumbnail next to each episode in the list.",
          value: true,
        },
      },
    ];
  }
}
