const mangayomiSources = [
  {
    "name": "Senshi",
    "id": 728461935,
    "lang": "en",
    "baseUrl": "https://senshi.to",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://senshi.to",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.5.5",
    "pkgPath": "anime/src/en/senshi.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": false,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/senshi.js",
    "apiUrl": "",
    "dateFormat": "",
    "dateFormatLocale": "",
    "additionalParams": "",
    "sourceCodeLanguage": 1,
    "notes": "",
  },
];

// Senshi is a React SPA in front of an open JSON API on the same origin
// (no /api prefix, no auth). Anime are keyed by their MAL id, which is stable,
// so it is used as the identity everywhere: /anime/{id} and /watch/{id}/{ep}.
//
//   POST /anime/filter            catalogue, search and filters (30 per page)
//   GET  /anime/{id}              metadata
//   GET  /episodes/{id}           episode list
//   GET  /episode-embeds/{id}/{n} the versions of one episode (HardSub / Dub),
//                                 each carrying a remote_source_id
//   GET  /episode-embeds/latest-paginated
//                                 despite the name it ignores page and limit
//                                 and returns one fixed block of ~285 rows
//
// Streams live on a separate backend. remote_source_id goes to the site's player
// runtime (PLAYER_URL, window.__oct.open(id)), which runs an encrypted handshake
// with s.vidcloud.se (a server blob, an ECDH P-256 exchange, AES-GCM) and resolves
// to the master playlist URL and the subtitle tracks. The runtime is executed here,
// in the app's own JS engine, by senshiRunPlayer; the polyfills above it exist
// only because that engine has no WebAssembly or WebCrypto. The old open endpoint
// (/_v1/sources) is gone. The handshake and every CDN request behind it 403
// unless they carry Referer AND Origin of https://senshi.to (Referer alone is not
// enough) and a browser User-Agent.
//
// PLAYBACK. Every playlist on that CDN is AES-256-GCM encrypted ("EM3U8v1:" +
// base64(iv | ciphertext | tag)), decrypted by the site's own JS player. libmpv
// cannot, and the app offers no way to hand it a playlist built here: mpv
// cannot open data: URLs, and memory:// / ffmpeg://data: fail ffmpeg's HLS probe.
// What mpv CAN open with no server is its own edl:// format, so by default this
// decrypts the playlists itself (pure-JS AES below) and returns ONE edl:// URL per
// version that chains the segments, video and audio together, each part carrying
// the exact start timestamp mpv needs. Measured in the app's own libmpv: H.264 +
// AAC, loads instantly, A/V sync ~0, forward seeks land exactly. Segment requests
// carry the Video's headers (mpv opens EDL parts itself; the User-Agent can live in
// that header list). It plays, but it is NOT seamless, for two reasons:
//
//  1. Each part is its own demuxer, so both decoders restart at every 10 s segment
//     boundary. The CDN cuts segments on the clock, not on keyframes: 1080p segments
//     start 2-8 packets before a keyframe (a ~0.3 s freeze per boundary, about 3% of
//     viewing time), 480p segments up to 5+ seconds before one (1-7 s freezes). So
//     direct mode offers 1080p only.
//  2. The CDN ignores Range, so a segment cannot be re-read. Seeking BACK works only
//     while the target is still in the player's cache (32 MiB back buffer by default,
//     about a minute); further back lands somewhere else. Forward seeks are fine.
//
// No server, no setting, no second set of entries: everything above is what
// there is. No other server-free route exists in this libmpv either: hls+...,
// concat: and ffmpeg://data: do not open, and mpv's own playlist reader splits
// a data playlist into files.
//
// Downloads are NOT supported. Mangayomi's downloader only understands a
// single self-contained stream — never HLS's detached-audio #EXT-X-MEDIA
// track, which is how this CDN always delivers audio — and an edl:// URL
// is not something it can fetch at all (it does a plain HTTP GET on
// whatever Video.originalUrl is; the app's own download button reads that
// from this exact list, so making it work would mean a picker entry for
// it too, deliberately not done here). A proxy that decrypts and muxes
// video+audio into one real stream would fix this, but was deliberately
// left out: it would need a setting for the address and, since the
// downloader and the quality picker read the identical list, at least one
// visible picker entry — both ruled out on purpose.
//
// EDL details that matter: !delay_open (else mpv opens every part up front, ~30 s
// for an episode) requires start= on every part, otherwise it assumes PTS 0 and
// skips all but the first. Segment n starts at firstPts + sum(EXTINF[0..n-1]),
// checked exactly on six titles; audio starts at 1.400 s, video at 1.400 s plus the
// B-frame delay (1.4834 at 23.976 fps, 1.4667 at 29.97). !track_meta must NOT be
// used: it adds phantom "unknown" tracks.

// No comma anywhere in here: mpv splits http-header-fields on commas.
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";

// The site's own player runtime. It performs the encrypted handshake that
// replaced the old open sources API, so it is fetched fresh (the site rotates it
// roughly daily) and run here rather than copied.
var PLAYER_URL = "https://cdn.vidcloud.se/vjs/vendor.js";

var PAGE_SIZE = 30;

// Per-episode sub/dub lookups (see episodeBadges) are capped: beyond this many
// episodes a title falls back to an estimate rather than one request each.
var BADGE_LOOKUP_MAX = 150;
var BADGE_BATCH = 15;

// Playlist key = A XOR B, two 32-byte arrays shipped in senshi.to's WatchPage
// chunk (ir / lr). If playlists ever stop decrypting, re-read that chunk first.
var KEY_A = [
  226, 24, 149, 40, 170, 108, 184, 157, 168, 18, 90, 64, 186, 69, 66, 110,
  109, 169, 203, 138, 29, 188, 78, 25, 203, 185, 211, 252, 76, 126, 134, 42,
];
var KEY_B = [
  140, 250, 231, 59, 141, 129, 254, 6, 30, 203, 96, 249, 13, 237, 122, 106,
  60, 57, 126, 48, 152, 101, 128, 186, 122, 88, 171, 249, 187, 202, 40, 220,
];

// Where each stream's first segment starts, minus a hair. mpv would seek to
// this point if it could; landing just BEFORE the first timestamp is what keeps
// a seek from skipping to the next keyframe (video first PTS is 1.4834 at
// 23.976 fps and 1.4667 at 29.97, audio is exactly 1.4).
var EDL_VIDEO_START = 1.42;
var EDL_AUDIO_START = 1.35;

var GENRES = [
  "Action", "Adventure", "Avant Garde", "Boys Love", "Comedy", "Demons", "Drama",
  "Ecchi", "Fantasy", "Girls Love", "Gourmet", "Harem", "Horror", "Isekai",
  "Iyashikei", "Josei", "Kids", "Magic", "Mahou Shoujo", "Martial Arts", "Mecha",
  "Military", "Music", "Mystery", "Parody", "Psychological", "Reverse Harem",
  "Romance", "School", "Sci-Fi", "Seinen", "Slice of Life", "Space", "Sports",
  "Shounen", "Super Power", "Supernatural", "Suspense", "Thriller", "Vampire",
];
var TYPES = [
  ["TV", "tv"], ["Movie", "movie"], ["OVA", "ova"], ["ONA", "ona"],
  ["Special", "special"], ["Music", "music"],
];
var STATUSES = [
  ["Not Yet Aired", "not_yet_aired"], ["Releasing", "releasing"], ["Completed", "completed"],
];
var SEASONS = [
  ["Winter", "winter"], ["Spring", "spring"], ["Summer", "summer"], ["Fall", "fall"],
];
var LANGUAGES = [["Subbed", "HardSub"], ["Dubbed", "Dub"]];
var SORTS = [
  ["Best Score", "score_desc"], ["Worst Score", "score_asc"],
  ["A-Z", "name_asc"], ["Z-A", "name_desc"], ["Latest Release", "recent"],
];

// ── The site's player runtime, run in-process ───────────────────────────────
//
// The app's JS engine is bare QuickJS: no WebAssembly, WebCrypto, URL or
// TextEncoder. The site's runtime needs all of them, so the next four
// functions install minimal stand-ins on a sandbox object (never on the real
// global), and senshiRunPlayer evaluates the runtime with that object's
// properties shadowing the globals it expects.
//
//   senshiEnv     window / document / navigator / location stubs, URL,
//                 TextEncoder / TextDecoder, atob / btoa, timers
//   senshiCrypto  crypto.subtle: SHA-256, HMAC, HKDF, AES-GCM, ECDH P-256 (BigInt)
//   senshiWasm    WebAssembly.instantiate for the runtime's tiny i32-only module,
//                 translated to plain JS (the module has no imports)

function senshiEnv(g) {
  // ---- basic browser-ish globals the player runtime touches ---------------------------------
  g.window = g; g.self = g; g.top = g; g.parent = g; g.globalThis = g;
  var UAs = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";
  g.navigator = { userAgent: UAs, language: "en-US", languages: ["en-US"], platform: "Win32", webdriver: false, hardwareConcurrency: 8 };
  g.location = { href: "https://senshi.to/", origin: "https://senshi.to", hostname: "senshi.to", host: "senshi.to", protocol: "https:", pathname: "/", search: "", hash: "" };
  var noop = function(){};
  g.document = {
    currentScript: { src: "https://cdn.vidcloud.se/vjs/vendor.js", getAttribute: function(){ return null; }, dataset: {} },
    createElement: function(){ return { style: {}, getContext: function(){ return null; }, setAttribute: noop, appendChild: noop }; },
    querySelector: function(){ return null; }, querySelectorAll: function(){ return []; },
    head: { appendChild: noop }, body: { appendChild: noop }, documentElement: { style: {} },
    cookie: "", referrer: "https://senshi.to/", location: g.location, addEventListener: noop, readyState: "complete"
  };
  if (!g.performance) g.performance = { now: function(){ return Date.now(); } };

  // ---- URL / URLSearchParams (just enough) ------------------------------------------------
  function URLSearchParams_(init){ this._p = []; var self = this; if (typeof init === "string") { init.replace(/^\?/, "").split("&").forEach(function(kv){ if (!kv) return; var i = kv.indexOf("="); self._p.push([decodeURIComponent(i < 0 ? kv : kv.slice(0, i)), decodeURIComponent(i < 0 ? "" : kv.slice(i + 1))]); }); } }
  URLSearchParams_.prototype.get = function(k){ for (var i = 0; i < this._p.length; i++) if (this._p[i][0] === k) return this._p[i][1]; return null; };
  URLSearchParams_.prototype.has = function(k){ return this.get(k) !== null; };
  URLSearchParams_.prototype.append = function(k, v){ this._p.push([k, String(v)]); };
  URLSearchParams_.prototype.set = function(k, v){ var f = false; for (var i = 0; i < this._p.length; i++) if (this._p[i][0] === k) { if (!f) { this._p[i][1] = String(v); f = true; } else { this._p.splice(i--, 1); } } if (!f) this.append(k, v); };
  URLSearchParams_.prototype.toString = function(){ return this._p.map(function(kv){ return encodeURIComponent(kv[0]) + "=" + encodeURIComponent(kv[1]); }).join("&"); };
  function URL_(href, base){
    href = String(href);
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) {
      var b = new URL_(base || g.location.href);
      if (href.charAt(0) === "/") href = b.origin + href;
      else href = b.origin + b.pathname.replace(/[^\/]*$/, "") + href;
    }
    var m = href.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:)\/\/([^\/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/);
    if (!m) throw new TypeError("Invalid URL: " + href);
    this.protocol = m[1]; this.host = m[2]; this.hostname = m[2].replace(/:\d+$/, ""); this.port = (m[2].match(/:(\d+)$/) || [])[1] || "";
    this.pathname = m[3] || "/"; this.search = m[4] || ""; this.hash = m[5] || ""; this.origin = this.protocol + "//" + this.host;
    this.searchParams = new URLSearchParams_(this.search); this.href = this.origin + this.pathname + this.search + this.hash;
  }
  URL_.prototype.toString = function(){ return this.href; };
  g.URL = URL_; g.URLSearchParams = URLSearchParams_;

  // ---- TextEncoder / TextDecoder (UTF-8) ---------------------------------------------------
  g.TextEncoder = function(){ };
  g.TextEncoder.prototype.encode = function(s){ s = String(s === undefined ? "" : s); var o = []; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) { var d = s.charCodeAt(i + 1); if (d >= 0xdc00 && d < 0xe000) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; } } if (c < 0x80) o.push(c); else if (c < 0x800) o.push(0xc0 | (c >> 6), 0x80 | (c & 63)); else if (c < 0x10000) o.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); else o.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); } return new Uint8Array(o); };
  g.TextDecoder = function(){ };
  g.TextDecoder.prototype.decode = function(b){ if (!b) return ""; var u = b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength); var s = "", i = 0; while (i < u.length) { var c = u[i++]; if (c < 0x80) s += String.fromCharCode(c); else if (c < 0xe0) s += String.fromCharCode(((c & 31) << 6) | (u[i++] & 63)); else if (c < 0xf0) { var c2 = u[i++], c3 = u[i++]; s += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63)); } else { var a = u[i++], b2 = u[i++], d = u[i++]; var cp = (((c & 7) << 18) | ((a & 63) << 12) | ((b2 & 63) << 6) | (d & 63)) - 0x10000; s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023)); } } return s; };

  // ---- atob / btoa -----------------------------------------------------------------------------
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  g.btoa = function(s){ s = String(s); var o = "", i = 0; while (i < s.length) { var a = s.charCodeAt(i++), b = s.charCodeAt(i++), c = s.charCodeAt(i++); o += B64[a >> 2] + B64[((a & 3) << 4) | ((b || 0) >> 4)] + (isNaN(b) ? "=" : B64[((b & 15) << 2) | ((c || 0) >> 6)]) + (isNaN(c) ? "=" : B64[c & 63]); } return o; };
  g.atob = function(s){ s = String(s).replace(/[^A-Za-z0-9+\/]/g, ""); var o = "", acc = 0, bits = 0; for (var i = 0; i < s.length; i++) { acc = (acc << 6) | B64.indexOf(s[i]); bits += 6; if (bits >= 8) { bits -= 8; o += String.fromCharCode((acc >> bits) & 255); acc &= (1 << bits) - 1; } } return o; };

  // ---- timers: the runtime may use them; run on microtask order, delay ignored ----------------
  var tid = 1; g.setTimeout = function(fn){ var id = tid++; var args = Array.prototype.slice.call(arguments, 2); Promise.resolve().then(function(){ if (!g.__cleared || !g.__cleared[id]) fn.apply(null, args); }); return id; };
  g.clearTimeout = function(id){ (g.__cleared = g.__cleared || {})[id] = 1; }; g.setInterval = function(){ return tid++; }; g.clearInterval = noop;
  g.queueMicrotask = g.queueMicrotask || function(fn){ Promise.resolve().then(fn); };
}

// Pure-JS crypto.subtle for engines without WebCrypto: SHA-256, HMAC, HKDF, AES-GCM, ECDH P-256.
function senshiCrypto(g) {
  function u8(x) {
    if (x instanceof Uint8Array) return x;
    if (x instanceof ArrayBuffer) return new Uint8Array(x);
    if (x && x.buffer) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    throw new TypeError("BufferSource expected");
  }
  function ab(bytes) { var o = new Uint8Array(bytes.length); o.set(bytes); return o.buffer; }
  function cat() { var n = 0, i; for (i = 0; i < arguments.length; i++) n += arguments[i].length; var o = new Uint8Array(n), p = 0; for (i = 0; i < arguments.length; i++) { o.set(arguments[i], p); p += arguments[i].length; } return o; }

  // ---- SHA-256 / HMAC / HKDF -----------------------------------------------------------------
  var K256 = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
  function sha256(data) {
    var m = u8(data), n = m.length, padn = ((n + 9 + 63) >> 6) << 6, buf = new Uint8Array(padn);
    buf.set(m); buf[n] = 0x80;
    var bits = n * 8; buf[padn - 4] = (bits >>> 24) & 255; buf[padn - 3] = (bits >>> 16) & 255; buf[padn - 2] = (bits >>> 8) & 255; buf[padn - 1] = bits & 255;
    buf[padn - 8] = Math.floor(n / 536870912) & 255;
    var H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]), W = new Uint32Array(64);
    for (var off = 0; off < padn; off += 64) {
      var i;
      for (i = 0; i < 16; i++) W[i] = (buf[off + 4 * i] << 24) | (buf[off + 4 * i + 1] << 16) | (buf[off + 4 * i + 2] << 8) | buf[off + 4 * i + 3];
      for (i = 16; i < 64; i++) {
        var a = W[i - 15], b = W[i - 2];
        var s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
        var s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      var A = H[0], B = H[1], C = H[2], D = H[3], E = H[4], F = H[5], G = H[6], Hh = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = ((E >>> 6) | (E << 26)) ^ ((E >>> 11) | (E << 21)) ^ ((E >>> 25) | (E << 7));
        var ch = (E & F) ^ (~E & G);
        var t1 = (Hh + S1 + ch + K256[i] + W[i]) | 0;
        var S0 = ((A >>> 2) | (A << 30)) ^ ((A >>> 13) | (A << 19)) ^ ((A >>> 22) | (A << 10));
        var mj = (A & B) ^ (A & C) ^ (B & C);
        var t2 = (S0 + mj) | 0;
        Hh = G; G = F; F = E; E = (D + t1) | 0; D = C; C = B; B = A; A = (t1 + t2) | 0;
      }
      H[0] += A; H[1] += B; H[2] += C; H[3] += D; H[4] += E; H[5] += F; H[6] += G; H[7] += Hh;
    }
    var out = new Uint8Array(32);
    for (i = 0; i < 8; i++) { out[4 * i] = H[i] >>> 24; out[4 * i + 1] = (H[i] >>> 16) & 255; out[4 * i + 2] = (H[i] >>> 8) & 255; out[4 * i + 3] = H[i] & 255; }
    return out;
  }
  function hmac(key, data) {
    key = u8(key); if (key.length > 64) key = sha256(key);
    var ip = new Uint8Array(64), op = new Uint8Array(64), i;
    for (i = 0; i < 64; i++) { var k = i < key.length ? key[i] : 0; ip[i] = k ^ 0x36; op[i] = k ^ 0x5c; }
    return sha256(cat(op, sha256(cat(ip, u8(data)))));
  }
  function hkdf(ikm, salt, info, len) {
    salt = salt && u8(salt).length ? u8(salt) : new Uint8Array(32);
    var prk = hmac(salt, ikm), out = new Uint8Array(0), t = new Uint8Array(0), i = 1;
    info = u8(info);
    while (out.length < len) { t = hmac(prk, cat(t, info, new Uint8Array([i++]))); out = cat(out, t); }
    return out.subarray(0, len);
  }

  // ---- AES + GCM -----------------------------------------------------------------------------
  var AES = null;
  function aesTables() {
    if (AES) return AES;
    var sbox = new Uint8Array(256), p = 1, q = 1;
    do {
      p = (p ^ (p << 1) ^ (p & 0x80 ? 0x1b : 0)) & 0xff;
      q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff; if (q & 0x80) q ^= 0x09;
      var x = (q ^ ((q << 1) | (q >>> 7)) ^ ((q << 2) | (q >>> 6)) ^ ((q << 3) | (q >>> 5)) ^ ((q << 4) | (q >>> 4))) & 0xff;
      sbox[p] = x ^ 0x63;
    } while (p !== 1);
    sbox[0] = 0x63;
    var T = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    for (var i = 0; i < 256; i++) {
      var sv = sbox[i], s2 = ((sv << 1) ^ (sv & 0x80 ? 0x1b : 0)) & 0xff, s3 = s2 ^ sv;
      T[0][i] = ((s2 << 24) | (sv << 16) | (sv << 8) | s3) >>> 0; T[1][i] = ((s3 << 24) | (s2 << 16) | (sv << 8) | sv) >>> 0;
      T[2][i] = ((sv << 24) | (s3 << 16) | (s2 << 8) | sv) >>> 0; T[3][i] = ((sv << 24) | (sv << 16) | (s3 << 8) | s2) >>> 0;
    }
    return (AES = { sbox: sbox, T: T });
  }
  function aesKey(key) {
    var t = aesTables(), sb = t.sbox, nk = key.length / 4, rounds = nk + 6, rk = new Uint32Array(4 * (rounds + 1)), k, rcon = 1;
    for (k = 0; k < nk; k++) rk[k] = ((key[4 * k] << 24) | (key[4 * k + 1] << 16) | (key[4 * k + 2] << 8) | key[4 * k + 3]) >>> 0;
    function sub(w) { return ((sb[w >>> 24] << 24) | (sb[(w >>> 16) & 255] << 16) | (sb[(w >>> 8) & 255] << 8) | sb[w & 255]) >>> 0; }
    for (k = nk; k < rk.length; k++) {
      var w = rk[k - 1];
      if (k % nk === 0) { w = sub(((w << 8) | (w >>> 24)) >>> 0); w = (w ^ (rcon << 24)) >>> 0; rcon = ((rcon << 1) ^ (rcon & 0x80 ? 0x1b : 0)) & 0xff; }
      else if (nk > 6 && k % nk === 4) w = sub(w);
      rk[k] = (rk[k - nk] ^ w) >>> 0;
    }
    return { rk: rk, rounds: rounds, sb: sb, T: t.T };
  }
  function aesBlock(a, s0, s1, s2, s3, out) {
    var T0 = a.T[0], T1 = a.T[1], T2 = a.T[2], T3 = a.T[3], sb = a.sb, rk = a.rk, t0, t1, t2, t3, r = 4;
    s0 ^= rk[0]; s1 ^= rk[1]; s2 ^= rk[2]; s3 ^= rk[3];
    for (var round = 1; round < a.rounds; round++) {
      t0 = T0[s0 >>> 24] ^ T1[(s1 >>> 16) & 255] ^ T2[(s2 >>> 8) & 255] ^ T3[s3 & 255] ^ rk[r];
      t1 = T0[s1 >>> 24] ^ T1[(s2 >>> 16) & 255] ^ T2[(s3 >>> 8) & 255] ^ T3[s0 & 255] ^ rk[r + 1];
      t2 = T0[s2 >>> 24] ^ T1[(s3 >>> 16) & 255] ^ T2[(s0 >>> 8) & 255] ^ T3[s1 & 255] ^ rk[r + 2];
      t3 = T0[s3 >>> 24] ^ T1[(s0 >>> 16) & 255] ^ T2[(s1 >>> 8) & 255] ^ T3[s2 & 255] ^ rk[r + 3];
      s0 = t0; s1 = t1; s2 = t2; s3 = t3; r += 4;
    }
    out[0] = ((sb[s0 >>> 24] << 24) | (sb[(s1 >>> 16) & 255] << 16) | (sb[(s2 >>> 8) & 255] << 8) | sb[s3 & 255]) ^ rk[r];
    out[1] = ((sb[s1 >>> 24] << 24) | (sb[(s2 >>> 16) & 255] << 16) | (sb[(s3 >>> 8) & 255] << 8) | sb[s0 & 255]) ^ rk[r + 1];
    out[2] = ((sb[s2 >>> 24] << 24) | (sb[(s3 >>> 16) & 255] << 16) | (sb[(s0 >>> 8) & 255] << 8) | sb[s1 & 255]) ^ rk[r + 2];
    out[3] = ((sb[s3 >>> 24] << 24) | (sb[(s0 >>> 16) & 255] << 16) | (sb[(s1 >>> 8) & 255] << 8) | sb[s2 & 255]) ^ rk[r + 3];
  }
  function ghash(h, aad, ct) {
    // h: 4 big-endian words. Bitwise GF(2^128) multiply; inputs are small.
    var y0 = 0, y1 = 0, y2 = 0, y3 = 0;
    function block(b, o, n) {
      var w0 = 0, w1 = 0, w2 = 0, w3 = 0, i, v;
      var t = new Uint8Array(16); for (i = 0; i < n; i++) t[i] = b[o + i];
      w0 = (t[0] << 24) | (t[1] << 16) | (t[2] << 8) | t[3]; w1 = (t[4] << 24) | (t[5] << 16) | (t[6] << 8) | t[7];
      w2 = (t[8] << 24) | (t[9] << 16) | (t[10] << 8) | t[11]; w3 = (t[12] << 24) | (t[13] << 16) | (t[14] << 8) | t[15];
      mul(y0 ^ w0, y1 ^ w1, y2 ^ w2, y3 ^ w3);
    }
    function mul(x0, x1, x2, x3) {
      var z0 = 0, z1 = 0, z2 = 0, z3 = 0, v0 = h[0], v1 = h[1], v2 = h[2], v3 = h[3], xs = [x0, x1, x2, x3];
      for (var i = 0; i < 128; i++) {
        if ((xs[i >> 5] >>> (31 - (i & 31))) & 1) { z0 ^= v0; z1 ^= v1; z2 ^= v2; z3 ^= v3; }
        var lsb = v3 & 1;
        v3 = (v3 >>> 1) | (v2 << 31); v2 = (v2 >>> 1) | (v1 << 31); v1 = (v1 >>> 1) | (v0 << 31); v0 = v0 >>> 1;
        if (lsb) v0 ^= 0xe1000000;
      }
      y0 = z0; y1 = z1; y2 = z2; y3 = z3;
    }
    var i;
    for (i = 0; i < aad.length; i += 16) block(aad, i, Math.min(16, aad.length - i));
    for (i = 0; i < ct.length; i += 16) block(ct, i, Math.min(16, ct.length - i));
    mul(y0 ^ 0, y1 ^ (aad.length * 8), y2 ^ 0, y3 ^ (ct.length * 8));
    return [y0 | 0, y1 | 0, y2 | 0, y3 | 0];
  }
  function gcm(keyBytes, iv, aad, data, decrypt, tagLen) {
    var a = aesKey(keyBytes), ks = new Uint32Array(4), i, j;
    aad = aad ? u8(aad) : new Uint8Array(0); iv = u8(iv); tagLen = tagLen || 16;
    aesBlock(a, 0, 0, 0, 0, ks);
    var h = [ks[0] | 0, ks[1] | 0, ks[2] | 0, ks[3] | 0], j0;
    if (iv.length === 12) {
      j0 = [((iv[0] << 24) | (iv[1] << 16) | (iv[2] << 8) | iv[3]) | 0, ((iv[4] << 24) | (iv[5] << 16) | (iv[6] << 8) | iv[7]) | 0, ((iv[8] << 24) | (iv[9] << 16) | (iv[10] << 8) | iv[11]) | 0, 1];
    } else throw new Error("only 96-bit GCM IVs supported");
    var body = data, ctBytes, tagIn = null;
    if (decrypt) { tagIn = data.subarray(data.length - tagLen); body = data.subarray(0, data.length - tagLen); }
    var out = new Uint8Array(body.length), ctr = (j0[3] + 1) >>> 0;
    for (i = 0; i < body.length; i += 16) {
      aesBlock(a, j0[0], j0[1], j0[2], ctr, ks); ctr = (ctr + 1) >>> 0;
      var m = Math.min(16, body.length - i);
      for (j = 0; j < m; j++) out[i + j] = body[i + j] ^ ((ks[j >> 2] >>> (24 - 8 * (j & 3))) & 255);
    }
    ctBytes = decrypt ? body : out;
    var gh = ghash(h, aad, ctBytes), tk = new Uint32Array(4);
    aesBlock(a, j0[0], j0[1], j0[2], j0[3], tk);
    var tag = new Uint8Array(16);
    for (i = 0; i < 4; i++) { var w = (gh[i] ^ tk[i]) >>> 0; tag[4 * i] = w >>> 24; tag[4 * i + 1] = (w >>> 16) & 255; tag[4 * i + 2] = (w >>> 8) & 255; tag[4 * i + 3] = w & 255; }
    if (decrypt) {
      var bad = 0; for (i = 0; i < tagLen; i++) bad |= tag[i] ^ tagIn[i];
      if (bad) throw new Error("OperationError");
      return out;
    }
    return cat(out, tag.subarray(0, tagLen));
  }

  // ---- P-256 ----------------------------------------------------------------------------------
  var P = BigInt("0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff");
  var N = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
  var GX = BigInt("0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296");
  var GY = BigInt("0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5");
  function md(a) { a %= P; return a < 0n ? a + P : a; }
  function inv(a) { var r = md(a), e = P - 2n, res = 1n; while (e > 0n) { if (e & 1n) res = res * r % P; r = r * r % P; e >>= 1n; } return res; }
  function dbl(pt) {
    if (!pt) return null; var X = pt[0], Y = pt[1], Z = pt[2];
    if (Y === 0n) return null;
    var d = Z * Z % P, gm = Y * Y % P, bt = X * gm % P, al = 3n * ((X - d) % P) * ((X + d) % P) % P;
    var X3 = md(al * al - 8n * bt), Z3 = md((Y + Z) * (Y + Z) - gm - d);
    return [X3, md(al * (4n * bt - X3) - 8n * gm * gm), Z3];
  }
  function add(p1, p2) {
    if (!p1) return p2; if (!p2) return p1;
    var Z1Z1 = p1[2] * p1[2] % P, Z2Z2 = p2[2] * p2[2] % P;
    var U1 = p1[0] * Z2Z2 % P, U2 = p2[0] * Z1Z1 % P, S1 = p1[1] * p2[2] % P * Z2Z2 % P, S2 = p2[1] * p1[2] % P * Z1Z1 % P;
    var H = md(U2 - U1), R = md(S2 - S1);
    if (H === 0n) return R === 0n ? dbl(p1) : null;
    var HH = H * H % P, HHH = H * HH % P, V = U1 * HH % P, X3 = md(R * R - HHH - 2n * V);
    return [X3, md(R * (V - X3) - S1 * HHH), p1[2] * p2[2] % P * H % P];
  }
  function mulPt(k, x, y) {
    var acc = null, pt = [x, y, 1n];
    for (var i = k.toString(2).length - 1; i >= 0; i--) { acc = dbl(acc); if ((k >> BigInt(i)) & 1n) acc = add(acc, pt); }
    if (!acc) throw new Error("point at infinity");
    var zi = inv(acc[2]), zi2 = zi * zi % P;
    return [md(acc[0] * zi2), md(acc[1] * zi2 % P * zi)];
  }
  function bytesToBig(b) { var s = "0x"; for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16); return BigInt(s); }
  function bigToBytes(n, len) { var h = n.toString(16); while (h.length < len * 2) h = "0" + h; var o = new Uint8Array(len); for (var i = 0; i < len; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o; }
  var nativeRV = g.crypto && typeof g.crypto.getRandomValues === "function" ? g.crypto.getRandomValues.bind(g.crypto) : null;
  function randBytes(n) {
    var o = new Uint8Array(n);
    if (nativeRV) return nativeRV(o);
    for (var i = 0; i < n; i++) o[i] = Math.floor(Math.random() * 256);
    return o;
  }
  function b64url(b) { return g.btoa(String.fromCharCode.apply(null, b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function unb64url(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; var r = g.atob(s), o = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) o[i] = r.charCodeAt(i); return o; }

  // ---- CryptoKey-ish + SubtleCrypto -----------------------------------------------------------
  function algName(a) { return (typeof a === "string" ? a : a && a.name || "").toUpperCase(); }
  function mkKey(type, algorithm, extractable, usages, data) { return { type: type, algorithm: algorithm, extractable: !!extractable, usages: usages || [], _d: data }; }
  function hashOf(a) { var h = a && a.hash; return algName(h); }
  var subtle = {
    digest: function (alg, data) { return Promise.resolve().then(function () { if (algName(alg) !== "SHA-256") throw new Error("NotSupported: " + algName(alg)); return ab(sha256(data)); }); },
    generateKey: function (alg, ext, usages) {
      return Promise.resolve().then(function () {
        if (algName(alg) === "ECDH") {
          var d; do { d = bytesToBig(randBytes(32)) % N; } while (d === 0n);
          var pt = mulPt(d, GX, GY);
          var al = { name: "ECDH", namedCurve: "P-256" };
          return { publicKey: mkKey("public", al, true, [], pt), privateKey: mkKey("private", al, ext, usages, { d: d, pub: pt }) };
        }
        if (algName(alg) === "AES-GCM") return mkKey("secret", { name: "AES-GCM", length: alg.length }, ext, usages, randBytes(alg.length / 8));
        throw new Error("NotSupported generateKey " + algName(alg));
      });
    },
    importKey: function (fmt, data, alg, ext, usages) {
      return Promise.resolve().then(function () {
        var n = algName(alg);
        if (n === "ECDH") {
          var pt;
          if (fmt === "raw") { var r = u8(data); if (r.length !== 65 || r[0] !== 4) throw new Error("DataError"); pt = [bytesToBig(r.subarray(1, 33)), bytesToBig(r.subarray(33, 65))]; }
          else if (fmt === "jwk") { pt = [bytesToBig(unb64url(data.x)), bytesToBig(unb64url(data.y))]; if (data.d) { var dd = bytesToBig(unb64url(data.d)); return mkKey("private", { name: "ECDH", namedCurve: "P-256" }, ext, usages, { d: dd, pub: pt }); } }
          else throw new Error("NotSupported importKey " + fmt);
          if (md(pt[1] * pt[1]) !== md(pt[0] * pt[0] * pt[0] - 3n * pt[0] + BigInt("0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b"))) throw new Error("DataError: point not on curve");
          return mkKey("public", { name: "ECDH", namedCurve: "P-256" }, true, [], pt);
        }
        if (n === "HKDF" || n === "PBKDF2") return mkKey("secret", { name: n }, false, usages, new Uint8Array(u8(data)));
        if (n === "HMAC") return mkKey("secret", { name: "HMAC", hash: { name: hashOf(alg) } }, ext, usages, new Uint8Array(u8(data)));
        if (n === "AES-GCM" || n === "AES-CBC" || n === "AES-CTR") { if (fmt === "jwk") data = unb64url(data.k); return mkKey("secret", { name: n, length: u8(data).length * 8 }, ext, usages, new Uint8Array(u8(data))); }
        throw new Error("NotSupported importKey " + n);
      });
    },
    exportKey: function (fmt, key) {
      return Promise.resolve().then(function () {
        if (!key.extractable && key.type !== "public") throw new Error("InvalidAccessError");
        if (key.algorithm.name === "ECDH") {
          var pt = key.type === "public" ? key._d : key._d.pub;
          if (fmt === "raw") return ab(cat(new Uint8Array([4]), bigToBytes(pt[0], 32), bigToBytes(pt[1], 32)));
          if (fmt === "jwk") { var j = { kty: "EC", crv: "P-256", x: b64url(bigToBytes(pt[0], 32)), y: b64url(bigToBytes(pt[1], 32)), ext: true, key_ops: key.usages }; if (key.type === "private") j.d = b64url(bigToBytes(key._d.d, 32)); return j; }
        }
        if (fmt === "raw" && key.type === "secret") return ab(key._d);
        if (fmt === "jwk" && key.type === "secret") return { kty: "oct", k: b64url(key._d), alg: key.algorithm.name === "AES-GCM" ? "A" + key._d.length * 8 + "GCM" : undefined, ext: true, key_ops: key.usages };
        throw new Error("NotSupported exportKey " + fmt);
      });
    },
    deriveBits: function (alg, base, length) {
      return Promise.resolve().then(function () {
        var n = algName(alg);
        if (n === "ECDH") { var pub = alg.public._d, sh = mulPt(base._d.d, pub[0], pub[1]); var x = bigToBytes(sh[0], 32); return ab(length ? x.subarray(0, length >> 3) : x); }
        if (n === "HKDF") { if (hashOf(alg) !== "SHA-256") throw new Error("NotSupported hash " + hashOf(alg)); return ab(hkdf(base._d, alg.salt ? u8(alg.salt) : null, alg.info ? u8(alg.info) : new Uint8Array(0), length >> 3)); }
        throw new Error("NotSupported deriveBits " + n);
      });
    },
    deriveKey: function (alg, base, derived, ext, usages) {
      var self = this;
      return Promise.resolve().then(function () {
        var dn = algName(derived), bits = dn === "HMAC" ? (derived.length || 256) : derived.length;
        return self.deriveBits(alg, base, bits).then(function (raw) { return self.importKey("raw", raw, derived, ext, usages); });
      });
    },
    encrypt: function (alg, key, data) {
      return Promise.resolve().then(function () { if (algName(alg) !== "AES-GCM") throw new Error("NotSupported encrypt " + algName(alg)); return ab(gcm(key._d, alg.iv, alg.additionalData, u8(data), false, (alg.tagLength || 128) >> 3)); });
    },
    decrypt: function (alg, key, data) {
      return Promise.resolve().then(function () { if (algName(alg) !== "AES-GCM") throw new Error("NotSupported decrypt " + algName(alg)); return ab(gcm(key._d, alg.iv, alg.additionalData, u8(data), true, (alg.tagLength || 128) >> 3)); });
    },
    sign: function (alg, key, data) { return Promise.resolve().then(function () { if (algName(alg) !== "HMAC") throw new Error("NotSupported sign"); return ab(hmac(key._d, data)); }); },
    verify: function (alg, key, sig, data) { return Promise.resolve().then(function () { var m = hmac(key._d, data), s = u8(sig), d = m.length === s.length ? 0 : 1; for (var i = 0; i < m.length; i++) d |= m[i] ^ (s[i] || 0); return d === 0; }); }
  };
  var cr = g.crypto || {};
  cr.subtle = subtle;
  if (!cr.getRandomValues) cr.getRandomValues = function (a) { var b = randBytes(a.byteLength); new Uint8Array(a.buffer, a.byteOffset, a.byteLength).set(b); return a; };
  if (!cr.randomUUID) cr.randomUUID = function () { var b = randBytes(16); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128; var h = ""; for (var i = 0; i < 16; i++) h += (b[i] < 16 ? "0" : "") + b[i].toString(16); return h.substr(0, 8) + "-" + h.substr(8, 4) + "-" + h.substr(12, 4) + "-" + h.substr(16, 4) + "-" + h.substr(20); };
  g.crypto = cr;
  g.__cryptoPoly = { sha256: sha256, hmac: hmac, hkdf: hkdf, gcm: gcm };
}

// Minimal WebAssembly stand-in for engines without WebAssembly: translates a module that uses only
function senshiWasm(g) {
  function compile(b) {
    var p = 8, i, j, secs = {};
    function u32() { var r = 0, s = 0, x; do { x = b[p++]; r |= (x & 127) << s; s += 7; } while (x & 128); return r >>> 0; }
    function s32() { var r = 0, s = 0, x; do { x = b[p++]; r |= (x & 127) << s; s += 7; } while (x & 128); if (s < 32 && (x & 64)) r |= -(1 << s); return r | 0; }
    function str(n) { var o = ""; for (var k = 0; k < n; k++) o += String.fromCharCode(b[p++]); return o; }
    while (p < b.length) { var id = b[p++]; var len = u32(); secs[id] = [p, len]; p += len; }

    // types
    var types = [];
    p = secs[1][0]; var nt = u32();
    for (i = 0; i < nt; i++) { p++; var np = u32(); p += np; var nr = u32(); p += nr; types.push({ params: np, results: nr }); }
    // functions
    var funcType = [];
    p = secs[3][0]; var nf = u32();
    for (i = 0; i < nf; i++) funcType.push(u32());
    // memory
    var pages = 1;
    if (secs[5]) { p = secs[5][0]; u32(); var fl = u32(); pages = u32(); }
    // globals
    var globalInit = [];
    if (secs[6]) {
      p = secs[6][0]; var ng = u32();
      for (i = 0; i < ng; i++) { p += 2; var op = b[p++]; var v = s32(); p++; globalInit.push(v); }
    }
    // exports
    var exportsFn = {};
    p = secs[7][0]; var ne = u32();
    for (i = 0; i < ne; i++) { var nl = u32(); var nm = str(nl); var kind = b[p++]; var idx = u32(); if (kind === 0) exportsFn[nm] = idx; }

    // code
    p = secs[10][0]; var ncode = u32(); var src = [];
    for (var fi = 0; fi < ncode; fi++) {
      var sz = u32(); var end = p + sz; var ty = types[funcType[fi]];
      var nlocalGroups = u32(), nlocals = 0;
      for (i = 0; i < nlocalGroups; i++) { nlocals += u32(); p++; }
      var sp = 0, maxsp = 0, labelN = 0;
      var out = [];
      var ctl = [{ kind: "func", label: "F", base: 0, arity: ty.results }];
      var dead = 0, deadNest = 0;
      function S(n) { return "s" + n; }
      function push(expr) { out.push(S(sp) + "=" + expr + ";"); sp++; if (sp > maxsp) maxsp = sp; }
      function pop() { sp--; return S(sp); }
      function skipImm(op) {
        if (op === 0x0c || op === 0x0d || op === 0x10) u32();
        else if (op === 0x0e) { var c = u32(); for (var k = 0; k <= c; k++) u32(); }
        else if (op >= 0x20 && op <= 0x24) u32();
        else if (op >= 0x28 && op <= 0x3e) { u32(); u32(); }
        else if (op === 0x3f || op === 0x40) p++;
        else if (op === 0x41) s32();
        else if (op === 0x42) { while (b[p++] & 128); }
        else if (op === 0x43) p += 4; else if (op === 0x44) p += 8;
      }
      function branch(depth) {
        var t = ctl[ctl.length - 1 - depth], code = "";
        if (t.kind === "loop") return "continue " + t.label + ";";
        if (t.kind === "func") return "return" + (t.arity ? " " + S(sp - 1) : "") + ";";
        if (t.arity) code += S(t.base) + "=" + S(sp - 1) + ";";
        return code + "break " + t.label + ";";
      }
      var bin = {
        0x46: "(a===b)|0", 0x47: "(a!==b)|0", 0x48: "(a<b)|0", 0x49: "((a>>>0)<(b>>>0))|0", 0x4a: "(a>b)|0", 0x4b: "((a>>>0)>(b>>>0))|0",
        0x4c: "(a<=b)|0", 0x4d: "((a>>>0)<=(b>>>0))|0", 0x4e: "(a>=b)|0", 0x4f: "((a>>>0)>=(b>>>0))|0",
        0x6a: "(a+b)|0", 0x6b: "(a-b)|0", 0x6c: "Math.imul(a,b)", 0x6d: "(a/b)|0", 0x6e: "Math.floor((a>>>0)/(b>>>0))|0",
        0x6f: "(a%b)|0", 0x70: "((a>>>0)%(b>>>0))|0", 0x71: "a&b", 0x72: "a|b", 0x73: "a^b", 0x74: "a<<b", 0x75: "a>>b", 0x76: "(a>>>b)|0",
        0x77: "((a<<(b&31))|(a>>>((32-(b&31))&31)))|0", 0x78: "((a>>>(b&31))|(a<<((32-(b&31))&31)))|0"
      };
      while (p < end) {
        var op = b[p++];
        if (dead) {
          if (op === 0x02 || op === 0x03 || op === 0x04) { p++; deadNest++; continue; }
          if (op === 0x05 && deadNest === 0) { /* fallthrough to normal else handling */ }
          else if (op === 0x0b) { if (deadNest > 0) { deadNest--; continue; } }
          else { skipImm(op); continue; }
        }
        if (op === 0x02 || op === 0x03 || op === 0x04) {
          var bt = b[p++]; var ar = bt === 0x40 ? 0 : 1; var lab = "L" + (labelN++);
          if (op === 0x04) {
            var c = pop();
            ctl.push({ kind: "if", label: lab, base: sp, arity: ar, hasElse: false });
            out.push(lab + ":{if(" + c + "!==0){");
          } else if (op === 0x03) {
            ctl.push({ kind: "loop", label: lab, base: sp, arity: ar });
            out.push(lab + ":while(true){");
          } else {
            ctl.push({ kind: "block", label: lab, base: sp, arity: ar });
            out.push(lab + ":{");
          }
          continue;
        }
        if (op === 0x05) {
          var t5 = ctl[ctl.length - 1]; t5.hasElse = true; dead = 0; deadNest = 0; sp = t5.base;
          out.push("}else{"); continue;
        }
        if (op === 0x0b) {
          var t = ctl.pop();
          if (t.kind === "func") { if (!dead) out.push(t.arity ? "return " + S(sp - 1) + ";" : ""); break; }
          if (t.kind === "loop") out.push("break " + t.label + ";}");
          else if (t.kind === "if") out.push("}}");
          else out.push("}");
          dead = 0; deadNest = 0; sp = t.base + t.arity; if (sp > maxsp) maxsp = sp;
          continue;
        }
        switch (op) {
          case 0x00: out.push('throw new Error("unreachable");'); dead = 1; break;
          case 0x01: break;
          case 0x0c: out.push(branch(u32())); dead = 1; break;
          case 0x0d: { var c2 = pop(); out.push("if(" + c2 + "!==0){" + branch(u32()) + "}"); break; }
          case 0x0e: {
            var cnt = u32(); var cv = pop(); var parts = ["switch(" + cv + "){"];
            for (j = 0; j < cnt; j++) parts.push("case " + j + ":{" + branch(u32()) + "}");
            parts.push("default:{" + branch(u32()) + "}}"); out.push(parts.join("")); dead = 1; break;
          }
          case 0x0f: out.push(ty.results ? "return " + S(sp - 1) + ";" : "return;"); dead = 1; break;
          case 0x10: {
            var ci = u32(); var cty = types[funcType[ci]]; var args = [];
            for (j = 0; j < cty.params; j++) args.unshift(pop());
            var call = "f" + ci + "(" + args.join(",") + ")";
            if (cty.results) push(call); else out.push(call + ";"); break;
          }
          case 0x1a: sp--; break;
          case 0x1b: { var sc = pop(), sb = pop(), sa = pop(); push("(" + sc + "!==0?" + sa + ":" + sb + ")"); break; }
          case 0x20: { var li = u32(); push(li < ty.params ? "p" + li : "l" + li); break; }
          case 0x21: { var li2 = u32(); out.push((li2 < ty.params ? "p" : "l") + li2 + "=" + pop() + ";"); break; }
          case 0x22: { var li3 = u32(); out.push((li3 < ty.params ? "p" : "l") + li3 + "=" + S(sp - 1) + ";"); break; }
          case 0x23: push("G[" + u32() + "]"); break;
          case 0x24: out.push("G[" + u32() + "]=" + pop() + ";"); break;
          case 0x28: case 0x2c: case 0x2d: case 0x2e: case 0x2f: {
            u32(); var off = u32(); var ad = pop(); var a = "((" + ad + ">>>0)+" + off + ")";
            if (op === 0x28) push("(M[" + a + "]|(M[" + a + "+1]<<8)|(M[" + a + "+2]<<16)|(M[" + a + "+3]<<24))");
            else if (op === 0x2d) push("M[" + a + "]");
            else if (op === 0x2c) push("(M[" + a + "]<<24>>24)");
            else if (op === 0x2f) push("(M[" + a + "]|(M[" + a + "+1]<<8))");
            else push("((M[" + a + "]|(M[" + a + "+1]<<8))<<16>>16)");
            break;
          }
          case 0x36: case 0x3a: case 0x3b: {
            u32(); var off2 = u32(); var val = pop(); var ad2 = pop(); var a2 = "((" + ad2 + ">>>0)+" + off2 + ")";
            out.push("M[" + a2 + "]=" + val + ";");
            if (op !== 0x3a) out.push("M[" + a2 + "+1]=" + val + ">>8;");
            if (op === 0x36) out.push("M[" + a2 + "+2]=" + val + ">>16;M[" + a2 + "+3]=" + val + ">>24;");
            break;
          }
          case 0x3f: p++; push(String(pages)); break;
          case 0x41: push(String(s32())); break;
          case 0x45: { var e = pop(); push("(" + e + "===0)|0"); break; }
          case 0x67: { var e1 = pop(); push("Math.clz32(" + e1 + ")"); break; }
          default:
            if (bin[op]) { var bb = pop(), aa = pop(); push(bin[op].replace(/\ba\b/g, "(" + aa + ")").replace(/\bb\b/g, "(" + bb + ")")); }
            else throw new Error("wasm op 0x" + op.toString(16) + " unsupported");
        }
      }
      p = end;
      var decl = [], params = [], k;
      for (k = 0; k < ty.params; k++) params.push("p" + k);
      for (k = 0; k < nlocals; k++) decl.push("l" + (ty.params + k) + "=0");
      for (k = 0; k < maxsp + 1; k++) decl.push("s" + k + "=0");
      var pre = ""; for (k = 0; k < ty.params; k++) pre += "p" + k + "|=0;";
      src.push("function f" + (fi + 0) + "(" + params.join(",") + "){" + pre + (decl.length ? "var " + decl.join(",") + ";" : "") + "F:{" + out.join("\n") + "}}");
    }
    // data segments
    var mem = new Uint8Array(pages * 65536);
    if (secs[11]) {
      p = secs[11][0]; var nd = u32();
      for (i = 0; i < nd; i++) {
        var flag = u32(); var off0 = 0;
        if (flag === 0) { p++; off0 = s32(); p++; }
        var dl = u32(); for (j = 0; j < dl; j++) mem[off0 + j] = b[p++];
      }
    }
    var names = [], vals = [];
    for (var nme in exportsFn) { names.push(nme); }
    var body = "var M=mem,G=gl;\n" + src.join("\n") + "\nreturn {" + names.map(function (n) { return JSON.stringify(n) + ":f" + exportsFn[n]; }).join(",") + "};";
    var fnsObj = new Function("mem", "gl", body)(mem, globalInit.slice());
    var exportsObj = { memory: { buffer: mem.buffer } };
    for (var n2 in fnsObj) exportsObj[n2] = fnsObj[n2];
    return { exports: exportsObj, _src: body };
  }
  g.WebAssembly = {
    instantiate: function (b) {
      try {
        var u = b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
        return Promise.resolve({ instance: compile(u), module: {} });
      } catch (e) { return Promise.reject(e); }
    }
  };
}

// Evaluates the runtime's source with every property of g standing in for the
// global of the same name (window, document, crypto, fetch, WebAssembly ...).
function senshiRunPlayer(code, g) {
  var names = Object.keys(g), vals = [], i;
  for (i = 0; i < names.length; i++) vals.push(g[names[i]]);
  names.push(code);
  Function.apply(null, names).apply(g, vals);
}

// A response as the runtime's fetch() sees it. The app's Client hands bodies
// back as strings; for the PNG-typed replies used here that is Latin-1, one
// char per byte, which this turns back into bytes.
function senshiResponse(status, body, headers, g) {
  var str = String(body || ""), bytes = new Uint8Array(str.length), i;
  for (i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 255;
  var hdrs = headers || {};
  return {
    status: status,
    ok: status >= 200 && status < 300,
    headers: {
      get: function (k) {
        var want = String(k).toLowerCase();
        for (var name in hdrs) if (String(name).toLowerCase() === want) return String(hdrs[name]);
        return null;
      },
    },
    arrayBuffer: function () { var o = new Uint8Array(bytes.length); o.set(bytes); return Promise.resolve(o.buffer); },
    text: function () { return Promise.resolve(new g.TextDecoder().decode(bytes)); },
    json: function () { return Promise.resolve(JSON.parse(new g.TextDecoder().decode(bytes))); },
  };
}

class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
  }

  getPreference(key) {
    try {
      return new SharedPreferences().get(key);
    } catch (e) {
      return null;
    }
  }

  // Called by the app as a method for every cover image, so it must stay a
  // method (a getter makes each tile throw).
  getHeaders(url) {
    return {
      "User-Agent": UA,
      "Referer": this.source.baseUrl + "/",
    };
  }

  // Headers for the site's own JSON API.
  get apiHeaders() {
    return {
      "User-Agent": UA,
      "Accept": "application/json",
      "Referer": this.source.baseUrl + "/",
      "Origin": this.source.baseUrl,
    };
  }

  // Headers the streaming backend insists on — also attached to every Video so
  // libmpv sends them with each segment request.
  get streamHeaders() {
    return {
      "User-Agent": UA,
      "Referer": "https://senshi.to/",
      "Origin": "https://senshi.to",
    };
  }

  async getJson(url, headers) {
    var res = await this.client.get(url, headers || this.apiHeaders);
    try {
      return JSON.parse((res && res.body) || "");
    } catch (e) {
      return null;
    }
  }

  // ── Titles & entries ────────────────────────────────────────────────────────

  pickTitle(item) {
    var pref = this.getPreference("senshi_pref_title") || "EN";
    var en = item.title_english || "";
    var jp = item.title || "";
    return (pref === "JP" ? (jp || en) : (en || jp)) || "Unknown";
  }

  cover(item) {
    return item && item.anime_picture ? this.source.baseUrl + item.anime_picture : "";
  }

  toEntry(item) {
    return {
      name: this.pickTitle(item),
      link: this.source.baseUrl + "/anime/" + item.id,
      imageUrl: this.cover(item),
    };
  }

  // ── List pages ──────────────────────────────────────────────────────────────

  async filterPage(body, page) {
    var payload = {
      searchTerm: "",
      types: [],
      genres: [],
      status: [],
      seasons: [],
      year: "",
      studios: [],
      producers: [],
      languages: [],
      sortBy: "score_desc",
      page: page || 1,
      limit: PAGE_SIZE,
      languagePreference: this.getPreference("senshi_pref_title") || "EN",
    };
    for (var k in body) payload[k] = body[k];

    var res = await this.client.post(
      this.source.baseUrl + "/anime/filter",
      Object.assign({ "Content-Type": "application/json" }, this.apiHeaders),
      payload
    );
    var json;
    try {
      json = JSON.parse((res && res.body) || "");
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
    var data = Array.isArray(json && json.data) ? json.data : [];
    var self = this;
    return {
      list: data.map(function (a) { return self.toEntry(a); }),
      hasNextPage: (payload.page * PAGE_SIZE) < (json.total || 0),
    };
  }

  get supportsLatest() {
    return true;
  }

  async getPopular(page) {
    return await this.filterPage({}, page);
  }

  // "Latest" is the site's fixed block of most recently added episode versions,
  // collapsed to one entry per series. It has no paging (page and limit are
  // ignored upstream), so there is no second page.
  async getLatestUpdates(page) {
    if ((page || 1) > 1) return { list: [], hasNextPage: false };
    var data = await this.getJson(this.source.baseUrl + "/episode-embeds/latest-paginated");
    var rows = data && Array.isArray(data.data) ? data.data : [];
    var seen = {};
    var list = [];
    for (var i = 0; i < rows.length; i++) {
      var a = rows[i] && rows[i].anime;
      if (!a || !a.id || seen[a.id]) continue;
      seen[a.id] = true;
      list.push(this.toEntry(a));
    }
    // Never leave the tab blank: fall back to the release-date ordering.
    if (list.length === 0) return await this.filterPage({ sortBy: "recent" }, 1);
    return { list: list, hasNextPage: false };
  }

  async search(query, page, filters) {
    var body = {};
    if (query) body.searchTerm = query;

    // Filters arrive positionally, in the same order as getFilterList().
    try {
      var defs = this.filterDefs();
      for (var i = 0; i < defs.length; i++) {
        var f = (filters || [])[i];
        if (!f) continue;
        var def = defs[i];
        if (def.kind === "group") {
          var picked = [];
          var st = f.state || [];
          for (var j = 0; j < st.length; j++) {
            if (st[j] && st[j].state === true && st[j].value) picked.push(st[j].value);
          }
          if (picked.length) body[def.param] = picked;
        } else {
          var opt = (f.values || [])[f.state || 0];
          if (opt && opt.value) body[def.param] = opt.value;
        }
      }
    } catch (e) { /* fall back to a plain title search */ }

    return await this.filterPage(body, page);
  }

  // ── Detail ──────────────────────────────────────────────────────────────────

  idFrom(url) {
    var m = String(url || "").match(/\/(?:anime|watch)\/(\d+)/);
    return m ? m[1] : String(url || "").replace(/\D/g, "");
  }

  statusCode(s) {
    var t = String(s || "").toLowerCase();
    if (t.indexOf("currently") >= 0) return 0;
    if (t.indexOf("finished") >= 0) return 1;
    if (t.indexOf("not yet") >= 0) return 4;
    return 5;
  }

  badgeLabel(hasSub, hasDub) {
    return hasSub && hasDub ? "Sub · Dub" : hasSub ? "Sub" : hasDub ? "Dub" : "";
  }

  // "Sub · Dub" / "Sub" / "Dub" under each episode before it is opened. The
  // episode list carries no language data and the anime record only has totals
  // (sub_count / dub_count), which are accurate but do not say WHICH episodes:
  // dubs can skip some (e.g. 1-5, 7-13, 15). So:
  //   every episode has a sub and there is no dub → "Sub" for all, no requests
  //   every episode has both                      → "Sub · Dub" for all, no requests
  //   anything in between                         → ask the site once per episode
  // A 500-episode title would be 500 requests, so past BADGE_LOOKUP_MAX the dub is
  // assumed to run from episode 1 instead. A failed lookup leaves that episode
  // without a badge rather than showing a wrong one.
  async episodeBadges(id, eps, info) {
    var n = eps.length;
    var subCount = parseInt(info.sub_count, 10) || 0;
    var dubCount = parseInt(info.dub_count, 10) || 0;
    var out = {};
    var self = this;
    var i;
    if (n === 0) return out;

    if (subCount >= n && (dubCount === 0 || dubCount >= n)) {
      var label = this.badgeLabel(true, dubCount >= n);
      for (i = 0; i < n; i++) out[eps[i].ep_id] = label;
      return out;
    }

    if (n > BADGE_LOOKUP_MAX) {
      for (i = 0; i < n; i++) {
        out[eps[i].ep_id] = this.badgeLabel(subCount >= n || i < subCount, i < dubCount);
      }
      return out;
    }

    var base = this.source.baseUrl;
    for (i = 0; i < n; i += BADGE_BATCH) {
      var slice = eps.slice(i, i + BADGE_BATCH);
      var rows = await Promise.all(slice.map(function (e) {
        return self.getJson(base + "/episode-embeds/" + id + "/" + e.ep_id).catch(function () { return null; });
      }));
      for (var k = 0; k < slice.length; k++) {
        if (!Array.isArray(rows[k])) continue;
        var hasSub = false, hasDub = false;
        rows[k].forEach(function (r) {
          if (!r || !r.status) return;
          if (r.status === "Dub") hasDub = true; else hasSub = true;
        });
        out[slice[k].ep_id] = self.badgeLabel(hasSub, hasDub);
      }
    }
    return out;
  }

  async getDetail(url) {
    var id = this.idFrom(url);
    var base = this.source.baseUrl;
    var pair = await Promise.all([
      this.getJson(base + "/anime/" + id),
      this.getJson(base + "/episodes/" + id),
    ]);
    var info = pair[0] || {};
    var eps = Array.isArray(pair[1]) ? pair[1] : [];
    var badges = await this.episodeBadges(id, eps, info);

    var chapters = [];
    for (var i = 0; i < eps.length; i++) {
      var ep = eps[i];
      if (!ep || ep.ep_id === undefined || ep.ep_id === null) continue;
      var label = "Episode " + ep.ep_id;
      // Most titles are just "Episode N" again — only append a real one.
      var t = String(ep.ep_title || "").trim();
      if (t && t.toLowerCase() !== label.toLowerCase() && !/^episode\s*\d+$/i.test(t)) {
        label += ": " + t;
      }
      var uploaded = ep.created_at ? Date.parse(ep.created_at) : NaN;
      chapters.push({
        name: label,
        // This URL is the episode's identity in the app's library — keep it
        // exactly /watch/{id}/{ep}; anything appended makes existing entries
        // look like new episodes.
        url: base + "/watch/" + id + "/" + ep.ep_id,
        dateUpload: isNaN(uploaded) ? null : String(uploaded),
        scanlator: badges[ep.ep_id] || "",
      });
    }
    // The API lists episode 1 first; Mangayomi shows the newest at the top.
    chapters.reverse();

    var genre = String(info.genres || "")
      .split(",")
      .map(function (g) { return g.trim(); })
      .filter(function (g) { return g; });

    var description = String(info.ani_description || "")
      .replace(/\r/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    var meta = [];
    if (info.type) meta.push("Type: " + info.type);
    if (info.studios) meta.push("Studio: " + info.studios);
    if (info.ani_year) {
      meta.push("Season: " + ((info.ani_season || "") + " " + info.ani_year).trim());
    }
    if (info.score) meta.push("Score: " + info.score);
    if (info.sub_count || info.dub_count) {
      meta.push("Episodes: " + (info.sub_count || 0) + " sub / " + (info.dub_count || 0) + " dub");
    }
    if (meta.length) description = meta.join("\n") + (description ? "\n\n" + description : "");

    return {
      name: info.id ? this.pickTitle(info) : id,
      imageUrl: this.cover(info),
      description: description,
      genre: genre,
      status: this.statusCode(info.ani_status),
      author: info.studios || "",
      link: base + "/anime/" + id,
      chapters: chapters,
    };
  }

  // ── Streaming ───────────────────────────────────────────────────────────────

  _vttTsToSrt(ts) {
    var dotIdx = ts.lastIndexOf(".");
    var ms = ts.substring(dotIdx + 1);
    var parts = ts.substring(0, dotIdx).split(":");
    while (parts.length < 3) parts.unshift("00");
    return parts.join(":") + "," + ms;
  }

  _vttToSrt(vtt) {
    var lines = vtt.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    var srt = "", cueNum = 1, i = 0;
    while (i < lines.length && lines[i].trim() !== "") i++;
    while (i < lines.length) {
      while (i < lines.length && lines[i].trim() === "") i++;
      if (i >= lines.length) break;
      var line = lines[i];
      if (/^(NOTE|STYLE|REGION)\b/.test(line)) {
        while (i < lines.length && lines[i].trim() !== "") i++;
        continue;
      }
      if (line.indexOf("-->") < 0) { i++; if (i >= lines.length) break; line = lines[i]; }
      if (line.indexOf("-->") < 0) { i++; continue; }
      var m = line.match(/([\d:]+\.\d{3})\s*-->\s*([\d:]+\.\d{3})/);
      if (!m) { i++; continue; }
      var start = this._vttTsToSrt(m[1]), end = this._vttTsToSrt(m[2]);
      i++;
      var textLines = [];
      while (i < lines.length && lines[i].trim() !== "") {
        textLines.push(lines[i].replace(/<[\d:]+\.\d{3}>/g, ""));
        i++;
      }
      if (textLines.length > 0) {
        srt += cueNum + "\n" + start + " --> " + end + "\n" + textLines.join("\n") + "\n\n";
        cueNum++;
      }
    }
    return srt || vtt;
  }

  // The site shows English first and then the release's own languages; the
  // dub's caption track has "Dub" in its label and belongs to the dub only.
  _isDubTrack(t) {
    return /dub/i.test(String(t.label || "")) || /ai_dub/i.test(String(t.url || t.vtt_url || ""));
  }

  // Subtitles have to be downloaded to be attached: the app fetches subtitle
  // URLs with no headers, and this CDN 403s without Referer + Origin. Releases
  // can carry a dozen languages, so the count is capped (English ranked first).
  async inlineSubtitles(tracks, wantDub) {
    if (!Array.isArray(tracks)) return [];
    var self = this;
    var wanted = tracks.filter(function (t) {
      return t && t.vtt_url && t.label !== "chapter";
    });
    // English always leads, even when the site's own default:true flag marks a
    // different language default (that happens — Senshi's "default" reflects
    // the uploader's pick, not the user's) — the app auto-enables subtitles[0].
    //
    // Tracks made for the other audio (e.g. a "(AI Dub)" caption, transcribed
    // from the English dub track) are ranked behind ones made for this audio,
    // never dropped: some releases carry exactly one subtitle for the whole
    // title (Chainsaw Man – The Movie: Reze Arc is one — sub and dub share a
    // single remote_source_id and its only track is literally named
    // ai_dub.vtt). It still lines up: sub and dub share the same video, so
    // cue timing is identical either way, only the wording was written
    // against the dub script. Offering it beats no subtitles at all.
    var rank = function (t) {
      var audioMatches = self._isDubTrack(t) === wantDub;
      var isEnglish = /^english/i.test(String(t.label || ""));
      if (isEnglish && audioMatches) return 0;
      if (t.default === true && audioMatches) return 1;
      if (isEnglish) return 2;
      if (audioMatches) return 3;
      return 4;
    };
    wanted = wanted
      .map(function (t, i) { return { t: t, i: i }; })
      .sort(function (a, b) { return rank(a.t) - rank(b.t) || a.i - b.i; })
      .map(function (x) { return x.t; });

    var cap = parseInt(this.getPreference("senshi_pref_sub_count"), 10);
    if (!cap || cap < 1) cap = 6;
    wanted = wanted.slice(0, cap);

    var fetched = await Promise.all(wanted.map(function (t) {
      return self.client
        .get(t.vtt_url, self.streamHeaders)
        .then(function (res) {
          var body = ((res && res.body) || "").replace(/^\s+/, "");
          if (body.indexOf("WEBVTT") !== 0) return null;
          return { file: self._vttToSrt(body), label: t.label || "Unknown" };
        })
        .catch(function () { return null; });
    }));
    return fetched.filter(function (s) { return s !== null; });
  }

  // One request for the player. A body is sent as a Latin-1 string (one char
  // per byte) with a matching charset: the app's HTTP layer turns a String body
  // into bytes with the declared charset, and it chokes on a byte list that is
  // not valid UTF-8 (FormatException). If that still fails, the request is
  // retried on the app's plain Dart client and then as a byte list; a failure
  // names the request.
  async playerSend(method, url, headers, bytes) {
    var body = null, i;
    if (bytes) {
      var parts = [];
      for (i = 0; i < bytes.length; i += 4096) parts.push(String.fromCharCode.apply(null, bytes.slice(i, i + 4096)));
      body = parts.join("");
    }
    var attempts = [
      [this.client, body],
      [new Client({ useDartHttpClient: true }), body],
      [this.client, bytes],
    ];
    var msg = "";
    for (i = 0; i < attempts.length; i++) {
      if (i > 0 && (!bytes || msg.indexOf("FormatException") < 0)) break;
      try {
        var c = attempts[i][0];
        return method === "GET" ? await c.get(url, headers) : await c.post(url, headers, attempts[i][1]);
      } catch (e) {
        msg += (msg ? "; retry: " : "") + String((e && e.message) || e);
      }
    }
    throw new Error(method + " " + String(url).replace(/^https?:\/\/([^\/]+)(\/[^?]{0,40}).*$/, "$1$2") +
      (bytes ? " [" + bytes.length + " bytes]" : "") + ": " + msg);
  }

  // fetch() for the player runtime, over the app's Client; the PNG-typed
  // replies come back as Latin-1 strings.
  playerFetch(g, url, opts) {
    opts = opts || {};
    var headers = {}, k, src = this.streamHeaders;
    for (k in src) headers[k] = src[k];
    for (k in (opts.headers || {})) headers[k] = opts.headers[k];
    var method = String(opts.method || "GET").toUpperCase();
    var bytes = null;
    if (method !== "GET") {
      var b = opts.body, i;
      bytes = [];
      if (typeof b === "string") b = new g.TextEncoder().encode(b);
      else if (b instanceof ArrayBuffer) b = new Uint8Array(b);
      else if (b && b.buffer) b = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
      for (i = 0; b && i < b.length; i++) bytes.push(b[i]);
      headers["Content-Type"] = "image/png; charset=latin1";
    }
    return this.playerSend(method, String(url), headers, bytes).then(function (res) {
      return senshiResponse(res.statusCode, res.body, res.headers, g);
    });
  }

  // Loads the runtime once per extension instance and returns window.__oct.
  async player() {
    if (this._playerP) return this._playerP;
    var self = this;
    this._playerP = (async function () {
      var res = await self.playerSend("GET", PLAYER_URL, self.streamHeaders, null);
      var code = (res && res.body) || "";
      if (code.length < 1000 || /^s*</.test(code)) {
        throw new Error("Senshi's player script could not be loaded (HTTP " + (res && res.statusCode) + ")");
      }
      var g = {};
      senshiEnv(g);
      senshiCrypto(g);
      senshiWasm(g);
      g.fetch = function (url, opts) { return self.playerFetch(g, url, opts); };
      senshiRunPlayer(code, g);
      for (var i = 0; i < 20 && !g.__oct; i++) await Promise.resolve();
      if (!g.__oct || typeof g.__oct.open !== "function") {
        throw new Error("Senshi's player script changed shape (no __oct.open)");
      }
      return g.__oct;
    })();
    this._playerP.catch(function () { self._playerP = null; });
    return this._playerP;
  }

  // remote_source_id → { src, tracks, error }. src is the master playlist URL
  // (with a short-lived signed token). A failure costs the subtitles and in
  // direct mode the whole version, so it is reported in error, not thrown.
  async sourceInfo(remoteId) {
    try {
      var oct = await this.player();
      var data = await oct.open(Number(remoteId));
      var entry = Array.isArray(data) ? data[0] : data;
      var srcs = entry && entry.source;
      var first = Array.isArray(srcs) ? srcs[0] : srcs;
      return {
        src: (first && first.src) || "",
        tracks: entry && Array.isArray(entry.tracks) ? entry.tracks : [],
        error: first && first.src ? "" : "empty reply",
      };
    } catch (e) {
      var m = String((e && e.message) || e);
      // The handshake POST is binary. The app's HTTP layer (http_interceptor's
      // Request.copyWith) rebuilds every request body as UTF-8 text, so the
      // server always sees different bytes and answers 403.
      if (m.indexOf("authorization failed") >= 0) m += " - the app re-encodes the binary handshake request, which this site rejects";
      return { src: "", tracks: [], error: m };
    }
  }

  // ── Direct playback: decrypt the playlists here, hand mpv an edl:// URL ───────

  // AES-256 forward cipher (table version). Only the forward direction is
  // needed: GCM decryption is CTR mode, which encrypts counter blocks.
  _aesSetup() {
    if (this._aes) return this._aes;
    var sbox = new Uint8Array(256);
    var p = 1, q = 1;
    // Walk the generator 3 through GF(2^8) to build the S-box.
    do {
      p = (p ^ (p << 1) ^ (p & 0x80 ? 0x1b : 0)) & 0xff;
      q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff;
      if (q & 0x80) q ^= 0x09;
      var x = (q ^ ((q << 1) | (q >>> 7)) ^ ((q << 2) | (q >>> 6)) ^
        ((q << 3) | (q >>> 5)) ^ ((q << 4) | (q >>> 4))) & 0xff;
      sbox[p] = x ^ 0x63;
    } while (p !== 1);
    sbox[0] = 0x63;

    var T0 = new Uint32Array(256), T1 = new Uint32Array(256);
    var T2 = new Uint32Array(256), T3 = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var sv = sbox[i];
      var s2 = ((sv << 1) ^ (sv & 0x80 ? 0x1b : 0)) & 0xff;
      var s3 = s2 ^ sv;
      T0[i] = ((s2 << 24) | (sv << 16) | (sv << 8) | s3) >>> 0;
      T1[i] = ((s3 << 24) | (s2 << 16) | (sv << 8) | sv) >>> 0;
      T2[i] = ((sv << 24) | (s3 << 16) | (s2 << 8) | sv) >>> 0;
      T3[i] = ((sv << 24) | (sv << 16) | (s3 << 8) | s2) >>> 0;
    }

    var key = new Uint8Array(32);
    for (var k = 0; k < 32; k++) key[k] = KEY_A[k] ^ KEY_B[k];
    var sub = function (t) {
      return ((sbox[t >>> 24] << 24) | (sbox[(t >>> 16) & 255] << 16) |
        (sbox[(t >>> 8) & 255] << 8) | sbox[t & 255]) >>> 0;
    };
    var rk = new Uint32Array(60);
    for (k = 0; k < 8; k++) {
      rk[k] = ((key[4 * k] << 24) | (key[4 * k + 1] << 16) | (key[4 * k + 2] << 8) | key[4 * k + 3]) >>> 0;
    }
    var rcon = 1;
    for (k = 8; k < 60; k++) {
      var t = rk[k - 1];
      if (k % 8 === 0) {
        t = sub(((t << 8) | (t >>> 24)) >>> 0);
        t = (t ^ (rcon << 24)) >>> 0;
        rcon = ((rcon << 1) ^ (rcon & 0x80 ? 0x1b : 0)) & 0xff;
      } else if (k % 8 === 4) {
        t = sub(t);
      }
      rk[k] = (rk[k - 8] ^ t) >>> 0;
    }
    this._aes = { sbox: sbox, T0: T0, T1: T1, T2: T2, T3: T3, rk: rk };
    return this._aes;
  }

  // Encrypts one block given as four big-endian words; the result goes in out[0..3].
  _aesBlock(a, s0, s1, s2, s3, out) {
    var T0 = a.T0, T1 = a.T1, T2 = a.T2, T3 = a.T3, sb = a.sbox, rk = a.rk;
    var t0, t1, t2, t3, r = 4;
    s0 ^= rk[0]; s1 ^= rk[1]; s2 ^= rk[2]; s3 ^= rk[3];
    for (var round = 1; round < 14; round++) {
      t0 = T0[s0 >>> 24] ^ T1[(s1 >>> 16) & 255] ^ T2[(s2 >>> 8) & 255] ^ T3[s3 & 255] ^ rk[r];
      t1 = T0[s1 >>> 24] ^ T1[(s2 >>> 16) & 255] ^ T2[(s3 >>> 8) & 255] ^ T3[s0 & 255] ^ rk[r + 1];
      t2 = T0[s2 >>> 24] ^ T1[(s3 >>> 16) & 255] ^ T2[(s0 >>> 8) & 255] ^ T3[s1 & 255] ^ rk[r + 2];
      t3 = T0[s3 >>> 24] ^ T1[(s0 >>> 16) & 255] ^ T2[(s1 >>> 8) & 255] ^ T3[s2 & 255] ^ rk[r + 3];
      s0 = t0; s1 = t1; s2 = t2; s3 = t3; r += 4;
    }
    out[0] = ((sb[s0 >>> 24] << 24) | (sb[(s1 >>> 16) & 255] << 16) | (sb[(s2 >>> 8) & 255] << 8) | sb[s3 & 255]) ^ rk[r];
    out[1] = ((sb[s1 >>> 24] << 24) | (sb[(s2 >>> 16) & 255] << 16) | (sb[(s3 >>> 8) & 255] << 8) | sb[s0 & 255]) ^ rk[r + 1];
    out[2] = ((sb[s2 >>> 24] << 24) | (sb[(s3 >>> 16) & 255] << 16) | (sb[(s0 >>> 8) & 255] << 8) | sb[s1 & 255]) ^ rk[r + 2];
    out[3] = ((sb[s3 >>> 24] << 24) | (sb[(s0 >>> 16) & 255] << 16) | (sb[(s1 >>> 8) & 255] << 8) | sb[s2 & 255]) ^ rk[r + 3];
  }

  // raw = iv(12) | ciphertext | tag(16). The tag is not checked: a wrong key or
  // a changed format shows up as an unreadable playlist anyway.
  _gcmDecrypt(raw) {
    var n = raw.length - 12 - 16;
    if (n < 0) throw new Error("Truncated encrypted playlist");
    var a = this._aesSetup();
    var w = function (o) { return ((raw[o] << 24) | (raw[o + 1] << 16) | (raw[o + 2] << 8) | raw[o + 3]) >>> 0; };
    var iv0 = w(0), iv1 = w(4), iv2 = w(8);
    var out = new Uint8Array(n);
    var ks = new Uint32Array(4);
    var ctr = 2;   // block 1 is reserved for the tag
    for (var off = 0; off < n; off += 16) {
      this._aesBlock(a, iv0, iv1, iv2, ctr, ks);
      ctr = (ctr + 1) >>> 0;
      var m = n - off < 16 ? n - off : 16;
      for (var j = 0; j < m; j++) {
        out[off + j] = raw[12 + off + j] ^ ((ks[j >> 2] >>> (24 - 8 * (j & 3))) & 255);
      }
    }
    return out;
  }

  _b64ToBytes(str) {
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var lut = new Int16Array(256);
    for (var i = 0; i < 256; i++) lut[i] = -1;
    for (i = 0; i < 64; i++) lut[chars.charCodeAt(i)] = i;
    var out = new Uint8Array(((str.length * 3) >> 2) + 3);
    var o = 0, acc = 0, bits = 0;
    for (i = 0; i < str.length; i++) {
      var v = lut[str.charCodeAt(i) & 255];
      if (v < 0) continue;   // padding, whitespace
      acc = (acc << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 255; acc &= (1 << bits) - 1; }
    }
    return out.subarray(0, o);
  }

  _bytesToStr(bytes) {
    var parts = [];
    for (var i = 0; i < bytes.length; i += 8192) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)));
    }
    return parts.join("");
  }

  // Plain playlists pass through, exactly like the site's own loader.
  _decryptPlaylist(text) {
    var t = String(text || "").trim();
    if (t.indexOf("EM3U8v1:") !== 0) return t;
    return this._bytesToStr(this._gcmDecrypt(this._b64ToBytes(t.substring(8))));
  }

  async fetchPlaylist(url) {
    var res = await this.client.get(url, this.streamHeaders);
    var body = this._decryptPlaylist(res && res.body);
    if (body.indexOf("#EXTM3U") < 0) {
      throw new Error("Senshi's stream server returned no playlist (HTTP " + (res && res.statusCode) + ")");
    }
    return body;
  }

  _absUrl(ref, base) {
    if (/^https?:\/\//i.test(ref)) return ref;
    var m = base.match(/^(https?:\/\/[^/]+)/);
    if (ref.charAt(0) === "/") return (m ? m[1] : "") + ref;
    return base.substring(0, base.lastIndexOf("/") + 1) + ref;
  }

  _attr(line, name) {
    var m = line.match(new RegExp("(?:^|[:,])" + name + '=("([^"]*)"|[^,]*)'));
    return m ? (m[2] !== undefined ? m[2] : m[1]) : "";
  }

  // Master → { audio: [{lang, uri}], variants: [{w, h, codecs, uri}] best first }.
  parseMaster(body, masterUrl) {
    var lines = body.split(/\r?\n/);
    var audio = [], variants = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].trim();
      if (l.indexOf("#EXT-X-MEDIA:") === 0 && this._attr(l, "TYPE") === "AUDIO") {
        audio.push({
          lang: this._attr(l, "LANGUAGE").toLowerCase(),
          uri: this._absUrl(this._attr(l, "URI"), masterUrl),
          isDefault: /DEFAULT=YES/i.test(l),
        });
      } else if (l.indexOf("#EXT-X-STREAM-INF:") === 0) {
        var uri = "";
        for (var j = i + 1; j < lines.length; j++) {
          var u = lines[j].trim();
          if (u && u.charAt(0) !== "#") { uri = u; break; }
        }
        if (!uri) continue;
        var res = this._attr(l, "RESOLUTION").split("x");
        variants.push({
          w: parseInt(res[0], 10) || 0,
          h: parseInt(res[1], 10) || 0,
          bw: parseInt(this._attr(l, "BANDWIDTH"), 10) || 0,
          codecs: this._attr(l, "CODECS"),
          uri: this._absUrl(uri, masterUrl),
        });
      }
    }
    variants.sort(function (x, y) { return (y.h - x.h) || (y.bw - x.bw); });
    if (variants.length === 0) throw new Error("Senshi's master playlist has no video");
    return { audio: audio, variants: variants };
  }

  // Media playlist → [{url, dur}].
  parseMedia(body, playlistUrl) {
    var lines = body.split(/\r?\n/);
    var segs = [], dur = null;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].trim();
      if (!l) continue;
      if (l.indexOf("#EXTINF:") === 0) { dur = parseFloat(l.substring(8)); continue; }
      if (l.charAt(0) === "#") continue;
      if (dur === null || isNaN(dur)) continue;
      segs.push({ url: this._absUrl(l, playlistUrl), dur: dur });
      dur = null;
    }
    if (segs.length === 0) throw new Error("Senshi's media playlist has no segments");
    return segs;
  }

  pickAudio(audios, lang) {
    var i;
    for (i = 0; i < audios.length; i++) {
      if (audios[i].lang === lang || audios[i].lang.indexOf(lang) === 0 ||
          audios[i].uri.toLowerCase().indexOf("_" + lang + "/") >= 0) return audios[i];
    }
    // The wanted language is not there (a sub-only release asked for "en"):
    // take what the master offers rather than dropping the sound.
    for (i = 0; i < audios.length; i++) if (audios[i].isDefault) return audios[i];
    return audios.length ? audios[0] : null;
  }

  // Characters that end an EDL field must be length-escaped as %len%text.
  _edlEsc(s) {
    return /[,;=%\r\n]/.test(s) ? "%" + s.length + "%" + s : s;
  }

  _edlStream(segs, first) {
    var t = first, out = [];
    for (var i = 0; i < segs.length; i++) {
      out.push(this._edlEsc(segs[i].url) + ",start=" + t.toFixed(6) + ",length=" + segs[i].dur.toFixed(6));
      t += segs[i].dur;
    }
    return out.join(";");
  }

  _codecName(codecs, kind) {
    var list = String(codecs || "").split(",");
    for (var i = 0; i < list.length; i++) {
      var c = list[i].trim().toLowerCase();
      if (kind === "video") {
        if (c.indexOf("avc") === 0) return "h264";
        if (c.indexOf("hvc") === 0 || c.indexOf("hev") === 0) return "hevc";
        if (c.indexOf("av01") === 0) return "av1";
      } else if (c.indexOf("mp4a") === 0) return "aac";
    }
    return kind === "video" ? "h264" : "aac";
  }

  // One URL carrying both streams. !delay_open keeps mpv from opening all the
  // parts up front; its hints (codec, size) only stand in until the first real
  // segment is opened.
  buildEdl(videoSegs, audioSegs, variant) {
    var v = "edl://!delay_open,media_type=video,codec=" + this._codecName(variant.codecs, "video") +
      (variant.w && variant.h ? ",w=" + variant.w + ",h=" + variant.h : "") + ",fps=24;" +
      this._edlStream(videoSegs, EDL_VIDEO_START);
    if (!audioSegs) return v;
    return v + ";!new_stream;!delay_open,media_type=audio,codec=" + this._codecName(variant.codecs, "audio") +
      ",samplerate=48000;" + this._edlStream(audioSegs, EDL_AUDIO_START);
  }

  async directVideos(jobs, infoOf, animeId, epNum) {
    var self = this;
    var headers = this.streamHeaders;
    var masters = {};   // remote id → Promise<parsed master>
    var media = {};     // playlist url → Promise<segments>
    var getMaster = function (rid) {
      var info = infoOf[rid];
      if (!info || !info.src) {
        return Promise.reject(new Error("Senshi's stream lookup returned nothing for this episode" +
          (info && info.error ? " (" + info.error + ")" : "")));
      }
      if (!masters[rid]) {
        masters[rid] = self.fetchPlaylist(info.src).then(function (b) { return self.parseMaster(b, info.src); });
      }
      return masters[rid];
    };
    var getMedia = function (u) {
      if (!media[u]) media[u] = self.fetchPlaylist(u).then(function (b) { return self.parseMedia(b, u); });
      return media[u];
    };

    var lastError = null;
    var groups = await Promise.all(jobs.map(function (j) {
      return (async function () {
        try {
          var info = infoOf[j.rid];
          var subsP = info ? self.inlineSubtitles(info.tracks, j.dub) : Promise.resolve([]);
          var master = await getMaster(j.rid);
          var audio = self.pickAudio(master.audio, j.dub ? "en" : "ja");
          // Best quality only. The lower variant is not offered: its segments
          // rarely start on a keyframe, so every part boundary would freeze the
          // picture for seconds (see the note at the top).
          var best = master.variants[0];

          var fetched = await Promise.all([
            audio ? getMedia(audio.uri) : Promise.resolve(null),
            getMedia(best.uri),
          ]);
          var subs = await subsP;
          var label = (j.dub ? "Dub" : "Sub") + " " + best.h + "p";
          var edl = self.buildEdl(fetched[1], fetched[0], best);
          return [{
            url: edl,
            // MUST be the same playable edl:// as url, not a placeholder: the
            // app opens originalUrl (not url) for the very first video on a
            // freshly created player screen, so a non-playable placeholder here
            // hangs the first-ever open of every episode (confirmed the exact
            // way 1Anime's "first open buffers" bug worked, its real cause).
            // A plain edl:// has no recognized file extension, so the
            // downloader still correctly reports it as not downloadable.
            originalUrl: edl,
            quality: label,
            headers: headers,
            subtitles: subs,
            _dub: j.dub,
          }];
        } catch (e) {
          lastError = e;
          return [];
        }
      })();
    }));

    var videos = [];
    groups.forEach(function (g) { g.forEach(function (v) { videos.push(v); }); });
    if (videos.length === 0 && lastError) throw lastError;
    return videos;
  }

  async getVideoList(url) {
    var idM = String(url || "").match(/\/watch\/(\d+)\/(\d+)/);
    if (!idM) return [];
    var animeId = idM[1], epNum = idM[2];

    var embeds = await this.getJson(this.source.baseUrl + "/episode-embeds/" + animeId + "/" + epNum);
    if (!Array.isArray(embeds) || embeds.length === 0) return [];

    // One lookup per distinct backend id (a HardSub and a Dub row usually share it).
    var ids = [];
    embeds.forEach(function (e) {
      if (e && e.remote_source_id && ids.indexOf(e.remote_source_id) < 0) ids.push(e.remote_source_id);
    });
    // One after another: the player runtime keeps a single handshake session.
    var infoOf = {};
    for (var n = 0; n < ids.length; n++) infoOf[ids[n]] = await this.sourceInfo(ids[n]);

    var headers = this.streamHeaders;

    var jobs = [];
    embeds.forEach(function (e) {
      if (!e || !e.remote_source_id) return;
      var dub = e.status === "Dub";
      // Same status twice (some releases list a row per CDN) adds nothing.
      for (var i = 0; i < jobs.length; i++) {
        if (jobs[i].dub === dub && jobs[i].rid === e.remote_source_id) return;
      }
      jobs.push({ dub: dub, rid: e.remote_source_id });
    });

    var videos = await this.directVideos(jobs, infoOf, animeId, epNum);

    // Mangayomi plays the first entry and takes auto-play subtitles from it,
    // so the preferred audio has to lead. originalUrl equals url on every
    // entry (see directVideos) because the app opens originalUrl, not url,
    // for the very first play on a freshly created player screen — a real,
    // confirmed quirk, not every quality switch after.
    var wantDub = this.getPreference("senshi_pref_type") === "dub";
    videos.sort(function (a, b) {
      if (a._dub !== b._dub) return (a._dub === wantDub) ? -1 : 1;
      return 0;
    });
    videos.forEach(function (v) { delete v._dub; });
    return videos;
  }

  // ── Filters & preferences ───────────────────────────────────────────────────

  filterDefs() {
    var years = [];
    for (var y = new Date().getFullYear() + 1; y >= 1980; y--) years.push([String(y), String(y)]);
    return [
      { kind: "group", param: "genres", name: "Genres", options: GENRES.map(function (g) { return [g, g]; }) },
      { kind: "group", param: "types", name: "Type", options: TYPES },
      { kind: "group", param: "status", name: "Status", options: STATUSES },
      { kind: "group", param: "seasons", name: "Season", options: SEASONS },
      { kind: "group", param: "languages", name: "Audio", options: LANGUAGES },
      { kind: "select", param: "year", name: "Year", options: years },
      { kind: "select", param: "sortBy", name: "Sort by", options: SORTS },
    ];
  }

  getFilterList() {
    return this.filterDefs().map(function (def) {
      if (def.kind === "group") {
        return {
          type_name: "GroupFilter",
          name: def.name,
          state: def.options.map(function (o) {
            return { type_name: "CheckBox", name: o[0], value: o[1] };
          }),
        };
      }
      return {
        type_name: "SelectFilter",
        name: def.name,
        state: 0,
        values: [{ type_name: "SelectOption", name: def.param === "sortBy" ? "Default" : "Any", value: "" }].concat(
          def.options.map(function (o) {
            return { type_name: "SelectOption", name: o[0], value: o[1] };
          })
        ),
      };
    });
  }

  getSourcePreferences() {
    return [
      {
        key: "senshi_pref_title",
        listPreference: {
          title: "Preferred title language",
          summary: "English or romaji titles",
          valueIndex: 0,
          entries: ["English", "Romaji"],
          entryValues: ["EN", "JP"],
        },
      },
      {
        key: "senshi_pref_type",
        listPreference: {
          title: "Preferred audio",
          summary: "Which version is listed first (and supplies auto-play subtitles)",
          valueIndex: 0,
          entries: ["Sub", "Dub"],
          entryValues: ["sub", "dub"],
        },
      },
      {
        key: "senshi_pref_sub_count",
        listPreference: {
          title: "Subtitle languages to load",
          summary: "Subtitles must be downloaded to work, so loading more slows episodes down. English first either way.",
          valueIndex: 1,
          entries: ["2 (fastest)", "6 (default)", "12", "All available"],
          entryValues: ["2", "6", "12", "99"],
        },
      },
    ];
  }
}
