// ════════════════════════════════════════════════════════════════════════════
//  ReAnime relay — Cloudflare Worker (KV-backed blob store)
// ════════════════════════════════════════════════════════════════════════════
//
//  WHY THIS EXISTS (read tools/reanime-proxy-worker.js's header first — that
//  was attempt #1, conclusively proven dead: flixcloud's CDN blocks requests
//  by IP/ASN, so NO cloud-hosted compute — Workers, Cloudflare's own Browser
//  Rendering with a real headless Chromium, anything — can ever fetch the
//  video data. Confirmed three independent ways; see memory/reanime-extension.md.
//
//  This is attempt #2: relay through the user's own device instead. Mangayomi
//  exposes evaluateJavascriptViaWebview(url, headers, scripts) to JS
//  extensions — it runs a script inside a real, hidden native WebView, on the
//  user's own IP with a genuine browser TLS fingerprint. The extension points
//  that WebView at the flixcloud embed page and runs a script that resolves +
//  decrypts the stream AND fetches every segment (all from a context that
//  passes the CDN's checks), then uploads each segment here. This worker is a
//  dumb store: receive segments/playlists, serve them back as a normal HLS
//  stream once everything has arrived. The player only ever talks to this
//  worker, never to flixcloud directly.
//
//  This is NOT live streaming — the in-page script downloads the whole
//  episode before the extension hands a stream URL to the player, since the
//  webview bridge only supports one-shot script execution, not an ongoing
//  relay. Expect a real wait before playback starts, proportional to episode
//  size and the device's upload+download speed (data round-trips: device <-
//  flixcloud, then device -> this worker, then player <- this worker).
//
//  REQUIRES a KV binding named RELAY_KV (created via the Cloudflare API/
//  dashboard: Workers & Pages -> this worker -> Settings -> Bindings -> KV).
//
//  ENDPOINTS
//    POST /relay/segment?job=<id>&rid=<renditionId>&idx=<n>   body: raw bytes
//    GET  /relay/segment?job=<id>&rid=<renditionId>&idx=<n>
//    POST /relay/playlist?job=<id>&rid=<renditionId>          body: m3u8 text
//    GET  /relay/playlist?job=<id>&rid=<renditionId>
//    POST /relay/master?job=<id>                              body: m3u8 text
//    GET  /relay/master.m3u8?job=<id>
//    GET  /relay/status?job=<id>                               {ready:bool}
// ════════════════════════════════════════════════════════════════════════════

const CORS = { "Access-Control-Allow-Origin": "*" };
const TTL = 6 * 60 * 60; // 6 hours

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      const job = url.searchParams.get("job");
      if (url.pathname === "/relay/segment") {
        const rid = url.searchParams.get("rid"), idx = url.searchParams.get("idx");
        if (!job || !rid || idx === null) return new Response("missing params", { status: 400, headers: CORS });
        const key = `seg:${job}:${rid}:${idx}`;
        if (request.method === "POST") {
          const buf = new Uint8Array(await request.arrayBuffer());
          await env.RELAY_KV.put(key, buf, { expirationTtl: TTL });
          return new Response("ok", { headers: CORS });
        }
        const buf = await env.RELAY_KV.get(key, "arrayBuffer");
        if (!buf) return new Response("not found", { status: 404, headers: CORS });
        const bytes = new Uint8Array(buf);
        let contentType = "video/mp2t";
        if (!(bytes.length > 0 && bytes[0] === 0x47 && (bytes.length < 188 || bytes[188] === 0x47))) {
          contentType = "application/octet-stream";
        }
        return new Response(buf, { headers: { "Content-Type": contentType, ...CORS } });
      }
      if (url.pathname === "/relay/playlist") {
        const rid = url.searchParams.get("rid");
        if (!job || !rid) return new Response("missing params", { status: 400, headers: CORS });
        const key = `pl:${job}:${rid}`;
        if (request.method === "POST") {
          const text = await request.text();
          await env.RELAY_KV.put(key, text, { expirationTtl: TTL });
          return new Response("ok", { headers: CORS });
        }
        const text = await env.RELAY_KV.get(key);
        if (!text) return new Response("not found", { status: 404, headers: CORS });
        return new Response(text, { headers: { "Content-Type": "application/vnd.apple.mpegurl", ...CORS } });
      }
      if (url.pathname === "/relay/master") {
        if (!job) return new Response("missing job", { status: 400, headers: CORS });
        if (request.method !== "POST") return new Response("use POST", { status: 405, headers: CORS });
        const text = await request.text();
        await env.RELAY_KV.put(`master:${job}`, text, { expirationTtl: TTL });
        return new Response("ok", { headers: CORS });
      }
      if (url.pathname === "/relay/master.m3u8") {
        if (!job) return new Response("missing job", { status: 400, headers: CORS });
        const text = await env.RELAY_KV.get(`master:${job}`);
        if (!text) return new Response("not ready", { status: 404, headers: CORS });
        return new Response(text, { headers: { "Content-Type": "application/vnd.apple.mpegurl", ...CORS } });
      }
      if (url.pathname === "/relay/status") {
        if (!job) return new Response("missing job", { status: 400, headers: CORS });
        const text = await env.RELAY_KV.get(`master:${job}`);
        return new Response(JSON.stringify({ ready: !!text }), { headers: { "Content-Type": "application/json", ...CORS } });
      }
      if (url.pathname === "/") return new Response("ReAnime relay worker is running.", { headers: CORS });
      return new Response("Not found", { status: 404, headers: CORS });
    } catch (err) {
      return new Response("Worker error: " + (err && (err.stack || err.message) || String(err)), { status: 500, headers: CORS });
    }
  },
};
