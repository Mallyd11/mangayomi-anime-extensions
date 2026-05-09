const mangayomiSources = [
  {
    "name": "Miruro",
    "id": 617345892,
    "baseUrl": "https://www.miruro.tv",
    "lang": "en",
    "typeSource": "single",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://www.miruro.tv",
    "dateFormat": "",
    "dateFormatLocale": "",
    "isNsfw": false,
    "hasCloudflare": false,
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/miruro.js",
    "apiUrl": "",
    "version": "2.0.1",
    "isManga": false,
    "itemType": 1,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "additionalParams": "",
    "sourceCodeLanguage": 1,
    "notes": "",
    "pkgPath": "anime/src/en/miruro.js",
  },
];

// Metadata: Anilist GraphQL API
// Streaming: HiAnime (hianime.ms) via megaplay.buzz
class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
  }

  get ua() {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
  }

  get hiAnimeBase() {
    return "https://hianime.ms";
  }

  get hiHeaders() {
    return { "User-Agent": this.ua, "Referer": this.hiAnimeBase + "/" };
  }

  getPreference(key) {
    return new SharedPreferences().get(key);
  }

  // ── Anilist GraphQL ──────────────────────────────────────────────────────────

  async anilist(query, variables) {
    var res = await this.client.post(
      "https://graphql.anilist.co",
      { "Content-Type": "application/json", "Accept": "application/json" },
      { query: query, variables: variables }
    );
    var data = JSON.parse(res.body);
    if (data.errors) throw new Error(data.errors[0].message);
    return data.data;
  }

  getTitle(title) {
    if (!title) return "Unknown";
    var pref = this.getPreference("miruro_title_lang");
    return title[pref] || title.english || title.romaji || title.userPreferred || "Unknown";
  }

  anilistStatusCode(s) {
    return (
      { RELEASING: 0, FINISHED: 1, NOT_YET_RELEASED: 4, CANCELLED: 5, HIATUS: 5 }[s] ?? 5
    );
  }

  parseAnilistPage(data) {
    var list = [];
    var results = (data.Page && data.Page.media) || [];
    for (var i = 0; i < results.length; i++) {
      var m = results[i];
      list.push({
        name: this.getTitle(m.title),
        link: String(m.id),
        imageUrl: (m.coverImage && m.coverImage.large) || "",
      });
    }
    var hasNextPage = !!(data.Page && data.Page.pageInfo && data.Page.pageInfo.hasNextPage);
    return { list, hasNextPage };
  }

  async getPopular(page) {
    var q = "query($page:Int,$perPage:Int){Page(page:$page,perPage:$perPage){pageInfo{hasNextPage}media(sort:[TRENDING_DESC],type:ANIME,isAdult:false){id title{romaji english native userPreferred}coverImage{large}}}}";
    var data = await this.anilist(q, { page: page, perPage: 20 });
    return this.parseAnilistPage(data);
  }

  async getLatestUpdates(page) {
    var q = "query($page:Int,$perPage:Int){Page(page:$page,perPage:$perPage){pageInfo{hasNextPage}media(sort:[UPDATED_AT_DESC],type:ANIME,status:RELEASING,isAdult:false){id title{romaji english native userPreferred}coverImage{large}}}}";
    var data = await this.anilist(q, { page: page, perPage: 20 });
    return this.parseAnilistPage(data);
  }

  async search(query, page, filters) {
    var variables = { page: page, perPage: 20 };
    var conditions = ["type:ANIME", "isAdult:false"];
    var args = "$page:Int,$perPage:Int";

    if (query && query.length > 0) {
      conditions.push("search:$search");
      args += ",$search:String";
      variables.search = query;
    } else {
      conditions.push("sort:TRENDING_DESC");
    }

    if (filters && Array.isArray(filters)) {
      for (var f of filters) {
        if (f.type_name === "SelectFilter" && f.state > 0) {
          var v = f.values[f.state].value;
          if (f.name === "Season" && v) { conditions.push("season:$season"); args += ",$season:MediaSeason"; variables.season = v; }
          else if (f.name === "Format" && v) { conditions.push("format:$format"); args += ",$format:MediaFormat"; variables.format = v; }
          else if (f.name === "Status" && v) { conditions.push("status:$status"); args += ",$status:MediaStatus"; variables.status = v; }
          else if (f.name === "Year" && v) { conditions.push("seasonYear:$year"); args += ",$year:Int"; variables.year = parseInt(v); }
          else if (f.name === "Sort" && v) { conditions.push("sort:[$sort]"); args += ",$sort:[MediaSort]"; variables.sort = [v]; }
        } else if (f.type_name === "GroupFilter") {
          var genres = [];
          for (var item of f.state) { if (item.state === true) genres.push(item.value); }
          if (genres.length > 0) { conditions.push("genre_in:$genres"); args += ",$genres:[String]"; variables.genres = genres; }
        }
      }
    }

    var q = "query(" + args + "){Page(page:$page,perPage:$perPage){pageInfo{hasNextPage}media(" + conditions.join(",") + "){id title{romaji english native userPreferred}coverImage{large}}}}";
    var data = await this.anilist(q, variables);
    return this.parseAnilistPage(data);
  }

  // ── HiAnime episode lookup ──────────────────────────────────────────────────

  buildWatchUrl(slug, n) {
    var d = slug.lastIndexOf("-");
    if (d < 0) return null;
    return "/watch-" + slug.substring(0, d) + "-episode-" + (n || 1) + "-" + slug.substring(d + 1);
  }

  decodeStreamToken(token) {
    if (!token) return null;
    try {
      var t = token.replace(/-/g, "+").replace(/_/g, "/");
      while (t.length % 4 !== 0) t += "=";
      var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      var out = "";
      t = t.replace(/[^A-Za-z0-9+/]/g, "");
      for (var i = 0; i < t.length; i += 4) {
        var n = (chars.indexOf(t[i]) << 18) | (chars.indexOf(t[i + 1]) << 12) |
                ((chars.indexOf(t[i + 2]) & 63) << 6) | (chars.indexOf(t[i + 3]) & 63);
        out += String.fromCharCode((n >> 16) & 255);
        if (chars.indexOf(t[i + 2]) !== -1) out += String.fromCharCode((n >> 8) & 255);
        if (chars.indexOf(t[i + 3]) !== -1) out += String.fromCharCode(n & 255);
      }
      var c = out.indexOf(":");
      return c > 0 ? out.substring(0, c) : (out || null);
    } catch (e) { return null; }
  }

  async findHiAnimeSlug(englishTitle, romajiTitle) {
    var titles = [];
    if (englishTitle) titles.push(englishTitle);
    if (romajiTitle && romajiTitle !== englishTitle) titles.push(romajiTitle);
    for (var title of titles) {
      try {
        var res = await this.client.get(
          this.hiAnimeBase + "/search?keyword=" + encodeURIComponent(title),
          this.hiHeaders
        );
        var doc = new Document(res.body);
        var first = doc.selectFirst(".flw-item");
        if (first) {
          var anchor = first.selectFirst(".film-poster-ahref");
          if (anchor) {
            var href = anchor.attr("href") || "";
            var slug = href.replace(/^\/details\//, "").replace(/[?#].*$/, "");
            if (slug) return slug;
          }
        }
      } catch (e) {}
    }
    return null;
  }

  async getHiAnimeEpisodes(slug) {
    var watchPath = this.buildWatchUrl(slug, 1);
    if (!watchPath) return [];
    try {
      var res = await this.client.get(this.hiAnimeBase + watchPath, this.hiHeaders);
      var doc = new Document(res.body);
      var chapters = [];
      var anchors = doc.select("a[data-stream-token]");
      for (var i = 0; i < anchors.length; i++) {
        var ep = anchors[i];
        var token = ep.attr("data-stream-token");
        var realEpId = this.decodeStreamToken(token);
        if (!realEpId) continue;
        var epNum = ep.attr("data-episode") || String(i + 1);
        var hasSub = ep.attr("data-has-sub") === "1";
        var hasDub = ep.attr("data-has-dub") === "1";
        var titleSpan = ep.selectFirst(".ws-ep__title, .ep-name");
        var epTitle = titleSpan ? titleSpan.text.trim() : "";
        var label = "E" + epNum + (epTitle ? ": " + epTitle : "");
        var langs = [];
        if (hasSub) langs.push("Sub");
        if (hasDub) langs.push("Dub");
        if (langs.length) label += " [" + langs.join("+") + "]";
        chapters.push({
          name: label,
          url: realEpId + "|" + (hasSub ? "1" : "0") + "|" + (hasDub ? "1" : "0"),
          isFiller: false,
        });
      }
      return chapters;
    } catch (e) { return []; }
  }

  // ── Anime detail ─────────────────────────────────────────────────────────────

  async getDetail(url) {
    var animeId = parseInt(url.replace(/\D/g, ""), 10);
    if (!animeId) throw new Error("Invalid Anilist ID: " + url);

    var q = "query($id:Int){Media(id:$id,type:ANIME){id title{romaji english native userPreferred}coverImage{large extraLarge}description status genres episodes format}}";
    var data = await this.anilist(q, { id: animeId });
    var m = data.Media;

    var name = this.getTitle(m.title);
    var imageUrl = (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large)) || "";
    var description = (m.description || "").replace(/<[^>]+>/g, "");
    var status = this.anilistStatusCode(m.status);
    var genre = m.genres || [];

    var slug = await this.findHiAnimeSlug(m.title.english, m.title.romaji);
    var chapters = slug ? await this.getHiAnimeEpisodes(slug) : [];

    if (chapters.length === 0 && m.episodes) {
      for (var i = 1; i <= m.episodes; i++) {
        chapters.push({ name: "Episode " + i, url: "unavailable|0|0", isFiller: false });
      }
    }

    chapters.reverse();
    return { name, imageUrl, description, genre, status, link: this.source.baseUrl + "/info/" + animeId, chapters };
  }

  // ── Streaming (megaplay.buzz) ────────────────────────────────────────────────

  async getMegaplayDataId(realEpId, audioType) {
    var url = "https://megaplay.buzz/stream/s-2/" + realEpId + "/" + audioType;
    try {
      var res = await this.client.get(url, { "User-Agent": this.ua, "Referer": this.hiAnimeBase + "/" });
      if (res.body.indexOf("File not found") >= 0 || res.body.indexOf("Error - MegaPlay") >= 0) return null;
      var doc = new Document(res.body);
      var el = doc.selectFirst("#megaplay-player[data-id]");
      if (el) return { dataId: el.attr("data-id"), refererUrl: url };
      var match = res.body.match(/id="megaplay-player"[^>]*data-id="(\d+)"/);
      if (match) return { dataId: match[1], refererUrl: url };
    } catch (e) {}
    return null;
  }

  async resolveHlsPlaylist(playlistUrl, headers) {
    try {
      var res = await this.client.get(playlistUrl, headers);
      if (!res || !res.body) return { kind: "fetch-failed" };
      var body = res.body;
      if (body.indexOf("#EXTINF") >= 0 && body.indexOf("#EXT-X-STREAM-INF") < 0) return { kind: "flat" };
      if (body.indexOf("#EXT-X-STREAM-INF") < 0) return { kind: "empty-master" };
      var baseDir = playlistUrl.substring(0, playlistUrl.lastIndexOf("/") + 1);
      var variants = [];
      var lines = body.split("\n");
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.indexOf("#EXT-X-STREAM-INF:") !== 0) continue;
        var resM = line.match(/RESOLUTION=(\d+)x(\d+)/);
        var bwM = line.match(/BANDWIDTH=(\d+)/);
        for (var j = i + 1; j < lines.length; j++) {
          var u = lines[j].trim();
          if (!u || u[0] === "#") continue;
          variants.push({
            url: u.indexOf("http") === 0 ? u : baseDir + u,
            label: resM ? resM[2] + "p" : (bwM ? Math.round(bwM[1] / 1000) + "kbps" : "Auto"),
          });
          break;
        }
      }
      if (variants.length === 0) return { kind: "empty-master" };
      variants.sort(function(a, b) { return (parseInt(b.label) || 0) - (parseInt(a.label) || 0); });
      return { kind: "master", variants: variants };
    } catch (e) { return { kind: "fetch-failed" }; }
  }

  async extractMegaplaySources(realEpId, audioType, audioLabel) {
    var streams = [];
    var info = await this.getMegaplayDataId(realEpId, audioType);
    if (!info) return streams;
    try {
      var res = await this.client.get(
        "https://megaplay.buzz/stream/getSources?id=" + info.dataId,
        { "User-Agent": this.ua, "Referer": info.refererUrl, "X-Requested-With": "XMLHttpRequest", "Accept": "application/json" }
      );
      var data = JSON.parse(res.body);
      if (!data || !data.sources) return streams;
      var sourceList = Array.isArray(data.sources) ? data.sources : (data.sources.file ? [data.sources] : []);
      var subtitles = [];
      if (Array.isArray(data.tracks)) {
        for (var t of data.tracks) {
          if (t && t.file && (t.kind === "captions" || t.kind === "subtitles" || !t.kind)) {
            subtitles.push({ file: t.file, label: t.label || "Unknown" });
          }
        }
      }
      var streamHeaders = { "User-Agent": this.ua, "Referer": "https://megaplay.buzz/", "Origin": "https://megaplay.buzz" };
      for (var src of sourceList) {
        var fileUrl = src.file || src.url;
        if (!fileUrl) continue;
        if (fileUrl.indexOf(".m3u8") >= 0) {
          var resolved = await this.resolveHlsPlaylist(fileUrl, streamHeaders);
          if (resolved.kind === "master") {
            for (var v of resolved.variants) {
              streams.push({ url: v.url, originalUrl: fileUrl, quality: v.label + " [" + audioLabel + "]", headers: streamHeaders, subtitles: subtitles });
            }
          } else if (resolved.kind === "flat") {
            streams.push({ url: fileUrl, originalUrl: fileUrl, quality: "Auto [" + audioLabel + "]", headers: streamHeaders, subtitles: subtitles });
          }
        } else {
          streams.push({ url: fileUrl, originalUrl: fileUrl, quality: "MP4 [" + audioLabel + "]", headers: streamHeaders, subtitles: subtitles });
        }
      }
    } catch (e) {}
    return streams;
  }

  async getVideoList(url) {
    if (url === "unavailable|0|0") return [];
    var parts = url.split("|");
    var realEpId = parts[0];
    var hasSub = parts[1] === "1";
    var hasDub = parts[2] === "1";
    var pref = this.getPreference("miruro_pref_audio") || "sub";
    var subStreams = hasSub ? await this.extractMegaplaySources(realEpId, "sub", "Sub") : [];
    var dubStreams = hasDub ? await this.extractMegaplaySources(realEpId, "dub", "Dub") : [];
    return pref === "dub" ? dubStreams.concat(subStreams) : subStreams.concat(dubStreams);
  }

  // ── Filters & Preferences ────────────────────────────────────────────────────

  getFilterList() {
    return [
      {
        type_name: "SelectFilter", name: "Sort", state: 0,
        values: [
          { type_name: "SelectOption", name: "Trending", value: "TRENDING_DESC" },
          { type_name: "SelectOption", name: "Popularity", value: "POPULARITY_DESC" },
          { type_name: "SelectOption", name: "Score", value: "SCORE_DESC" },
          { type_name: "SelectOption", name: "Newest", value: "START_DATE_DESC" },
          { type_name: "SelectOption", name: "Oldest", value: "START_DATE" },
        ],
      },
      {
        type_name: "SelectFilter", name: "Season", state: 0,
        values: [
          { type_name: "SelectOption", name: "Any", value: "" },
          { type_name: "SelectOption", name: "Winter", value: "WINTER" },
          { type_name: "SelectOption", name: "Spring", value: "SPRING" },
          { type_name: "SelectOption", name: "Summer", value: "SUMMER" },
          { type_name: "SelectOption", name: "Fall", value: "FALL" },
        ],
      },
      {
        type_name: "SelectFilter", name: "Format", state: 0,
        values: [
          { type_name: "SelectOption", name: "Any", value: "" },
          { type_name: "SelectOption", name: "TV", value: "TV" },
          { type_name: "SelectOption", name: "Movie", value: "MOVIE" },
          { type_name: "SelectOption", name: "OVA", value: "OVA" },
          { type_name: "SelectOption", name: "ONA", value: "ONA" },
          { type_name: "SelectOption", name: "Special", value: "SPECIAL" },
        ],
      },
      {
        type_name: "SelectFilter", name: "Status", state: 0,
        values: [
          { type_name: "SelectOption", name: "Any", value: "" },
          { type_name: "SelectOption", name: "Airing", value: "RELEASING" },
          { type_name: "SelectOption", name: "Finished", value: "FINISHED" },
          { type_name: "SelectOption", name: "Not Yet Aired", value: "NOT_YET_RELEASED" },
        ],
      },
      {
        type_name: "SelectFilter", name: "Year", state: 0,
        values: [
          { type_name: "SelectOption", name: "Any", value: "" },
          { type_name: "SelectOption", name: "2026", value: "2026" },
          { type_name: "SelectOption", name: "2025", value: "2025" },
          { type_name: "SelectOption", name: "2024", value: "2024" },
          { type_name: "SelectOption", name: "2023", value: "2023" },
          { type_name: "SelectOption", name: "2022", value: "2022" },
          { type_name: "SelectOption", name: "2021", value: "2021" },
          { type_name: "SelectOption", name: "2020", value: "2020" },
          { type_name: "SelectOption", name: "2015", value: "2015" },
          { type_name: "SelectOption", name: "2010", value: "2010" },
          { type_name: "SelectOption", name: "2005", value: "2005" },
          { type_name: "SelectOption", name: "2000", value: "2000" },
        ],
      },
      {
        type_name: "GroupFilter", name: "Genres",
        state: [
          { type_name: "CheckBox", name: "Action", value: "Action", state: false },
          { type_name: "CheckBox", name: "Adventure", value: "Adventure", state: false },
          { type_name: "CheckBox", name: "Comedy", value: "Comedy", state: false },
          { type_name: "CheckBox", name: "Drama", value: "Drama", state: false },
          { type_name: "CheckBox", name: "Ecchi", value: "Ecchi", state: false },
          { type_name: "CheckBox", name: "Fantasy", value: "Fantasy", state: false },
          { type_name: "CheckBox", name: "Horror", value: "Horror", state: false },
          { type_name: "CheckBox", name: "Mecha", value: "Mecha", state: false },
          { type_name: "CheckBox", name: "Music", value: "Music", state: false },
          { type_name: "CheckBox", name: "Mystery", value: "Mystery", state: false },
          { type_name: "CheckBox", name: "Psychological", value: "Psychological", state: false },
          { type_name: "CheckBox", name: "Romance", value: "Romance", state: false },
          { type_name: "CheckBox", name: "Sci-Fi", value: "Sci-Fi", state: false },
          { type_name: "CheckBox", name: "Slice of Life", value: "Slice of Life", state: false },
          { type_name: "CheckBox", name: "Sports", value: "Sports", state: false },
          { type_name: "CheckBox", name: "Supernatural", value: "Supernatural", state: false },
          { type_name: "CheckBox", name: "Thriller", value: "Thriller", state: false },
        ],
      },
    ];
  }

  getSourcePreferences() {
    return [
      {
        key: "miruro_title_lang",
        listPreference: {
          title: "Preferred title language",
          summary: "Language for anime titles",
          valueIndex: 0,
          entries: ["English", "Romaji", "Native", "User Preferred"],
          entryValues: ["english", "romaji", "native", "userPreferred"],
        },
      },
      {
        key: "miruro_pref_audio",
        listPreference: {
          title: "Preferred audio",
          summary: "Sub or Dub (shown first)",
          valueIndex: 0,
          entries: ["Sub", "Dub"],
          entryValues: ["sub", "dub"],
        },
      },
    ];
  }
}
