const mangayomiSources = [
  {
    "name": "MyroniX",
    "id": 347219856,
    "lang": "en",
    "baseUrl": "https://myronix.strangled.net",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://myronix.strangled.net",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.0.5",
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

// Compact query used for all list/search pages (matches exact query in HAR)
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
  // Body must be a plain object — the Mangayomi client serialises it to JSON internally.
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
    // url is a bare AniList ID ("16498") or a full detail URL ending in the ID
    var anilistId = parseInt(url.replace(/[^0-9]/g, ""), 10);
    if (!anilistId) throw new Error("Cannot parse AniList ID from: " + url);

    var data = await this.gql(MEDIA_DETAIL_QUERY, { id: anilistId });
    var m = (data && data.Media) || {};

    var name = (m.title && (m.title.english || m.title.romaji)) || "";
    var imageUrl = (m.coverImage && (m.coverImage.large || m.coverImage.medium)) || "";
    var description = (m.description || "").replace(/<[^>]*>/g, "").replace(/\n+/g, "\n").trim();
    var genre = m.genres || [];
    var status = this.statusCode(m.status);
    var epCount = m.episodes || 0;

    // Build episode list from AniList episode count
    var chapters = [];
    for (var i = 1; i <= epCount; i++) {
      chapters.push({
        name: "Episode " + i,
        // encode: anilistId|episodeNumber for getVideoList
        url: anilistId + "|" + i,
      });
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
    // url format: "{anilistId}|{episodeNumber}"
    // The site proxies streaming through the aniwatch-api backend.
    // A second HAR captured from a /watch page is needed to confirm the exact
    // streaming endpoint and ID-mapping strategy. Returning empty for now so
    // the catalog and detail views work while streaming is investigated.
    return [];
  }

  getFilterList() {
    return [];
  }

  getSourcePreferences() {
    return [];
  }
}
