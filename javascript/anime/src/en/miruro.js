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
    "version": "2.1.0",
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

// Metadata: AniList GraphQL API
// Streaming:  AllAnime (api.allanime.day) — GraphQL + XOR-decoded source URLs
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

  // ── AniList GraphQL ────────────────────────────────────────────────────────

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

  // ── AllAnime API ───────────────────────────────────────────────────────────

  async allAnimeRequest(gqlQuery, variables) {
    var params = "?variables=" + encodeURIComponent(JSON.stringify(variables)) +
                 "&query=" + encodeURIComponent(gqlQuery);
    var res = await this.client.get("https://api.allanime.day/api" + params, {
      "Referer": "https://allmanga.to",
      "User-Agent": this.ua,
    });
    return JSON.parse(res.body);
  }

  // XOR decode AllAnime's obfuscated source URLs.
  // Encrypted strings start with '-'; the hex payload follows the last '-'.
  decryptAllAnimeUrl(str) {
    if (!str) return "";
    if (str.startsWith("-")) {
      var hex = str.substring(str.lastIndexOf("-") + 1);
      var bytes = hex.match(/.{1,2}/g) || [];
      return bytes.map(function(h) { return String.fromCharCode(parseInt(h, 16) ^ 56); }).join("");
    }
    return str;
  }

  scoreTitle(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 3;
    var longer = Math.max(a.length, b.length);
    var shorter = Math.min(a.length, b.length);
    var ratio = shorter / longer;
    if (a.startsWith(b) || b.startsWith(a)) return ratio >= 0.5 ? 2 : 1;
    if (a.includes(b) || b.includes(a)) return ratio >= 0.65 ? 1 : 0;
    return 0;
  }

  async findAllAnimeShow(englishTitle, romajiTitle) {
    var self = this;
    var norm = function(s) { return (s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); };
    var titles = [];
    if (englishTitle) titles.push(englishTitle);
    if (romajiTitle && romajiTitle !== englishTitle) titles.push(romajiTitle);

    var gqlQuery = "query($search: SearchInput, $limit: Int, $countryOrigin: VaildCountryOriginEnumType) { shows(search: $search, limit: $limit, countryOrigin: $countryOrigin) { edges { _id name englishName nativeName } } }";

    for (var ti = 0; ti < titles.length; ti++) {
      var title = titles[ti];
      var normTitle = norm(title);
      if (!normTitle) continue;
      try {
        var data = await self.allAnimeRequest(gqlQuery, {
          search: { query: title, allowAdult: false, allowUnknown: false },
          countryOrigin: "ALL",
          limit: 10,
        });
        var edges = (data.data && data.data.shows && data.data.shows.edges) || [];
        var bestId = null, bestScore = 0;
        for (var i = 0; i < edges.length; i++) {
          var edge = edges[i];
          var candidates = [edge.name, edge.englishName, edge.nativeName].filter(Boolean);
          for (var ci = 0; ci < candidates.length; ci++) {
            var score = self.scoreTitle(norm(candidates[ci]), normTitle);
            if (score > bestScore) { bestScore = score; bestId = edge._id; }
            if (score === 3) return edge._id;
          }
        }
        if (bestScore >= 1 && bestId) return bestId;
      } catch (e) {}
    }
    return null;
  }

  async getAllAnimeEpisodes(showId) {
    var gqlQuery = "query($id: String!) { show(_id: $id) { availableEpisodesDetail } }";
    var data = await this.allAnimeRequest(gqlQuery, { id: showId });
    var show = data.data && data.data.show;
    if (!show || !show.availableEpisodesDetail) return [];

    var subEps = show.availableEpisodesDetail.sub || [];
    var dubEps = show.availableEpisodesDetail.dub || [];
    var dubSet = {};
    for (var d = 0; d < dubEps.length; d++) dubSet[dubEps[d]] = true;

    var chapters = [];
    var seen = {};

    for (var si = 0; si < subEps.length; si++) {
      var ep = subEps[si];
      if (seen[ep]) continue;
      seen[ep] = true;
      var hasDub = !!dubSet[ep];
      chapters.push({
        name: "Episode " + ep,
        url: JSON.stringify({ showId: showId, ep: ep, hasSub: true, hasDub: hasDub }),
        isFiller: false,
      });
    }

    // Dub-only episodes not in the sub list
    for (var di = 0; di < dubEps.length; di++) {
      var dep = dubEps[di];
      if (seen[dep]) continue;
      seen[dep] = true;
      chapters.push({
        name: "Episode " + dep + " [Dub]",
        url: JSON.stringify({ showId: showId, ep: dep, hasSub: false, hasDub: true }),
        isFiller: false,
      });
    }

    return chapters;
  }

  // ── Anime detail ───────────────────────────────────────────────────────────

  async getDetail(url) {
    var animeId = parseInt(url.replace(/\D/g, ""), 10);
    if (!animeId) throw new Error("Invalid AniList ID: " + url);

    var q = "query($id:Int){Media(id:$id,type:ANIME){id title{romaji english native userPreferred}coverImage{large extraLarge}description status genres episodes format}}";
    var data = await this.anilist(q, { id: animeId });
    var m = data.Media;

    var name = this.getTitle(m.title);
    var imageUrl = (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large)) || "";
    var description = (m.description || "").replace(/<[^>]+>/g, "");
    var status = this.anilistStatusCode(m.status);
    var genre = m.genres || [];

    var chapters = [];
    try {
      var showId = await this.findAllAnimeShow(m.title.english, m.title.romaji);
      if (showId) {
        chapters = await this.getAllAnimeEpisodes(showId);
      }
    } catch (e) {}

    // Fallback: generate placeholder list from AniList episode count
    if (chapters.length === 0 && m.episodes) {
      for (var i = 1; i <= m.episodes; i++) {
        chapters.push({ name: "Episode " + i, url: "unavailable", isFiller: false });
      }
    }

    chapters.reverse();
    return {
      name, imageUrl, description, genre, status,
      link: this.source.baseUrl + "/info/" + animeId,
      chapters,
    };
  }

  // ── Streaming ──────────────────────────────────────────────────────────────

  async getVideoList(url) {
    if (url === "unavailable") return [];

    var info;
    try { info = JSON.parse(url); } catch (e) { return []; }

    var showId = info.showId;
    var ep = info.ep;
    var hasSub = info.hasSub;
    var hasDub = info.hasDub;
    if (!showId || !ep) return [];

    var pref = this.getPreference("miruro_pref_audio") || "sub";
    var streams = [];

    var types = [];
    if (pref === "dub") {
      if (hasDub) types.push("dub");
      if (hasSub) types.push("sub");
    } else {
      if (hasSub) types.push("sub");
      if (hasDub) types.push("dub");
    }
    if (types.length === 0) types.push("sub");

    var gqlQuery = "query($showId: String!, $episodeString: String!, $translationType: VaildTranslationTypeEnumType!) { episode(showId: $showId, episodeString: $episodeString, translationType: $translationType) { sourceUrls } }";

    for (var ti = 0; ti < types.length; ti++) {
      var translationType = types[ti];
      try {
        var data = await this.allAnimeRequest(gqlQuery, {
          showId: showId,
          episodeString: ep,
          translationType: translationType,
        });
        var sourceUrls = (data.data && data.data.episode && data.data.episode.sourceUrls) || [];

        for (var si = 0; si < sourceUrls.length; si++) {
          var src = sourceUrls[si];
          var decoded = this.decryptAllAnimeUrl(src.sourceUrl || "").trim();
          if (!decoded || !decoded.startsWith("http")) continue;

          var serverName = src.sourceName || "Server";
          var qualityLabel = translationType.toUpperCase() + " - " + serverName;

          try {
            var extracted = await this.extractFromUrl(decoded, qualityLabel);
            for (var ei = 0; ei < extracted.length; ei++) {
              streams.push(extracted[ei]);
            }
          } catch (e) {}
        }
      } catch (e) {}
    }

    return streams;
  }

  async extractFromUrl(url, qualityLabel) {
    try {
      var lurl = url.toLowerCase();
      if (lurl.includes("dood") || lurl.includes("d000")) {
        return await this.extractDoodstream(url, qualityLabel);
      } else if (lurl.includes("wish") || lurl.includes("awish") || lurl.includes("playerwish")) {
        return await this.extractStreamwish(url, qualityLabel);
      } else if (lurl.includes("filemoon") || lurl.includes("moonplayer")) {
        return await this.extractFilemoon(url, qualityLabel);
      } else if (lurl.includes("mp4upload")) {
        return await this.extractMp4upload(url, qualityLabel);
      } else if (lurl.includes("ok.ru") || lurl.includes("odnoklassniki")) {
        return await this.extractOkRu(url, qualityLabel);
      }
      // Generic: try the URL directly as HLS/MP4
      return await this.extractGeneric(url, qualityLabel);
    } catch (e) {
      return [];
    }
  }

  async extractStreamwish(url, qualityLabel) {
    var streams = [];
    try {
      var res = await this.client.get(url, {
        "User-Agent": this.ua,
        "Referer": "https://allmanga.to/",
      });
      var body = res.body;
      var m3u8Match = body.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/);
      if (!m3u8Match) m3u8Match = body.match(/source\s*:\s*["']([^"']+\.m3u8[^"']*)["']/);
      if (!m3u8Match) m3u8Match = body.match(/"src"\s*:\s*"([^"]+\.m3u8[^"]*)"/);
      if (m3u8Match) {
        var m3u8Url = m3u8Match[1];
        var hlsStreams = await this.parseHlsMaster(m3u8Url, qualityLabel, { "Referer": url, "User-Agent": this.ua });
        if (hlsStreams.length > 0) {
          for (var i = 0; i < hlsStreams.length; i++) streams.push(hlsStreams[i]);
        } else {
          streams.push({
            url: m3u8Url, originalUrl: m3u8Url,
            quality: "Auto [" + qualityLabel + "]",
            headers: { "Referer": url, "User-Agent": this.ua },
          });
        }
      }
    } catch (e) {}
    return streams;
  }

  async extractDoodstream(url, qualityLabel) {
    var streams = [];
    try {
      var referer = "https://doodstream.com/";
      var res = await this.client.get(url, { "User-Agent": this.ua, "Referer": referer });
      var body = res.body;

      var passMd5Match = body.match(/\/pass_md5\/[^'"?\s]+/);
      if (!passMd5Match) return streams;
      var passMd5Path = passMd5Match[0];

      var domainMatch = url.match(/^(https?:\/\/[^/]+)/);
      if (!domainMatch) return streams;
      var passMd5Url = domainMatch[1] + passMd5Path;

      var tokenMatch = body.match(/[?&]token=([^&"'\s<]+)/);
      if (!tokenMatch) tokenMatch = body.match(/token\s*=\s*["']([^"']+)["']/);
      var token = tokenMatch ? tokenMatch[1] : passMd5Path.split("/").pop();

      var baseRes = await this.client.get(passMd5Url, { "User-Agent": this.ua, "Referer": url });
      var baseUrl = (baseRes.body || "").trim();
      if (!baseUrl || !baseUrl.startsWith("http")) return streams;

      var expiry = String(Math.floor(Date.now() / 1000) + 300);
      var finalUrl = baseUrl + "z2FS1Eol5p" + "?token=" + token + "&expiry=" + expiry;

      streams.push({
        url: finalUrl, originalUrl: finalUrl,
        quality: "Auto [" + qualityLabel + "]",
        headers: { "Referer": url, "User-Agent": this.ua },
      });
    } catch (e) {}
    return streams;
  }

  async extractFilemoon(url, qualityLabel) {
    var streams = [];
    try {
      var res = await this.client.get(url, { "User-Agent": this.ua, "Referer": "https://allmanga.to/" });
      var body = res.body;
      var m3u8Match = body.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/);
      if (!m3u8Match) m3u8Match = body.match(/"file"\s*:\s*"([^"]+\.m3u8[^"]*)"/);
      if (m3u8Match) {
        var m3u8Url = m3u8Match[1];
        var hlsStreams = await this.parseHlsMaster(m3u8Url, qualityLabel, { "Referer": url, "User-Agent": this.ua });
        if (hlsStreams.length > 0) {
          for (var i = 0; i < hlsStreams.length; i++) streams.push(hlsStreams[i]);
        } else {
          streams.push({ url: m3u8Url, originalUrl: m3u8Url, quality: "Auto [" + qualityLabel + "]", headers: { "Referer": url, "User-Agent": this.ua } });
        }
      }
    } catch (e) {}
    return streams;
  }

  async extractMp4upload(url, qualityLabel) {
    var streams = [];
    try {
      var res = await this.client.get(url, { "User-Agent": this.ua, "Referer": "https://allmanga.to/" });
      var body = res.body;
      var mp4Match = body.match(/"(?:src|file)"\s*:\s*"([^"]+\.mp4[^"]*)"/);
      if (!mp4Match) mp4Match = body.match(/src\s*:\s*"([^"]+\.mp4[^"]*)"/);
      if (mp4Match) {
        streams.push({ url: mp4Match[1], originalUrl: mp4Match[1], quality: "Auto [" + qualityLabel + "]", headers: { "Referer": url, "User-Agent": this.ua } });
      }
    } catch (e) {}
    return streams;
  }

  async extractOkRu(url, qualityLabel) {
    var streams = [];
    try {
      var res = await this.client.get(url, { "User-Agent": this.ua });
      var body = res.body;
      var dataMatch = body.match(/data-options="([^"]+)"/);
      if (!dataMatch) return streams;
      var decoded = dataMatch[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"');
      var dataObj = JSON.parse(decoded);
      var flashVars = dataObj.flashvars || dataObj;
      var metadataStr = flashVars.metadata || flashVars.metadata_str || "";
      if (!metadataStr) return streams;
      var metadata = JSON.parse(decodeURIComponent(metadataStr));
      var videos = metadata.videos || [];
      for (var i = 0; i < videos.length; i++) {
        var v = videos[i];
        if (v.url) {
          streams.push({ url: v.url, originalUrl: v.url, quality: (v.name || "Auto") + " [" + qualityLabel + "]", headers: { "Referer": "https://ok.ru/", "User-Agent": this.ua } });
        }
      }
    } catch (e) {}
    return streams;
  }

  async extractGeneric(url, qualityLabel) {
    var streams = [];
    try {
      var lurl = url.toLowerCase();
      if (lurl.includes(".m3u8")) {
        var hlsStreams = await this.parseHlsMaster(url, qualityLabel, { "User-Agent": this.ua });
        if (hlsStreams.length > 0) return hlsStreams;
        streams.push({ url: url, originalUrl: url, quality: "Auto [" + qualityLabel + "]", headers: { "User-Agent": this.ua } });
      } else if (lurl.includes(".mp4")) {
        streams.push({ url: url, originalUrl: url, quality: "Auto [" + qualityLabel + "]", headers: { "User-Agent": this.ua } });
      }
    } catch (e) {}
    return streams;
  }

  // Parse an HLS master playlist and return per-quality stream objects.
  async parseHlsMaster(m3u8Url, qualityLabel, headers) {
    var streams = [];
    try {
      var res = await this.client.get(m3u8Url, headers);
      if (!res || !res.body) return streams;
      var body = res.body;
      if (body.indexOf("#EXT-X-STREAM-INF") < 0) return streams;
      var base = m3u8Url.substring(0, m3u8Url.lastIndexOf("/") + 1);
      var lines = body.split("\n");
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.indexOf("#EXT-X-STREAM-INF:") !== 0) continue;
        var resM = line.match(/RESOLUTION=\d+x(\d+)/);
        var resLabel = resM ? resM[1] + "p" : "Auto";
        for (var j = i + 1; j < lines.length; j++) {
          var nxt = lines[j].trim();
          if (!nxt || nxt[0] === "#") continue;
          var varUrl = nxt.indexOf("http") === 0 ? nxt : base + nxt;
          streams.push({
            url: varUrl, originalUrl: varUrl,
            quality: resLabel + " [" + qualityLabel + "]",
            headers: headers,
          });
          break;
        }
      }
    } catch (e) {}
    return streams;
  }

  // ── Filters & Preferences ──────────────────────────────────────────────────

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
