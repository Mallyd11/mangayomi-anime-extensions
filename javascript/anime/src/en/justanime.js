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
    "version": "0.0.7",
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
        imageUrl: item.cover || item.poster || (item.coverImage && item.coverImage.extraLarge) || "",
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

  // Accepts: bare ID, /anime/{id}/{slug}, or legacy /{slug}-{id}
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
    var items = data.popular || data.most_popular || [];
    return { list: this.parseAnimeList(items), hasNextPage: false };
  }

  async getLatestUpdates(page) {
    var data = await this.apiGet("/home");
    var items = data.airing || data.latest_episode || data.latestEpisode || [];
    return { list: this.parseAnimeList(items), hasNextPage: false };
  }

  async search(query, page, filters) {
    var items = [];
    var hasNextPage = false;
    try {
      var data = await this.apiGet("/search?keyword=" + encodeURIComponent(query) + "&page=" + page);
      items = data.results || data.data || data.anime || [];
      hasNextPage = !!(data.hasNextPage || (data.pagination && data.pagination.hasNextPage));
    } catch (e) {}
    if (items.length === 0) {
      try {
        var sugg = await this.apiGet("/search/suggest?keyword=" + encodeURIComponent(query));
        items = sugg.results || sugg.data || [];
      } catch (e) {}
    }
    return { list: this.parseAnimeList(items), hasNextPage: hasNextPage };
  }

  // ── Detail ────────────────────────────────────────────────────────────────

  async getDetail(url) {
    var id = this.extractId(url);

    var infoData = await this.apiGet("/anime/" + id);
    var anime = infoData.data || infoData.results || {};

    var title = this.animeTitle(anime) || id;
    var imageUrl = (anime.coverImage && anime.coverImage.extraLarge) || anime.poster || "";
    var description = this.stripHtml(anime.description || "");
    var genres = anime.genres || [];

    var chapters = [];

    // Try to get real episode data_ids needed for streaming
    try {
      var epList = await this.apiGet("/episodes/" + id);
      var episodes = epList.results || epList.data || [];
      for (var ei = 0; ei < episodes.length; ei++) {
        var ep = episodes[ei];
        var dataId = ep.data_id || ep.id || ep.episode_id || String(ep.episode_no || (ei + 1));
        var epNum = ep.episode_no || ep.number || (ei + 1);
        chapters.push({ name: "Episode " + epNum, url: id + "||" + dataId });
      }
    } catch (e) {}

    // Fall back to count-based if episodes API failed or returned nothing
    if (chapters.length === 0) {
      try {
        var epData = await this.apiGet("/anime/" + id + "/episodes");
        var total = epData.totalEpisodes || anime.episodes || 0;
        for (var fi = 1; fi <= total; fi++) {
          chapters.push({ name: "Episode " + fi, url: id + "||" + fi });
        }
      } catch (e) {}
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
    // url format: "{animeId}||{episodeDataId}"
    var parts = url.split("||");
    var animeId = parts[0];
    var episodeDataId = parts[1];

    var subVideos = [];
    var dubVideos = [];
    var ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
    var siteReferer = "https://justanime.to/";

    try {
      var serversData = await this.apiGet("/servers/" + animeId + "?ep=" + episodeDataId);
      var servers = serversData.results || serversData.data || [];

      for (var si = 0; si < servers.length; si++) {
        var server = servers[si];
        var serverName = server.serverName || server.server_name || server.name;
        var type = (server.type || "sub").toLowerCase();
        if (!serverName || (type !== "sub" && type !== "dub")) continue;

        try {
          // The API embeds the episode id with ?ep= inside the id param value (matches site behavior)
          var streamData = await this.apiGet(
            "/stream?id=" + animeId + "?ep=" + episodeDataId +
            "&server=" + encodeURIComponent(serverName) + "&type=" + type
          );
          var results = streamData.results || streamData.data || {};
          var links = results.streamingLink || results.sources || results.links || [];
          var tracks = results.tracks || results.subtitles || [];

          for (var li = 0; li < links.length; li++) {
            var link = links[li];
            var streamUrl = link.url || link.file || link.link;
            if (!streamUrl) continue;

            var subtitles = [];
            for (var ti = 0; ti < tracks.length; ti++) {
              var track = tracks[ti];
              if (track.file && (track.kind === "captions" || track.kind === "subtitles" || !track.kind)) {
                subtitles.push({ url: track.file, label: track.label || "Unknown" });
              }
            }

            var entry = {
              url: streamUrl,
              originalUrl: streamUrl,
              quality: serverName + " " + type + " [" + (link.quality || link.resolution || "auto") + "]",
              headers: { "Referer": siteReferer, "User-Agent": ua },
              subtitles: subtitles,
            };
            if (type === "dub") {
              dubVideos.push(entry);
            } else {
              subVideos.push(entry);
            }
          }
        } catch (e) {}
      }
    } catch (e) {}

    var pref = new SharedPreferences().get("justanime_pref_audio");
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
          title: "Preferred audio",
          summary: "Which audio track appears first for streaming and downloads",
          valueIndex: 0,
          entries: ["Sub", "Dub"],
          entryValues: ["sub", "dub"],
        },
      },
    ];
  }
}
