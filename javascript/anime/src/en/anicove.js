const mangayomiSources = [
  {
    "name": "AniCove",
    "id": 1839274651,
    "lang": "en",
    "baseUrl": "https://mwask-anicove.hf.space",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://mwask-anicove.hf.space",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.1.0",
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

// AniCove is a Flask-based anime streaming frontend that uses AniList IDs as its
// primary anime identifiers. Listings and search are served directly from the AniList
// GraphQL API (the same backend the site uses). Episode lists are server-side rendered
// into the watch page sidebar. Video URLs come from the Miruro API (private) but are
// embedded in the page HTML inside window.WATCH_CONFIG after the server fetches them,
// so no private API key is needed by this extension.

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

  // Post a query to the AniList GraphQL endpoint.
  async anilistQuery(query, variables) {
    var res = await this.client.post(
      "https://graphql.anilist.co",
      {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": this.ua,
      },
      JSON.stringify({ query: query, variables: variables })
    );
    return JSON.parse(res.body);
  }

  // Convert an AniList Media object to the Mangayomi list-item shape.
  mapMedia(m) {
    var title = (m.title && (m.title.english || m.title.romaji)) || "";
    var image = (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large)) || "";
    return {
      name: title,
      imageUrl: image,
      link: this.source.baseUrl + "/anime/" + m.id,
    };
  }

  get supportsLatest() {
    return true;
  }

  async getPopular(page) {
    var data = await this.anilistQuery(
      `query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { hasNextPage }
          media(type: ANIME, sort: TRENDING_DESC, isAdult: false) {
            id
            title { romaji english }
            coverImage { extraLarge large }
          }
        }
      }`,
      { page: page, perPage: 24 }
    );
    var p = data.data.Page;
    return { list: p.media.map(m => this.mapMedia(m)), hasNextPage: p.pageInfo.hasNextPage };
  }

  async getLatestUpdates(page) {
    var data = await this.anilistQuery(
      `query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { hasNextPage }
          media(type: ANIME, sort: UPDATED_AT_DESC, status: RELEASING, isAdult: false) {
            id
            title { romaji english }
            coverImage { extraLarge large }
          }
        }
      }`,
      { page: page, perPage: 24 }
    );
    var p = data.data.Page;
    return { list: p.media.map(m => this.mapMedia(m)), hasNextPage: p.pageInfo.hasNextPage };
  }

  async search(query, page, filters) {
    var data = await this.anilistQuery(
      `query ($search: String, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { hasNextPage }
          media(type: ANIME, search: $search, sort: SEARCH_MATCH, isAdult: false) {
            id
            title { romaji english }
            coverImage { extraLarge large }
          }
        }
      }`,
      { search: query, page: page, perPage: 24 }
    );
    var p = data.data.Page;
    return { list: p.media.map(m => this.mapMedia(m)), hasNextPage: p.pageInfo.hasNextPage };
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

  // Pull the AniList numeric ID out of any AniCove URL.
  // Handles: /anime/{id}  and  /watch/{id}/ep-N
  extractAnimeId(url) {
    var m = url.match(/\/(?:anime|watch)\/(\d+)/);
    return m ? m[1] : "";
  }

  async getDetail(url) {
    var animeId = this.extractAnimeId(url);
    if (!animeId) throw new Error("Cannot parse anime ID from: " + url);

    // Fetch anime metadata from AniList GraphQL.
    var infoJson = await this.anilistQuery(
      `query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          title { romaji english native }
          coverImage { extraLarge large }
          description(asHtml: false)
          genres
          status
          episodes
          nextAiringEpisode { episode }
        }
      }`,
      { id: parseInt(animeId) }
    );

    // Fetch the watch page — the episode list is server-side rendered in the sidebar.
    var watchRes = await this.client.get(
      this.source.baseUrl + "/watch/" + animeId + "/ep-1",
      this.headers
    );

    var media = infoJson.data && infoJson.data.Media;
    var html = (watchRes && watchRes.body) || "";
    var doc = new Document(html);

    // Parse the episode sidebar: <a class="episode-sidebar-item" data-number="N">
    var epEls = doc.select("a.episode-sidebar-item");
    var chapters = [];

    for (var i = 0; i < epEls.length; i++) {
      var ep = epEls[i];
      var epNum = ep.attr("data-number") || String(i + 1);

      var titleEl = ep.selectFirst(".episode-title");
      var rawTitle = titleEl ? (titleEl.text || "").trim() : "";
      // Remove the "Filler" badge text that may be concatenated into the title
      var epTitle = rawTitle.replace(/\s*Filler\s*$/i, "").trim();

      var label = "Episode " + epNum;
      if (epTitle && epTitle !== epNum) label += ": " + epTitle;

      chapters.push({
        name: label,
        url: animeId + "||" + epNum,
        imageUrl: "",
        scanlator: ep.hasClass("is-filler") ? "Filler" : "",
      });
    }

    // Fallback: if the sidebar is empty, synthesise episodes from the AniList total.
    if (chapters.length === 0 && media) {
      var total = media.episodes || 0;
      if (media.nextAiringEpisode && media.nextAiringEpisode.episode) {
        total = media.nextAiringEpisode.episode - 1;
      }
      for (var j = 1; j <= total; j++) {
        chapters.push({ name: "Episode " + j, url: animeId + "||" + j, imageUrl: "", scanlator: "" });
      }
    }

    // Mangayomi convention: newest episode at index 0.
    chapters.reverse();

    var name = media ? (media.title.english || media.title.romaji || "") : "";
    var imageUrl = media ? ((media.coverImage && (media.coverImage.extraLarge || media.coverImage.large)) || "") : "";
    var description = media ? (media.description || "") : "";
    var genre = media ? (media.genres || []) : [];
    var status = media ? this.statusCode(media.status) : 5;

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
    // Chapter URL format: "{anilist_id}||{ep_number}"
    var parts = url.split("||");
    var animeId = parts[0];
    var epNum = parts[1] || "1";

    // Read language preference (sub / dub).
    var lang = "sub";
    try { lang = new SharedPreferences().get("anicove_lang") || "sub"; } catch (e) {}

    // Fetch the watch page. The server fetches video sources from its private Miruro
    // API and embeds the resulting URL in window.WATCH_CONFIG — no API key needed here.
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

    // Extract fields from window.WATCH_CONFIG in the inline <script> block.
    // videoLink is a single-quoted JS string: videoLink: 'https://...',
    // sourceType is also single-quoted:         sourceType: 'hls',
    // downloadUrl uses tojson so it is double-quoted: downloadUrl: "https://...",
    var videoLinkM = html.match(/videoLink:\s*'([^']*)'/);
    var sourceTypeM = html.match(/sourceType:\s*'([^']*)'/);
    var downloadUrlM = html.match(/downloadUrl:\s*"((?:[^"\\]|\\.)*)"/);

    var videoLink = videoLinkM ? videoLinkM[1] : "";
    var sourceType = sourceTypeM ? sourceTypeM[1] : "hls";
    var downloadUrl = downloadUrlM ? downloadUrlM[1].replace(/\\u0026/g, "&") : "";

    if (!videoLink) return [];

    var streamHeaders = { "User-Agent": this.ua, "Referer": this.source.baseUrl + "/" };
    var streams = [];

    if (sourceType === "hls") {
      streams.push({
        url: videoLink,
        originalUrl: videoLink,
        quality: "HLS [" + lang.toUpperCase() + "]",
        headers: streamHeaders,
        subtitles: [],
      });
    } else {
      // Embed sources (e.g. Megaplay) — pass as-is for the in-app webview player.
      streams.push({
        url: videoLink,
        originalUrl: videoLink,
        quality: "Embed [" + lang.toUpperCase() + "]",
        headers: { "User-Agent": this.ua },
        subtitles: [],
      });
    }

    // Include the download link as an additional quality option when present.
    if (downloadUrl && downloadUrl !== videoLink) {
      streams.push({
        url: downloadUrl,
        originalUrl: downloadUrl,
        quality: "Download [" + lang.toUpperCase() + "]",
        headers: streamHeaders,
        subtitles: [],
      });
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
        listPreference: {
          title: "Preferred language",
          summary: "Choose whether to stream subtitled or dubbed audio.",
          valueIndex: 0,
          entries: ["Sub (subtitled)", "Dub (dubbed)"],
          entryValues: ["sub", "dub"],
        },
      },
    ];
  }
}
