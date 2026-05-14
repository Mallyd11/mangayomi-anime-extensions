const mangayomiSources = [
  {
    "name": "Anidap",
    "id": 543219876,
    "lang": "en",
    "baseUrl": "https://anidap.se",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://anidap.se",
    "typeSource": "single",
    "itemType": 1,
    "version": "1.1.0",
    "pkgPath": "anime/src/en/anidap.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": true,
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

// ─── AniList GraphQL (for browse/search/metadata) ────────────────────────────

var PAGE_MEDIA_QUERY = [
  "query PageMedia($page:Int,$perPage:Int,$search:String,$sort:[MediaSort]){",
  "Page(page:$page,perPage:$perPage){",
  "pageInfo{currentPage hasNextPage}",
  "media(type:ANIME,isAdult:false,search:$search,sort:$sort){",
  "id title{romaji english native} coverImage{large medium}",
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
    return this.getPreference("anidap_base_url") || this.source.baseUrl;
  }

  // Headers for JSON API calls
  get apiHeaders() {
    return {
      "User-Agent": this.ua,
      "Accept": "application/json, */*",
      "Referer": this.getBaseUrl() + "/",
    };
  }

  // Headers for HTML page requests
  get pageHeaders() {
    return {
      "User-Agent": this.ua,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Referer": this.getBaseUrl() + "/",
    };
  }

  // ── AniList GraphQL ────────────────────────────────────────────────────────

  async gql(query, variables) {
    var res = await this.client.post(
      "https://graphql.anilist.co",
      { "Content-Type": "application/json", "Accept": "application/json" },
      { query: query, variables: variables }
    );
    if (res.statusCode !== 200) throw new Error("AniList HTTP " + res.statusCode);
    var json = JSON.parse(res.body);
    if (json.errors && json.errors.length) throw new Error(json.errors[0].message);
    return json.data;
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
        link: String(m.id),
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
    var data = await this.gql(PAGE_MEDIA_QUERY, { page: page, perPage: 24, sort: ["UPDATED_AT_DESC"] });
    var p = (data && data.Page) || {};
    return { list: this.parseMedia(p.media), hasNextPage: !!(p.pageInfo && p.pageInfo.hasNextPage) };
  }

  async search(query, page, filters) {
    var vars = { page: page, perPage: 24 };
    if (query && query.length > 0) { vars.search = query; vars.sort = ["SEARCH_MATCH"]; }
    else { vars.sort = ["POPULARITY_DESC"]; }
    var data = await this.gql(PAGE_MEDIA_QUERY, vars);
    var p = (data && data.Page) || {};
    return { list: this.parseMedia(p.media), hasNextPage: !!(p.pageInfo && p.pageInfo.hasNextPage) };
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

  // ── Page scraping helpers ──────────────────────────────────────────────────

  // Fetch a page, trying each path in order. Returns HTML string or null.
  async fetchPage(paths) {
    var base = this.getBaseUrl();
    for (var i = 0; i < paths.length; i++) {
      try {
        var res = await this.client.get(base + paths[i], this.pageHeaders);
        if (res.statusCode === 200 && res.body && res.body.length > 200) return res.body;
      } catch (e) {}
    }
    return null;
  }

  // Parse the Next.js __NEXT_DATA__ script from page HTML.
  // Returns the parsed object or null.
  extractNextData(html) {
    try {
      var doc = new Document(html);
      var el = doc.selectFirst("#__NEXT_DATA__");
      if (!el) return null;
      return JSON.parse(el.text);
    } catch (e) { return null; }
  }

  // Walk a specific dot-separated path through an object.
  // e.g. getPath(obj, "props.pageProps.anime.episodes")
  getPath(obj, dotPath) {
    var keys = dotPath.split(".");
    var cur = obj;
    for (var i = 0; i < keys.length; i++) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = cur[keys[i]];
    }
    return cur;
  }

  // Try many dot-path candidates and return the first non-empty array found.
  findArray(obj, candidates) {
    for (var i = 0; i < candidates.length; i++) {
      var val = this.getPath(obj, candidates[i]);
      if (Array.isArray(val) && val.length > 0) return val;
    }
    return null;
  }

  // ── Episode fetching ───────────────────────────────────────────────────────

  async fetchEpisodes(anilistId) {
    // ── 1. Scrape the anime info page ──────────────────────────────────────
    var html = await this.fetchPage(["/info/" + anilistId]);
    if (html) {
      var nd = this.extractNextData(html);
      if (nd) {
        var eps = this.findArray(nd, [
          "props.pageProps.episodes",
          "props.pageProps.anime.episodes",
          "props.pageProps.animeInfo.episodes",
          "props.pageProps.data.episodes",
          "props.pageProps.data.anime.episodes",
          "props.pageProps.initialData.episodes",
          "props.pageProps.animeData.episodes",
          "props.pageProps.info.episodes",
          "props.pageProps.details.episodes",
        ]);
        if (eps) return eps;
      }

      // Also search for JSON-like inline script data (non-Next.js sites)
      try {
        var doc2 = new Document(html);
        var scripts = doc2.select("script:not([src])");
        for (var si = 0; si < scripts.length; si++) {
          var txt = scripts[si].text || "";
          // Look for an array that looks like episode data
          var m = txt.match(/"episodes"\s*:\s*(\[[\s\S]*?\])/);
          if (m) {
            var arr = JSON.parse(m[1]);
            if (Array.isArray(arr) && arr.length > 0) return arr;
          }
        }
      } catch (e) {}
    }

    // ── 2. API fallbacks ───────────────────────────────────────────────────
    var base = this.getBaseUrl();
    var apiPaths = [
      "/api/anime/episodes?id=" + anilistId,
      "/api/episodes/" + anilistId,
      "/api/anime/" + anilistId + "/episodes",
      "/api/v1/episodes?animeId=" + anilistId,
      "/api/v2/allanime/episodes/" + anilistId + "?provider=anilist&mode=sub",
    ];
    for (var i = 0; i < apiPaths.length; i++) {
      try {
        var res = await this.client.get(base + apiPaths[i], this.apiHeaders);
        if (res.statusCode !== 200 || !res.body) continue;
        var json = JSON.parse(res.body);
        // AllAnime proxy format
        if (json.data && json.data.episodes) {
          return json.data.episodes.map(function(ep) {
            var rawId = ep.episodeId || "";
            var c1 = rawId.indexOf(":");
            var c2 = c1 >= 0 ? rawId.indexOf(":", c1 + 1) : -1;
            return {
              number: ep.number,
              title: ep.title,
              _allAnimeShowId: (c1 >= 0 && c2 >= 0) ? rawId.substring(c1 + 1, c2) : "",
            };
          });
        }
        var eps2 = Array.isArray(json) ? json : (json.episodes || json.data || json.results || []);
        if (Array.isArray(eps2) && eps2.length > 0) return eps2;
      } catch (e) {}
    }

    return [];
  }

  // ── Detail ─────────────────────────────────────────────────────────────────

  async getDetail(url) {
    var anilistId = parseInt(url.replace(/[^0-9]/g, ""), 10);
    if (!anilistId) throw new Error("Cannot parse AniList ID: " + url);

    // AniList GraphQL for reliable metadata
    var data = await this.gql(MEDIA_DETAIL_QUERY, { id: anilistId });
    var m = (data && data.Media) || {};

    var name     = this.titleByPref(m.title || {});
    var imageUrl = (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large)) || "";
    var description = (m.description || "").replace(/<[^>]*>/g, "").replace(/\n{3,}/g, "\n\n").trim();
    var genre    = m.genres || [];
    var status   = this.statusCode(m.status);
    var epCount  = m.episodes || 0;
    var isMovie  = m.format === "MOVIE";

    var rawEps = await this.fetchEpisodes(anilistId);
    var chapters = [];

    if (rawEps.length > 0) {
      rawEps.forEach(function(ep) {
        var num   = ep.number   || ep.ep_num || ep.episode || ep.episodeNumber || ep.num || "";
        var title = ep.title    || ep.name   || ("Episode " + num);
        // Prefer AllAnime show ID for stream resolution; fall back to generic IDs
        var extraId = ep._allAnimeShowId || ep.id || ep.episodeId || ep.episode_id || ep._id || "";
        var chName  = isMovie ? (name || title) : ("E" + num + " — " + title);
        chapters.push({
          name: chName,
          url:  anilistId + "|" + num + (extraId ? "|" + extraId : ""),
        });
      });
    } else if (epCount > 0) {
      // Last resort: generate numbered stubs from AniList episode count
      for (var j = 1; j <= epCount; j++) {
        chapters.push({
          name: isMovie ? name : ("Episode " + j),
          url:  anilistId + "|" + j,
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

  // ── HLS resolution ─────────────────────────────────────────────────────────

  async resolveHls(playlistUrl, headers) {
    try {
      var res = await this.client.get(playlistUrl, headers);
      if (!res || !res.body) return { kind: "fetch-failed" };
      var body = res.body;
      var hasStream = body.indexOf("#EXT-X-STREAM-INF") >= 0;
      var hasSegs   = body.indexOf("#EXTINF")           >= 0;
      if (hasSegs && !hasStream) return { kind: "flat" };
      if (!hasStream)            return { kind: "empty-master" };

      var baseDir  = playlistUrl.substring(0, playlistUrl.lastIndexOf("/") + 1);
      var variants = [];
      var lines    = body.split("\n");
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.indexOf("#EXT-X-STREAM-INF:") !== 0) continue;
        var rm    = line.match(/RESOLUTION=(\d+)x(\d+)/);
        var bw    = line.match(/BANDWIDTH=(\d+)/);
        var label = rm ? rm[2] + "p" : (bw ? Math.round(parseInt(bw[1]) / 1000) + "kbps" : "Auto");
        for (var j = i + 1; j < lines.length; j++) {
          var u = lines[j].trim();
          if (!u || u.charAt(0) === "#") continue;
          variants.push({ url: u.indexOf("http") === 0 ? u : baseDir + u, label: label });
          break;
        }
      }
      if (!variants.length) return { kind: "empty-master" };
      variants.sort(function(a, b) { return (parseInt(b.label) || 0) - (parseInt(a.label) || 0); });
      return { kind: "master", variants: variants };
    } catch (e) {
      return { kind: "fetch-failed" };
    }
  }

  // ── Stream pushing helper ──────────────────────────────────────────────────

  async pushSource(srcUrl, isHls, quality, cat, streamHeaders, subtitles, streams, seen) {
    if (isHls) {
      var resolved = await this.resolveHls(srcUrl, streamHeaders);
      if (resolved.kind === "master") {
        for (var vi = 0; vi < resolved.variants.length; vi++) {
          var v = resolved.variants[vi];
          var k = v.url + "|" + cat;
          if (seen[k]) continue;
          seen[k] = true;
          streams.push({ url: v.url, originalUrl: srcUrl, quality: v.label + " [" + cat.toUpperCase() + "]", headers: streamHeaders, subtitles: subtitles });
        }
      } else if (resolved.kind === "flat") {
        var k2 = srcUrl + "|" + cat;
        if (!seen[k2]) {
          seen[k2] = true;
          streams.push({ url: srcUrl, originalUrl: srcUrl, quality: (quality || "HLS") + " [" + cat.toUpperCase() + "]", headers: streamHeaders, subtitles: subtitles });
        }
      }
    } else {
      var k3 = srcUrl + "|" + cat;
      if (!seen[k3]) {
        seen[k3] = true;
        streams.push({ url: srcUrl, originalUrl: srcUrl, quality: (quality || "Auto") + " [" + cat.toUpperCase() + "]", headers: streamHeaders, subtitles: subtitles });
      }
    }
  }

  // Build subtitles array from raw track list
  buildSubtitles(rawTracks) {
    var subs = [];
    (rawTracks || []).forEach(function(t) {
      if (!t) return;
      var file = t.url || t.file || t.src;
      if (file) subs.push({ file: file, label: t.label || t.lang || t.language || "Unknown" });
    });
    return subs;
  }

  // Process a sources array into streams (used for both scraped and API results)
  async processSources(sources, rawTracks, defaultCat, streamHeaders, streams, seen) {
    var self = this;
    var subtitles = this.buildSubtitles(rawTracks);
    for (var k = 0; k < sources.length; k++) {
      var src    = sources[k];
      var srcUrl = src && (src.url || src.file || src.link || src.src);
      if (!srcUrl) continue;
      var isHls  = srcUrl.indexOf(".m3u8") >= 0 || src.isM3U8 === true || src.type === "hls";
      var quality = src.quality || src.resolution || "";
      // Some sources carry their own type flag
      var cat = src.isDub === true ? "dub" : (src.isSub === true ? "sub" : defaultCat);
      await self.pushSource(srcUrl, isHls, quality, cat, streamHeaders, subtitles, streams, seen);
    }
  }

  // ── Stream fetching ────────────────────────────────────────────────────────

  async getVideoList(url) {
    // Chapter URL: "{anilistId}|{epNum}" or "{anilistId}|{epNum}|{extraId}"
    // extraId is either an AllAnime showId or a generic episode ID from the site
    var parts     = url.split("|");
    var anilistId = parts[0] || "";
    var epNum     = parts[1] || "";
    var extraId   = parts[2] || "";
    if (!anilistId || !epNum) return [];

    var audioPref   = this.getPreference("anidap_audio_pref");
    var categories  = audioPref === "dub" ? ["dub", "sub"] : ["sub", "dub"];
    var base        = this.getBaseUrl();
    var streams     = [];
    var seen        = {};
    var streamHdrs  = { "User-Agent": this.ua, "Referer": base + "/" };

    // ── 1. Scrape the watch/info page for __NEXT_DATA__ ────────────────────
    var watchHtml = await this.fetchPage([
      "/watch/" + anilistId + "?ep=" + epNum,
      "/info/"  + anilistId + "?ep=" + epNum,
      "/watch/" + anilistId + "/" + epNum,
      "/stream/" + anilistId + "?ep=" + epNum,
      "/info/"  + anilistId + "?episode=" + epNum,
      "/watch/" + anilistId + "?episode=" + epNum,
    ]);

    if (watchHtml) {
      var nd = this.extractNextData(watchHtml);
      if (nd) {
        var pp = this.getPath(nd, "props.pageProps") || {};

        // Candidate paths for sources array
        var sourceCandidates = [
          "sources",
          "episode.sources",
          "currentEpisode.sources",
          "episodeData.sources",
          "stream.sources",
          "data.sources",
          "streamData.sources",
          "video.sources",
          "videoSources",
          "episodeSources",
        ];
        var foundSources = this.findArray(pp, sourceCandidates);

        // Candidate paths for subtitle/track arrays
        var trackCandidates = [
          "subtitles",
          "tracks",
          "episode.subtitles",
          "episode.tracks",
          "currentEpisode.subtitles",
          "stream.subtitles",
          "data.subtitles",
        ];
        var foundTracks = this.findArray(pp, trackCandidates) || [];

        if (foundSources) {
          await this.processSources(foundSources, foundTracks, categories[0], streamHdrs, streams, seen);
          if (streams.length > 0) return streams;
        }
      }

      // Inline script fallback: look for JSON blobs containing "sources" in <script> tags
      try {
        var doc3 = new Document(watchHtml);
        var scriptEls = doc3.select("script:not([src])");
        for (var si2 = 0; si2 < scriptEls.length; si2++) {
          var stxt = scriptEls[si2].text || "";
          var sm = stxt.match(/"sources"\s*:\s*(\[[\s\S]*?\])/);
          if (sm) {
            var inlineSrcs = JSON.parse(sm[1]);
            if (Array.isArray(inlineSrcs) && inlineSrcs.length > 0) {
              await this.processSources(inlineSrcs, [], categories[0], streamHdrs, streams, seen);
              if (streams.length > 0) return streams;
            }
          }
        }
      } catch (e) {}
    }

    // ── 2. API fallbacks (per sub/dub category) ────────────────────────────
    for (var ci = 0; ci < categories.length; ci++) {
      var cat = categories[ci];

      // AllAnime proxy (used by MyroniX and similar sites)
      // extraId is the AllAnime show ID when available
      if (extraId) {
        var allAnimeEpId = "allanime:" + extraId + ":" + epNum;
        var allAnimeServers = ["hd-1", "hd-2"];
        for (var asi = 0; asi < allAnimeServers.length; asi++) {
          try {
            var aaUrl = base + "/api/v2/allanime/episode/sources" +
              "?animeEpisodeId=" + encodeURIComponent(allAnimeEpId) +
              "&server=" + allAnimeServers[asi] +
              "&category=" + cat;
            var aaRes = await this.client.get(aaUrl, this.apiHeaders);
            if (aaRes.statusCode === 200 && aaRes.body) {
              var aaJson = JSON.parse(aaRes.body);
              var aaSrcs = (aaJson.data && aaJson.data.sources) || [];
              if (aaSrcs.length > 0) {
                var aaTracks = (aaJson.data && (aaJson.data.tracks || aaJson.data.subtitles)) || [];
                await this.processSources(aaSrcs, aaTracks, cat, streamHdrs, streams, seen);
              }
            }
          } catch (e) {}
        }
        if (streams.length > 0) break;
      }

      // Generic direct API paths
      var epIdParam = extraId ? ("&episodeId=" + encodeURIComponent(extraId)) : "";
      var directPaths = [
        "/api/anime/episode/sources?id=" + anilistId + "&ep=" + epNum + "&type=" + cat + epIdParam,
        "/api/sources?id=" + anilistId + "&ep=" + epNum + "&type=" + cat,
        "/api/anime/" + anilistId + "/episode/" + epNum + "/sources?type=" + cat,
        "/api/watch?id=" + anilistId + "&ep=" + epNum + "&sub=" + cat,
        "/api/stream?animeId=" + anilistId + "&episode=" + epNum + "&type=" + cat,
        "/api/episode/sources?episodeId=" + encodeURIComponent(extraId || (anilistId + "-" + epNum)) + "&type=" + cat,
      ];

      for (var di = 0; di < directPaths.length; di++) {
        try {
          var dRes = await this.client.get(base + directPaths[di], this.apiHeaders);
          if (dRes.statusCode !== 200 || !dRes.body) continue;
          var dJson = JSON.parse(dRes.body);
          var dSrcs = dJson.sources || (dJson.data && dJson.data.sources) || (Array.isArray(dJson) ? dJson : []);
          if (dSrcs.length > 0) {
            var dTracks = dJson.subtitles || dJson.tracks || (dJson.data && (dJson.data.subtitles || dJson.data.tracks)) || [];
            await this.processSources(dSrcs, dTracks, cat, streamHdrs, streams, seen);
            break;
          }
        } catch (e) {}
      }
    }

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
          summary: "Change if the site moves to a new domain",
          value: "https://anidap.se",
          dialogTitle: "Override base URL",
          dialogMessage: "",
        },
      },
      {
        key: "anidap_title_lang",
        listPreference: {
          title: "Preferred title language",
          summary: "",
          valueIndex: 0,
          entries: ["Romaji", "English", "Native"],
          entryValues: ["romaji", "english", "native"],
        },
      },
      {
        key: "anidap_audio_pref",
        listPreference: {
          title: "Preferred audio",
          summary: "Sub or Dub priority",
          valueIndex: 0,
          entries: ["Sub", "Dub"],
          entryValues: ["sub", "dub"],
        },
      },
    ];
  }
}
