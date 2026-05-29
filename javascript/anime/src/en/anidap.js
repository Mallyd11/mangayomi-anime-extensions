const mangayomiSources = [
  {
    "name": "Anidap",
    "id": 543219876,
    "lang": "en",
    "baseUrl": "https://anidap.se",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://anidap.se",
    "typeSource": "single",
    "itemType": 1,
    "version": "1.5.23",
    "pkgPath": "anime/src/en/anidap.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": false,
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

// ─── Slug cache ───────────────────────────────────────────────────────────────
//
// The slug (e.g. "attack-on-titan-xyz12") is fetched from the Cloudflare-
// protected anidap.se/info/{id}.data endpoint.  Caching it in memory means the
// Cloudflare hit only happens once per show per app session — subsequent
// getVideoList() calls find the slug here immediately.
//
// Chapter URLs are stored as "{anilistId}|{epNum}" (NO slug).  This keeps them
// backward-compatible with history entries created by earlier extension versions,
// preventing duplicate episodes from appearing in the library.
var _slugCache = {};

// ─── getVideoList cache ───────────────────────────────────────────────────────
//
// Mangayomi calls getVideoList() for both playback AND download of the same
// episode. Without caching this doubles the chad API request count, reliably
// hitting the per-IP rate limit (429) on the second call and returning an empty
// stream list — which is why "nothing happens" on download.
//
// The cache keeps the last result per chapter URL for up to 5 minutes.
// mochi Authorization tokens expire in 3 days so a 5-min cache is safe.
var _vlCache   = {};
var _vlCacheTs = {};
var VL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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

  // Headers for requests to anidap.se (Remix .data routes).
  // hasCloudflare is false — we bypass CF the same way HiAnime does: by
  // sending a realistic browser UA + Referer so the request scores low enough
  // on CF's bot detection to pass without any challenge.  Mangayomi's WebView
  // cookie-sharing mechanism was tried but proved unreliable for this site
  // (cf_clearance was never transferred to the HTTP client).
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
    // Retry up to 3 times on 5xx — AniList occasionally returns transient 500s
    // that resolve immediately on the next request.
    var lastErr;
    for (var attempt = 0; attempt < 3; attempt++) {
      var res = await this.client.post(
        "https://graphql.anilist.co",
        { "Content-Type": "application/json", "Accept": "application/json" },
        { query: query, variables: variables }
      );
      if (res.statusCode === 200) {
        var json = JSON.parse(res.body);
        if (json.errors && json.errors.length) throw new Error(json.errors[0].message);
        return json.data;
      }
      lastErr = new Error("AniList HTTP " + res.statusCode);
      // Don't retry client errors (4xx) — they won't change on retry.
      if (res.statusCode < 500) throw lastErr;
    }
    throw lastErr;
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
        link: "/info/" + String(m.id),
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
        link: "/info/" + String(m.id),
        imageUrl: (m.coverImage && (m.coverImage.large || m.coverImage.medium)) || "",
      });
    });

    return { list: list, hasNextPage: !!(p.pageInfo && p.pageInfo.hasNextPage) };
  }

  async search(query, page, filters) {
    try {
      var vars = { page: page, perPage: 24 };
      if (query && query.length > 0) { vars.search = query; vars.sort = ["SEARCH_MATCH"]; }
      else { vars.sort = ["POPULARITY_DESC"]; }
      var data = await this.gql(PAGE_MEDIA_QUERY, vars);
      var p = (data && data.Page) || {};
      return { list: this.parseMedia(p.media), hasNextPage: !!(p.pageInfo && p.pageInfo.hasNextPage) };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
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
  // anidap.se is Cloudflare-protected.  If this request fails, Mangayomi shows
  // a "bypass Cloudflare" dialog.  Complete the challenge in the webview —
  // Mangayomi then retries with the cf_clearance cookie it extracted.
  //
  // IMPORTANT: siteHeaders must NOT set User-Agent.  The cf_clearance cookie is
  // cryptographically bound to the UA that solved the challenge (the WebView's
  // UA).  If the HTTP client sends a different UA, CF rejects the cookie and the
  // bypass loop never escapes.

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
    // Return from cache — avoids repeated Cloudflare hits for the same show.
    var cached = _slugCache[String(anilistId)];
    if (cached) return cached;

    // The ONLY public endpoint that maps AniList ID → slug is the CF-protected
    // anidap.se/info/{id}.data route.  chad.anidap.se has no search, no anime,
    // and no lookup endpoint that accepts numeric AniList IDs (confirmed: all
    // such routes return 404).
    //
    // siteHeaders intentionally omits User-Agent.  The cf_clearance cookie is
    // cryptographically bound to the UA used in the WebView challenge.  If the
    // HTTP client sends a different UA the cookie is rejected and the bypass
    // loop never escapes.  Omitting User-Agent lets Mangayomi's HTTP client use
    // the same default UA as its WebView.
    try {
      var res = await this.client.get(
        this.getBaseUrl() + "/info/" + anilistId + ".data",
        this.siteHeaders
      );
      if (res.statusCode === 200 && res.body) {
        var arr  = JSON.parse(res.body);
        var slug = this.extractSlug(arr);
        if (slug) { _slugCache[String(anilistId)] = slug; return slug; }
      }
    } catch (e) { /* CF blocked or parse error */ }

    return null;
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

  // Fetch direct download links from the site's own download button endpoint.
  // Uses AniList ID directly — no slug, no Cloudflare.
  // Response shape: { sub: { download: { "Kiwi-Stream-1080p": "https://…", … } }, dub: … | null }
  async chadDownload(anilistId, epNum) {
    try {
      var res = await this.client.get(
        CHAD + "/download?id=" + anilistId + "&epNum=" + epNum,
        this.chadHeaders
      );
      if (res.statusCode !== 200 || !res.body) return null;
      var data = JSON.parse(res.body);
      return (data && !data.error) ? data : null;
    } catch (e) { return null; }
  }

  // ── URL transformation ─────────────────────────────────────────────────────
  //
  // Derived from anidap.se/assets/api-BgbRfQAC.js transform map:
  //
  //   uwu:   regex-replace vault-*.owocdn.top/stream/ → uwu.24stream.xyz/storage/
  //   mochi: string-replace tools.fast4speed.rsvp    → mp4.24stream.xyz/storage
  //   miku:  regex-replace any origin               → ply.24stream.xyz/media/
  //   wave:  regex-replace any origin               → wv.24stream.xyz/
  //
  //   The following providers use origin-swap (replaceOrigin):
  //   nuri → rapid-cloud.co   shiro → kem.clvd.xyz      kami → krussdomi.com
  //   yuki → megaplay.buzz    koto  → megacloud.blog/    miru → senshi.live/
  //   maze → ayy-eu.1stkmgv1.com    kiwi  → 4spromax.site/
  //   mimi → otakuhg.site     zaza  → anizone.to
  //
  //   vee, beep: identity (no transform).

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
          "https://uwu.24stream.xyz/storage/"
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

      // ── remaining providers ────────────────────────────────────────────────
      case "mimi": return this.replaceOrigin(url, "https://otakuhg.site");
      case "wave": return url.replace(/https?:\/\/[^/]+\//, "https://wv.24stream.xyz/");

      // vee, beep — identity (no transform)
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

    // Fetch slug from CF-protected info.data.  After the webview bypass, this
    // call succeeds and the slug is cached for all subsequent getVideoList() calls.
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
          // URL is "{anilistId}|{epNum}" — NO slug embedded.
          // getVideoList() resolves the slug via _slugCache (populated above),
          // so no extra Cloudflare hit is needed during playback/download.
          // Keeping the URL slug-free means it matches history entries created
          // by earlier extension versions, preventing duplicate chapters.
          url: anilistId + "|" + num,
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
    // Chapter URL format: "{anilistId}|{epNum}"
    // (older versions embedded the slug as a third segment — still handled below)
    var parts     = url.split("|");
    var anilistId = parts[0] || "";
    var epNum     = parts[1] || "";

    var audioPref = this.getPreference("anidap_audio_pref");
    var dlMode    = this.getPreference("anidap_download_mode") || "off";

    // Cache key includes dlMode — changing the preference must produce a fresh
    // stream list (download links vs HLS-only) rather than a stale cached result.
    var cacheKey = url + "|" + dlMode;
    var _now = Date.now();
    if (_vlCache[cacheKey] && _now - (_vlCacheTs[cacheKey] || 0) < VL_CACHE_TTL_MS) {
      return _vlCache[cacheKey];
    }

    if (!anilistId || !epNum) return [];

    // Resolve slug — hits _slugCache first (populated by getDetail), so the
    // Cloudflare-protected endpoint is only called if the cache is cold.
    // Also handles legacy URLs that still have the slug as parts[2].
    var slug = parts[2] || await this.getSlug(anilistId);
    if (!slug) return [];

    var servers      = await this.chadServers(slug, epNum);
    var subProviders = servers.subProviders || [];
    var dubProviders = servers.dubProviders || [];

    // ── Stream helpers ─────────────────────────────────────────────────────

    // Return the best non-mochi provider from a list.
    // Mochi is a confirmed MP4-only server — skipped for HLS playback.
    // All other providers (including kiwi) may serve HLS and are eligible.
    function hlsProvider(list) {
      var fallback = null;
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === "mochi") continue;
        if (list[i].default) return list[i];
        if (!fallback) fallback = list[i];
      }
      return fallback;
    }

    // Build provider ordering for one audio type.
    //   Playback mode  → single best HLS provider only.
    //   Download mode  → MP4 providers first (kiwi, mochi), then all others.
    //                    More providers = more chances that one works.
    function buildCategories(type, providers) {
      if (dlMode !== "on") {
        var best = hlsProvider(providers);
        if (best) return [{ type: type, provider: best }];
        if (providers.length) return [{ type: type, provider: providers[0] }];
        return [];
      }
      // Download mode: mochi first (confirmed MP4), then all other providers.
      var mochi = [];
      var rest  = [];
      for (var i = 0; i < providers.length; i++) {
        if (providers[i].id === "mochi") mochi.push(providers[i]);
        else                             rest.push(providers[i]);
      }
      var ordered = mochi.concat(rest);
      return ordered.map(function(p) { return { type: type, provider: p }; });
    }

    var subCats = buildCategories("sub", subProviders);
    var dubCats = buildCategories("dub", dubProviders);

    // Preferred audio type goes first.
    var categories = (audioPref === "dub")
      ? dubCats.concat(subCats)
      : subCats.concat(dubCats);

    var streams = [];
    var seen    = {};

    // ── Download mode: prepend site download-endpoint links ────────────────
    //
    // chad.anidap.se/rest/api/download uses the AniList ID directly (no slug,
    // no Cloudflare) and returns the same links the site's download button uses.
    // These are put first so Mangayomi's downloader auto-selects one.
    // The /sources streams that follow act as a fallback.
    if (dlMode === "on") {
      var dlData = await this.chadDownload(anilistId, epNum);
      if (dlData) {
        var dlTypes = (audioPref === "dub") ? ["dub", "sub"] : ["sub", "dub"];
        for (var dti = 0; dti < dlTypes.length; dti++) {
          var dlAudio     = dlTypes[dti];
          var dlAudioData = dlData[dlAudio];
          // Support both { download: { label: url } } and { label: url } shapes.
          var dlLinks = (dlAudioData && dlAudioData.download)
            ? dlAudioData.download
            : (dlAudioData && typeof dlAudioData === "object" ? dlAudioData : null);
          if (!dlLinks) continue;
          var dlKeys = Object.keys(dlLinks);
          for (var dki = 0; dki < dlKeys.length; dki++) {
            var dlLabel = dlKeys[dki];
            var dlUrl   = dlLinks[dlLabel];
            if (!dlUrl || typeof dlUrl !== "string") continue;
            var dlKey = dlUrl + "|" + dlAudio;
            if (seen[dlKey]) continue;
            seen[dlKey] = true;
            streams.push({
              url: dlUrl,
              originalUrl: dlUrl,
              quality: dlLabel + " [" + dlAudio.toUpperCase() + "] DOWNLOAD",
              headers: { "User-Agent": this.ua, "Referer": this.getBaseUrl() + "/" },
              subtitles: [],
            });
          }
        }
      }
    }

    // ── Provider streams ───────────────────────────────────────────────────

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
          if (!t) return;
          var file = t.url || t.file;
          if (!file) return;
          // Skip thumbnail sprite tracks — their cue text is "thumb.jpg#xywh=…"
          // which Mangayomi renders as garbled on-screen text.
          var kind  = (t.kind  || "").toLowerCase();
          var label = (t.label || "").toLowerCase();
          if (kind === "thumbnails" || kind === "chapters" || kind === "metadata") return;
          if (label.indexOf("thumbnail") >= 0) return;
          if (file.indexOf("#xywh=") >= 0) return;
          if (/\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(file)) return;
          subtitles.push({ file: file, label: t.label || t.lang || "Unknown" });
        });

        for (var k = 0; k < sources.length; k++) {
          var src    = sources[k];
          var srcUrl = src && src.url;
          if (!srcUrl) continue;

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
      } catch (e) { /* skip this provider on error */ }
    }

    // Store in cache before returning so a follow-up download call is free.
    _vlCache[cacheKey]   = streams;
    _vlCacheTs[cacheKey] = Date.now();
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
          valueIndex: 1,
          entries: ["Romaji", "English", "Native"],
          entryValues: ["romaji", "english", "native"],
        },
      },
      {
        key: "anidap_audio_pref",
        listPreference: {
          title: "Default audio",
          summary: "Both sub and dub are always available in the quality picker. This sets which one the player selects automatically.",
          valueIndex: 0,
          entries: ["Sub (default)", "Dub (default)"],
          entryValues: ["sub", "dub"],
        },
      },
      {
        key: "anidap_download_mode",
        listPreference: {
          title: "Download mode",
          summary: "OFF: normal playback (HLS). ON: direct download links appear first — Mangayomi auto-selects one when you tap the download button. Switch back to OFF to resume normal playback.",
          valueIndex: 0,
          entries: ["OFF — Playback", "ON — Download"],
          entryValues: ["off", "on"],
        },
      },
    ];
  }
}
