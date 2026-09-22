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
//   /senshi/dl/<remote_source_id>/<ja|en>.m3u8
//       For DOWNLOADS. Mangayomi's own downloader (see [[mangayomi-downloader-
//       and-client-rules]] in this repo's memory) only follows #EXT-X-STREAM-INF
//       variant selection — it has no support for HLS's detached #EXT-X-MEDIA
//       audio group, which is how every other route here delivers audio (video
//       and audio are always separate segment files on this CDN). Handed the
//       normal playback playlist, it would silently download picture with no
//       sound. This route instead returns a plain, single-rendition media
//       playlist whose segments are pre-paired video+audio, muxed into one
//       real two-stream MPEG-TS file each by /senshi/dl-seg.ts. The path must
//       end in exactly ".m3u8" with no query string — the downloader's HLS
//       gate is a raw string suffix check, unlike its check for a progressive
//       file, which does ignore the query.
//   /senshi/dl-seg.ts?v=<encoded video segment url>&a=<encoded audio segment url>
//       Fetches both raw segments and muxes them into one MPEG-TS file with two
//       elementary streams (see muxSegments). Stateless: everything needed is
//       in the query, so the per-episode playlist lookup happens once (when the
//       .m3u8 above is built), not once per segment.

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

// Upstream requests have no default timeout in either runtime, so a stalled
// CDN connection (seen once in testing: no error, no data, just silence)
// would hang this handler — and every later request queued behind it on the
// same origin's connection pool — forever. AbortSignal.timeout is standard in
// both Node 18+ and Workers.
const UPSTREAM_TIMEOUT_MS = 15000;

async function fetchText(url) {
  const res = await fetch(url, { headers: UP_HEADERS, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
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

// ── /senshi/dl (downloads: muxed video+audio) ───────────────────────────────────

// A parsed media playlist's segments: [{url, dur}], url absolute.
function parseSegments(body, base) {
  const out = [];
  let dur = null;
  for (const raw of body.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    if (l.indexOf("#EXTINF:") === 0) { dur = parseFloat(l.slice(8)); continue; }
    if (l.charAt(0) === "#") continue;
    out.push({ url: absolutise(l, base), dur: dur === null || isNaN(dur) ? 6 : dur });
    dur = null;
  }
  return out;
}

// Picks the best video variant and the matching audio rendition out of a
// decrypted master playlist. Mirrors buildMaster's selection rules but
// returns the resolved playlist URLs instead of rewriting text.
function selectDownloadSources(masterBody, masterUrl, audio) {
  const lines = masterBody.split(/\r?\n/);
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
  let audioLine = medias.find(wants) || medias.find((l) => /DEFAULT=YES/i.test(l)) || medias[0];
  if (!audioLine) throw new Error("No audio rendition in master playlist");

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
    variants.push({ uri, h });
  }
  if (variants.length === 0) throw new Error("Master playlist has no variants");
  variants.sort((a, b) => b.h - a.h);

  return {
    videoUrl: absolutise(variants[0].uri, masterUrl),
    audioUrl: absolutise(attr(audioLine, "URI"), masterUrl),
  };
}

async function buildDownloadPlaylist(selfOrigin, id, audio) {
  const info = JSON.parse(await fetchText(SOURCES_URL + id));
  const entry = Array.isArray(info) ? info[0] : info;
  const src = entry && entry.source && entry.source.src;
  if (!src) throw new Error("No source for id " + id);

  const master = await fetchPlaylist(src);
  const { videoUrl, audioUrl } = selectDownloadSources(master, src, audio);
  const [videoBody, audioBody] = await Promise.all([fetchPlaylist(videoUrl), fetchPlaylist(audioUrl)]);
  const videoSegs = parseSegments(videoBody, videoUrl);
  const audioSegs = parseSegments(audioBody, audioUrl);
  if (videoSegs.length === 0) throw new Error("Video playlist has no segments");

  // Segment counts occasionally differ by one; pair only what both have and
  // let the last video segment go out silent rather than fail the download.
  const n = Math.min(videoSegs.length, audioSegs.length);
  const out = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:11", "#EXT-X-PLAYLIST-TYPE:VOD"];
  for (let i = 0; i < videoSegs.length; i++) {
    const v = videoSegs[i];
    const segUrl = selfOrigin + "/senshi/dl-seg.ts?v=" + encodeURIComponent(v.url) +
      (i < n ? "&a=" + encodeURIComponent(audioSegs[i].url) + "&lang=" + audio : "");
    out.push("#EXTINF:" + v.dur.toFixed(6) + ",");
    out.push(segUrl);
  }
  out.push("#EXT-X-ENDLIST");
  return out.join("\n") + "\n";
}

// ── MPEG-TS mux: two elementary-stream segments -> one two-stream segment ──────
//
// Senshi's video and audio segments are independent, self-contained MPEG-TS
// files, each with its own PAT/PMT and (confirmed against three real segments)
// the SAME elementary-stream PID (0x100) — concatenating them as-is would
// collide both streams onto one PID. So: keep video's PAT/PMT/PID as they are,
// remap every audio packet from 0x100 to 0x101, build one combined PMT
// declaring both streams (keeping the video entry byte-for-byte and appending
// an audio entry, including its language descriptor), and proportionally
// interleave the two elementary-stream packet sequences. Verified against a
// real segment pair: ffprobe reports both streams with correct durations, and
// the app's own libmpv decodes both in sync (avsync 0.000000, 0 dropped).
const TS_PKT = 188, TS_SYNC = 0x47;

// CRC-32/MPEG-2: poly 0x04C11DB7, init 0xFFFFFFFF, no reflection, no final xor.
// Validated byte-for-byte against two real PMTs' own CRC32 fields before ever
// being used to sign a PMT this code built itself.
function crc32Mpeg(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 24;
    for (let b = 0; b < 8; b++) crc = (crc & 0x80000000) ? (((crc << 1) ^ 0x04c11db7) >>> 0) : ((crc << 1) >>> 0);
  }
  return crc >>> 0;
}

function tsPid(pkt, off) {
  return ((pkt[off + 1] & 0x1f) << 8) | pkt[off + 2];
}

function concatBytes(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// One PAT packet declaring program 1 -> PMT PID 0x1000. Fixed content, so it
// is simplest and safest to reuse the exact bytes captured from a real Senshi
// video segment (its own PAT) rather than reconstruct one field by field.
function buildPat() {
  const pkt = new Uint8Array(TS_PKT).fill(0xff);
  const known = [
    0x47, 0x40, 0x00, 0x10, 0x00, 0x00, 0xb0, 0x0d, 0x00, 0x01, 0xc1, 0x00,
    0x00, 0x00, 0x01, 0xf0, 0x00, 0x2a, 0xb1, 0x04, 0xb2,
  ];
  pkt.set(known, 0);
  return pkt;
}

// Video's own PMT entry (stream_type 0x1b/H.264, PID 0x100) plus a new audio
// entry at audioPid, with descriptor bytes carried over unchanged so the
// output keeps its language tag (e.g. the 6-byte ISO-639 descriptor for "jpn").
function buildPmt(audioPid, audioDescriptor) {
  const desc = audioDescriptor || new Uint8Array(0);
  const afterLength = concatBytes([
    Uint8Array.from([0x00, 0x01]),                                     // program_number = 1
    Uint8Array.from([0xc1, 0x00, 0x00]),                                // version/current, section#, last-section#
    Uint8Array.from([0xe1, 0x00]),                                      // reserved(111) + PCR_PID(0x100)
    Uint8Array.from([0xf0, 0x00]),                                      // reserved(1111) + program_info_length(0)
    Uint8Array.from([0x1b, 0xe1, 0x00, 0xf0, 0x00]),                    // ES: video, type 0x1b, PID 0x100
    Uint8Array.from([
      0x0f,                                                             // ES: audio, type 0x0f (AAC ADTS)
      0xe0 | ((audioPid >> 8) & 0x1f), audioPid & 0xff,                 // reserved(111) + PID
      0xf0 | ((desc.length >> 8) & 0x0f), desc.length & 0xff,           // reserved(1111) + ES_info_length
    ]),
    desc,
  ]);
  const sectionLength = afterLength.length + 4; // + CRC32
  const section = concatBytes([
    Uint8Array.from([0x02, 0xb0 | ((sectionLength >> 8) & 0x0f), sectionLength & 0xff]),
    afterLength,
  ]);
  const crc = crc32Mpeg(section);
  const crcBytes = Uint8Array.from([(crc >>> 24) & 0xff, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff]);
  const payload = concatBytes([Uint8Array.from([0x00]), section, crcBytes]); // pointer_field + section + CRC

  const pkt = new Uint8Array(TS_PKT).fill(0xff);
  pkt[0] = TS_SYNC;
  pkt[1] = 0x40 | ((0x1000 >> 8) & 0x1f); // PUSI=1
  pkt[2] = 0x1000 & 0xff;
  pkt[3] = 0x10; // adaptation_field_control = payload only, continuity_counter = 0
  pkt.set(payload, 4);
  return pkt;
}

function remapPid(pkt, newPid) {
  const out = pkt.slice();
  out[1] = (out[1] & 0xe0) | ((newPid >> 8) & 0x1f);
  out[2] = newPid & 0xff;
  return out;
}

function extractEsPackets(buf, esPid) {
  const out = [];
  const n = buf.length - (buf.length % TS_PKT);
  for (let off = 0; off + TS_PKT <= n; off += TS_PKT) {
    if (buf[off] !== TS_SYNC) break; // misaligned tail, stop rather than misread
    if (tsPid(buf, off) === esPid) out.push(buf.subarray(off, off + TS_PKT));
  }
  return out;
}

// Spreads the (much smaller) audio packet stream through the video one in
// proportion, Bresenham-style, so audio isn't clumped at the start or end.
function interleaveProportional(a, b) {
  const out = [];
  let ai = 0, bi = 0, acc = 0;
  const ratio = a.length / Math.max(1, b.length);
  while (ai < a.length || bi < b.length) {
    if (bi >= b.length) { out.push(a[ai++]); continue; }
    if (ai >= a.length) { out.push(b[bi++]); continue; }
    if (acc < ratio) { out.push(a[ai++]); acc += 1; } else { out.push(b[bi++]); acc -= ratio; }
  }
  return out;
}

const AUDIO_OUT_PID = 0x101;
const JPN_LANGUAGE_DESCRIPTOR = Uint8Array.from([0x0a, 0x04, 0x6a, 0x70, 0x6e, 0x00]); // ISO-639 "jpn"
const ENG_LANGUAGE_DESCRIPTOR = Uint8Array.from([0x0a, 0x04, 0x65, 0x6e, 0x67, 0x00]); // ISO-639 "eng"

function muxSegments(videoBytes, audioBytes, lang) {
  const videoEs = extractEsPackets(videoBytes, 0x100);
  const audioEs = extractEsPackets(audioBytes, 0x100).map((p) => remapPid(p, AUDIO_OUT_PID));
  if (videoEs.length === 0) throw new Error("No video packets found (PID 0x100)");
  const desc = lang === "en" ? ENG_LANGUAGE_DESCRIPTOR : JPN_LANGUAGE_DESCRIPTOR;
  return concatBytes([buildPat(), buildPmt(AUDIO_OUT_PID, desc), ...interleaveProportional(videoEs, audioEs)]);
}

async function fetchBytes(url) {
  const res = await fetch(url, { headers: UP_HEADERS, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  if (!res.ok) throw new Error("Upstream " + res.status + " for " + url.split("?")[0]);
  return new Uint8Array(await res.arrayBuffer());
}

async function buildDownloadSegment(searchParams) {
  const v = searchParams.get("v") || "";
  const a = searchParams.get("a") || "";
  const lang = searchParams.get("lang") === "en" ? "en" : "ja";
  if (!ALLOWED_HOST.test(v) || (a && !ALLOWED_HOST.test(a))) throw new Error("Host not allowed");
  const [videoBytes, audioBytes] = await Promise.all([
    fetchBytes(v),
    a ? fetchBytes(a) : Promise.resolve(null),
  ]);
  return audioBytes ? muxSegments(videoBytes, audioBytes, lang) : videoBytes;
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
  const dlPlaylistMatch = pathname.match(/^\/senshi\/dl\/(\d+)\/(ja|en)\.m3u8$/);

  if (pathname === "/senshi/dl-seg.ts") {
    try {
      const body = await buildDownloadSegment(searchParams);
      return {
        status: 200,
        headers: { "Content-Type": "video/MP2T", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
        body,
      };
    } catch (e) {
      return {
        status: 502,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" },
        body: "senshi proxy: " + (e && e.message ? e.message : e),
      };
    }
  }

  if (pathname !== "/senshi/master.m3u8" && pathname !== "/senshi/media.m3u8" && !dlPlaylistMatch) return null;
  const headers = {
    "Content-Type": "application/vnd.apple.mpegurl",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  };
  try {
    const body = pathname === "/senshi/master.m3u8" ? await buildMaster(selfOrigin, searchParams)
      : pathname === "/senshi/media.m3u8" ? await buildMedia(searchParams)
      : await buildDownloadPlaylist(selfOrigin, dlPlaylistMatch[1], dlPlaylistMatch[2]);
    return { status: 200, headers, body };
  } catch (e) {
    return {
      status: 502,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" },
      body: "senshi proxy: " + (e && e.message ? e.message : e),
    };
  }
}
