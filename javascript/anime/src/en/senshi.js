const mangayomiSources = [
  {
    "name": "Senshi",
    "id": 728461935,
    "lang": "en",
    "baseUrl": "https://senshi.to",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://senshi.to",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.1.3",
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
// PLAYBACK NEEDS THE PROXY. Every playlist on that CDN is AES-256-GCM
// encrypted ("EM3U8v1:" + base64), decrypted by the site's own JS player.
// libmpv cannot, and there is no way to hand it a rebuilt playlist from here:
// mpv rejects data: URLs (its ffmpeg is built without them), memory:// and
// ffmpeg://data: fail ffmpeg's HLS probe, and an EDL of the segments cannot
// seek because the CDN ignores Range. So proxy/senshi-core.mjs (run by
// proxy.js locally or worker.js on Cloudflare) decrypts the playlists and
// returns plain HLS. Only the few-KB playlists go through it: segments are
// clean MPEG-TS and are fetched straight from the CDN with the headers set on
// each Video below (ffmpeg forwards them because the playlist itself came over
// HTTP). Verified in the app's own libmpv: 1080p H.264 + AAC, seeking and
// sub/dub audio selection all work.

var DEFAULT_PROXY = "http://127.0.0.1:8765";

// No comma anywhere in here: mpv splits http-header-fields on commas.
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";

var SOURCES_URL = "https://s.vidcloud.se/_v1/sources?id=";

var PAGE_SIZE = 30;

// Per-episode sub/dub lookups (see episodeBadges) are capped: beyond this many
// episodes a title falls back to an estimate rather than one request each.
var BADGE_LOOKUP_MAX = 150;
var BADGE_BATCH = 15;

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

  // remote_source_id → { height, tracks }. A failure only costs the quality
  // label and the subtitles: the proxy does its own lookup, so playback works.
  async sourceInfo(remoteId) {
    try {
      var data = await this.getJson(SOURCES_URL + remoteId, this.streamHeaders);
      var entry = Array.isArray(data) ? data[0] : data;
      if (!entry) return null;
      var q = entry.source && entry.source.quality;
      return {
        height: parseInt(q, 10) || 0,
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

  async getVideoList(url) {
    var idM = String(url || "").match(/\/watch\/(\d+)\/(\d+)/);
    if (!idM) return [];
    var animeId = idM[1], epNum = idM[2];

    var proxy = this.proxyBase();
    // Checked alongside the lookup so a healthy proxy costs no extra time.
    var pair = await Promise.all([
      this.checkProxy(proxy),
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

    var videos = [];
    groups.forEach(function (g) { g.forEach(function (v) { videos.push(v); }); });

    // Mangayomi plays the first entry and takes auto-play subtitles from it, so
    // the preferred audio has to lead. Order inside each group is already best
    // quality first, and this sort is stable.
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
        key: "senshi_pref_proxy_url",
        editTextPreference: {
          title: "Playlist proxy address",
          summary: "Required for playback. Senshi encrypts its HLS playlists, so they are decrypted by a small proxy (proxy/proxy.js on this PC, or proxy/worker.js on Cloudflare). Only playlists pass through it — video streams straight from the CDN.",
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
