const mangayomiSources = [
  {
    "name": "MyroniX",
    "id": 347219856,
    "lang": "en",
    "baseUrl": "https://myronix.strangled.net",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://myronix.strangled.net",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.0.1",
    "pkgPath": "anime/src/en/myronix.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": false,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/myronix.js",
    "dateFormat": "",
    "dateFormatLocale": "",
    "additionalParams": "",
    "sourceCodeLanguage": 1,
    "notes": "",
  },
];

class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
  }

  get ua() {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
  }

  get headers() {
    return {
      "User-Agent": this.ua,
      "Referer": this.source.baseUrl + "/",
    };
  }

  // Calls /api/v2/hianime{path} and returns json.data
  async apiGet(path) {
    var url = this.source.baseUrl + "/api/v2/hianime" + path;
    var res = await this.client.get(url, this.headers);
    if (res.statusCode !== 200) throw new Error("HTTP " + res.statusCode);
    var json = JSON.parse(res.body);
    if (!json || json.status !== 200) throw new Error("API error: " + res.body);
    return json.data;
  }

  parseAnimeList(animes) {
    var list = [];
    (animes || []).forEach(function(a) {
      var name = a.name || a.jname || "";
      var id = a.id || "";
      var imageUrl = a.poster || "";
      if (name && id) {
        list.push({
          name: name,
          link: id,
          imageUrl: imageUrl,
        });
      }
    });
    return list;
  }

  get supportsLatest() {
    return true;
  }

  async getPopular(page) {
    var data = await this.apiGet("/search?q=&sort=most-watched&page=" + page);
    return {
      list: this.parseAnimeList(data.animes),
      hasNextPage: data.hasNextPage || false,
    };
  }

  async getLatestUpdates(page) {
    var data = await this.apiGet("/search?q=&sort=recently-updated&page=" + page);
    return {
      list: this.parseAnimeList(data.animes),
      hasNextPage: data.hasNextPage || false,
    };
  }

  async search(query, page, filters) {
    var data = await this.apiGet(
      "/search?q=" + encodeURIComponent(query) + "&page=" + page
    );
    return {
      list: this.parseAnimeList(data.animes),
      hasNextPage: data.hasNextPage || false,
    };
  }

  statusCode(s) {
    s = (s || "").toLowerCase();
    if (s.includes("finished") || s.includes("completed")) return 1;
    if (s.includes("not yet") || s.includes("upcoming")) return 4;
    if (s.includes("airing") || s.includes("ongoing") || s.includes("releasing")) return 0;
    return 5;
  }

  async getDetail(url) {
    // url is either a bare anime id ("one-piece-100") or a full URL —
    // strip everything before the last path segment just in case.
    var animeId = url
      .replace(/^https?:\/\/[^/]+/, "")
      .replace(/^\/anime\//, "")
      .replace(/[?#].*$/, "")
      .replace(/^.*\//, "");
    if (!animeId) animeId = url;

    var data = await this.apiGet("/anime/" + animeId);
    var animeObj = data.anime || {};
    var info = animeObj.info || {};
    var moreInfo = animeObj.moreInfo || {};

    var name = info.name || info.jname || "";
    var imageUrl = info.poster || "";
    var description = info.description || "";
    var genre = moreInfo.genres || [];
    var status = this.statusCode(moreInfo.status || "");

    var chapters = [];
    try {
      var epData = await this.apiGet("/anime/" + animeId + "/episodes");
      var episodes = epData.episodes || [];
      for (var i = 0; i < episodes.length; i++) {
        var ep = episodes[i];
        var epNum = ep.number || String(i + 1);
        var epTitle = ep.title || "";
        var epName = "Episode " + epNum;
        if (epTitle) epName += ": " + epTitle;
        chapters.push({
          name: epName,
          url: ep.episodeId,
          isFiller: ep.isFiller || false,
        });
      }
      chapters.reverse();
    } catch (e) {}

    return {
      name: name,
      imageUrl: imageUrl,
      description: description,
      genre: genre,
      status: status,
      link: this.source.baseUrl + "/anime/" + animeId,
      chapters: chapters,
    };
  }

  async getVideoList(url) {
    // url is an episodeId like "one-piece-100?ep=12345"
    var streams = [];

    var serverData;
    try {
      serverData = await this.apiGet(
        "/episode/servers?animeEpisodeId=" + encodeURIComponent(url)
      );
    } catch (e) {
      return streams;
    }
    if (!serverData) return streams;

    var pref = "sub";
    try {
      pref = new SharedPreferences().get("myronix_pref_audio") || "sub";
    } catch (e) {}

    var categories = pref === "dub" ? ["dub", "sub"] : ["sub", "dub"];

    for (var ci = 0; ci < categories.length; ci++) {
      var category = categories[ci];
      var categoryServers = serverData[category] || [];

      for (var si = 0; si < categoryServers.length; si++) {
        var serverName = categoryServers[si].serverName;
        if (!serverName) continue;

        try {
          var srcData = await this.apiGet(
            "/episode/sources?animeEpisodeId=" + encodeURIComponent(url) +
            "&server=" + encodeURIComponent(serverName) +
            "&category=" + category
          );
          if (!srcData || !srcData.sources) continue;

          var streamHeaders = {
            "User-Agent": this.ua,
            "Referer": this.source.baseUrl + "/",
          };

          var subtitles = [];
          if (Array.isArray(srcData.tracks)) {
            srcData.tracks.forEach(function(t) {
              if (t.file && t.kind !== "thumbnails") {
                subtitles.push({ file: t.file, label: t.label || "Unknown" });
              }
            });
          }

          var sources = Array.isArray(srcData.sources) ? srcData.sources : [];
          sources.forEach(function(src) {
            var srcUrl = src.url || src.file;
            if (!srcUrl) return;
            streams.push({
              url: srcUrl,
              originalUrl: srcUrl,
              quality: serverName + " [" + category.toUpperCase() + "]",
              headers: streamHeaders,
              subtitles: subtitles,
            });
          });
        } catch (e) {}
      }
    }

    return streams;
  }

  getFilterList() {
    return [];
  }

  getSourcePreferences() {
    return [
      {
        key: "myronix_pref_audio",
        listPreference: {
          title: "Preferred audio",
          summary: "Which audio track appears first for streaming",
          valueIndex: 0,
          entries: ["Sub", "Dub"],
          entryValues: ["sub", "dub"],
        },
      },
    ];
  }
}
