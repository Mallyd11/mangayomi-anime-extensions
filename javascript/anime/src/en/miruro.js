const mangayomiSources = [
  {
    "name": "Miruro",
    "id": 879461035,
    "lang": "en",
    "baseUrl": "https://www.miruro.to",
    "apiUrl": "https://api.jikan.moe/v4",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://www.miruro.to",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.1.7",
    "pkgPath": "anime/src/en/miruro.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": false,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/miruro.js",
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
    this.miruroDomains = [
      "https://www.miruro.to",
      "https://www.miruro.tv",
      "https://www.miruro.com",
    ];
  }

  getPreference(key) {
    return new SharedPreferences().get(key);
  }

  // ── Miruro API (tries all domains) ───────────────────────────────────────

  miruroHeaders(domain) {
    return {
      "Origin": domain,
      "Referer": domain + "/",
      "x-protocol-version": "0.1.0",
      "Accept": "application/json",
    };
  }

  async miruroGet(path) {
    for (var i = 0; i < this.miruroDomains.length; i++) {
      var domain = this.miruroDomains[i];
      try {
        var res = await this.client.get(domain + path, this.miruroHeaders(domain));
        if (res.statusCode === 200) {
          return JSON.parse(res.body);
        }
      } catch (e) {}
    }
    return null;
  }

  // ── Jikan (MyAnimeList) — GET only, no auth ──────────────────────────────

  async jikanGet(path) {
    var res = await this.client.get(
      this.source.apiUrl + path,
      { "Accept": "application/json" }
    );
    return JSON.parse(res.body);
  }

  parseJikanList(json) {
    var items = (json && json.data) || [];
    var list = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var title = item.title_english || item.title || "";
      var img = (item.images && item.images.jpg && item.images.jpg.large_image_url) || "";
      list.push({ name: title, link: String(item.mal_id), imageUrl: img });
    }
    var hasNextPage = !!(json && json.pagination && json.pagination.has_next_page);
    return { list: list, hasNextPage: hasNextPage };
  }

  async getPopular(page) {
    var json = await this.jikanGet("/top/anime?page=" + page + "&limit=20");
    return this.parseJikanList(json);
  }

  async getLatestUpdates(page) {
    var json = await this.jikanGet(
      "/anime?status=airing&order_by=start_date&sort=desc&page=" + page + "&limit=20"
    );
    return this.parseJikanList(json);
  }

  async search(query, page, filters) {
    var json = await this.jikanGet(
      "/anime?q=" + encodeURIComponent(query) + "&page=" + page + "&limit=20"
    );
    return this.parseJikanList(json);
  }

  // ── Detail + Episodes ────────────────────────────────────────────────────

  statusCode(status) {
    return ({
      "Currently Airing": 0,
      "Finished Airing": 1,
      "Not yet aired": 4,
    }[status] ?? 5);
  }

  anilistIdFromExternal(external) {
    for (var i = 0; i < external.length; i++) {
      if (external[i].name === "AniList") {
        var parts = (external[i].url || "").split("/anime/");
        if (parts.length > 1 && parts[1]) return parts[1].split("/")[0];
      }
    }
    return null;
  }

  async getDetail(url) {
    var malId = url;
    var provider = this.getPreference("miruro_pref_provider") || "zoro";
    var type = this.getPreference("miruro_pref_type") || "sub";

    // /full includes the external[] array (has AniList link) — plain /anime/{id} omits it
    var res = await this.jikanGet("/anime/" + malId + "/full");
    var anime = (res && res.data) || {};

    var name = anime.title_english || anime.title || malId;
    var imageUrl = (anime.images && anime.images.jpg && anime.images.jpg.large_image_url) || "";
    var description = anime.synopsis || "";
    var genres = [];
    var genreList = anime.genres || [];
    for (var g = 0; g < genreList.length; g++) {
      genres.push(genreList[g].name);
    }

    // Get AniList ID from the external links Jikan provides
    var anilistId = this.anilistIdFromExternal(anime.external || []);

    var chapters = [];
    if (anilistId) {
      var epData = await this.miruroGet("/api/episodes?anilistId=" + anilistId);
      if (epData) {
        var providers = epData.providers || epData || {};
        var providerKeys = [provider];
        var allKeys = Object.keys(providers);
        for (var k = 0; k < allKeys.length; k++) {
          if (providerKeys.indexOf(allKeys[k]) === -1) providerKeys.push(allKeys[k]);
        }

        for (var p = 0; p < providerKeys.length; p++) {
          var provKey = providerKeys[p];
          var provData = providers[provKey];
          if (!provData) continue;

          var episodes = (provData.episodes && provData.episodes[type])
            || (provData.episodes && provData.episodes["sub"])
            || provData[type]
            || provData["sub"]
            || [];

          if (!Array.isArray(episodes) || episodes.length === 0) continue;

          for (var e = 0; e < episodes.length; e++) {
            var ep = episodes[e];
            var epNum = ep.number || ep.num || (e + 1);
            var epTitle = ep.title || ep.name || "";
            var epName = epTitle ? "E" + epNum + ": " + epTitle : "Episode " + epNum;
            var epId = ep.id || ep.episodeId || String(epNum);
            chapters.push({ name: epName, url: epId + "||" + provKey + "||" + type });
          }
          break;
        }
      }
    }

    return {
      name: name,
      imageUrl: imageUrl,
      description: description,
      genre: genres,
      status: this.statusCode(anime.status || ""),
      link: this.source.baseUrl + "/info/" + (anilistId || malId),
      chapters: chapters.reverse(),
    };
  }

  // ── Video Sources ────────────────────────────────────────────────────────

  async getVideoList(url) {
    // url format: "{episodeId}||{provider}||{type}"
    var parts = url.split("||");
    var episodeId = parts[0] || url;
    var provider = parts[1] || this.getPreference("miruro_pref_provider") || "zoro";
    var category = parts[2] || this.getPreference("miruro_pref_type") || "sub";

    var path = "/api/sources"
      + "?episodeId=" + encodeURIComponent(episodeId)
      + "&provider=" + provider
      + "&category=" + category;

    var data = await this.miruroGet(path);
    if (!data) return [];

    var sources = data.streams || data.sources || [];
    var tracks = data.tracks || data.subtitles || [];

    var subtitles = [];
    for (var i = 0; i < tracks.length; i++) {
      var track = tracks[i];
      if (track.kind === "captions" || (!track.kind && track.label)) {
        subtitles.push({
          label: track.label || track.lang || "",
          file: track.url || track.file || "",
        });
      }
    }

    var headers = { "Referer": "https://megacloud.blog/" };
    var videos = [];
    for (var j = 0; j < sources.length; j++) {
      var source = sources[j];
      videos.push({
        url: source.url,
        originalUrl: source.url,
        quality: source.quality || "Auto",
        headers: headers,
        subtitles: subtitles,
      });
    }

    return videos;
  }

  // ── Preferences ──────────────────────────────────────────────────────────

  getSourcePreferences() {
    return [
      {
        key: "miruro_pref_provider",
        listPreference: {
          title: "Preferred provider",
          summary: "Source site for episodes and streams",
          valueIndex: 0,
          entries: ["Zoro / HiAnime", "Gogoanime"],
          entryValues: ["zoro", "gogoanime"],
        },
      },
      {
        key: "miruro_pref_type",
        listPreference: {
          title: "Preferred type",
          summary: "Sub or Dub",
          valueIndex: 0,
          entries: ["Sub", "Dub"],
          entryValues: ["sub", "dub"],
        },
      },
    ];
  }
}
