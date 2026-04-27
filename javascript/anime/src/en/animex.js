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
    "version": "0.1.4",
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
      "Accept": "*/*",
    };
  }

  getPreference(key) {
    return new SharedPreferences().get(key);
  }

  // ── Jikan (MyAnimeList) — simple GET, no auth ────────────────────────────

  async jikanGet(path) {
    var res = await this.client.get(
      "https://api.jikan.moe/v4" + path,
      { "Accept": "application/json" }
    );
    return JSON.parse(res.body);
  }

  parseJikanList(json) {
    var items = (json && json.data) || [];
    var hasNextPage = !!(json && json.pagination && json.pagination.has_next_page);
    var list = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      list.push({
        name: item.title_english || item.title || "",
        link: String(item.mal_id),
        imageUrl: (item.images && item.images.jpg && item.images.jpg.large_image_url) || "",
      });
    }
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

  // ── Helpers ───────────────────────────────────────────────────────────────

  titleToSlug(title) {
    return (title || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .trim()
      .replace(/\s+/g, "-");
  }

  anilistIdFromExternal(external) {
    for (var i = 0; i < external.length; i++) {
      if ((external[i].name || "").toLowerCase() === "anilist") {
        var parts = (external[i].url || "").split("/anime/");
        if (parts.length > 1 && parts[1]) return parts[1].split("/")[0];
      }
    }
    return null;
  }

  statusCode(status) {
    return ({
      "Currently Airing": 0,
      "Finished Airing": 1,
      "Not yet aired": 4,
    }[status]) ?? 5;
  }

  // ── SvelteKit __data.json parser ─────────────────────────────────────────

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

  // Extracts the internal animex slug from the flat SvelteKit data array.
  extractInternalSlug(arr) {
    if (!arr || arr.length < 2) return null;

    // Try the structured path first: arr[0] is the root map
    var rootMap = arr[0];
    if (rootMap && typeof rootMap === "object") {
      var animeIdx = (rootMap.anime !== undefined) ? rootMap.anime : 1;
      var animeMap = arr[animeIdx];
      if (animeMap && typeof animeMap === "object") {
        var slugIdx = animeMap.slug;
        if (typeof slugIdx === "number" && slugIdx >= 0 && arr[slugIdx]) {
          return arr[slugIdx];
        }
      }
    }

    // Fallback: scan the array for a string matching {slug}-{number}
    for (var i = 0; i < arr.length; i++) {
      if (typeof arr[i] === "string" && /^[a-z0-9][a-z0-9-]+-\d+$/.test(arr[i])) {
        return arr[i];
      }
    }

    return null;
  }

  // ── Detail ────────────────────────────────────────────────────────────────

  async getDetail(url) {
    // Extract MAL ID from bare ID or stored animex URL
    var malId;
    var prefix = this.source.baseUrl + "/anime/";
    if (url.startsWith(prefix)) {
      // Last hyphen-separated segment is the ID we stored (malId)
      malId = url.slice(prefix.length).split("-").pop();
    } else {
      malId = url;
    }

    // Metadata from Jikan
    var json = await this.jikanGet("/anime/" + malId + "/full");
    var anime = (json && json.data) || {};

    var title = anime.title_english || anime.title || malId;
    var imageUrl = (anime.images && anime.images.jpg && anime.images.jpg.large_image_url) || "";
    var description = anime.synopsis || "";
    var genres = (anime.genres || []).map(function(g) { return g.name; });
    var episodeCount = anime.episodes || 0;

    // AniList ID from Jikan's external links — used for the animex.one URL
    var anilistId = this.anilistIdFromExternal(anime.external || []);

    // Episode URL format: "{titleSlug}-{anilistId||malId}||{epNum}"
    // getVideoList fetches the watch page __data.json to resolve the
    // real internal slug at play time, so we only need the public slug here.
    var publicSlug = this.titleToSlug(title) + "-" + (anilistId || malId);

    var chapters = [];
    for (var i = 1; i <= episodeCount; i++) {
      chapters.push({ name: "Episode " + i, url: publicSlug + "||" + i });
    }

    return {
      name: title,
      imageUrl: imageUrl,
      description: description,
      genre: genres,
      status: this.statusCode(anime.status || ""),
      // Store malId at end so re-opens still use Jikan correctly
      link: this.source.baseUrl + "/anime/" + this.titleToSlug(title) + "-" + malId,
      chapters: chapters.reverse(),
    };
  }

  // ── Video sources ─────────────────────────────────────────────────────────

  async getVideoList(url) {
    // url format: "{publicSlug}||{epNum}"  e.g. "one-piece-21||2"
    var parts = url.split("||");
    var publicSlug = parts[0]; // e.g. "one-piece-21"
    var epNum = parts[1];      // e.g. "2"
    var type = this.getPreference("animex_pref_type") || "sub";

    // Fetch the animex.one watch page __data.json to get the real internal
    // slug (e.g. "one-piece-p8k27").  The ?x-sveltekit-invalidated=01 param
    // is required for SvelteKit to return JSON instead of full HTML.
    var watchPath = "/watch/" + publicSlug + "-episode-" + epNum
      + "/__data.json?x-sveltekit-invalidated=01";

    var internalSlug = null;
    try {
      var watchRes = await this.client.get(this.source.baseUrl + watchPath, this.headers);
      if (watchRes.statusCode === 200 && watchRes.body) {
        var arr = this.parseSkData(watchRes.body);
        internalSlug = this.extractInternalSlug(arr);
      }
    } catch (e) {}

    // Fall back to the public slug when __data.json is unavailable or unparseable
    if (!internalSlug) internalSlug = publicSlug;

    // Fetch available sub/dub server list
    var servers;
    try {
      var serversUrl = this.source.apiUrl + "/rest/api/servers?id=" + internalSlug + "&epNum=" + epNum;
      var serversRes = await this.client.get(serversUrl, this.headers);
      servers = JSON.parse(serversRes.body);
    } catch (e) {
      return [];
    }

    var providers = (type === "dub" ? servers.dubProviders : servers.subProviders) || [];
    if (providers.length === 0) {
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
          if (!s || !s.url) continue;
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
