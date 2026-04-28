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
    "version": "0.0.3",
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

  titleToSlug(title) {
    return (title || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .trim()
      .replace(/\s+/g, "-");
  }

  animeTitle(item) {
    return (item.title && (item.title.english || item.title.romaji)) || "";
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

  // Accepts: bare AniList ID, /anime/{id}/{slug}, or legacy /{slug}-{id}
  extractId(url) {
    var base = this.source.baseUrl;
    if (url.startsWith(base)) {
      var path = url.slice(base.length).replace(/^\//, "");
      // /anime/{id}/... format
      if (path.startsWith("anime/")) {
        return path.split("/")[1];
      }
      // legacy /{slug}-{id} — take the last dash-segment
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
    var items = data.airing || data.latestEpisode || [];
    return { list: this.parseAnimeList(items), hasNextPage: false };
  }

  async search(query, page, filters) {
    var data = await this.apiGet("/search/suggestions?query=" + encodeURIComponent(query));
    var items = data.data || [];
    return { list: this.parseAnimeList(items), hasNextPage: false };
  }

  // ── Detail ────────────────────────────────────────────────────────────────

  async getDetail(url) {
    var id = this.extractId(url);

    var infoData = await this.apiGet("/anime/" + id);
    var anime = infoData.data || {};

    var title = this.animeTitle(anime) || id;
    var imageUrl = (anime.coverImage && anime.coverImage.extraLarge) || "";
    var description = this.stripHtml(anime.description || "");
    var genres = anime.genres || [];

    var epData = await this.apiGet("/anime/" + id + "/episodes");
    var totalEpisodes = epData.totalEpisodes || anime.episodes || 0;

    var chapters = [];
    for (var i = 1; i <= totalEpisodes; i++) {
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

    var videos = [];

    try {
      var data = await this.apiGet(
        "/watch/" + animeId + "/episode/" + epNum + "/animepahe"
      );
      if (data && !data.error) {
        var types = ["sub", "dub"];
        for (var ti = 0; ti < types.length; ti++) {
          var type = types[ti];
          var typeData = data[type];
          if (!typeData || !typeData.sources) continue;
          var sources = typeData.sources;
          for (var si = 0; si < sources.length; si++) {
            var s = sources[si];
            var streamUrl = s && (s.url || s.file);
            if (!streamUrl) continue;
            videos.push({
              url: streamUrl,
              originalUrl: streamUrl,
              quality: "animepahe " + type + " [" + (s.quality || "auto") + "p]",
              headers: {
                "Referer": "https://kwik.cx/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
              },
              subtitles: [],
            });
          }
        }
      }
    } catch (e) {}

    return videos;
  }

  // ── Preferences ───────────────────────────────────────────────────────────

  getFilterList() {
    return [];
  }

  getSourcePreferences() {
    return [];
  }
}
