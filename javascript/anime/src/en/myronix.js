const mangayomiSources = [
  {
    "name": "MyroniX",
    "id": 347219856,
    "lang": "en",
    "baseUrl": "https://myronix.strangled.net",
    "iconUrl": "https://myronix.strangled.net/images/axolotl.png",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.2.0",
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
    try {
      var data = await this.gql(PAGE_MEDIA_QUERY, { page: page, perPage: 24, search: query, sort: ["SEARCH_MATCH"] });
      var p = (data && data.Page) || {};
      return { list: this.parseMedia(p.media), hasNextPage: (p.pageInfo && p.pageInfo.hasNextPage) || false };
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

  async getDetail(url) {
    var anilistId = parseInt(url.replace(/[^0-9]/g, ""), 10);
    if (!anilistId) throw new Error("Cannot parse AniList ID from: " + url);

    // Fire AniList metadata + AllAnime episode list simultaneously
    var epUrl = this.source.baseUrl + "/api/v2/allanime/episodes/" +
      anilistId + "?provider=anilist&mode=sub";
    var parallel = await Promise.all([
      this.gql(MEDIA_DETAIL_QUERY, { id: anilistId }),
      this.client.get(epUrl, this.getHeaders).catch(function() { return null; }),
    ]);

    var data = parallel[0];
    var epRes = parallel[1];
    var m = (data && data.Media) || {};

    var name      = (m.title && (m.title.english || m.title.romaji)) || "";
    var imageUrl  = (m.coverImage && (m.coverImage.large || m.coverImage.medium)) || "";
    var description = (m.description || "").replace(/<[^>]*>/g, "").replace(/\n+/g, "\n").trim();
    var genre     = m.genres || [];
    var status    = this.statusCode(m.status);
    var epCount   = m.episodes || 0;

    // Fetch episode list from the site's AllAnime API.
    // Chapter URL = "{showId}|{epNum}" — pipe-separated, no URL-scheme prefix.
    // AllAnime maps multiple internal show records to the same AniList ID.
    // The record that appears FIRST in the API response is the primary streaming
    // record (has Default/Wix CDN sources). Later records may have episode titles
    // but different CDN arrangements that don't work for us.
    // Strategy:
    //   1. Use the FIRST showId seen for chapter URLs (guarantees streaming works).
    //   2. Build a titleMap across ALL records so we still get episode titles
    //      even when the primary record has none.
    var chapters = [];
    try {
      if (epRes && epRes.statusCode === 200) {
        var epJson = JSON.parse(epRes.body);
        var episodes = (epJson.data && epJson.data.episodes) || [];

        var primaryShowId = null;   // first showId encountered = streaming record
        var primaryEps    = [];     // episodes belonging to the primary show
        var titleMap      = {};     // epNum → best title from any show record

        for (var i = 0; i < episodes.length; i++) {
          var ep    = episodes[i];
          var rawId = ep.episodeId || "";
          var c1    = rawId.indexOf(":");
          var c2    = rawId.indexOf(":", c1 + 1);
          if (c1 < 0 || c2 < 0) continue;
          var sid   = rawId.substring(c1 + 1, c2);
          var epNum = rawId.substring(c2 + 1);

          if (!primaryShowId) primaryShowId = sid;
          if (sid === primaryShowId) primaryEps.push(ep);

          var t = (ep.title || "").trim();
          if (t && !titleMap[epNum]) titleMap[epNum] = t;
        }

        primaryEps.sort(function(a, b) {
          return (parseFloat(a.number) || 0) - (parseFloat(b.number) || 0);
        });

        for (var ei = 0; ei < primaryEps.length; ei++) {
          var ep    = primaryEps[ei];
          var rawId = ep.episodeId || "";
          var c1    = rawId.indexOf(":");
          var c2    = rawId.indexOf(":", c1 + 1);
          if (c1 < 0 || c2 < 0) continue;
          var epNum    = rawId.substring(c2 + 1);
          var numStr   = (ep.number !== undefined && ep.number !== null)
            ? String(ep.number) : epNum;
          var epTitle  = titleMap[epNum] || "";
          var fallback = "Episode " + numStr;
          var label    = (epTitle && epTitle !== fallback)
            ? "E" + numStr + ": " + epTitle : fallback;
          chapters.push({ name: label, url: primaryShowId + "|" + epNum });
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

    // Fetch sub and dub sources in parallel — cuts load time roughly in half
    // compared to sequential awaits.
    var SERVERS = ["Default", "Luf-mp4", "Mp4"];
    var self = this;

    var fetchServer = function(category, server) {
      var apiUrl = self.source.baseUrl + "/api/v2/allanime/episode/sources" +
        "?animeEpisodeId=" + encodeURIComponent(episodeId) +
        "&server=" + encodeURIComponent(server) +
        "&category=" + category;
      return self.client.get(apiUrl, self.getHeaders)
        .then(function(res) {
          if (res.statusCode !== 200) return null;
          var json = JSON.parse(res.body);
          var d = json.data;
          return (d && d.sources && d.sources.length > 0) ? d : null;
        })
        .catch(function() { return null; });
    };

    var fetchCategory = function(category) {
      return Promise.all(SERVERS.map(function(srv) {
        return fetchServer(category, srv);
      })).then(function(serverResults) {
        for (var sri = 0; sri < serverResults.length; sri++) {
          if (serverResults[sri]) return { category: category, data: serverResults[sri] };
        }
        return { category: category, data: null };
      });
    };

    var results = await Promise.all([fetchCategory("sub"), fetchCategory("dub")]);

    var subStreams = [];
    var dubStreams = [];
    var seen = {};

    for (var ri = 0; ri < results.length; ri++) {
      var result   = results[ri];
      var category = result.category;
      var data     = result.data;
      var bucket   = category === "sub" ? subStreams : dubStreams;

      if (!data || !data.sources) continue;

      // Use CDN headers returned by the API
      var apiHdr = data.headers || {};
      var streamHeaders = {
        "User-Agent": apiHdr["User-Agent"] || this.ua,
        "Referer":    apiHdr["Referer"]    || (this.source.baseUrl + "/"),
      };
      if (apiHdr["Origin"]) streamHeaders["Origin"] = apiHdr["Origin"];

      // Subtitle tracks
      var subtitles = [];
      var tracks = data.tracks || [];
      for (var ti = 0; ti < tracks.length; ti++) {
        var t = tracks[ti];
        if (t && t.file) subtitles.push({ file: t.file, label: t.label || "Unknown" });
      }

      var sources = data.sources;
      for (var k = 0; k < sources.length; k++) {
        var src    = sources[k];
        var srcUrl = src && src.url;
        if (!srcUrl) continue;

        if (srcUrl.indexOf(".m3u8") >= 0) {
          // Wix CDN: extract quality variants directly from the URL — no extra request
          var variants = this.parseWixMaster(srcUrl);
          if (variants && variants.length > 0) {
            for (var vi = 0; vi < variants.length; vi++) {
              var v  = variants[vi];
              var vk = v.url + "|" + category;
              if (seen[vk]) continue;
              seen[vk] = true;
              bucket.push({
                url: v.url, originalUrl: srcUrl,
                quality: v.label + " [" + category.toUpperCase() + "]",
                headers: streamHeaders, subtitles: subtitles,
              });
            }
          } else {
            // Non-Wix HLS — pass master URL through
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
          // Direct MP4 or other
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
