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
    "version": "2.1.2",
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
// Streaming:  AllAnime (api.allanime.day) — GraphQL + XOR / AES-256-CTR decryption
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

    // Request both sourceUrls (old XOR format) and tobeparsed (new AES-256-CTR format)
    var gqlQuery = "query($showId: String!, $episodeString: String!, $translationType: VaildTranslationTypeEnumType!) { episode(showId: $showId, episodeString: $episodeString, translationType: $translationType) { sourceUrls tobeparsed } }";

    for (var ti = 0; ti < types.length; ti++) {
      var translationType = types[ti];
      try {
        var data = await this.allAnimeRequest(gqlQuery, {
          showId: showId,
          episodeString: ep,
          translationType: translationType,
        });
        var episodeData = data.data && data.data.episode;
        if (!episodeData) continue;

        // Collect source objects from whichever format is available
        var sourceObjects = [];

        // New format: tobeparsed (AES-256-CTR encrypted)
        var tobeparsed = episodeData.tobeparsed;
        if (tobeparsed && typeof tobeparsed === "string" && tobeparsed.length > 0) {
          try {
            var decrypted = this.decodeTobeparsed(tobeparsed);
            for (var di = 0; di < decrypted.length; di++) {
              sourceObjects.push(decrypted[di]);
            }
          } catch (e) {}
        }

        // Old format: sourceUrls array
        var sourceUrls = episodeData.sourceUrls;
        if (sourceUrls && Array.isArray(sourceUrls)) {
          for (var si = 0; si < sourceUrls.length; si++) {
            sourceObjects.push(sourceUrls[si]);
          }
        } else if (sourceUrls && typeof sourceUrls === "string") {
          // Sometimes sourceUrls is a JSON string
          try {
            var parsed = JSON.parse(sourceUrls);
            if (Array.isArray(parsed)) {
              for (var pi = 0; pi < parsed.length; pi++) sourceObjects.push(parsed[pi]);
            }
          } catch (e) {}
        }

        // Process each source object
        for (var si = 0; si < sourceObjects.length; si++) {
          var src = sourceObjects[si];
          var decoded = this.decryptAllAnimeUrl(src.sourceUrl || "").trim();
          if (!decoded) continue;

          // Accept https:// external URLs and /apivtwo/ internal AllAnime CDN paths
          var isExternal = decoded.startsWith("http");
          var isInternal = decoded.startsWith("/");
          if (!isExternal && !isInternal) continue;

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
      // Internal AllAnime CDN paths (relative: /apivtwo/clock?id=...)
      if (url.startsWith("/") || url.includes("/apivtwo/")) {
        return await this.extractAllAnimeInternal(url, qualityLabel);
      }
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

  // AllAnime internal CDN player.
  // Decoded sourceUrl is a relative path like /apivtwo/clock?id=XXXX.
  // CDN base is hardcoded as https://allanime.day (confirmed via ani-cli source).
  async extractAllAnimeInternal(url, qualityLabel) {
    var streams = [];
    try {
      // Hardcoded CDN base — /getVersion no longer returns episodeIframeHead
      var endPoint = "https://allanime.day";

      // Build clock.json URL: relative path → prepend endPoint
      var clockUrl;
      if (url.startsWith("http")) {
        clockUrl = url.replace("/clock?", "/clock.json?");
      } else {
        clockUrl = endPoint + url.replace("/clock?", "/clock.json?");
      }

      var cr = await this.client.get(clockUrl, {
        "Referer": "https://allmanga.to",
        "User-Agent": this.ua,
        "Origin": "https://allmanga.to",
      });
      var linkData = JSON.parse(cr.body);
      var links = linkData.links || [];

      for (var li = 0; li < links.length; li++) {
        var link = links[li];
        var subtitles = [];
        if (link.subtitles && link.subtitles.length > 0) {
          for (var subi = 0; subi < link.subtitles.length; subi++) {
            var sub = link.subtitles[subi];
            subtitles.push({ file: sub.src || sub.file || "", label: sub.lang || sub.label || "Unknown" });
          }
        }
        var hlsHeaders = { "User-Agent": this.ua, "Origin": endPoint, "Referer": endPoint + "/" };

        if (link.hls && link.link) {
          try {
            var hlsStreams = await this.parseHlsMaster(link.link, qualityLabel, hlsHeaders);
            if (hlsStreams.length > 0) {
              for (var hsi = 0; hsi < hlsStreams.length; hsi++) {
                hlsStreams[hsi].subtitles = subtitles;
                streams.push(hlsStreams[hsi]);
              }
            } else {
              streams.push({
                url: link.link, originalUrl: link.link,
                quality: (link.resolutionStr || "Auto") + " [" + qualityLabel + "]",
                headers: hlsHeaders, subtitles: subtitles,
              });
            }
          } catch (e) {
            streams.push({
              url: link.link, originalUrl: link.link,
              quality: (link.resolutionStr || "Auto") + " [" + qualityLabel + "]",
              headers: hlsHeaders, subtitles: subtitles,
            });
          }
        } else if (link.mp4 && link.link) {
          streams.push({
            url: link.link, originalUrl: link.link,
            quality: (link.resolutionStr || "Auto") + " [" + qualityLabel + "]",
            headers: { "User-Agent": this.ua, "Referer": endPoint + "/" },
            subtitles: subtitles,
          });
        }
      }
    } catch (e) {}
    return streams;
  }

  // ── AES-256-CTR crypto (for AllAnime tobeparsed) ───────────────────────────

  // Base64 decode → byte array
  base64Decode(b64) {
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var lookup = {};
    for (var i = 0; i < 64; i++) lookup[chars[i]] = i;
    b64 = b64.replace(/[^A-Za-z0-9+/=]/g, "");
    var out = [];
    for (var i = 0; i < b64.length; i += 4) {
      var a = lookup[b64[i]] !== undefined ? lookup[b64[i]] : 0;
      var b = lookup[b64[i+1]] !== undefined ? lookup[b64[i+1]] : 0;
      var c = lookup[b64[i+2]] !== undefined ? lookup[b64[i+2]] : 0;
      var d = lookup[b64[i+3]] !== undefined ? lookup[b64[i+3]] : 0;
      out.push((a << 2) | (b >> 4));
      if (b64[i+2] !== "=") out.push(((b & 0xf) << 4) | (c >> 2));
      if (b64[i+3] !== "=") out.push(((c & 0x3) << 6) | d);
    }
    return out;
  }

  // 32-bit unsigned right-rotate
  rotr32(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }

  // SHA-256: returns 32 bytes as array
  sha256bytes(msg) {
    var K = [
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
    ];
    var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var bytes = [];
    for (var i = 0; i < msg.length; i++) bytes.push(msg.charCodeAt(i) & 0xff);
    var len = bytes.length;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    var bl = len * 8;
    bytes.push(0, 0, 0, 0, (bl >>> 24) & 0xff, (bl >>> 16) & 0xff, (bl >>> 8) & 0xff, bl & 0xff);
    for (var blk = 0; blk < bytes.length; blk += 64) {
      var W = new Array(64);
      for (var i = 0; i < 16; i++) {
        W[i] = ((bytes[blk+i*4]<<24)|(bytes[blk+i*4+1]<<16)|(bytes[blk+i*4+2]<<8)|bytes[blk+i*4+3]) >>> 0;
      }
      for (var i = 16; i < 64; i++) {
        var s0 = this.rotr32(W[i-15],7) ^ this.rotr32(W[i-15],18) ^ (W[i-15] >>> 3);
        var s1 = this.rotr32(W[i-2],17) ^ this.rotr32(W[i-2],19) ^ (W[i-2] >>> 10);
        W[i] = (W[i-16] + s0 + W[i-7] + s1) >>> 0;
      }
      var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
      for (var i = 0; i < 64; i++) {
        var S1 = this.rotr32(e,6) ^ this.rotr32(e,11) ^ this.rotr32(e,25);
        var ch = ((e & f) ^ (~e & g)) >>> 0;
        var t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
        var S0 = this.rotr32(a,2) ^ this.rotr32(a,13) ^ this.rotr32(a,22);
        var mj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        var t2 = (S0 + mj) >>> 0;
        h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
      }
      H[0]=(H[0]+a)>>>0; H[1]=(H[1]+b)>>>0; H[2]=(H[2]+c)>>>0; H[3]=(H[3]+d)>>>0;
      H[4]=(H[4]+e)>>>0; H[5]=(H[5]+f)>>>0; H[6]=(H[6]+g)>>>0; H[7]=(H[7]+h)>>>0;
    }
    var result = [];
    for (var i = 0; i < 8; i++) {
      result.push((H[i]>>>24)&0xff, (H[i]>>>16)&0xff, (H[i]>>>8)&0xff, H[i]&0xff);
    }
    return result;
  }

  // AES S-box (standard)
  get aesSbox() {
    return [99,124,119,123,242,107,111,197,48,1,103,43,254,215,171,118,202,130,201,125,250,89,71,240,173,212,162,175,156,164,114,192,183,253,147,38,54,63,247,204,52,165,229,241,113,216,49,21,4,199,35,195,24,150,5,154,7,18,128,226,235,39,178,117,9,131,44,26,27,110,90,160,82,59,214,179,41,227,47,132,83,209,0,237,32,252,177,91,106,203,190,57,74,76,88,207,208,239,170,251,67,77,51,133,69,249,2,127,80,60,159,168,81,163,64,143,146,157,56,245,188,182,218,33,16,255,243,210,205,12,19,236,95,151,68,23,196,167,126,61,100,93,25,115,96,129,79,220,34,42,144,136,70,238,184,20,222,94,11,219,224,50,58,10,73,6,36,92,194,211,172,98,145,149,228,121,231,200,55,109,141,213,78,169,108,86,244,234,101,122,174,8,186,120,37,46,28,166,180,198,232,221,116,31,75,189,139,138,112,62,181,102,72,3,246,14,97,53,87,185,134,193,29,158,225,248,152,17,105,217,142,148,155,30,135,233,206,85,40,223,140,161,137,13,191,230,66,104,65,153,45,15,176,84,187,22];
  }

  // GF(2^8) multiply by 2
  aesXtime(x) { return ((x << 1) ^ (x & 0x80 ? 0x1b : 0)) & 0xff; }

  // AES-256 key expansion: 32-byte key → 60 4-byte words
  aesKeyExpand(keyBytes) {
    var sb = this.aesSbox;
    var rc = [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];
    var w = [];
    for (var i = 0; i < 8; i++) {
      w.push([keyBytes[i*4], keyBytes[i*4+1], keyBytes[i*4+2], keyBytes[i*4+3]]);
    }
    for (var i = 8; i < 60; i++) {
      var tmp = w[i-1].slice();
      if (i % 8 === 0) {
        // RotWord + SubWord + Rcon
        tmp = [sb[w[i-1][1]] ^ rc[i/8-1], sb[w[i-1][2]], sb[w[i-1][3]], sb[w[i-1][0]]];
      } else if (i % 8 === 4) {
        tmp = [sb[tmp[0]], sb[tmp[1]], sb[tmp[2]], sb[tmp[3]]];
      }
      w.push([w[i-8][0]^tmp[0], w[i-8][1]^tmp[1], w[i-8][2]^tmp[2], w[i-8][3]^tmp[3]]);
    }
    return w;
  }

  // AES encrypt one 16-byte block (forward cipher, 14 rounds for AES-256)
  // State layout: s[row][col], input byte (r + 4c) → s[r][c]
  aesEncryptBlock(inp, w) {
    var sb = this.aesSbox;
    var xt = this.aesXtime.bind(this);
    // Load state column-major
    var s = [
      [inp[0],inp[4],inp[8],inp[12]],   // row 0
      [inp[1],inp[5],inp[9],inp[13]],   // row 1
      [inp[2],inp[6],inp[10],inp[14]],  // row 2
      [inp[3],inp[7],inp[11],inp[15]],  // row 3
    ];
    // Round 0: AddRoundKey
    for (var r = 0; r < 4; r++)
      for (var c = 0; c < 4; c++)
        s[r][c] ^= w[c][r];

    for (var round = 1; round <= 14; round++) {
      // SubBytes
      for (var r = 0; r < 4; r++)
        for (var c = 0; c < 4; c++)
          s[r][c] = sb[s[r][c]];

      // ShiftRows: row r shifts left by r
      for (var r = 1; r < 4; r++) {
        var tmp = s[r].slice();
        for (var c = 0; c < 4; c++) s[r][c] = tmp[(c + r) % 4];
      }

      // MixColumns (skip last round)
      if (round < 14) {
        for (var c = 0; c < 4; c++) {
          var a=s[0][c], b=s[1][c], cc=s[2][c], d=s[3][c];
          s[0][c] = xt(a) ^ xt(b)^b ^ cc ^ d;
          s[1][c] = a ^ xt(b) ^ xt(cc)^cc ^ d;
          s[2][c] = a ^ b ^ xt(cc) ^ xt(d)^d;
          s[3][c] = xt(a)^a ^ b ^ cc ^ xt(d);
        }
      }

      // AddRoundKey
      var ki = round * 4;
      for (var r = 0; r < 4; r++)
        for (var c = 0; c < 4; c++)
          s[r][c] ^= w[ki+c][r];
    }

    // Write output column-major
    var out = new Array(16);
    for (var r = 0; r < 4; r++)
      for (var c = 0; c < 4; c++)
        out[r + 4*c] = s[r][c];
    return out;
  }

  // AES-256-CTR decrypt: key and counter are byte arrays
  aesCtrDecrypt(ciphertext, keyBytes, counter) {
    var w = this.aesKeyExpand(keyBytes);
    var ctr = counter.slice();
    var out = [];
    for (var i = 0; i < ciphertext.length; i += 16) {
      var ks = this.aesEncryptBlock(ctr, w);
      for (var j = 0; j < 16 && i+j < ciphertext.length; j++) {
        out.push(ciphertext[i+j] ^ ks[j]);
      }
      // Increment counter big-endian (last 4 bytes)
      for (var k = 15; k >= 12; k--) {
        ctr[k] = (ctr[k] + 1) & 0xff;
        if (ctr[k] !== 0) break;
      }
    }
    return out;
  }

  // Decode AllAnime tobeparsed AES-256-CTR blob.
  // Format: [version(1)][nonce(12)][ciphertext(N)][authTag(16)]
  // Key: SHA-256("Xot36i3lK3:v1")
  // Counter: nonce ++ 0x00000002 (big-endian)
  decodeTobeparsed(b64) {
    try {
      var bytes = this.base64Decode(b64);
      if (bytes.length < 30) return [];

      var nonce = bytes.slice(1, 13);            // 12-byte IV
      var ciphertext = bytes.slice(13, bytes.length - 16); // skip auth tag at end

      // Counter = nonce + 0x00000002 (16 bytes total)
      var counter = nonce.slice();
      counter.push(0, 0, 0, 2);

      // Derive key
      var keyBytes = this.sha256bytes("Xot36i3lK3:v1");

      // Decrypt
      var plainBytes = this.aesCtrDecrypt(ciphertext, keyBytes, counter);
      var plain = "";
      for (var i = 0; i < plainBytes.length; i++) {
        plain += String.fromCharCode(plainBytes[i]);
      }

      // Extract {sourceUrl, sourceName} pairs from decrypted JSON
      var sources = [];
      var seen = {};
      // Pattern 1: sourceUrl before sourceName
      var rx1 = /"sourceUrl"\s*:\s*"([^"]+)"[^{}]*?"sourceName"\s*:\s*"([^"]+)"/g;
      var m;
      while ((m = rx1.exec(plain)) !== null) {
        if (!seen[m[1]]) { seen[m[1]] = true; sources.push({ sourceUrl: m[1], sourceName: m[2] }); }
      }
      // Pattern 2: sourceName before sourceUrl
      var rx2 = /"sourceName"\s*:\s*"([^"]+)"[^{}]*?"sourceUrl"\s*:\s*"([^"]+)"/g;
      while ((m = rx2.exec(plain)) !== null) {
        if (!seen[m[2]]) { seen[m[2]] = true; sources.push({ sourceUrl: m[2], sourceName: m[1] }); }
      }
      return sources;
    } catch (e) {
      return [];
    }
  }

  // ── External extractors ────────────────────────────────────────────────────

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
