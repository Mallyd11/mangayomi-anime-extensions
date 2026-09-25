const mangayomiSources = [
  {
    "name": "AniPM",
    "id": 1742685193,
    "lang": "en",
    "baseUrl": "https://ani.pm",
    "iconUrl": "https://ani.pm/apple-touch-icon.png",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.1.2",
    "pkgPath": "anime/src/en/anipm.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": false,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/anipm.js",
    "dateFormat": "",
    "dateFormatLocale": "",
    "additionalParams": "",
    "sourceCodeLanguage": 1,
    "notes": "",
  },
];

// ani.pm is a React app over an open JSON API (/api/anime/*). Playback goes:
//   /api/anime/playback-bootstrap/{settlar|anilist}/{id}?ep=N&lang=sub|dub
//     → settlarSelection (+ backupEmbed when asked with &backup=1)
//   /api/anime/settlar/session?selection=…      → embed.settlar.io/embed/v1?t=…
//   embed.settlar.io/api/embed/session?t=…      → HLS master on media.settlar.io + VTT list
// The media host needs no headers at all, segments end in .ts and it honours Range.
// embed.settlar.io sits behind a Cloudflare bot rule that blocks some HTTP client
// fingerprints outright (Node's fetch gets "Sorry, you have been blocked"; curl and
// Python pass), so the session call carries a full set of browser-style headers.
//
// The site's "Backup server" is MegaPlay (megaplay.buzz/stream/s-2/{id}/{sub|dub}).
// Its sources are AES-encrypted and its master playlist needs a signed token; the
// constants and the code below are the same ones AniKoto uses (see anikoto.js).
var MEGAPLAY_ENC_KEY = "i?LMTAx0Q6,:}50U";              // padded to 32 bytes
var MEGAPLAY_ENC_IV = "W0;27ToaUpl_P%'c";               // 16 bytes
var MEGAPLAY_CDN_SECRET = "MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s";
var MEGAPLAY_TOKEN_TTL = 21600;

var SERVERS = ["anipm", "megaplay"];
var SERVER_LABELS = { anipm: "ani.pm", megaplay: "MegaPlay" };

var GENRES = [
  "Action", "Adventure", "Cars", "Comedy", "Dementia", "Demons", "Drama", "Ecchi",
  "Fantasy", "Game", "Harem", "Historical", "Horror", "Isekai", "Josei", "Kids",
  "Magic", "Mahou Shoujo", "Martial Arts", "Mecha", "Military", "Music", "Mystery",
  "Parody", "Police", "Psychological", "Romance", "Samurai", "School", "Sci-Fi",
  "Seinen", "Shoujo", "Shounen", "Slice of Life", "Space", "Sports", "Super Power",
  "Supernatural", "Suspense", "Thriller", "Vampire",
];

class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
  }

  get ua() {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
  }

  // The app calls getHeaders(url) as a method for every cover image, so this
  // must stay a method, not a getter.
  getHeaders(url) {
    return {
      "User-Agent": this.ua,
      "Referer": this.source.baseUrl + "/",
    };
  }

  pref(key, fallback) {
    try {
      var v = new SharedPreferences().get(key);
      return v === undefined || v === null || v === "" ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  async api(path) {
    var url = this.source.baseUrl + "/api" + path;
    var headers = this.getHeaders(url);
    headers["Accept"] = "application/json";
    var res = await this.client.get(url, headers);
    if (res.statusCode !== 200) throw new Error("ani.pm API HTTP " + res.statusCode + " for " + path.split("?")[0]);
    return JSON.parse(res.body);
  }

  abs(url) {
    if (!url) return "";
    return url.startsWith("http") ? url : this.source.baseUrl + url;
  }

  // ── Browse ──────────────────────────────────────────────────────────────────

  parseItems(items) {
    var list = [];
    var seen = {};
    for (var i = 0; i < (items || []).length; i++) {
      var it = items[i];
      var route = it.routeId || (it.slug && it.id ? it.slug + "-" + it.id : "");
      if (!route || seen[route]) continue;
      seen[route] = true;
      list.push({
        name: it.title || it.native || route,
        imageUrl: this.abs(it.poster),
        link: route,
      });
    }
    return list;
  }

  async catalog(params, page) {
    params.push("page=" + page);
    var j = await this.api("/anime/catalog?" + params.join("&"));
    return { list: this.parseItems(j.items), hasNextPage: j.hasNextPage === true };
  }

  get supportsLatest() {
    return true;
  }

  async getPopular(page) {
    return await this.catalog(["sort=trending"], page);
  }

  // The site's "Latest" feed (newest episodes first) is published as an RSS file.
  // It is a single 40-episode page, so later pages fall back to the catalogue of
  // airing shows sorted newest first.
  async getLatestUpdates(page) {
    if (page > 1) return await this.catalog(["status=RELEASING", "sort=newest"], page - 1);
    var res = await this.client.get(this.source.baseUrl + "/latest.rss", this.getHeaders(this.source.baseUrl));
    var xml = res.body || "";
    var list = [];
    var seen = {};
    var items = xml.split("<item>");
    for (var i = 1; i < items.length; i++) {
      var it = items[i];
      var link = (it.match(/<link>([^<]+)<\/link>/) || [])[1] || "";
      var route = (link.match(/\/anime\/([^/?#<]+)/) || [])[1] || "";
      if (!route || seen[route]) continue;
      seen[route] = true;
      var title = ((it.match(/<title>([^<]+)<\/title>/) || [])[1] || route)
        .replace(/\s+—\s+Episode\s+[\d.]+\s*$/, "")
        .replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
      var thumb = ((it.match(/<media:thumbnail url="([^"]+)"/) || [])[1] || "").replace(/&amp;/g, "&");
      list.push({ name: title, imageUrl: thumb, link: route });
    }
    return { list: list, hasNextPage: true };
  }

  async search(query, page, filters) {
    var q = (query || "").trim();
    if (q) {
      // /anime/search is not paged — one page of best matches.
      if (page > 1) return { list: [], hasNextPage: false };
      var j = await this.api("/anime/search?q=" + encodeURIComponent(q));
      return { list: this.parseItems(j.items), hasNextPage: false };
    }
    // Filters come back positionally (the app keeps only type_name/name/state/
    // values): 0 Sort, 1 Format, 2 Status, 3 Genres — see getFilterList().
    var f = filters || [];
    var pick = function (i) {
      var x = f[i];
      if (!x || !x.values || typeof x.state !== "number") return "";
      var o = x.values[x.state];
      return o ? o.value : "";
    };
    var sort = pick(0) || "trending";
    var params = [];
    if (pick(1)) params.push("format=" + pick(1));
    if (pick(2)) params.push("status=" + pick(2));
    var genres = f[3] && Array.isArray(f[3].state) ? f[3].state : [];
    for (var g = 0; g < genres.length; g++) {
      if (genres[g] && genres[g].state) params.push("genre=" + encodeURIComponent(genres[g].value));
    }
    params.push("sort=" + sort);
    return await this.catalog(params, page);
  }

  // ── Detail ──────────────────────────────────────────────────────────────────

  statusCode(s) {
    var t = (s || "").toLowerCase();
    if (t.includes("airing") || t.includes("releasing")) return 0;
    if (t.includes("finished") || t.includes("completed")) return 1;
    if (t.includes("not yet") || t.includes("upcoming")) return 4;
    if (t.includes("cancel")) return 3;
    return 5;
  }

  routeOf(url) {
    var s = String(url || "");
    var m = s.match(/\/(?:anime|ani)\/([^/?#]+)/);
    return m ? m[1] : s.replace(/^\/+|\/+$/g, "");
  }

  async getDetail(url) {
    var route = this.routeOf(url);
    var s = await this.api("/anime/series/" + encodeURIComponent(route) + "?routes=e4");
    var id = s.id || s.sid || route;
    // AniList-sourced titles (site URLs under /ani/) play through
    // playback-bootstrap/anilist/{id}; the rest through .../settlar/{id}.
    var source = s.source === "anilist" ? "anilist" : "settlar";

    var chapters = [];
    var eps = s.episodes || [];
    for (var i = 0; i < eps.length; i++) {
      var ep = eps[i];
      if (ep.number === undefined || ep.number === null) continue;
      var num = String(ep.number);
      var title = (ep.title || "").trim();
      var name = "Episode " + num;
      if (title && title !== name) name += ": " + title;
      var badge = ep.sub && ep.dub ? "Sub · Dub" : ep.dub ? "Dub" : ep.sub ? "Sub" : "";
      var ch = { name: name, url: id + "|" + num + "|" + source, scanlator: badge };
      if (ep.aired) {
        var t = Date.parse(ep.aired);
        if (!isNaN(t)) ch.dateUpload = String(t);
      }
      if (ep.thumbnail) ch.thumbnailUrl = this.abs(ep.thumbnail);
      chapters.push(ch);
    }
    chapters.reverse();

    var description = (s.synopsis || "").replace(/<[^>]*>/g, "").trim();
    var extra = [];
    if (s.type) extra.push(s.type);
    if (s.year) extra.push(String(s.year));
    if (s.native) extra.push(s.native);
    if (extra.length) description = (description ? description + "\n\n" : "") + extra.join(" · ");

    return {
      name: s.title || route,
      imageUrl: this.abs(s.poster),
      description: description,
      genre: s.genres || [],
      author: (s.studios || []).join(", "),
      status: this.statusCode(s.status),
      link: this.source.baseUrl + "/anime/" + (s.routeId || route),
      chapters: chapters,
    };
  }

  // ── Streaming ───────────────────────────────────────────────────────────────

  enabledServers() {
    var v = this.pref("anipm_servers", ["anipm"]);
    var list = [];
    for (var i = 0; i < SERVERS.length; i++) {
      if (Array.isArray(v) && v.indexOf(SERVERS[i]) >= 0) list.push(SERVERS[i]);
    }
    return list.length ? list : ["anipm"];
  }

  // Split an HLS master into one entry per rendition, best first. Relative
  // variant URIs (MegaPlay) are resolved against the master. A master whose
  // renditions take their audio from a separate EXT-X-MEDIA group (newer ani.pm
  // encodes) is not split — a bare variant would play silent — so it comes back
  // empty and the master itself is listed.
  async variants(masterUrl, headers) {
    var out = [];
    try {
      var res = await this.client.get(masterUrl, headers);
      var body = res.body || "";
      if (res.statusCode !== 200 || body.indexOf("#EXTM3U") < 0) return null;
      if (/#EXT-X-MEDIA:[^\n]*TYPE=AUDIO/.test(body)) return out;
      var lines = body.split(/\r?\n/);
      var base = masterUrl.split("?")[0];
      base = base.substring(0, base.lastIndexOf("/") + 1);
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].indexOf("#EXT-X-STREAM-INF") !== 0) continue;
        var h = (lines[i].match(/RESOLUTION=\d+x(\d+)/) || [])[1];
        var uri = "";
        for (var k = i + 1; k < lines.length; k++) {
          var l = lines[k].trim();
          if (l && l[0] !== "#") { uri = l; break; }
        }
        if (!uri) continue;
        if (!/^https?:\/\//.test(uri)) uri = base + uri;
        out.push({ url: uri, height: h ? parseInt(h, 10) : 0 });
      }
    } catch (e) {
      return null;
    }
    out.sort(function (a, b) { return b.height - a.height; });
    return out;
  }

  pushVariants(streams, list, masterUrl, server, langLabel, headers, subtitles) {
    if (!list || !list.length) list = [{ url: masterUrl, height: 0 }];
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      streams.push({
        url: v.url,
        originalUrl: v.url,
        quality: SERVER_LABELS[server] + " " + (v.height ? v.height + "p" : "Auto") + " (" + langLabel + ")",
        headers: headers,
        subtitles: subtitles,
        _height: v.height,
      });
    }
  }

  // `source` is "settlar" or "anilist". Episode links saved before v0.1.2 carry
  // none; for those a settlar 404 is retried as anilist.
  async bootstrap(id, ep, lang, withBackup, source) {
    var q = "?ep=" + encodeURIComponent(ep) + "&lang=" + lang + (withBackup ? "&backup=1" : "");
    var src = source || this._source || "settlar";
    try {
      return await this.api("/anime/playback-bootstrap/" + src + "/" + encodeURIComponent(id) + q);
    } catch (e) {
      if (source || this._source || String(e.message).indexOf("HTTP 404") < 0) throw e;
      var boot = await this.api("/anime/playback-bootstrap/anilist/" + encodeURIComponent(id) + q);
      this._source = "anilist";
      return boot;
    }
  }

  async settlarStreams(boot, ep, lang, langLabel) {
    var streams = [];
    if (!boot.settlarSelection) return streams;
    var sess = await this.api("/anime/settlar/session?selection=" + encodeURIComponent(boot.settlarSelection) +
      "&provider=anipm&ep=" + encodeURIComponent(ep) + "&channel=" + lang + "&telemetry=0");
    if (!sess.embedUrl) return streams;
    var t = (sess.embedUrl.match(/[?&]t=([^&#]+)/) || [])[1];
    if (!t) return streams;
    var host = (sess.embedUrl.match(/^(https?:\/\/[^/]+)/) || [])[1] || "https://embed.settlar.io";
    var res = await this.client.get(host + "/api/embed/session?t=" + t, {
      "User-Agent": this.ua,
      "Accept": "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": sess.embedUrl,
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
    });
    if (res.statusCode !== 200) throw new Error("ani.pm player refused the session (HTTP " + res.statusCode + ")");
    var data = JSON.parse(res.body);
    if (!data.source) return streams;

    // The app turns subtitles[0] on by default, so the site's own default track
    // (full English for sub, "English CC (Dub)" for dub) goes first.
    var subs = (data.subtitles || []).filter(function (s) { return s && s.url; });
    subs.sort(function (a, b) { return (b.default ? 1 : 0) - (a.default ? 1 : 0); });
    var subtitles = subs.map(function (s) { return { file: s.url, label: s.label || s.srclang || "Unknown" }; });

    var list = await this.variants(data.source, { "User-Agent": this.ua });
    this.pushVariants(streams, list, data.source, "anipm", langLabel, {}, subtitles);
    // Only a split master can be downloaded: the app's HLS downloader follows one
    // variant and ignores EXT-X-MEDIA audio, so an audio-group encode would save silent.
    if (list && list.length && !this._dl) {
      var pick = list[0];
      for (var i = 0; i < list.length; i++) if (list[i].height === this._qualityPref) pick = list[i];
      this._dl = { url: pick.url, height: pick.height, langLabel: langLabel, subtitles: subtitles };
    }
    return streams;
  }

  // ── MegaPlay (backup server) ──────────────────────────────────────────────────

  // `enc` is AES-256-CBC over {"file": "<master.m3u8>"}.
  _decodeEncSources(enc) {
    try {
      var key = this._bytesOf(MEGAPLAY_ENC_KEY);
      while (key.length < 32) key.push(0);
      var iv = this._bytesOf(MEGAPLAY_ENC_IV);
      while (iv.length < 16) iv.push(0);
      var plain = this._aesCbcDecrypt(this._b64urlDecodeBytes(enc), key.slice(0, 32), iv.slice(0, 16));
      var text = "";
      for (var i = 0; i < plain.length; i++) text += String.fromCharCode(plain[i]);
      var data = JSON.parse(text);
      if (typeof data === "string") return data;
      if (data && data.file) return data.file;
      if (Array.isArray(data) && data.length) return data[0].file || data[0].url || "";
    } catch (e) {}
    return "";
  }

  // The CDN 403s a master playlist without ?token=base64url("<expiry>|<id1>/<id2>")
  // + "." + base64url(HMAC-SHA256). Variant playlists and segments need none.
  _signCdnUrl(url) {
    if (!url || /[?&]token=/.test(url)) return url;
    var m = String(url).match(/\/([a-f0-9]{32})\/([a-f0-9]{32})\//i);
    if (!m) return url;
    var path = m[1].toLowerCase() + "/" + m[2].toLowerCase();
    var msg = (Math.floor(Date.now() / 1000) + MEGAPLAY_TOKEN_TTL) + "|" + path;
    var token = this._b64urlEncode(this._bytesOf(msg)) + "." +
                this._b64urlEncode(this._hmacSha256(MEGAPLAY_CDN_SECRET, msg));
    return url + (url.indexOf("?") >= 0 ? "&" : "?") + "token=" + token;
  }

  // MegaPlay's subtitle host 403s without its Referer, and the player cannot send
  // headers for a subtitle file, so English tracks are downloaded and handed over
  // as text.
  async _megaplaySubtitles(tracks, referer) {
    var out = [];
    var list = (tracks || []).filter(function (t) {
      return t && t.file && t.kind !== "thumbnails" && /^english/i.test(t.label || "");
    });
    list.sort(function (a, b) { return (b.default ? 1 : 0) - (a.default ? 1 : 0); });
    for (var i = 0; i < list.length && i < 2; i++) {
      try {
        var res = await this.client.get(list[i].file, { "User-Agent": this.ua, "Referer": referer });
        var body = (res.body || "").replace(/^\s+/, "");
        if (body.indexOf("WEBVTT") !== 0) continue;
        out.push({ file: this._vttToSrt(body), label: list[i].label || "English" });
      } catch (e) {}
    }
    return out;
  }

  async megaplayStreams(boot, langLabel) {
    var streams = [];
    var be = boot.backupEmbed;
    if (!be || !be.available || !be.url) return streams;
    var apiHost = (be.url.match(/^(https?:\/\/[^/]+)/) || [])[1];
    if (!apiHost) return streams;
    // The /stream/s-2/{id} path id is a routing key, not the getSources id — that
    // one is the data-id in the embed page.
    var page = await this.client.get(be.url, { "User-Agent": this.ua, "Referer": this.source.baseUrl + "/" });
    var dataId = ((page.body || "").match(/data-id="(\d+)"/) || [])[1];
    if (!dataId) return streams;
    var src = await this.client.get(apiHost + "/stream/getSources?id=" + dataId, {
      "User-Agent": this.ua,
      "Referer": apiHost + "/",
      "X-Requested-With": "XMLHttpRequest",
      "Accept": "application/json",
    });
    var sd = JSON.parse(src.body || "{}");
    var m3u8 = "";
    if (sd.sources) {
      if (typeof sd.sources === "string") m3u8 = sd.sources;
      else if (sd.sources.file) m3u8 = sd.sources.file;
      else if (Array.isArray(sd.sources) && sd.sources.length) m3u8 = sd.sources[0].file || "";
    }
    if (!m3u8 && sd.enc) m3u8 = this._decodeEncSources(sd.enc);
    if (!m3u8) return streams;
    m3u8 = this._signCdnUrl(m3u8);
    var headers = { "Referer": apiHost + "/" };
    var list = await this.variants(m3u8, { "User-Agent": this.ua, "Referer": apiHost + "/" });
    if (list === null) return streams;
    var subtitles = await this._megaplaySubtitles(sd.tracks, apiHost + "/");
    this.pushVariants(streams, list, m3u8, "megaplay", langLabel, headers, subtitles);
    return streams;
  }

  // ── Video list ──────────────────────────────────────────────────────────────

  async serverStreams(server, boot, ep, lang, langLabel) {
    try {
      if (server === "anipm") return await this.settlarStreams(boot, ep, lang, langLabel);
      if (server === "megaplay") return await this.megaplayStreams(boot, langLabel);
    } catch (e) {
      this._lastError = e;
    }
    return [];
  }

  async getVideoList(url) {
    var parts = String(url).split("|");
    var id = parts[0];
    var ep = parts[1];
    var source = parts[2] === "anilist" || parts[2] === "settlar" ? parts[2] : "";
    this._source = "";
    if (!id || !ep) throw new Error("Unrecognised episode link: " + url + " — refresh the show.");

    var prefLang = this.pref("anipm_pref_lang", "sub");
    var langs = prefLang === "dub" ? ["dub", "sub"] : ["sub", "dub"];
    var enabled = this.enabledServers();
    var withBackup = enabled.indexOf("megaplay") >= 0;
    var qualityPref = parseInt(this.pref("anipm_pref_quality", "1080"), 10) || 1080;
    this._qualityPref = qualityPref;
    this._dl = null;

    var streams = [];
    var boots = {};
    var available = null;
    for (var li = 0; li < langs.length; li++) {
      var lang = langs[li];
      if (available && available[lang] === false) continue;
      var boot;
      try {
        boot = await this.bootstrap(id, ep, lang, withBackup, source);
      } catch (e) {
        this._lastError = e;
        continue;
      }
      if (boot.availability) available = boot.availability;
      // An episode that has no dub is answered with the sub instead; skip the repeat.
      if (boot.effectiveLanguage && boot.effectiveLanguage !== lang) continue;
      boots[lang] = boot;
      var langLabel = lang === "dub" ? "Dub" : "Sub";
      for (var si = 0; si < enabled.length; si++) {
        streams = streams.concat(this.sortByQuality(
          await this.serverStreams(enabled[si], boot, ep, lang, langLabel), qualityPref));
      }
    }

    // Nothing from the servers that are switched on: fall back to whatever the
    // site does have rather than showing an empty list.
    if (!streams.length) {
      for (var fi = 0; fi < SERVERS.length && !streams.length; fi++) {
        var server = SERVERS[fi];
        if (enabled.indexOf(server) >= 0) continue;
        for (var fl = 0; fl < langs.length; fl++) {
          var fb = boots[langs[fl]];
          if (!fb) continue;
          if (server === "megaplay" && !fb.backupEmbed) {
            try { fb = await this.bootstrap(id, ep, langs[fl], true, source); } catch (e) { continue; }
          }
          streams = streams.concat(this.sortByQuality(
            await this.serverStreams(server, fb, ep, langs[fl], langs[fl] === "dub" ? "Dub" : "Sub"), qualityPref));
        }
      }
    }

    if (!streams.length) {
      var why = this._lastError ? String(this._lastError.message || this._lastError) : "no server has this episode";
      throw new Error("ani.pm: nothing playable for episode " + ep + " (" + why + ")");
    }
    for (var k = 0; k < streams.length; k++) delete streams[k]._height;
    this.addDownloadEntry(streams);
    return streams;
  }

  // The app downloads the first entry whose originalUrl ends in .m3u8 and fetches
  // that entry's `url`. ani.pm's playlist links have no extension (appending one
  // 404s), so a copy of one rendition is listed with a ".m3u8" alias as its
  // originalUrl. The alias is never requested: the player opens entry 0's url,
  // and this copy is always placed after at least one real ani.pm entry — and
  // before any MegaPlay entry, whose CDN answers the downloader's 4-way segment
  // fetches with 429 part-way through an episode.
  addDownloadEntry(streams) {
    var d = this._dl;
    if (!d) return;
    var at = -1;
    var tag = "(" + d.langLabel + ")";
    for (var i = 0; i < streams.length; i++) {
      var q = streams[i].quality;
      if (q.indexOf(SERVER_LABELS.anipm + " ") === 0 && q.indexOf(tag) >= 0) at = i;
    }
    if (at < 0) return;
    streams.splice(at + 1, 0, {
      url: d.url,
      originalUrl: d.url + ".m3u8",
      quality: SERVER_LABELS.anipm + " " + d.height + "p " + tag + " · download",
      headers: {},
      subtitles: d.subtitles,
    });
  }

  // Preferred height first, then the rest from best to worst.
  sortByQuality(list, preferred) {
    return list.slice().sort(function (a, b) {
      var pa = a._height === preferred ? 1 : 0;
      var pb = b._height === preferred ? 1 : 0;
      if (pa !== pb) return pb - pa;
      return b._height - a._height;
    });
  }

  // ── Filters & settings ─────────────────────────────────────────────────────

  getFilterList() {
    var opt = function (name, value) { return { type_name: "SelectOption", name: name, value: value }; };
    return [
      {
        type_name: "SelectFilter", name: "Sort", state: 0,
        values: [opt("Trending", "trending"), opt("Popular", "popular"), opt("Top rated", "score"),
                 opt("Newest", "newest"), opt("Title", "title")],
      },
      {
        type_name: "SelectFilter", name: "Format", state: 0,
        values: [opt("Any", ""), opt("TV", "TV"), opt("Movie", "MOVIE"), opt("OVA", "OVA"),
                 opt("ONA", "ONA"), opt("Special", "SPECIAL")],
      },
      {
        type_name: "SelectFilter", name: "Status", state: 0,
        values: [opt("Any", ""), opt("Airing", "RELEASING"), opt("Finished", "FINISHED"),
                 opt("Upcoming", "NOT_YET_RELEASED")],
      },
      {
        type_name: "GroupFilter", name: "Genres",
        state: GENRES.map(function (g) { return { type_name: "CheckBox", name: g, value: g }; }),
      },
    ];
  }

  getSourcePreferences() {
    return [
      {
        key: "anipm_pref_lang",
        listPreference: {
          title: "Preferred audio",
          summary: "Listed first and played by default; the other one is listed after it when the episode has it",
          valueIndex: 0,
          entries: ["Sub", "Dub"],
          entryValues: ["sub", "dub"],
        },
      },
      {
        key: "anipm_pref_quality",
        listPreference: {
          title: "Preferred quality",
          summary: "",
          valueIndex: 0,
          entries: ["1080p", "720p", "360p"],
          entryValues: ["1080", "720", "360"],
        },
      },
      {
        key: "anipm_servers",
        multiSelectListPreference: {
          title: "Servers",
          summary: "ani.pm is the site's own player (fast). MegaPlay is the site's backup server. If none of the ticked servers has an episode, the others are tried",
          entries: ["ani.pm", "MegaPlay (backup)"],
          entryValues: ["anipm", "megaplay"],
          values: ["anipm"],
        },
      },
    ];
  }

  // ── Helpers (shared with anikoto.js) ───────────────────────────────────────

  // Pure-JS base64 decoder — atob() is not available in Mangayomi's QuickJS runtime.
  _b64dec(s) {
    var t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    s = s.replace(/[^A-Za-z0-9+/]/g, "");
    var out = "", i = 0;
    while (i < s.length) {
      var a = t.indexOf(s[i++]), b = t.indexOf(s[i++]);
      var c = t.indexOf(s[i++]), d = t.indexOf(s[i++]);
      if (a < 0 || b < 0) break;
      out += String.fromCharCode((a << 2) | (b >> 4));
      if (c >= 0) out += String.fromCharCode(((b & 15) << 4) | (c >> 2));
      if (d >= 0) out += String.fromCharCode(((c & 3) << 6) | d);
    }
    return out;
  }

  // ---------------------------------------------------------------- crypto
  //
  // Mangayomi's QuickJS runtime has no WebCrypto and no Node crypto, so the two
  // primitives MegaPlay's player relies on are implemented here: SHA-256 (for
  // the HMAC that signs a CDN URL) and AES-256-CBC decryption (for the `enc`
  // blob that replaced the plain sources array).

  _bytesOf(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) out.push(str.charCodeAt(i) & 0xff);
    return out;
  }

  _sha256(bytes) {
    var K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
      0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
      0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
      0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
      0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
      0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
      0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
      0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    var H = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];
    var msg = bytes.slice();
    var bitLen = msg.length * 8;
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    // Inputs here are a few hundred bytes at most, so the high length word is 0.
    msg.push(0, 0, 0, 0);
    msg.push((bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);

    var rotr = function (x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; };
    var w = new Array(64);
    for (var off = 0; off < msg.length; off += 64) {
      for (var t = 0; t < 16; t++) {
        w[t] = ((msg[off + t * 4] << 24) | (msg[off + t * 4 + 1] << 16) |
                (msg[off + t * 4 + 2] << 8) | msg[off + t * 4 + 3]) >>> 0;
      }
      for (t = 16; t < 64; t++) {
        var s0 = (rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3)) >>> 0;
        var s1 = (rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10)) >>> 0;
        w[t] = (((w[t - 16] + s0) >>> 0) + ((w[t - 7] + s1) >>> 0)) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3];
      var e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        var ch = ((e & f) ^ (~e & g)) >>> 0;
        var temp1 = (((((h + S1) >>> 0) + ch) >>> 0) + ((K[t] + w[t]) >>> 0)) >>> 0;
        var S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        var temp2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e;
        e = (d + temp1) >>> 0;
        d = c; c = b; b = a;
        a = (temp1 + temp2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
      H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    var out = [];
    for (var i = 0; i < 8; i++) {
      out.push((H[i] >>> 24) & 0xff, (H[i] >>> 16) & 0xff, (H[i] >>> 8) & 0xff, H[i] & 0xff);
    }
    return out;
  }

  _hmacSha256(keyStr, msgStr) {
    var key = this._bytesOf(keyStr);
    if (key.length > 64) key = this._sha256(key);
    while (key.length < 64) key.push(0);
    var ipad = [], opad = [];
    for (var i = 0; i < 64; i++) { ipad.push(key[i] ^ 0x36); opad.push(key[i] ^ 0x5c); }
    var inner = this._sha256(ipad.concat(this._bytesOf(msgStr)));
    return this._sha256(opad.concat(inner));
  }

  _aesTables() {
    if (this._aesT) return this._aesT;
    var sbox = new Array(256);
    var inv = new Array(256);
    var p = 1, q = 1;
    // Walk the generator 3 through GF(2^8) to build the S-box affinely.
    do {
      p = (p ^ (p << 1) ^ (p & 0x80 ? 0x1b : 0)) & 0xff;
      q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff;
      if (q & 0x80) q ^= 0x09;
      var x = (q ^ ((q << 1) | (q >>> 7)) ^ ((q << 2) | (q >>> 6)) ^
        ((q << 3) | (q >>> 5)) ^ ((q << 4) | (q >>> 4))) & 0xff;
      sbox[p] = x ^ 0x63;
    } while (p !== 1);
    sbox[0] = 0x63;
    for (var i = 0; i < 256; i++) inv[sbox[i]] = i;
    this._aesT = { sbox: sbox, inv: inv };
    return this._aesT;
  }

  _gmul(a, b) {
    var r = 0;
    for (var i = 0; i < 8; i++) {
      if (b & 1) r ^= a;
      var hi = a & 0x80;
      a = (a << 1) & 0xff;
      if (hi) a ^= 0x1b;
      b >>= 1;
    }
    return r & 0xff;
  }

  // Key schedule for any AES key length. MegaPlay uses a 32-byte key (Nk 8,
  // 14 rounds); the extra SubWord at i % Nk === 4 applies only at that size.
  _expandKey(key) {
    var T = this._aesTables();
    var rcon = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];
    var nk = key.length / 4;
    var rounds = nk + 6;
    var w = [];
    for (var i = 0; i < nk; i++) {
      w.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]);
    }
    for (i = nk; i < 4 * (rounds + 1); i++) {
      var t = w[i - 1].slice();
      if (i % nk === 0) {
        t.push(t.shift());
        t = t.map(function (b) { return T.sbox[b]; });
        t[0] ^= rcon[i / nk - 1];
      } else if (nk > 6 && i % nk === 4) {
        t = t.map(function (b) { return T.sbox[b]; });
      }
      var prev = w[i - nk];
      w.push(t.map(function (b, j) { return b ^ prev[j]; }));
    }
    return { w: w, rounds: rounds };
  }

  _invShiftRows(s) {
    for (var r = 1; r < 4; r++) {
      var row = [s[r], s[4 + r], s[8 + r], s[12 + r]];
      for (var c = 0; c < 4; c++) s[c * 4 + r] = row[(c - r + 4) % 4];
    }
  }

  _invMixColumns(s) {
    for (var c = 0; c < 4; c++) {
      var a0 = s[c * 4], a1 = s[c * 4 + 1], a2 = s[c * 4 + 2], a3 = s[c * 4 + 3];
      s[c * 4] = this._gmul(a0, 14) ^ this._gmul(a1, 11) ^ this._gmul(a2, 13) ^ this._gmul(a3, 9);
      s[c * 4 + 1] = this._gmul(a0, 9) ^ this._gmul(a1, 14) ^ this._gmul(a2, 11) ^ this._gmul(a3, 13);
      s[c * 4 + 2] = this._gmul(a0, 13) ^ this._gmul(a1, 9) ^ this._gmul(a2, 14) ^ this._gmul(a3, 11);
      s[c * 4 + 3] = this._gmul(a0, 11) ^ this._gmul(a1, 13) ^ this._gmul(a2, 9) ^ this._gmul(a3, 14);
    }
  }

  _decryptBlock(block, sched) {
    var T = this._aesTables();
    var w = sched.w;
    var s = block.slice();
    var addRound = function (round) {
      for (var c = 0; c < 4; c++) {
        for (var r = 0; r < 4; r++) s[c * 4 + r] ^= w[round * 4 + c][r];
      }
    };
    addRound(sched.rounds);
    for (var round = sched.rounds - 1; round >= 1; round--) {
      this._invShiftRows(s);
      for (var i = 0; i < 16; i++) s[i] = T.inv[s[i]];
      addRound(round);
      this._invMixColumns(s);
    }
    this._invShiftRows(s);
    for (var j = 0; j < 16; j++) s[j] = T.inv[s[j]];
    addRound(0);
    return s;
  }

  _aesCbcDecrypt(cipher, key, iv) {
    var sched = this._expandKey(key);
    var out = [];
    var prev = iv.slice();
    for (var off = 0; off + 16 <= cipher.length; off += 16) {
      var block = cipher.slice(off, off + 16);
      var plain = this._decryptBlock(block, sched);
      for (var i = 0; i < 16; i++) out.push(plain[i] ^ prev[i]);
      prev = block;
    }
    // Strip PKCS#7 if it looks well-formed.
    var pad = out[out.length - 1];
    if (pad >= 1 && pad <= 16 && out.length >= pad) {
      var ok = true;
      for (var k = out.length - pad; k < out.length; k++) if (out[k] !== pad) ok = false;
      if (ok) out = out.slice(0, out.length - pad);
    }
    return out;
  }

  _b64urlEncode(bytes) {
    var t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    var out = "", i = 0, n = bytes.length;
    while (i < n) {
      var a = bytes[i++];
      out += t[a >> 2];
      if (i === n) { out += t[(a & 3) << 4]; break; }
      var b = bytes[i++];
      out += t[((a & 3) << 4) | (b >> 4)];
      if (i === n) { out += t[(b & 15) << 2]; break; }
      var c = bytes[i++];
      out += t[((b & 15) << 2) | (c >> 6)];
      out += t[c & 63];
    }
    return out; // padding omitted, as the player's own encoder does
  }

  _b64urlDecodeBytes(str) {
    return this._bytesOf(this._b64dec(String(str).replace(/-/g, "+").replace(/_/g, "/")));
  }

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
}
