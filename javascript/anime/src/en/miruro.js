const mangayomiSources = [
  {
    "name": "Miruro",
    "id": 617345892,
    "baseUrl": "https://www.miruro.to",
    "lang": "en",
    "typeSource": "single",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://www.miruro.to",
    "dateFormat": "",
    "dateFormatLocale": "",
    "isNsfw": false,
    "hasCloudflare": false,
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/miruro.js",
    "apiUrl": "",
    "version": "3.0.0",
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

// References:
//   mo7-mmed/Miruro-API  — pipe protocol & endpoint details
//   aryaniiil/anime-api  — multi-URL fallback & provider ordering

class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
  }

  get ua() {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
  }

  getPref(key) {
    return new SharedPreferences().get(key);
  }

  // ── Base64url helpers ─────────────────────────────────────────────────────

  b64urlDecode(str) {
    str = str.replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4 !== 0) str += "=";
    var alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var lut = {};
    for (var i = 0; i < alpha.length; i++) lut[alpha[i]] = i;
    var out = [];
    for (var i = 0; i < str.length; i += 4) {
      var a = lut[str[i]] | 0, b = lut[str[i + 1]] | 0;
      var c2 = str[i + 2], c3 = str[i + 3];
      var c = c2 !== "=" ? (lut[c2] | 0) : 0;
      var d = c3 !== "=" ? (lut[c3] | 0) : 0;
      out.push((a << 2) | (b >> 4));
      if (c2 !== "=") out.push(((b & 0xF) << 4) | (c >> 2));
      if (c3 !== "=") out.push(((c & 3) << 6) | d);
    }
    return out;
  }

  b64urlEncode(bytes) {
    var alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var out = "";
    for (var i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i];
      var b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
      var b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      out += alpha[b0 >> 2];
      out += alpha[((b0 & 3) << 4) | (b1 >> 4)];
      out += i + 1 < bytes.length ? alpha[((b1 & 0xF) << 2) | (b2 >> 6)] : "=";
      out += i + 2 < bytes.length ? alpha[b2 & 0x3F] : "=";
    }
    return out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }

  // ── UTF-8 helpers ─────────────────────────────────────────────────────────

  strToBytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      } else {
        out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
      }
    }
    return out;
  }

  bytesToStr(bytes) {
    var out = "";
    var i = 0;
    while (i < bytes.length) {
      var b = bytes[i++];
      if (b < 0x80) {
        out += String.fromCharCode(b);
      } else if ((b & 0xE0) === 0xC0) {
        out += String.fromCharCode(((b & 0x1F) << 6) | (bytes[i++] & 0x3F));
      } else if ((b & 0xF0) === 0xE0) {
        var b2 = bytes[i++], b3 = bytes[i++];
        out += String.fromCharCode(((b & 0xF) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F));
      } else {
        var b2 = bytes[i++], b3 = bytes[i++], b4 = bytes[i++];
        var cp = ((b & 7) << 18) | ((b2 & 0x3F) << 12) | ((b3 & 0x3F) << 6) | (b4 & 0x3F);
        cp -= 0x10000;
        out += String.fromCharCode(0xD800 | (cp >> 10), 0xDC00 | (cp & 0x3FF));
      }
    }
    return out;
  }

  // Encode a plain string as base64url (used for episodeId in sources requests)
  encodeStr(str) {
    return this.b64urlEncode(this.strToBytes(str));
  }

  // Decode a base64url episode ID; if decoded form contains ':', return decoded plain text.
  // Per reference: walterwhite-69/Miruro-API _translate_id logic.
  decodeEpId(id) {
    try {
      var decoded = this.bytesToStr(this.b64urlDecode(id));
      if (decoded.indexOf(":") >= 0) return decoded;
    } catch (e) {}
    return id;
  }

  // ── gzip INFLATE (RFC 1951/1952) — QuickJS compatible ────────────────────
  // No Array.fill, no for...of, no nullish coalescing.
  // Based on standard DEFLATE spec; verified against miruro pipe responses.

  inflate(data) {
    if (data[0] !== 0x1F || data[1] !== 0x8B) throw new Error("not gzip");
    var flg = data[3], pos = 10;
    if (flg & 4)  { var xlen = data[pos] | (data[pos + 1] << 8); pos += 2 + xlen; }
    if (flg & 8)  { while (data[pos++] !== 0) {} }
    if (flg & 16) { while (data[pos++] !== 0) {} }
    if (flg & 2)  { pos += 2; }

    var out = [];
    var bp = pos, bb = 0, bl = 0;

    function readBit() {
      if (bl === 0) { bb = data[bp++]; bl = 8; }
      var bit = bb & 1; bb >>>= 1; bl--;
      return bit;
    }
    function readBits(n) {
      var v = 0;
      for (var i = 0; i < n; i++) v |= (readBit() << i);
      return v;
    }
    function buildTree(lens) {
      var maxLen = 0;
      for (var i = 0; i < lens.length; i++) if (lens[i] > maxLen) maxLen = lens[i];
      if (maxLen === 0) return { t: {}, m: 0 };
      var blCount = [];
      for (var i = 0; i <= maxLen; i++) blCount.push(0);
      for (var i = 0; i < lens.length; i++) if (lens[i] > 0) blCount[lens[i]]++;
      var nextCode = [];
      for (var i = 0; i <= maxLen + 1; i++) nextCode.push(0);
      var code = 0;
      for (var bits = 1; bits <= maxLen; bits++) {
        code = (code + blCount[bits - 1]) << 1;
        nextCode[bits] = code;
      }
      var t = {};
      for (var i = 0; i < lens.length; i++) {
        var len = lens[i];
        if (len > 0) {
          if (!t[len]) t[len] = {};
          t[len][nextCode[len]] = i;
          nextCode[len]++;
        }
      }
      return { t: t, m: maxLen };
    }
    function decSym(tree) {
      var code = 0;
      for (var len = 1; len <= tree.m; len++) {
        code = (code << 1) | readBit();
        if (tree.t[len] !== undefined && tree.t[len][code] !== undefined) return tree.t[len][code];
      }
      throw new Error("bad huffman code");
    }

    var LB = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
    var LE = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
    var DB = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
    var DE = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];

    function decomp(litT, distT) {
      while (true) {
        var sym = decSym(litT);
        if (sym < 256) {
          out.push(sym);
        } else if (sym === 256) {
          break;
        } else {
          var idx = sym - 257;
          var length = LB[idx] + readBits(LE[idx]);
          var dsym = decSym(distT);
          var dist = DB[dsym] + readBits(DE[dsym]);
          var start = out.length - dist;
          for (var k = 0; k < length; k++) out.push(out[start + k]);
        }
      }
    }

    var done = false;
    while (!done) {
      var bfinal = readBit();
      var btype  = readBits(2);
      if (btype === 0) {
        bl = 0;
        var len = data[bp] | (data[bp + 1] << 8);
        bp += 4;
        for (var i = 0; i < len; i++) out.push(data[bp++]);
      } else if (btype === 1) {
        var ll = [];
        for (var i = 0; i <= 143; i++) ll.push(8);
        for (var i = 144; i <= 255; i++) ll.push(9);
        for (var i = 256; i <= 279; i++) ll.push(7);
        for (var i = 280; i <= 287; i++) ll.push(8);
        var dl = [];
        for (var i = 0; i < 30; i++) dl.push(5);
        decomp(buildTree(ll), buildTree(dl));
      } else if (btype === 2) {
        var hlit  = readBits(5) + 257;
        var hdist = readBits(5) + 1;
        var hclen = readBits(4) + 4;
        var clOrd = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
        var clLen = [];
        for (var i = 0; i < 19; i++) clLen.push(0);
        for (var i = 0; i < hclen; i++) clLen[clOrd[i]] = readBits(3);
        var clT = buildTree(clLen);
        var all = [];
        while (all.length < hlit + hdist) {
          var sym = decSym(clT);
          if (sym < 16) {
            all.push(sym);
          } else if (sym === 16) {
            var cnt = readBits(2) + 3;
            var prev = all.length > 0 ? all[all.length - 1] : 0;
            for (var i = 0; i < cnt; i++) all.push(prev);
          } else if (sym === 17) {
            var cnt = readBits(3) + 3;
            for (var i = 0; i < cnt; i++) all.push(0);
          } else {
            var cnt = readBits(7) + 11;
            for (var i = 0; i < cnt; i++) all.push(0);
          }
        }
        decomp(buildTree(all.slice(0, hlit)), buildTree(all.slice(hlit)));
      } else {
        throw new Error("invalid block type");
      }
      if (bfinal) done = true;
    }
    return out;
  }

  // ── Miruro secure pipe ────────────────────────────────────────────────────
  // Protocol (mo7-mmed/Miruro-API, aryaniiil/anime-api):
  //   Request : GET /api/secure/pipe?e={base64url(JSON(payload))}
  //   Response: base64url(gzip(JSON)) — decoded + decompressed client-side
  // Tries miruro.to → miruro.tv → miruro.bz in order.

  async callPipe(path, query) {
    var payload = JSON.stringify({ path: path, method: "GET", query: query, body: null, version: "0.1.0" });
    var e = this.b64urlEncode(this.strToBytes(payload));
    var bases = ["https://www.miruro.to", "https://www.miruro.tv", "https://www.miruro.bz"];
    var lastErr = "no response";
    for (var bi = 0; bi < bases.length; bi++) {
      try {
        var url = bases[bi] + "/api/secure/pipe?e=" + e;
        var res = await this.client.get(url, {
          "User-Agent": this.ua,
          "Referer": "https://www.miruro.to/",
          "Accept": "*/*",
        });
        if (!res || !res.body) { lastErr = "empty body from " + bases[bi]; continue; }
        var body = typeof res.body === "string" ? res.body : String(res.body);
        body = body.replace(/[^A-Za-z0-9+\/=\-_]/g, "");
        if (!body) { lastErr = "blank body from " + bases[bi]; continue; }
        return JSON.parse(this.bytesToStr(this.inflate(this.b64urlDecode(body))));
      } catch (ex) {
        lastErr = bases[bi] + ": " + String(ex);
      }
    }
    throw new Error("pipe failed: " + lastErr);
  }

  // ── AniList GraphQL ───────────────────────────────────────────────────────

  async anilist(query, variables) {
    var res = await this.client.post(
      "https://graphql.anilist.co",
      { "Content-Type": "application/json", "Accept": "application/json" },
      { query: query, variables: variables }
    );
    return JSON.parse(res.body).data;
  }

  getTitle(title) {
    if (!title) return "Unknown";
    var pref = this.getPref("miruro_title") || "english";
    return title[pref] || title.english || title.romaji || "Unknown";
  }

  parseMediaList(media) {
    var out = [];
    for (var i = 0; i < media.length; i++) {
      var m = media[i];
      out.push({
        name:     this.getTitle(m.title),
        link:     String(m.id),
        imageUrl: (m.coverImage && m.coverImage.large) || "",
      });
    }
    return out;
  }

  // ── Browse ────────────────────────────────────────────────────────────────

  async getPopular(page) {
    var gql = "query($p:Int,$pp:Int){Page(page:$p,perPage:$pp){pageInfo{hasNextPage}media(sort:[TRENDING_DESC],type:ANIME,isAdult:false){id title{romaji english}coverImage{large}}}}";
    var d = await this.anilist(gql, { p: page, pp: 20 });
    var pg = d.Page || {};
    return { list: this.parseMediaList(pg.media || []), hasNextPage: !!(pg.pageInfo && pg.pageInfo.hasNextPage) };
  }

  async getLatestUpdates(page) {
    var gql = "query($p:Int,$pp:Int){Page(page:$p,perPage:$pp){pageInfo{hasNextPage}media(sort:[UPDATED_AT_DESC],type:ANIME,status:RELEASING,isAdult:false){id title{romaji english}coverImage{large}}}}";
    var d = await this.anilist(gql, { p: page, pp: 20 });
    var pg = d.Page || {};
    return { list: this.parseMediaList(pg.media || []), hasNextPage: !!(pg.pageInfo && pg.pageInfo.hasNextPage) };
  }

  async search(query, page, filters) {
    var conds = ["type:ANIME", "isAdult:false"];
    var args  = "$p:Int,$pp:Int";
    var vars  = { p: page, pp: 20 };

    if (query && query.length > 0) {
      conds.push("search:$q"); args += ",$q:String"; vars.q = query;
    } else {
      conds.push("sort:TRENDING_DESC");
    }

    if (filters && Array.isArray(filters)) {
      for (var fi = 0; fi < filters.length; fi++) {
        var f = filters[fi];
        if (f.type_name === "SelectFilter" && f.state > 0) {
          var v = f.values[f.state].value;
          if      (f.name === "Season" && v) { conds.push("season:$season");   args += ",$season:MediaSeason"; vars.season = v; }
          else if (f.name === "Format" && v) { conds.push("format:$format");   args += ",$format:MediaFormat"; vars.format = v; }
          else if (f.name === "Status" && v) { conds.push("status:$status");   args += ",$status:MediaStatus"; vars.status = v; }
          else if (f.name === "Year"   && v) { conds.push("seasonYear:$year"); args += ",$year:Int";           vars.year = parseInt(v); }
          else if (f.name === "Sort"   && v) { conds.push("sort:[$sort]");     args += ",$sort:[MediaSort]";   vars.sort = [v]; }
        } else if (f.type_name === "GroupFilter") {
          var genres = [];
          var gs = f.state || [];
          for (var gi = 0; gi < gs.length; gi++) { if (gs[gi].state === true) genres.push(gs[gi].value); }
          if (genres.length > 0) { conds.push("genre_in:$genres"); args += ",$genres:[String]"; vars.genres = genres; }
        }
      }
    }

    var gql = "query(" + args + "){Page(page:$p,perPage:$pp){pageInfo{hasNextPage}media(" + conds.join(",") + "){id title{romaji english}coverImage{large}}}}";
    var d   = await this.anilist(gql, vars);
    var pg  = d.Page || {};
    return { list: this.parseMediaList(pg.media || []), hasNextPage: !!(pg.pageInfo && pg.pageInfo.hasNextPage) };
  }

  // ── Detail ────────────────────────────────────────────────────────────────

  async getDetail(url) {
    var animeId = parseInt(url, 10);
    if (!animeId) throw new Error("invalid id: " + url);

    var gql = "query($id:Int){Media(id:$id,type:ANIME){id title{romaji english native}coverImage{large extraLarge}description status genres}}";
    var d   = await this.anilist(gql, { id: animeId });
    var m   = d.Media;

    var statusMap = { RELEASING: 0, FINISHED: 1, NOT_YET_RELEASED: 4, CANCELLED: 5, HIATUS: 5 };
    var status = statusMap[m.status] !== undefined ? statusMap[m.status] : 5;

    // Fetch episodes via miruro pipe (mo7-mmed/Miruro-API approach)
    var epMap = {}, pipeErr = null;
    try {
      var pipeData = await this.callPipe("episodes", { anilistId: animeId });
      var providers = pipeData.providers || {};
      var provKeys  = Object.keys(providers);
      for (var pi = 0; pi < provKeys.length; pi++) {
        var prov   = provKeys[pi];
        var catMap = providers[prov].episodes || {};
        var catKeys = Object.keys(catMap);
        for (var ci = 0; ci < catKeys.length; ci++) {
          var cat = catKeys[ci];
          var eps = catMap[cat] || [];
          for (var ei = 0; ei < eps.length; ei++) {
            var ep  = eps[ei];
            var num = ep.number || (ei + 1);
            // Decode the episode ID (base64url → plain text if it contains ':')
            var epId = this.decodeEpId(ep.id || String(num));
            if (!epMap[num]) {
              epMap[num] = {
                animeId: animeId,
                num:     num,
                title:   ep.title || "",
                filler:  !!ep.filler,
                ids:     {},
              };
            }
            if (!epMap[num].ids[prov]) epMap[num].ids[prov] = {};
            epMap[num].ids[prov][cat] = epId;
          }
        }
      }
    } catch (ex) {
      pipeErr = String(ex);
    }

    var chapters = [];
    var nums = Object.keys(epMap).map(Number).sort(function(a, b) { return a - b; });
    for (var ni = 0; ni < nums.length; ni++) {
      var ep = epMap[nums[ni]];
      chapters.push({
        name:     ep.title ? ("Episode " + ep.num + ": " + ep.title) : ("Episode " + ep.num),
        url:      JSON.stringify(ep),
        isFiller: ep.filler,
      });
    }

    if (chapters.length === 0) {
      var msg = pipeErr ? ("Error: " + pipeErr) : "No episodes on Miruro";
      chapters.push({ name: msg, url: "n/a", isFiller: false });
    }

    chapters.reverse();

    return {
      name:        this.getTitle(m.title),
      imageUrl:    (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large)) || "",
      description: (m.description || "").replace(/<[^>]+>/g, ""),
      genre:       m.genres || [],
      status:      status,
      link:        "https://www.miruro.to/watch/" + animeId,
      chapters:    chapters,
    };
  }

  // ── Streaming ─────────────────────────────────────────────────────────────
  // Provider/audio ordering from aryaniiil/anime-api:
  //   ranking = ["zoro","bee","telli","arc","yugen","jet","neo","kiwi"]

  async getVideoList(url) {
    if (!url || url === "n/a") return [];
    var info;
    try { info = JSON.parse(url); } catch (e) { return []; }

    var animeId = info.animeId;
    var ids     = info.ids || {};

    var audioPref = this.getPref("miruro_audio") || "sub";
    var cats = audioPref === "dub" ? ["dub", "sub"] : ["sub", "dub"];

    var provPref = this.getPref("miruro_providers") || [];
    if (!provPref || provPref.length === 0) {
      provPref = ["kiwi", "arc", "ally", "bee", "dune"];
    }

    // Build ordered (provider, category) pairs — preferred providers first,
    // then any remaining providers found in the episode's id map.
    var pairs = [];

    for (var ci = 0; ci < cats.length; ci++) {
      for (var pi = 0; pi < provPref.length; pi++) {
        var prov = provPref[pi];
        if (ids[prov] && ids[prov][cats[ci]]) pairs.push([prov, cats[ci]]);
      }
    }

    var allProvs = Object.keys(ids);
    for (var ci = 0; ci < cats.length; ci++) {
      for (var pi = 0; pi < allProvs.length; pi++) {
        var prov = allProvs[pi];
        var inPref = false;
        for (var qi = 0; qi < provPref.length; qi++) { if (provPref[qi] === prov) { inPref = true; break; } }
        if (!inPref && ids[prov] && ids[prov][cats[ci]]) pairs.push([prov, cats[ci]]);
      }
    }

    var streams = [];
    for (var oi = 0; oi < pairs.length; oi++) {
      var prov = pairs[oi][0], cat = pairs[oi][1];
      var epId = ids[prov][cat];
      try {
        // episodeId must be re-encoded as base64url (reference: aryaniiil/anime-api get_sources)
        var data = await this.callPipe("sources", {
          episodeId: this.encodeStr(epId),
          provider:  prov,
          category:  cat,
          anilistId: animeId,
        });

        var srcs = data.streams || data.sources || [];
        var subs = data.subtitles || [];

        var subtitles = [];
        for (var ti = 0; ti < subs.length; ti++) {
          var t = subs[ti];
          if (t.file || t.url) subtitles.push({ file: t.file || t.url, label: t.label || t.lang || "Sub" });
        }

        for (var si = 0; si < srcs.length; si++) {
          var src = srcs[si];
          var streamUrl = src.url || src.file;
          if (!streamUrl) continue;
          var entry = {
            url:         streamUrl,
            originalUrl: streamUrl,
            quality:     (src.quality || "Auto") + " [" + cat.toUpperCase() + " · " + prov + "]",
            headers:     { "User-Agent": this.ua, "Referer": "https://www.miruro.to/" },
          };
          if (subtitles.length > 0) entry.subtitles = subtitles;
          streams.push(entry);
        }
      } catch (ex) {}
    }

    return streams;
  }

  // ── Filters ───────────────────────────────────────────────────────────────

  getFilterList() {
    return [
      {
        type_name: "SelectFilter", name: "Sort", state: 0,
        values: [
          { type_name: "SelectOption", name: "Trending",   value: "TRENDING_DESC"   },
          { type_name: "SelectOption", name: "Popularity", value: "POPULARITY_DESC" },
          { type_name: "SelectOption", name: "Score",      value: "SCORE_DESC"      },
          { type_name: "SelectOption", name: "Newest",     value: "START_DATE_DESC" },
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
        ],
      },
    ];
  }

  // ── Preferences ───────────────────────────────────────────────────────────

  getSourcePreferences() {
    return [
      {
        key: "miruro_title",
        listPreference: {
          title:       "Title language",
          summary:     "Language used for anime titles",
          valueIndex:  0,
          entries:     ["English", "Romaji", "Native"],
          entryValues: ["english", "romaji", "native"],
        },
      },
      {
        key: "miruro_audio",
        listPreference: {
          title:       "Preferred audio",
          summary:     "Sub or Dub shown first in stream list",
          valueIndex:  0,
          entries:     ["Sub", "Dub"],
          entryValues: ["sub", "dub"],
        },
      },
      {
        key: "miruro_providers",
        multiSelectListPreference: {
          title:       "Preferred providers",
          summary:     "Providers to try first (others are tried automatically)",
          values:      ["kiwi", "arc", "ally", "bee"],
          entries:     ["Kiwi", "Arc", "Ally", "Bee", "Dune"],
          entryValues: ["kiwi", "arc", "ally", "bee", "dune"],
        },
      },
    ];
  }
}
