// ════════════════════════════════════════════════════════════════════════════
//  ReAnime stream proxy — Cloudflare Worker
// ════════════════════════════════════════════════════════════════════════════
//
//  WHY THIS EXISTS
//  flixcloud.cc's playlist/segment CDN (fetch.flixcloud.cc, *.stronghole.site)
//  sits behind Cloudflare bot management that intermittently or consistently
//  blocks non-browser HTTP clients — confirmed via curl/Node (hard 403s
//  regardless of headers) and via the Mangayomi app's bridged HTTP client
//  (timeouts / empty stream lists). A real browser passes it fine.
//
//  Running the resolve → decrypt → proxy step on Cloudflare's own network
//  (a Worker) gives it a different network fingerprint than a generic mobile
//  client, which is the best remaining lever for reliable playback on this
//  source. It also moves all the slow, Cloudflare-fronted work OUT of the
//  extension's getVideoList() call (which only needs one fast request to this
//  worker), eliminating the "isolate response timeout" failure mode too.
//
//  Workers run on V8 with native crypto.subtle, so the AES/PBKDF2/SHA-256
//  here are just WebCrypto calls. WebAssembly.instantiate() on raw bytes is
//  NOT used, despite Workers nominally supporting WebAssembly — dynamic WASM
//  compilation from a byte buffer fetched at request time is blocked by the
//  Workers runtime ("Wasm code generation disallowed by embedder", since the
//  module isn't a static binding known at deploy time, which it can't be:
//  flixcloud randomizes the module's bytes on every single request). A tiny
//  hand-rolled interpreter for the module's two exports runs the same bytes
//  as plain JS instead — validated byte-for-byte against the real engine.
//
//  DEPLOY (free, ~2 minutes, no command line needed):
//    1. https://dash.cloudflare.com → sign up free if you don't have an account
//    2. Workers & Pages → Create → Create Worker → give it any name → Deploy
//    3. Click "Edit code" — delete the default code, paste this WHOLE file,
//       Save and Deploy
//    4. Copy the worker's URL, shown at the top
//       (looks like https://<name>.<you>.workers.dev)
//    5. In Mangayomi: ReAnime source settings → "Stream proxy URL" → paste it
//
//  ENDPOINTS
//    GET /master.m3u8?embed=<embed url>&audio=sub|dub   primary entry point
//    GET /media.m3u8?u=<media playlist url>&pk=<hex>    internal (referenced
//                                                        by the master playlist)
//    GET /segment?u=<url>                               generic proxy
//                                                        (segments, subs, fonts)
//
//  DEBUGGING
//  Open WORKER_URL/master.m3u8?embed=<an embed link>&audio=sub directly in a
//  browser — errors are returned as plain text in the response body.
// ════════════════════════════════════════════════════════════════════════════

const EMBED_HOST = "https://flixcloud.cc";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CORS = { "Access-Control-Allow-Origin": "*" };

export default {
  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/master.m3u8") return await handleMaster(url, request);
      if (url.pathname === "/media.m3u8") return await handleMedia(url, request);
      if (url.pathname === "/segment") return await handleSegment(url);
      if (url.pathname === "/") return new Response("ReAnime proxy worker is running.", { status: 200, headers: CORS });
      return new Response("Not found", { status: 404, headers: CORS });
    } catch (err) {
      return new Response("Worker error: " + (err && (err.stack || err.message) || String(err)), { status: 500, headers: CORS });
    }
  },
};

// ── helpers ─────────────────────────────────────────────────────────────────

function originOf(request) { return new URL(request.url).origin; }
function matchOne(str, rx) { const m = str.match(rx); return m ? m[1] : null; }
function fieldRx(field) {
  const esc = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp('"?' + esc + '"?\\s*:\\s*"([^"]+)"');
}
function b64ToBytes(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToHex(bytes) { return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""); }
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return bytesToHex(new Uint8Array(buf));
}
function baseOf(u) { return u.slice(0, u.lastIndexOf("/") + 1); }
function absUrl(u, base) { return /^https?:\/\//.test(u) ? u : base + u; }

// ── Minimal WASM interpreter ────────────────────────────────────────────────
//
// flixcloud ships a tiny (~400-byte) WebAssembly module with each embed and
// randomizes its constants per request, so it can't be precompiled as a
// static binding (the only kind of WASM module the Workers runtime allows).
// This executes the module's exported _s / _r / _c functions directly as
// plain JS. Validated against the native WebAssembly engine over many random
// payloads + inputs (see memory/reanime-extension.md).

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

  const skip = (p) => {
    const op = u8[p++];
    if (op === 0x02 || op === 0x03 || op === 0x04) return p + 1;
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
      if (f.kind === 3) { ctrl.length = idx + 1; ip = f.start; }
      else { ctrl.length = idx; ip = f.end + 1; }
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

// A playlist is served either plain (#EXTM3U…) or base64(plaintext XOR pk).
function decryptPlaylist(body, pk) {
  const t = (body || "").trim();
  if (t.indexOf("#EXTM3U") === 0) return t;
  const raw = b64ToBytes(t);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw[i] ^ pk[i % pk.length];
  return new TextDecoder().decode(out);
}

// ── /master.m3u8 — resolve the embed, decrypt the master playlist, rewrite
//    every audio/video rendition to point back at this worker ──────────────

async function handleMaster(url, request) {
  const embedUrl = url.searchParams.get("embed");
  const audioPref = url.searchParams.get("audio") || "sub";
  if (!embedUrl) return new Response("missing embed param", { status: 400, headers: CORS });

  const embedHeaders = { "User-Agent": UA, "Referer": EMBED_HOST + "/" };

  const pageRes = await fetch(embedUrl, { headers: embedHeaders });
  if (!pageRes.ok) return new Response("embed fetch failed: HTTP " + pageRes.status, { status: 502, headers: CORS });
  const html = await pageRes.text();

  const seed = matchOne(html, /obfuscation_seed:"([0-9a-f]+)"/);
  const wPayloadB64 = matchOne(html, /w_payload:"([A-Za-z0-9+/=]+)"/);
  const frag1B64 = matchOne(html, /kf_[0-9a-f]+:"([^"]+)"/);
  const ivB64 = matchOne(html, /ivf_[0-9a-f]+:"([^"]+)"/);
  if (!seed || !wPayloadB64 || !frag1B64 || !ivB64) {
    return new Response("could not extract embed fields (page format may have changed)", { status: 502, headers: CORS });
  }

  // Field-name map derived from the seed (6 chained SHA-256 rounds) — same
  // scheme as the extension; see memory/reanime-extension.md.
  let e = seed;
  for (let i = 0; i < 3; i++) e = await sha256Hex(e + i);
  let s = e;
  for (let i = 0; i < 3; i++) s = await sha256Hex(s + i);
  const keyFrag2Field = s.slice(0, 16) + "_" + s.slice(16, 24);
  const tokenField = e.slice(48, 64) + "_" + e.slice(56, 64);

  const keyFrag2B64 = matchOne(html, fieldRx(keyFrag2Field));
  const token = matchOne(html, fieldRx(tokenField));
  if (!keyFrag2B64 || !token) return new Response("could not resolve computed fields", { status: 502, headers: CORS });

  const tkRes = await fetch(EMBED_HOST + "/api/m3u8/" + token, { headers: embedHeaders });
  if (!tkRes.ok) return new Response("token fetch failed: HTTP " + tkRes.status, { status: 502, headers: CORS });
  const tk = await tkRes.json();
  const vKey = (await sha256Hex(token + "vid")).slice(0, 10);
  const tKey = (await sha256Hex(token + "key")).slice(0, 10);
  const cipherB64 = tk[vKey];
  const fragTB64 = tk[tKey];
  if (!cipherB64 || !fragTB64) return new Response("token response missing fields", { status: 502, headers: CORS });

  // WASM module: _r derives the manifest-URL key (E); _c derives the 32-byte
  // key that XOR-decrypts the playlists themselves. Run via the hand-rolled
  // interpreter above (see the comment block at the top of this file for why
  // native WebAssembly.instantiate() can't be used here).
  const wasm = wasmModule(b64ToBytes(wPayloadB64));

  const frag1 = b64ToBytes(frag1B64);
  const keyFrag2 = b64ToBytes(keyFrag2B64);
  const fragT = b64ToBytes(fragTB64);
  const k = frag1.length;
  const pA = 1000, pB = pA + k, pC = pB + k, pOut = pC + k;
  wasm.memory.set(frag1, pA);
  wasm.memory.set(keyFrag2, pB);
  wasm.memory.set(fragT, pC);
  wasm.call("_s", [parseInt(seed.slice(0, 8), 16) >>> 0]);
  wasm.call("_r", [pA, pB, pC, pOut, k]);
  const E = wasm.memory.slice(pOut, pOut + k);
  const pkPtr = wasm.call("_c", []);
  const pk = wasm.memory.slice(pkPtr, pkPtr + 32);

  // PBKDF2 + seed-xor + SHA-256 → AES-256 key → decrypt the manifest URL.
  const dkBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: new TextEncoder().encode(seed), iterations: 1000, hash: "SHA-256" },
    await crypto.subtle.importKey("raw", E, { name: "PBKDF2" }, false, ["deriveBits"]),
    256
  );
  const dk = new Uint8Array(dkBits);
  for (let i = 0; i < 32; i++) dk[i] ^= seed.charCodeAt(i % seed.length);
  const aesKeyBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", dk));
  const aesKey = await crypto.subtle.importKey("raw", aesKeyBytes, { name: "AES-CBC" }, false, ["decrypt"]);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-CBC", iv: b64ToBytes(ivB64) }, aesKey, b64ToBytes(cipherB64));
  const masterUrl = new TextDecoder().decode(plainBuf).trim();
  if (!/^https?:\/\//.test(masterUrl)) return new Response("decrypted master URL invalid", { status: 502, headers: CORS });

  const cdnHeaders = { "User-Agent": UA, "Referer": EMBED_HOST + "/", "Origin": EMBED_HOST };
  const masterRes = await fetch(masterUrl, { headers: cdnHeaders });
  if (!masterRes.ok) return new Response("master playlist fetch failed: HTTP " + masterRes.status, { status: 502, headers: CORS });
  const master = decryptPlaylist(await masterRes.text(), pk);
  const masterBase = baseOf(masterUrl);
  const pkHex = bytesToHex(pk);
  const origin = originOf(request);

  // Flat (already-muxed) media playlist — no separate renditions.
  if (master.indexOf("#EXT-X-STREAM-INF") < 0) {
    const out = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000\n" +
      origin + "/media.m3u8?u=" + encodeURIComponent(masterUrl) + "&pk=" + pkHex + "\n";
    return new Response(out, { headers: { "Content-Type": "application/vnd.apple.mpegurl", ...CORS } });
  }

  // Parse audio renditions + the (single) video variant.
  const lines = master.split("\n");
  const audios = []; // { line, uri, lang, name }
  let videoUri = null, streamInf = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.indexOf("#EXT-X-MEDIA:") === 0 && l.indexOf("TYPE=AUDIO") >= 0) {
      const uri = (l.match(/URI="([^"]+)"/) || [])[1];
      if (uri) audios.push({
        line: l, uri,
        lang: (l.match(/LANGUAGE="([^"]+)"/) || [])[1] || "",
        name: (l.match(/NAME="([^"]+)"/) || [])[1] || "",
      });
    } else if (l.indexOf("#EXT-X-STREAM-INF") === 0) {
      const next = (lines[i + 1] || "").trim();
      if (next && next.charAt(0) !== "#") { videoUri = next; streamInf = l; }
    }
  }
  if (!videoUri) return new Response("no video variant found in master playlist", { status: 502, headers: CORS });

  // Choose the default audio track from the sub/dub preference.
  let dubIdx = -1;
  for (let i = 0; i < audios.length; i++) {
    if (/eng/i.test(audios[i].lang) || /english|dub/i.test(audios[i].name)) { dubIdx = i; break; }
  }
  let defIdx = 0;
  if (audioPref === "dub") defIdx = dubIdx >= 0 ? dubIdx : 0;
  else if (dubIdx >= 0) defIdx = dubIdx === 0 && audios.length > 1 ? 1 : 0;

  let out = "#EXTM3U\n#EXT-X-VERSION:3\n";
  audios.forEach((a, idx) => {
    const def = idx === defIdx ? "YES" : "NO";
    const abs = absUrl(a.uri, masterBase);
    const proxied = origin + "/media.m3u8?u=" + encodeURIComponent(abs) + "&pk=" + pkHex;
    let line = a.line.replace(/URI="[^"]*"/, 'URI="' + proxied + '"');
    line = /DEFAULT=(YES|NO)/.test(line) ? line.replace(/DEFAULT=(YES|NO)/, "DEFAULT=" + def) : line + ",DEFAULT=" + def;
    out += line + "\n";
  });
  const vAbs = absUrl(videoUri, masterBase);
  out += streamInf + "\n" + origin + "/media.m3u8?u=" + encodeURIComponent(vAbs) + "&pk=" + pkHex + "\n";

  return new Response(out, { headers: { "Content-Type": "application/vnd.apple.mpegurl", ...CORS } });
}

// ── /media.m3u8 — decrypt one audio/video rendition playlist, rewrite every
//    segment to /segment ───────────────────────────────────────────────────

async function handleMedia(url, request) {
  const u = url.searchParams.get("u");
  const pkHex = url.searchParams.get("pk");
  if (!u || !pkHex) return new Response("missing u/pk param", { status: 400, headers: CORS });
  const pk = hexToBytes(pkHex);

  const cdnHeaders = { "User-Agent": UA, "Referer": EMBED_HOST + "/", "Origin": EMBED_HOST };
  const res = await fetch(u, { headers: cdnHeaders });
  if (!res.ok) return new Response("media playlist fetch failed: HTTP " + res.status, { status: 502, headers: CORS });
  const text = decryptPlaylist(await res.text(), pk);
  const base = baseOf(u);
  const origin = originOf(request);

  const out = text.split("\n").map((line) => {
    const t = line.trim();
    if (!t || t.charAt(0) === "#") return line;
    return origin + "/segment?u=" + encodeURIComponent(absUrl(t, base));
  }).join("\n");

  return new Response(out, { headers: { "Content-Type": "application/vnd.apple.mpegurl", ...CORS } });
}

// ── /segment — generic passthrough proxy (video segments, subtitles, fonts)
//
// flixcloud disguises .ts segment URLs/content-type as fonts (anti-scraping
// obfuscation: the upstream Content-Type header lies, e.g. "font/otf" for a
// real MPEG-TS segment). Sniff the actual bytes (TS sync byte 0x47) rather
// than trusting the upstream header, so the player isn't misled.

async function handleSegment(url) {
  const u = url.searchParams.get("u");
  if (!u) return new Response("missing u param", { status: 400, headers: CORS });
  const headers = { "User-Agent": UA, "Referer": EMBED_HOST + "/", "Origin": EMBED_HOST };
  const res = await fetch(u, { headers });
  const buf = new Uint8Array(await res.arrayBuffer());

  let contentType = res.headers.get("content-type") || "application/octet-stream";
  if (buf.length > 0 && buf[0] === 0x47 && (buf.length < 188 || buf[188] === 0x47)) {
    contentType = "video/mp2t";
  }

  const respHeaders = new Headers(CORS);
  respHeaders.set("Content-Type", contentType);
  return new Response(buf, { status: res.status, headers: respHeaders });
}
