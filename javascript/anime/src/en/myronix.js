const mangayomiSources = [
  {
    "name": "MyroniX",
    "id": 347219856,
    "lang": "en",
    "baseUrl": "https://myronix.strangled.net",
    "iconUrl": "https://myronix.strangled.net/images/axolotl.png",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.2.3",
    "pkgPath": "anime/src/en/myronix.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": false,
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

    // Fetch episode list from the site's AllAnime API (for episode numbers/titles).
    // Chapter URL = "{anilistId}|{epNum}" — the HiAnime streaming API only needs
    // these two values; no AllAnime showId required.
    var chapters = [];
    try {
      if (epRes && epRes.statusCode === 200) {
        var epJson = JSON.parse(epRes.body);
        var episodes = (epJson.data && epJson.data.episodes) || [];

        var seenEpNums = {};
        var titleMap   = {};  // epNum → title

        for (var i = 0; i < episodes.length; i++) {
          var ep    = episodes[i];
          var rawId = ep.episodeId || "";
          var c2    = rawId.lastIndexOf(":");
          if (c2 < 0) continue;
          var epNum = rawId.substring(c2 + 1);
          var t = (ep.title || "").trim();
          if (t && !titleMap[epNum]) titleMap[epNum] = t;
          seenEpNums[epNum] = ep;
        }

        var epNumsSorted = Object.keys(seenEpNums).sort(function(a, b) {
          return (parseFloat(a) || 0) - (parseFloat(b) || 0);
        });

        for (var ei = 0; ei < epNumsSorted.length; ei++) {
          var epNum   = epNumsSorted[ei];
          var ep      = seenEpNums[epNum];
          var numStr  = (ep.number !== undefined && ep.number !== null)
            ? String(ep.number) : epNum;
          var epTitle = titleMap[epNum] || "";
          var fallback = "Episode " + numStr;
          var label   = (epTitle && epTitle !== fallback)
            ? "E" + numStr + ": " + epTitle : fallback;
          chapters.push({ name: label, url: String(anilistId) + "|" + epNum });
        }
      }
    } catch (e) { /* fall through */ }

    // Fallback when AllAnime returns no episodes — HiAnime can still stream
    if (chapters.length === 0 && epCount > 0) {
      for (var j = 1; j <= epCount; j++) {
        chapters.push({ name: "Episode " + j, url: String(anilistId) + "|" + j });
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

  // ── Streaming ───────────────────────────────────────────────────────────────
  async getVideoList(url) {
    // Chapter URL format (v0.2.3+): "{anilistId}|{epNum}" e.g. "16498|1"
    // Old formats (pre v0.2.3) used AllAnime showIds — refresh the show to update.

    if (!url || url.startsWith("stub|") || url.startsWith("allanime:")) return [];

    var pipe = url.indexOf("|");
    if (pipe < 0) return [];
    var idPart = url.substring(0, pipe);
    var epNum  = url.substring(pipe + 1);

    // Old format had alphanumeric showIds before the pipe; new format is pure digits.
    if (!/^\d+$/.test(idPart)) return [];
    var anilistId = idPart;

    var pref = "sub";
    try { pref = new SharedPreferences().get("myronix_pref_lang") || "sub"; } catch (e) {}

    var self    = this;
    var baseUrl = this.source.baseUrl;

    var fetchCategory = function(category) {
      var serversUrl = baseUrl + "/api/v2/shirayuki/hianime/episode/servers" +
        "?animeEpisodeId=" + encodeURIComponent(anilistId) +
        "&ep=" + encodeURIComponent(epNum) +
        "&provider=anilist";

      return self.client.get(serversUrl, self.getHeaders)
        .then(function(res) {
          if (res.statusCode !== 200) return [];
          var json = JSON.parse(res.body);
          if (!json.success || !json.data || !json.data.servers) return [];
          var serverList = json.data.servers[category] || [];
          if (serverList.length === 0) return [];

          return Promise.all(serverList.map(function(srv) {
            var sourcesUrl = baseUrl + "/api/v2/shirayuki/hianime/episode/sources" +
              "?animeEpisodeId=" + encodeURIComponent(anilistId) +
              "&ep=" + encodeURIComponent(epNum) +
              "&server=" + encodeURIComponent(srv.nameId) +
              "&category=" + category +
              "&provider=anilist";

            return self.client.get(sourcesUrl, self.getHeaders)
              .then(function(res2) {
                if (res2.statusCode !== 200) return [];
                var json2 = JSON.parse(res2.body);
                if (!json2.success || !json2.data || !json2.data.sources) return [];

                var subtitles = (json2.data.tracks || [])
                  .filter(function(t) { return t && t.file; })
                  .map(function(t) { return { file: t.file, label: t.label || "Unknown" }; });

                return json2.data.sources
                  .filter(function(src) { return src && src.source; })
                  .map(function(src) {
                    return {
                      url: src.source,
                      originalUrl: src.source,
                      quality: (srv.name || srv.nameId) + " [" + category.toUpperCase() + "]",
                      headers: src.referer ? { "Referer": src.referer } : {},
                      subtitles: subtitles,
                    };
                  });
              })
              .catch(function() { return []; });
          })).then(function(results) {
            return results.reduce(function(acc, r) { return acc.concat(r); }, []);
          });
        })
        .catch(function() { return []; });
    };

    var results = await Promise.all([fetchCategory("sub"), fetchCategory("dub")]);
    var subStreams = results[0];
    var dubStreams = results[1];

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
