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
    "version": "2.2.2",
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

// Metadata : AniList GraphQL API
// Episodes : miruro.tv secure pipe  — GET /api/secure/pipe?e={base64url(JSON)}
// Response : base64url(gzip(JSON)) decoded client-side
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

  // ── Base64url helpers ─────────────────────────────────────────────────────

  // Byte array → base64url string (no padding)
  bytesToB64url(bytes) {
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var result = "";
    for (var i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i];
      var b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
      var b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      result += chars[b0 >> 2];
      result += chars[((b0 & 3) << 4) | (b1 >> 4)];
      result += i + 1 < bytes.length ? chars[((b1 & 0xF) << 2) | (b2 >> 6)] : "=";
      result += i + 2 < bytes.length ? chars[b2 & 0x3F] : "=";
    }
    return result.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }

  // base64url string → byte array
  b64urlToBytes(str) {
    str = str.replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4 !== 0) str += "=";
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var lookup = {};
    for (var i = 0; i < 64; i++) lookup[chars[i]] = i;
    var bytes = [];
    for (var i = 0; i < str.length; i += 4) {
      var b0 = lookup[str[i]] | 0;
      var b1 = lookup[str[i + 1]] | 0;
      var hasB2 = str[i + 2] !== "=";
      var hasB3 = str[i + 3] !== "=";
      var b2 = hasB2 ? (lookup[str[i + 2]] | 0) : 0;
      var b3 = hasB3 ? (lookup[str[i + 3]] | 0) : 0;
      bytes.push((b0 << 2) | (b1 >> 4));
      if (hasB2) bytes.push(((b1 & 0xF) << 4) | (b2 >> 2));
      if (hasB3) bytes.push(((b2 & 3) << 6) | b3);
    }
    return bytes;
  }

  // UTF-8 string → byte array
  strToUtf8(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) {
        bytes.push(c);
      } else if (c < 0x800) {
        bytes.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      } else {
        bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
      }
    }
    return bytes;
  }

  // UTF-8 byte array → string
  utf8Decode(bytes) {
    var result = "";
    var i = 0;
    while (i < bytes.length) {
      var b = bytes[i++];
      if (b < 0x80) {
        result += String.fromCharCode(b);
      } else if ((b & 0xE0) === 0xC0) {
        result += String.fromCharCode(((b & 0x1F) << 6) | (bytes[i++] & 0x3F));
      } else if ((b & 0xF0) === 0xE0) {
        var b2 = bytes[i++], b3 = bytes[i++];
        result += String.fromCharCode(((b & 0xF) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F));
      } else if ((b & 0xF8) === 0xF0) {
        var b2 = bytes[i++], b3 = bytes[i++], b4 = bytes[i++];
        var cp = ((b & 7) << 18) | ((b2 & 0x3F) << 12) | ((b3 & 0x3F) << 6) | (b4 & 0x3F);
        cp -= 0x10000;
        result += String.fromCharCode(0xD800 | (cp >> 10), 0xDC00 | (cp & 0x3FF));
      }
    }
    return result;
  }

  // Encode an object as base64url(UTF-8(JSON)) for pipe requests
  encodePipePayload(payload) {
    return this.bytesToB64url(this.strToUtf8(JSON.stringify(payload)));
  }

  // Translate an episode id that might be base64url-encoded.
  // If decoding reveals a string containing ':', use the decoded form.
  // Otherwise keep the raw id. (Mirrors walterwhite-69/Miruro-API _translate_id)
  translateEpId(id) {
    try {
      var decoded = this.utf8Decode(this.b64urlToBytes(id));
      if (decoded.indexOf(":") >= 0) return decoded;
    } catch (e) {}
    return id;
  }

  // base64url-encode a plain string (for episodeId field in sources payload)
  b64urlStr(str) {
    return this.bytesToB64url(this.strToUtf8(str));
  }

  // ── gzip INFLATE (pure JS, RFC 1951 / RFC 1952) ───────────────────────────

  inflate(data) {
    if (data[0] !== 0x1F || data[1] !== 0x8B) throw new Error("not gzip");
    var flg = data[3];
    var pos = 10;
    if (flg & 4)  { var xlen = data[pos] | (data[pos + 1] << 8); pos += 2 + xlen; }
    if (flg & 8)  { while (data[pos++] !== 0) {} }
    if (flg & 16) { while (data[pos++] !== 0) {} }
    if (flg & 2)  { pos += 2; }

    var output = [];
    var bytePos = pos;
    var bitBuf = 0, bitLen = 0;

    function readBit() {
      if (bitLen === 0) { bitBuf = data[bytePos++]; bitLen = 8; }
      var bit = bitBuf & 1; bitBuf >>>= 1; bitLen--;
      return bit;
    }

    function readBits(n) {
      var v = 0;
      for (var i = 0; i < n; i++) v |= (readBit() << i);
      return v;
    }

    function buildTree(lengths) {
      var maxLen = 0;
      for (var i = 0; i < lengths.length; i++) if (lengths[i] > maxLen) maxLen = lengths[i];
      if (maxLen === 0) return { table: {}, maxLen: 0 };
      var blCount = [];
      for (var fi = 0; fi <= maxLen; fi++) blCount.push(0);
      for (var i = 0; i < lengths.length; i++) if (lengths[i] > 0) blCount[lengths[i]]++;
      var nextCode = [];
      for (var fi = 0; fi <= maxLen + 1; fi++) nextCode.push(0);
      var code = 0;
      for (var bits = 1; bits <= maxLen; bits++) {
        code = (code + blCount[bits - 1]) << 1;
        nextCode[bits] = code;
      }
      var table = {};
      for (var i = 0; i < lengths.length; i++) {
        var len = lengths[i];
        if (len > 0) {
          if (!table[len]) table[len] = {};
          table[len][nextCode[len]] = i;
          nextCode[len]++;
        }
      }
      return { table: table, maxLen: maxLen };
    }

    function decodeSymbol(tree) {
      var code = 0;
      for (var len = 1; len <= tree.maxLen; len++) {
        code = (code << 1) | readBit();
        if (tree.table[len] !== undefined && tree.table[len][code] !== undefined) {
          return tree.table[len][code];
        }
      }
      throw new Error("invalid Huffman code");
    }

    var lenBase  = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
    var lenExtra = [0,0,0,0,0,0,0,0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4,  4,  5,  5,  5,  5,  0];
    var distBase  = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
    var distExtra = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,  6,  6,  7,  7,  8,  8,   9,   9,  10,  10,  11,  11,  12,   12,   13,   13];

    function decompressBlock(litTree, distTree) {
      while (true) {
        var sym = decodeSymbol(litTree);
        if (sym < 256) {
          output.push(sym);
        } else if (sym === 256) {
          break;
        } else {
          var idx = sym - 257;
          var length = lenBase[idx] + readBits(lenExtra[idx]);
          var distSym = decodeSymbol(distTree);
          var dist = distBase[distSym] + readBits(distExtra[distSym]);
          var start = output.length - dist;
          for (var k = 0; k < length; k++) output.push(output[start + k]);
        }
      }
    }

    var done = false;
    while (!done) {
      var bfinal = readBit();
      var btype  = readBits(2);

      if (btype === 0) {
        bitLen = 0;
        var len = data[bytePos] | (data[bytePos + 1] << 8);
        bytePos += 4;
        for (var i = 0; i < len; i++) output.push(data[bytePos++]);

      } else if (btype === 1) {
        var litLengths = [];
        for (var i =   0; i <= 143; i++) litLengths.push(8);
        for (var i = 144; i <= 255; i++) litLengths.push(9);
        for (var i = 256; i <= 279; i++) litLengths.push(7);
        for (var i = 280; i <= 287; i++) litLengths.push(8);
        var distLengths = [];
        for (var i = 0; i < 30; i++) distLengths.push(5);
        decompressBlock(buildTree(litLengths), buildTree(distLengths));

      } else if (btype === 2) {
        var hlit  = readBits(5) + 257;
        var hdist = readBits(5) + 1;
        var hclen = readBits(4) + 4;
        var clOrder = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
        var clLengths = [];
        for (var fi = 0; fi < 19; fi++) clLengths.push(0);
        for (var i = 0; i < hclen; i++) clLengths[clOrder[i]] = readBits(3);
        var clTree = buildTree(clLengths);
        var allLengths = [];
        while (allLengths.length < hlit + hdist) {
          var sym = decodeSymbol(clTree);
          if (sym < 16) {
            allLengths.push(sym);
          } else if (sym === 16) {
            var count = readBits(2) + 3;
            var prev = allLengths.length > 0 ? allLengths[allLengths.length - 1] : 0;
            for (var i = 0; i < count; i++) allLengths.push(prev);
          } else if (sym === 17) {
            var count = readBits(3) + 3;
            for (var i = 0; i < count; i++) allLengths.push(0);
          } else {
            var count = readBits(7) + 11;
            for (var i = 0; i < count; i++) allLengths.push(0);
          }
        }
        decompressBlock(buildTree(allLengths.slice(0, hlit)), buildTree(allLengths.slice(hlit)));

      } else {
        throw new Error("invalid DEFLATE block type");
      }

      if (bfinal) done = true;
    }
    return output;
  }

  // ── Miruro secure pipe ────────────────────────────────────────────────────
  // Protocol (from walterwhite-69/Miruro-API reverse engineering):
  //   Request : GET https://www.miruro.tv/api/secure/pipe?e={base64url(json(payload))}
  //   Response: base64url(gzip(json)) — decoded + decompressed client-side

  async callMiruPipe(path, query) {
    var payload = { path: path, method: "GET", query: query, body: null, version: "0.1.0" };
    var e = this.encodePipePayload(payload);
    var url = "https://www.miruro.tv/api/secure/pipe?e=" + e;
    var res = await this.client.get(url, {
      "User-Agent": this.ua,
      "Referer": "https://www.miruro.tv/",
      "Accept": "*/*",
    });
    if (!res || !res.body) throw new Error("empty pipe response");
    var body = (typeof res.body === "string") ? res.body.trim() : String(res.body).trim();
    var bytes = this.b64urlToBytes(body);
    var decompressed = this.inflate(bytes);
    return JSON.parse(this.utf8Decode(decompressed));
  }

  // ── AniList GraphQL ───────────────────────────────────────────────────────

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
    return { RELEASING: 0, FINISHED: 1, NOT_YET_RELEASED: 4, CANCELLED: 5, HIATUS: 5 }[s] ?? 5;
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
      for (var fi = 0; fi < filters.length; fi++) {
        var f = filters[fi];
        if (f.type_name === "SelectFilter" && f.state > 0) {
          var v = f.values[f.state].value;
          if      (f.name === "Season" && v) { conditions.push("season:$season");     args += ",$season:MediaSeason";  variables.season = v;           }
          else if (f.name === "Format" && v) { conditions.push("format:$format");     args += ",$format:MediaFormat";  variables.format = v;           }
          else if (f.name === "Status" && v) { conditions.push("status:$status");     args += ",$status:MediaStatus";  variables.status = v;           }
          else if (f.name === "Year"   && v) { conditions.push("seasonYear:$year");   args += ",$year:Int";            variables.year   = parseInt(v); }
          else if (f.name === "Sort"   && v) { conditions.push("sort:[$sort]");       args += ",$sort:[MediaSort]";    variables.sort   = [v];         }
        } else if (f.type_name === "GroupFilter") {
          var genres = [];
          var stateArr = f.state || [];
          for (var si = 0; si < stateArr.length; si++) {
            if (stateArr[si].state === true) genres.push(stateArr[si].value);
          }
          if (genres.length > 0) { conditions.push("genre_in:$genres"); args += ",$genres:[String]"; variables.genres = genres; }
        }
      }
    }

    var q = "query(" + args + "){Page(page:$page,perPage:$perPage){pageInfo{hasNextPage}media(" + conditions.join(",") + "){id title{romaji english native userPreferred}coverImage{large}}}}";
    var data = await this.anilist(q, variables);
    return this.parseAnilistPage(data);
  }

  // ── Anime detail ──────────────────────────────────────────────────────────

  async getDetail(url) {
    var animeId = parseInt(url.replace(/\D/g, ""), 10);
    if (!animeId) throw new Error("Invalid AniList ID: " + url);

    var q = "query($id:Int){Media(id:$id,type:ANIME){id title{romaji english native userPreferred}coverImage{large extraLarge}description status genres episodes format}}";
    var data = await this.anilist(q, { id: animeId });
    var m = data.Media;

    var name        = this.getTitle(m.title);
    var imageUrl    = (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large)) || "";
    var description = (m.description || "").replace(/<[^>]+>/g, "");
    var status      = this.anilistStatusCode(m.status);
    var genre       = m.genres || [];

    // episodeMap[epNum] = { animeId, num, title, filler, ids: {provider: {sub: id, dub: id}} }
    var episodeMap = {};

    try {
      var epData    = await this.callMiruPipe("episodes", { anilistId: animeId });
      var providers = epData.providers || {};

      var providerKeys = Object.keys(providers);
      for (var pi = 0; pi < providerKeys.length; pi++) {
        var provider = providerKeys[pi];
        var catMap   = providers[provider].episodes || {};
        var catKeys  = Object.keys(catMap); // "sub", "dub"

        for (var ci = 0; ci < catKeys.length; ci++) {
          var category = catKeys[ci];
          var eps      = catMap[category] || [];

          for (var ei = 0; ei < eps.length; ei++) {
            var ep  = eps[ei];
            var num = ep.number || (ei + 1);
            var rawId = ep.id || ep.episodeId || String(num);
            // Normalise: if the id is base64url-encoded and decodes to a string
            // containing ':', use the decoded form (matches miruro's internal format)
            var translatedId = this.translateEpId(rawId);

            if (!episodeMap[num]) {
              episodeMap[num] = {
                animeId: animeId,
                num:     num,
                title:   ep.title || ep.name || "",
                filler:  !!(ep.filler || ep.isFiller),
                ids:     {},
              };
            }
            if (!episodeMap[num].ids[provider]) episodeMap[num].ids[provider] = {};
            episodeMap[num].ids[provider][category] = translatedId;
          }
        }
      }
    } catch (e) {}

    // Sort numerically and build chapters
    var chapters = [];
    var nums = Object.keys(episodeMap).map(Number).sort(function(a, b) { return a - b; });
    for (var ni = 0; ni < nums.length; ni++) {
      var ep = episodeMap[nums[ni]];
      var epName = ep.title ? ("Episode " + ep.num + ": " + ep.title) : ("Episode " + ep.num);
      chapters.push({
        name:     epName,
        url:      JSON.stringify(ep),
        isFiller: ep.filler,
      });
    }

    chapters.reverse();
    return {
      name, imageUrl, description, genre, status,
      link: this.source.baseUrl + "/info/" + animeId,
      chapters,
    };
  }

  // ── Streaming ─────────────────────────────────────────────────────────────

  async getVideoList(url) {
    if (url === "unavailable") return [];

    var info;
    try { info = JSON.parse(url); } catch (e) { return []; }

    var animeId  = info.animeId;
    var ids      = info.ids || {};  // {provider: {sub: id, dub: id}}

    var providerPref = this.getPreference("miruro_pref_providers");
    if (!providerPref || providerPref.length === 0) providerPref = ["kiwi", "arc", "zoro"];

    var audioPref  = this.getPreference("miruro_pref_audio") || "sub";
    var categories = audioPref === "dub" ? ["dub", "sub"] : ["sub", "dub"];

    var streams = [];
    var headers = { "User-Agent": this.ua, "Referer": "https://www.miruro.tv/" };

    for (var ci = 0; ci < categories.length; ci++) {
      var category = categories[ci];
      for (var pi = 0; pi < providerPref.length; pi++) {
        var provider = providerPref[pi];
        var provIds  = ids[provider];
        if (!provIds) continue;
        var episodeId = provIds[category];
        if (!episodeId) continue;

        try {
          var data = await this.callMiruPipe("sources", {
            // episodeId must be base64url-encoded (the translated raw id → encoded)
            episodeId: this.b64urlStr(episodeId),
            provider:  provider,
            category:  category,
            anilistId: animeId,
          });

          var sources  = data.streams  || data.sources || data.links || [];
          var tracks   = data.subtitles || data.tracks || [];

          var subtitles = [];
          for (var ti = 0; ti < tracks.length; ti++) {
            var track = tracks[ti];
            var file  = track.file || track.url || track.src;
            if (file) subtitles.push({ file: file, label: track.label || track.lang || "Unknown" });
          }

          for (var si = 0; si < sources.length; si++) {
            var src       = sources[si];
            var streamUrl = src.url || src.file || src.link || src.src;
            if (!streamUrl) continue;

            var quality = src.quality || src.resolution || src.label || "Auto";
            var label   = quality + " [" + category.toUpperCase() + " · " + provider + "]";

            var stream = {
              url:         streamUrl,
              originalUrl: streamUrl,
              quality:     label,
              headers:     headers,
            };
            if (subtitles.length > 0) stream.subtitles = subtitles;
            streams.push(stream);
          }
        } catch (e) {}
      }
    }

    return streams;
  }

  // ── Filters & Preferences ─────────────────────────────────────────────────

  getFilterList() {
    return [
      {
        type_name: "SelectFilter", name: "Sort", state: 0,
        values: [
          { type_name: "SelectOption", name: "Trending",   value: "TRENDING_DESC"   },
          { type_name: "SelectOption", name: "Popularity", value: "POPULARITY_DESC" },
          { type_name: "SelectOption", name: "Score",      value: "SCORE_DESC"      },
          { type_name: "SelectOption", name: "Newest",     value: "START_DATE_DESC" },
          { type_name: "SelectOption", name: "Oldest",     value: "START_DATE"      },
        ],
      },
      {
        type_name: "SelectFilter", name: "Season", state: 0,
        values: [
          { type_name: "SelectOption", name: "Any",    value: ""       },
          { type_name: "SelectOption", name: "Winter", value: "WINTER" },
          { type_name: "SelectOption", name: "Spring", value: "SPRING" },
          { type_name: "SelectOption", name: "Summer", value: "SUMMER" },
          { type_name: "SelectOption", name: "Fall",   value: "FALL"   },
        ],
      },
      {
        type_name: "SelectFilter", name: "Format", state: 0,
        values: [
          { type_name: "SelectOption", name: "Any",     value: ""        },
          { type_name: "SelectOption", name: "TV",      value: "TV"      },
          { type_name: "SelectOption", name: "Movie",   value: "MOVIE"   },
          { type_name: "SelectOption", name: "OVA",     value: "OVA"     },
          { type_name: "SelectOption", name: "ONA",     value: "ONA"     },
          { type_name: "SelectOption", name: "Special", value: "SPECIAL" },
        ],
      },
      {
        type_name: "SelectFilter", name: "Status", state: 0,
        values: [
          { type_name: "SelectOption", name: "Any",           value: ""                 },
          { type_name: "SelectOption", name: "Airing",        value: "RELEASING"        },
          { type_name: "SelectOption", name: "Finished",      value: "FINISHED"         },
          { type_name: "SelectOption", name: "Not Yet Aired", value: "NOT_YET_RELEASED" },
        ],
      },
      {
        type_name: "SelectFilter", name: "Year", state: 0,
        values: [
          { type_name: "SelectOption", name: "Any",  value: ""     },
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
          { type_name: "CheckBox", name: "Action",        value: "Action",        state: false },
          { type_name: "CheckBox", name: "Adventure",     value: "Adventure",     state: false },
          { type_name: "CheckBox", name: "Comedy",        value: "Comedy",        state: false },
          { type_name: "CheckBox", name: "Drama",         value: "Drama",         state: false },
          { type_name: "CheckBox", name: "Ecchi",         value: "Ecchi",         state: false },
          { type_name: "CheckBox", name: "Fantasy",       value: "Fantasy",       state: false },
          { type_name: "CheckBox", name: "Horror",        value: "Horror",        state: false },
          { type_name: "CheckBox", name: "Mecha",         value: "Mecha",         state: false },
          { type_name: "CheckBox", name: "Music",         value: "Music",         state: false },
          { type_name: "CheckBox", name: "Mystery",       value: "Mystery",       state: false },
          { type_name: "CheckBox", name: "Psychological", value: "Psychological", state: false },
          { type_name: "CheckBox", name: "Romance",       value: "Romance",       state: false },
          { type_name: "CheckBox", name: "Sci-Fi",        value: "Sci-Fi",        state: false },
          { type_name: "CheckBox", name: "Slice of Life", value: "Slice of Life", state: false },
          { type_name: "CheckBox", name: "Sports",        value: "Sports",        state: false },
          { type_name: "CheckBox", name: "Supernatural",  value: "Supernatural",  state: false },
          { type_name: "CheckBox", name: "Thriller",      value: "Thriller",      state: false },
        ],
      },
    ];
  }

  getSourcePreferences() {
    return [
      {
        key: "miruro_title_lang",
        listPreference: {
          title:       "Preferred title language",
          summary:     "Language for anime titles",
          valueIndex:  0,
          entries:     ["English", "Romaji", "Native", "User Preferred"],
          entryValues: ["english", "romaji", "native", "userPreferred"],
        },
      },
      {
        key: "miruro_pref_audio",
        listPreference: {
          title:       "Preferred audio",
          summary:     "Sub or Dub — shown first in stream list",
          valueIndex:  0,
          entries:     ["Sub", "Dub"],
          entryValues: ["sub", "dub"],
        },
      },
      {
        key: "miruro_pref_providers",
        multiSelectListPreference: {
          title:       "Preferred providers",
          summary:     "Providers to fetch streams from",
          values:      ["kiwi", "arc", "zoro"],
          entries:     ["Kiwi", "Arc", "Zoro", "Jet", "Telli"],
          entryValues: ["kiwi", "arc", "zoro", "jet", "telli"],
        },
      },
    ];
  }
}
