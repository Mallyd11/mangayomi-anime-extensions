const mangayomiSources = [
  {
    "name": "AllWish",
    "id": -228451656,
    "lang": "en",
    "baseUrl": "https://all-wish.me",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://all-wish.me",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.1.0",
    "pkgPath": "anime/src/en/allwish.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": false,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/allwish.js",
    "dateFormat": "",
    "dateFormatLocale": "",
    "additionalParams": "",
    "sourceCodeLanguage": 1,
    "notes": "",
  },
];

// all-wish.me is an AnimeSuge-template site. Everything runs through three
// unauthenticated ajax endpoints (no vrf needed):
//   /ajax/episode/list/{animeId}      → episode <a> tags carrying data-ids
//   /ajax/server/list?servers={ids}   → sub/dub server blocks with data-link-id
//   /ajax/server?get={linkId}         → {result:{url}} — a megaplay.buzz embed
// The site's mapper.js also asks mapper.kotostream.online for extra servers
// (Vidstream / Kiwi-Stream / vibe-Stream), but that host no longer resolves, so
// MegaPlay ("Mega") is the only server the site actually offers.
//
// MegaPlay's getSources answer is AES-256-CBC encrypted and its CDN refuses the
// master playlist without an HMAC token. Key, IV and secret are the ones its own
// player ships in the clear (lib/newclient.min.js, lib/e1-player.min.js); if
// playback goes empty, re-read them from there.
var MEGAPLAY_ENC_KEY = "i?LMTAx0Q6,:}50U";              // padded to 32 bytes
var MEGAPLAY_ENC_IV = "W0;27ToaUpl_P%'c";               // 16 bytes
var MEGAPLAY_CDN_SECRET = "MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s";
// The player signs for 90 seconds and re-signs on every request. An extension
// hands the URL over once, so sign long enough that a paused episode resumes.
var MEGAPLAY_TOKEN_TTL = 21600;

// Filter options, read positionally in search(): Mangayomi only round-trips
// type_name/name/state/values, so extra keys on a filter object are lost.
var AW_SORTS = [
  ["Default", "default"], ["Latest updated", "latest-updated"], ["Score", "score"],
  ["Name A-Z", "name-az"], ["Release date", "release-date"], ["Most viewed", "most-viewed"],
  ["Number of episodes", "number_of_episodes"],
];
var AW_GENRES = [
  ["Action", "1"], ["Action & Adventure", "2342"], ["Adventure", "2"], ["Animation", "2343"],
  ["Boys Love", "2329"], ["Cars", "538"], ["Comedy", "8"], ["Dementia", "453"], ["Demons", "119"],
  ["Drama", "62"], ["Ecchi", "214"], ["Erotica", "2319"], ["Fantasy", "3"], ["Game", "180"],
  ["Girls Love", "2326"], ["Gourmet", "2324"], ["Harem", "215"], ["Historical", "70"],
  ["Horror", "222"], ["Isekai", "74"], ["Josei", "404"], ["Kids", "46"], ["Magic", "203"],
  ["Martial Arts", "114"], ["Mecha", "123"], ["Military", "125"], ["Music", "242"],
  ["Mystery", "57"], ["Parody", "162"], ["Police", "136"], ["Psychological", "73"],
  ["Romance", "28"], ["Samurai", "163"], ["School", "14"], ["Sci-Fi", "12"],
  ["Sci-Fi & Fantasy", "2350"], ["Seinen", "50"], ["Shoujo", "252"], ["Shoujo Ai", "235"],
  ["Shounen", "15"], ["Shounen Ai", "233"], ["Slice of Life", "35"], ["Space", "124"],
  ["Sports", "29"], ["Super Power", "16"], ["Supernatural", "9"], ["Suspense", "2327"],
  ["Thriller", "54"], ["Vampire", "58"],
];
var AW_TYPES = [
  ["Movie", "Movie"], ["Music", "Music"], ["ONA", "ONA"], ["OVA", "OVA"], ["Special", "Special"],
  ["TV", "TV"], ["TV Short", "TV_SHORT"], ["TV Special", "TV Special"],
];
var AW_STATUS = [
  ["Finished Airing", "finished-airing"], ["Currently Airing", "currently-airing"],
  ["Not yet aired", "not-yet-aired"],
];
var AW_SEASONS = [["Fall", "fall"], ["Summer", "summer"], ["Spring", "spring"], ["Winter", "winter"]];
var AW_LANGUAGES = [["Sub", "sub"], ["Dub", "dub"]];

class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
  }

  get ua() {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
  }

  getHeaders(url) {
    return { "User-Agent": this.ua, "Referer": this.source.baseUrl + "/" };
  }

  _ajaxHeaders(referer) {
    return {
      "User-Agent": this.ua,
      "Referer": referer || this.source.baseUrl + "/",
      "X-Requested-With": "XMLHttpRequest",
      "Accept": "application/json, text/javascript, */*; q=0.01",
    };
  }

  _pref(key, fallback) {
    try {
      var v = new SharedPreferences().get(key);
      return v === null || v === undefined || v === "" ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  async _getJson(url, referer) {
    var res = await this.client.get(url, this._ajaxHeaders(referer));
    try { return JSON.parse(res.body || ""); } catch (e) { return null; }
  }

  _abs(href) {
    if (!href) return "";
    if (href.indexOf("http") === 0) return href;
    return this.source.baseUrl + (href.charAt(0) === "/" ? "" : "/") + href;
  }

  // /watch/{slug}/ep-8 → /watch/{slug}: one entry per anime, not per episode.
  _animeUrl(href) {
    return this._abs(href).replace(/\/ep-[^\/?#]*$/, "");
  }

  _decodeEntities(s) {
    return String(s || "")
      .replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, function (m, n) {
        return String.fromCharCode(parseInt(n, 10));
      });
  }

  // ------------------------------------------------------------- listings

  // Card grid used by /most-viewed, /latest-updated and /filter:
  //   <div class="item"> … <a class="poster" href="/watch/{slug}/ep-N"><img data-src>
  //   … <div class="name"><a href data-jp>Title</a>
  _parseList(html) {
    var doc = new Document(html);
    var list = [];
    var seen = {};
    var items = doc.select("div.item");
    for (var i = 0; i < items.length; i++) {
      var a = items[i].selectFirst(".name a");
      if (!a) continue;
      var link = this._animeUrl(a.attr("href"));
      if (!link || link.indexOf("/watch/") < 0 || seen[link]) continue;
      seen[link] = true;
      var img = items[i].selectFirst("img");
      var imageUrl = img ? (img.attr("data-src") || img.attr("src") || "") : "";
      list.push({ name: (a.text || "").trim(), imageUrl: imageUrl, link: link });
    }
    return list;
  }

  _hasNextPage(html) {
    return /rel="next"/.test(html);
  }

  async _listing(path) {
    var res = await this.client.get(this._abs(path), this.getHeaders());
    var html = res.body || "";
    return { list: this._parseList(html), hasNextPage: this._hasNextPage(html) };
  }

  get supportsLatest() {
    return true;
  }

  async getPopular(page) {
    return await this._listing("/most-viewed?page=" + page);
  }

  async getLatestUpdates(page) {
    return await this._listing("/latest-updated?page=" + page);
  }

  async search(query, page, filters) {
    var params = [];
    if (query) params.push("keyword=" + encodeURIComponent(query));
    var f = filters || [];
    var sortIdx = f[0] && typeof f[0].state === "number" ? f[0].state : 0;
    if (sortIdx > 0 && AW_SORTS[sortIdx]) params.push("sort=" + AW_SORTS[sortIdx][1]);
    // Positional: genre, type, status, season, language — see getFilterList.
    var groups = [["genre[]", 1], ["term_type[]", 2], ["status[]", 3], ["season[]", 4], ["language[]", 5]];
    for (var g = 0; g < groups.length; g++) {
      var group = f[groups[g][1]];
      if (!group || !Array.isArray(group.state)) continue;
      for (var k = 0; k < group.state.length; k++) {
        var cb = group.state[k];
        if (cb && cb.state) params.push(encodeURIComponent(groups[g][0]) + "=" + encodeURIComponent(cb.value));
      }
    }
    params.push("page=" + page);
    return await this._listing("/filter?" + params.join("&"));
  }

  // --------------------------------------------------------------- detail

  _statusCode(text) {
    var t = (text || "").toLowerCase();
    if (t.indexOf("finished") >= 0 || t.indexOf("completed") >= 0) return 1;
    if (t.indexOf("not yet") >= 0 || t.indexOf("upcoming") >= 0) return 4;
    if (t.indexOf("airing") >= 0 || t.indexOf("ongoing") >= 0) return 0;
    return 5;
  }

  // Episode list HTML → [{id, slug, title, sub, dub, ids}], in site order.
  // Parsed with a regex rather than Document: One Piece's list is ~900 KB.
  _parseEpisodes(html) {
    var eps = [];
    var re = /<a href="#"([^>]*data-slug="[^"]*"[^>]*)>/g;
    var m;
    while ((m = re.exec(html)) !== null) {
      var tag = m[1];
      var get = function (name) {
        var mm = tag.match(new RegExp("\\s" + name + '="([^"]*)"'));
        return mm ? mm[1] : "";
      };
      eps.push({
        slug: get("data-slug"),
        title: this._decodeEntities(get("title")).trim(),
        sub: get("data-sub") === "1",
        dub: get("data-dub") === "1",
        ids: get("data-ids"),
        timestamp: get("data-timestamp"),
      });
    }
    return eps;
  }

  async _fetchEpisodes(animeId, referer) {
    var data = await this._getJson(this.source.baseUrl + "/ajax/episode/list/" + animeId, referer);
    if (!data || data.status !== 200 || !data.result) return [];
    return this._parseEpisodes(data.result);
  }

  async getDetail(url) {
    var animeUrl = this._animeUrl(url);
    var res = await this.client.get(animeUrl, this.getHeaders());
    var html = res.body || "";
    var doc = new Document(html);

    var idM = html.match(/id="watch-page"[^>]*data-id="(\d+)"/);
    var animeId = idM ? idM[1] : "";

    var h1 = doc.selectFirst("#media-info h1.title") || doc.selectFirst("h1");
    var name = h1 ? h1.text.trim() : "";
    var img = doc.selectFirst("#media-info .poster img");
    var imageUrl = img ? (img.attr("src") || img.attr("data-src") || "") : "";
    var descEl = doc.selectFirst("#media-info .description .full div") ||
                 doc.selectFirst("#media-info .description div");
    var description = descEl ? descEl.text.trim() : "";

    var genre = [];
    var status = 5;
    var author = "";
    var rows = doc.select("#media-info .meta > div");
    for (var i = 0; i < rows.length; i++) {
      var label = rows[i].selectFirst("div");
      var key = label ? label.text.trim().replace(/:\s*$/, "").toLowerCase() : "";
      var val = rows[i].selectFirst("span");
      if (!val) continue;
      if (key === "status") status = this._statusCode(val.text);
      else if (key === "genre") {
        var links = val.select("a");
        for (var g = 0; g < links.length; g++) {
          var t = links[g].text.trim();
          if (t) genre.push(t);
        }
      } else if (key === "studios") author = val.text.trim().replace(/\s+/g, " ");
    }

    var chapters = [];
    if (animeId) {
      var eps = await this._fetchEpisodes(animeId, animeUrl);
      for (var e = 0; e < eps.length; e++) {
        var ep = eps[e];
        if (!ep.slug) continue;
        var label = "Episode " + ep.slug;
        // Named episodes carry their title; the rest just say "Episode N".
        if (ep.title && !/^Episode\s+[\d.]+$/i.test(ep.title)) label += ": " + ep.title;
        var date = ep.timestamp ? String(parseInt(ep.timestamp, 10) * 1000) : "";
        chapters.push({
          name: label,
          // animeId||epSlug||ids — ids is used directly; the first two let
          // getVideoList re-read the list if the site ever rotates ids.
          url: animeId + "||" + ep.slug + "||" + ep.ids,
          dateUpload: date,
          scanlator: ep.sub && ep.dub ? "Sub · Dub" : ep.dub ? "Dub" : ep.sub ? "Sub" : "",
        });
      }
      chapters.reverse();
    }

    return {
      name: name,
      imageUrl: imageUrl,
      description: description,
      genre: genre,
      author: author,
      status: status,
      link: animeUrl,
      chapters: chapters,
    };
  }

  // Pure-JS base64 decoder — atob() is not available in Mangayomi's QuickJS runtime.
  _b64dec(s) {
    var t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    s = s.replace(/[^A-Za-z0-9+/]/g, "");
    var out = "", i = 0;
    while (i < s.length) {
      var a = t.indexOf(s[i++]), b = t.indexOf(s[i++]);
      var c = t.indexOf(s[i++]), d = t.indexOf(s[i++]);
      if (a < 0 || b < 0) break;
      out += String.fromCharCode((a << 2) | (b >> 4));
      if (c >= 0) out += String.fromCharCode(((b & 15) << 4) | (c >> 2));
      if (d >= 0) out += String.fromCharCode(((c & 3) << 6) | d);
    }
    return out;
  }

  // ---------------------------------------------------------------- crypto
  //
  // Mangayomi's QuickJS runtime has no WebCrypto and no Node crypto, so the two
  // primitives MegaPlay's player relies on are implemented here: SHA-256 (for
  // the HMAC that signs a CDN URL) and AES-256-CBC decryption (for the `enc`
  // blob that replaced the plain sources array).

  _bytesOf(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) out.push(str.charCodeAt(i) & 0xff);
    return out;
  }

  _sha256(bytes) {
    var K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
      0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
      0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
      0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
      0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
      0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
      0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
      0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    var H = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];
    var msg = bytes.slice();
    var bitLen = msg.length * 8;
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    // Inputs here are a few hundred bytes at most, so the high length word is 0.
    msg.push(0, 0, 0, 0);
    msg.push((bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);

    var rotr = function (x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; };
    var w = new Array(64);
    for (var off = 0; off < msg.length; off += 64) {
      for (var t = 0; t < 16; t++) {
        w[t] = ((msg[off + t * 4] << 24) | (msg[off + t * 4 + 1] << 16) |
                (msg[off + t * 4 + 2] << 8) | msg[off + t * 4 + 3]) >>> 0;
      }
      for (t = 16; t < 64; t++) {
        var s0 = (rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3)) >>> 0;
        var s1 = (rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10)) >>> 0;
        w[t] = (((w[t - 16] + s0) >>> 0) + ((w[t - 7] + s1) >>> 0)) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3];
      var e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        var ch = ((e & f) ^ (~e & g)) >>> 0;
        var temp1 = (((((h + S1) >>> 0) + ch) >>> 0) + ((K[t] + w[t]) >>> 0)) >>> 0;
        var S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        var temp2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e;
        e = (d + temp1) >>> 0;
        d = c; c = b; b = a;
        a = (temp1 + temp2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
      H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    var out = [];
    for (var i = 0; i < 8; i++) {
      out.push((H[i] >>> 24) & 0xff, (H[i] >>> 16) & 0xff, (H[i] >>> 8) & 0xff, H[i] & 0xff);
    }
    return out;
  }

  _hmacSha256(keyStr, msgStr) {
    var key = this._bytesOf(keyStr);
    if (key.length > 64) key = this._sha256(key);
    while (key.length < 64) key.push(0);
    var ipad = [], opad = [];
    for (var i = 0; i < 64; i++) { ipad.push(key[i] ^ 0x36); opad.push(key[i] ^ 0x5c); }
    var inner = this._sha256(ipad.concat(this._bytesOf(msgStr)));
    return this._sha256(opad.concat(inner));
  }

  _aesTables() {
    if (this._aesT) return this._aesT;
    var sbox = new Array(256);
    var inv = new Array(256);
    var p = 1, q = 1;
    // Walk the generator 3 through GF(2^8) to build the S-box affinely.
    do {
      p = (p ^ (p << 1) ^ (p & 0x80 ? 0x1b : 0)) & 0xff;
      q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff;
      if (q & 0x80) q ^= 0x09;
      var x = (q ^ ((q << 1) | (q >>> 7)) ^ ((q << 2) | (q >>> 6)) ^
        ((q << 3) | (q >>> 5)) ^ ((q << 4) | (q >>> 4))) & 0xff;
      sbox[p] = x ^ 0x63;
    } while (p !== 1);
    sbox[0] = 0x63;
    for (var i = 0; i < 256; i++) inv[sbox[i]] = i;
    this._aesT = { sbox: sbox, inv: inv };
    return this._aesT;
  }

  _gmul(a, b) {
    var r = 0;
    for (var i = 0; i < 8; i++) {
      if (b & 1) r ^= a;
      var hi = a & 0x80;
      a = (a << 1) & 0xff;
      if (hi) a ^= 0x1b;
      b >>= 1;
    }
    return r & 0xff;
  }

  // Key schedule for any AES key length. MegaPlay uses a 32-byte key (Nk 8,
  // 14 rounds); the extra SubWord at i % Nk === 4 applies only at that size.
  _expandKey(key) {
    var T = this._aesTables();
    var rcon = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];
    var nk = key.length / 4;
    var rounds = nk + 6;
    var w = [];
    for (var i = 0; i < nk; i++) {
      w.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]);
    }
    for (i = nk; i < 4 * (rounds + 1); i++) {
      var t = w[i - 1].slice();
      if (i % nk === 0) {
        t.push(t.shift());
        t = t.map(function (b) { return T.sbox[b]; });
        t[0] ^= rcon[i / nk - 1];
      } else if (nk > 6 && i % nk === 4) {
        t = t.map(function (b) { return T.sbox[b]; });
      }
      var prev = w[i - nk];
      w.push(t.map(function (b, j) { return b ^ prev[j]; }));
    }
    return { w: w, rounds: rounds };
  }

  _invShiftRows(s) {
    for (var r = 1; r < 4; r++) {
      var row = [s[r], s[4 + r], s[8 + r], s[12 + r]];
      for (var c = 0; c < 4; c++) s[c * 4 + r] = row[(c - r + 4) % 4];
    }
  }

  _invMixColumns(s) {
    for (var c = 0; c < 4; c++) {
      var a0 = s[c * 4], a1 = s[c * 4 + 1], a2 = s[c * 4 + 2], a3 = s[c * 4 + 3];
      s[c * 4] = this._gmul(a0, 14) ^ this._gmul(a1, 11) ^ this._gmul(a2, 13) ^ this._gmul(a3, 9);
      s[c * 4 + 1] = this._gmul(a0, 9) ^ this._gmul(a1, 14) ^ this._gmul(a2, 11) ^ this._gmul(a3, 13);
      s[c * 4 + 2] = this._gmul(a0, 13) ^ this._gmul(a1, 9) ^ this._gmul(a2, 14) ^ this._gmul(a3, 11);
      s[c * 4 + 3] = this._gmul(a0, 11) ^ this._gmul(a1, 13) ^ this._gmul(a2, 9) ^ this._gmul(a3, 14);
    }
  }

  _decryptBlock(block, sched) {
    var T = this._aesTables();
    var w = sched.w;
    var s = block.slice();
    var addRound = function (round) {
      for (var c = 0; c < 4; c++) {
        for (var r = 0; r < 4; r++) s[c * 4 + r] ^= w[round * 4 + c][r];
      }
    };
    addRound(sched.rounds);
    for (var round = sched.rounds - 1; round >= 1; round--) {
      this._invShiftRows(s);
      for (var i = 0; i < 16; i++) s[i] = T.inv[s[i]];
      addRound(round);
      this._invMixColumns(s);
    }
    this._invShiftRows(s);
    for (var j = 0; j < 16; j++) s[j] = T.inv[s[j]];
    addRound(0);
    return s;
  }

  _aesCbcDecrypt(cipher, key, iv) {
    var sched = this._expandKey(key);
    var out = [];
    var prev = iv.slice();
    for (var off = 0; off + 16 <= cipher.length; off += 16) {
      var block = cipher.slice(off, off + 16);
      var plain = this._decryptBlock(block, sched);
      for (var i = 0; i < 16; i++) out.push(plain[i] ^ prev[i]);
      prev = block;
    }
    // Strip PKCS#7 if it looks well-formed.
    var pad = out[out.length - 1];
    if (pad >= 1 && pad <= 16 && out.length >= pad) {
      var ok = true;
      for (var k = out.length - pad; k < out.length; k++) if (out[k] !== pad) ok = false;
      if (ok) out = out.slice(0, out.length - pad);
    }
    return out;
  }

  _b64urlEncode(bytes) {
    var t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    var out = "", i = 0, n = bytes.length;
    while (i < n) {
      var a = bytes[i++];
      out += t[a >> 2];
      if (i === n) { out += t[(a & 3) << 4]; break; }
      var b = bytes[i++];
      out += t[((a & 3) << 4) | (b >> 4)];
      if (i === n) { out += t[(b & 15) << 2]; break; }
      var c = bytes[i++];
      out += t[((b & 15) << 2) | (c >> 6)];
      out += t[c & 63];
    }
    return out; // padding omitted, as the player's own encoder does
  }

  _b64urlDecodeBytes(str) {
    return this._bytesOf(this._b64dec(String(str).replace(/-/g, "+").replace(/_/g, "/")));
  }

  // ------------------------------------------------------------- megaplay

  // `enc` is AES-256-CBC over the JSON that used to sit in `sources`, keyed with
  // constants the player hands out in plain text. Returns the playlist URL, or
  // "" if the shape changed — a rotated key surfaces as an empty picker, not a
  // crash, and the rest of the server walk carries on.
  _decodeEncSources(enc) {
    try {
      var key = this._bytesOf(MEGAPLAY_ENC_KEY);
      while (key.length < 32) key.push(0);
      var iv = this._bytesOf(MEGAPLAY_ENC_IV);
      while (iv.length < 16) iv.push(0);
      var plain = this._aesCbcDecrypt(this._b64urlDecodeBytes(enc), key.slice(0, 32), iv.slice(0, 16));
      var text = "";
      for (var i = 0; i < plain.length; i++) text += String.fromCharCode(plain[i]);
      var data = JSON.parse(text);
      if (typeof data === "string") return data;
      if (data && data.file) return data.file;
      if (Array.isArray(data) && data.length) return data[0].file || data[0].url || "";
      if (data && data.sources) {
        if (typeof data.sources === "string") return data.sources;
        if (data.sources.file) return data.sources.file;
        if (Array.isArray(data.sources) && data.sources.length) return data.sources[0].file || "";
      }
    } catch (e) {}
    return "";
  }

  // The CDN 403s a master playlist that carries no ?token=. The token is
  // base64url("<expiry>|<id1>/<id2>") + "." + base64url(its HMAC-SHA256), where
  // the two ids are the 32-hex path components of the playlist URL — exactly
  // what lib/e1-player.min.js builds before handing the URL to jwplayer. Media
  // playlists and segments below the master need no token.
  _signCdnUrl(url) {
    if (!url || /[?&]token=/.test(url)) return url;
    var m = String(url).match(/\/([a-f0-9]{32})\/([a-f0-9]{32})\//i);
    if (!m) return url;
    var path = m[1].toLowerCase() + "/" + m[2].toLowerCase();
    var msg = (Math.floor(Date.now() / 1000) + MEGAPLAY_TOKEN_TTL) + "|" + path;
    var token = this._b64urlEncode(this._bytesOf(msg)) + "." +
                this._b64urlEncode(this._hmacSha256(MEGAPLAY_CDN_SECRET, msg));
    return url + (url.indexOf("?") >= 0 ? "&" : "?") + "token=" + token;
  }


  // ------------------------------------------------------------ subtitles

  // Convert a WebVTT timestamp to SRT format.
  // lostproject.club VTTs use MM:SS.mmm (no hours); libmpv rejects this two-part form.
  _vttTsToSrt(ts) {
    var dotIdx = ts.lastIndexOf(".");
    var ms = ts.substring(dotIdx + 1);
    var parts = ts.substring(0, dotIdx).split(":");
    while (parts.length < 3) parts.unshift("00");
    return parts.join(":") + "," + ms;
  }

  _vttToSrt(vtt) {
    var lines = vtt.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    var srt = "", cueNum = 1, i = 0;
    while (i < lines.length && lines[i].trim() !== "") i++;
    while (i < lines.length) {
      while (i < lines.length && lines[i].trim() === "") i++;
      if (i >= lines.length) break;
      var line = lines[i];
      if (/^(NOTE|STYLE|REGION)\b/.test(line)) {
        while (i < lines.length && lines[i].trim() !== "") i++;
        continue;
      }
      if (line.indexOf("-->") < 0) { i++; if (i >= lines.length) break; line = lines[i]; }
      if (line.indexOf("-->") < 0) { i++; continue; }
      var m = line.match(/([\d:]+\.\d{3})\s*-->\s*([\d:]+\.\d{3})/);
      if (!m) { i++; continue; }
      var start = this._vttTsToSrt(m[1]), end = this._vttTsToSrt(m[2]);
      i++;
      var textLines = [];
      while (i < lines.length && lines[i].trim() !== "") {
        textLines.push(lines[i].replace(/<[\d:]+\.\d{3}>/g, ""));
        i++;
      }
      if (textLines.length > 0) {
        srt += cueNum + "\n" + start + " --> " + end + "\n" + textLines.join("\n") + "\n\n";
        cueNum++;
      }
    }
    return srt || vtt;
  }

  // Download subtitle tracks with the correct Referer (lostproject.club 403s without it),
  // convert VTT→SRT so libmpv handles the timestamps correctly, return inline text.
  // Dubs ship ~10 languages; each is a separate download, so by default only
  // English is fetched. The track MegaPlay flags default:true goes first.
  async _inlineSubtitles(tracks, referer) {
    if (!Array.isArray(tracks)) return [];
    var allLangs = this._pref("allwish_pref_sub_langs", "english") === "all";
    tracks = tracks.filter(function (tr) {
      return tr && tr.file && tr.kind !== "thumbnails" &&
        (allLangs || /^english/i.test(tr.label || ""));
    });
    tracks.sort(function (a, b) { return (b.default ? 1 : 0) - (a.default ? 1 : 0); });
    var subtitles = [];
    for (var t = 0; t < tracks.length; t++) {
      var track = tracks[t];
      try {
        var res = await this.client.get(track.file, { "User-Agent": this.ua, "Referer": referer });
        var body = (res.body || "").replace(/^\s+/, "");
        if (body.indexOf("WEBVTT") !== 0) continue;
        subtitles.push({ file: this._vttToSrt(body), label: track.label || "Unknown" });
      } catch (e) {}
    }
    return subtitles;
  }

  // ---------------------------------------------------------------- video

  // Server list HTML → [{type: "sub"|"dub", name, linkId}].
  _parseServers(html) {
    var out = [];
    var blocks = String(html || "").split(/<div class="server-type[^"]*"/);
    for (var b = 1; b < blocks.length; b++) {
      var typeM = blocks[b].match(/data-type="([^"]+)"/);
      var type = typeM ? typeM[1].toLowerCase() : "sub";
      var re = /data-link-id="([^"]+)"[^>]*>\s*<div>\s*<span>([^<]*)<\/span>/g;
      var m;
      while ((m = re.exec(blocks[b])) !== null) {
        out.push({ type: type, linkId: m[1], name: m[2].trim() });
      }
    }
    return out;
  }

  async _serverList(ids) {
    if (!ids) return [];
    var data = await this._getJson(
      this.source.baseUrl + "/ajax/server/list?servers=" + encodeURIComponent(ids));
    if (!data || data.status !== 200 || !data.result) return [];
    return this._parseServers(data.result);
  }

  // HLS master → [{url, label}] sorted highest first; a flat media playlist
  // comes back as a single "Auto" entry. null when the CDN refused it.
  async _hlsVariants(masterUrl, headers) {
    var res = await this.client.get(masterUrl, headers);
    var body = res.body || "";
    if (body.indexOf("#EXTM3U") < 0) return null;
    if (body.indexOf("#EXT-X-STREAM-INF") < 0) return [{ url: masterUrl, label: "Auto" }];
    var baseDir = masterUrl.substring(0, masterUrl.lastIndexOf("/") + 1);
    var origin = (masterUrl.match(/^https?:\/\/[^\/]+/) || [""])[0];
    var lines = body.split("\n");
    var variants = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.indexOf("#EXT-X-STREAM-INF:") !== 0) continue;
      var resM = line.match(/RESOLUTION=\d+x(\d+)/);
      var label = resM ? resM[1] + "p" : "Auto";
      for (var j = i + 1; j < lines.length; j++) {
        var u = lines[j].trim();
        if (!u || u.charAt(0) === "#") continue;
        var abs = u.indexOf("http") === 0 ? u : u.charAt(0) === "/" ? origin + u : baseDir + u;
        variants.push({ url: abs, label: label });
        break;
      }
    }
    variants.sort(function (a, b) { return (parseInt(b.label) || 0) - (parseInt(a.label) || 0); });
    return variants.length ? variants : [{ url: masterUrl, label: "Auto" }];
  }

  // One server entry → playable streams. Chain:
  //   /ajax/server?get= → megaplay.buzz/stream/s-1/{token} embed
  //   embed page → data-id (the getSources id; NOT anything in the embed path)
  //   /stream/getSources?id= → enc → AES → m3u8 → sign → variants
  async _resolveServer(server) {
    var audio = server.type === "dub" ? "Dub" : "Sub";
    var data = await this._getJson(
      this.source.baseUrl + "/ajax/server?get=" + encodeURIComponent(server.linkId));
    var embedUrl = data && data.result ? (data.result.url || data.result.link || "") : "";
    if (!embedUrl) return [];
    var host = (embedUrl.match(/^https?:\/\/[^\/]+/) || [""])[0];
    if (!host) return [];

    var page = await this.client.get(embedUrl, this.getHeaders());
    var pageBody = page.body || "";
    var idM = pageBody.match(/data-id="(\d+)"/) || pageBody.match(/<title>File (\d+)/i);
    if (!idM) return [];

    var src = await this._getJson(host + "/stream/getSources?id=" + idM[1], embedUrl);
    if (!src) return [];
    var m3u8 = "";
    if (src.sources) {
      if (typeof src.sources === "string") m3u8 = src.sources;
      else if (src.sources.file) m3u8 = src.sources.file;
      else if (Array.isArray(src.sources) && src.sources.length) m3u8 = src.sources[0].file || "";
    }
    if (!m3u8 && src.enc) m3u8 = this._decodeEncSources(src.enc);
    if (!m3u8) return [];
    m3u8 = this._signCdnUrl(m3u8);

    var hdrs = { "User-Agent": this.ua, "Referer": host + "/", "Origin": host };
    var variants = await this._hlsVariants(m3u8, hdrs);
    if (!variants) return [];
    // Softsub tracks (sub only — dub audio carries none). Inlined as SRT, since
    // the subtitle host 403s without MegaPlay's Referer and libmpv rejects the
    // hour-less VTT timestamps these files use.
    var subtitles = await this._inlineSubtitles(src.tracks, host + "/");

    var streams = [];
    for (var v = 0; v < variants.length; v++) {
      streams.push({
        url: variants[v].url,
        originalUrl: variants[v].url,
        quality: server.name + " - " + variants[v].label + " - " + audio,
        headers: hdrs,
        subtitles: subtitles,
      });
    }
    return streams;
  }

  _qualityRank(stream, pref) {
    if (pref === "auto") return 0;
    var m = stream.quality.match(/(\d{3,4})p/);
    return m && m[1] === pref ? 0 : 1;
  }

  async getVideoList(url) {
    var parts = String(url).split("||");
    var animeId = parts[0], epSlug = parts[1], ids = parts.slice(2).join("||");

    var servers = [];
    try { servers = await this._serverList(ids); } catch (e) {}
    if (!servers.length && animeId && epSlug) {
      // Stored ids went stale — re-read the episode list for fresh ones.
      var eps = await this._fetchEpisodes(animeId);
      for (var i = 0; i < eps.length; i++) {
        if (eps[i].slug === epSlug) { servers = await this._serverList(eps[i].ids); break; }
      }
    }
    if (!servers.length) throw new Error("AllWish: no servers listed for this episode.");

    var audioPref = this._pref("allwish_pref_audio", "sub_dub");
    var order = audioPref === "dub_sub" ? ["dub", "sub"]
              : audioPref === "sub" ? ["sub"]
              : audioPref === "dub" ? ["dub"]
              : ["sub", "dub"];
    // A title with no copy in the chosen audio still plays what the site has.
    var wanted = servers.filter(function (s) { return order.indexOf(s.type) >= 0; });
    if (!wanted.length) wanted = servers;
    wanted.sort(function (a, b) {
      var ia = order.indexOf(a.type), ib = order.indexOf(b.type);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

    var streams = [];
    for (var s = 0; s < wanted.length; s++) {
      try {
        var got = await this._resolveServer(wanted[s]);
        for (var g = 0; g < got.length; g++) streams.push(got[g]);
      } catch (e) {}
    }
    if (!streams.length) throw new Error("AllWish: the MegaPlay server returned no playable stream.");

    // Stable sort: preferred quality first, audio order kept within each group.
    var qPref = String(this._pref("allwish_pref_quality", "auto"));
    var self = this;
    var ranked = streams.map(function (st, idx) { return { st: st, idx: idx }; });
    ranked.sort(function (a, b) {
      return (self._qualityRank(a.st, qPref) - self._qualityRank(b.st, qPref)) || (a.idx - b.idx);
    });
    return ranked.map(function (r) { return r.st; });
  }

  // -------------------------------------------------------------- filters

  getFilterList() {
    var checks = function (pairs) {
      return pairs.map(function (p) { return { type_name: "CheckBox", name: p[0], value: p[1] }; });
    };
    return [
      {
        type_name: "SelectFilter",
        name: "Sort",
        state: 0,
        values: AW_SORTS.map(function (p) { return { type_name: "SelectOption", name: p[0], value: p[1] }; }),
      },
      { type_name: "GroupFilter", name: "Genre", state: checks(AW_GENRES) },
      { type_name: "GroupFilter", name: "Type", state: checks(AW_TYPES) },
      { type_name: "GroupFilter", name: "Status", state: checks(AW_STATUS) },
      { type_name: "GroupFilter", name: "Season", state: checks(AW_SEASONS) },
      { type_name: "GroupFilter", name: "Language", state: checks(AW_LANGUAGES) },
    ];
  }

  getSourcePreferences() {
    return [
      {
        key: "allwish_pref_audio",
        listPreference: {
          title: "Preferred audio",
          summary: "Which track plays first. With both selected, the other stays in the picker as a fallback.",
          valueIndex: 0,
          entries: ["Sub then Dub", "Dub then Sub", "Sub only", "Dub only"],
          entryValues: ["sub_dub", "dub_sub", "sub", "dub"],
        },
      },
      {
        key: "allwish_pref_quality",
        listPreference: {
          title: "Preferred quality",
          summary: "Plays this resolution first when the episode has it. Every quality stays in the picker.",
          valueIndex: 0,
          entries: ["Auto (highest available)", "1080p", "720p", "480p", "360p"],
          entryValues: ["auto", "1080", "720", "480", "360"],
        },
      },
      {
        key: "allwish_pref_sub_langs",
        listPreference: {
          title: "Subtitle languages",
          summary: "Dubbed episodes come with up to ten subtitle languages, each one an extra download before playback starts. Subbed episodes are usually hardsubbed and carry none.",
          valueIndex: 0,
          entries: ["English only", "All languages"],
          entryValues: ["english", "all"],
        },
      },
    ];
  }
}
