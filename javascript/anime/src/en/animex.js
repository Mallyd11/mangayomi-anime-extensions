const mangayomiSources = [
  {
    "name": "AnimeX",
    "id": 234765891,
    "lang": "en",
    "baseUrl": "https://animex.one",
    "apiUrl": "https://pp.animex.one",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://animex.one",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.1.0",
    "pkgPath": "anime/src/en/animex.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": false,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/animex.js",
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

  get headers() {
    return {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
      "Referer": this.source.baseUrl + "/",
    };
  }

  getPreference(key) {
    return new SharedPreferences().get(key);
  }

  // ── AniList GraphQL (listings + metadata) ────────────────────────────────

  async anilistPost(query, variables) {
    var res = await this.client.post(
      "https://graphql.anilist.co",
      { "Content-Type": "application/json", "Accept": "application/json" },
      JSON.stringify({ query: query, variables: variables })
    );
    return JSON.parse(res.body);
  }

  parseAnilistPage(json) {
    var page = (json && json.data && json.data.Page) || {};
    var media = page.media || [];
    var hasNextPage = (page.pageInfo && page.pageInfo.hasNextPage) || false;
    var list = [];
    for (var i = 0; i < media.length; i++) {
      var m = media[i];
      list.push({
        name: (m.title && (m.title.english || m.title.romaji)) || String(m.id),
        link: String(m.id),
        imageUrl: (m.coverImage && m.coverImage.large) || "",
      });
    }
    return { list: list, hasNextPage: hasNextPage };
  }

  async getPopular(page) {
    var json = await this.anilistPost(
      "query($p:Int,$n:Int){Page(page:$p,perPage:$n){pageInfo{hasNextPage}media(sort:POPULARITY_DESC,type:ANIME,isAdult:false){id title{english romaji}coverImage{large}}}}",
      { p: page, n: 20 }
    );
    return this.parseAnilistPage(json);
  }

  async getLatestUpdates(page) {
    var json = await this.anilistPost(
      "query($p:Int,$n:Int){Page(page:$p,perPage:$n){pageInfo{hasNextPage}media(sort:START_DATE_DESC,type:ANIME,isAdult:false,status:RELEASING){id title{english romaji}coverImage{large}}}}",
      { p: page, n: 20 }
    );
    return this.parseAnilistPage(json);
  }

  async search(query, page, filters) {
    var json = await this.anilistPost(
      "query($p:Int,$n:Int,$q:String){Page(page:$p,perPage:$n){pageInfo{hasNextPage}media(search:$q,type:ANIME,isAdult:false){id title{english romaji}coverImage{large}}}}",
      { p: page, n: 20, q: query }
    );
    return this.parseAnilistPage(json);
  }

  // ── Animex SvelteKit __data.json parsing ─────────────────────────────────

  // Convert a title to an animex.one URL slug
  titleToSlug(title) {
    return (title || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .trim()
      .replace(/\s+/g, "-");
  }

  // Parse the SvelteKit flat-array data format
  parseSkData(body) {
    var json = JSON.parse(body);
    var nodes = json.nodes || [];
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].type === "data" && Array.isArray(nodes[i].data)) {
        return nodes[i].data;
      }
    }
    return null;
  }

  // Resolve anime fields from the flat array
  extractAnimeFromArr(arr) {
    if (!arr || arr.length < 2) return null;
    var rootMap = arr[0];
    if (!rootMap || typeof rootMap !== "object") return null;

    // Root map has { anime: N } where N is index of the anime field map
    var animeIdx = (rootMap.anime !== undefined) ? rootMap.anime : 1;
    var animeMap = arr[animeIdx];
    if (!animeMap || typeof animeMap !== "object") return null;

    var get = function(idx) {
      return (typeof idx === "number" && idx >= 0) ? arr[idx] : null;
    };

    var slug = get(animeMap.slug);
    var episodeCount = get(animeMap.episodeCount) || get(animeMap.episodes) || get(animeMap.totalEpisodes);
    var titleEnglish = get(animeMap.titleEnglish) || get(animeMap.englishTitle);
    var titleRomaji = get(animeMap.titleRomaji) || get(animeMap.romajiTitle);
    var anilistId = get(animeMap.anilistId);
    var description = get(animeMap.description) || get(animeMap.synopsis);
    var statusStr = get(animeMap.status);

    // coverImage is itself an object with large/extraLarge indices
    var coverObj = get(animeMap.coverImage);
    var imageUrl = null;
    if (coverObj && typeof coverObj === "object") {
      imageUrl = get(coverObj.large) || get(coverObj.extraLarge);
    }

    // genres is an array of indices pointing to strings
    var genreArr = get(animeMap.genres);
    var genres = [];
    if (Array.isArray(genreArr)) {
      for (var i = 0; i < genreArr.length; i++) {
        var g = arr[genreArr[i]];
        if (g) genres.push(g);
      }
    }

    return {
      slug: slug,
      episodeCount: episodeCount,
      title: titleEnglish || titleRomaji,
      anilistId: anilistId,
      description: description,
      imageUrl: imageUrl,
      genres: genres,
      status: statusStr,
    };
  }

  // Fetch the animex.one __data.json for an anime
  async fetchAnimexDetail(anilistId, title) {
    var slugAttempts = [];
    if (title) slugAttempts.push(this.titleToSlug(title));
    // Also try without articles
    slugAttempts.push("anime");

    for (var i = 0; i < slugAttempts.length; i++) {
      var path = "/anime/" + slugAttempts[i] + "-" + anilistId + "/__data.json";
      try {
        var res = await this.client.get(this.source.baseUrl + path, this.headers);
        if (res.statusCode === 200 && res.body) {
          var arr = this.parseSkData(res.body);
          if (arr) return arr;
        }
      } catch (e) {}
    }
    return null;
  }

  // ── Detail ────────────────────────────────────────────────────────────────

  statusCode(status) {
    return ({
      "RELEASING": 0,
      "FINISHED": 1,
      "NOT_YET_RELEASED": 4,
      "CANCELLED": 5,
      "HIATUS": 6,
    }[status]) ?? 5;
  }

  async getDetail(url) {
    var type = this.getPreference("animex_pref_type") || "sub";

    // Extract anilist ID — handle bare ID or full animex URL
    var anilistId;
    var prefix = this.source.baseUrl + "/anime/";
    if (url.startsWith(prefix)) {
      var slug = url.slice(prefix.length);
      anilistId = slug.split("-").pop();
    } else {
      anilistId = url;
    }

    // Get metadata from AniList
    var alJson = await this.anilistPost(
      "query($id:Int){Media(id:$id,type:ANIME){id title{english romaji}coverImage{large}description(asHtml:false)genres status episodes}}",
      { id: parseInt(anilistId) }
    );
    var media = (alJson && alJson.data && alJson.data.Media) || {};
    var title = (media.title && (media.title.english || media.title.romaji)) || String(anilistId);
    var imageUrl = (media.coverImage && media.coverImage.large) || "";
    var description = (media.description || "").replace(/<[^>]*>/g, "");
    var genres = media.genres || [];
    var alEpisodeCount = media.episodes || 0;

    // Get internal slug + episode count from animex.one
    var internalSlug = null;
    var episodeCount = alEpisodeCount;

    var arr = await this.fetchAnimexDetail(anilistId, title);
    if (arr) {
      var axData = this.extractAnimeFromArr(arr);
      if (axData) {
        if (axData.slug) internalSlug = axData.slug;
        if (axData.episodeCount) episodeCount = axData.episodeCount;
      }
    }

    // Fallback slug if animex page wasn't reachable
    if (!internalSlug) {
      internalSlug = this.titleToSlug(title) + "-" + anilistId;
    }

    // Build episode list
    var chapters = [];
    for (var i = 1; i <= episodeCount; i++) {
      chapters.push({
        name: "Episode " + i,
        url: internalSlug + "||" + i,
      });
    }

    return {
      name: title,
      imageUrl: imageUrl,
      description: description,
      genre: genres,
      status: this.statusCode(media.status || ""),
      link: this.source.baseUrl + "/anime/" + this.titleToSlug(title) + "-" + anilistId,
      chapters: chapters.reverse(),
    };
  }

  // ── Video sources ─────────────────────────────────────────────────────────

  async getVideoList(url) {
    // url format: "{internalSlug}||{episodeNum}"
    var parts = url.split("||");
    var internalSlug = parts[0];
    var epNum = parts[1];
    var type = this.getPreference("animex_pref_type") || "sub";

    // Fetch available servers
    var serversUrl = this.source.apiUrl + "/rest/api/servers?id=" + internalSlug + "&epNum=" + epNum;
    var serversRes = await this.client.get(serversUrl, this.headers);
    var servers = JSON.parse(serversRes.body);

    var providers = (type === "dub" ? servers.dubProviders : servers.subProviders) || [];
    if (providers.length === 0) {
      // Fall back to the other type if preferred is empty
      providers = (type === "dub" ? servers.subProviders : servers.dubProviders) || [];
      type = type === "dub" ? "sub" : "dub";
    }

    var videos = [];

    for (var pi = 0; pi < providers.length; pi++) {
      var provider = providers[pi];
      try {
        var sourcesUrl = this.source.apiUrl + "/rest/api/sources"
          + "?id=" + internalSlug
          + "&epNum=" + epNum
          + "&type=" + type
          + "&providerId=" + provider.id;

        var sourcesRes = await this.client.get(sourcesUrl, this.headers);
        var sourceData = JSON.parse(sourcesRes.body);

        var sources = sourceData.sources || [];
        var tracks = sourceData.tracks || [];
        var srcHeaders = sourceData.headers || { "Referer": this.source.baseUrl };

        var subtitles = [];
        if (Array.isArray(tracks)) {
          for (var ti = 0; ti < tracks.length; ti++) {
            var t = tracks[ti];
            if (t && t.file && t.label) {
              subtitles.push({ label: t.label, file: t.file });
            }
          }
        }

        for (var si = 0; si < sources.length; si++) {
          var s = sources[si];
          videos.push({
            url: s.url,
            originalUrl: s.url,
            quality: provider.id + " [" + (s.quality || "auto") + "]",
            headers: srcHeaders,
            subtitles: subtitles,
          });
        }
      } catch (e) {}
    }

    return videos;
  }

  // ── Preferences ───────────────────────────────────────────────────────────

  getFilterList() {
    return [];
  }

  getSourcePreferences() {
    return [
      {
        key: "animex_pref_type",
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
