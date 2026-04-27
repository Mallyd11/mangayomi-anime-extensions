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
    "version": "0.1.1",
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

  // ── AniList ID extraction from Jikan external links ──────────────────────

  anilistIdFromExternal(external) {
    for (var i = 0; i < external.length; i++) {
      var name = (external[i].name || "").toLowerCase();
      if (name === "anilist") {
        var parts = (external[i].url || "").split("/anime/");
        if (parts.length > 1 && parts[1]) return parts[1].split("/")[0];
      }
    }
    return null;
  }

  // ── Animex SvelteKit __data.json parsing ─────────────────────────────────

  titleToSlug(title) {
    return (title || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .trim()
      .replace(/\s+/g, "-");
  }

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

  extractAnimeFromArr(arr) {
    if (!arr || arr.length < 2) return null;
    var rootMap = arr[0];
    if (!rootMap || typeof rootMap !== "object") return null;

    var animeIdx = (rootMap.anime !== undefined) ? rootMap.anime : 1;
    var animeMap = arr[animeIdx];
    if (!animeMap || typeof animeMap !== "object") return null;

    var get = function(idx) {
      return (typeof idx === "number" && idx >= 0) ? arr[idx] : null;
    };

    var slug = get(animeMap.slug);
    var episodeCount = get(animeMap.episodeCount) || get(animeMap.episodes) || get(animeMap.totalEpisodes);

    return { slug: slug, episodeCount: episodeCount };
  }

  async fetchAnimexDetail(anilistId, title) {
    var slug = this.titleToSlug(title) || "anime";
    var path = "/anime/" + slug + "-" + anilistId + "/__data.json";
    try {
      var res = await this.client.get(this.source.baseUrl + path, this.headers);
      if (res.statusCode === 200 && res.body) {
        return this.parseSkData(res.body);
      }
    } catch (e) {}
    return null;
  }

  // ── Detail ────────────────────────────────────────────────────────────────

  statusCode(status) {
    return ({
      "Currently Airing": 0,
      "Finished Airing": 1,
      "Not yet aired": 4,
    }[status]) ?? 5;
  }

  async getDetail(url) {
    // Extract MAL ID — handle bare ID or full animex URL
    var malId;
    var prefix = this.source.baseUrl + "/anime/";
    if (url.startsWith(prefix)) {
      malId = url.slice(prefix.length).split("-").pop();
    } else {
      malId = url;
    }

    // Get metadata + external links from Jikan
    var json = await this.jikanGet("/anime/" + malId + "/full");
    var anime = (json && json.data) || {};

    var title = anime.title_english || anime.title || malId;
    var imageUrl = (anime.images && anime.images.jpg && anime.images.jpg.large_image_url) || "";
    var description = anime.synopsis || "";
    var genres = (anime.genres || []).map(function(g) { return g.name; });
    var jikanEpisodeCount = anime.episodes || 0;

    // Get AniList ID from Jikan external links
    var anilistId = this.anilistIdFromExternal(anime.external || []);

    // Get internal animex slug + episode count from animex.one __data.json
    var internalSlug = null;
    var episodeCount = jikanEpisodeCount;

    if (anilistId) {
      var arr = await this.fetchAnimexDetail(anilistId, title);
      if (arr) {
        var axData = this.extractAnimeFromArr(arr);
        if (axData) {
          if (axData.slug) internalSlug = axData.slug;
          if (axData.episodeCount) episodeCount = axData.episodeCount;
        }
      }
    }

    if (!internalSlug) {
      internalSlug = this.titleToSlug(title) + "-" + (anilistId || malId);
    }

    var chapters = [];
    for (var i = 1; i <= episodeCount; i++) {
      chapters.push({ name: "Episode " + i, url: internalSlug + "||" + i });
    }

    return {
      name: title,
      imageUrl: imageUrl,
      description: description,
      genre: genres,
      status: this.statusCode(anime.status || ""),
      link: this.source.baseUrl + "/anime/" + this.titleToSlug(title) + "-" + (anilistId || malId),
      chapters: chapters.reverse(),
    };
  }

  // ── Video sources ─────────────────────────────────────────────────────────

  async getVideoList(url) {
    var parts = url.split("||");
    var internalSlug = parts[0];
    var epNum = parts[1];
    var type = this.getPreference("animex_pref_type") || "sub";

    var serversUrl = this.source.apiUrl + "/rest/api/servers?id=" + internalSlug + "&epNum=" + epNum;
    var serversRes = await this.client.get(serversUrl, this.headers);
    var servers = JSON.parse(serversRes.body);

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
