const mangayomiSources = [
  {
    "name": "Anidap",
    "id": 543219876,
    "lang": "en",
    "baseUrl": "https://anidap.se",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://anidap.se",
    "typeSource": "single",
    "itemType": 1,
    "version": "1.0.0",
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

// ─── AniList GraphQL queries ────────────────────────────────────────────────

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

  get siteHeaders() {
    return {
      "User-Agent": this.ua,
      "Accept": "application/json, */*",
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
    var data = await this.gql(PAGE_MEDIA_QUERY, {
      page: page, perPage: 24, sort: ["POPULARITY_DESC"],
    });
    var p = (data && data.Page) || {};
    return {
      list: this.parseMedia(p.media),
      hasNextPage: !!(p.pageInfo && p.pageInfo.hasNextPage),
    };
  }

  async getLatestUpdates(page) {
    var data = await this.gql(PAGE_MEDIA_QUERY, {
      page: page, perPage: 24, sort: ["UPDATED_AT_DESC"],
    });
    var p = (data && data.Page) || {};
    return {
      list: this.parseMedia(p.media),
      hasNextPage: !!(p.pageInfo && p.pageInfo.hasNextPage),
    };
  }

  async search(query, page, filters) {
    var vars = { page: page, perPage: 24 };
    if (query && query.length > 0) {
      vars.search = query;
      vars.sort = ["SEARCH_MATCH"];
    } else {
      vars.sort = ["POPULARITY_DESC"];
    }
    var data = await this.gql(PAGE_MEDIA_QUERY, vars);
    var p = (data && data.Page) || {};
    return {
      list: this.parseMedia(p.media),
      hasNextPage: !!(p.pageInfo && p.pageInfo.hasNextPage),
    };
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

  // ── Episode fetching ───────────────────────────────────────────────────────

  // Try multiple common API paths for the episode list.
  // Returns a raw array of episode objects, or [] on failure.
  async fetchEpisodes(anilistId) {
    var base = this.getBaseUrl();
    var paths = [
      "/api/anime/episodes?id=" + anilistId,
      "/api/episodes/" + anilistId,
      "/api/anime/" + anilistId + "/episodes",
      "/api/v1/episodes?animeId=" + anilistId,
    ];
    for (var i = 0; i < paths.length; i++) {
      try {
        var res = await this.client.get(base + paths[i], this.siteHeaders);
        if (res.statusCode !== 200 || !res.body) continue;
        var json = JSON.parse(res.body);
        var eps = Array.isArray(json) ? json
          : (json.episodes || json.data || json.results || []);
        if (Array.isArray(eps) && eps.length > 0) return eps;
      } catch (e) { /* try next */ }
    }
    return [];
  }

  // ── Detail ─────────────────────────────────────────────────────────────────

  async getDetail(url) {
    var anilistId = parseInt(url.replace(/[^0-9]/g, ""), 10);
    if (!anilistId) throw new Error("Cannot parse AniList ID: " + url);

    var data = await this.gql(MEDIA_DETAIL_QUERY, { id: anilistId });
    var m = (data && data.Media) || {};

    var name = this.titleByPref(m.title || {});
    var imageUrl = (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large)) || "";
    var description = (m.description || "").replace(/<[^>]*>/g, "").replace(/\n{3,}/g, "\n\n").trim();
    var genre = m.genres || [];
    var status = this.statusCode(m.status);
    var epCount = m.episodes || 0;
    var isMovie = m.format === "MOVIE";

    var chapters = [];
    var rawEps = await this.fetchEpisodes(anilistId);

    if (rawEps.length > 0) {
      rawEps.forEach(function(ep) {
        var num = ep.number || ep.ep_num || ep.episode || ep.episodeNumber || ep.num || "";
        var title = ep.title || ep.name || ("Episode " + num);
        var epId = ep.id || ep.episodeId || ep.episode_id || ep._id || "";
        var chName = isMovie ? (name || title) : ("E" + num + " — " + title);
        chapters.push({
          name: chName,
          url: anilistId + "|" + num + (epId ? "|" + epId : ""),
        });
      });
    } else if (epCount > 0) {
      // Fallback: generate stubs from AniList episode count
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

      var baseDir = playlistUrl.substring(0, playlistUrl.lastIndexOf("/") + 1);
      var variants = [];
      var lines = body.split("\n");
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.indexOf("#EXT-X-STREAM-INF:") !== 0) continue;
        var rm = line.match(/RESOLUTION=(\d+)x(\d+)/);
        var bw = line.match(/BANDWIDTH=(\d+)/);
        var label = rm ? rm[2] + "p"
                       : (bw ? Math.round(parseInt(bw[1]) / 1000) + "kbps" : "Auto");
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

  // ── Stream sources ─────────────────────────────────────────────────────────

  // Try multiple common API paths for episode streaming sources.
  // Returns parsed JSON with a .sources array, or null on failure.
  async fetchSources(anilistId, epNum, episodeId, category) {
    var base = this.getBaseUrl();
    var epIdParam = episodeId ? ("&episodeId=" + encodeURIComponent(episodeId)) : "";
    var paths = [
      "/api/anime/episode/sources?id=" + anilistId + "&ep=" + epNum + "&type=" + category + epIdParam,
      "/api/sources?id=" + anilistId + "&ep=" + epNum + "&type=" + category + epIdParam,
      "/api/anime/" + anilistId + "/episode/" + epNum + "/sources?type=" + category,
      "/api/watch?id=" + anilistId + "&ep=" + epNum + "&sub=" + category,
    ];
    if (episodeId) {
      paths.push("/api/episode/sources?episodeId=" + encodeURIComponent(episodeId) + "&type=" + category);
    }
    for (var i = 0; i < paths.length; i++) {
      try {
        var res = await this.client.get(base + paths[i], this.siteHeaders);
        if (res.statusCode !== 200 || !res.body) continue;
        var json = JSON.parse(res.body);
        var sources = json.sources
          || (json.data && json.data.sources)
          || (Array.isArray(json) ? json : null);
        if (sources && sources.length > 0) return json;
      } catch (e) { /* try next */ }
    }
    return null;
  }

  async getVideoList(url) {
    // Chapter URL: "{anilistId}|{epNum}" or "{anilistId}|{epNum}|{episodeId}"
    var parts = url.split("|");
    var anilistId = parts[0] || "";
    var epNum     = parts[1] || "";
    var episodeId = parts[2] || "";
    if (!anilistId || !epNum) return [];

    var audioPref  = this.getPreference("anidap_audio_pref");
    var categories = audioPref === "dub" ? ["dub", "sub"] : ["sub", "dub"];

    var streams = [];
    var seen    = {};
    var streamHeaders = {
      "User-Agent": this.ua,
      "Referer": this.getBaseUrl() + "/",
    };

    for (var ci = 0; ci < categories.length; ci++) {
      var cat  = categories[ci];
      var json = await this.fetchSources(anilistId, epNum, episodeId, cat);
      if (!json) continue;

      var sources = json.sources
        || (json.data && json.data.sources)
        || (Array.isArray(json) ? json : []);
      var rawTracks = json.subtitles || json.tracks
        || (json.data && (json.data.subtitles || json.data.tracks))
        || [];
      var subtitles = [];
      rawTracks.forEach(function(t) {
        if (t && (t.url || t.file)) {
          subtitles.push({ file: t.url || t.file, label: t.label || t.lang || "Unknown" });
        }
      });

      for (var k = 0; k < sources.length; k++) {
        var src    = sources[k];
        var srcUrl = src && (src.url || src.file || src.link || src.src);
        if (!srcUrl) continue;

        var isHls = srcUrl.indexOf(".m3u8") >= 0 || src.isM3U8 === true || src.type === "hls";
        var quality = src.quality || src.resolution || "";

        if (isHls) {
          var resolved = await this.resolveHls(srcUrl, streamHeaders);
          if (resolved.kind === "master") {
            for (var vi = 0; vi < resolved.variants.length; vi++) {
              var v = resolved.variants[vi];
              var vKey = v.url + "|" + cat;
              if (seen[vKey]) continue;
              seen[vKey] = true;
              streams.push({
                url: v.url,
                originalUrl: srcUrl,
                quality: v.label + " [" + cat.toUpperCase() + "]",
                headers: streamHeaders,
                subtitles: subtitles,
              });
            }
          } else if (resolved.kind === "flat") {
            var fKey = srcUrl + "|" + cat;
            if (!seen[fKey]) {
              seen[fKey] = true;
              streams.push({
                url: srcUrl,
                originalUrl: srcUrl,
                quality: (quality || "HLS") + " [" + cat.toUpperCase() + "]",
                headers: streamHeaders,
                subtitles: subtitles,
              });
            }
          }
        } else {
          var dKey = srcUrl + "|" + cat;
          if (!seen[dKey]) {
            seen[dKey] = true;
            streams.push({
              url: srcUrl,
              originalUrl: srcUrl,
              quality: (quality || "Auto") + " [" + cat.toUpperCase() + "]",
              headers: streamHeaders,
              subtitles: subtitles,
            });
          }
        }
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
