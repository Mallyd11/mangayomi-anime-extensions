const mangayomiSources = [
  {
    "name": "AniCove",
    "id": 1839274651,
    "lang": "en",
    "baseUrl": "https://mwask-anicove.hf.space",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://mwask-anicove.hf.space",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.1.5",
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

  // Parse anime cards from any page that uses the site's standard grid layout.
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
    var res = await this.client.get(
      this.source.baseUrl + "/search?q=" + encodeURIComponent(query),
      this.headers
    );
    var doc = new Document(res.body || "");
    return { list: this.parseCards(doc), hasNextPage: false };
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

    var alHeaders = {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "User-Agent": this.ua,
      "Origin": "https://anilist.co",
      "Referer": "https://anilist.co/",
    };

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
        alHeaders,
        JSON.stringify({ query: alQuery, variables: { id: parseInt(animeId) } })
      );
      var alJson = JSON.parse(alRes.body);
      if (alJson && alJson.data && alJson.data.Media) {
        media = alJson.data.Media;
      }
    } catch (e) {}

    var watchRes = await this.client.get(
      this.source.baseUrl + "/watch/" + animeId + "/ep-1",
      this.headers
    );
    var html = (watchRes && watchRes.body) || "";
    var doc = new Document(html);

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
        imageUrl: "",
        scanlator: (ep.attr("class") || "").indexOf("is-filler") >= 0 ? "Filler" : "",
      });
    }

    if (chapters.length === 0 && media) {
      var total = media.episodes || 0;
      if (media.nextAiringEpisode && media.nextAiringEpisode.episode) {
        total = media.nextAiringEpisode.episode - 1;
      }
      for (var j = 1; j <= total; j++) {
        chapters.push({ name: "Episode " + j, url: animeId + "||" + j, imageUrl: "", scanlator: "" });
      }
    }

    chapters.reverse();

    var name = media ? (media.title.english || media.title.romaji || "") : "";
    var imageUrl = media ? ((media.coverImage && (media.coverImage.extraLarge || media.coverImage.large)) || "") : "";
    var description = media ? (media.description || "") : "";
    var genre = media ? (media.genres || []) : [];
    var status = media ? this.statusCode(media.status) : 5;

    if (!name) {
      var og = doc.selectFirst("meta[property='og:title']");
      if (og) name = (og.attr("content") || "").trim();
    }
    if (!imageUrl) {
      var ogImg = doc.selectFirst("meta[property='og:image']");
      if (ogImg) imageUrl = ogImg.attr("content") || "";
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

    var streamHeaders = { "User-Agent": this.ua, "Referer": this.source.baseUrl + "/" };
    var streams = [];

    // Fetch streams for each selected language sequentially.
    for (var li = 0; li < langs.length; li++) {
      var lang = langs[li];

      var watchHeaders = {
        "User-Agent": this.ua,
        "Referer": this.source.baseUrl + "/",
        "Cookie": "preferred_language=" + lang,
      };
      var res = await this.client.get(
        this.source.baseUrl + "/watch/" + animeId + "/ep-" + epNum,
        watchHeaders
      );
      var html = (res && res.body) || "";

      var videoLinkM = html.match(/videoLink:\s*'([^']*)'/);
      var sourceTypeM = html.match(/sourceType:\s*'([^']*)'/);
      var downloadUrlM = html.match(/downloadUrl:\s*"((?:[^"\\]|\\.)*)"/);

      var videoLink = videoLinkM ? videoLinkM[1] : "";
      var sourceType = sourceTypeM ? sourceTypeM[1] : "hls";
      var downloadUrl = downloadUrlM ? downloadUrlM[1].replace(/\\u0026/g, "&") : "";

      if (!videoLink) continue;

      if (sourceType === "hls") {
        streams.push({
          url: videoLink,
          originalUrl: videoLink,
          quality: "HLS [" + lang.toUpperCase() + "]",
          headers: streamHeaders,
          subtitles: [],
        });
      } else {
        streams.push({
          url: videoLink,
          originalUrl: videoLink,
          quality: "Embed [" + lang.toUpperCase() + "]",
          headers: { "User-Agent": this.ua },
          subtitles: [],
        });
      }

      if (downloadUrl && downloadUrl !== videoLink) {
        streams.push({
          url: downloadUrl,
          originalUrl: downloadUrl,
          quality: "Download [" + lang.toUpperCase() + "]",
          headers: streamHeaders,
          subtitles: [],
        });
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
    ];
  }
}
