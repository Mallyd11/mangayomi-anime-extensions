const mangayomiSources = [
  {
    "name": "AniCove",
    "id": 1839274651,
    "lang": "en",
    "baseUrl": "https://mwask-anicove.hf.space",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://mwask-anicove.hf.space",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.2.5",
    "pkgPath": "anime/src/en/anicove.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": false,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/anicove.js",
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

  get ua() {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
  }

  get headers() {
    return {
      "User-Agent": this.ua,
      "Referer": this.source.baseUrl + "/",
    };
  }

  getPreference(key) {
    return new SharedPreferences().get(key);
  }

  get supportsLatest() {
    return true;
  }

  // Shared AniList headers — a browser User-Agent is required; AniList
  // returns 403 for bare library requests without one.
  get alHeaders() {
    return {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "User-Agent": this.ua,
    };
  }

  // Parse anime cards from a server-rendered AniCove page.
  // Uses .anime-card (class only) — Mangayomi's DOM API does not support
  // compound element+class selectors like a.anime-card.
  parseCards(doc) {
    var cards = doc.select(".anime-card");
    var list = [];
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var href = card.attr("href") || "";
      if (!href) continue;
      var link = href.indexOf("http") === 0 ? href : this.source.baseUrl + href;
      if (link.indexOf("/anime/") < 0) continue;
      var titleEl = card.selectFirst(".anime-card-title");
      var name = titleEl ? (titleEl.text || "").trim() : "";
      if (!name) continue;
      var img = card.selectFirst("img");
      var imageUrl = img ? (img.attr("src") || img.attr("data-src") || "") : "";
      list.push({ name: name, imageUrl: imageUrl, link: link });
    }
    return list;
  }

  async getPopular(page) {
    var res = await this.client.get(
      this.source.baseUrl + "/category/trending",
      this.headers
    );
    var doc = new Document(res.body || "");
    return { list: this.parseCards(doc), hasNextPage: false };
  }

  async getLatestUpdates(page) {
    var res = await this.client.get(
      this.source.baseUrl + "/category/recently-updated",
      this.headers
    );
    var doc = new Document(res.body || "");
    return { list: this.parseCards(doc), hasNextPage: false };
  }

  async search(query, page, filters) {
    try {
      var res = await this.client.get(
        this.source.baseUrl + "/search?q=" + encodeURIComponent(query),
        this.headers
      );
      var doc = new Document(res.body || "");
      return { list: this.parseCards(doc), hasNextPage: false };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  statusCode(s) {
    if (!s) return 5;
    switch (s.toUpperCase()) {
      case "FINISHED": return 1;
      case "RELEASING": return 0;
      case "NOT_YET_RELEASED": return 4;
      default: return 5;
    }
  }

  extractAnimeId(url) {
    var m = url.match(/\/(?:anime|watch)\/(\d+)/);
    return m ? m[1] : "";
  }

  async getDetail(url) {
    var animeId = this.extractAnimeId(url);
    if (!animeId) throw new Error("Cannot parse anime ID from: " + url);

    var alQuery = "query ($id: Int) { Media(id: $id, type: ANIME) {"
      + " id title { romaji english native }"
      + " coverImage { extraLarge large }"
      + " description(asHtml: false)"
      + " genres status episodes"
      + " nextAiringEpisode { episode }"
      + " } }";

    var media = null;
    try {
      var alRes = await this.client.post(
        "https://graphql.anilist.co",
        this.alHeaders,
        JSON.stringify({ query: alQuery, variables: { id: parseInt(animeId) } })
      );
      var alJson = JSON.parse(alRes.body);
      if (alJson && alJson.data && alJson.data.Media) {
        media = alJson.data.Media;
      }
    } catch (e) {}

    // Fetch episode thumbnails from ani.zip only if the user has enabled them.
    var thumbMap = {};
    var thumbsEnabled = false;
    try { thumbsEnabled = this.getPreference("anicove_episode_thumbnails"); } catch (e) {}
    if (thumbsEnabled) {
      try {
        var zipRes = await this.client.get(
          "https://api.ani.zip/mappings?anilist_id=" + animeId,
          { "User-Agent": this.ua }
        );
        var zipJson = JSON.parse(zipRes.body);
        if (zipJson && zipJson.episodes) {
          var zipKeys = Object.keys(zipJson.episodes);
          for (var ki = 0; ki < zipKeys.length; ki++) {
            var zk = zipKeys[ki];
            var ze = zipJson.episodes[zk];
            if (ze && ze.image) thumbMap[zk] = ze.image;
          }
        }
      } catch (e) {}
    }

    var watchRes = await this.client.get(
      this.source.baseUrl + "/watch/" + animeId + "/ep-1",
      this.headers
    );
    var html = (watchRes && watchRes.body) || "";
    var doc = new Document(html);

    // Extract the poster URL from WATCH_CONFIG — used as fallback for the
    // anime cover image if AniList didn't respond. Do NOT use og:image from
    // the watch page because it points to the episode screenshot, not the poster.
    var posterM = html.match(/poster:\s*"([^"]+)"/);
    var watchPoster = posterM ? posterM[1] : "";

    var epEls = doc.select("a.episode-sidebar-item");
    var chapters = [];

    for (var i = 0; i < epEls.length; i++) {
      var ep = epEls[i];
      var epNum = ep.attr("data-number") || String(i + 1);

      var titleEl = ep.selectFirst(".episode-title");
      var rawTitle = titleEl ? (titleEl.text || "").trim() : "";
      var epTitle = rawTitle.replace(/\s*Filler\s*$/i, "").trim();

      var label = "Episode " + epNum;
      if (epTitle && epTitle !== epNum) label += ": " + epTitle;

      chapters.push({
        name: label,
        url: animeId + "||" + epNum,
        thumbnailUrl: thumbMap[epNum] || "",
        scanlator: (ep.attr("class") || "").indexOf("is-filler") >= 0 ? "Filler" : "",
      });
    }

    if (chapters.length === 0 && media) {
      var total = media.episodes || 0;
      if (media.nextAiringEpisode && media.nextAiringEpisode.episode) {
        total = media.nextAiringEpisode.episode - 1;
      }
      for (var j = 1; j <= total; j++) {
        chapters.push({
          name: "Episode " + j,
          url: animeId + "||" + j,
          thumbnailUrl: thumbMap[String(j)] || "",
          scanlator: "",
        });
      }
    }

    chapters.reverse();

    var name = media ? (media.title.english || media.title.romaji || "") : "";
    var imageUrl = media ? ((media.coverImage && (media.coverImage.extraLarge || media.coverImage.large)) || "") : "";
    var description = media ? (media.description || "") : "";
    var genre = media ? (media.genres || []) : [];
    var status = media ? this.statusCode(media.status) : 5;

    // If AniList failed, fall back to data extracted from the watch page.
    // Use WATCH_CONFIG animeName/poster — NOT og:image, which on the watch page
    // is the episode screenshot rather than the anime poster.
    if (!name) {
      var animeNameM = html.match(/animeName:\s*"([^"]+)"/);
      if (animeNameM) name = animeNameM[1];
    }
    if (!imageUrl) {
      imageUrl = watchPoster;
    }

    return {
      name: name,
      imageUrl: imageUrl,
      description: description,
      genre: genre,
      status: status,
      link: this.source.baseUrl + "/anime/" + animeId,
      chapters: chapters,
    };
  }

  async getVideoList(url) {
    var parts = url.split("||");
    var animeId = parts[0];
    var epNum = parts[1] || "1";

    // Read multi-select language preference — defaults to both sub and dub.
    var langs = ["sub", "dub"];
    try {
      var pref = this.getPreference("anicove_lang");
      if (pref && pref.length > 0) langs = pref;
    } catch (e) {}

    // The site now delivers streams via /api/watch/sources (POST) rather than
    // embedding videoLink in the page HTML. Try all three providers for each
    // selected language and collect every available stream.
    var providers = ["zenith", "zoro", "anixtv"];

    var apiHeaders = {
      "Content-Type": "application/json",
      "User-Agent": this.ua,
      "Referer": this.source.baseUrl + "/watch/" + animeId + "/ep-" + epNum,
      "Origin": this.source.baseUrl,
    };
    var streamHeaders = { "User-Agent": this.ua, "Referer": this.source.baseUrl + "/" };
    var streams = [];

    for (var li = 0; li < langs.length; li++) {
      var lang = langs[li];

      for (var pi = 0; pi < providers.length; pi++) {
        var provider = providers[pi];
        try {
          var res = await this.client.post(
            this.source.baseUrl + "/api/watch/sources",
            apiHeaders,
            JSON.stringify({
              anime_id: animeId,
              episode_number: parseInt(epNum),
              language: lang,
              provider: provider,
            })
          );

          var data = JSON.parse(res.body || "{}");
          if (!data.available) continue;

          // hls_sources — each entry is a string URL or {file, url, quality}
          var hlsSources = data.hls_sources || [];
          for (var hi = 0; hi < hlsSources.length; hi++) {
            var hs = hlsSources[hi];
            var hsUrl = (typeof hs === "string") ? hs : (hs.file || hs.url || "");
            if (!hsUrl) continue;
            var hsQ = (hs.quality || provider) + " [" + lang.toUpperCase() + "]";
            streams.push({ url: hsUrl, originalUrl: hsUrl, quality: hsQ, headers: streamHeaders, subtitles: [] });
          }

          // video_sources — MP4
          var mp4Sources = data.video_sources || [];
          for (var mi = 0; mi < mp4Sources.length; mi++) {
            var ms = mp4Sources[mi];
            var msUrl = (typeof ms === "string") ? ms : (ms.file || ms.url || "");
            if (!msUrl) continue;
            var msQ = (ms.quality || provider) + " MP4 [" + lang.toUpperCase() + "]";
            streams.push({ url: msUrl, originalUrl: msUrl, quality: msQ, headers: streamHeaders, subtitles: [] });
          }

          // embed_sources — iframe/player URLs
          var embedSources = data.embed_sources || [];
          for (var ei = 0; ei < embedSources.length; ei++) {
            var es = embedSources[ei];
            var esUrl = es.url || "";
            if (!esUrl) continue;
            var esQ = (es.name || provider) + " [" + lang.toUpperCase() + "]";
            streams.push({ url: esUrl, originalUrl: esUrl, quality: esQ, headers: { "User-Agent": this.ua }, subtitles: [] });
          }
        } catch (ex) {}
      }
    }

    return streams;
  }

  getFilterList() {
    return [];
  }

  getSourcePreferences() {
    return [
      {
        key: "anicove_lang",
        multiSelectListPreference: {
          title: "Preferred language",
          summary: "Select sub, dub, or both. All checked types will appear as separate stream options.",
          values: ["sub", "dub"],
          entries: ["Sub (subtitled)", "Dub (dubbed)"],
          entryValues: ["sub", "dub"],
        },
      },
      {
        key: "anicove_episode_thumbnails",
        switchPreferenceCompat: {
          title: "Episode thumbnails",
          summary: "Show episode screenshots in the episode list. Adds an extra request per anime page load.",
          value: false,
        },
      },
    ];
  }
}
