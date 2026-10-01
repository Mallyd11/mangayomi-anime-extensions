const mangayomiSources = [
  {
    "name": "Anidap",
    "id": 543219876,
    "lang": "en",
    "baseUrl": "https://anidap.lol",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://anidap.lol",
    "typeSource": "single",
    "itemType": 1,
    "version": "1.10.0",
    "pkgPath": "anime/src/en/anidap.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": false,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/anidap.js",
    "apiUrl": "",
    "dateFormat": "",
    "dateFormatLocale": "",
    "additionalParams": "",
    "sourceCodeLanguage": 1,
    "notes": "",
  },
];

// chad.anidap.lol is the dedicated REST API subdomain (site moved from anidap.se to anidap.lol)
var CHAD = "https://chad.anidap.lol/rest/api";

// Servers the site actually serves, fastest first. Surveyed live 2026-10-01
// across two unrelated titles (case-closed-5j4se, goblin-slayer-xrhm5):
//
//   zuna  usable, 0.26-0.29s, tipped "Fast"  → the default
//   yuki  usable, 0.26-12.7s, occasionally 504 — the API's own default:true
//         pick; erratic, but serves a real separate dub track
//   sora  per-title: HTTP 500 on case-closed, but 0.28s and fine on
//         clevatess-season-2 for both sub and dub. Kept — a 500 on one title
//         is not a dead server, and the per-episode /servers call already
//         filters it out where it is not offered.
//
// NOTE on sora: its sub and dub URLs are the SAME krussdomi master, an
// audio-group playlist carrying Japanese (DEFAULT=YES) and English tracks.
// Picking its "dub" entry can therefore still come up Japanese — yuki is the
// dependable dub source.
//
// Everything previously listed here (kiwi, beep, mimi, uwu, miku, loli, zone,
// shiro, kami, vee) is no longer offered by /servers for any title tested.
// "kiwi" in particular was this extension's default while not existing at all,
// so every install fell through to fallbackProvider().
// Mochi is deliberately absent: it is MP4-only and reserved for download mode.
// Ordered by MEASURED STREAMING THROUGHPUT, not by the API's own "tip" text
// (which calls zuna "Fast" and says nothing about yuki). Same 1,074,232-byte
// segment pulled from each, 2026-10-01:
//
//   yuki  11.2 MB/s   (uq03g.phantomharbor.space)   <- fastest, the default
//   zuna   1.2 MB/s   (hls.dramahot.top)            ~9x slower than yuki
//   sora   not reliably measurable (audio-group master, per-title)
//
// yuki is also offered for sub on every title tested, so it is the default for
// both audio types. Its /sources call is the erratic part (0.26s typical, but
// 12.7s and a 504 observed) - that is start-up latency, not stream speed.
//
// DO NOT re-add "adp" — tried in v1.9.0 and removed in v1.9.1.
// It is the server anidap.lol's own embed player uses, and it is NOT a distinct
// source: it is the SAME yuki stream run through the site's
// cdnx.aniwatchtv.site/uwu proxy (confirmed by watching aniembed.se's network
// traffic — it calls the same API, mirrored at pp.animex.one, for yuki, then
// proxies the URL). It cannot play in this app. Tested against Mangayomi's own
// libmpv-2.dll: the proxied URL goes START_FILE -> END_FILE in 0.2s and never
// loads, because every /uwu/ URL — master, variant AND segments — is
// extension-less, which ffmpeg's HLS demuxer rejects. Appending "?x=.m3u8" or
// "#.m3u8" does not help: those only fix the outer URL, and the inner
// references come from the proxy's own playlist body, which we cannot rewrite.
// The same libmpv test loads yuki's direct URL fine (24:56, hls demuxer).
// There is nothing to gain either way — adp is slower than yuki (7.6 vs
// 11.2 MB/s) and carries identical content.
var SERVER_ORDER = ["yuki", "zuna", "sora"];

// Ticked out of the box. Kept next to SERVER_ORDER so the code fallback and the
// preference UI cannot drift apart.
var DEFAULT_SERVERS = ["yuki"];

// The old "Download mode" preference was removed in v1.10.0 and should not come
// back. It did two things and both are dead:
//   1. It called chad.anidap.lol/rest/api/download, which now answers
//      503 {"error":"failed to fetch links: invalid identifier: ..."} for every
//      identifier tried (AniList id AND slug). The site's own Download button
//      fails the same way: "Error fetching download links." It is broken
//      server-side, not mis-called.
//   2. It put "mochi" first as a confirmed-MP4 source. mochi is no longer
//      offered by /servers for any title.
// Downloads now go through Mangayomi's own m3u8 downloader against the normal
// playback streams, whose originalUrl path ends in .m3u8 so the downloader
// accepts them. Verified 2026-10-01: 10 of yuki's segments fetched
// concurrently all returned 200 (no 429), 0.04-0.25s each.

// ─── URL transform helpers ────────────────────────────────────────────────────
//
// Derived from anidap.lol/assets/api-9brnPJZ5.js (bundle as of 2026-07-14).
//
// Providers with complex transforms:
//   beep  → path extraction    → bd.24stream.xyz/media{path}
//   yuki  → uwu CDN proxy      → {cdn}.aniwatchtv.site/uwu/{encoded}
//   uwu   → uwu CDN proxy      → {cdn}.aniwatchtv.site/uwu/{encoded}
//   miku  → uwu CDN proxy      → {cdn}.aniwatchtv.site/uwu/{encoded}
//   shiro → crs proxy (xorHex) → crs.24stream.xyz/media/{hex}&origin=kem.clvd.xyz
//   kami  → crs proxy (xorHex) → crs.24stream.xyz/media/{hex}&origin=krussdomi.com
//   vee   → crs proxy (xorHex) → crs.24stream.xyz/media/{hex}&origin=animeonsen.xyz
//   mimi  → preprocessing only → hawk.aniwatchtv.site/media/{rest}
//   mochi → string replace     → mp4.24stream.xyz/storage
//   kiwi, loli, sora, zone, beep (if already bd.*) — identity after preprocessing
//
// Preprocessing (applied to ALL providers before provider-specific transform):
//   vivibebe.site/public/stream/ → hawk.aniwatchtv.site/media/

// XOR-with-137 hex encoder — used by crs.24stream.xyz proxy (b() in site JS)
function _xorHex137(url) {
  var r = "";
  for (var i = 0; i < url.length; i++) {
    var b = url.charCodeAt(i) ^ 137;
    r += (b < 16 ? "0" : "") + b.toString(16);
  }
  return r;
}

// URL-safe base64 encoder (avoids btoa dependency) — for uwu CDN proxy
function _b64url(bytes) {
  var t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var r = "";
  for (var i = 0; i < bytes.length; i += 3) {
    var b0 = bytes[i];
    var b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    var b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    r += t[b0 >> 2];
    r += t[((b0 & 3) << 4) | (b1 >> 4)];
    r += i + 1 < bytes.length ? t[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    r += i + 2 < bytes.length ? t[b2 & 63] : "=";
  }
  while (r.charAt(r.length - 1) === "=") r = r.slice(0, -1);
  return r.replace(/\+/g, "-").replace(/\//g, "_");
}

// N() from site JS: XOR-encodes (url + \0 + origin) with fixed key → base64url
var _UWU_KEY = "10b06cdc1ca48c9fb0b94af97cc040cf";
// Verified by DNS 2026-10-01: cx, nsx, pro, rl2 and rrl ALL fail to resolve.
// cdnx is what anidap.lol's own embed (aniembed.se) streams from today, and is
// the only prefix besides hawk that still exists.
var _UWU_CDN = [
  "https://cdnx.aniwatchtv.site"
];
var _uwuCounter = 0;

function _encodeUwu(url, origin) {
  var urlB = [], origB = [];
  for (var i = 0; i < url.length;    i++) urlB.push(url.charCodeAt(i) & 255);
  for (var i = 0; i < origin.length; i++) origB.push(origin.charCodeAt(i) & 255);
  var combined = new Uint8Array(urlB.length + 1 + origB.length);
  for (var i = 0; i < urlB.length; i++)  combined[i] = urlB[i];
  combined[urlB.length] = 0;
  for (var i = 0; i < origB.length; i++) combined[urlB.length + 1 + i] = origB[i];
  for (var i = 0; i < combined.length; i++)
    combined[i] ^= _UWU_KEY.charCodeAt(i % _UWU_KEY.length);
  return _b64url(combined);
}

function _uwuTransform(url, origin) {
  var cdn = _UWU_CDN[_uwuCounter % _UWU_CDN.length];
  _uwuCounter++;
  return cdn + "/uwu/" + _encodeUwu(url, origin);
}

// ─── Slug cache ───────────────────────────────────────────────────────────────
//
// The slug (e.g. "attack-on-titan-xyz12") is fetched from the Cloudflare-
// protected anidap.lol/info/{id}.data endpoint.  Caching it in memory means the
// Cloudflare hit only happens once per show per app session — subsequent
// getVideoList() calls find the slug here immediately.
//
// Chapter URLs are stored as "{anilistId}|{epNum}" (NO slug).  This keeps them
// backward-compatible with history entries created by earlier extension versions,
// preventing duplicate episodes from appearing in the library.
var _slugCache = {};

// ─── getVideoList cache ───────────────────────────────────────────────────────
//
// Mangayomi calls getVideoList() for both playback AND download of the same
// episode. Without caching this doubles the chad API request count, reliably
// hitting the per-IP rate limit (429) on the second call and returning an empty
// stream list — which is why "nothing happens" on download.
//
// The cache keeps the last result per chapter URL for up to 5 minutes.
// mochi Authorization tokens expire in 3 days so a 5-min cache is safe.
var _vlCache   = {};
var _vlCacheTs = {};
var VL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── AniList GraphQL (browse / search / metadata) ────────────────────────────

var PAGE_MEDIA_QUERY = [
  "query PageMedia($page:Int,$perPage:Int,$search:String,$sort:[MediaSort]){",
  "Page(page:$page,perPage:$perPage){",
  "pageInfo{currentPage hasNextPage}",
  "media(type:ANIME,isAdult:false,search:$search,sort:$sort){",
  "id title{romaji english native} coverImage{large medium}",
  "}}}"
].join("");

// Returns episodes that recently aired (TIME_DESC) — matches anidap.lol "Recent Episodes".
// perPage is set higher than needed to absorb adult/duplicate filtering.
var RECENT_EPISODES_QUERY = [
  "query RecentEp($page:Int,$perPage:Int,$before:Int){",
  "Page(page:$page,perPage:$perPage){",
  "pageInfo{currentPage hasNextPage}",
  "airingSchedules(notYetAired:false,airingAt_lesser:$before,sort:[TIME_DESC]){",
  "media{id isAdult title{romaji english native} coverImage{large medium}}",
  "}}}"
].join("");

var MEDIA_DETAIL_QUERY = [
  "query MediaDetail($id:Int){",
  "Media(id:$id,type:ANIME){",
  "id title{romaji english native}",
  "description(asHtml:false)",
  "coverImage{extraLarge large medium}",
  "episodes format genres status",
  "}}"
].join("");

// ─── Extension ───────────────────────────────────────────────────────────────

class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
  }

  get ua() {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
  }

  getPreference(key) {
    return new SharedPreferences().get(key);
  }

  getBaseUrl() {
    var url = this.getPreference("anidap_base_url");
    // Auto-migrate: anidap.se is now a static landing page — always use anidap.lol.
    // Stored preferences from old installs still say anidap.se, so override them here.
    if (!url || url === "https://anidap.se") return "https://anidap.lol";
    return url;
  }

  // Headers for requests to anidap.lol (Remix .data routes).
  // hasCloudflare is false — we bypass CF the same way HiAnime does: by
  // sending a realistic browser UA + Referer so the request scores low enough
  // on CF's bot detection to pass without any challenge.  Mangayomi's WebView
  // cookie-sharing mechanism was tried but proved unreliable for this site
  // (cf_clearance was never transferred to the HTTP client).
  get siteHeaders() {
    return {
      "User-Agent": this.ua,
      "Accept": "application/json, */*",
      "Referer": this.getBaseUrl() + "/",
    };
  }

  // Headers for requests to chad.anidap.lol (no Cloudflare)
  get chadHeaders() {
    return {
      "User-Agent": this.ua,
      "Accept": "application/json",
      "Origin": this.getBaseUrl(),
      "Referer": this.getBaseUrl() + "/",
    };
  }

  // ── AniList GraphQL ────────────────────────────────────────────────────────

  async gql(query, variables) {
    // Retry up to 3 times on 5xx — AniList occasionally returns transient 500s
    // that resolve immediately on the next request.
    var lastErr;
    for (var attempt = 0; attempt < 3; attempt++) {
      var res = await this.client.post(
        "https://graphql.anilist.co",
        { "Content-Type": "application/json", "Accept": "application/json" },
        { query: query, variables: variables }
      );
      if (res.statusCode === 200) {
        var json = JSON.parse(res.body);
        if (json.errors && json.errors.length) throw new Error(json.errors[0].message);
        return json.data;
      }
      lastErr = new Error("AniList HTTP " + res.statusCode);
      // Don't retry client errors (4xx) — they won't change on retry.
      if (res.statusCode < 500) throw lastErr;
    }
    throw lastErr;
  }

  titleByPref(title) {
    var pref = this.getPreference("anidap_title_lang");
    if (!title) return "";
    if (pref === "english") return title.english || title.romaji || "";
    if (pref === "native")  return title.native  || title.romaji || "";
    return title.romaji || title.english || "";
  }

  parseMedia(media) {
    var self = this;
    var list = [];
    (media || []).forEach(function(m) {
      if (!m || !m.id || !m.title) return;
      var name = self.titleByPref(m.title);
      if (!name) return;
      list.push({
        name: name,
        link: "/info/" + String(m.id),
        imageUrl: (m.coverImage && (m.coverImage.large || m.coverImage.medium)) || "",
      });
    });
    return list;
  }

  get supportsLatest() { return true; }

  async getPopular(page) {
    var data = await this.gql(PAGE_MEDIA_QUERY, { page: page, perPage: 24, sort: ["POPULARITY_DESC"] });
    var p = (data && data.Page) || {};
    return { list: this.parseMedia(p.media), hasNextPage: !!(p.pageInfo && p.pageInfo.hasNextPage) };
  }

  async getLatestUpdates(page) {
    // Use AniList's airing schedule (sorted newest-first) to mirror the
    // "Recent Episodes" feed on anidap.lol.  UPDATED_AT_DESC was sorting by
    // when AniList metadata changed — not when episodes actually aired.
    var self = this;
    var now  = Math.floor(Date.now() / 1000);
    var data = await this.gql(RECENT_EPISODES_QUERY, { page: page, perPage: 40, before: now });
    var p    = (data && data.Page) || {};

    // Deduplicate: same series can have multiple airing schedule entries.
    var seen = {};
    var list = [];
    (p.airingSchedules || []).forEach(function(sched) {
      var m = sched && sched.media;
      if (!m || m.isAdult || seen[m.id]) return;
      seen[m.id] = true;
      var name = self.titleByPref(m.title);
      if (!name) return;
      list.push({
        name: name,
        link: "/info/" + String(m.id),
        imageUrl: (m.coverImage && (m.coverImage.large || m.coverImage.medium)) || "",
      });
    });

    return { list: list, hasNextPage: !!(p.pageInfo && p.pageInfo.hasNextPage) };
  }

  async search(query, page, filters) {
    try {
      var vars = { page: page, perPage: 24 };
      if (query && query.length > 0) { vars.search = query; vars.sort = ["SEARCH_MATCH"]; }
      else { vars.sort = ["POPULARITY_DESC"]; }
      var data = await this.gql(PAGE_MEDIA_QUERY, vars);
      var p = (data && data.Page) || {};
      return { list: this.parseMedia(p.media), hasNextPage: !!(p.pageInfo && p.pageInfo.hasNextPage) };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  statusCode(s) {
    switch ((s || "").toUpperCase()) {
      case "RELEASING":        return 0;
      case "FINISHED":         return 1;
      case "NOT_YET_RELEASED": return 4;
      case "CANCELLED":        return 5;
      default:                 return 5;
    }
  }

  // ── Slug resolution ────────────────────────────────────────────────────────
  //
  // The site uses a unique slug per anime (e.g. "one-punch-man-season-3-i5r8m")
  // required for all chad.anidap.lol API calls.  It is embedded in the Remix
  // turbo-stream response at /info/{anilistId}.data as a flat serialised array.
  //
  // anidap.lol is Cloudflare-protected.  If this request fails, Mangayomi shows
  // a "bypass Cloudflare" dialog.  Complete the challenge in the webview —
  // Mangayomi then retries with the cf_clearance cookie it extracted.
  //
  // IMPORTANT: siteHeaders must NOT set User-Agent.  The cf_clearance cookie is
  // cryptographically bound to the UA that solved the challenge (the WebView's
  // UA).  If the HTTP client sends a different UA, CF rejects the cookie and the
  // bypass loop never escapes.

  extractSlug(arr) {
    if (!Array.isArray(arr)) return null;
    for (var i = 0; i < arr.length - 1; i++) {
      if (arr[i] === "id" &&
          typeof arr[i + 1] === "string" &&
          arr[i + 1].indexOf("-") >= 0 &&
          !/^\d+$/.test(arr[i + 1])) {
        return arr[i + 1];
      }
    }
    return null;
  }

  async getSlug(anilistId) {
    // Return from cache — avoids repeated Cloudflare hits for the same show.
    var cached = _slugCache[String(anilistId)];
    if (cached) return cached;

    // Preferred route: the site's own embed player, aniembed.se/e/{anilistId}/{ep}.
    // Keyed by AniList id, NO Cloudflare, ~4KB, ~0.4s (verified 2026-10-01 on 5
    // unrelated titles). Its SvelteKit SSR payload carries both the slug
    // (id:"...",anilistId:) and the full sub/dub provider lists, so this turns a
    // Cloudflare challenge into a plain GET. The CF route stays as a fallback.
    try {
      var em = await this.client.get(
        "https://aniembed.se/e/" + anilistId + "/1",
        { "User-Agent": this.ua }
      );
      if (em.statusCode === 200 && em.body) {
        var mm = em.body.match(/id:"([^"]+)",anilistId:/);
        if (mm && mm[1]) { _slugCache[String(anilistId)] = mm[1]; return mm[1]; }
      }
    } catch (e) { /* fall through to the Cloudflare route */ }

    // Fallback: the CF-protected anidap.lol/info/{id}.data route.
    //
    // siteHeaders intentionally omits User-Agent.  The cf_clearance cookie is
    // cryptographically bound to the UA used in the WebView challenge.  If the
    // HTTP client sends a different UA the cookie is rejected and the bypass
    // loop never escapes.  Omitting User-Agent lets Mangayomi's HTTP client use
    // the same default UA as its WebView.
    try {
      var res = await this.client.get(
        this.getBaseUrl() + "/info/" + anilistId + ".data",
        this.siteHeaders
      );
      if (res.statusCode === 200 && res.body) {
        var arr  = JSON.parse(res.body);
        var slug = this.extractSlug(arr);
        if (slug) { _slugCache[String(anilistId)] = slug; return slug; }
      }
    } catch (e) { /* CF blocked or parse error */ }

    return null;
  }

  // ── chad.anidap.lol REST API ────────────────────────────────────────────────

  async chadEpisodes(slug) {
    var res = await this.client.get(CHAD + "/episodes?id=" + slug, this.chadHeaders);
    if (res.statusCode !== 200 || !res.body) return [];
    var data = JSON.parse(res.body);
    return Array.isArray(data) ? data : [];
  }

  async chadServers(slug, epNum) {
    var res = await this.client.get(
      CHAD + "/servers?id=" + slug + "&epNum=" + epNum,
      this.chadHeaders
    );
    if (res.statusCode !== 200 || !res.body) return { subProviders: [], dubProviders: [] };
    return JSON.parse(res.body);
  }

  async chadSources(slug, epNum, type, providerId) {
    var res = await this.client.get(
      CHAD + "/sources?id=" + slug +
        "&epNum=" + epNum +
        "&type=" + type +
        "&providerId=" + providerId,
      this.chadHeaders
    );
    if (res.statusCode !== 200 || !res.body) return null;
    var data = JSON.parse(res.body);
    // Treat error responses as null
    if (data && data.error) return null;
    return data;
  }

  // Fetch direct download links from the site's own download button endpoint.
  // Uses AniList ID directly — no slug, no Cloudflare.
  // Response shape: { sub: { download: { "Kiwi-Stream-1080p": "https://…", … } }, dub: … | null }
  // ── URL transformation ─────────────────────────────────────────────────────
  //
  // Mirrors the HOST_HANDLERS map from anidap.lol/assets/api-9brnPJZ5.js.
  // See module-level helpers (_xorHex137, _uwuTransform) for the encoding.

  transformUrl(url, providerId) {
    if (!url) return url;

    // Preprocessing — applied before any provider-specific transform
    url = url.replace(
      "https://vivibebe.site/public/stream/",
      "https://hawk.aniwatchtv.site/media/"
    );

    switch (providerId) {
      // Path extraction → bd.24stream.xyz/media (strips /r2 prefix)
      case "beep":
        if (url.startsWith("https://bd.24stream.xyz/media")) return url;
        if (url.startsWith("/"))
          return "https://bd.24stream.xyz/media" + url.replace("/r2", "");
        return "https://bd.24stream.xyz/media" +
          url.replace(/https?:\/\/[^/]+/, "").replace("/r2", "");

      // String replace — same target as before
      case "mochi":
        return url.replace(
          "https://tools.fast4speed.rsvp",
          "https://mp4.24stream.xyz/storage"
        );

      // yuki is deliberately NOT proxied. It used to go through _uwuTransform,
      // but every host that produced was dead, so dub (yuki is the main dub
      // provider) pointed at an unresolvable host and buffered forever.
      // The raw /sources URL serves clean MPEG-TS directly — verified
      // 2026-10-01: 445KB segment starting 0x47 off fetch.nexabloom.top.
      // Note its segment host 404s on Range requests but serves fine without.

      // uwu CDN proxy (compound base64url encoding)
      case "uwu":  return _uwuTransform(url, "https://kwik.cx/");
      case "miku": return _uwuTransform(url, "https://allanime.uns.bio");

      // crs proxy (XOR-137 hex encoding + origin hint)
      case "shiro":
        return "https://crs.24stream.xyz/media/" + _xorHex137(url) +
          "&origin=https://kem.clvd.xyz/";
      case "kami":
        return "https://crs.24stream.xyz/media/" + _xorHex137(url) +
          "&origin=https://krussdomi.com";
      case "vee":
        if (url.startsWith("https://cdn.animeonsen.xyz")) return url;
        return "https://crs.24stream.xyz/media/" + _xorHex137(url) +
          "&origin=https://www.animeonsen.xyz/";

      // Identity after preprocessing: kiwi, mimi, loli, sora, and any unknown provider
      default: return url;
    }
  }

  // ── Detail ─────────────────────────────────────────────────────────────────

  async getDetail(url) {
    var anilistId = parseInt(url.replace(/[^0-9]/g, ""), 10);
    if (!anilistId) throw new Error("Cannot parse AniList ID: " + url);

    var data = await this.gql(MEDIA_DETAIL_QUERY, { id: anilistId });
    var m = (data && data.Media) || {};

    var name        = this.titleByPref(m.title || {});
    var imageUrl    = (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large)) || "";
    var description = (m.description || "").replace(/<[^>]*>/g, "").replace(/\n{3,}/g, "\n\n").trim();
    var genre       = m.genres || [];
    var status      = this.statusCode(m.status);
    var isMovie     = m.format === "MOVIE";

    // Fetch slug from CF-protected info.data.  After the webview bypass, this
    // call succeeds and the slug is cached for all subsequent getVideoList() calls.
    var slug = await this.getSlug(anilistId);

    var chapters = [];

    if (slug) {
      var episodes = await this.chadEpisodes(slug);
      episodes.forEach(function(ep) {
        var num    = ep.number;
        var title  = (ep.titles && ep.titles.en) || ("Episode " + num);
        var chName = isMovie ? title : ("E" + num + " — " + title);
        chapters.push({
          name: chName,
          // URL is "{anilistId}|{epNum}" — NO slug embedded.
          // getVideoList() resolves the slug via _slugCache (populated above),
          // so no extra Cloudflare hit is needed during playback/download.
          // Keeping the URL slug-free means it matches history entries created
          // by earlier extension versions, preventing duplicate chapters.
          url: anilistId + "|" + num,
          thumbnailUrl: ep.img || null,
          description: ep.description || null,
          isFiller: ep.isFiller || false,
        });
      });
    } else {
      // Fallback: numbered stubs from AniList episode count.
      // Streams will be unavailable until Cloudflare is bypassed.
      var epCount = m.episodes || 0;
      for (var j = 1; j <= epCount; j++) {
        chapters.push({
          name: isMovie ? name : ("Episode " + j),
          url: anilistId + "|" + j,
        });
      }
    }

    chapters.reverse(); // newest first

    return {
      name: name,
      imageUrl: imageUrl,
      description: description,
      genre: genre,
      status: status,
      link: this.getBaseUrl() + "/info/" + anilistId,
      chapters: chapters,
    };
  }

  // ── Video list ─────────────────────────────────────────────────────────────

  async getVideoList(url) {
    // Chapter URL format: "{anilistId}|{epNum}"
    // (older versions embedded the slug as a third segment — still handled below)
    var parts     = url.split("|");
    var anilistId = parts[0] || "";
    var epNum     = parts[1] || "";

    var audioPref  = this.getPreference("anidap_audio_pref");

    // Enabled servers (multi-select), ordered by SERVER_ORDER so the fast one
    // leads. Ids the site no longer serves are dropped rather than queried —
    // a pre-1.7.0 install has "kiwi" stored, which would otherwise make every
    // playback fall through to fallbackProvider(). An empty result (nothing
    // ticked, or everything ticked is dead) uses the fastest known server.
    var serverSel  = this.getPreference("anidap_servers") || [];
    var serverList = [];
    for (var soi = 0; soi < SERVER_ORDER.length; soi++) {
      if (serverSel.indexOf(SERVER_ORDER[soi]) >= 0) serverList.push(SERVER_ORDER[soi]);
    }
    if (!serverList.length) serverList = DEFAULT_SERVERS.slice();

    // Cache key includes mode + server list so changing either gives fresh results.
    var cacheKey = url + "|" + serverList.join(",");
    var _now = Date.now();
    if (_vlCache[cacheKey] && _now - (_vlCacheTs[cacheKey] || 0) < VL_CACHE_TTL_MS) {
      return _vlCache[cacheKey];
    }

    if (!anilistId || !epNum) return [];

    // Resolve slug — hits _slugCache first (populated by getDetail), so the
    // Cloudflare-protected endpoint is only called if the cache is cold.
    // Also handles legacy URLs that still have the slug as parts[2].
    var slug = parts[2] || await this.getSlug(anilistId);
    if (!slug) return [];

    var servers      = await this.chadServers(slug, epNum);
    var subProviders = servers.subProviders || [];
    var dubProviders = servers.dubProviders || [];

    // ── Stream helpers ─────────────────────────────────────────────────────

    // Last-resort provider when none of the enabled servers carry this episode:
    // the API default, else the first non-mochi entry. Mochi is MP4-only and is
    // skipped for HLS playback.
    // "kiwi" (this extension's hardcoded default enabled server) is no longer
    // offered by the site at all — confirmed on multiple titles 2026-09-27, the
    // API's /servers answer never includes it — so almost every viewer on
    // default settings lands here. The API's own default:true flag is not a
    // speed signal: measured live, its "yuki" provider took 22-26s to resolve
    // sub sources (dub was under 1s, so this is specific to sub resolution),
    // against under 1s for "zuna" — a provider the site's own tip text already
    // marks "Fast" for the exact same episode. Preferring a Fast-tipped
    // provider fixes the "episode buffers for 20+ seconds before anything
    // plays" symptom without hardcoding a provider id that could just as well
    // go stale the same way kiwi did. Falls back to the old default:true /
    // first-entry behavior when nothing is tipped Fast, so this only ever
    // changes the outcome when a faster option is actually on offer.
    function fallbackProvider(list) {
      var fast = null, deflt = null, first = null;
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === "mochi") continue;
        if (!first) first = list[i];
        if (!deflt && list[i].default) deflt = list[i];
        if (!fast && /\bfast\b/i.test(list[i].tip || "")) fast = list[i];
      }
      return fast || deflt || first;
    }

    // Build provider ordering for one audio type.
    //
    // ONLY the servers enabled in settings, in serverList order (fastest
    // first). Nothing else reaches the quality picker. If none of them serve
    // this episode, one fallback provider is used so playback still works.
    //
    // There is no separate download path any more: the app downloads these
    // same HLS streams. See the note on the removed download mode below.
    function buildCategories(type, providers) {
      {
        var ordered = [];
        // Dub leads with yuki whenever the API offers it, ticked or not. The
        // other servers hand back an audio-group master whose sub and dub URLs
        // are byte-identical and whose default audio track is Japanese, so
        // their "dub" entry can quietly play subbed audio. Yuki returns a
        // genuinely separate dub stream.
        function find(id) {
          for (var fi = 0; fi < providers.length; fi++) {
            if (providers[fi].id === "mochi") continue; // MP4-only, not an HLS source
            if (providers[fi].id === id) return providers[fi];
          }
          return null;
        }
        function add(wantId) {
          var prov = find(wantId);
          if (!prov) return;
          for (var oi = 0; oi < ordered.length; oi++) {
            if (ordered[oi].labelId === wantId) return; // already placed
          }
          ordered.push({ type: type, provider: prov,
                         queryId: wantId, labelId: wantId });
        }
        if (type === "dub") add("yuki");
        for (var si = 0; si < serverList.length; si++) add(serverList[si]);
        if (ordered.length === 0) {
          var fb = fallbackProvider(providers);
          if (fb) ordered = [{ type: type, provider: fb, queryId: fb.id,
                               labelId: fb.id }];
        }
        return ordered;
      }
    }

    var subCats = buildCategories("sub", subProviders);
    var dubCats = buildCategories("dub", dubProviders);

    // Preferred audio type goes first.
    var categories = (audioPref === "dub")
      ? dubCats.concat(subCats)
      : subCats.concat(dubCats);

    var streams = [];
    var seen    = {};

    // ── Provider streams ───────────────────────────────────────────────────

    // Resolve every provider at once rather than one after another. Serially
    // this cost the SUM of each call, so a single slow provider (yuki has been
    // measured at 12.7s and can 504) stalled playback even when the preferred
    // server had already answered in under a second. Now it costs the slowest
    // one. Failures resolve to null so one bad provider cannot reject the rest.
    // Fetch each (type, queryId) pair once only.
    var self = this;
    var inflight = {};
    function resolveAll(cats) {
      return Promise.all(cats.map(function (cat) {
        if (!cat.provider) return Promise.resolve({ cat: cat, data: null });
        var memo = cat.type + "|" + cat.queryId;
        if (!inflight[memo]) {
          inflight[memo] = self.chadSources(slug, epNum, cat.type, cat.queryId)
            .catch(function () { return null; });
        }
        return inflight[memo].then(function (d) { return { cat: cat, data: d }; });
      }));
    }

    var resolved = await resolveAll(categories);

    // Safety net: a server can be advertised by /servers and still fail at
    // /sources - sora returns HTTP 500 on some titles. Without this, ticking
    // only such a server hands the player an empty list for that audio type.
    // Costs nothing in the normal case; only runs when a type produced nothing.
    function yielded(type) {
      for (var yi = 0; yi < resolved.length; yi++) {
        if (resolved[yi].cat.type !== type) continue;
        var d = resolved[yi].data;
        if (d && d.sources && d.sources.length) return true;
      }
      return false;
    }
    var rescue = [];
    function addRescue(type, provs) {
      if (!provs.length || yielded(type)) return;
      var fb = fallbackProvider(provs);
      if (!fb) return;
      for (var ri = 0; ri < categories.length; ri++) {
        if (categories[ri].type === type && categories[ri].queryId === fb.id) return;
      }
      rescue.push({ type: type, provider: fb, queryId: fb.id,
                    labelId: fb.id });
    }
    addRescue("sub", subProviders);
    addRescue("dub", dubProviders);
    if (rescue.length) {
      // A rescued stream for the preferred audio type leads, otherwise the
      // player would autoplay the other language.
      var rr   = await resolveAll(rescue);
      var want = (audioPref === "dub") ? "dub" : "sub";
      var lead = [], tail = [];
      for (var qi = 0; qi < rr.length; qi++) {
        (rr[qi].cat.type === want ? lead : tail).push(rr[qi]);
      }
      resolved = lead.concat(resolved, tail);
    }

    for (var ci = 0; ci < resolved.length; ci++) {
      var cat = resolved[ci].cat;
      if (!cat.provider) continue;

      try {
        var srcData = resolved[ci].data;
        if (!srcData) continue;

        var sources = srcData.sources || [];
        var tracks  = srcData.tracks  || [];

        // Forward Referer and Origin from the API response — CDNs check
        // these for hotlink protection; without them the CDN returns 403.
        // Also honour a User-Agent when the API supplies one: sora returns an
        // Android UA with its krussdomi URLs, so overriding it with our desktop
        // UA would be sending the CDN something the site never sends.
        var apiHdrs = srcData.headers || {};
        var streamHdrs = { "User-Agent": apiHdrs["User-Agent"] || this.ua };
        if (apiHdrs.Referer) streamHdrs.Referer = apiHdrs.Referer;
        if (apiHdrs.Origin)  streamHdrs.Origin  = apiHdrs.Origin;

        var subtitles = [];
        (tracks || []).forEach(function(t) {
          if (!t) return;
          var file = t.url || t.file;
          if (!file) return;
          // Skip thumbnail sprite tracks — their cue text is "thumb.jpg#xywh=…"
          // which Mangayomi renders as garbled on-screen text.
          var kind  = (t.kind  || "").toLowerCase();
          var label = (t.label || "").toLowerCase();
          if (kind === "thumbnails" || kind === "chapters" || kind === "metadata") return;
          if (label.indexOf("thumbnail") >= 0) return;
          if (file.indexOf("#xywh=") >= 0) return;
          if (/\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(file)) return;
          subtitles.push({ file: file, label: t.label || t.lang || "Unknown" });
        });

        for (var k = 0; k < sources.length; k++) {
          var src    = sources[k];
          var srcUrl = src && src.url;
          if (!srcUrl) continue;

          srcUrl = this.transformUrl(srcUrl, cat.queryId);

          var quality = (src.quality || "Auto") +
            " [" + cat.type.toUpperCase() + "] " +
            cat.labelId.toUpperCase();
          var key = srcUrl + "|" + cat.type;
          if (seen[key]) continue;
          seen[key] = true;

          streams.push({
            url: srcUrl,
            originalUrl: srcUrl,
            quality: quality,
            headers: streamHdrs,
            subtitles: subtitles,
          });
        }
      } catch (e) { /* skip this provider on error */ }
    }

    // Store in cache before returning so a follow-up download call is free.
    _vlCache[cacheKey]   = streams;
    _vlCacheTs[cacheKey] = Date.now();
    return streams;
  }

  // ── Preferences ────────────────────────────────────────────────────────────

  getFilterList() { return []; }

  getSourcePreferences() {
    return [
      {
        key: "anidap_base_url",
        editTextPreference: {
          title: "Override base URL",
          summary: "Site moved to anidap.lol — reset this if you set anidap.se before",
          value: "https://anidap.lol",
          dialogTitle: "Override base URL",
          dialogMessage: "",
        },
      },
      {
        key: "anidap_title_lang",
        listPreference: {
          title: "Preferred title language",
          summary: "",
          valueIndex: 1,
          entries: ["Romaji", "English", "Native"],
          entryValues: ["romaji", "english", "native"],
        },
      },
      {
        key: "anidap_audio_pref",
        listPreference: {
          title: "Default audio",
          summary: "Both sub and dub are always available in the quality picker. This sets which one the player selects automatically.",
          valueIndex: 0,
          entries: ["Sub (default)", "Dub (default)"],
          entryValues: ["sub", "dub"],
        },
      },
      {
        key: "anidap_servers",
        multiSelectListPreference: {
          title: "Servers shown in quality picker",
          summary: "Only the ticked servers appear during playback. Yuki is the default: measured around 11 MB/s, roughly 9x faster than Zuna, and it handles both sub and dub - dub uses it automatically whether or not it is ticked. Zuna and Sora are slower fallbacks for the occasional title Yuki does not carry.",
          values: ["yuki"],
          entries: ["Yuki (default - fastest, sub and dub)", "Zuna (slower fallback)", "Sora (not on every title)"],
          entryValues: ["yuki", "zuna", "sora"],
        },
      },
    ];
  }
}
