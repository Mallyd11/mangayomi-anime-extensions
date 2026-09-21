// Senshi playlist proxy — shared by proxy.js (Node) and worker.js (Cloudflare).
//
// Why it exists: senshi.to streams through vidcloud/bcdn, and every playlist
// on that CDN is AES-256-GCM encrypted ("EM3U8v1:" + base64(iv|ciphertext|tag)).
// The site's own player decrypts them in JS with a custom hls.js loader; libmpv
// (the Mangayomi player) can't, and a Mangayomi extension has no way to hand
// it a playlist it built itself — mpv rejects data: URLs, mpv's own EDL format
// cannot seek in these segments (the CDN ignores Range), and the app exposes
// no other hook. So this module does the one thing that has to happen
// server-side: fetch → decrypt → rewrite, and returns plain HLS.
//
// Only *playlists* pass through here (a few KB). Segments are never proxied:
// they are clean MPEG-TS, and the player fetches them straight from the CDN
// with the Referer/Origin/User-Agent headers the extension attaches to the
// video (ffmpeg forwards them to segment requests because this playlist was
// itself loaded over HTTP — it would not for a data: playlist).
//
// Routes (all GET):
//   /senshi/master.m3u8?id=<remote_source_id>&audio=ja|en&maxh=<pixels>
//       Looks the source up, decrypts the master playlist and returns one whose
//       audio group holds only the wanted language and whose variants are
//       capped at maxh. Child playlists point back at /senshi/media.m3u8.
//   /senshi/media.m3u8?u=<encoded playlist url>
//       Decrypts one media playlist and rewrites each segment to an absolute
//       CDN URL ending in "?x=.ts". The CDN ignores the query; ffmpeg's
//       extension_picky check reads the last dot in the URL and the segments
//       are otherwise named ".jpg".

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";

// The CDN 403s anything without all three of these — Referer alone is not enough.
const UP_HEADERS = {
  "User-Agent": UA,
  "Referer": "https://senshi.to/",
  "Origin": "https://senshi.to",
  "Accept": "*/*",
};

const SOURCES_URL = "https://s.vidcloud.se/_v1/sources?id=";

// Playlist key = A XOR B, two 32-byte arrays shipped in senshi.to's WatchPage
// chunk (ir / lr). If playlists ever stop decrypting, re-read that chunk first.
const KEY_A = [
  226, 24, 149, 40, 170, 108, 184, 157, 168, 18, 90, 64, 186, 69, 66, 110,
  109, 169, 203, 138, 29, 188, 78, 25, 203, 185, 211, 252, 76, 126, 134, 42,
];
const KEY_B = [
  140, 250, 231, 59, 141, 129, 254, 6, 30, 203, 96, 249, 13, 237, 122, 106,
  60, 57, 126, 48, 152, 101, 128, 186, 122, 88, 171, 249, 187, 202, 40, 220,
];

// A proxy that fetches whatever URL it is given, with senshi's credentials
// attached, would be an open relay. Playlist hosts are always one of these.
const ALLOWED_HOST = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.(bcdn\d*|anicdn|vidcloud)\.se\//i;

const PREFIX = "EM3U8v1:";

let keyPromise = null;
function cryptoKey() {
  if (!keyPromise) {
    const raw = new Uint8Array(KEY_A.map((b, i) => b ^ KEY_B[i]));
    keyPromise = crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  }
  return keyPromise;
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Plain playlists pass through untouched, exactly like the site's own loader.
async function decryptPlaylist(text) {
  const t = String(text).trim();
  if (!t.startsWith(PREFIX)) return t;
  const raw = b64ToBytes(t.slice(PREFIX.length));
  if (raw.length < 29) throw new Error("Truncated encrypted playlist");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: raw.subarray(0, 12) },
    await cryptoKey(),
    raw.subarray(12)
  );
  return new TextDecoder().decode(plain);
}

async function fetchText(url) {
  const res = await fetch(url, { headers: UP_HEADERS });
  if (!res.ok) throw new Error("Upstream " + res.status + " for " + url.split("?")[0]);
  return await res.text();
}

async function fetchPlaylist(url) {
  const body = await decryptPlaylist(await fetchText(url));
  if (body.indexOf("#EXTM3U") < 0) throw new Error("Not a playlist: " + body.slice(0, 120));
  return body;
}

function absolutise(ref, base) {
  if (/^https?:\/\//i.test(ref)) return ref;
  if (ref.charAt(0) === "/") return new URL(base).origin + ref;
  return base.substring(0, base.lastIndexOf("/") + 1) + ref;
}

function mediaUrl(selfOrigin, absPlaylist) {
  return selfOrigin + "/senshi/media.m3u8?u=" + encodeURIComponent(absPlaylist);
}

function attr(line, name) {
  const m = line.match(new RegExp("(?:^|[:,])" + name + '=("([^"]*)"|[^,]*)'));
  return m ? (m[2] !== undefined ? m[2] : m[1]) : "";
}

// ── /senshi/master.m3u8 ───────────────────────────────────────────────────────

async function buildMaster(selfOrigin, params) {
  const id = params.get("id") || "";
  if (!/^\d+$/.test(id)) throw new Error("Missing or bad id");
  const audio = (params.get("audio") || "ja").toLowerCase();
  const maxh = parseInt(params.get("maxh") || "0", 10) || 0;

  const info = JSON.parse(await fetchText(SOURCES_URL + id));
  const entry = Array.isArray(info) ? info[0] : info;
  const src = entry && entry.source && entry.source.src;
  if (!src) throw new Error("No source for id " + id);

  const body = await fetchPlaylist(src);
  const lines = body.split(/\r?\n/);

  // Audio renditions. Wanted one first; when the language isn't there (a
  // sub-only release asked for "en"), fall back to whatever the master offers
  // rather than dropping the audio.
  const medias = [];
  for (const raw of lines) {
    const l = raw.trim();
    if (l.indexOf("#EXT-X-MEDIA:") === 0 && attr(l, "TYPE") === "AUDIO") medias.push(l);
  }
  const wants = (l) => {
    const lang = attr(l, "LANGUAGE").toLowerCase();
    const uri = attr(l, "URI").toLowerCase();
    return lang === audio || lang.indexOf(audio) === 0 || uri.indexOf("_" + audio + "/") >= 0;
  };
  let keep = medias.filter(wants);
  if (keep.length === 0) {
    keep = medias.filter((l) => /DEFAULT=YES/i.test(l));
    if (keep.length === 0 && medias.length) keep = [medias[0]];
  }
  keep = keep.slice(0, 1);

  // Variants, capped at maxh (never emptied: fall back to the smallest).
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.indexOf("#EXT-X-STREAM-INF:") !== 0) continue;
    let uri = "";
    for (let j = i + 1; j < lines.length; j++) {
      const u = lines[j].trim();
      if (u && u.charAt(0) !== "#") { uri = u; break; }
    }
    if (!uri) continue;
    const h = parseInt((attr(l, "RESOLUTION").split("x")[1] || "0"), 10) || 0;
    variants.push({ info: l, uri: uri, h: h });
  }
  let chosen = maxh ? variants.filter((v) => !v.h || v.h <= maxh) : variants;
  if (chosen.length === 0 && variants.length) {
    chosen = [variants.slice().sort((a, b) => a.h - b.h)[0]];
  }
  if (chosen.length === 0) throw new Error("Master playlist has no variants");

  const out = ["#EXTM3U", "#EXT-X-VERSION:3"];
  let audioGroup = null;
  for (const l of keep) {
    audioGroup = attr(l, "GROUP-ID") || "audio";
    const uri = mediaUrl(selfOrigin, absolutise(attr(l, "URI"), src));
    // Single rendition → make it the default so libmpv plays it without asking.
    const rewritten = l
      .replace(/URI="[^"]*"/, 'URI="' + uri + '"')
      .replace(/DEFAULT=(YES|NO)/i, "DEFAULT=YES")
      .replace(/(AUTOSELECT=)(YES|NO)/i, "$1YES");
    out.push(/AUTOSELECT=/i.test(rewritten) ? rewritten : rewritten + ",AUTOSELECT=YES");
  }
  // Highest first so the player's default pick is the best one available.
  chosen.sort((a, b) => b.h - a.h);
  for (const v of chosen) {
    let info = v.info;
    if (!audioGroup) info = info.replace(/,?AUDIO="[^"]*"/, "");
    out.push(info);
    out.push(mediaUrl(selfOrigin, absolutise(v.uri, src)));
  }
  return out.join("\n") + "\n";
}

// ── /senshi/media.m3u8 ────────────────────────────────────────────────────────

async function buildMedia(params) {
  const u = params.get("u") || "";
  if (!ALLOWED_HOST.test(u)) throw new Error("Host not allowed");
  const body = await fetchPlaylist(u);
  const out = [];
  for (const raw of body.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) { out.push(raw); continue; }
    if (t.charAt(0) === "#") { out.push(raw); continue; }
    const abs = absolutise(t, u);
    out.push(abs + (abs.indexOf("?") >= 0 ? "&" : "?") + "x=.ts");
  }
  return out.join("\n") + "\n";
}

// ── entry point ───────────────────────────────────────────────────────────────

// Returns { status, headers, body }, or null when the path isn't a senshi route.
export async function handleSenshi(pathname, searchParams, selfOrigin) {
  // Liveness probe for the extension: proves this is a proxy that knows the
  // Senshi routes (an older proxy.js answers 400 here), without touching the CDN.
  if (pathname === "/senshi/ping") {
    return {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
      body: "senshi-proxy ok",
    };
  }
  if (pathname !== "/senshi/master.m3u8" && pathname !== "/senshi/media.m3u8") return null;
  const headers = {
    "Content-Type": "application/vnd.apple.mpegurl",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  };
  try {
    const body = pathname === "/senshi/master.m3u8"
      ? await buildMaster(selfOrigin, searchParams)
      : await buildMedia(searchParams);
    return { status: 200, headers, body };
  } catch (e) {
    return {
      status: 502,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" },
      body: "senshi proxy: " + (e && e.message ? e.message : e),
    };
  }
}
