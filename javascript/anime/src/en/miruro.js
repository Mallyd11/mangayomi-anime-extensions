const mangayomiSources = [
  {
    "name": "Miruro",
    "id": 879461035,
    "lang": "en",
    "baseUrl": "https://www.miruro.to",
    "apiUrl": "https://graphql.anilist.co",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://www.miruro.to",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.1.5",
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
    // All known miruro domains share the same backend
    this.miruroDomains = [
      "https://www.miruro.to",
      "https://www.miruro.tv",
      "https://www.miruro.com",
    ];
  }

  getPreference(key) {
    return new SharedPreferences().get(key);
  }

  miruroHeaders(domain) {
    return {
      "Origin": domain,
      "Referer": domain + "/",
      "x-protocol-version": "0.1.0",
      "Accept": "application/json",
    };
  }

  // Try each miruro domain in order, return the first 200 response body parsed as JSON.
  // Returns null if all domains fail.
  async miruroGet(path) {
    for (var i = 0; i < this.miruroDomains.length; i++) {
      var domain = this.miruroDomains[i];
      try {
        var res = await this.client.get(domain + path, this.miruroHeaders(domain));
        if (res.statusCode === 200) {
          return JSON.parse(res.body);
        }
      } catch (e) {
        // Try next domain
      }
    }
    return null;
  }

  // ── AniList GraphQL (inline GET — no variables, no POST needed) ─────────

  async anilistGet(query) {
    var url = "https://graphql.anilist.co?query=" + encodeURIComponent(query);
    var res = await this.client.get(url, { "Accept": "application/json" });
    var json = JSON.parse(res.body);
    return (json && json.data) || null;
  }

  async fetchAnimeList(sortField, page) {
    var query = "{Page(page:" + page + ",perPage:20){pageInfo{hasNextPage}media(type:ANIME,sort:[" + sortField + "]){id title{romaji english}coverImage{large}}}}";
    var data = await this.anilistGet(query);
    if (!data || !data.Page) return { list: [], hasNextPage: false };
    return this.parseAnilistPage(data.Page);
  }

  parseAnilistPage(page) {
    var list = [];
    var media = page.media || [];
    for (var i = 0; i < media.length; i++) {
      var m = media[i];
      list.push({
        name: (m.title && (m.title.english || m.title.romaji)) || "Unknown",
        link: String(m.id),
        imageUrl: (m.coverImage && m.coverImage.large) || "",
      });
    }
    return {
      list: list,
      hasNextPage: (page.pageInfo && page.pageInfo.hasNextPage) || false,
    };
  }

  async getPopular(page) {
    return this.fetchAnimeList("POPULARITY_DESC", page);
  }

  async getLatestUpdates(page) {
    return this.fetchAnimeList("UPDATED_AT_DESC", page);
  }

  async search(query, page, filters) {
    var escaped = query.replace(/"/g, "\\\"");
    var gql = "{Page(page:" + page + ",perPage:20){pageInfo{hasNextPage}media(type:ANIME,search:\"" + escaped + "\"){id title{romaji english}coverImage{large}}}}";
    var data = await this.anilistGet(gql);
    if (!data || !data.Page) return { list: [], hasNextPage: false };
    return this.parseAnilistPage(data.Page);
  }

  // ── Detail + Episodes ────────────────────────────────────────────────────

  statusCode(status) {
    return ({
      "RELEASING": 0,
      "FINISHED": 1,
      "NOT_YET_RELEASED": 4,
    }[status] ?? 5);
  }

  async getDetail(url) {
    var anilistId = url;
    var provider = this.getPreference("miruro_pref_provider") || "zoro";
    var type = this.getPreference("miruro_pref_type") || "sub";

    // Fetch anime metadata from AniList
    var gql = "{Media(id:" + parseInt(anilistId) + ",type:ANIME){title{english romaji}coverImage{large}description(asHtml:false)genres status}}";
    var data = await this.anilistGet(gql);
    var media = (data && data.Media) || {};
    var name = (media.title && (media.title.english || media.title.romaji)) || anilistId;

    // Fetch episodes from miruro (tries all domains)
    var epData = await this.miruroGet("/api/episodes?anilistId=" + anilistId);
    var chapters = [];

    if (epData) {
      var providers = epData.providers || epData || {};

      // Try preferred provider first, then fall back to any available
      var providerKeys = [provider];
      var allKeys = Object.keys(providers);
      for (var i = 0; i < allKeys.length; i++) {
        if (providerKeys.indexOf(allKeys[i]) === -1) providerKeys.push(allKeys[i]);
      }

      for (var p = 0; p < providerKeys.length; p++) {
        var provKey = providerKeys[p];
        var providerData = providers[provKey];
        if (!providerData) continue;

        var episodes = (providerData.episodes && providerData.episodes[type])
          || (providerData.episodes && providerData.episodes["sub"])
          || providerData[type]
          || providerData["sub"]
          || [];

        if (!Array.isArray(episodes) || episodes.length === 0) continue;

        for (var e = 0; e < episodes.length; e++) {
          var ep = episodes[e];
          var epNum = ep.number || ep.num || (e + 1);
          var epTitle = ep.title || ep.name || "";
          var epName = epTitle ? "E" + epNum + ": " + epTitle : "Episode " + epNum;
          // Encode provider and type alongside the episode ID for getVideoList
          var epId = ep.id || ep.episodeId || String(epNum);
          chapters.push({ name: epName, url: epId + "||" + provKey + "||" + type });
        }
        break; // Used first working provider
      }
    }

    return {
      name: name,
      imageUrl: (media.coverImage && media.coverImage.large) || "",
      description: ((media.description || "").replace(/<[^>]*>/g, "")),
      genre: media.genres || [],
      status: this.statusCode(media.status),
      link: this.source.baseUrl + "/info/" + anilistId,
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
