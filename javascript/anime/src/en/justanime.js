const mangayomiSources = [
  {
    "name": "JustAnime",
    "id": 892345671,
    "lang": "en",
    "baseUrl": "https://justanime.to",
    "apiUrl": "https://core.justanime.to/api",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://justanime.to",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.1.3",
    "pkgPath": "anime/src/en/justanime.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": false,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/justanime.js",
    "dateFormat": "",
    "dateFormatLocale": "",
    "additionalParams": "",
    "sourceCodeLanguage": 1,
    "notes": "",
  },
];

class DefaultExtension extends MProvider {
  get headers() {
    return {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
      "Origin": "https://justanime.to",
      "Referer": "https://justanime.to/",
      "Accept": "application/json",
    };
  }

  async apiGet(path) {
    var res = await new Client().get(this.source.apiUrl + path, this.headers);
    return JSON.parse(res.body);
  }

  animeTitle(item) {
    if (!item.title) return item.name || "";
    if (typeof item.title === "string") return item.title;
    return item.title.english || item.title.romaji || "";
  }

  parseAnimeList(items) {
    var list = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      list.push({
        name: this.animeTitle(item),
        link: String(item.id),
        imageUrl: item.cover || (item.coverImage && item.coverImage.extraLarge) || "",
      });
    }
    return list;
  }

  statusCode(status) {
    return ({
      "RELEASING": 0,
      "FINISHED": 1,
      "NOT_YET_RELEASED": 4,
      "CANCELLED": 5,
      "HIATUS": 6,
    }[status]) || 5;
  }

  stripHtml(str) {
    return (str || "").replace(/<[^>]*>/g, " ").replace(/\s{2,}/g, " ").trim();
  }

  titleToSlug(title) {
    return (title || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .trim()
      .replace(/\s+/g, "-");
  }

  // Accepts bare ID, /anime/{id}/slug, or legacy /{slug}-{id}
  extractId(url) {
    var base = this.source.baseUrl;
    if (url.startsWith(base)) {
      var path = url.slice(base.length).replace(/^\//, "");
      if (path.startsWith("anime/")) {
        return path.split("/")[1];
      }
      return path.split("-").pop();
    }
    return url;
  }

  // ── Listings ──────────────────────────────────────────────────────────────

  async getPopular(page) {
    var data = await this.apiGet("/home");
    var items = data.popular || [];
    return { list: this.parseAnimeList(items), hasNextPage: false };
  }

  async getLatestUpdates(page) {
    var data = await this.apiGet("/home");
    var items = data.latestEpisode || data.airing || [];
    return { list: this.parseAnimeList(items), hasNextPage: false };
  }

  async search(query, page, filters) {
    var items = [];
    var hasNextPage = false;
    try {
      var data = await this.apiGet("/search?keyword=" + encodeURIComponent(query) + "&page=" + page);
      items = data.results || data.anime || [];
      hasNextPage = !!(data.pageInfo && data.pageInfo.hasNextPage);
    } catch (e) {}
    // Fall back to the suggest endpoint when main search returns nothing.
    if (items.length === 0) {
      try {
        var sugg = await this.apiGet("/search/suggest?keyword=" + encodeURIComponent(query));
        var suggItems = sugg.results || sugg.data || sugg.anime || [];
        if (suggItems.length > 0) {
          items = suggItems;
          hasNextPage = false;
        }
      } catch (e) {}
    }
    return { list: this.parseAnimeList(items), hasNextPage: hasNextPage };
  }

  // ── Detail ────────────────────────────────────────────────────────────────

  async getDetail(url) {
    var id = this.extractId(url);

    var infoData = await this.apiGet("/anime/" + id);
    var anime = infoData.data || {};

    var title = this.animeTitle(anime) || id;
    var imageUrl = (anime.coverImage && anime.coverImage.extraLarge) || anime.cover || "";
    var description = this.stripHtml(anime.description || "");
    var genres = anime.genres || [];
    var total = anime.episodes || 0;

    var chapters = [];
    for (var i = 1; i <= total; i++) {
      chapters.push({ name: "Episode " + i, url: id + "||" + i });
    }

    return {
      name: title,
      imageUrl: imageUrl,
      description: description,
      genre: genres,
      status: this.statusCode(anime.status || ""),
      link: this.source.baseUrl + "/anime/" + id + "/" + this.titleToSlug(title),
      chapters: chapters.reverse(),
    };
  }

  // ── Video sources ─────────────────────────────────────────────────────────

  async getVideoList(url) {
    // url format: "{animeId}||{epNum}"
    var parts = url.split("||");
    var animeId = parts[0];
    var epNum = parts[1];

    var subVideos = [];
    var dubVideos = [];
    var ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

    try {
      var data = await this.apiGet("/watch/" + animeId + "/episode/" + epNum + "/animepahe");

      // API returns {"error":"..."} with HTTP 200 for bad episodes
      if (data.error || (!data.sub && !data.dub)) {
        throw new Error(data.error || "No sources");
      }

      var types = ["sub", "dub"];
      for (var ti = 0; ti < types.length; ti++) {
        var type = types[ti];
        var typeData = data[type];
        if (!typeData || !typeData.sources) continue;
        var sources = typeData.sources;
        for (var si = 0; si < sources.length; si++) {
          var s = sources[si];
          var streamUrl = s.url || s.file;
          if (!streamUrl) continue;
          var entry = {
            url: streamUrl,
            originalUrl: streamUrl,
            quality: type.toUpperCase() + " [" + (s.quality || "auto") + "p]",
            headers: { "Referer": "https://kwik.cx/", "User-Agent": ua },
            subtitles: [],
          };
          if (type === "dub") {
            dubVideos.push(entry);
          } else {
            subVideos.push(entry);
          }
        }
      }
    } catch (e) {}

    // Sort each group highest quality first (1080p before 720p before 360p)
    function sortByQuality(arr) {
      return arr.sort(function(a, b) {
        var qa = parseInt((a.quality.match(/\[(\d+)p\]/) || [0, 0])[1], 10) || 0;
        var qb = parseInt((b.quality.match(/\[(\d+)p\]/) || [0, 0])[1], 10) || 0;
        return qb - qa;
      });
    }
    subVideos = sortByQuality(subVideos);
    dubVideos = sortByQuality(dubVideos);

    var pref = "sub";
    try { pref = new SharedPreferences().get("justanime_pref_audio") || "sub"; } catch (e) {}
    if (pref === "dub") {
      return dubVideos.concat(subVideos);
    }
    return subVideos.concat(dubVideos);
  }

  // ── Preferences ───────────────────────────────────────────────────────────

  getFilterList() {
    return [];
  }

  getSourcePreferences() {
    return [
      {
        key: "justanime_pref_audio",
        listPreference: {
          title: "Preferred language",
          summary: "Primary language to use. If unavailable, the other will be used as fallback.",
          valueIndex: 0,
          entries: ["Sub first, Dub fallback", "Dub first, Sub fallback"],
          entryValues: ["sub", "dub"],
        },
      },
    ];
  }
}
