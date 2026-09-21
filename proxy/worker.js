// HLS proxy worker — strips the 70-byte PNG wrapper that nekostream-family
// CDNs prepend to every MPEG-TS segment, and rewrites playlist URLs so
// libmpv's extension_picky check passes (segment paths end in .ts).
//
// Endpoints:
//   GET /m3u8?url=<encoded>&referer=<encoded>
//     Fetch an HLS master or media playlist from <url> with the given Referer,
//     rewrite all child URLs to go through this worker, return the playlist.
//   GET /ts.ts?url=<encoded>&referer=<encoded>
//     Fetch one MPEG-TS segment from <url> with the given Referer, strip the
//     leading PNG header (if present), return clean MPEG-TS.

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
function tsStart(view) {
  const limit = Math.min(view.length - 376, 4096);
  for (let i = 0; i < limit; i++) {
    if (view[i] === 0x47 && view[i + 188] === 0x47 && view[i + 376] === 0x47) return i;
  }
  return 0;
}

import { handleSenshi } from "./senshi-core.mjs";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Senshi (senshi.to) playlists are AES-encrypted; the decrypt/rewrite lives
    // in senshi-core.mjs so this worker and proxy.js run identical code.
    if (url.pathname.startsWith("/senshi/")) {
      const out = await handleSenshi(url.pathname, url.searchParams, url.origin);
      if (out) return new Response(out.body, { status: out.status, headers: out.headers });
    }

    const targetUrl = url.searchParams.get("url");
    const referer   = url.searchParams.get("referer") || "";

    if (!targetUrl) return new Response("Missing url parameter", { status: 400 });

    // ── Segment redirect (/seg.ts) ───────────────────────────────────────────
    // For CDNs that already serve clean MPEG-TS and are only rejected because
    // their segments are named .jpg/.image, no bytes need rewriting — the URL
    // just has to *end* in .ts when ffmpeg checks it. A 302 satisfies that and
    // then gets out of the way, so video streams straight from the CDN and
    // this worker carries a few hundred bytes per episode instead of gigabytes.
    if (url.pathname === "/seg.ts") {
      return Response.redirect(targetUrl, 302);
    }

    const upHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    };
    if (referer) {
      upHeaders["Referer"] = referer;
      try { upHeaders["Origin"] = new URL(referer).origin; } catch (_) {}
    }

    let upstream;
    try {
      upstream = await fetch(targetUrl, { headers: upHeaders });
    } catch (e) {
      return new Response("Fetch failed: " + e.message, { status: 502 });
    }
    if (!upstream.ok) {
      return new Response("Upstream " + upstream.status, { status: 502 });
    }

    // ── Segment request ──────────────────────────────────────────────────────
    if (url.pathname === "/ts.ts") {
      const buf  = await upstream.arrayBuffer();
      const view = new Uint8Array(buf);
      const offset = tsStart(view);
      return new Response(offset ? buf.slice(offset) : buf, {
        headers: {
          "Content-Type": "video/MP2T",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // ── Playlist request ─────────────────────────────────────────────────────
    const body = await upstream.text();
    if (!body.includes("#EXTM3U")) {
      return new Response("Not an m3u8: " + body.slice(0, 200), { status: 502 });
    }

    const baseUrl      = targetUrl.substring(0, targetUrl.lastIndexOf("/") + 1);
    const workerOrigin = url.origin;
    const refParam     = referer ? "&referer=" + encodeURIComponent(referer) : "";
    // mode=redirect: the CDN's bytes are already clean MPEG-TS and only the
    // segment *name* is the problem, so hand back 302s and let the player pull
    // video straight from the CDN. mode=strip (default) is for CDNs that also
    // wrap each segment in a PNG header and must be read here.
    const redirectOnly = url.searchParams.get("mode") === "redirect";
    const modeParam    = redirectOnly ? "&mode=redirect" : "";

    const lines = body.split("\n");
    const out   = [];
    let nextIsVariant = false;

    for (const line of lines) {
      const t = line.trim();
      if (!t) { out.push(line); continue; }

      if (t.startsWith("#EXT-X-STREAM-INF:")) {
        nextIsVariant = true;
        out.push(line);
        continue;
      }
      if (t.startsWith("#EXTINF:")) {
        nextIsVariant = false;
        out.push(line);
        continue;
      }
      if (t.startsWith("#")) {
        out.push(line);
        continue;
      }

      // URL line — make absolute, then wrap through this worker.
      const abs = t.startsWith("http") ? t : baseUrl + t;
      if (nextIsVariant) {
        // Variant playlist → proxy through /m3u8 (preserves HLS structure)
        out.push(workerOrigin + "/m3u8?url=" + encodeURIComponent(abs) + refParam + modeParam);
        nextIsVariant = false;
      } else if (redirectOnly) {
        // Segment → 302 straight back to the CDN; no bytes pass through here.
        out.push(workerOrigin + "/seg.ts?url=" + encodeURIComponent(abs) + refParam);
      } else {
        // Segment → proxy through /ts.ts (.ts extension satisfies libmpv's
        // extension_picky check; PNG header stripped server-side)
        out.push(workerOrigin + "/ts.ts?url=" + encodeURIComponent(abs) + refParam);
      }
    }

    return new Response(out.join("\n"), {
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Access-Control-Allow-Origin": "*",
      },
    });
  },
};
