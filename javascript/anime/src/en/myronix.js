const mangayomiSources = [
  {
    "name": "MyroniX",
    "id": 347219856,
    "lang": "en",
    "baseUrl": "https://myronix.strangled.net",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://myronix.strangled.net",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.0.7",
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

  // Headers for POST GraphQL requests
  get gqlHeaders() {
    return {
      "User-Agent": this.ua,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Origin": this.source.baseUrl,
      "Referer": this.source.baseUrl + "/",
    };
  }

  // Lightweight headers for plain GET API requests
  get getHeaders() {
    return {
      "User-Agent": this.ua,
      "Accept": "application/json",
      "Referer": this.source.baseUrl + "/",
    };
  }

  // POST to the AniList GraphQL proxy
  async gql(query, variables) {
    var res = await this.client.post(
      this.source.baseUrl + "/api/v2/anilist/graphql",
      this.gqlHeaders,
      { query: query, variables: variables }
    );
    if (res.statusCode !== 200) throw new Error("HTTP " + res.statusCode);
    var json = JSON.parse(res.body);
    if (json.errors && json.errors.length) throw new Error(json.errors[0].message);
    return json.data;
  }

  // Map AniList media objects → Mangayomi list items
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

  get supportsLatest() {
    return true;
  }

  async getPopular(page) {
    var data = await this.gql(PAGE_MEDIA_QUERY, {
      page: page, perPage: 24, sort: ["POPULARITY_DESC"],
    });
    var p = (data && data.Page) || {};
    return {
      list: this.parseMedia(p.media),
      hasNextPage: (p.pageInfo && p.pageInfo.hasNextPage) || false,
    };
  }

  async getLatestUpdates(page) {
    var data = await this.gql(PAGE_MEDIA_QUERY, {
      page: page, perPage: 24, sort: ["UPDATED_AT_DESC"],
    });
    var p = (data && data.Page) || {};
    return {
      list: this.parseMedia(p.media),
      hasNextPage: (p.pageInfo && p.pageInfo.hasNextPage) || false,
    };
  }

  async search(query, page, filters) {
    var data = await this.gql(PAGE_MEDIA_QUERY, {
      page: page, perPage: 24, search: query, sort: ["SEARCH_MATCH"],
    });
    var p = (data && data.Page) || {};
    return {
      list: this.parseMedia(p.media),
      hasNextPage: (p.pageInfo && p.pageInfo.hasNextPage) || false,
    };
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

    // ── AniList metadata ────────────────────────────────────────────────────
    var data = await this.gql(MEDIA_DETAIL_QUERY, { id: anilistId });
    var m = (data && data.Media) || {};

    var name = (m.title && (m.title.english || m.title.romaji)) || "";
    var imageUrl = (m.coverImage && (m.coverImage.large || m.coverImage.medium)) || "";
    var description = (m.description || "").replace(/<[^>]*>/g, "").replace(/\n+/g, "\n").trim();
    var genre = m.genres || [];
    var status = this.statusCode(m.status);
    var epCount = m.episodes || 0;

    // ── Episode list from AllAnime ──────────────────────────────────────────
    // Endpoint: GET /api/v2/allanime/episodes/{anilistId}?provider=anilist&mode=sub
    // Returns: { data: { episodes: [{ number, episodeId: "allanime:{showId}:{epNum}", title }] } }
    //
    // Chapter URL format: "{showId}|{epNum}"  (pipe-separated, no colons)
    // This avoids Mangayomi treating "allanime:" as a URL scheme.
    // getVideoList reconstructs the full AllAnime ID before calling the API.
    var chapters = [];
    try {
      var epUrl = this.source.baseUrl + "/api/v2/allanime/episodes/" +
        anilistId + "?provider=anilist&mode=sub";
      var epRes = await this.client.get(epUrl, this.getHeaders);
      if (epRes.statusCode === 200) {
        var epJson = JSON.parse(epRes.body);
        var episodes = (epJson.data && epJson.data.episodes) || [];
        for (var i = 0; i < episodes.length; i++) {
          var ep = episodes[i];
          // Parse "allanime:{showId}:{epNum}" → showId, epNum
          // The episodeId always has exactly 2 colons after "allanime:"
          var rawId = ep.episodeId || "";          // rawId = "allanime:wbnpCxPu3fyk9XSaZ:1"
          var firstColon = rawId.indexOf(":");     // 8  (after "allanime")
          var secondColon = rawId.indexOf(":", firstColon + 1); // after showId
          if (firstColon < 0 || secondColon < 0) continue;
          var showId = rawId.substring(firstColon + 1, secondColon); // "wbnpCxPu3fyk9XSaZ"
          var epNum  = rawId.substring(secondColon + 1);             // "1"
          chapters.push({
            name: ep.title || ("Episode " + ep.number),
            url: showId + "|" + epNum,  // "wbnpCxPu3fyk9XSaZ|1"
          });
        }
      }
    } catch (e) {
      // Fall through to AniList fallback
    }

    // Fallback: generate stub episodes from AniList count when AllAnime fails
    if (chapters.length === 0 && epCount > 0) {
      for (var j = 1; j <= epCount; j++) {
        chapters.push({ name: "Episode " + j, url: "stub|" + anilistId + "|" + j });
      }
    }

    chapters.reverse(); // newest first (Mangayomi convention)

    return {
      name: name,
      imageUrl: imageUrl,
      description: description,
      genre: genre,
      status: status,
      link: this.source.baseUrl + "/anime/" + anilistId,
      chapters: chapters,
    };
  }

  async getVideoList(url) {
    // Chapter URL formats:
    //   "{showId}|{epNum}"           — AllAnime episode (e.g. "wbnpCxPu3fyk9XSaZ|1")
    //   "stub|{anilistId}|{epNum}"   — AniList fallback, cannot stream
    if (!url || url.startsWith("stub|")) return [];

    var pipeIdx = url.indexOf("|");
    if (pipeIdx < 0) return [];

    var showId = url.substring(0, pipeIdx);
    var epNum  = url.substring(pipeIdx + 1);
    // Reconstruct the full AllAnime episode ID for the API call
    var episodeId = "allanime:" + showId + ":" + epNum;

    var streams = [];
    var seen = {};

    var servers = ["hd-1", "hd-2"];
    var categories = ["sub", "dub"];

    for (var si = 0; si < servers.length; si++) {
      for (var ci = 0; ci < categories.length; ci++) {
        var server = servers[si];
        var category = categories[ci];
        try {
          var apiUrl = this.source.baseUrl + "/api/v2/allanime/episode/sources" +
            "?animeEpisodeId=" + encodeURIComponent(episodeId) +
            "&server=" + server +
            "&category=" + category;
          var res = await this.client.get(apiUrl, this.getHeaders);
          if (res.statusCode !== 200) continue;
          var json = JSON.parse(res.body);
          if (!json.data || !json.data.sources) continue;

          // Subtitle tracks (optional)
          var subtitles = [];
          var tracks = json.data.tracks || [];
          for (var ti = 0; ti < tracks.length; ti++) {
            var track = tracks[ti];
            if (track && track.file) {
              subtitles.push({ file: track.file, label: track.label || "Unknown" });
            }
          }

          var streamHeaders = {
            "User-Agent": this.ua,
            "Referer": this.source.baseUrl + "/",
          };

          var sources = json.data.sources;
          for (var k = 0; k < sources.length; k++) {
            var src = sources[k];
            var srcUrl = src && src.url;
            if (!srcUrl) continue;
            // Dedup: same URL can come from both hd-1 and hd-2
            var dedupeKey = srcUrl + "|" + category;
            if (seen[dedupeKey]) continue;
            seen[dedupeKey] = true;

            streams.push({
              url: srcUrl,
              originalUrl: srcUrl,
              quality: (src.quality || "Auto") + " [" + category.toUpperCase() + "]",
              headers: streamHeaders,
              subtitles: subtitles,
            });
          }
        } catch (e) {
          // skip this server/category combination on any error
        }
      }
    }

    return streams;
  }

  getFilterList() {
    return [];
  }

  getSourcePreferences() {
    return [];
  }
}
