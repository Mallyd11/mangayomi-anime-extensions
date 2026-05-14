const mangayomiSources = [
  {
    "name": "Anidap",
    "id": 543219876,
    "lang": "en",
    "baseUrl": "https://anidap.se",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://anidap.se",
    "typeSource": "single",
    "itemType": 1,
    "version": "1.4.0",
    "pkgPath": "anime/src/en/anidap.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": true,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/anidap.js",
    "apiUrl": "",
    "dateFormat": "",
    "dateFormatLocale": "",
    "additionalParams": "",
    "sourceCodeLanguage": 1,
    "notes": "",
  },
];

// chad.anidap.se is the dedicated REST API subdomain
var CHAD = "https://chad.anidap.se/rest/api";

// ─── AniList GraphQL (browse / search / metadata) ────────────────────────────

var PAGE_MEDIA_QUERY = [
  "query PageMedia($page:Int,$perPage:Int,$search:String,$sort:[MediaSort]){",
  "Page(page:$page,perPage:$perPage){",
  "pageInfo{currentPage hasNextPage}",
  "media(type:ANIME,isAdult:false,search:$search,sort:$sort){",
  "id title{romaji english native} coverImage{large medium}",
  "}}}"
].join("");

var MEDIA_DETAIL_QUERY = [
  "query MediaDetail($id:Int){",
  "Media(id:$id,type:ANIME){",
  "id title{romaji english native}",
  "description(asHtml:false)",
  "coverImage{extraLarge large medium}",
  "episodes format genres status",
  "}}"
].join("");

// ─── Extension ───────────────────────────────────────────────────────────────

class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
  }

  get ua() {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
  }

  getPreference(key) {
    return new SharedPreferences().get(key);
  }

  getBaseUrl() {
    return this.getPreference("anidap_base_url") || this.source.baseUrl;
  }

  // Headers for requests to anidap.se (Remix .data routes)
  get siteHeaders() {
    return {
      "User-Agent": this.ua,
      "Accept": "application/json, */*",
      "Referer": this.getBaseUrl() + "/",
    };
  }

  // Headers for requests to chad.anidap.se
  get chadHeaders() {
    return {
      "User-Agent": this.ua,
      "Accept": "application/json",
      "Origin": this.getBaseUrl(),
      "Referer": this.getBaseUrl() + "/",
    };
  }

  // ── AniList GraphQL ────────────────────────────────────────────────────────

  async gql(query, variables) {
    var res = await this.client.post(
      "https://graphql.anilist.co",
      { "Content-Type": "application/json", "Accept": "application/json" },
      { query: query, variables: variables }
    );
    if (res.statusCode !== 200) throw new Error("AniList HTTP " + res.statusCode);
    var json = JSON.parse(res.body);
    if (json.errors && json.errors.length) throw new Error(json.errors[0].message);
    return json.data;
  }

  titleByPref(title) {
    var pref = this.getPreference("anidap_title_lang");
    if (!title) return "";
    if (pref === "english") return title.english || title.romaji || "";
    if (pref === "native")  return title.native  || title.romaji || "";
    return title.romaji || title.english || "";
  }

  parseMedia(media) {
    var self = this;
    var list = [];
    (media || []).forEach(function(m) {
      if (!m || !m.id || !m.title) return;
      var name = self.titleByPref(m.title);
      if (!name) return;
      list.push({
        name: name,
        link: String(m.id),
        imageUrl: (m.coverImage && (m.coverImage.large || m.coverImage.medium)) || "",
      });
    });
    return list;
  }

  get supportsLatest() { return true; }

  async getPopular(page) {
    var data = await this.gql(PAGE_MEDIA_QUERY, { page: page, perPage: 24, sort: ["POPULARITY_DESC"] });
    var p = (data && data.Page) || {};
    return { list: this.parseMedia(p.media), hasNextPage: !!(p.pageInfo && p.pageInfo.hasNextPage) };
  }

  async getLatestUpdates(page) {
    var data = await this.gql(PAGE_MEDIA_QUERY, { page: page, perPage: 24, sort: ["UPDATED_AT_DESC"] });
    var p = (data && data.Page) || {};
    return { list: this.parseMedia(p.media), hasNextPage: !!(p.pageInfo && p.pageInfo.hasNextPage) };
  }

  async search(query, page, filters) {
    var vars = { page: page, perPage: 24 };
    if (query && query.length > 0) { vars.search = query; vars.sort = ["SEARCH_MATCH"]; }
    else { vars.sort = ["POPULARITY_DESC"]; }
    var data = await this.gql(PAGE_MEDIA_QUERY, vars);
    var p = (data && data.Page) || {};
    return { list: this.parseMedia(p.media), hasNextPage: !!(p.pageInfo && p.pageInfo.hasNextPage) };
  }

  statusCode(s) {
    switch ((s || "").toUpperCase()) {
      case "RELEASING":        return 0;
      case "FINISHED":         return 1;
      case "NOT_YET_RELEASED": return 4;
      case "CANCELLED":        return 5;
      default:                 return 5;
    }
  }

  // ── Slug resolution ────────────────────────────────────────────────────────
  //
  // The site uses a unique slug per anime (e.g. "one-punch-man-season-3-i5r8m")
  // which is required for all chad.anidap.se API calls.
  //
  // It is embedded in the Remix turbo-stream response at /info/{anilistId}.data
  // as a flat array: [..., "id", "one-punch-man-season-3-i5r8m", "anilistId", 153800, ...]

  extractSlug(arr) {
    if (!Array.isArray(arr)) return null;
    for (var i = 0; i < arr.length - 1; i++) {
      // The slug appears as the string value immediately after the "id" key.
      // It contains hyphens and is not purely numeric.
      if (arr[i] === "id" &&
          typeof arr[i + 1] === "string" &&
          arr[i + 1].indexOf("-") >= 0 &&
          !/^\d+$/.test(arr[i + 1])) {
        return arr[i + 1];
      }
    }
    return null;
  }

  async getSlug(anilistId) {
    try {
      var res = await this.client.get(
        this.getBaseUrl() + "/info/" + anilistId + ".data",
        this.siteHeaders
      );
      if (res.statusCode !== 200 || !res.body) return null;
      var arr = JSON.parse(res.body);
      return this.extractSlug(arr);
    } catch (e) {
      return null;
    }
  }

  // ── chad.anidap.se REST API ────────────────────────────────────────────────

  // GET /episodes?id={slug}
  // Returns [{number, titles:{en}, img, isFiller, description, hasDub, hasSub, ...}]
  async chadEpisodes(slug) {
    var res = await this.client.get(CHAD + "/episodes?id=" + slug, this.chadHeaders);
    if (res.statusCode !== 200 || !res.body) return [];
    var data = JSON.parse(res.body);
    return Array.isArray(data) ? data : [];
  }

  // GET /servers?id={slug}&epNum={n}
  // Returns {subProviders:[{id,default,tip}], dubProviders:[...]}
  async chadServers(slug, epNum) {
    var res = await this.client.get(
      CHAD + "/servers?id=" + slug + "&epNum=" + epNum,
      this.chadHeaders
    );
    if (res.statusCode !== 200 || !res.body) return { subProviders: [], dubProviders: [] };
    return JSON.parse(res.body);
  }

  // GET /sources?id={slug}&epNum={n}&type={sub|dub}&providerId={pid}
  // Returns {sources:[{url,quality}], tracks:[...], headers:{Referer:...}}
  async chadSources(slug, epNum, type, providerId) {
    var res = await this.client.get(
      CHAD + "/sources?id=" + slug +
        "&epNum=" + epNum +
        "&type=" + type +
        "&providerId=" + providerId,
      this.chadHeaders
    );
    if (res.statusCode !== 200 || !res.body) return null;
    return JSON.parse(res.body);
  }

  // ── URL transformation ─────────────────────────────────────────────────────
  //
  // The site's api.js maps each provider ID to a URL transform function.
  // We mirror the known transforms here so Mangayomi receives playable URLs
  // instead of the raw vault-*.owocdn.top placeholder URLs (which return 503).
  //
  // Derived from anidap.se/assets/api-BgbRfQAC.js:
  //   uwu:   t.replace(/https:\/\/vault-\d+\.(owo|uwu)cdn\.top\/stream\//, "https://sv6.otakuu.se/storage/")
  //   mochi: t.replace("https://tools.fast4speed.rsvp", "https://mp4.24stream.xyz/storage")
  //   miku:  t.replace(/https:\/\/[^/]+\//, "https://ply.24stream.xyz/media/")
  //   vee / wave / beep: identity (no-op)

  transformUrl(url, providerId) {
    if (!url) return url;
    switch (providerId) {
      case "uwu":
        return url.replace(
          /https:\/\/vault-\d+\.(owo|uwu)cdn\.top\/stream\//,
          "https://sv6.otakuu.se/storage/"
        );
      case "mochi":
        return url.replace(
          "https://tools.fast4speed.rsvp",
          "https://mp4.24stream.xyz/storage"
        );
      case "miku":
        return url.replace(
          /https:\/\/[^/]+\//,
          "https://ply.24stream.xyz/media/"
        );
      default:
        return url; // vee, wave, beep: identity; u()-based providers: leave as-is
    }
  }

  // ── Detail ─────────────────────────────────────────────────────────────────

  async getDetail(url) {
    var anilistId = parseInt(url.replace(/[^0-9]/g, ""), 10);
    if (!anilistId) throw new Error("Cannot parse AniList ID: " + url);

    // Fetch AniList metadata (reliable, fast)
    var data = await this.gql(MEDIA_DETAIL_QUERY, { id: anilistId });
    var m = (data && data.Media) || {};

    var name       = this.titleByPref(m.title || {});
    var imageUrl   = (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large)) || "";
    var description = (m.description || "").replace(/<[^>]*>/g, "").replace(/\n{3,}/g, "\n\n").trim();
    var genre      = m.genres || [];
    var status     = this.statusCode(m.status);
    var isMovie    = m.format === "MOVIE";

    // Get the site slug needed for the chad API
    var slug = await this.getSlug(anilistId);

    var chapters = [];

    if (slug) {
      var episodes = await this.chadEpisodes(slug);
      episodes.forEach(function(ep) {
        var num    = ep.number;
        var title  = (ep.titles && ep.titles.en) || ("Episode " + num);
        var chName = isMovie ? title : ("E" + num + " — " + title);
        chapters.push({
          name: chName,
          // URL encodes both the AniList ID and the slug so getVideoList
          // can call the chad API directly without an extra network round-trip.
          url: anilistId + "|" + num + "|" + slug,
          thumbnailUrl: ep.img || null,
          description: ep.description || null,
          isFiller: ep.isFiller || false,
        });
      });
    } else {
      // Fallback: numbered stubs from AniList episode count
      var epCount = m.episodes || 0;
      for (var j = 1; j <= epCount; j++) {
        chapters.push({
          name: isMovie ? name : ("Episode " + j),
          url: anilistId + "|" + j,
        });
      }
    }

    chapters.reverse(); // newest first

    return {
      name: name,
      imageUrl: imageUrl,
      description: description,
      genre: genre,
      status: status,
      link: this.getBaseUrl() + "/info/" + anilistId,
      chapters: chapters,
    };
  }

  // ── Video list ─────────────────────────────────────────────────────────────

  async getVideoList(url) {
    // Chapter URL format: "{anilistId}|{epNum}|{slug}"
    // e.g. "153800|1|one-punch-man-season-3-i5r8m"
    var parts     = url.split("|");
    var anilistId = parts[0] || "";
    var epNum     = parts[1] || "";
    var slug      = parts[2] || "";

    if (!anilistId || !epNum) return [];

    // If the chapter was created from a stub (no slug), fetch it now.
    if (!slug) {
      slug = await this.getSlug(anilistId);
      if (!slug) return [];
    }

    // Get available providers for this episode
    var servers = await this.chadServers(slug, epNum);
    var subProviders = servers.subProviders || [];
    var dubProviders = servers.dubProviders || [];

    // Select default providers (flagged default:true, or first entry)
    function defaultProvider(list) {
      for (var i = 0; i < list.length; i++) { if (list[i].default) return list[i]; }
      return list[0] || null;
    }

    var audioPref   = this.getPreference("anidap_audio_pref");
    var subDefault  = defaultProvider(subProviders);
    var dubDefault  = defaultProvider(dubProviders);

    // Build category order based on user preference
    var categories;
    if (audioPref === "dub") {
      categories = [
        { type: "dub", provider: dubDefault },
        { type: "sub", provider: subDefault },
      ];
    } else {
      categories = [
        { type: "sub", provider: subDefault },
        { type: "dub", provider: dubDefault },
      ];
    }

    var streams = [];
    var seen    = {};

    for (var ci = 0; ci < categories.length; ci++) {
      var cat = categories[ci];
      if (!cat.provider) continue;

      try {
        var srcData = await this.chadSources(slug, epNum, cat.type, cat.provider.id);
        if (!srcData) continue;

        var sources  = srcData.sources || [];
        var tracks   = srcData.tracks  || [];

        // sv6.otakuu.se (the real CDN after URL transformation) serves content
        // with no custom origin/referer requirements — only a UA is needed.
        var streamHdrs = {
          "User-Agent": this.ua,
        };

        // Build subtitle list
        var subtitles = [];
        (tracks || []).forEach(function(t) {
          if (t && (t.url || t.file)) {
            subtitles.push({ file: t.url || t.file, label: t.label || t.lang || "Unknown" });
          }
        });

        // Each source already carries a quality label (e.g. "1080p") from the API.
        for (var k = 0; k < sources.length; k++) {
          var src    = sources[k];
          var srcUrl = src && src.url;
          if (!srcUrl) continue;

          // Apply the provider-specific URL transformation (mirrors the site's
          // api.js transform map) so the URL points to the real CDN, not the
          // vault-*.owocdn.top placeholder that returns HTTP 503.
          srcUrl = this.transformUrl(srcUrl, cat.provider.id);

          var quality = (src.quality || "Auto") +
            " [" + cat.type.toUpperCase() + "] " +
            cat.provider.id.toUpperCase();
          var key = srcUrl + "|" + cat.type;
          if (seen[key]) continue;
          seen[key] = true;

          streams.push({
            url: srcUrl,
            originalUrl: srcUrl,
            quality: quality,
            headers: streamHdrs,
            subtitles: subtitles,
          });
        }
      } catch (e) { /* skip this category on error */ }
    }

    return streams;
  }

  // ── Preferences ────────────────────────────────────────────────────────────

  getFilterList() { return []; }

  getSourcePreferences() {
    return [
      {
        key: "anidap_base_url",
        editTextPreference: {
          title: "Override base URL",
          summary: "Change if the site moves to a new domain",
          value: "https://anidap.se",
          dialogTitle: "Override base URL",
          dialogMessage: "",
        },
      },
      {
        key: "anidap_title_lang",
        listPreference: {
          title: "Preferred title language",
          summary: "",
          valueIndex: 0,
          entries: ["Romaji", "English", "Native"],
          entryValues: ["romaji", "english", "native"],
        },
      },
      {
        key: "anidap_audio_pref",
        listPreference: {
          title: "Preferred audio",
          summary: "Sub or Dub priority",
          valueIndex: 0,
          entries: ["Sub", "Dub"],
          entryValues: ["sub", "dub"],
        },
      },
    ];
  }
}
