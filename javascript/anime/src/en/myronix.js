const mangayomiSources = [
  {
    "name": "MyroniX",
    "id": 347219856,
    "lang": "en",
    "baseUrl": "https://myronix.strangled.net",
    "iconUrl": "https://myronix.strangled.net/images/axolotl.png",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.1.2",
    "pkgPath": "anime/src/en/myronix.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": true,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/myronix.js",
    "dateFormat": "",
    "dateFormatLocale": "",
    "additionalParams": "",
    "sourceCodeLanguage": 1,
    "notes": "",
  },
];

// ─── GraphQL queries ───────────────────────────────────────────────────────────

var PAGE_MEDIA_QUERY = [
  "query PageMedia(",
  "$page:Int,$perPage:Int,$search:String,",
  "$genres:[String],$format:MediaFormat,",
  "$status:MediaStatus,$minScore:Int,$sort:[MediaSort]",
  "){Page(page:$page,perPage:$perPage){",
  "pageInfo{currentPage hasNextPage lastPage total}",
  "media(type:ANIME,isAdult:false,search:$search,",
  "genre_in:$genres,format:$format,status:$status,",
  "averageScore_greater:$minScore,sort:$sort){",
  "id idMal title{romaji english native}",
  "description(asHtml:false)",
  "coverImage{extraLarge large medium}",
  "bannerImage episodes format duration",
  "averageScore genres status season seasonYear",
  "startDate{year month day} endDate{year month day}",
  "studios{nodes{name isAnimationStudio}}",
  "}}}"
].join("\n");

var MEDIA_DETAIL_QUERY = [
  "query MediaDetail($id:Int){",
  "Media(id:$id,type:ANIME){",
  "id idMal title{romaji english native}",
  "description(asHtml:false)",
  "coverImage{extraLarge large medium}",
  "bannerImage episodes format duration",
  "averageScore genres status season seasonYear",
  "startDate{year month day} endDate{year month day}",
  "studios{nodes{name isAnimationStudio}}",
  "}}"
].join("\n");

// ─── Extension ────────────────────────────────────────────────────────────────

class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
  }

  get ua() {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
  }

  get getHeaders() {
    return {
      "User-Agent": this.ua,
      "Accept": "application/json",
      "Referer": this.source.baseUrl + "/",
    };
  }

  // POST directly to AniList (not the site proxy — avoids HTTP 429)
  async gql(query, variables) {
    var res = await this.client.post(
      "https://graphql.anilist.co",
      { "Content-Type": "application/json", "Accept": "application/json" },
      { query: query, variables: variables }
    );
    if (res.statusCode !== 200) throw new Error("HTTP " + res.statusCode);
    var json = JSON.parse(res.body);
    if (json.errors && json.errors.length) throw new Error(json.errors[0].message);
    return json.data;
  }

  parseMedia(media) {
    var list = [];
    (media || []).forEach(function(m) {
      var name = (m.title && (m.title.english || m.title.romaji)) || "";
      if (!name || !m.id) return;
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
    return { list: this.parseMedia(p.media), hasNextPage: (p.pageInfo && p.pageInfo.hasNextPage) || false };
  }

  async getLatestUpdates(page) {
    var data = await this.gql(PAGE_MEDIA_QUERY, { page: page, perPage: 24, sort: ["UPDATED_AT_DESC"], status: "RELEASING" });
    var p = (data && data.Page) || {};
    return { list: this.parseMedia(p.media), hasNextPage: (p.pageInfo && p.pageInfo.hasNextPage) || false };
  }

  async search(query, page, filters) {
    var data = await this.gql(PAGE_MEDIA_QUERY, { page: page, perPage: 24, search: query, sort: ["SEARCH_MATCH"] });
    var p = (data && data.Page) || {};
    return { list: this.parseMedia(p.media), hasNextPage: (p.pageInfo && p.pageInfo.hasNextPage) || false };
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

  async getDetail(url) {
    var anilistId = parseInt(url.replace(/[^0-9]/g, ""), 10);
    if (!anilistId) throw new Error("Cannot parse AniList ID from: " + url);

    var data = await this.gql(MEDIA_DETAIL_QUERY, { id: anilistId });
    var m = (data && data.Media) || {};

    var name      = (m.title && (m.title.english || m.title.romaji)) || "";
    var imageUrl  = (m.coverImage && (m.coverImage.large || m.coverImage.medium)) || "";
    var description = (m.description || "").replace(/<[^>]*>/g, "").replace(/\n+/g, "\n").trim();
    var genre     = m.genres || [];
    var status    = this.statusCode(m.status);
    var epCount   = m.episodes || 0;

    // Fetch episode list from the site's AllAnime API.
    // Chapter URL = "{showId}|{epNum}" — pipe-separated, no URL-scheme prefix.
    var chapters = [];
    try {
      var epUrl = this.source.baseUrl + "/api/v2/allanime/episodes/" +
        anilistId + "?provider=anilist&mode=sub";
      var epRes = await this.client.get(epUrl, this.getHeaders);
      if (epRes.statusCode === 200) {
        var epJson = JSON.parse(epRes.body);
        var episodes = (epJson.data && epJson.data.episodes) || [];
        var seenIds = {};
        for (var i = 0; i < episodes.length; i++) {
          var ep = episodes[i];
          // Parse "allanime:{showId}:{epNum}" → two colon positions
          var rawId = ep.episodeId || "";
          var c1 = rawId.indexOf(":");
          var c2 = rawId.indexOf(":", c1 + 1);
          if (c1 < 0 || c2 < 0) continue;
          // Deduplicate by episodeId
          if (seenIds[rawId]) continue;
          seenIds[rawId] = true;
          var showId = rawId.substring(c1 + 1, c2);
          var epNum  = rawId.substring(c2 + 1);
          // Build label: always prefix with episode number so the list is
          // scannable. Skip redundant titles like "Episode 1" that add nothing.
          var numStr   = String(ep.number);
          var epTitle  = (ep.title || "").trim();
          var fallback = "Episode " + numStr;
          var label = (epTitle && epTitle !== fallback)
            ? "E" + numStr + ": " + epTitle
            : fallback;
          chapters.push({ name: label, url: showId + "|" + epNum });
        }
      }
    } catch (e) { /* fall through */ }

    // Fallback when AllAnime returns no episodes
    if (chapters.length === 0 && epCount > 0) {
      for (var j = 1; j <= epCount; j++) {
        chapters.push({ name: "Episode " + j, url: "stub|" + anilistId + "|" + j });
      }
    }

    chapters.reverse();
    return {
      name: name, imageUrl: imageUrl, description: description,
      genre: genre, status: status,
      link: this.source.baseUrl + "/anime/" + anilistId,
      chapters: chapters,
    };
  }

  // ── Wix CDN helper ──────────────────────────────────────────────────────────
  // Parse Wix CDN master URL → quality variant URLs without any HTTP request.
  //
  // Master URL format:
  //   https://repackager.wixmp.com/.../video/{id}/,1080p,720p,480p,/mp4/file.mp4.urlset/master.m3u8
  // Variant URL format:
  //   https://repackager.wixmp.com/.../video/{id}/{quality}/mp4/file.mp4/index-v1-a1.m3u8
  //
  // Returns [{url, label}, ...] sorted highest quality first, or null if not a Wix URL.
  parseWixMaster(masterUrl) {
    var m = masterUrl.match(
      /^(https?:\/\/repackager\.wixmp\.com\/.+\/video\/[^/]+)\/,([^/]+),\/mp4\/file\.mp4\.urlset\/master\.m3u8/
    );
    if (!m) return null;
    var base  = m[1];
    var quals = m[2].split(",").filter(function(q) { return q.length > 0; });
    if (quals.length === 0) return null;
    // Sort by resolution height descending (1080 > 720 > 480)
    quals.sort(function(a, b) { return (parseInt(b) || 0) - (parseInt(a) || 0); });
    return quals.map(function(q) {
      return { url: base + "/" + q + "/mp4/file.mp4/index-v1-a1.m3u8", label: q };
    });
  }

  // ── Streaming ───────────────────────────────────────────────────────────────
  async getVideoList(url) {
    // Chapter URL formats:
    //   "{showId}|{epNum}"           current (v0.0.7+) — e.g. "wbnpCxPu3fyk9XSaZ|1"
    //   "allanime:{showId}:{epNum}"  legacy v0.0.6
    //   "stub|..."                   fallback stub — no streaming
    //   "{digits}|{epNum}"           legacy v0.0.5 stub — no streaming

    if (!url || url.startsWith("stub|")) return [];

    var showId, epNum;

    if (url.startsWith("allanime:")) {
      // Legacy v0.0.6 format — re-parse to recover showId/epNum
      var c1 = url.indexOf(":");
      var c2 = url.indexOf(":", c1 + 1);
      if (c1 < 0 || c2 < 0) return [];
      showId = url.substring(c1 + 1, c2);
      epNum  = url.substring(c2 + 1);
    } else {
      var pipe = url.indexOf("|");
      if (pipe < 0) return [];
      showId = url.substring(0, pipe);
      epNum  = url.substring(pipe + 1);
      // Legacy v0.0.5: showId was the numeric AniList ID — can't stream
      if (/^\d+$/.test(showId)) return [];
    }

    var episodeId = "allanime:" + showId + ":" + epNum;

    // Read preferred language — sub is default
    var pref = "sub";
    try { pref = new SharedPreferences().get("myronix_pref_lang") || "sub"; } catch (e) {}

    // Collect sub and dub streams separately so we can order them by preference
    var subStreams = [];
    var dubStreams = [];
    var seen       = {};
    var categories = ["sub", "dub"];

    for (var ci = 0; ci < categories.length; ci++) {
      var category = categories[ci];
      var bucket   = category === "sub" ? subStreams : dubStreams;
      try {
        // Server "Default" → Wix CDN (publicly accessible).
        // Server "Ok" uses signed, IP-bound okcdn.ru URLs that only work from
        // the MyroniX server's IP — skip it.
        var apiUrl = this.source.baseUrl + "/api/v2/allanime/episode/sources" +
          "?animeEpisodeId=" + encodeURIComponent(episodeId) +
          "&server=Default" +
          "&category=" + category;

        var res = await this.client.get(apiUrl, this.getHeaders);
        if (res.statusCode !== 200) continue;
        var json = JSON.parse(res.body);
        if (!json.data || !json.data.sources) continue;

        // The API returns the exact CDN headers we should forward with stream requests
        var apiHdr = json.data.headers || {};
        var streamHeaders = {
          "User-Agent": apiHdr["User-Agent"] || this.ua,
          "Referer":    apiHdr["Referer"]    || (this.source.baseUrl + "/"),
        };
        if (apiHdr["Origin"]) streamHeaders["Origin"] = apiHdr["Origin"];

        // Subtitle tracks
        var subtitles = [];
        var tracks = json.data.tracks || [];
        for (var ti = 0; ti < tracks.length; ti++) {
          var t = tracks[ti];
          if (t && t.file) subtitles.push({ file: t.file, label: t.label || "Unknown" });
        }

        var sources = json.data.sources;
        for (var k = 0; k < sources.length; k++) {
          var src    = sources[k];
          var srcUrl = src && src.url;
          if (!srcUrl) continue;

          if (srcUrl.indexOf(".m3u8") >= 0) {
            // For Wix CDN masters, decode quality variants directly from the URL —
            // no extra HTTP request, no chance of a CDN fetch failure.
            var variants = this.parseWixMaster(srcUrl);
            if (variants && variants.length > 0) {
              for (var vi = 0; vi < variants.length; vi++) {
                var v   = variants[vi];
                var vk  = v.url + "|" + category;
                if (seen[vk]) continue;
                seen[vk] = true;
                bucket.push({
                  url: v.url, originalUrl: srcUrl,
                  quality: v.label + " [" + category.toUpperCase() + "]",
                  headers: streamHeaders, subtitles: subtitles,
                });
              }
            } else {
              // Non-Wix HLS master — pass through and let the player handle it
              var mk = srcUrl + "|" + category;
              if (!seen[mk]) {
                seen[mk] = true;
                bucket.push({
                  url: srcUrl, originalUrl: srcUrl,
                  quality: "HLS [" + category.toUpperCase() + "]",
                  headers: streamHeaders, subtitles: subtitles,
                });
              }
            }
          } else {
            // Direct video URL (MP4, etc.)
            var dk = srcUrl + "|" + category;
            if (!seen[dk]) {
              seen[dk] = true;
              bucket.push({
                url: srcUrl, originalUrl: srcUrl,
                quality: (src.quality || "Auto") + " [" + category.toUpperCase() + "]",
                headers: streamHeaders, subtitles: subtitles,
              });
            }
          }
        }
      } catch (e) { /* skip on any error */ }
    }

    // Return preferred language first
    return pref === "dub"
      ? dubStreams.concat(subStreams)
      : subStreams.concat(dubStreams);
  }

  getFilterList() { return []; }

  getSourcePreferences() {
    return [
      {
        key: "myronix_pref_lang",
        listPreference: {
          title: "Preferred language",
          summary: "Which audio appears first in the stream list",
          valueIndex: 0,
          entries: ["Sub", "Dub"],
          entryValues: ["sub", "dub"],
        },
      },
    ];
  }
}
