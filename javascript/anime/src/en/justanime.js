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
    "version": "0.2.2",
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

  get supportsLatest() { return true; }

  // /search with no keyword returns ~5000 anime paginated by popularity (24/page)
  async getPopular(page) {
    try {
      var data = await this.apiGet("/search?page=" + page);
      var items = data.results || [];
      var hasNextPage = !!(data.pageInfo && data.pageInfo.hasNextPage);
      return { list: this.parseAnimeList(items), hasNextPage: hasNextPage };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  // /home latestEpisode is the only source for recently-updated anime; no paginated endpoint exists
  async getLatestUpdates(page) {
    if (page > 1) return { list: [], hasNextPage: false };
    try {
      var data = await this.apiGet("/home");
      var items = data.latestEpisode || data.airing || [];
      return { list: this.parseAnimeList(items), hasNextPage: false };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    var encoded = encodeURIComponent(query.replace(/[?!]/g, "").trim());
    var items = [];
    var hasNextPage = false;
    try {
      var data = await this.apiGet("/search?query=" + encoded + "&page=" + page);
      items = data.results || [];
      hasNextPage = !!(data.pageInfo && data.pageInfo.hasNextPage);
    } catch (e) {}
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

  // ── HLS helpers ───────────────────────────────────────────────────────────

  // Fetch a master HLS playlist and return absolute variant URLs with quality.
  // Returns [] if the URL is already a flat playlist (no #EXT-X-STREAM-INF).
  async resolveMasterPlaylist(masterUrl, headers) {
    try {
      var res = await new Client().get(masterUrl, headers);
      var body = res.body || "";
      if (body.indexOf("#EXT-X-STREAM-INF") < 0) return [];

      var base = masterUrl.substring(0, masterUrl.lastIndexOf("/") + 1);
      var variants = [];
      var lines = body.split("\n");
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.indexOf("#EXT-X-STREAM-INF") !== 0) continue;
        var resMatch = line.match(/RESOLUTION=\d+x(\d+)/);
        var quality = resMatch ? resMatch[1] + "p" : "auto";
        for (var j = i + 1; j < lines.length; j++) {
          var u = lines[j].trim();
          if (!u || u.charAt(0) === "#") continue;
          variants.push({ url: u.indexOf("http") === 0 ? u : base + u, quality: quality });
          break;
        }
      }
      // Sort highest resolution first
      variants.sort(function(a, b) {
        return (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0);
      });
      return variants;
    } catch (e) {
      return [];
    }
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

    // miruro streams are Cloudflare-blocked and its API call hangs on slow networks
    var providers = ["megaplay"];

    for (var pi = 0; pi < providers.length; pi++) {
      var provider = providers[pi];
      try {
        var data = await this.apiGet("/watch/" + animeId + "/episode/" + epNum + "/" + provider);
        if (data.error || (!data.sub && !data.dub)) continue;

        var types = ["sub", "dub"];
        for (var ti = 0; ti < types.length; ti++) {
          var type = types[ti];
          var typeData = data[type];
          if (!typeData || !typeData.sources) continue;

          // MegaPlay CDN (mewstream.buzz / ovexa.buzz) requires these exact headers
          // for both streaming and segment downloads; reading from API returns wrong Referer
          var streamHeaders = {
            "User-Agent": ua,
            "Referer": "https://megaplay.buzz/",
            "Origin": "https://megaplay.buzz",
          };

          // Collect subtitles
          var subtitles = [];
          var tracks = typeData.subtitles || typeData.tracks || [];
          for (var sti = 0; sti < tracks.length; sti++) {
            var track = tracks[sti];
            if (track.file && (track.kind === "captions" || track.kind === "subtitles" || !track.kind)) {
              subtitles.push({ url: track.file, label: track.label || "Unknown" });
            }
          }

          var sources = typeData.sources;
          for (var si = 0; si < sources.length; si++) {
            var s = sources[si];
            var streamUrl = s.url || s.file;
            if (!streamUrl) continue;

            // For master HLS playlists resolve to absolute variant URLs so
            // Mangayomi's player gets direct variant URLs. This avoids the
            // cross-domain Referer propagation issue (mewstream → ovexa).
            if (s.isM3U8 || streamUrl.indexOf(".m3u8") >= 0) {
              var variants = await this.resolveMasterPlaylist(streamUrl, streamHeaders);
              if (variants.length > 0) {
                for (var vi = 0; vi < variants.length; vi++) {
                  var v = variants[vi];
                  var entry = {
                    url: v.url,
                    originalUrl: streamUrl,
                    quality: provider + " " + type.toUpperCase() + " [" + v.quality + "]",
                    headers: streamHeaders,
                    subtitles: subtitles,
                  };
                  if (type === "dub") dubVideos.push(entry);
                  else subVideos.push(entry);
                }
                continue;
              }
              // Already a flat playlist — fall through and use as-is
            }

            // Non-HLS or flat playlist
            var qual = (s.quality || "auto");
            if (qual !== "auto" && !/p$/i.test(qual)) qual += "p";
            var entry = {
              url: streamUrl,
              originalUrl: streamUrl,
              quality: provider + " " + type.toUpperCase() + " [" + qual + "]",
              headers: streamHeaders,
              subtitles: subtitles,
            };
            if (type === "dub") dubVideos.push(entry);
            else subVideos.push(entry);
          }
        }
      } catch (e) {}
    }

    // Sort highest quality first (1080p → 720p → 360p → auto)
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
