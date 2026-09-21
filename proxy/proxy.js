// Local HLS proxy for Mangayomi anime extensions.
// Fixes two libmpv issues with nekostream-family CDNs:
//   1. Segment URLs have no file extension — libmpv's extension_picky check
//      rejects them. The proxy rewrites them to end in /ts.ts.
//   2. Every segment has a 70-byte PNG header before the MPEG-TS payload —
//      libmpv fails format detection. The proxy strips it.
//
// Usage:  node proxy.js
// Proxy listens on http://localhost:8765
//
// To start automatically at Windows login, add a shortcut to this script in:
//   %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
// with target: node "C:\full\path\to\proxy.js"

const http  = require("http");
const https = require("https");
const { URL } = require("url");

const PORT = 8765;

// Offset of the real MPEG-TS payload inside a (possibly PNG-wrapped) segment.
//
// Scanning for the first 0x47 is WRONG: byte 3 of the PNG signature
// "\x89PNG" *is* 0x47, so a naive scan strips 3 bytes and leaves the rest of
// the PNG header in front of the stream. The result is never 188-byte
// aligned, ffmpeg's initial format probe fails, and the stream only plays
// after the demuxer has been forced to resync (switch quality away and back).
//
// A transport stream is a run of 188-byte packets each starting with 0x47, so
// require three in a row before trusting an offset. Returns 0 for raw TS.
function tsStart(buf) {
  const limit = Math.min(buf.length - 376, 4096);
  for (let i = 0; i < limit; i++) {
    if (buf[i] === 0x47 && buf[i + 188] === 0x47 && buf[i + 376] === 0x47) return i;
  }
  return 0;
}

function upstreamGet(targetUrl, headers, cb) {
  let u;
  try { u = new URL(targetUrl); } catch (e) { return cb(null, e); }
  const mod = u.protocol === "https:" ? https : http;
  const req = mod.request(
    { hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search, method: "GET", headers },
    (res) => cb(res, null)
  );
  req.on("error", (e) => cb(null, e));
  req.end();
}

// Senshi (senshi.to) playlists are AES-encrypted; the decrypt/rewrite lives in
// senshi-core.mjs so this proxy and worker.js run identical code. The core uses
// the Web Crypto global, which Node only exposes unflagged from v19.
if (!globalThis.crypto) globalThis.crypto = require("crypto").webcrypto;
const senshiCore = import("./senshi-core.mjs");

http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, `http://localhost:${PORT}`); }
  catch (e) { res.writeHead(400); res.end("Bad request"); return; }

  if (url.pathname.startsWith("/senshi/")) {
    const { handleSenshi } = await senshiCore;
    const host = req.headers.host || `localhost:${PORT}`;
    const out = await handleSenshi(url.pathname, url.searchParams, "http://" + host);
    if (out) {
      res.writeHead(out.status, Object.assign({ "Content-Length": Buffer.byteLength(out.body) }, out.headers));
      res.end(out.body);
      return;
    }
  }

  const targetUrl = url.searchParams.get("url");
  const referer   = url.searchParams.get("referer") || "";

  if (!targetUrl) { res.writeHead(400); res.end("Missing url"); return; }

  // ── Segment redirect (/seg.ts) ────────────────────────────────────────────
  // For CDNs that already serve clean MPEG-TS and are only rejected because
  // their segments are named .jpg/.image, no bytes need rewriting — the URL
  // just has to *end* in .ts when ffmpeg checks it. A 302 satisfies that and
  // then gets out of the way, so the video streams straight from the CDN and
  // this proxy carries a few hundred bytes per episode instead of gigabytes.
  if (url.pathname === "/seg.ts") {
    res.writeHead(302, { "Location": targetUrl, "Access-Control-Allow-Origin": "*" });
    res.end();
    return;
  }

  const upHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    "Accept": "*/*",
  };
  if (referer) {
    upHeaders["Referer"] = referer;
    try { upHeaders["Origin"] = new URL(referer).origin; } catch (_) {}
  }

  upstreamGet(targetUrl, upHeaders, (upRes, err) => {
    if (err || !upRes) {
      res.writeHead(502); res.end("Fetch failed: " + (err ? err.message : "no response")); return;
    }
    if (upRes.statusCode !== 200) {
      res.writeHead(502); res.end("Upstream " + upRes.statusCode); upRes.resume(); return;
    }

    const chunks = [];
    upRes.on("data", c => chunks.push(c));
    upRes.on("end", () => {
      const buf = Buffer.concat(chunks);

      // ── Segment (/ts.ts) ─────────────────────────────────────────────────
      if (url.pathname === "/ts.ts") {
        const offset = tsStart(buf);
        const data = offset ? buf.slice(offset) : buf;
        res.writeHead(200, {
          "Content-Type":  "video/MP2T",
          "Content-Length": data.length,
          "Access-Control-Allow-Origin": "*",
        });
        res.end(data);
        return;
      }

      // ── Playlist (/m3u8) ─────────────────────────────────────────────────
      const body = buf.toString("utf8");
      if (!body.includes("#EXTM3U")) {
        res.writeHead(502); res.end("Not an m3u8:\n" + body.slice(0, 200)); return;
      }

      const baseUrl      = targetUrl.substring(0, targetUrl.lastIndexOf("/") + 1);
      const origin       = `http://localhost:${PORT}`;
      const refParam     = referer ? "&referer=" + encodeURIComponent(referer) : "";
      // mode=redirect: the CDN's bytes are already clean MPEG-TS and only the
      // segment *name* is the problem, so hand back 302s and let the player
      // pull video straight from the CDN. mode=strip (default) is for CDNs
      // that also wrap each segment in a PNG header and must be read here.
      const redirectOnly = url.searchParams.get("mode") === "redirect";
      const modeParam    = redirectOnly ? "&mode=redirect" : "";

      const lines = body.split("\n");
      const out   = [];
      let nextIsVariant = false;

      for (const line of lines) {
        const t = line.trim();
        if (!t) { out.push(line); continue; }

        if (t.startsWith("#EXT-X-STREAM-INF:")) { nextIsVariant = true;  out.push(line); continue; }
        if (t.startsWith("#EXTINF:"))            { nextIsVariant = false; out.push(line); continue; }
        if (t.startsWith("#"))                   {                        out.push(line); continue; }

        const abs = t.startsWith("http") ? t : baseUrl + t;
        if (nextIsVariant) {
          // Variant playlist — route through /m3u8
          out.push(origin + "/m3u8?url=" + encodeURIComponent(abs) + refParam + modeParam);
          nextIsVariant = false;
        } else if (redirectOnly) {
          // Segment — 302 straight back to the CDN; no bytes pass through here.
          out.push(origin + "/seg.ts?url=" + encodeURIComponent(abs) + refParam);
        } else {
          // Segment — route through /ts.ts (.ts suffix passes libmpv extension_picky;
          // PNG header is stripped server-side above)
          out.push(origin + "/ts.ts?url=" + encodeURIComponent(abs) + refParam);
        }
      }

      const rewritten = out.join("\n");
      res.writeHead(200, {
        "Content-Type":  "application/vnd.apple.mpegurl",
        "Content-Length": Buffer.byteLength(rewritten),
        "Access-Control-Allow-Origin": "*",
      });
      res.end(rewritten);
    });
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`HLS proxy ready on http://localhost:${PORT}`);
});
