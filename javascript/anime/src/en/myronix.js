const mangayomiSources = [
  {
    "name": "MyroniX",
    "id": 347219856,
    "lang": "en",
    "baseUrl": "https://myronix.strangled.net",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://myronix.strangled.net",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.0.8",
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

  // Headers for plain GET requests to this site's API
  get getHeaders() {
    return {
      "User-Agent": this.ua,
      "Accept": "application/json",
      "Referer": this.source.baseUrl + "/",
    };
  }

  // POST directly to AniList's public GraphQL endpoint.
  // Using AniList directly (not the site's /api/v2/anilist/graphql proxy)
  // avoids the proxy's rate-limiting (HTTP 429).
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

    // ── Episode list from the site's AllAnime API ───────────────────────────
    // GET /api/v2/allanime/episodes/{anilistId}?provider=anilist&mode=sub
    // Returns: { data: { episodes: [{ number, episodeId: "allanime:{showId}:{epNum}", title }] } }
    //
    // Chapter URL is stored as "{showId}|{epNum}" (pipe-separated) so that
    // Mangayomi never tries to parse "allanime:" as a URL scheme.
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
          // Parse "allanime:{showId}:{epNum}" → showId + epNum
          var rawId = ep.episodeId || "";
          var c1 = rawId.indexOf(":");       // position of first colon (after "allanime")
          var c2 = rawId.indexOf(":", c1 + 1); // position of second colon (after showId)
          if (c1 < 0 || c2 < 0) continue;
          var showId = rawId.substring(c1 + 1, c2);
          var epNum  = rawId.substring(c2 + 1);
          chapters.push({
            name: ep.title || ("Episode " + ep.number),
            url: showId + "|" + epNum,
          });
        }
      }
    } catch (e) {
      // Ignore; fall through to AniList-count fallback
    }

    // Fallback: generate stub episodes from AniList episode count
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

  // Fetch a HLS playlist and classify it.
  // Returns:
  //   { kind: "master",  variants: [{url, label}, ...] }
  //   { kind: "flat" }          — already a segment playlist, use URL as-is
  //   { kind: "fetch-failed" }  — network error or empty body
  //   { kind: "empty-master" }  — master with no parseable variants
  async resolveHls(playlistUrl, headers) {
    try {
      var res = await this.client.get(playlistUrl, headers);
      if (!res || !res.body) return { kind: "fetch-failed" };
      var body = res.body;

      var hasStream = body.indexOf("#EXT-X-STREAM-INF") >= 0;
      var hasSegs   = body.indexOf("#EXTINF")           >= 0;

      // Flat playlist: has segment markers but no variant list
      if (hasSegs && !hasStream) return { kind: "flat" };
      // Not an HLS master at all (e.g. redirect HTML)
      if (!hasStream) return { kind: "empty-master" };

      // Master playlist: parse every variant stream
      var baseDir = playlistUrl.substring(0, playlistUrl.lastIndexOf("/") + 1);
      var variants = [];
      var lines = body.split("\n");
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.indexOf("#EXT-X-STREAM-INF:") !== 0) continue;
        var resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/);
        var bwMatch  = line.match(/BANDWIDTH=(\d+)/);
        var label = resMatch
          ? resMatch[2] + "p"
          : (bwMatch ? Math.round(parseInt(bwMatch[1]) / 1000) + "kbps" : "Auto");
        // Next non-empty, non-comment line is the variant URL
        for (var j = i + 1; j < lines.length; j++) {
          var u = lines[j].trim();
          if (!u || u.charAt(0) === "#") continue;
          variants.push({
            url: u.indexOf("http") === 0 ? u : baseDir + u,
            label: label,
          });
          break;
        }
      }

      if (variants.length === 0) return { kind: "empty-master" };

      // Sort highest quality first
      variants.sort(function(a, b) {
        return (parseInt(b.label) || 0) - (parseInt(a.label) || 0);
      });
      return { kind: "master", variants: variants };
    } catch (e) {
      return { kind: "fetch-failed" };
    }
  }

  async getVideoList(url) {
    // Chapter URL: "{showId}|{epNum}"  e.g. "wbnpCxPu3fyk9XSaZ|1"
    // Stub URLs:   "stub|{anilistId}|{epNum}" — no streaming available
    if (!url || url.startsWith("stub|")) return [];

    var pipeIdx = url.indexOf("|");
    if (pipeIdx < 0) return [];
    var showId = url.substring(0, pipeIdx);
    var epNum  = url.substring(pipeIdx + 1);
    // Reconstruct the AllAnime episode ID for the API
    var episodeId = "allanime:" + showId + ":" + epNum;

    var streams = [];
    var seen = {};
    var servers    = ["hd-1", "hd-2"];
    var categories = ["sub", "dub"];

    for (var si = 0; si < servers.length; si++) {
      for (var ci = 0; ci < categories.length; ci++) {
        var server   = servers[si];
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

          // Subtitle tracks
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
            var src    = sources[k];
            var srcUrl = src && src.url;
            if (!srcUrl) continue;

            if (srcUrl.indexOf(".m3u8") >= 0) {
              // HLS: resolve master → emit one stream per quality variant.
              // Mangayomi's player needs a flat (segment-level) playlist,
              // not a master. Wix CDN serves a master with 1080p/720p/480p.
              var resolved = await this.resolveHls(srcUrl, streamHeaders);
              if (resolved.kind === "master") {
                for (var vi = 0; vi < resolved.variants.length; vi++) {
                  var variant = resolved.variants[vi];
                  var vKey = variant.url + "|" + category;
                  if (seen[vKey]) continue;
                  seen[vKey] = true;
                  streams.push({
                    url: variant.url,
                    originalUrl: srcUrl,
                    quality: variant.label + " [" + category.toUpperCase() + "]",
                    headers: streamHeaders,
                    subtitles: subtitles,
                  });
                }
              } else if (resolved.kind === "flat") {
                var fKey = srcUrl + "|" + category;
                if (!seen[fKey]) {
                  seen[fKey] = true;
                  streams.push({
                    url: srcUrl,
                    originalUrl: srcUrl,
                    quality: "HLS [" + category.toUpperCase() + "]",
                    headers: streamHeaders,
                    subtitles: subtitles,
                  });
                }
              }
              // "empty-master" or "fetch-failed" → skip to avoid a broken stream
            } else {
              // Direct MP4 or other non-HLS
              var dKey = srcUrl + "|" + category;
              if (!seen[dKey]) {
                seen[dKey] = true;
                streams.push({
                  url: srcUrl,
                  originalUrl: srcUrl,
                  quality: (src.quality || "Auto") + " [" + category.toUpperCase() + "]",
                  headers: streamHeaders,
                  subtitles: subtitles,
                });
              }
            }
          }
        } catch (e) {
          // Skip this server/category on any error; try next combo
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
