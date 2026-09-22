const mangayomiSources = [
  {
    "name": "Senshi",
    "id": 728461935,
    "lang": "en",
    "baseUrl": "https://senshi.to",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://senshi.to",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.3.0",
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
// Streams live on a separate backend. remote_source_id goes to
//   https://s.vidcloud.se/_v1/sources?id=<id>
// which returns the master playlist URL, the max quality and the subtitle
// tracks. That API and every CDN request behind it 403 unless they carry
// Referer AND Origin of https://senshi.to (Referer alone is not enough) and a
// browser User-Agent.
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
// The "Via proxy" playback setting has neither problem (real HLS, one continuous
// stream, any seek) but needs proxy/proxy.js running, so it is opt-in. No other
// server-free route exists in this libmpv: hls+..., concat: and ffmpeg://data: do
// not open, and mpv's own playlist reader splits a data playlist into files.
//
// EDL details that matter: !delay_open (else mpv opens every part up front, ~30 s
// for an episode) requires start= on every part, otherwise it assumes PTS 0 and
// skips all but the first. Segment n starts at firstPts + sum(EXTINF[0..n-1]),
// checked exactly on six titles; audio starts at 1.400 s, video at 1.400 s plus the
// B-frame delay (1.4834 at 23.976 fps, 1.4667 at 29.97). !track_meta must NOT be
// used: it adds phantom "unknown" tracks.

var DEFAULT_PROXY = "http://127.0.0.1:8765";

// No comma anywhere in here: mpv splits http-header-fields on commas.
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";

var SOURCES_URL = "https://s.vidcloud.se/_v1/sources?id=";

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

  proxyBase() {
    var raw = String(this.getPreference("senshi_pref_proxy_url") || "").trim();
    if (!raw) raw = DEFAULT_PROXY;
    // Anything that is not an http(s) origin is ignored rather than pasted into
    // a stream URL.
    if (!/^https?:\/\/[^/\s]+/.test(raw)) raw = DEFAULT_PROXY;
    return raw.replace(/\/+$/, "");
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
      if (!t || !t.vtt_url || t.label === "chapter") return false;
      return self._isDubTrack(t) === wantDub;
    });
    var rank = function (t) {
      if (t.default === true) return 0;
      return /^english/i.test(String(t.label || "")) ? 1 : 2;
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

  // remote_source_id → { height, tracks, src }. src is the master playlist URL
  // (with a short-lived token). A failure costs the quality label and the
  // subtitles, and in direct mode the whole version, so callers decide.
  async sourceInfo(remoteId) {
    try {
      var data = await this.getJson(SOURCES_URL + remoteId, this.streamHeaders);
      var entry = Array.isArray(data) ? data[0] : data;
      if (!entry) return null;
      var q = entry.source && entry.source.quality;
      return {
        height: parseInt(q, 10) || 0,
        src: (entry.source && entry.source.src) || "",
        tracks: Array.isArray(entry.tracks) ? entry.tracks : [],
      };
    } catch (e) {
      return null;
    }
  }

  // libmpv never errors on an unreachable HTTP stream, it just spins, so a proxy
  // that is not running would show up as endless buffering. Ask it first and fail
  // with something the user can act on.
  async checkProxy(proxy) {
    var res;
    try {
      res = await this.client.get(proxy + "/senshi/ping", { "User-Agent": UA });
    } catch (e) {
      throw new Error(
        "Senshi needs its playlist proxy, and nothing answered at " + proxy +
        ". Start it with: node proxy/proxy.js  (or change the proxy address in the source settings)."
      );
    }
    if (!res || res.statusCode !== 200 || String(res.body || "").indexOf("senshi-proxy") < 0) {
      throw new Error(
        "The proxy at " + proxy + " is running but does not know Senshi (an older proxy.js). " +
        "Stop it and start the updated one: node proxy/proxy.js"
      );
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
        return Promise.reject(new Error("Senshi's stream lookup returned nothing for this episode"));
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
          // Best quality only. The lower variant is not offered here: its segments
          // rarely start on a keyframe, so every part boundary freezes the picture
          // for seconds (see the note at the top). The proxy mode still lists it.
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

    var viaProxy = this.getPreference("senshi_pref_playback") === "proxy";
    // Needed below regardless of playback mode: downloads always route through
    // the proxy (only it can decrypt + mux), even when playback is Direct.
    var proxy = this.proxyBase();
    // A proxy is checked alongside the lookup so a healthy one costs no extra time.
    var pair = await Promise.all([
      viaProxy ? this.checkProxy(proxy) : Promise.resolve(),
      this.getJson(this.source.baseUrl + "/episode-embeds/" + animeId + "/" + epNum),
    ]);
    var embeds = pair[1];
    if (!Array.isArray(embeds) || embeds.length === 0) return [];

    // One lookup per distinct backend id (a HardSub and a Dub row usually share it).
    var ids = [];
    embeds.forEach(function (e) {
      if (e && e.remote_source_id && ids.indexOf(e.remote_source_id) < 0) ids.push(e.remote_source_id);
    });
    var self = this;
    var infos = await Promise.all(ids.map(function (rid) { return self.sourceInfo(rid); }));
    var infoOf = {};
    ids.forEach(function (rid, i) { infoOf[rid] = infos[i]; });

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

    var videos = [];
    if (viaProxy) {
      var groups = await Promise.all(jobs.map(async function (j) {
        var info = infoOf[j.rid];
        var subs = info ? await self.inlineSubtitles(info.tracks, j.dub) : [];
        var top = info && info.height ? info.height : 1080;
        var kind = j.dub ? "Dub" : "Sub";
        var link = function (extra) {
          return proxy + "/senshi/master.m3u8?id=" + j.rid + "&audio=" + (j.dub ? "en" : "ja") + extra;
        };
        var out = [];
        var best = link("");
        out.push({ url: best, originalUrl: best, quality: kind + " " + (info && info.height ? top + "p" : "Auto"), headers: headers, subtitles: subs, _dub: j.dub });
        // A 480p option for slow connections, when the release has more than that.
        if (top > 480) {
          var low = link("&maxh=480");
          out.push({ url: low, originalUrl: low, quality: kind + " 480p", headers: headers, subtitles: subs, _dub: j.dub });
        }
        return out;
      }));
      groups.forEach(function (g) { g.forEach(function (v) { videos.push(v); }); });
    } else {
      videos = await this.directVideos(jobs, infoOf, animeId, epNum);
    }

    // Mangayomi's own HLS downloader has no support for HLS's detached-audio
    // #EXT-X-MEDIA track (how every playback entry above delivers audio here),
    // so handed any of them it would silently save picture with no sound. This
    // is a separate, dedicated route that muxes video+audio into ordinary
    // single-stream segments the downloader can actually handle. Always added,
    // regardless of Playback method: playback stays on the entries above
    // (direct by default, needing no proxy), downloads need the proxy running
    // only at the moment a download is started, same as Via proxy playback.
    jobs.forEach(function (j) {
      var kind = j.dub ? "Dub" : "Sub";
      var dl = proxy + "/senshi/dl/" + j.rid + "/" + (j.dub ? "en" : "ja") + ".m3u8";
      videos.push({
        url: dl,
        originalUrl: dl,
        quality: kind + " 1080p (Download)",
        headers: headers,
        subtitles: [],
        _dub: j.dub,
        _download: true,
      });
    });

    // Mangayomi plays the first entry and takes auto-play subtitles from it, so
    // the preferred audio has to lead. Order inside each group is already best
    // quality first, and this sort is stable. Download entries never lead,
    // regardless of audio preference: they need the proxy, the others don't.
    var wantDub = this.getPreference("senshi_pref_type") === "dub";
    videos.sort(function (a, b) {
      if (a._download !== b._download) return a._download ? 1 : -1;
      if (a._dub !== b._dub) return (a._dub === wantDub) ? -1 : 1;
      return 0;
    });
    videos.forEach(function (v) { delete v._dub; delete v._download; });
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
        key: "senshi_pref_playback",
        listPreference: {
          title: "Playback method",
          summary: "Direct needs nothing else. Via proxy gives full seeking but needs the playlist proxy running (proxy/proxy.js)",
          valueIndex: 0,
          entries: ["Direct (recommended)", "Via proxy"],
          entryValues: ["direct", "proxy"],
        },
      },
      {
        key: "senshi_pref_proxy_url",
        editTextPreference: {
          title: "Playlist proxy address",
          summary: "Used when Playback method is Via proxy, and always for downloads (run proxy/proxy.js first)",
          value: DEFAULT_PROXY,
          dialogTitle: "Proxy address",
          dialogMessage: "Use http://127.0.0.1:8765 when running proxy.js on this PC, or your worker's https URL.",
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
