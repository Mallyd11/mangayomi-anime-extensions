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
    "hasCloudflare": true,
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/miruro.js",
    "apiUrl": "",
    "version": "4.17.0",
    "isManga": false,
    "itemType": 1,
    "isFullData": true,
    "appMinVerReq": "0.5.0",
    "additionalParams": "",
    "sourceCodeLanguage": 1,
    "notes": "",
    "pkgPath": "anime/src/en/miruro.js",
  },
];

class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
  }

  get ua() {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
  }

  pref(key) {
    return new SharedPreferences().get(key);
  }

  // ── Base64url ─────────────────────────────────────────────────────────────

  b64dec(str) {
    str = str.replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4 !== 0) str += "=";
    var alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var lut = {};
    for (var i = 0; i < alpha.length; i++) lut[alpha[i]] = i;
    var out = [];
    for (var i = 0; i < str.length; i += 4) {
      var a = lut[str[i]] | 0, b = lut[str[i+1]] | 0;
      var q2 = str[i+2], q3 = str[i+3];
      var c = q2 !== "=" ? lut[q2] | 0 : 0;
      var d = q3 !== "=" ? lut[q3] | 0 : 0;
      out.push((a << 2) | (b >> 4));
      if (q2 !== "=") out.push(((b & 0xF) << 4) | (c >> 2));
      if (q3 !== "=") out.push(((c & 3) << 6) | d);
    }
    return out;
  }

  b64enc(bytes) {
    var alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var out = "";
    for (var i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i];
      var b1 = i+1 < bytes.length ? bytes[i+1] : 0;
      var b2 = i+2 < bytes.length ? bytes[i+2] : 0;
      out += alpha[b0 >> 2];
      out += alpha[((b0 & 3) << 4) | (b1 >> 4)];
      out += i+1 < bytes.length ? alpha[((b1 & 0xF) << 2) | (b2 >> 6)] : "=";
      out += i+2 < bytes.length ? alpha[b2 & 0x3F] : "=";
    }
    return out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }

  // ── UTF-8 ─────────────────────────────────────────────────────────────────

  strToBytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) { out.push(c); }
      else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F)); }
      else { out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F)); }
    }
    return out;
  }

  bytesToStr(bytes) {
    var out = "", i = 0;
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
        var cp = ((b & 7) << 18) | ((b2 & 0x3F) << 12) | ((b3 & 0x3F) << 6) | (b4 & 0x3F) - 0x10000;
        out += String.fromCharCode(0xD800 | (cp >> 10), 0xDC00 | (cp & 0x3FF));
      }
    }
    return out;
  }

  // Re-encodes a decoded episode ID as base64url (for sources requests)
  encodeId(str) {
    return this.b64enc(this.strToBytes(str));
  }

  // Decodes a base64url episode ID; if the decoded string contains ':' return it
  decodeId(id) {
    try {
      var s = this.bytesToStr(this.b64dec(id));
      if (s.indexOf(":") >= 0) return s;
    } catch (e) {}
    return id;
  }

  // ── gzip inflate (RFC 1951/1952) — QuickJS safe ───────────────────────────

  inflate(data) {
    if (data[0] !== 0x1F || data[1] !== 0x8B) throw new Error("not gzip");
    var flg = data[3], pos = 10;
    if (flg & 4)  { var xl = data[pos] | (data[pos+1] << 8); pos += 2 + xl; }
    if (flg & 8)  { while (data[pos++] !== 0) {} }
    if (flg & 16) { while (data[pos++] !== 0) {} }
    if (flg & 2)  { pos += 2; }

    var out = [], bp = pos, bb = 0, bl = 0;

    function bit() {
      if (bl === 0) { bb = data[bp++]; bl = 8; }
      var v = bb & 1; bb >>>= 1; bl--; return v;
    }
    function bits(n) {
      var v = 0; for (var i = 0; i < n; i++) v |= bit() << i; return v;
    }
    function tree(lens) {
      var mx = 0;
      for (var i = 0; i < lens.length; i++) if (lens[i] > mx) mx = lens[i];
      if (mx === 0) return { t: {}, m: 0 };
      var bc = []; for (var i = 0; i <= mx; i++) bc.push(0);
      for (var i = 0; i < lens.length; i++) if (lens[i]) bc[lens[i]]++;
      var nc = []; for (var i = 0; i <= mx+1; i++) nc.push(0);
      var code = 0;
      for (var b = 1; b <= mx; b++) { code = (code + bc[b-1]) << 1; nc[b] = code; }
      var t = {};
      for (var i = 0; i < lens.length; i++) {
        var l = lens[i];
        if (l) { if (!t[l]) t[l] = {}; t[l][nc[l]] = i; nc[l]++; }
      }
      return { t: t, m: mx };
    }
    function sym(tr) {
      var code = 0;
      for (var l = 1; l <= tr.m; l++) {
        code = (code << 1) | bit();
        if (tr.t[l] !== undefined && tr.t[l][code] !== undefined) return tr.t[l][code];
      }
      throw new Error("bad code");
    }
    var LB=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
    var LE=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
    var DB=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
    var DE=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];

    function block(lt, dt) {
      while (true) {
        var s = sym(lt);
        if (s < 256) { out.push(s); }
        else if (s === 256) { break; }
        else {
          var idx = s - 257, len = LB[idx] + bits(LE[idx]);
          var ds = sym(dt), dist = DB[ds] + bits(DE[ds]);
          var st = out.length - dist;
          for (var k = 0; k < len; k++) out.push(out[st+k]);
        }
      }
    }

    var done = false;
    while (!done) {
      var fin = bit(), type = bits(2);
      if (type === 0) {
        bl = 0;
        var ln = data[bp] | (data[bp+1] << 8); bp += 4;
        for (var i = 0; i < ln; i++) out.push(data[bp++]);
      } else if (type === 1) {
        var ll = []; for (var i=0;i<=143;i++) ll.push(8); for(var i=144;i<=255;i++) ll.push(9); for(var i=256;i<=279;i++) ll.push(7); for(var i=280;i<=287;i++) ll.push(8);
        var dl = []; for (var i=0;i<30;i++) dl.push(5);
        block(tree(ll), tree(dl));
      } else if (type === 2) {
        var hlit = bits(5)+257, hdist = bits(5)+1, hclen = bits(4)+4;
        var co = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
        var cl = []; for (var i=0;i<19;i++) cl.push(0);
        for (var i=0;i<hclen;i++) cl[co[i]] = bits(3);
        var ct = tree(cl), all = [];
        while (all.length < hlit+hdist) {
          var s = sym(ct);
          if (s < 16) { all.push(s); }
          else if (s === 16) { var n=bits(2)+3, pv=all.length>0?all[all.length-1]:0; for(var i=0;i<n;i++) all.push(pv); }
          else if (s === 17) { var n=bits(3)+3; for(var i=0;i<n;i++) all.push(0); }
          else { var n=bits(7)+11; for(var i=0;i<n;i++) all.push(0); }
        }
        block(tree(all.slice(0,hlit)), tree(all.slice(hlit)));
      } else { throw new Error("bad block type"); }
      if (fin) done = true;
    }
    return out;
  }

  // ── Miruro pipe ───────────────────────────────────────────────────────────
  // GET /api/secure/pipe?e={base64url(JSON)} → x-obfuscated:1 → base64url(gzip(JSON))
  // Tries miruro.to → miruro.tv → miruro.bz

  async pipe(path, query) {
    var req = JSON.stringify({ path: path, method: "GET", query: query, body: null, version: "0.2.0" });
    var e = this.b64enc(this.strToBytes(req));
    var hosts = ["https://www.miruro.to", "https://www.miruro.tv", "https://www.miruro.bz"];
    var lastErr = "no response";
    for (var hi = 0; hi < hosts.length; hi++) {
      try {
        var url = hosts[hi] + "/api/secure/pipe?e=" + e;
        var res = await this.client.get(url, {
          "User-Agent": this.ua,
          "Referer": "https://www.miruro.to/",
          "Accept": "*/*",
        });
        if (!res || !res.body) { lastErr = "empty body"; continue; }
        var body = typeof res.body === "string" ? res.body : String(res.body);
        body = body.replace(/[^A-Za-z0-9+\/=\-_]/g, "");
        if (body.length < 4) { lastErr = "body too short"; continue; }
        var bytes = this.b64dec(body);
        var raw = this.inflate(bytes);
        return JSON.parse(this.bytesToStr(raw));
      } catch (ex) {
        lastErr = hosts[hi] + ": " + String(ex);
      }
    }
    throw new Error(lastErr);
  }

  // ── AniList ───────────────────────────────────────────────────────────────

  async gql(query, vars) {
    try {
      var res = await this.client.post(
        "https://graphql.anilist.co",
        { "Content-Type": "application/json", "Accept": "application/json" },
        { query: query, variables: vars }
      );
      if (!res || res.statusCode !== 200) return {};
      var parsed = JSON.parse(res.body);
      return (parsed && parsed.data) ? parsed.data : {};
    } catch (e) { return {}; }
  }

  title(t) {
    if (!t) return "Unknown";
    var lang = this.pref("miruro_lang") || "english";
    return t[lang] || t.english || t.romaji || "Unknown";
  }

  toList(media) {
    var out = [];
    for (var i = 0; i < media.length; i++) {
      var m = media[i];
      out.push({ name: this.title(m.title), link: "https://www.miruro.to/info/" + String(m.id), imageUrl: (m.coverImage && m.coverImage.large) || "" });
    }
    return out;
  }

  // ── Browse ────────────────────────────────────────────────────────────────

  async getPopular(page) {
    try {
      var n = page || 1;
      var q = "{Page(page:" + n + ",perPage:20){pageInfo{hasNextPage}media(sort:[TRENDING_DESC],type:ANIME,isAdult:false){id title{romaji english}coverImage{large}}}}";
      var d = await this.gql(q, {});
      var pg = (d && d.Page) ? d.Page : {};
      return { list: this.toList(pg.media || []), hasNextPage: !!(pg.pageInfo && pg.pageInfo.hasNextPage) };
    } catch (e) { return { list: [], hasNextPage: false }; }
  }

  async getLatestUpdates(page) {
    try {
      var n = page || 1;
      var q = "{Page(page:" + n + ",perPage:20){pageInfo{hasNextPage}media(sort:[UPDATED_AT_DESC],type:ANIME,isAdult:false){id title{romaji english}coverImage{large}}}}";
      var d = await this.gql(q, {});
      var pg = (d && d.Page) ? d.Page : {};
      return { list: this.toList(pg.media || []), hasNextPage: !!(pg.pageInfo && pg.pageInfo.hasNextPage) };
    } catch (e) { return { list: [], hasNextPage: false }; }
  }

  async search(query, page, filters) {
    var conds = ["type:ANIME", "isAdult:false"], args = "$p:Int,$n:Int", vars = { p: page, n: 20 };
    if (query && query.length > 0) { conds.push("search:$q"); args += ",$q:String"; vars.q = query; }
    else { conds.push("sort:TRENDING_DESC"); }
    if (filters && Array.isArray(filters)) {
      for (var fi = 0; fi < filters.length; fi++) {
        var f = filters[fi];
        if (f.type_name === "SelectFilter" && f.state > 0) {
          var v = f.values[f.state].value;
          if      (f.name === "Season" && v) { conds.push("season:$season");   args += ",$season:MediaSeason"; vars.season = v; }
          else if (f.name === "Format" && v) { conds.push("format:$format");   args += ",$format:MediaFormat"; vars.format = v; }
          else if (f.name === "Status" && v) { conds.push("status:$status");   args += ",$status:MediaStatus"; vars.status = v; }
          else if (f.name === "Year"   && v) { conds.push("seasonYear:$yr");   args += ",$yr:Int";             vars.yr = parseInt(v); }
          else if (f.name === "Sort"   && v) { conds.push("sort:[$sort]");     args += ",$sort:[MediaSort]";   vars.sort = [v]; }
        } else if (f.type_name === "GroupFilter") {
          var genres = [], gs = f.state || [];
          for (var gi = 0; gi < gs.length; gi++) { if (gs[gi].state === true) genres.push(gs[gi].value); }
          if (genres.length > 0) { conds.push("genre_in:$genres"); args += ",$genres:[String]"; vars.genres = genres; }
        }
      }
    }
    var q = "query(" + args + "){Page(page:$p,perPage:$n){pageInfo{hasNextPage}media(" + conds.join(",") + "){id title{romaji english}coverImage{large}}}}";
    var d = await this.gql(q, vars);
    var pg = d.Page || {};
    return { list: this.toList(pg.media || []), hasNextPage: !!(pg.pageInfo && pg.pageInfo.hasNextPage) };
  }

  // ── Detail ────────────────────────────────────────────────────────────────

  async getDetail(url) {
    var id = parseInt(url, 10);
    if (!id) {
      var m2 = url.match(/\/(\d+)/);
      id = m2 ? parseInt(m2[1], 10) : 0;
    }
    if (!id) throw new Error("bad id");

    var q = "{Media(id:" + id + ",type:ANIME){id title{romaji english native}coverImage{large extraLarge}description status genres}}";
    var d = await this.gql(q, {});
    var m = (d && d.Media) ? d.Media : null;
    var sm = { RELEASING: 0, FINISHED: 1, NOT_YET_RELEASED: 4, CANCELLED: 5, HIATUS: 5 };
    var status = (m && sm[m.status] !== undefined) ? sm[m.status] : 5;

    var epMap = {}, pipeErr = null;
    try {
      var pd = await this.pipe("episodes", { anilistId: id });
      var provs = pd.providers || {};
      var pk = Object.keys(provs);
      for (var pi = 0; pi < pk.length; pi++) {
        var prov = pk[pi];
        var cats = provs[prov].episodes || {};
        var ck = Object.keys(cats);
        for (var ci = 0; ci < ck.length; ci++) {
          var cat = ck[ci];
          var eps = cats[cat] || [];
          for (var ei = 0; ei < eps.length; ei++) {
            var ep = eps[ei];
            var num = ep.number || (ei + 1);
            var epid = this.decodeId(ep.id || String(num));
            if (!epMap[num]) {
              epMap[num] = { animeId: id, num: num, title: ep.title || "", filler: !!ep.filler, ids: {} };
            }
            if (!epMap[num].ids[prov]) epMap[num].ids[prov] = {};
            epMap[num].ids[prov][cat] = epid;
          }
        }
      }
    } catch (ex) { pipeErr = String(ex); }

    var chapters = [];
    var nums = Object.keys(epMap).map(Number).sort(function(a, b) { return a - b; });
    for (var ni = 0; ni < nums.length; ni++) {
      var ep = epMap[nums[ni]];
      chapters.push({
        name: ep.title ? ("Episode " + ep.num + ": " + ep.title) : ("Episode " + ep.num),
        url: JSON.stringify(ep),
        isFiller: ep.filler,
      });
    }

    if (chapters.length === 0) {
      chapters.push({ name: pipeErr ? ("Error: " + pipeErr) : "No episodes found", url: "n/a", isFiller: false });
    }

    chapters.reverse();
    return {
      name:        m ? this.title(m.title) : "Anime " + id,
      imageUrl:    (m && m.coverImage && (m.coverImage.extraLarge || m.coverImage.large)) || "",
      description: (m && m.description) ? m.description.replace(/<[^>]+>/g, "") : "",
      genre:       (m && m.genres) ? m.genres : [],
      status:      status,
      link:        "https://www.miruro.to/info/" + id,
      chapters:    chapters,
    };
  }

  // ── Video list ────────────────────────────────────────────────────────────

  async getVideoList(url) {
    if (!url || url === "n/a") return [];
    var info;
    try { info = JSON.parse(url); } catch (e) { return []; }

    var id = info.animeId;
    var ids = info.ids || {};

    var provP = this.pref("miruro_providers") || [];
    if (!provP || provP.length === 0) provP = ["ally"];

    var audioP = this.pref("miruro_audio") || [];
    if (!audioP || audioP.length === 0) audioP = ["sub"];

    var combinations = [];
    for (var pi = 0; pi < provP.length; pi++) {
      for (var ai = 0; ai < audioP.length; ai++) {
        var prov = provP[pi], cat = audioP[ai];
        if (ids[prov] && ids[prov][cat]) {
          combinations.push({ prov: prov, cat: cat });
        }
      }
    }

    var self = this;
    var results = await Promise.all(
      combinations.map(function(combo) {
        return self.pipe("sources", {
          episodeId: self.encodeId(ids[combo.prov][combo.cat]),
          provider:  combo.prov,
          category:  combo.cat,
          anilistId: id,
        }).then(function(data) {
          var srcs = data.streams || data.sources || [];
          var subs = data.subtitles || [];
          var subtitles = [];
          for (var ti = 0; ti < subs.length; ti++) {
            var t = subs[ti];
            if (t.file || t.url) subtitles.push({ file: t.file || t.url, label: t.label || t.lang || "Sub" });
          }
          var out = [];
          for (var si = 0; si < srcs.length; si++) {
            var src = srcs[si];
            if (src.type === "embed") continue;
            if (src.isActive === false) continue;
            var su = src.url || src.file;
            if (!su || su.length < 10) continue;
            // Skip ally MP4 tokens that have expired (pipe caches them, often stale)
            if (src.type === "mp4") {
              var expiryMatch = su.match(/Authorization=[^_]+_[^_]+_[^_]+_[^_]+_(\d{14})_/);
              if (expiryMatch) {
                var exp = expiryMatch[1];
                var expMs = Date.UTC(
                  parseInt(exp.slice(0,4)), parseInt(exp.slice(4,6))-1, parseInt(exp.slice(6,8)),
                  parseInt(exp.slice(8,10)), parseInt(exp.slice(10,12)), parseInt(exp.slice(12,14))
                );
                if (Date.now() > expMs) continue;
              }
            }
            var referer = src.referer || "https://www.miruro.to/";
            var server = src.server ? (" " + src.server) : "";
            var entry = {
              url: su, originalUrl: su,
              quality: (src.quality || "Auto") + server + " [" + combo.cat.toUpperCase() + " · " + combo.prov + "]",
              headers: { "User-Agent": self.ua, "Referer": referer, "Origin": referer.replace(/\/$/, "") },
            };
            if (subtitles.length > 0) entry.subtitles = subtitles;
            out.push(entry);
          }
          return out;
        }).catch(function() { return []; });
      })
    );

    var streams = [];
    for (var ri = 0; ri < results.length; ri++) {
      var r = results[ri];
      for (var si = 0; si < r.length; si++) streams.push(r[si]);
    }
    return streams;
  }

  // ── Filters ───────────────────────────────────────────────────────────────

  getFilterList() {
    return [
      { type_name: "SelectFilter", name: "Sort", state: 0, values: [
          { type_name: "SelectOption", name: "Trending",   value: "TRENDING_DESC"   },
          { type_name: "SelectOption", name: "Popularity", value: "POPULARITY_DESC" },
          { type_name: "SelectOption", name: "Score",      value: "SCORE_DESC"      },
          { type_name: "SelectOption", name: "Newest",     value: "START_DATE_DESC" },
      ]},
      { type_name: "SelectFilter", name: "Season", state: 0, values: [
          { type_name: "SelectOption", name: "Any", value: "" }, { type_name: "SelectOption", name: "Winter", value: "WINTER" },
          { type_name: "SelectOption", name: "Spring", value: "SPRING" }, { type_name: "SelectOption", name: "Summer", value: "SUMMER" },
          { type_name: "SelectOption", name: "Fall", value: "FALL" },
      ]},
      { type_name: "SelectFilter", name: "Format", state: 0, values: [
          { type_name: "SelectOption", name: "Any", value: "" }, { type_name: "SelectOption", name: "TV", value: "TV" },
          { type_name: "SelectOption", name: "Movie", value: "MOVIE" }, { type_name: "SelectOption", name: "OVA", value: "OVA" },
          { type_name: "SelectOption", name: "ONA", value: "ONA" }, { type_name: "SelectOption", name: "Special", value: "SPECIAL" },
      ]},
      { type_name: "SelectFilter", name: "Status", state: 0, values: [
          { type_name: "SelectOption", name: "Any", value: "" }, { type_name: "SelectOption", name: "Airing", value: "RELEASING" },
          { type_name: "SelectOption", name: "Finished", value: "FINISHED" }, { type_name: "SelectOption", name: "Not Yet Aired", value: "NOT_YET_RELEASED" },
      ]},
      { type_name: "SelectFilter", name: "Year", state: 0, values: [
          { type_name: "SelectOption", name: "Any", value: "" }, { type_name: "SelectOption", name: "2026", value: "2026" },
          { type_name: "SelectOption", name: "2025", value: "2025" }, { type_name: "SelectOption", name: "2024", value: "2024" },
          { type_name: "SelectOption", name: "2023", value: "2023" }, { type_name: "SelectOption", name: "2022", value: "2022" },
          { type_name: "SelectOption", name: "2021", value: "2021" }, { type_name: "SelectOption", name: "2020", value: "2020" },
      ]},
    ];
  }

  getSourcePreferences() {
    return [
      {
        key: "miruro_lang",
        listPreference: {
          title: "Preferred title language",
          summary: "Language used for anime titles",
          valueIndex: 0,
          entries:     ["English", "Romaji", "Native"],
          entryValues: ["english", "romaji", "native"],
        },
      },
      {
        key: "miruro_providers",
        multiSelectListPreference: {
          title: "Providers",
          summary: "Only selected providers are used. Fewer = faster load.",
          values:      ["ally"],
          entries:     ["Ally (HLS streaming)", "Kiwi (multi-quality HLS)"],
          entryValues: ["ally", "kiwi"],
        },
      },
      {
        key: "miruro_audio",
        multiSelectListPreference: {
          title: "Stream type",
          summary: "Selecting both Sub and Dub doubles the number of requests per provider.",
          values:      ["sub"],
          entries:     ["Sub", "Dub"],
          entryValues: ["sub", "dub"],
        },
      },
    ];
  }
}
