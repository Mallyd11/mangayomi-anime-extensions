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
    "version": "0.2.8",
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

  // Returns false if the playlist body contains ByteDance/ibyteimg ad segments.
  async isPlaylistClean(url, headers) {
    try {
      var res = await new Client().get(url, headers);
      var body = res.body || "";
      return body.indexOf("ibyteimg") < 0 && body.indexOf("p16-ad-") < 0;
    } catch (e) {
      return false;
    }
  }

  // anineko uses a two-step API:
  //   Step 1: /watch/{id}/episode/{ep}/anineko → {langs: {sub:[{server,name}...], dub:[...]}}
  //   Step 2: /watch/{id}/episode/{ep}/anineko/{lang}/{server} → {sources, subtitles, headers}
  // HLS streams are checked for ad-poisoning before being included.
  async getAninekoStreams(animeId, epNum, ua, autoSubs) {
    var subVideos = [];
    var dubVideos = [];
    try {
      var avail = await this.apiGet("/watch/" + animeId + "/episode/" + epNum + "/anineko");
      var langs = avail.langs || {};
      var langKeys = ["sub", "dub"];
      for (var li = 0; li < langKeys.length; li++) {
        var lang = langKeys[li];
        var servers = langs[lang] || [];
        for (var si = 0; si < servers.length; si++) {
          var serverName = servers[si].server;
          var serverLabel = servers[si].name || serverName;
          try {
            var data = await this.apiGet(
              "/watch/" + animeId + "/episode/" + epNum + "/anineko/" + lang + "/" + serverName
            );
            if (!data || data.error || !Array.isArray(data.sources) || !data.sources.length) continue;

            var apiHeaders = data.headers || {};
            var streamHeaders = {
              "User-Agent": ua,
              "Referer": apiHeaders["Referer"] || "https://justanime.to/",
              "Origin": apiHeaders["Origin"] || "https://justanime.to",
            };

            // anineko returns subtitles[].url + .lang (not .file + .label)
            var rawSubs = data.subtitles || [];
            var subtitles = [];
            for (var ti = 0; ti < rawSubs.length; ti++) {
              var t = rawSubs[ti];
              var fileUrl = t.file || t.url;
              if (!fileUrl) continue;
              subtitles.push({ file: fileUrl, label: t.label || t.lang || "Unknown" });
            }
            if (autoSubs && subtitles.length > 0) subtitles[0].default = true;

            for (var i = 0; i < data.sources.length; i++) {
              var s = data.sources[i];
              var streamUrl = s.url || s.file;
              if (!streamUrl) continue;

              var isHls = s.isM3U8 || streamUrl.indexOf(".m3u8") >= 0;
              if (isHls) {
                var variants = await this.resolveMasterPlaylist(streamUrl, streamHeaders);
                if (variants.length > 0) {
                  var clean = await this.isPlaylistClean(variants[0].url, streamHeaders);
                  if (!clean) continue;
                  for (var vi = 0; vi < variants.length; vi++) {
                    var entry = {
                      url: variants[vi].url,
                      originalUrl: streamUrl,
                      quality: "anineko " + serverLabel + " " + lang.toUpperCase() + " [" + variants[vi].quality + "]",
                      headers: streamHeaders,
                      subtitles: subtitles,
                    };
                    if (lang === "dub") dubVideos.push(entry); else subVideos.push(entry);
                  }
                } else {
                  // Flat playlist
                  var clean = await this.isPlaylistClean(streamUrl, streamHeaders);
                  if (!clean) continue;
                  var qual = s.quality || "auto";
                  if (qual !== "auto" && !/p$/i.test(qual)) qual += "p";
                  var entry = {
                    url: streamUrl,
                    originalUrl: streamUrl,
                    quality: "anineko " + serverLabel + " " + lang.toUpperCase() + " [" + qual + "]",
                    headers: streamHeaders,
                    subtitles: subtitles,
                  };
                  if (lang === "dub") dubVideos.push(entry); else subVideos.push(entry);
                }
              } else {
                var qual = s.quality || "auto";
                if (qual !== "auto" && !/p$/i.test(qual)) qual += "p";
                var entry = {
                  url: streamUrl,
                  originalUrl: streamUrl,
                  quality: "anineko " + serverLabel + " " + lang.toUpperCase() + " [" + qual + "]",
                  headers: streamHeaders,
                  subtitles: subtitles,
                };
                if (lang === "dub") dubVideos.push(entry); else subVideos.push(entry);
              }
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
    return { subVideos: subVideos, dubVideos: dubVideos };
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

    var autoSubs = false;
    try { autoSubs = new SharedPreferences().get("justanime_pref_auto_subs") === "true"; } catch (e) {}

    var serverPref = "megaplay";
    try { serverPref = new SharedPreferences().get("justanime_pref_server") || "megaplay"; } catch (e) {}

    // Resolve which simple providers (megaplay/animegg) to query
    var providers = [];
    if (serverPref === "megaplay" || serverPref === "all") providers.push("megaplay");
    if (serverPref === "animegg"  || serverPref === "all") providers.push("animegg");

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

          // MegaPlay CDN requires hardcoded headers; other providers use what the API returns
          var apiHeaders = typeData.headers || {};
          var streamHeaders = provider === "megaplay"
            ? { "User-Agent": ua, "Referer": "https://megaplay.buzz/", "Origin": "https://megaplay.buzz" }
            : { "User-Agent": ua, "Referer": apiHeaders["Referer"] || "https://justanime.to/" };

          // Collect subtitles — sort so Crunchyroll > English 2 > other English > rest.
          // Drop bare "English" when a Crunchyroll track exists (they share the same content).
          var rawTracks = typeData.subtitles || typeData.tracks || [];
          var hasCR = false;
          for (var sti = 0; sti < rawTracks.length; sti++) {
            if ((rawTracks[sti].label || "").toLowerCase().indexOf("crunchyroll") >= 0) { hasCR = true; break; }
          }
          var subtitles = [];
          var trackOrder = ["crunchyroll", "english 2", "english", ""];
          for (var oi = 0; oi < trackOrder.length; oi++) {
            for (var sti = 0; sti < rawTracks.length; sti++) {
              var track = rawTracks[sti];
              if (!track.file) continue;
              if (track.kind && track.kind !== "captions" && track.kind !== "subtitles") continue;
              var lbl = (track.label || "").toLowerCase();
              var tier = oi === 0 ? lbl.indexOf("crunchyroll") >= 0
                       : oi === 1 ? lbl === "english 2"
                       : oi === 2 ? lbl === "english"
                       : lbl.indexOf("crunchyroll") < 0 && lbl !== "english 2" && lbl !== "english";
              if (!tier) continue;
              // skip bare "English" when Crunchyroll is present — same content, avoid duplicate
              if (oi === 2 && hasCR) continue;
              subtitles.push({ file: track.file, label: track.label || "Unknown" });
            }
          }
          if (autoSubs && subtitles.length > 0) subtitles[0].default = true;

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

    // anineko: two-step API with ad-poisoning filter — adds clean HLS streams
    if (serverPref === "anineko" || serverPref === "all") {
      var nekoResult = await this.getAninekoStreams(animeId, epNum, ua, autoSubs);
      subVideos = subVideos.concat(nekoResult.subVideos);
      dubVideos = dubVideos.concat(nekoResult.dubVideos);
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
        key: "justanime_pref_server",
        listPreference: {
          title: "Preferred server",
          summary: "Which streaming server to use. MegaPlay is default; AnimeGG is a clean 360p fallback; AniNeko filters out ad-poisoned streams automatically.",
          valueIndex: 0,
          entries: ["MegaPlay (default)", "AnimeGG (clean MP4, 360p)", "AniNeko (clean HLS, ad-filtered)", "All servers"],
          entryValues: ["megaplay", "animegg", "anineko", "all"],
        },
      },
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
      {
        key: "justanime_pref_auto_subs",
        checkBoxPreference: {
          title: "Auto-enable subtitles",
          summary: "Automatically activate English subtitles when playing an episode.",
          value: false,
        },
      },
    ];
  }
}
