const mangayomiSources = [
  {
    "name": "Anidap",
    "id": 543219876,
    "lang": "en",
    "baseUrl": "https://anidap.se",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://anidap.se",
    "typeSource": "single",
    "itemType": 1,
    "version": "1.4.6",
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

// chad.anidap.se is the dedicated REST API subdomain (no Cloudflare)
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

// Returns episodes that recently aired (TIME_DESC) — matches anidap.se "Recent Episodes".
// perPage is set higher than needed to absorb adult/duplicate filtering.
var RECENT_EPISODES_QUERY = [
  "query RecentEp($page:Int,$perPage:Int,$before:Int){",
  "Page(page:$page,perPage:$perPage){",
  "pageInfo{currentPage hasNextPage}",
  "airingSchedules(notYetAired:false,airingAt_lesser:$before,sort:[TIME_DESC]){",
  "media{id isAdult title{romaji english native} coverImage{large medium}}",
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

  // Headers for requests to anidap.se (Remix .data routes, Cloudflare-protected)
  get siteHeaders() {
    return {
      "User-Agent": this.ua,
      "Accept": "application/json, */*",
      "Referer": this.getBaseUrl() + "/",
    };
  }

  // Headers for requests to chad.anidap.se (no Cloudflare)
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
    // Use AniList's airing schedule (sorted newest-first) to mirror the
    // "Recent Episodes" feed on anidap.se.  UPDATED_AT_DESC was sorting by
    // when AniList metadata changed — not when episodes actually aired.
    var self = this;
    var now  = Math.floor(Date.now() / 1000);
    var data = await this.gql(RECENT_EPISODES_QUERY, { page: page, perPage: 40, before: now });
    var p    = (data && data.Page) || {};

    // Deduplicate: same series can have multiple airing schedule entries.
    var seen = {};
    var list = [];
    (p.airingSchedules || []).forEach(function(sched) {
      var m = sched && sched.media;
      if (!m || m.isAdult || seen[m.id]) return;
      seen[m.id] = true;
      var name = self.titleByPref(m.title);
      if (!name) return;
      list.push({
        name: name,
        link: String(m.id),
        imageUrl: (m.coverImage && (m.coverImage.large || m.coverImage.medium)) || "",
      });
    });

    return { list: list, hasNextPage: !!(p.pageInfo && p.pageInfo.hasNextPage) };
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
  // required for all chad.anidap.se API calls.  It is embedded in the Remix
  // turbo-stream response at /info/{anilistId}.data as a flat serialised array.
  //
  // NOTE: anidap.se is Cloudflare-protected. If this request fails the first
  // time, Mangayomi will show a "Failed to bypass Cloudflare" dialog.
  // Tap "bypass it manually in the webview" — the clearance cookie is then
  // stored and all subsequent requests succeed automatically.

  extractSlug(arr) {
    if (!Array.isArray(arr)) return null;
    for (var i = 0; i < arr.length - 1; i++) {
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

  async chadEpisodes(slug) {
    var res = await this.client.get(CHAD + "/episodes?id=" + slug, this.chadHeaders);
    if (res.statusCode !== 200 || !res.body) return [];
    var data = JSON.parse(res.body);
    return Array.isArray(data) ? data : [];
  }

  async chadServers(slug, epNum) {
    var res = await this.client.get(
      CHAD + "/servers?id=" + slug + "&epNum=" + epNum,
      this.chadHeaders
    );
    if (res.statusCode !== 200 || !res.body) return { subProviders: [], dubProviders: [] };
    return JSON.parse(res.body);
  }

  async chadSources(slug, epNum, type, providerId) {
    var res = await this.client.get(
      CHAD + "/sources?id=" + slug +
        "&epNum=" + epNum +
        "&type=" + type +
        "&providerId=" + providerId,
      this.chadHeaders
    );
    if (res.statusCode !== 200 || !res.body) return null;
    var data = JSON.parse(res.body);
    // Treat error responses as null
    if (data && data.error) return null;
    return data;
  }

  // ── URL transformation ─────────────────────────────────────────────────────
  //
  // Derived from anidap.se/assets/api-BgbRfQAC.js transform map:
  //
  //   uwu:   regex-replace vault-*.owocdn.top/stream/ → sv6.otakuu.se/storage/
  //   mochi: string-replace tools.fast4speed.rsvp    → mp4.24stream.xyz/storage
  //   miku:  regex-replace any origin               → ply.24stream.xyz/media/
  //
  //   The following providers use u(t,{origin:"<cdn>"}) — an origin-swap:
  //   nuri → rapid-cloud.co   shiro → kem.clvd.xyz      kami → krussdomi.com
  //   yuki → megaplay.buzz    koto  → megacloud.blog/    miru → senshi.live/
  //   maze → ayy-eu.1stkmgv1.com    kiwi  → 4spromax.site/
  //   mimi → vibeplayer.site/ (same origin = identity)   zaza → anizone.to
  //
  //   wave, vee, beep: identity (no transform).

  // Replace only the scheme+host part of a URL, preserving path/query/hash.
  replaceOrigin(url, newOrigin) {
    if (!url) return url;
    var protoEnd = url.indexOf("://");
    if (protoEnd < 0) return url;
    var pathStart = url.indexOf("/", protoEnd + 3);
    var path = pathStart >= 0 ? url.substring(pathStart) : "/";
    return newOrigin.replace(/\/$/, "") + path;
  }

  transformUrl(url, providerId) {
    if (!url) return url;
    switch (providerId) {
      // ── regex / string replace ─────────────────────────────────────────────
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

      // ── origin-swap providers ──────────────────────────────────────────────
      case "nuri":  return this.replaceOrigin(url, "https://rapid-cloud.co");
      case "shiro": return this.replaceOrigin(url, "https://kem.clvd.xyz");
      case "kami":  return this.replaceOrigin(url, "https://krussdomi.com");
      case "yuki":  return this.replaceOrigin(url, "https://megaplay.buzz");
      case "koto":  return this.replaceOrigin(url, "https://megacloud.blog");
      case "miru":  return this.replaceOrigin(url, "https://senshi.live");
      case "maze":  return this.replaceOrigin(url, "https://ayy-eu.1stkmgv1.com");
      case "kiwi":  return this.replaceOrigin(url, "https://4spromax.site");
      case "zaza":  return this.replaceOrigin(url, "https://anizone.to");

      // ── identity providers (mimi, wave, vee, beep) ────────────────────────
      default: return url;
    }
  }

  // ── Detail ─────────────────────────────────────────────────────────────────

  async getDetail(url) {
    var anilistId = parseInt(url.replace(/[^0-9]/g, ""), 10);
    if (!anilistId) throw new Error("Cannot parse AniList ID: " + url);

    var data = await this.gql(MEDIA_DETAIL_QUERY, { id: anilistId });
    var m = (data && data.Media) || {};

    var name        = this.titleByPref(m.title || {});
    var imageUrl    = (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large)) || "";
    var description = (m.description || "").replace(/<[^>]*>/g, "").replace(/\n{3,}/g, "\n\n").trim();
    var genre       = m.genres || [];
    var status      = this.statusCode(m.status);
    var isMovie     = m.format === "MOVIE";

    // Fetch slug (hits Cloudflare-protected anidap.se — manual webview bypass
    // may be needed on first use; clearance cookie persists after that).
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
          // Embed slug in chapter URL so getVideoList() needs no extra round-trip.
          url: anilistId + "|" + num + "|" + slug,
          thumbnailUrl: ep.img || null,
          description: ep.description || null,
          isFiller: ep.isFiller || false,
        });
      });
    } else {
      // Fallback: numbered stubs from AniList episode count.
      // Streams will be unavailable until Cloudflare is bypassed.
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
    var parts     = url.split("|");
    var anilistId = parts[0] || "";
    var epNum     = parts[1] || "";
    var slug      = parts[2] || "";

    if (!anilistId || !epNum) return [];

    // Stub chapters (no slug) require a live slug fetch.
    if (!slug) {
      slug = await this.getSlug(anilistId);
      if (!slug) return [];
    }

    var servers      = await this.chadServers(slug, epNum);
    var subProviders = servers.subProviders || [];
    var dubProviders = servers.dubProviders || [];

    function findProvider(list, id) {
      for (var i = 0; i < list.length; i++) { if (list[i].id === id) return list[i]; }
      return null;
    }

    var audioPref = this.getPreference("anidap_audio_pref");

    // ── Stream order ───────────────────────────────────────────────────────
    //
    // mochi is the ONLY provider that returns a direct video file (MP4,
    // ~238 MB, mp4.24stream.xyz).  All other providers (uwu, shiro, etc.)
    // return AES-128 encrypted HLS with relative segment URLs — Mangayomi's
    // download manager cannot decrypt and reassemble them.
    //
    // Fetching HLS providers also wastes sources-API quota: the chad API
    // enforces a per-IP rate limit with a ~39-minute window.  When the user
    // plays an episode (consuming quota) and then taps Download (triggering
    // another getVideoList() call), the HLS requests push the total over the
    // limit → all chadSources() calls return null → empty stream list →
    // "nothing happens" on download.
    //
    // Fix: fetch ONLY mochi (1–2 sources requests per getVideoList() call).
    // mochi plays and downloads reliably; the rate limit is never approached.

    var subMochi = findProvider(subProviders, "mochi");
    var dubMochi = findProvider(dubProviders, "mochi");

    var categories = [];
    if (audioPref === "dub") {
      // Dub preferred — dub audio first, sub as fallback
      if (dubMochi) categories.push({ type: "dub", provider: dubMochi });
      if (subMochi) categories.push({ type: "sub", provider: subMochi });
    } else {
      // Sub preferred (default) — sub first so Mangayomi auto-downloads it
      if (subMochi) categories.push({ type: "sub", provider: subMochi });
      if (dubMochi) categories.push({ type: "dub", provider: dubMochi });
    }

    var streams = [];
    var seen    = {};

    for (var ci = 0; ci < categories.length; ci++) {
      var cat = categories[ci];
      if (!cat.provider) continue;

      try {
        var srcData = await this.chadSources(slug, epNum, cat.type, cat.provider.id);
        if (!srcData) continue;

        var sources = srcData.sources || [];
        var tracks  = srcData.tracks  || [];

        // Use the Referer returned by the API — CDNs check it for hotlink
        // protection. Without it the server returns 403 / an HTML error page.
        var apiHdrs = srcData.headers || {};
        var streamHdrs = { "User-Agent": this.ua };
        if (apiHdrs.Referer) streamHdrs.Referer = apiHdrs.Referer;

        var subtitles = [];
        (tracks || []).forEach(function(t) {
          if (t && (t.url || t.file)) {
            subtitles.push({ file: t.url || t.file, label: t.label || t.lang || "Unknown" });
          }
        });

        for (var k = 0; k < sources.length; k++) {
          var src    = sources[k];
          var srcUrl = src && src.url;
          if (!srcUrl) continue;

          srcUrl = this.transformUrl(srcUrl, cat.provider.id);

          // mochi always reports quality "auto" — label it as MP4 so the
          // user knows it is a direct file (not HLS) and is downloadable.
          var rawQ   = (src.quality || "").toLowerCase();
          var qLabel = (rawQ && rawQ !== "auto") ? src.quality : "MP4";
          var quality = qLabel +
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
