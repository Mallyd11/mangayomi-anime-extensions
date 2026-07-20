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
    "version": "6.1.2",
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

  // ── Base64url ──────────────────────────────────────────────────────────────

  b64dec(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var lut = {};
    for (var i = 0; i < alpha.length; i++) lut[alpha[i]] = i;
    var out = [];
    for (var i = 0; i < s.length; i += 4) {
      var a = lut[s[i]] | 0, b = lut[s[i+1]] | 0;
      var c2 = s[i+2], c3 = s[i+3];
      var c = c2 !== "=" ? lut[c2] | 0 : 0;
      var d = c3 !== "=" ? lut[c3] | 0 : 0;
      out.push((a << 2) | (b >> 4));
      if (c2 !== "=") out.push(((b & 0xF) << 4) | (c >> 2));
      if (c3 !== "=") out.push(((c & 3) << 6) | d);
    }
    return out;
  }

  b64enc(bytes) {
    var alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var out = "";
    for (var i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i], b1 = i+1 < bytes.length ? bytes[i+1] : 0, b2 = i+2 < bytes.length ? bytes[i+2] : 0;
      out += alpha[b0 >> 2];
      out += alpha[((b0 & 3) << 4) | (b1 >> 4)];
      out += i+1 < bytes.length ? alpha[((b1 & 0xF) << 2) | (b2 >> 6)] : "=";
      out += i+2 < bytes.length ? alpha[b2 & 0x3F] : "=";
    }
    return out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }

  // ── UTF-8 ──────────────────────────────────────────────────────────────────

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
    var parts = [], i = 0, CHUNK = 2048;
    while (i < bytes.length) {
      var chunk = [], end = Math.min(i + CHUNK, bytes.length);
      while (i < end) {
        var b = bytes[i++];
        if (b < 0x80) { chunk.push(b); }
        else if ((b & 0xE0) === 0xC0) { chunk.push(((b & 0x1F) << 6) | (bytes[i++] & 0x3F)); }
        else if ((b & 0xF0) === 0xE0) { var b2 = bytes[i++], b3 = bytes[i++]; chunk.push(((b & 0xF) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F)); }
        else { var b2 = bytes[i++], b3 = bytes[i++], b4 = bytes[i++]; var cp = (((b & 7) << 18) | ((b2 & 0x3F) << 12) | ((b3 & 0x3F) << 6) | (b4 & 0x3F)) - 0x10000; chunk.push(0xD800 | (cp >> 10), 0xDC00 | (cp & 0x3FF)); }
      }
      parts.push(String.fromCharCode.apply(null, chunk));
    }
    return parts.join("");
  }

  // ── gzip inflate ──────────────────────────────────────────────────────────

  inflate(data) {
    if (data[0] !== 0x1F || data[1] !== 0x8B) throw new Error("not gzip");
    var flg = data[3], pos = 10;
    if (flg & 4)  { var xl = data[pos] | (data[pos+1] << 8); pos += 2 + xl; }
    if (flg & 8)  { while (data[pos++] !== 0) {} }
    if (flg & 16) { while (data[pos++] !== 0) {} }
    if (flg & 2)  { pos += 2; }
    var out = [], bp = pos, bb = 0, bl = 0;
    function bit() { if (!bl) { bb = data[bp++]; bl = 8; } var v = bb & 1; bb >>>= 1; bl--; return v; }
    function bits(n) { var v = 0; for (var i = 0; i < n; i++) v |= bit() << i; return v; }
    function tree(lens) {
      var mx = 0; for (var i = 0; i < lens.length; i++) if (lens[i] > mx) mx = lens[i];
      if (!mx) return { t: {}, m: 0 };
      var bc = []; for (var i = 0; i <= mx; i++) bc.push(0);
      for (var i = 0; i < lens.length; i++) if (lens[i]) bc[lens[i]]++;
      var nc = []; for (var i = 0; i <= mx+1; i++) nc.push(0);
      var code = 0; for (var b = 1; b <= mx; b++) { code = (code + bc[b-1]) << 1; nc[b] = code; }
      var t = {};
      for (var i = 0; i < lens.length; i++) { var l = lens[i]; if (l) { if (!t[l]) t[l] = {}; t[l][nc[l]] = i; nc[l]++; } }
      return { t: t, m: mx };
    }
    function sym(tr) { var code = 0; for (var l = 1; l <= tr.m; l++) { code = (code << 1) | bit(); if (tr.t[l] !== undefined && tr.t[l][code] !== undefined) return tr.t[l][code]; } throw new Error("bad sym"); }
    var LB=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
    var LE=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
    var DB=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
    var DE=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
    function block(lt, dt) {
      while (true) {
        var s = sym(lt);
        if (s < 256) { out.push(s); }
        else if (s === 256) { break; }
        else { var idx = s-257, len = LB[idx]+bits(LE[idx]), ds = sym(dt), dist = DB[ds]+bits(DE[ds]), st = out.length-dist; for (var k = 0; k < len; k++) out.push(out[st+k]); }
      }
    }
    var done = false;
    while (!done) {
      var fin = bit(), type = bits(2);
      if (type === 0) {
        bl = 0; var ln = data[bp] | (data[bp+1] << 8); bp += 4; for (var i = 0; i < ln; i++) out.push(data[bp++]);
      } else if (type === 1) {
        var ll = []; for (var i=0;i<=143;i++) ll.push(8); for(var i=144;i<=255;i++) ll.push(9); for(var i=256;i<=279;i++) ll.push(7); for(var i=280;i<=287;i++) ll.push(8);
        var dl=[]; for(var i=0;i<30;i++) dl.push(5); block(tree(ll), tree(dl));
      } else if (type === 2) {
        var hlit=bits(5)+257, hdist=bits(5)+1, hclen=bits(4)+4;
        var co=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15], cl=[];
        for(var i=0;i<19;i++) cl.push(0); for(var i=0;i<hclen;i++) cl[co[i]]=bits(3);
        var ct=tree(cl), all=[];
        while(all.length < hlit+hdist) { var s=sym(ct); if(s<16){all.push(s);}else if(s===16){var n=bits(2)+3,pv=all.length?all[all.length-1]:0;for(var i=0;i<n;i++)all.push(pv);}else if(s===17){var n=bits(3)+3;for(var i=0;i<n;i++)all.push(0);}else{var n=bits(7)+11;for(var i=0;i<n;i++)all.push(0);} }
        block(tree(all.slice(0,hlit)), tree(all.slice(hlit)));
      } else { throw new Error("bad block"); }
      if (fin) done = true;
    }
    return out;
  }

  // ── Miruro pipe API ────────────────────────────────────────────────────────
  // GET /api/secure/pipe?e=base64url(JSON) → base64url(XOR(key, gzip(JSON)))
  // Works from residential IPs without CF cookies.

  async pipe(query) {
    var req = JSON.stringify({ path: "sources", method: "GET", query: query, body: null, version: "0.2.0" });
    var e = this.b64enc(this.strToBytes(req));
    var keyHex = "71951034f8fbcf53d89db52ceb3dc22c";
    var obfKey = [];
    for (var i = 0; i < keyHex.length; i += 2) obfKey.push(parseInt(keyHex.slice(i, i+2), 16));

    var res = await this.client.get("https://www.miruro.to/api/secure/pipe?e=" + e, {
      "User-Agent": this.ua,
      "Referer": "https://www.miruro.to/",
      "Origin": "https://www.miruro.to",
      "Accept": "*/*",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
    });
    if (!res || res.statusCode !== 200) throw new Error("HTTP " + (res && res.statusCode));
    var body = (typeof res.body === "string" ? res.body : String(res.body)).replace(/[^A-Za-z0-9+\/=\-_]/g, "");
    if (body.length < 4) throw new Error("empty body");
    var raw = this.b64dec(body);
    var bytes = raw.slice();
    for (var i = 0; i < bytes.length; i++) bytes[i] ^= obfKey[i % obfKey.length];
    try { return JSON.parse(this.bytesToStr(this.inflate(bytes))); } catch (ex) {}
    try { return JSON.parse(this.bytesToStr(this.inflate(raw))); } catch (ex2) {}
    return JSON.parse(this.bytesToStr(bytes));
  }

  // ── AllAnime showId lookup ─────────────────────────────────────────────────

  async getAllAnimeId(anilistId, title) {
    try {
      var res = await this.client.post(
        "https://api.allanime.day/api",
        { "Content-Type": "application/json", "Accept": "application/json",
          "Origin": "https://allanime.to", "Referer": "https://allanime.to/", "User-Agent": this.ua },
        { query: "query($q:String!){shows(search:{query:$q,allowAdult:false,allowUnknown:false},limit:20,page:1,translationType:sub){edges{_id aniListId}}}",
          variables: { q: title } }
      );
      if (!res || res.statusCode !== 200) return null;
      var d = JSON.parse(res.body);
      var edges = (d.data && d.data.shows && d.data.shows.edges) || [];
      for (var i = 0; i < edges.length; i++) {
        if (String(edges[i].aniListId) === String(anilistId)) return edges[i]._id;
      }
      return null;
    } catch (e) { return null; }
  }

  // ── AniList GraphQL ────────────────────────────────────────────────────────

  async anilist(query, vars) {
    try {
      var res = await this.client.post(
        "https://graphql.anilist.co",
        { "Content-Type": "application/json", "Accept": "application/json" },
        { query: query, variables: vars || {} }
      );
      if (!res || res.statusCode !== 200) return {};
      var d = JSON.parse(res.body);
      return (d && d.data) ? d.data : {};
    } catch (e) { return {}; }
  }

  preferredTitle(t) {
    if (!t) return "Unknown";
    var lang = this.pref("miruro_lang") || "english";
    return t[lang] || t.english || t.romaji || t.native || "Unknown";
  }

  mediaToItem(m) {
    return {
      name: this.preferredTitle(m.title),
      link: "https://www.miruro.to/info/" + m.id,
      imageUrl: (m.coverImage && m.coverImage.large) || "",
    };
  }

  // ── Browse ─────────────────────────────────────────────────────────────────

  async getPopular(page) {
    try {
      var n = page || 1;
      var d = await this.anilist("{Page(page:" + n + ",perPage:20){pageInfo{hasNextPage}media(sort:[TRENDING_DESC],type:ANIME,isAdult:false){id title{romaji english}coverImage{large}}}}");
      var pg = d.Page || {};
      var self = this;
      return { list: (pg.media || []).map(function(m) { return self.mediaToItem(m); }), hasNextPage: !!(pg.pageInfo && pg.pageInfo.hasNextPage) };
    } catch (e) { return { list: [], hasNextPage: false }; }
  }

  async getLatestUpdates(page) {
    try {
      var n = page || 1;
      var d = await this.anilist("{Page(page:" + n + ",perPage:20){pageInfo{hasNextPage}media(sort:[UPDATED_AT_DESC],type:ANIME,isAdult:false){id title{romaji english}coverImage{large}}}}");
      var pg = d.Page || {};
      var self = this;
      return { list: (pg.media || []).map(function(m) { return self.mediaToItem(m); }), hasNextPage: !!(pg.pageInfo && pg.pageInfo.hasNextPage) };
    } catch (e) { return { list: [], hasNextPage: false }; }
  }

  async search(query, page, filters) {
    try {
      var n = page || 1;
      var conds = ["type:ANIME", "isAdult:false"], args = "$p:Int,$n:Int", vars = { p: n, n: 20 };
      if (query && query.length) { conds.push("search:$q"); args += ",$q:String"; vars.q = query; }
      else { conds.push("sort:TRENDING_DESC"); }
      if (filters && Array.isArray(filters)) {
        for (var fi = 0; fi < filters.length; fi++) {
          var f = filters[fi];
          if (f.type_name === "SelectFilter" && f.state > 0) {
            var v = f.values[f.state].value;
            if (f.name === "Season" && v) { conds.push("season:$season"); args += ",$season:MediaSeason"; vars.season = v; }
            else if (f.name === "Format" && v) { conds.push("format:$format"); args += ",$format:MediaFormat"; vars.format = v; }
            else if (f.name === "Status" && v) { conds.push("status:$status"); args += ",$status:MediaStatus"; vars.status = v; }
            else if (f.name === "Year"   && v) { conds.push("seasonYear:$yr"); args += ",$yr:Int"; vars.yr = parseInt(v); }
            else if (f.name === "Sort"   && v) { conds.push("sort:[$sort]"); args += ",$sort:[MediaSort]"; vars.sort = [v]; }
          } else if (f.type_name === "GroupFilter") {
            var genres = [], gs = f.state || [];
            for (var gi = 0; gi < gs.length; gi++) if (gs[gi].state === true) genres.push(gs[gi].value);
            if (genres.length) { conds.push("genre_in:$genres"); args += ",$genres:[String]"; vars.genres = genres; }
          }
        }
      }
      var q = "query(" + args + "){Page(page:$p,perPage:$n){pageInfo{hasNextPage}media(" + conds.join(",") + "){id title{romaji english}coverImage{large}}}}";
      var d = await this.anilist(q, vars);
      var pg = d.Page || {};
      var self = this;
      return { list: (pg.media || []).map(function(m) { return self.mediaToItem(m); }), hasNextPage: !!(pg.pageInfo && pg.pageInfo.hasNextPage) };
    } catch (e) { return { list: [], hasNextPage: false }; }
  }

  // ── Detail ─────────────────────────────────────────────────────────────────

  async getDetail(url) {
    var id = parseInt(url, 10);
    if (!id) { var m2 = url.match(/(\d+)/); id = m2 ? parseInt(m2[1], 10) : 0; }
    if (!id) throw new Error("cannot parse AniList ID from: " + url);

    var _d = await this.anilist(
      "{Media(id:" + id + ",type:ANIME){" +
        "id idMal title{romaji english native} coverImage{large extraLarge}" +
        " description status episodes nextAiringEpisode{episode} genres" +
      "}}"
    );
    var m = _d.Media || null;

    var statusMap = { RELEASING: 0, FINISHED: 1, NOT_YET_RELEASED: 4, CANCELLED: 5, HIATUS: 5 };
    var status = m ? (statusMap[m.status] !== undefined ? statusMap[m.status] : 5) : 5;

    var epCount = 0;
    if (m) {
      if (m.status === "RELEASING") {
        epCount = (m.nextAiringEpisode && m.nextAiringEpisode.episode > 1)
          ? m.nextAiringEpisode.episode - 1 : (m.episodes || 0);
      } else {
        epCount = m.episodes || 0;
      }
    }

    var chapters = [];
    for (var i = 1; i <= epCount; i++) {
      chapters.push({
        name: "Episode " + i,
        url: JSON.stringify({ animeId: id, num: i }),
        isFiller: false,
      });
    }
    if (!chapters.length) {
      chapters.push({ name: "No episodes available", url: "n/a", isFiller: false });
    }
    chapters.reverse();

    return {
      name:        m ? this.preferredTitle(m.title) : "Unknown",
      imageUrl:    m && m.coverImage ? (m.coverImage.extraLarge || m.coverImage.large || "") : "",
      description: m && m.description ? m.description.replace(/<[^>]+>/g, "") : "",
      genre:       m && m.genres ? m.genres : [],
      status:      status,
      link:        "https://www.miruro.to/info/" + id,
      chapters:    chapters,
    };
  }

  // ── HLS playlist resolver ──────────────────────────────────────────────────

  // Ad CDNs seen injecting fake segments. Fast path only — the host-mismatch
  // rule below is the general check and catches hosts not listed here.
  get AD_SEGMENT_HOSTS() {
    return ["ibyteimg.com", "byteimg.com", "ipstatp.com", "doubleclick.net", "googlesyndication.com"];
  }

  // Last two labels of a hostname. Coarse, but enough to tell "same CDN,
  // different shard" from "an entirely unrelated advertiser".
  _isAdHost(domain) {
    var adHosts = this.AD_SEGMENT_HOSTS;
    for (var i = 0; i < adHosts.length; i++) if (domain === adHosts[i]) return true;
    return false;
  }

  _rootDomain(host) {
    var parts = (host || "").toLowerCase().split(".");
    return parts.length >= 2 ? parts.slice(-2).join(".") : (host || "").toLowerCase();
  }

  // A well-formed playlist is not the same thing as a playable one.
  //
  // The MegaPlay/nekostream upstream returns valid m3u8 whose segments are
  // mostly 1x1 PNGs padded to ~500 KB on an ad CDN — measured at ~55s of real
  // video against ~1375s of junk, with no #EXT-X-DISCONTINUITY marking it.
  // The player decodes the few real segments at the head, fails to demux the
  // rest, races to #EXT-X-ENDLIST, and Mangayomi treats the episode as finished
  // and auto-advances — seen by the user as the player skipping through a whole
  // season without playing anything, marking it watched as it goes.
  //
  // Judge by duration, not segment count: a few long real segments among many
  // short ad ones is still watchable, and the reverse is not.
  _playlistIsPoisoned(body, playlistUrl) {
    var hostM = (playlistUrl || "").match(/^https?:\/\/([^/]+)/);
    if (!hostM) return false;
    var ownRoot = this._rootDomain(hostM[1]);
    var lines = String(body).split("\n");
    var segs = [];

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.indexOf("#EXTINF:") !== 0) continue;
      var dur = parseFloat(line.slice(8)) || 0;
      var uri = "";
      for (var j = i + 1; j < lines.length; j++) {
        var cand = lines[j].trim();
        if (!cand || cand.charAt(0) === "#") continue;
        uri = cand;
        break;
      }
      if (!uri) continue;
      // Relative URIs resolve against the playlist, so they are own-host.
      var dom = ownRoot;
      if (uri.indexOf("http") === 0) {
        var segHostM = uri.match(/^https?:\/\/([^/]+)/);
        if (segHostM) dom = this._rootDomain(segHostM[1]);
      }
      segs.push({ dur: dur, dom: dom });
    }
    if (segs.length === 0) return false;

    // Which domain carries the actual episode? NOT necessarily the playlist's
    // own host — plenty of providers serve the playlist from one domain and
    // every segment from a CDN on another. Assuming otherwise made a clean
    // stream look 100% foreign and rejected it outright.
    var byDom = {};
    for (var k = 0; k < segs.length; k++) {
      if (!byDom[segs[k].dom]) byDom[segs[k].dom] = 0;
      byDom[segs[k].dom] += segs[k].dur;
    }
    var contentDom = null;
    if (byDom[ownRoot]) {
      contentDom = ownRoot;                       // playlist host present → that is the content
    } else if (!this._isAdHost(segs[0].dom)) {
      contentDom = segs[0].dom;                   // else the lead segment; playlists open with content
    } else {
      var best = -1;                              // ad pre-roll: fall back to the largest non-ad domain
      for (var d in byDom) {
        if (!this._isAdHost(d) && byDom[d] > best) { best = byDom[d]; contentDom = d; }
      }
    }
    if (contentDom === null) return true;         // every domain present is a known ad host

    var realSec = 0, foreignSec = 0;
    for (var k2 = 0; k2 < segs.length; k2++) {
      var foreign = segs[k2].dom !== contentDom || this._isAdHost(segs[k2].dom);
      if (foreign) foreignSec += segs[k2].dur; else realSec += segs[k2].dur;
    }

    var total = realSec + foreignSec;
    if (total <= 0) return false; // nothing parseable — let the player decide
    // Keep a stream that still contains a plausible episode, however much ad
    // padding sits alongside it. Poisoned streams leave about a minute.
    if (realSec >= 300) return false;
    return (foreignSec / total) > 0.5;
  }

  // Returns [] for an already-flat playlist, or null if the stream is
  // ad-poisoned — callers skip a null source rather than emitting it.
  async resolveMasterPlaylist(masterUrl, headers) {
    try {
      var res = await this.client.get(masterUrl, headers);
      var body = (res && res.body) || "";
      if (body.indexOf("#EXT-X-STREAM-INF") < 0) {
        // Flat playlist — segments are in hand, so check without refetching.
        if (body.indexOf("#EXTINF") >= 0 && this._playlistIsPoisoned(body, masterUrl)) return null;
        return [];
      }
      var base = masterUrl.substring(0, masterUrl.lastIndexOf("/") + 1);
      var variants = [];
      var lines = body.split("\n");
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.indexOf("#EXT-X-STREAM-INF") !== 0) continue;
        var resMatch = line.match(/RESOLUTION=\d+x(\d+)/);
        var quality = resMatch ? resMatch[1] + "p" : "auto";
        for (var j = i + 1; j < lines.length; j++) {
          var u = lines[j].trim();
          if (!u || u.charAt(0) === "#") continue;
          variants.push({ url: u.indexOf("http") === 0 ? u : base + u, quality: quality });
          break;
        }
      }
      variants.sort(function(a, b) { return (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0); });

      // Poisoning lives in the media playlists, not the master. Sample one
      // variant — injection is per stream, not per rendition, so the top
      // variant speaks for all of them. One extra GET, which matters against
      // the app's 40s isolate deadline.
      if (variants.length > 0) {
        try {
          var probe = await this.client.get(variants[0].url, headers);
          var probeBody = (probe && probe.body) || "";
          if (probeBody.indexOf("#EXTM3U") >= 0 &&
              this._playlistIsPoisoned(probeBody, variants[0].url)) return null;
        } catch (e) {} // probe failure is not proof of poisoning — let it through
      }
      return variants;
    } catch (e) { return []; }
  }

  // ── Video list ─────────────────────────────────────────────────────────────

  async getVideoList(url) {
    if (!url || url === "n/a") return [];
    var info;
    try { info = JSON.parse(url); } catch (e) { return []; }
    var id = info.animeId, num = info.num;
    if (!id || !num) return [];

    var audioList = this.pref("miruro_audio");
    if (!audioList || !audioList.length) audioList = ["sub"];

    var streams = [];
    var self = this;

    // ── 1. JustAnime megaplay (fast path, CF-free CDN) ─────────────────────
    try {
      var res = await this.client.get(
        "https://core.justanime.to/api/watch/" + id + "/episode/" + num + "/megaplay",
        { "User-Agent": this.ua, "Origin": "https://justanime.to", "Referer": "https://justanime.to/", "Accept": "application/json" }
      );
      if (res && res.statusCode === 200) {
        var data = JSON.parse(res.body);
        if (data && !data.error) {
          for (var ti = 0; ti < audioList.length; ti++) {
            var type = audioList[ti];
            var typeData = data[type];
            if (!typeData || !typeData.sources) continue;
            var rhdrs = typeData.headers || {};
            var streamHeaders = {
              "User-Agent": this.ua,
              "Referer": rhdrs["Referer"] || "https://megaplay.buzz/",
            };
            if (rhdrs["Origin"]) streamHeaders["Origin"] = rhdrs["Origin"];

            var subtitles = [];
            var tracks = typeData.subtitles || typeData.tracks || [];
            for (var sti = 0; sti < tracks.length; sti++) {
              var track = tracks[sti];
              if (track.file && (track.kind === "captions" || track.kind === "subtitles" || !track.kind)) {
                subtitles.push({ file: track.file, label: track.label || "Unknown" });
              }
            }

            var sources = typeData.sources;
            for (var si = 0; si < sources.length; si++) {
              var s = sources[si];
              var streamUrl = s.url || s.file;
              if (!streamUrl) continue;
              if ((s.isM3U8 || streamUrl.indexOf(".m3u8") >= 0) && (!s.quality || s.quality === "auto")) {
                var variants = await this.resolveMasterPlaylist(streamUrl, streamHeaders);
                // null = ad-poisoned. Skip the source entirely rather than
                // falling through to emit it as a flat playlist.
                if (variants === null) continue;
                if (variants.length > 0) {
                  for (var vi = 0; vi < variants.length; vi++) {
                    streams.push({ url: variants[vi].url, originalUrl: streamUrl,
                      quality: variants[vi].quality + " [" + type.toUpperCase() + " · mega]",
                      headers: streamHeaders, subtitles: subtitles });
                  }
                  continue;
                }
              }
              streams.push({ url: streamUrl, originalUrl: streamUrl,
                quality: (s.quality || "auto") + " [" + type.toUpperCase() + " · mega]",
                headers: streamHeaders, subtitles: subtitles });
            }
          }
        }
      }
    } catch (e) {}

    if (streams.length > 0) return streams;

    // ── 2. Miruro pipe fallback (vault01.ultracloud.cc, works on residential IPs) ──
    // Lazy lookup: AniList title → AllAnime showId (only when megaplay has no coverage).
    var allAnimeId = null;
    try {
      var titleData = await this.anilist("{Media(id:" + id + ",type:ANIME){title{english romaji}}}");
      var tm = titleData.Media;
      var titleStr = tm ? (tm.title.english || tm.title.romaji || "") : "";
      if (titleStr) allAnimeId = await this.getAllAnimeId(id, titleStr);
    } catch (e) {}
    if (!allAnimeId) return [];

    // Only try "ally" — avoids multi-minute hang when pipe is CF-blocked (one timeout max).
    var pipeBlocked = false;
    for (var ai = 0; ai < audioList.length && !pipeBlocked; ai++) {
      var cat = audioList[ai];
      try {
        var episodeId = this.b64enc(this.strToBytes("allmanga:" + allAnimeId + ":" + num));
        var pipeData = await this.pipe({ episodeId: episodeId, provider: "ally", category: cat });
        var sources = pipeData.streams || pipeData.sources || [];

        var rawSubs = pipeData.subtitles || [];
        var subtitles = rawSubs.map(function(s) {
          return { file: s.file || s.url || "", label: s.label || s.lang || "Sub" };
        });

        for (var si = 0; si < sources.length; si++) {
          var s = sources[si];
          if (s.type === "embed" || s.isActive === false) continue;
          var su = s.url || s.file;
          if (!su || su.length < 8) continue;
          var referer = s.referer || "https://www.miruro.to/";
          streams.push({
            url: su,
            originalUrl: su,
            quality: (s.quality || "Auto") + " [" + cat.toUpperCase() + " · ally]",
            headers: { "User-Agent": self.ua, "Referer": referer, "Origin": referer.replace(/\/$/, "") },
            subtitles: subtitles,
          });
        }
      } catch (e) {
        pipeBlocked = true;
      }
    }

    return streams;
  }

  // ── Filters ────────────────────────────────────────────────────────────────

  getFilterList() {
    return [
      { type_name: "SelectFilter", name: "Sort", state: 0, values: [
        { type_name: "SelectOption", name: "Trending",   value: "TRENDING_DESC"   },
        { type_name: "SelectOption", name: "Popularity", value: "POPULARITY_DESC" },
        { type_name: "SelectOption", name: "Score",      value: "SCORE_DESC"      },
        { type_name: "SelectOption", name: "Newest",     value: "START_DATE_DESC" },
      ]},
      { type_name: "SelectFilter", name: "Season", state: 0, values: [
        { type_name: "SelectOption", name: "Any",    value: ""       },
        { type_name: "SelectOption", name: "Winter", value: "WINTER" },
        { type_name: "SelectOption", name: "Spring", value: "SPRING" },
        { type_name: "SelectOption", name: "Summer", value: "SUMMER" },
        { type_name: "SelectOption", name: "Fall",   value: "FALL"   },
      ]},
      { type_name: "SelectFilter", name: "Format", state: 0, values: [
        { type_name: "SelectOption", name: "Any",     value: ""        },
        { type_name: "SelectOption", name: "TV",      value: "TV"      },
        { type_name: "SelectOption", name: "Movie",   value: "MOVIE"   },
        { type_name: "SelectOption", name: "OVA",     value: "OVA"     },
        { type_name: "SelectOption", name: "ONA",     value: "ONA"     },
        { type_name: "SelectOption", name: "Special", value: "SPECIAL" },
      ]},
      { type_name: "SelectFilter", name: "Status", state: 0, values: [
        { type_name: "SelectOption", name: "Any",           value: ""                 },
        { type_name: "SelectOption", name: "Airing",        value: "RELEASING"        },
        { type_name: "SelectOption", name: "Finished",      value: "FINISHED"         },
        { type_name: "SelectOption", name: "Not Yet Aired", value: "NOT_YET_RELEASED" },
      ]},
      { type_name: "SelectFilter", name: "Year", state: 0, values: [
        { type_name: "SelectOption", name: "Any",  value: ""     },
        { type_name: "SelectOption", name: "2026", value: "2026" },
        { type_name: "SelectOption", name: "2025", value: "2025" },
        { type_name: "SelectOption", name: "2024", value: "2024" },
        { type_name: "SelectOption", name: "2023", value: "2023" },
        { type_name: "SelectOption", name: "2022", value: "2022" },
        { type_name: "SelectOption", name: "2021", value: "2021" },
        { type_name: "SelectOption", name: "2020", value: "2020" },
      ]},
    ];
  }

  getSourcePreferences() {
    return [
      {
        key: "miruro_lang",
        listPreference: {
          title: "Title language",
          summary: "",
          valueIndex: 0,
          entries:     ["English", "Romaji", "Native"],
          entryValues: ["english", "romaji", "native"],
        },
      },
      {
        key: "miruro_audio",
        multiSelectListPreference: {
          title: "Audio type",
          summary: "",
          values:      ["sub"],
          entries:     ["Sub", "Dub"],
          entryValues: ["sub", "dub"],
        },
      },
    ];
  }
}
