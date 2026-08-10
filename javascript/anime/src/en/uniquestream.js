const mangayomiSources = [
  {
    "name": "UniqueStream",
    "id": 1616027577,
    "lang": "en",
    "baseUrl": "https://anime.uniquestream.net",
    "apiUrl": "https://anime.uniquestream.net/api/v1",
    "iconUrl":
      "https://www.google.com/s2/favicons?sz=256&domain=https://anime.uniquestream.net",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.1.1",
    "pkgPath": "anime/src/en/uniquestream.js",
  },
];

// UniqueStream (site brand "AnimeStream") is a Nuxt front-end over a FastAPI
// backend whose whole public surface is documented at /api/v1/openapi.json.
// Everything below is plain JSON — no scraping, no tokens, no Cloudflare.
//
// Playback is the only hard part. Media playlists are AES-128 encrypted and
// their #EXT-X-KEY points at a key.bin that does NOT return a raw key: it
// returns base64 of a 32-byte blob that is itself AES-128-CBC encrypted, and
// only decrypts when the request carries an x-am-media-id header. A stock
// player therefore feeds 45 bytes of base64 text to the AES stage and renders
// noise. See _resolveKey() for the derivation, lifted from the site's own
// player, and _buildMaster() for how the fixed key is inlined.
class DefaultExtension extends MProvider {
  getPreference(key) {
    return new SharedPreferences().get(key);
  }

  // ---------------------------------------------------------------- helpers

  async _api(path) {
    var res = await new Client().get(this.source.apiUrl + path, {
      "Referer": this.source.baseUrl + "/",
    });
    if (res.statusCode !== 200) {
      throw new Error("API " + res.statusCode + " for " + path);
    }
    return JSON.parse(res.body);
  }

  // Poster art comes in a few shapes across endpoints; pick the tall one.
  _poster(item) {
    if (item.image) return item.image;
    var imgs = item.images;
    if (!imgs) return "";
    if (Array.isArray(imgs)) {
      var tall = imgs.filter((x) => x.type === "poster_tall")[0];
      return (tall || imgs[0] || {}).url || "";
    }
    return imgs.tall || imgs.wide || "";
  }

  // A browse/search row -> a Mangayomi list entry. Movies and shows live in
  // the same lists but need different detail/media endpoints, so the kind is
  // baked into the link rather than re-derived later.
  _toEntry(item) {
    var isMovie = item.type === "movie";
    var path = (isMovie ? "/movies/" : "/series/") + item.content_id;
    return {
      "name": item.title,
      "link": this.source.baseUrl + path,
      "imageUrl": this._poster(item),
    };
  }

  _entryList(items, limit) {
    var list = (items || []).map((x) => this._toEntry(x));
    return { "list": list, "hasNextPage": list.length >= limit };
  }

  // baseUrl/series/<id> or /movies/<id> -> { kind, id }
  _parseLink(url) {
    var clean = String(url).split("?")[0].replace(/\/+$/, "");
    var parts = clean.split("/").filter((x) => x.length > 0);
    var i = parts.indexOf("movies");
    if (i > -1) return { kind: "movie", id: parts[i + 1] };
    i = parts.indexOf("series");
    if (i > -1) return { kind: "series", id: parts[i + 1] };
    // Chapter urls are /watch/<id>/<kind>
    i = parts.indexOf("watch");
    if (i > -1) {
      return { kind: parts[i + 2] === "movie" ? "movie" : "episode", id: parts[i + 1] };
    }
    return { kind: "series", id: parts[parts.length - 1] };
  }

  // -------------------------------------------------------------- discovery

  async getPopular(page) {
    var limit = 20;
    var data = await this._api(
      "/videos/popular?page=" + page + "&limit=" + limit + "&type=all"
    );
    return this._entryList(data, limit);
  }

  async getLatestUpdates(page) {
    var limit = 20;
    var data = await this._api(
      "/videos/new?page=" + page + "&limit=" + limit + "&type=all"
    );
    return this._entryList(data, limit);
  }

  async search(query, page, filters) {
    var genre = "";
    var year = "";
    var status = "";
    var audio = "";
    try {
      if (filters && filters.length) {
        var g = filters[0];
        if (g && g.values && g.values[g.state]) genre = g.values[g.state].value;
        var y = filters[1];
        if (y && y.values && y.values[y.state]) year = y.values[y.state].value;
        var s = filters[2];
        if (s && s.values && s.values[s.state]) status = s.values[s.state].value;
        var a = filters[3];
        if (a && a.values && a.values[a.state]) audio = a.values[a.state].value;
      }
    } catch (e) {
      // Filters are optional; a malformed set must not break plain search.
    }

    // No query and no filters is the "browse everything" case, which /search
    // answers with an empty set — /videos/browse is the alphabetical index.
    if (!query && !genre && !year && !status && !audio) {
      var bLimit = 50;
      var b = await this._api(
        "/videos/browse?page=" + page + "&limit=" + bLimit
      );
      return this._entryList(b.data, bLimit);
    }

    var limit = 50;
    var path =
      "/search?query=" +
      encodeURIComponent(query || "") +
      "&page=" +
      page +
      "&limit=" +
      limit +
      "&genre=" +
      encodeURIComponent(genre) +
      "&status=" +
      encodeURIComponent(status) +
      "&audio=" +
      encodeURIComponent(audio);
    if (year) path += "&year=" + encodeURIComponent(year);

    var data = await this._api(path);
    var merged = (data.series || []).concat(data.movies || []);
    var list = merged.map((x) => this._toEntry(x));
    return { "list": list, "hasNextPage": merged.length >= limit };
  }

  // ----------------------------------------------------------------- detail

  _statusCode(status) {
    return (
      {
        "RELEASING": 0,
        "FINISHED": 1,
        "NOT_YET_RELEASED": 4,
        "CANCELLED": 3,
        "HIATUS": 2,
      }[status] ?? 5
    );
  }

  async getDetail(url) {
    var ref = this._parseLink(url);
    if (ref.kind === "movie") return await this._movieDetail(ref.id, url);
    return await this._seriesDetail(ref.id, url);
  }

  async _movieDetail(id, link) {
    var d = await this._api("/movie/" + id);
    return {
      "imageUrl": this._poster(d),
      "description": d.description || "",
      "genre": (d.genre || []).map((g) => g.title || g.name || g),
      "status": 1,
      "link": link,
      "chapters": [
        {
          "name": "Movie",
          "url": this.source.baseUrl + "/watch/" + id + "/movie",
        },
      ],
    };
  }

  async _seriesDetail(id, link) {
    var d = await this._api("/series/" + id);
    var seasons = d.seasons || [];

    // /season/<id>/episodes is hard-capped at 20 per page, so a long series
    // needs many round trips. episode_count is known up front, so the page
    // count is computed rather than discovered, and requests go out in small
    // batches — the API throttles hard above ~6 in flight.
    var jobs = [];
    for (var s = 0; s < seasons.length; s++) {
      var se = seasons[s];
      var pages = Math.max(1, Math.ceil((se.episode_count || 0) / 20));
      for (var p = 1; p <= pages; p++) {
        jobs.push({ season: se, seasonIndex: s, page: p });
      }
    }

    var results = [];
    var batch = 6;
    for (var i = 0; i < jobs.length; i += batch) {
      var slice = jobs.slice(i, i + batch);
      var chunk = await Promise.all(
        slice.map(async (job) => {
          try {
            var eps = await this._api(
              "/season/" +
                job.season.content_id +
                "/episodes?page=" +
                job.page +
                "&limit=20&order_by=asc"
            );
            return { job: job, eps: eps || [] };
          } catch (e) {
            return { job: job, eps: [] };
          }
        })
      );
      results = results.concat(chunk);
    }

    // Season order first, then page order, so episodes land in airing order.
    results.sort((a, b) =>
      a.job.seasonIndex !== b.job.seasonIndex
        ? a.job.seasonIndex - b.job.seasonIndex
        : a.job.page - b.job.page
    );

    var multiSeason = seasons.length > 1;
    var chapters = [];
    for (var r = 0; r < results.length; r++) {
      var season = results[r].job.season;
      for (var e = 0; e < results[r].eps.length; e++) {
        var ep = results[r].eps[e];
        if (ep.is_clip) continue;
        var num = ep.episode || ep.episode_number;
        var label = "E" + num;
        if (multiSeason) {
          label = "S" + (season.season_number || season.season_seq_number) + label;
        }
        if (ep.title) label += ": " + ep.title;
        chapters.push({
          "name": label,
          "url": this.source.baseUrl + "/watch/" + ep.content_id + "/episode",
        });
      }
    }

    return {
      "imageUrl": this._poster(d),
      "description": d.description || "",
      "genre": (d.genre || []).map((g) => g.title || g.name || g),
      "status": this._statusCode(d.status),
      "link": link,
      "chapters": chapters.reverse(),
    };
  }

  // ------------------------------------------------------------ base64 / io
  // QuickJS in Mangayomi has neither atob/btoa nor a binary response type, so
  // both directions are hand-rolled over charCode arrays.

  _b64ToBytes(s) {
    var t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    s = String(s).replace(/[^A-Za-z0-9+/]/g, "");
    var out = [];
    var i = 0;
    while (i < s.length) {
      var a = t.indexOf(s.charAt(i++));
      var b = t.indexOf(s.charAt(i++));
      var c = t.indexOf(s.charAt(i++));
      var d = t.indexOf(s.charAt(i++));
      if (a < 0 || b < 0) break;
      out.push(((a << 2) | (b >> 4)) & 0xff);
      if (c >= 0) out.push((((b & 15) << 4) | (c >> 2)) & 0xff);
      if (d >= 0) out.push((((c & 3) << 6) | d) & 0xff);
    }
    return out;
  }

  _bytesToB64(bytes) {
    var t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var out = "";
    var i = 0;
    var n = bytes.length;
    while (i < n) {
      var a = bytes[i++] & 0xff;
      out += t.charAt(a >> 2);
      if (i === n) {
        out += t.charAt((a & 3) << 4) + "==";
        break;
      }
      var b = bytes[i++] & 0xff;
      out += t.charAt(((a & 3) << 4) | (b >> 4));
      if (i === n) {
        out += t.charAt((b & 15) << 2) + "=";
        break;
      }
      var c = bytes[i++] & 0xff;
      out += t.charAt(((b & 15) << 2) | (c >> 6));
      out += t.charAt(c & 63);
    }
    return out;
  }

  _strToB64(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i) & 0xff);
    return this._bytesToB64(bytes);
  }

  // -------------------------------------------------------------- sha-256

  _sha256(asciiStr) {
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
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
      0x1f83d9ab, 0x5be0cd19,
    ];

    var bytes = [];
    for (var i = 0; i < asciiStr.length; i++) {
      bytes.push(asciiStr.charCodeAt(i) & 0xff);
    }
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    // Length fits comfortably in 32 bits for our inputs.
    bytes.push(0, 0, 0, 0);
    bytes.push((bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);

    var rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;
    var w = new Array(64);

    for (var off = 0; off < bytes.length; off += 64) {
      for (var t = 0; t < 16; t++) {
        w[t] =
          ((bytes[off + t * 4] << 24) |
            (bytes[off + t * 4 + 1] << 16) |
            (bytes[off + t * 4 + 2] << 8) |
            bytes[off + t * 4 + 3]) >>>
          0;
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
    for (i = 0; i < 8; i++) {
      out.push((H[i] >>> 24) & 0xff, (H[i] >>> 16) & 0xff, (H[i] >>> 8) & 0xff, H[i] & 0xff);
    }
    return out;
  }

  // ------------------------------------------------------- aes-128-cbc dec

  _aesTables() {
    if (this._aesT) return this._aesT;
    var sbox = new Array(256);
    var inv = new Array(256);
    var p = 1;
    var q = 1;
    // Walk the generator 3 through GF(2^8) to build the S-box affinely.
    do {
      p = (p ^ (p << 1) ^ (p & 0x80 ? 0x1b : 0)) & 0xff;
      q ^= q << 1;
      q ^= q << 2;
      q ^= q << 4;
      q &= 0xff;
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

  _expandKey(key) {
    var T = this._aesTables();
    var rcon = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];
    var w = [];
    for (var i = 0; i < 4; i++) {
      w.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]);
    }
    for (i = 4; i < 44; i++) {
      var t = w[i - 1].slice();
      if (i % 4 === 0) {
        t.push(t.shift());
        t = t.map((b) => T.sbox[b]);
        t[0] ^= rcon[i / 4 - 1];
      }
      w.push(t.map((b, j) => b ^ w[i - 4][j]));
    }
    return w;
  }

  _decryptBlock(block, w) {
    var T = this._aesTables();
    var s = block.slice();
    var addRound = (round) => {
      for (var c = 0; c < 4; c++) {
        for (var r = 0; r < 4; r++) s[c * 4 + r] ^= w[round * 4 + c][r];
      }
    };

    addRound(10);
    for (var round = 9; round >= 1; round--) {
      this._invShiftRows(s);
      for (var i = 0; i < 16; i++) s[i] = T.inv[s[i]];
      addRound(round);
      this._invMixColumns(s);
    }
    this._invShiftRows(s);
    for (i = 0; i < 16; i++) s[i] = T.inv[s[i]];
    addRound(0);
    return s;
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

  _aesCbcDecrypt(cipher, key, iv) {
    var w = this._expandKey(key);
    var out = [];
    var prev = iv.slice();
    for (var off = 0; off + 16 <= cipher.length; off += 16) {
      var block = cipher.slice(off, off + 16);
      var plain = this._decryptBlock(block, w);
      for (var i = 0; i < 16; i++) out.push(plain[i] ^ prev[i]);
      prev = block;
    }
    // Strip PKCS#7 if it looks well-formed.
    var pad = out[out.length - 1];
    if (pad >= 1 && pad <= 16 && out.length >= pad) {
      var ok = true;
      for (i = out.length - pad; i < out.length; i++) if (out[i] !== pad) ok = false;
      if (ok) out = out.slice(0, out.length - pad);
    }
    return out;
  }

  // ------------------------------------------------------------ url joining

  _resolve(base, ref) {
    if (/^https?:\/\//i.test(ref)) return ref;
    var hashIdx = base.indexOf("://");
    var origin = base.substring(0, base.indexOf("/", hashIdx + 3));
    if (ref.charAt(0) === "/") return origin + ref;

    var dir = base.split("?")[0];
    dir = dir.substring(0, dir.lastIndexOf("/"));
    var segs = dir.substring(origin.length).split("/").filter((x) => x.length);
    var refPath = ref.split("?")[0];
    var query = ref.length > refPath.length ? ref.substring(refPath.length) : "";
    var parts = refPath.split("/");
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === "." || parts[i] === "") continue;
      if (parts[i] === "..") segs.pop();
      else segs.push(parts[i]);
    }
    return origin + "/" + segs.join("/") + query;
  }

  // --------------------------------------------------------------- playback

  // The 32-byte blob at key.bin is AES-128-CBC over the real key, with both
  // key and IV derived from the media guid — and the CDN only hands back a
  // blob keyed to that guid when the request announces it. Mirrors the site
  // player's own request filter + response filter pair.
  async _resolveKey(keyUrl, mediaId) {
    var res = await new Client().get(keyUrl, {
      "x-am-media-id": mediaId,
      "Referer": this.source.baseUrl + "/",
    });
    var blob = this._b64ToBytes(String(res.body).trim());
    var k = this._sha256("key" + mediaId).slice(0, 16);
    var iv = this._sha256("iv" + mediaId).slice(0, 16);
    var plain = this._aesCbcDecrypt(blob, k, iv);
    return plain.slice(0, 16);
  }

  // The media guid doubles as the key-derivation salt and is only reliably
  // available from the playlist path (version entries omit media_id).
  _guidFromUrl(url) {
    var m = String(url).match(/\/([0-9a-f]{32})_[A-Za-z0-9-]+\//);
    return m ? m[1] : null;
  }

  // Rewrite one media playlist: absolute segment URLs (it is about to lose its
  // base when it becomes a data: URI) and an inline key.
  _rewriteMedia(body, url, keyB64) {
    var lines = String(body).replace(/\r/g, "").split("\n");
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.trim();
      if (!trimmed) {
        out.push(line);
        continue;
      }
      if (trimmed.indexOf("#EXT-X-KEY") === 0) {
        // Keep METHOD/IV and anything else, swap only the URI.
        out.push(
          trimmed.replace(
            /URI="[^"]*"/,
            'URI="data:application/octet-stream;base64,' + keyB64 + '"'
          )
        );
      } else if (trimmed.charAt(0) === "#") {
        out.push(trimmed);
      } else {
        out.push(this._resolve(url, trimmed));
      }
    }
    return out.join("\n");
  }

  _dataUri(text) {
    return "data:application/vnd.apple.mpegurl;base64," + this._strToB64(text);
  }

  // Build one self-contained master per resolution: the chosen video variant
  // and the audio rendition are both inlined as nested data: URIs, because a
  // data: master has no base URL to resolve children against. Audio is a
  // separate rendition here (video playlists carry H.264 only), so dropping it
  // would yield silent playback.
  async _buildStreams(masterUrl, mediaId, label) {
    var res = await new Client().get(masterUrl, {
      "Referer": this.source.baseUrl + "/",
    });
    if (res.statusCode !== 200) return [];
    var lines = String(res.body).replace(/\r/g, "").split("\n");

    var audioLine = null;
    var audioUrl = null;
    var variants = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.indexOf("#EXT-X-MEDIA:") === 0 && line.indexOf("TYPE=AUDIO") > -1) {
        var mu = line.match(/URI="([^"]+)"/);
        if (mu && !audioUrl) {
          audioLine = line;
          audioUrl = this._resolve(masterUrl, mu[1]);
        }
      } else if (line.indexOf("#EXT-X-STREAM-INF") === 0) {
        var next = (lines[i + 1] || "").trim();
        if (!next || next.charAt(0) === "#") continue;
        var rm = line.match(/RESOLUTION=(\d+)x(\d+)/);
        variants.push({
          inf: line,
          url: this._resolve(masterUrl, next),
          height: rm ? parseInt(rm[2], 10) : 0,
        });
      }
    }
    if (!variants.length) return [];

    // One key per media guid, shared by every rendition below it.
    var probe = await new Client().get(variants[0].url, {
      "Referer": this.source.baseUrl + "/",
    });
    var keyMatch = String(probe.body).match(/#EXT-X-KEY[^\n]*URI="([^"]+)"/);
    var keyB64 = null;
    if (keyMatch) {
      var keyUrl = this._resolve(variants[0].url, keyMatch[1]);
      var key = await this._resolveKey(keyUrl, mediaId);
      keyB64 = this._bytesToB64(key);
    }

    var audioNested = null;
    if (audioUrl) {
      var ares = await new Client().get(audioUrl, {
        "Referer": this.source.baseUrl + "/",
      });
      if (ares.statusCode === 200) {
        audioNested = this._dataUri(
          this._rewriteMedia(ares.body, audioUrl, keyB64)
        );
      }
    }

    variants.sort((a, b) => b.height - a.height);

    var streams = [];
    for (var v = 0; v < variants.length; v++) {
      var variant = variants[v];
      var vres =
        v === 0
          ? probe
          : await new Client().get(variant.url, {
              "Referer": this.source.baseUrl + "/",
            });
      if (vres.statusCode !== 200) continue;

      var master = ["#EXTM3U", "#EXT-X-VERSION:4"];
      var inf = variant.inf;
      if (audioNested && audioLine) {
        master.push(
          audioLine.replace(/URI="[^"]+"/, 'URI="' + audioNested + '"')
        );
      } else {
        // No usable audio rendition — drop the AUDIO group reference so the
        // player does not wait on a track that will never resolve.
        inf = inf.replace(/,?AUDIO="[^"]*"/, "");
      }
      master.push(inf);
      master.push(
        this._dataUri(this._rewriteMedia(vres.body, variant.url, keyB64))
      );

      var quality = variant.height ? variant.height + "p" : "Auto";
      streams.push({
        url: this._dataUri(master.join("\n")),
        originalUrl: masterUrl,
        quality: label + " " + quality,
        headers: { "Referer": this.source.baseUrl + "/" },
        subtitles: [],
      });
    }
    return streams;
  }

  // Pick the audio version and, for sub mode, the burned-in subtitle track.
  // The site ships no separate subtitle files for this content — subs exist
  // only as hard-subbed renditions under <guid>_<audio>/hard/<sub>/.
  _pickVariant(media, wantDub, subLocale) {
    var candidates = [];
    if (media.hls) candidates.push(media.hls);
    var versions = (media.versions || {}).hls || [];
    for (var i = 0; i < versions.length; i++) candidates.push(versions[i]);
    if (!candidates.length) return null;

    var pick = null;
    if (wantDub) {
      pick = candidates.filter((c) => c.locale === "en-US")[0];
    } else {
      pick =
        candidates.filter((c) => c.locale === "ja-JP")[0] ||
        candidates.filter((c) => c.original === true)[0];
    }
    if (!pick) pick = candidates[0];

    if (wantDub) {
      return { url: pick.playlist, label: "Dub" };
    }

    var hard = (pick.hard_subs || []).filter((h) => h.locale === subLocale)[0];
    if (hard) return { url: hard.playlist, label: "Sub" };
    return { url: pick.playlist, label: pick.locale === "ja-JP" ? "Raw" : "Sub" };
  }

  // Temporary playback diagnostic (v0.1.1). The nested-data: master buffers in
  // the app, and from the extension side several causes are indistinguishable:
  // the player may refuse a data: child playlist, refuse a data: key, or choke
  // on the sheer length of a 125 KB URI. Each entry below changes exactly one
  // of those variables, so whichever ones play identify the culprit. Remove
  // this once the cause is known; see the repo's playbackdiag extension for the
  // same isolate-one-variable approach.
  async _buildDiagnostics(masterUrl, mediaId) {
    var out = [];
    var hdr = { "Referer": this.source.baseUrl + "/" };

    // A: the untouched CDN master. Proves whether the player reaches the CDN
    // and parses a normal master at all. Expect noise or an error, not clean
    // video — the key is still the undecryptable one.
    out.push({
      url: masterUrl,
      originalUrl: masterUrl,
      quality: "DIAG A · raw CDN master (expect noise/fail)",
      headers: hdr,
      subtitles: [],
    });

    var res = await new Client().get(masterUrl, hdr);
    var lines = String(res.body).replace(/\r/g, "").split("\n");
    var variantUrl = null;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim().indexOf("#EXT-X-STREAM-INF") === 0) {
        var next = (lines[i + 1] || "").trim();
        if (next && next.charAt(0) !== "#") {
          variantUrl = this._resolve(masterUrl, next);
          break;
        }
      }
    }
    if (!variantUrl) return out;

    var vres = await new Client().get(variantUrl, hdr);
    var body = String(vres.body);

    // B: top-level data: playlist, key left pointing at the real key.bin.
    // Isolates "does a data: playlist work" from "does a data: key work".
    // Expect noise if it plays at all.
    var bLines = String(body).replace(/\r/g, "").split("\n");
    var bOut = [];
    for (i = 0; i < bLines.length; i++) {
      var t = bLines[i].trim();
      if (!t) continue;
      if (t.charAt(0) === "#") {
        bOut.push(
          t.indexOf("#EXT-X-KEY") === 0
            ? t.replace(/URI="([^"]*)"/, (m, u) => 'URI="' + this._resolve(variantUrl, u) + '"')
            : t
        );
      } else {
        bOut.push(this._resolve(variantUrl, t));
      }
    }
    out.push({
      url: this._dataUri(bOut.join("\n")),
      originalUrl: masterUrl,
      quality: "DIAG B · data: playlist, real key (expect noise)",
      headers: hdr,
      subtitles: [],
    });

    // C: top-level data: playlist with the key inlined. No nesting anywhere.
    // If this plays clean video with NO audio, the key handling is fine and
    // nesting is what breaks — which points straight at a proxy as the fix.
    var keyMatch = body.match(/#EXT-X-KEY[^\n]*URI="([^"]+)"/);
    var keyB64 = null;
    if (keyMatch) {
      var key = await this._resolveKey(
        this._resolve(variantUrl, keyMatch[1]),
        mediaId
      );
      keyB64 = this._bytesToB64(key);
    }
    var full = this._rewriteMedia(body, variantUrl, keyB64);
    out.push({
      url: this._dataUri(full),
      originalUrl: masterUrl,
      quality: "DIAG C · data: playlist + inlined key, video only (expect clean video, no sound)",
      headers: hdr,
      subtitles: [],
    });

    // E: same as C but cut to a handful of segments, so the URI is ~2 KB
    // instead of ~35 KB. If C fails and this plays, the limit is URI length.
    var fLines = full.split("\n");
    var short = [];
    var segCount = 0;
    for (i = 0; i < fLines.length; i++) {
      var line = fLines[i];
      if (line && line.charAt(0) !== "#") {
        if (segCount >= 3) continue;
        segCount++;
      }
      if (line.indexOf("#EXT-X-ENDLIST") === 0) continue;
      if (segCount >= 3 && line.indexOf("#EXTINF") === 0) continue;
      short.push(line);
    }
    short.push("#EXT-X-ENDLIST");
    out.push({
      url: this._dataUri(short.join("\n")),
      originalUrl: masterUrl,
      quality: "DIAG E · short data: playlist, 3 segments (expect ~25s of video)",
      headers: hdr,
      subtitles: [],
    });

    return out;
  }

  async getVideoList(url) {
    var ref = this._parseLink(url);
    var kind = ref.kind === "movie" ? "movie" : "episode";

    var wantDub = this.getPreference("uniquestream_pref_audio") === "dub";
    var subLocale =
      this.getPreference("uniquestream_pref_sub_locale") || "en-US";
    var reqLocale = wantDub ? "en-US" : "ja-JP";

    var media = await this._api(
      "/" + kind + "/" + ref.id + "/media/hls/" + reqLocale
    );

    var chosen = this._pickVariant(media, wantDub, subLocale);
    if (!chosen) {
      // Fall back to the other audio mode rather than returning nothing.
      chosen = this._pickVariant(media, !wantDub, subLocale);
    }
    if (!chosen || !chosen.url) {
      throw new Error("No playable stream for this episode");
    }

    var mediaId = this._guidFromUrl(chosen.url) || media.media_id;
    var streams = await this._buildStreams(chosen.url, mediaId, chosen.label);

    // v0.1.1: append the isolation probes after the real streams. They are
    // deliberately labelled DIAG so they are never mistaken for content, and
    // come last so nothing auto-plays into them.
    if (this.getPreference("uniquestream_pref_diag") !== "off") {
      try {
        var diag = await this._buildDiagnostics(chosen.url, mediaId);
        streams = streams.concat(diag);
      } catch (e) {
        streams.push({
          url: chosen.url,
          originalUrl: chosen.url,
          quality: "DIAG failed: " + e.message,
          headers: { "Referer": this.source.baseUrl + "/" },
          subtitles: [],
        });
      }
    }

    if (!streams.length) throw new Error("Could not build a playable playlist");
    return streams;
  }

  // ---------------------------------------------------------------- filters

  _select(name, values) {
    return {
      type_name: "SelectFilter",
      name: name,
      state: 0,
      values: values.map((v) =>
        typeof v === "string"
          ? { type_name: "SelectOption", name: v, value: v }
          : { type_name: "SelectOption", name: v[0], value: v[1] }
      ),
    };
  }

  getFilterList() {
    var genres = [
      ["All", ""], ["Action", "action"], ["Adventure", "adventure"],
      ["Comedy", "comedy"], ["Drama", "drama"], ["Fantasy", "fantasy"],
      ["Music", "music"], ["Romance", "romance"], ["Sci-Fi", "sci-fi"],
      ["Seinen", "seinen"], ["Shojo", "shojo"], ["Shonen", "shonen"],
      ["Slice of life", "slice of life"], ["Sports", "sports"],
      ["Supernatural", "supernatural"], ["Thriller", "thriller"],
    ];

    var years = [["All", ""]];
    var currentYear = new Date().getFullYear();
    for (var y = currentYear; y >= 1966; y--) years.push([String(y), String(y)]);

    return [
      this._select("Genre", genres),
      this._select("Year", years),
      this._select("Status", [
        ["All", ""], ["Releasing", "RELEASING"], ["Finished", "FINISHED"],
        ["Not yet released", "NOT_YET_RELEASED"],
      ]),
      this._select("Audio", [
        ["All", ""], ["Subbed", "subbed"], ["Dubbed", "dubbed"],
      ]),
    ];
  }

  getSourcePreferences() {
    return [
      {
        key: "uniquestream_pref_audio",
        listPreference: {
          title: "Preferred audio",
          summary:
            "Sub plays the Japanese audio with burned-in subtitles; Dub plays the English audio track.",
          valueIndex: 0,
          entries: ["Sub", "Dub"],
          entryValues: ["sub", "dub"],
        },
      },
      {
        key: "uniquestream_pref_diag",
        listPreference: {
          title: "Playback diagnostics",
          summary:
            "Adds extra DIAG entries to the source list to isolate a playback failure. Turn off once playback works.",
          valueIndex: 0,
          entries: ["On", "Off"],
          entryValues: ["on", "off"],
        },
      },
      {
        key: "uniquestream_pref_sub_locale",
        listPreference: {
          title: "Subtitle language",
          summary:
            "Which burned-in subtitle rendition to use in Sub mode. Falls back to raw Japanese audio if unavailable.",
          valueIndex: 0,
          entries: [
            "English", "Spanish (LatAm)", "Spanish (Spain)", "Portuguese (BR)",
            "French", "German", "Italian", "Russian", "Arabic",
          ],
          entryValues: [
            "en-US", "es-419", "es-ES", "pt-BR", "fr-FR", "de-DE", "it-IT",
            "ru-RU", "ar-SA",
          ],
        },
      },
    ];
  }
}
