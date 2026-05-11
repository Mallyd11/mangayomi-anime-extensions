const mangayomiSources = [
  {
    "name": "MyroniX",
    "id": 347219856,
    "lang": "en",
    "baseUrl": "https://myronix.strangled.net",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://myronix.strangled.net",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.0.6",
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

// Compact query used for all list/search pages
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

// Compact query for single-anime detail by AniList ID
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

  get gqlHeaders() {
    return {
      "User-Agent": this.ua,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Origin": this.source.baseUrl,
      "Referer": this.source.baseUrl + "/",
    };
  }

  // POST to the site's AniList GraphQL proxy and return json.data
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

  // Fetch AllAnime episode list for an AniList ID.
  // Returns [{number, episodeId, title}, ...] or [] on failure.
  async fetchAllanimeEpisodes(anilistId) {
    try {
      var url = this.source.baseUrl + "/api/v2/allanime/episodes/" +
        anilistId + "?provider=anilist&mode=sub";
      var res = await this.client.get(url, this.gqlHeaders);
      if (res.statusCode !== 200) return [];
      var json = JSON.parse(res.body);
      return (json.data && json.data.episodes) || [];
    } catch (e) {
      return [];
    }
  }

  // Fetch stream sources from AllAnime for one episode + server + category.
  // Returns the sources array or [] on failure/no data.
  async fetchAllanimeSource(episodeId, server, category) {
    try {
      var url = this.source.baseUrl + "/api/v2/allanime/episode/sources" +
        "?animeEpisodeId=" + encodeURIComponent(episodeId) +
        "&server=" + server +
        "&category=" + category;
      var res = await this.client.get(url, this.gqlHeaders);
      if (res.statusCode !== 200) return { sources: [], tracks: [], headers: {} };
      var json = JSON.parse(res.body);
      return json.data || { sources: [], tracks: [], headers: {} };
    } catch (e) {
      return { sources: [], tracks: [], headers: {} };
    }
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
      page: page,
      perPage: 24,
      sort: ["POPULARITY_DESC"],
    });
    var p = (data && data.Page) || {};
    return {
      list: this.parseMedia(p.media),
      hasNextPage: (p.pageInfo && p.pageInfo.hasNextPage) || false,
    };
  }

  async getLatestUpdates(page) {
    var data = await this.gql(PAGE_MEDIA_QUERY, {
      page: page,
      perPage: 24,
      sort: ["UPDATED_AT_DESC"],
    });
    var p = (data && data.Page) || {};
    return {
      list: this.parseMedia(p.media),
      hasNextPage: (p.pageInfo && p.pageInfo.hasNextPage) || false,
    };
  }

  async search(query, page, filters) {
    var data = await this.gql(PAGE_MEDIA_QUERY, {
      page: page,
      perPage: 24,
      search: query,
      sort: ["SEARCH_MATCH"],
    });
    var p = (data && data.Page) || {};
    return {
      list: this.parseMedia(p.media),
      hasNextPage: (p.pageInfo && p.pageInfo.hasNextPage) || false,
    };
  }

  // AniList status → Mangayomi status code
  statusCode(s) {
    switch ((s || "").toUpperCase()) {
      case "RELEASING":         return 0;
      case "FINISHED":          return 1;
      case "NOT_YET_RELEASED":  return 4;
      case "CANCELLED":         return 5;
      default:                  return 5;
    }
  }

  async getDetail(url) {
    // url is a bare AniList ID ("16498") or a full URL ending in the ID
    var anilistId = parseInt(url.replace(/[^0-9]/g, ""), 10);
    if (!anilistId) throw new Error("Cannot parse AniList ID from: " + url);

    // ── AniList metadata ─────────────────────────────────────────────────────
    var data = await this.gql(MEDIA_DETAIL_QUERY, { id: anilistId });
    var m = (data && data.Media) || {};

    var name = (m.title && (m.title.english || m.title.romaji)) || "";
    var imageUrl = (m.coverImage && (m.coverImage.large || m.coverImage.medium)) || "";
    var description = (m.description || "").replace(/<[^>]*>/g, "").replace(/\n+/g, "\n").trim();
    var genre = m.genres || [];
    var status = this.statusCode(m.status);
    var epCount = m.episodes || 0;

    // ── Episode list from AllAnime ───────────────────────────────────────────
    var chapters = [];
    var episodes = await this.fetchAllanimeEpisodes(anilistId);

    if (episodes.length > 0) {
      // AllAnime episode IDs are the authoritative chapter URLs:
      // format "allanime:{showId}:{epNum}" — getVideoList uses these directly.
      for (var i = 0; i < episodes.length; i++) {
        var ep = episodes[i];
        chapters.push({
          name: ep.title || ("Episode " + ep.number),
          url: ep.episodeId,
        });
      }
    } else {
      // Fallback: build stub episodes from AniList count
      for (var j = 1; j <= epCount; j++) {
        chapters.push({
          name: "Episode " + j,
          url: anilistId + "|" + j,
        });
      }
    }

    // Reverse so newest episode is at the top (Mangayomi convention)
    chapters.reverse();

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
    // url is "allanime:{showId}:{epNum}" (from AllAnime episodes API)
    // Legacy fallback stub URLs like "{anilistId}|{epNum}" are not streamable.
    if (!url.startsWith("allanime:")) {
      return [];
    }

    var streams = [];
    var seen = {};

    // Try the two available servers with both sub and dub.
    // The API deduplicates on the CDN side; we dedup by URL here to avoid
    // surfacing identical links with different labels.
    var servers = ["hd-1", "hd-2"];
    var categories = ["sub", "dub"];

    for (var si = 0; si < servers.length; si++) {
      for (var ci = 0; ci < categories.length; ci++) {
        var server = servers[si];
        var category = categories[ci];

        var result = await this.fetchAllanimeSource(url, server, category);
        if (!result.sources || !result.sources.length) continue;

        // Build subtitles list from tracks (if any)
        var subtitles = [];
        if (result.tracks && result.tracks.length) {
          for (var ti = 0; ti < result.tracks.length; ti++) {
            var track = result.tracks[ti];
            if (track && track.file) {
              subtitles.push({ file: track.file, label: track.label || "Unknown" });
            }
          }
        }

        // Merge any extra CDN headers returned by the API
        var streamHeaders = {
          "User-Agent": this.ua,
          "Referer": this.source.baseUrl + "/",
        };
        if (result.headers) {
          var extraKeys = Object.keys(result.headers);
          for (var hk = 0; hk < extraKeys.length; hk++) {
            streamHeaders[extraKeys[hk]] = result.headers[extraKeys[hk]];
          }
        }

        for (var k = 0; k < result.sources.length; k++) {
          var src = result.sources[k];
          var srcUrl = src.url;
          if (!srcUrl) continue;
          // Dedup by URL so identical CDN links from different servers only appear once
          var dedupeKey = srcUrl + "|" + category;
          if (seen[dedupeKey]) continue;
          seen[dedupeKey] = true;

          var qualLabel = (src.quality || "Auto") + " [" + category.toUpperCase() + "]";
          streams.push({
            url: srcUrl,
            originalUrl: srcUrl,
            quality: qualLabel,
            headers: streamHeaders,
            subtitles: subtitles,
          });
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
