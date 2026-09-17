const mangayomiSources = [
  {
    "name": "AniKoto",
    "id": 1356478902,
    "lang": "en",
    "baseUrl": "https://anikototv.to",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://anikototv.to",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.4.20",
    "pkgPath": "anime/src/en/anikoto.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": false,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/anikoto.js",
    "dateFormat": "",
    "dateFormatLocale": "",
    "additionalParams": "",
    "sourceCodeLanguage": 1,
    "notes": "",
  },
];

// Pre-filled address of the unwrapping proxy (proxy/proxy.js in this repo), so
// switching the fix on is one toggle per machine instead of a URL anyone has to
// be told.
//
// NOTE: localhost means *that* PC — this is not a shared address. Every machine
// needs proxy/proxy.js running locally (Node + a Startup shortcut). To cover
// several machines, and phones, from one place, deploy proxy/worker.js and put
// its https URL here instead; the toggle then needs no per-machine setup.
var DEFAULT_PROXY = "http://localhost:8765";

// MegaPlay stopped returning a plain `sources` array from /stream/getSources in
// September 2026 — the response now carries `enc`, the same JSON under AES-256-CBC
// with a key and IV its own player ships in the clear (lib/newclient.min.js, the
// "segment-decrypt" module). Its CDN additionally refuses the master playlist
// without a signed `token`, which lib/e1-player.min.js builds from an HMAC secret
// it also ships in the clear. Both are read straight out of those two scripts;
// if either rotates, playback goes empty again and they have to be re-read.
var MEGAPLAY_ENC_KEY = "i?LMTAx0Q6,:}50U";              // padded to 32 bytes
var MEGAPLAY_ENC_IV = "W0;27ToaUpl_P%'c";               // 16 bytes
var MEGAPLAY_CDN_SECRET = "MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s";
// The player signs for 90 seconds, which is fine when the page re-signs on every
// request. An extension hands the URL over once, so sign for long enough that a
// paused episode still resumes.
var MEGAPLAY_TOKEN_TTL = 21600;

class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
  }

  get ua() {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
  }

  get headers() {
    return {
      "User-Agent": this.ua,
      "Referer": this.source.baseUrl + "/",
    };
  }

  async fetchDoc(path) {
    var url = path.startsWith("http") ? path : this.source.baseUrl + path;
    var res = await this.client.get(url, this.headers);
    return new Document(res.body || "");
  }

  // Parse anime card grids from /filter and /most-viewed pages.
  // /filter:      <div class="item"> … <a class="name d-title" href="…" data-jp="…">
  // /most-viewed: <a class="item" href="…"> … <div class="name d-title" data-jp="…">
  parseList(doc) {
    var list = [];
    var items = doc.select("#list-items .item");
    if (items.length === 0) items = doc.select(".item");
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var nameEl = item.selectFirst(".name");
      if (!nameEl) continue;
      // href may be on the .name anchor (filter pages), an inner poster anchor,
      // or on the .item element itself (most-viewed page where .item IS the <a>).
      var href = nameEl.attr("href") || "";
      if (!href) {
        var pa = item.selectFirst(".ani a, .poster a");
        if (pa) href = pa.attr("href") || "";
      }
      if (!href) href = item.attr("href") || ""; // most-viewed: item is the <a>
      if (!href) continue;
      var link = href.startsWith("http") ? href : this.source.baseUrl + href;
      var name = (nameEl.text || nameEl.attr("data-jp") || "").trim();
      if (!name) continue;
      var img = item.selectFirst("img");
      var imageUrl = img ? (img.attr("src") || img.attr("data-src") || "") : "";
      list.push({ name: name, imageUrl: imageUrl, link: link });
    }
    return list;
  }

  // Detect whether more pages exist by checking for › (next) in pagination.
  hasNextPage(doc) {
    var pagi = doc.selectFirst(".pagination");
    if (!pagi) return false;
    var t = pagi.text || "";
    return t.indexOf("›") >= 0 || t.indexOf("»") >= 0;
  }

  get supportsLatest() {
    return true;
  }

  async getPopular(page) {
    var doc = await this.fetchDoc("/most-viewed?page=" + page);
    return { list: this.parseList(doc), hasNextPage: this.hasNextPage(doc) };
  }

  async getLatestUpdates(page) {
    var doc = await this.fetchDoc("/filter?sort=recently_updated&page=" + page);
    return { list: this.parseList(doc), hasNextPage: this.hasNextPage(doc) };
  }

  async search(query, page, filters) {
    try {
      var doc = await this.fetchDoc("/filter?keyword=" + encodeURIComponent(query) + "&page=" + page);
      return { list: this.parseList(doc), hasNextPage: this.hasNextPage(doc) };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  // Extract {slug} from watch page URLs:
  //   https://anikototv.to/watch/{slug}/ep-1  →  {slug}
  //   https://anikototv.to/watch/{slug}        →  {slug}
  extractSlug(url) {
    var path = url.replace(/^https?:\/\/[^\/]+/, "");
    var m = path.match(/\/watch\/([^\/\?#]+)/);
    return m ? m[1] : "";
  }

  statusCode(text) {
    var t = (text || "").toLowerCase();
    if (t.includes("finished") || t.includes("completed")) return 1;
    if (t.includes("not yet") || t.includes("upcoming")) return 4;
    if (t.includes("airing") || t.includes("ongoing") || t.includes("releasing")) return 0;
    return 5;
  }

  async getDetail(url) {
    var slug = this.extractSlug(url);
    if (!slug) throw new Error("Could not parse slug from: " + url);

    // Fetch the watch page for metadata (title, image, description, genres, status).
    // The episode list is NOT in the initial HTML — it's loaded via a separate AJAX call.
    var watchUrl = this.source.baseUrl + "/watch/" + slug;
    var res = await this.client.get(watchUrl, this.headers);
    var html = res.body || "";
    var doc = new Document(html);

    // Title
    var name = "";
    var h1 = doc.selectFirst("h1");
    if (h1) name = h1.text.trim();
    if (!name) {
      var ogTitle = doc.selectFirst("meta[property='og:title']");
      if (ogTitle) {
        name = (ogTitle.attr("content") || "")
          .replace(/^Watch\s+/i, "")
          .replace(/\s+Episode.*$/i, "")
          .trim();
      }
    }

    // Thumbnail: first img hosted on anipixcdn CDN (site's own image host)
    var imageUrl = "";
    var imgs = doc.select("img");
    for (var i = 0; i < imgs.length; i++) {
      var src = imgs[i].attr("src") || "";
      if (src.indexOf("anipixcdn") >= 0 || src.indexOf("chiaki.site") >= 0) {
        imageUrl = src;
        break;
      }
    }
    if (!imageUrl) {
      var ogImg = doc.selectFirst("meta[property='og:image']");
      if (ogImg) imageUrl = ogImg.attr("content") || "";
    }

    // Description
    var description = "";
    var synEl = doc.selectFirst(".synopsis");
    if (synEl) description = synEl.text.trim();
    if (!description) {
      var descMeta = doc.selectFirst("meta[name='description']");
      if (descMeta) description = descMeta.attr("content") || "";
    }

    // Genres and status from .info span elements.
    // Observed values: "TV", "WINTER 2025", "Jan 5, 2025 to ...", "Finished Airing",
    //                  "Action  ,  Adventure  ,  Fantasy", "8.87", "24m min", "13", "Studio"
    var genre = [];
    var status = 5;
    var metaSpans = doc.select(".info span");
    for (var i = 0; i < metaSpans.length; i++) {
      var t = (metaSpans[i].text || "").trim();
      if (!t) continue;
      if (status === 5) {
        var code = this.statusCode(t);
        if (code !== 5) status = code;
      }
      // Genre span has commas: "Action  ,  Adventure  ,  Fantasy"
      if (t.indexOf(",") >= 0 && genre.length === 0) {
        var gParts = t.split(",");
        var cleaned = [];
        for (var p = 0; p < gParts.length; p++) {
          var g = gParts[p].trim();
          if (g && g.length > 1 && g.length < 40) cleaned.push(g);
        }
        if (cleaned.length > 1) genre = cleaned;
      }
    }

    // Extract the internal anime ID from #watch-main data-id="7457"
    // This is present in the static HTML and is needed for the AJAX episode list call.
    var animeId = "";
    var watchMain = doc.selectFirst("#watch-main");
    if (watchMain) animeId = watchMain.attr("data-id") || "";
    if (!animeId) {
      // Regex fallback
      var idMatch = html.match(/id="watch-main"[^>]*data-id="(\d+)"/);
      if (!idMatch) idMatch = html.match(/data-id="(\d+)"[^>]*id="watch-main"/);
      if (idMatch) animeId = idMatch[1];
    }

    // Fetch the episode list from the AJAX endpoint.
    // Returns JSON: { status: 200, result: "<a data-num data-mal data-timestamp ...>...</a>..." }
    var chapters = [];
    if (animeId) {
      var epRes;
      try {
        epRes = await this.client.get(
          this.source.baseUrl + "/ajax/episode/list/" + animeId + "?vrf=",
          {
            "User-Agent": this.ua,
            "Referer": watchUrl + "/",
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "application/json, text/javascript, */*; q=0.01",
          }
        );
      } catch (e) {}

      if (epRes && epRes.body) {
        var epData;
        try { epData = JSON.parse(epRes.body); } catch (e) {}

        if (epData && epData.status === 200 && epData.result) {
          var epDoc = new Document(epData.result);
          var epEls = epDoc.select("a[data-num][data-mal][data-timestamp]");

          // Grab the MAL ID from the first episode (same for all episodes of an anime).
          var animeMALId = epEls.length > 0 ? (epEls[0].attr("data-mal") || "") : "";

          // Fetch episode thumbnails from ani.zip (sourced from AniDB/TVDB/Crunchyroll).
          // ani.zip keys episodes by season-relative number ("1", "2", …) — the same
          // numbering the site uses — so no offset calculation is needed.
          // The API supports ?mal_id= directly, which we already have.
          var showThumbs = false;
          try { showThumbs = new SharedPreferences().get("anikoto_pref_ep_thumbnails"); } catch (e) {}
          var thumbMap = {}; // epNum (string) → thumbnail URL
          if (showThumbs && animeMALId) {
            try {
              var azRes = await this.client.get(
                "https://api.ani.zip/mappings?mal_id=" + animeMALId,
                { "User-Agent": this.ua, "Accept": "application/json" }
              );
              if (azRes.statusCode === 200 && azRes.body) {
                var azJson = JSON.parse(azRes.body);
                if (azJson.episodes) {
                  var epKeys = Object.keys(azJson.episodes);
                  for (var ek = 0; ek < epKeys.length; ek++) {
                    var epImg = azJson.episodes[epKeys[ek]].image;
                    if (epImg) thumbMap[epKeys[ek]] = epImg;
                  }
                }
              }
            } catch (e) {}
          }

          // Build chapter list with thumbnails, dates, and sub/dub badge.
          var seenEpNums = {};
          for (var j = 0; j < epEls.length; j++) {
            var ep = epEls[j];
            var epNum = ep.attr("data-num") || "";
            var malId = ep.attr("data-mal") || "";
            var timestamp = ep.attr("data-timestamp") || "";
            var ids = ep.attr("data-ids") || "";
            if (!epNum || !malId || !timestamp) continue;
            if (seenEpNums[epNum]) continue;
            seenEpNums[epNum] = true;

            // Episode label: number + English title from the site
            var rawText = (ep.text || "").trim().replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ");
            var titlePart = rawText.replace(new RegExp("^" + epNum + "\\s*"), "").trim();
            var label = "Episode " + epNum;
            if (titlePart) label += ": " + titlePart;

            // Sub/Dub availability badge shown as scanlator
            var hasSub = ep.attr("data-sub") === "1";
            var hasDub = ep.attr("data-dub") === "1";
            var badge = hasSub && hasDub ? "Sub · Dub" : hasSub ? "Sub" : hasDub ? "Dub" : "";

            chapters.push({
              name: label,
              url: slug + "||" + epNum + "||" + malId + "||" + timestamp + "||" + ids,
              thumbnailUrl: thumbMap[epNum] || "",
              scanlator: badge,
            });
          }
          // Reverse so newest episode is at the top (Mangayomi convention)
          chapters.reverse();
        }
      }
    }

    return {
      name: name,
      imageUrl: imageUrl,
      description: description,
      genre: genre,
      status: status,
      link: this.source.baseUrl + "/watch/" + slug,
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

  _b64enc(str) {
    var t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var out = "", i = 0, n = str.length;
    while (i < n) {
      var a = str.charCodeAt(i++);
      out += t[a >> 2];
      if (i === n) { out += t[(a & 3) << 4] + "=="; break; }
      var b = str.charCodeAt(i++);
      out += t[((a & 3) << 4) | (b >> 4)];
      if (i === n) { out += t[(b & 15) << 2] + "="; break; }
      var c = str.charCodeAt(i++);
      out += t[((b & 15) << 2) | (c >> 6)];
      out += t[c & 63];
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

  // Rewrite a media playlist so every segment carries #EXT-X-BYTERANGE:N@70,
  // telling ExoPlayer to send Range: bytes=70- and skip the 70-byte PNG wrapper
  // that nekostream CDN prepends to every MPEG-TS segment. Returns a data URI.
  _rewriteWithByterange(body) {
    var lines = String(body).split("\n");
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.trim();
      // #EXT-X-BYTERANGE requires HLS version 4+; bump if the playlist declares 3 or lower.
      if (trimmed.match(/^#EXT-X-VERSION:[1-3]$/)) {
        out.push("#EXT-X-VERSION:4");
        continue;
      }
      if (trimmed && trimmed.charAt(0) !== "#") {
        out.push("#EXT-X-BYTERANGE:99999999@70");
      }
      out.push(line);
    }
    return "data:application/x-mpegURL;base64," + this._b64enc(out.join("\n"));
  }

  // Base URL of the unwrapping proxy, or "" when it is switched off.
  //
  // The URL is pre-filled so turning this on is a single toggle — nobody has to
  // know or type the address. The box stays editable for anyone pointing at a
  // deployed worker, and anything that is not an http(s) origin is ignored
  // rather than pasted into a stream URL.
  proxyBase() {
    var on = false;
    try { on = new SharedPreferences().get("anikoto_pref_proxy_enabled"); } catch (e) {}
    if (on !== true) return "";
    var raw = "";
    try { raw = String(new SharedPreferences().get("anikoto_pref_proxy_url") || "").trim(); } catch (e) {}
    // Empty box → fall back to the default rather than silently doing nothing.
    if (!raw) raw = DEFAULT_PROXY;
    if (!/^https?:\/\/[^/\s]+/.test(raw)) return "";
    return raw.replace(/\/+$/, "");
  }

  // Emit one server's playlists into `streams`.
  //
  // When the playlists come from a PNG-wrapping CDN and the viewer has the proxy
  // switched on, an "⟨unwrapped⟩" entry is emitted ahead of each direct one: on
  // Windows/Android that is the only thing that plays. The direct entries stay
  // as fallback so iOS — where the raw stream is fine — still has them, and so
  // the source degrades to plain behaviour when the proxy is not running.
  _emitStreams(streams, playlists, m3u8, audioLabel, hdrs, subtitles, proxyReferer) {
    var proxy = playlists.wrapped ? this.proxyBase() : "";
    for (var p = 0; proxy && p < playlists.length; p++) {
      var pl = playlists[p];
      streams.push({
        url: proxy + "/m3u8?url=" + encodeURIComponent(pl.url) +
             "&referer=" + encodeURIComponent(proxyReferer),
        originalUrl: pl.url,
        quality: (pl.label ? pl.label + " - " : "") + audioLabel + " ⟨unwrapped⟩",
        // The proxy attaches the upstream Referer itself; forwarding ours would
        // make Mangayomi send it to the proxy instead.
        headers: { "User-Agent": this.ua },
        subtitles: subtitles,
      });
    }
    for (var v = 0; v < playlists.length; v++) {
      streams.push({
        url: playlists[v].url,
        // An inlined playlist has no URL of its own; keep the real one here so
        // the app still has something addressable to fall back on.
        originalUrl: playlists[v].originalUrl || m3u8,
        quality: (playlists[v].label ? playlists[v].label + " - " : "") + audioLabel,
        headers: hdrs,
        subtitles: subtitles,
      });
    }
  }

  // Tag a variant list as coming from a PNG-wrapping CDN. Carried as a property
  // on the array so the existing callers, which only read length and indexes,
  // keep working unchanged.
  _markWrapped(list) {
    list.wrapped = true;
    return list;
  }

  // Known nekostream-family CDN hostnames that serve PNG-wrapped MPEG-TS segments.
  _isWrappedCdnUrl(url) {
    var hosts = ["nekostream.site", "norami.top", "kotocdn.site", "ibyteimg.com", "byteimg.com", "ipstatp.com"];
    for (var i = 0; i < hosts.length; i++) {
      if ((url || "").indexOf(hosts[i]) >= 0) return true;
    }
    return false;
  }


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
  async _inlineSubtitles(tracks, referer) {
    if (!Array.isArray(tracks)) return [];
    var subtitles = [];
    for (var t = 0; t < tracks.length; t++) {
      var track = tracks[t];
      if (!track || !track.file || track.kind === "thumbnails") continue;
      try {
        var res = await this.client.get(track.file, { "User-Agent": this.ua, "Referer": referer });
        var body = (res.body || "").replace(/^\s+/, "");
        if (body.indexOf("WEBVTT") !== 0) continue;
        subtitles.push({ file: this._vttToSrt(body), label: track.label || "Unknown" });
      } catch (e) {}
    }
    return subtitles;
  }

  // Subtitles for one audio track, downloaded once. The alternate servers carry
  // the same episode, and the tracks are inlined as text rather than as URLs, so
  // the first server's files play against any of them. Re-downloading per server
  // cost several seconds on slow subtitle hosts. An empty result is not cached,
  // so a hardsub server that reports no tracks does not starve the next one.
  async _trackSubtitles(tracks, referer) {
    if (this._trackSubs && this._trackSubs.length) return this._trackSubs;
    var subtitles = await this._inlineSubtitles(tracks, referer);
    if (subtitles.length) this._trackSubs = subtitles;
    return subtitles;
  }

  // Resolve a server linkId → embed URL → array of playable streams.
  async _resolveStreams(linkId, audioLabel, isExtra) {
    var embedUrl = "";
    try {
      var serverRes = await this.client.get(
        this.source.baseUrl + "/ajax/server?get=" + encodeURIComponent(linkId),
        { "User-Agent": this.ua, "Referer": this.source.baseUrl + "/", "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/javascript, */*; q=0.01" }
      );
      var serverData;
      try { serverData = JSON.parse(serverRes.body); } catch (e) { return []; }
      if (!serverData || !serverData.result) return [];
      if (typeof serverData.result === "string") embedUrl = serverData.result;
      else if (serverData.result.url) embedUrl = serverData.result.url;
      else if (serverData.result.link) embedUrl = serverData.result.link;
    } catch (e) { return []; }
    if (!embedUrl) return [];

    // /stream/s-{N}/{id}/{sub|dub} — megaplay, vidwish, and similar hosts
    var gsM = embedUrl.match(/\/stream\/s-\d+\/(\d+)\/(sub|dub)/);
    if (gsM) {
      return await this._extractGetSourcesStreams(embedUrl, gsM[1], audioLabel, isExtra);
    }
    if (embedUrl.indexOf("vidtube.site/stream/") >= 0) {
      return await this._extractVidtubeStreams(embedUrl, audioLabel, isExtra);
    }
    if (embedUrl.includes(".m3u8") || embedUrl.includes(".mp4")) {
      return [{ url: embedUrl, originalUrl: embedUrl, quality: audioLabel, headers: { "User-Agent": this.ua, "Referer": this.source.baseUrl + "/" }, subtitles: [] }];
    }
    var hi = embedUrl.indexOf("#");
    if (hi >= 0) {
      var dec = this._b64dec(embedUrl.substring(hi + 1));
      if (dec && (dec.includes(".m3u8") || dec.includes(".mp4"))) {
        var om = embedUrl.match(/^(https?:\/\/[^/]+)/);
        return [{ url: dec, originalUrl: dec, quality: audioLabel, headers: { "User-Agent": this.ua, "Referer": om ? om[1] + "/" : this.source.baseUrl + "/" }, subtitles: [] }];
      }
    }
    return [];
  }

  // Extract streams via {host}/stream/getSources?id={dataId} (megaplay, vidwish, etc.)
  // The URL path ID (e.g. /stream/s-2/169702/sub) is NOT the getSources ID — it's an
  // internal routing key. The real ID lives as data-id in the embed page's HTML.
  // Fetching the page first (with the site Referer) gives us the correct ID.
  async _extractGetSourcesStreams(embedUrl, streamId, audioLabel, isExtra) {
    var streams = [];
    try {
      var hostM = embedUrl.match(/^(https?:\/\/[^/]+)/);
      if (!hostM) return streams;
      var apiHost = hostM[1];

      // Fetch the embed page to resolve the real getSources ID.
      var getSrcId = streamId; // fallback: URL path ID (likely wrong, but better than nothing)
      try {
        var pageRes = await this.client.get(embedUrl, { "User-Agent": this.ua, "Referer": this.source.baseUrl + "/" });
        var pageBody = pageRes.body || "";
        var pageIdM = pageBody.match(/data-id="(\d+)"/) || pageBody.match(/<title>File (\d+)/i);
        if (pageIdM) getSrcId = pageIdM[1];
      } catch (e) {}

      var srcRes = await this.client.get(
        apiHost + "/stream/getSources?id=" + getSrcId,
        { "User-Agent": this.ua, "Referer": apiHost + "/", "X-Requested-With": "XMLHttpRequest", "Accept": "application/json" }
      );
      var srcData;
      try { srcData = JSON.parse(srcRes.body); } catch (e) { return streams; }
      var m3u8 = "";
      if (srcData.sources) {
        if (typeof srcData.sources === "string") m3u8 = srcData.sources;
        else if (srcData.sources.file) m3u8 = srcData.sources.file;
        else if (Array.isArray(srcData.sources) && srcData.sources.length) m3u8 = srcData.sources[0].file || srcData.sources[0].url || "";
      }
      // September 2026: the sources array went away and `enc` took its place.
      if (!m3u8 && srcData.enc) m3u8 = this._decodeEncSources(srcData.enc);
      if (!m3u8) return streams;
      // Dedupe before signing — a token carries a timestamp, so two signatures
      // of the same playlist never match.
      if (this._alreadyResolved(m3u8)) return streams; // another server, same file
      m3u8 = this._signCdnUrl(m3u8);
      var hdrs = { "User-Agent": this.ua, "Referer": apiHost + "/" };
      var subtitles = await this._trackSubtitles(srcData.tracks, apiHost + "/");
      var variants = await this._resolveHlsVariants(m3u8, hdrs, isExtra);
      if (variants === null) return streams; // CDN blocked (Cloudflare) — skip this server
      var playlists = variants;
      if (!playlists.length) {
        playlists = [{ url: m3u8, label: "" }];
        playlists.wrapped = variants.wrapped;
      }
      this._emitStreams(streams, playlists, m3u8, audioLabel, hdrs, subtitles, apiHost + "/");
    } catch (e) {}
    return streams;
  }

  // Extract streams from vidtube.site embed: fetch page → getSourcesNew API → m3u8 → quality variants.
  async _extractVidtubeStreams(embedUrl, audioLabel, isExtra) {
    var streams = [];
    try {
      var res = await this.client.get(embedUrl, { "User-Agent": this.ua, "Referer": this.source.baseUrl + "/" });
      var html = res.body || "";
      var idM = html.match(/getSourcesNew\?id=(\d+)/) || html.match(/<title>File (\d+)/i);
      if (!idM) return streams;
      var fileId = idM[1];
      var typeM = embedUrl.match(/\/(sub|dub)(?:[?#]|$)/);
      var type = typeM ? typeM[1] : "sub";

      var srcRes = await this.client.get(
        "https://vidtube.site/stream/getSourcesNew?id=" + fileId + "&type=" + type,
        { "User-Agent": this.ua, "Referer": "https://vidtube.site/", "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/javascript, */*; q=0.01" }
      );
      var srcData;
      try { srcData = JSON.parse(srcRes.body); } catch (e) { return streams; }

      var m3u8 = "";
      if (srcData.sources) {
        if (typeof srcData.sources === "string") m3u8 = srcData.sources;
        else if (srcData.sources.file) m3u8 = srcData.sources.file;
        else if (Array.isArray(srcData.sources) && srcData.sources.length) m3u8 = srcData.sources[0].file || srcData.sources[0].url || "";
      }
      if (!m3u8 && srcData.enc) m3u8 = this._decodeEncSources(srcData.enc);
      if (!m3u8) return streams;
      if (this._alreadyResolved(m3u8)) return streams; // another server, same file
      m3u8 = this._signCdnUrl(m3u8);
      var subtitles = await this._trackSubtitles(srcData.tracks, "https://vidtube.site/");
      var hdrs = { "User-Agent": this.ua, "Referer": "https://vidtube.site/" };
      var variants = await this._resolveHlsVariants(m3u8, hdrs, isExtra);
      if (variants === null) return streams; // CDN blocked (Cloudflare) — skip this server
      var playlists = variants;
      if (!playlists.length) {
        playlists = [{ url: m3u8, label: "" }];
        playlists.wrapped = variants.wrapped;
      }
      this._emitStreams(streams, playlists, m3u8, audioLabel, hdrs, subtitles, "https://vidtube.site/");
    } catch (e) {}
    return streams;
  }

  // Ad CDNs seen injecting fake segments. Fast path only — the host-mismatch
  // rule below is the general check and catches hosts not listed here.
  get AD_SEGMENT_HOSTS() {
    return ["ibyteimg.com", "byteimg.com", "doubleclick.net", "googlesyndication.com"];
  }

  // Last two labels of a hostname. Coarse, but enough to tell "same CDN,
  // different shard" (9hjkrt.nekostream.site vs cdn.nekostream.site) from
  // "an entirely unrelated advertiser".
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
  // Under ad-injection this upstream returns a valid m3u8 whose segments are
  // mostly 1x1 PNGs padded to ~500 KB and hosted on an ad CDN — observed at
  // ~55s of real video against ~1375s of junk, with no #EXT-X-DISCONTINUITY to
  // mark it. The player decodes the few real segments at the head, fails to
  // demux the rest, races to #EXT-X-ENDLIST, and Mangayomi concludes the
  // episode finished and auto-advances — which surfaces to the user as the
  // player skipping through the whole season without playing anything.
  //
  // Judge by duration rather than segment count: a handful of long real
  // segments among many short ad ones is still watchable, and vice versa.
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

  // Extensions ffmpeg's HLS demuxer will open a segment under. Anything else is
  // refused before a byte is read ("is not in allowed_extensions"), and the
  // stricter extension_picky pass then wants the extension to match the detected
  // format. Neither option is reachable from a Mangayomi extension, but both
  // read the extension with strrchr('.') across the whole URL — query included.
  get PLAYER_SAFE_SEGMENT_EXTS() {
    return ["ts", "m2ts", "mts", "m4s", "mp4", "m4v", "m4a", "aac", "ac3", "eac3",
            "mp3", "mpg", "mpeg", "mov", "vob", "wav", "flac", "ogg", "oga", "ogv",
            "mkv", "avi", "3gp", "m3u8"];
  }

  _segmentExt(uri) {
    var path = String(uri).split("#")[0].split("?")[0];
    var last = path.split("/").pop();
    var dot = last.lastIndexOf(".");
    return dot > 0 ? last.substring(dot + 1).toLowerCase() : "";
  }

  // True when any segment in this media playlist carries an extension the player
  // will refuse. MegaPlay rotates them per segment (.jpg, .html, .webp, .ico), so
  // the whole list is checked rather than just the first entry.
  _playlistNeedsExtFix(body) {
    var safe = this.PLAYER_SAFE_SEGMENT_EXTS;
    var lines = String(body).split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line.charAt(0) === "#") continue;
      var ext = this._segmentExt(line);
      var ok = false;
      for (var j = 0; j < safe.length; j++) if (ext === safe[j]) { ok = true; break; }
      if (!ok) return true;
    }
    return false;
  }

  // Minimal absolutiser. Inlining a playlist throws away its base URL, so any
  // relative URI in it has to be resolved first. No "../" handling — none of
  // these CDNs emit it, and a wrong guess there is worse than leaving it alone.
  _absUrl(ref, base) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return ref;
    var m = String(base).match(/^(https?:\/\/[^/]+)(\/[^?#]*)?/i);
    if (!m) return ref;
    if (ref.charAt(0) === "/") return m[1] + ref;
    var dir = m[2] || "/";
    return m[1] + dir.substring(0, dir.lastIndexOf("/") + 1) + ref;
  }

  // Hand the player the playlist body itself, with a dummy query that makes every
  // segment URL end in ".ts".
  //
  // MegaPlay's CDN gives each segment a decorative extension over plain MPEG-TS
  // and 404s when the same path is asked for as .ts, so the path cannot be
  // corrected — only the URL. "?x=.ts" satisfies both of ffmpeg's extension
  // checks (they scan the whole URL for the last dot) and the CDN ignores the
  // extra parameter. Verified with ffprobe: the same episode goes from
  // "is not in allowed_extensions" to 1080p h264 + aac, 1437s.
  _rewritePlaylistExtensions(body, playlistUrl) {
    var self = this;
    var lines = String(body).split("\n");
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.trim();
      if (!trimmed) { out.push(line); continue; }
      if (trimmed.charAt(0) === "#") {
        // EXT-X-KEY / EXT-X-MAP carry their own URI and lose the same base.
        out.push(line.replace(/URI="([^"]+)"/, function (whole, u) {
          return 'URI="' + self._absUrl(u, playlistUrl) + '"';
        }));
        continue;
      }
      var abs = this._absUrl(trimmed, playlistUrl);
      out.push(abs + (abs.indexOf("?") >= 0 ? "&" : "?") + "x=.ts");
    }
    return "data:application/x-mpegURL;base64," + this._b64enc(out.join("\n"));
  }

  // Turn one resolved playlist into something the player will actually open.
  // Returns the entry unchanged when nothing is wrong with it.
  _preparePlaylist(entry, body, checkPoison) {
    // Ad-injected playlists take the older byterange path: their segments are
    // wrapped, not merely mislabelled.
    if (checkPoison && this._playlistIsPoisoned(body, entry.url)) {
      return { url: this._rewriteWithByterange(body), label: entry.label, originalUrl: entry.url };
    }
    if (this._playlistNeedsExtFix(body)) {
      return { url: this._rewritePlaylistExtensions(body, entry.url), label: entry.label, originalUrl: entry.url };
    }
    return entry;
  }

  // Every variant we hand back is fetched once, where before only the leading
  // one was probed for ad poisoning. A mislabelled segment makes an entry
  // unplayable rather than merely worth skipping, so it is not something that
  // can be left for the viewer to notice — and the CDN serves these in well
  // under a second. The poison probe rides along on the same fetch.
  async _preparePlaylists(variants, headers, isExtra) {
    var out = [];
    for (var i = 0; i < variants.length; i++) {
      var body = "";
      try { body = (await this.client.get(variants[i].url, headers)).body || ""; } catch (e) {}
      // Unreadable playlist: hand back the URL and let the player try.
      if (body.indexOf("#EXTM3U") < 0) { out.push(variants[i]); continue; }
      out.push(this._preparePlaylist(variants[i], body, i === 0 && !isExtra));
    }
    return out;
  }

  // Fetch a master HLS playlist and return one entry per quality variant.
  // Returns [] if the URL is a flat media playlist (no #EXT-X-STREAM-INF, use as-is).
  // Returns null if the response is not a valid m3u8 (Cloudflare block, error, or fetch failure).
  // nekostream.site streams are routed through the shirayuki proxy, which strips the
  // 70-byte PNG wrapper from every segment and serves clean MPEG-TS to libmpv.
  async _resolveHlsVariants(masterUrl, headers, isExtra) {
    // Only a CDN that wraps MPEG-TS in a PNG header still needs the proxy —
    // nothing an extension returns can strip bytes out of a segment body. A
    // decorative segment *extension* is a different problem and is fixable here
    // (see _rewritePlaylistExtensions), so a megaplay.buzz Referer no longer
    // implies a proxy: its CDN serves clean TS behind .jpg/.html/.webp names.
    var isNeko = this._isWrappedCdnUrl(masterUrl);
    try {
      var res = await this.client.get(masterUrl, headers);
      var body = res.body || "";
      if (body.indexOf("#EXTM3U") < 0) return null; // not a valid m3u8 (blocked or error)
      if (body.indexOf("#EXT-X-STREAM-INF") < 0) {
        // Flat media playlist, and its body is already in hand.
        if (isNeko) {
          return this._markWrapped([{ url: masterUrl, label: "Auto" }]);
        }
        var flat = this._preparePlaylist({ url: masterUrl, label: "" }, body, !isExtra);
        return flat.url === masterUrl ? [] : [flat]; // [] means "use master URL as-is"
      }
      var lastSlash = masterUrl.lastIndexOf("/");
      var baseDir = lastSlash > 0 ? masterUrl.substring(0, lastSlash + 1) : masterUrl;
      var lines = body.split("\n");
      var variants = [];
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.indexOf("#EXT-X-STREAM-INF:") !== 0) continue;
        var resM = line.match(/RESOLUTION=\d+x(\d+)/);
        var bwM  = line.match(/BANDWIDTH=(\d+)/);
        var label = resM ? resM[1] + "p" : (bwM ? Math.round(parseInt(bwM[1]) / 1000) + "kbps" : "Auto");
        for (var j = i + 1; j < lines.length; j++) {
          var u = lines[j].trim();
          if (!u || u.charAt(0) === "#") continue;
          variants.push({ url: u.indexOf("http") === 0 ? u : baseDir + u, label: label });
          break;
        }
      }
      variants.sort(function(a, b) { return (parseInt(b.label) || 0) - (parseInt(a.label) || 0); });

      if (isNeko) {
        // nekostream-family CDN: MPEG-TS behind a PNG header. iOS AVPlayer scans
        // forward to the 0x47 sync and plays; libmpv (Windows/Android) cannot,
        // and the episode buffers forever. Flagged so the emitter can offer an
        // unwrapped entry when the viewer has the proxy switched on — nothing an
        // extension returns can fix the bytes.
        return this._markWrapped(variants);
      }

      return await this._preparePlaylists(variants, headers, isExtra);
    } catch (e) {}
    return null; // network/parse error
  }

  // Fetch malId + timestamp for an episode when the chapter URL is missing them.
  // This happens when the user last refreshed during v0.3.0 (2-part URL format).
  async _fetchEpMeta(slug, epNum) {
    try {
      var res = await this.client.get(this.source.baseUrl + "/watch/" + slug, this.headers);
      var html = res.body || "";
      var doc = new Document(html);
      var animeId = "";
      var watchMain = doc.selectFirst("#watch-main");
      if (watchMain) animeId = watchMain.attr("data-id") || "";
      if (!animeId) {
        var m = html.match(/data-id="(\d+)"/);
        if (m) animeId = m[1];
      }
      if (!animeId) return null;

      var epRes = await this.client.get(
        this.source.baseUrl + "/ajax/episode/list/" + animeId + "?vrf=",
        { "User-Agent": this.ua, "Referer": this.source.baseUrl + "/watch/" + slug + "/", "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/javascript, */*; q=0.01" }
      );
      var epData;
      try { epData = JSON.parse(epRes.body); } catch (e) { return null; }
      if (!epData || !epData.result) return null;

      var epDoc = new Document(epData.result);
      var epEls = epDoc.select("a[data-num]");
      for (var i = 0; i < epEls.length; i++) {
        if (epEls[i].attr("data-num") === epNum) {
          return {
            malId: epEls[i].attr("data-mal") || "",
            timestamp: epEls[i].attr("data-timestamp") || "",
            ids: epEls[i].attr("data-ids") || "",
          };
        }
      }
    } catch (e) {}
    return null;
  }

  // What one audio track is worth collecting, and what it may spend getting there.
  //
  // Two things differ between the servers the site lists, and stopping at the
  // first working one hid both. Renditions: megaplay often carries a single
  // 1080p (or a lone 720p) while vidtube carries 1080p/720p/360p. Delivery
  // speed: measured on one episode, megaplay's CDN (cdn.imgnex.top, segments on
  // shard-*.snapcdn.top) is throttled to roughly the video bitrate — 0.95x
  // realtime at 1080p and 0.99x at 720p, which stalls the player — while
  // vidtube's (s1.akirax.buzz, segments on s2.norami.top) served the same
  // episode at 70-300x. A picker holding only one CDN gives the viewer no way
  // out of a slow one, so we keep walking until a second host is in hand.
  get ENOUGH_HOSTS() { return 2; }
  get ENOUGH_RESOLUTIONS() { return 2; }

  // Spend limits. Servers that resolve to a file we already have cost two
  // requests and are not counted; MAX_RESOLVED_PER_TYPE bounds the expensive
  // ones, MAX_SERVERS_PER_TYPE the walk itself.
  get MAX_RESOLVED_PER_TYPE() { return 3; }
  get MAX_SERVERS_PER_TYPE() { return 6; }

  // Wall-clock ceiling on hunting for alternates once something playable is in
  // hand. Nothing is lost by giving up early — the picker still holds the
  // working stream — and the viewer is waiting on this call.
  get EXTRA_WALK_BUDGET_MS() { return 4000; }

  // Servers frequently resolve to the exact same file (HD-1 and Vidstream-2 are
  // usually one CDN path). Remember what a track already yielded so the extra
  // servers cost two requests instead of a second master fetch + subtitle set.
  _alreadyResolved(m3u8) {
    if (!this._seenSources) return false;
    if (this._seenSources[m3u8]) return true;
    this._seenSources[m3u8] = true;
    return false;
  }

  // Height of a stream in pixels, from the "1080p - HD-1 [Sub]" quality label.
  // 0 for unlabelled ("Auto") streams.
  _streamHeight(stream) {
    var m = String(stream && stream.quality || "").match(/^(\d+)p/);
    return m ? parseInt(m[1]) : 0;
  }

  // Append streams the list does not already carry, keyed by final URL.
  _mergeStreams(existing, incoming) {
    var seen = {};
    for (var i = 0; i < existing.length; i++) seen[existing[i].url] = true;
    for (var j = 0; j < incoming.length; j++) {
      if (seen[incoming[j].url]) continue;
      seen[incoming[j].url] = true;
      existing.push(incoming[j]);
    }
    return existing;
  }

  // Distinct segment-delivery hosts represented in the list. Different hosts are
  // the only real fallback when one CDN is too slow to keep up with playback.
  _distinctHosts(streams) {
    var seen = {}, n = 0;
    for (var i = 0; i < streams.length; i++) {
      var m = String(streams[i].url || "").match(/^https?:\/\/([^/]+)/);
      var host = m ? m[1] : "";
      if (seen[host]) continue;
      seen[host] = true;
      n++;
    }
    return n;
  }

  // Enough for one audio track: a choice of resolution, plus a choice of CDN
  // when the viewer has actually switched on more than one server. With the
  // default single server there is no second host to wait for.
  _ladderIsComplete(streams, enabled) {
    var wantHosts = (enabled && enabled.length > 1) ? this.ENOUGH_HOSTS : 1;
    return this._distinctHosts(streams) >= wantHosts &&
           this._distinctResolutions(streams) >= this.ENOUGH_RESOLUTIONS;
  }

  _distinctResolutions(streams) {
    var seen = {}, n = 0;
    for (var i = 0; i < streams.length; i++) {
      var h = this._streamHeight(streams[i]);
      if (seen[h]) continue;
      seen[h] = true;
      n++;
    }
    return n;
  }

  // Server name out of a "1080p - VidPlay-1 [Sub]" quality label, lowercased.
  _serverName(stream) {
    var q = String(stream && stream.quality || "");
    var body = q.indexOf(" - ") >= 0 ? q.slice(q.indexOf(" - ") + 3) : q;
    var b = body.indexOf(" [");
    return (b >= 0 ? body.slice(0, b) : body).trim().toLowerCase();
  }

  // Mangayomi plays the first entry of the list, so both preferences are applied
  // by moving matches to the front; nothing is dropped, and streams keep their
  // relative order inside each group. Server outranks quality: a slow CDN stalls
  // playback at every resolution, so honouring the resolution on a server the
  // viewer ranked lower would hand back the stall. serverPref is the first
  // switched-on server, not a setting of its own.
  _applyPlaybackPrefs(streams, serverPref, qualityPref) {
    var wantH  = parseInt(qualityPref) || 0;
    var wantSv = (serverPref && serverPref !== "auto") ? serverPref : "";
    if ((!wantH && !wantSv) || streams.length < 2) return streams;
    var both = [], svOnly = [], qOnly = [], rest = [];
    for (var i = 0; i < streams.length; i++) {
      var svOk = wantSv ? this._serverName(streams[i]).indexOf(wantSv) === 0 : false;
      var qOk  = wantH ? this._streamHeight(streams[i]) === wantH : false;
      if (svOk && qOk)      both.push(streams[i]);
      else if (svOk)        svOnly.push(streams[i]);
      else if (qOk)         qOnly.push(streams[i]);
      else                  rest.push(streams[i]);
    }
    return both.concat(svOnly, qOnly, rest);
  }

  // The server names the site prints, grouped. Order matters twice over: it is
  // the order servers are resolved in, and the order their streams appear in the
  // picker, so the default (VidPlay) leads and auto-plays.
  get KNOWN_SERVERS() { return ["vidplay", "hd", "vidstream", "vidcloud"]; }

  // Which group a printed name like "VidPlay-1", "HD-2" or "Vidstream-2" belongs
  // to. "" for a name the site invented since this was written.
  _serverGroup(name) {
    var n = String(name || "").trim().toLowerCase();
    var known = this.KNOWN_SERVERS;
    for (var i = 0; i < known.length; i++) if (n.indexOf(known[i]) === 0) return known[i];
    return "";
  }

  // Servers the viewer has switched on, in KNOWN_SERVERS order. VidPlay alone by
  // default: it is the one whose CDN reliably outruns playback (see the
  // "Servers" preference), and every server added past it costs requests.
  _enabledServers() {
    var enabled;
    try { enabled = new SharedPreferences().get("anikoto_pref_servers"); } catch (e) {}
    if (!enabled || !enabled.length) enabled = ["vidplay"];
    var picked = [];
    var known = this.KNOWN_SERVERS;
    for (var i = 0; i < known.length; i++) {
      if (enabled.indexOf(known[i]) >= 0) picked.push(known[i]);
    }
    return picked.length ? picked : ["vidplay"];
  }

  // Split one type container's servers into what the viewer asked for and
  // everything else. The second tier is a rescue lane only: plenty of titles
  // carry no VidPlay copy at all (Solo Leveling S2 is MegaPlay-only), and an
  // episode that refuses to play is worse than one that plays on a server the
  // viewer did not tick.
  _tierServers(serverEls, enabled) {
    var chosen = [], rest = [], seenSvIds = {};
    for (var i = 0; i < serverEls.length; i++) {
      var el = serverEls[i];
      var svId = el.attr("data-sv-id") || ("srv_" + i);
      if (seenSvIds[svId]) continue;
      seenSvIds[svId] = true;
      var linkId = el.attr("data-link-id") || "";
      if (!linkId) continue;
      var name = (el.text || "").trim().slice(0, 20) || "Srv" + (i + 1);
      var entry = { linkId: linkId, name: name, group: this._serverGroup(name) };
      if (entry.group && enabled.indexOf(entry.group) >= 0) chosen.push(entry);
      else rest.push(entry);
    }
    chosen.sort(function (a, b) {
      return enabled.indexOf(a.group) - enabled.indexOf(b.group);
    });
    return [chosen, rest];
  }

  // Resolve one tier of servers, merging what they carry, until the ladder is
  // good enough or a budget runs out. Returns the streams collected.
  async _walkServers(entries, audioLabel, collected, enabled) {
    var resolvedCount = 0, walked = 0;
    var walkStart = Date.now();
    for (var i = 0; i < entries.length; i++) {
      var before = collected.length;
      var label = entries[i].name + (audioLabel ? " [" + audioLabel + "]" : "");
      var resolved = await this._resolveStreams(entries[i].linkId, label, before > 0);
      collected = this._mergeStreams(collected, resolved);
      walked++;
      if (collected.length > before) resolvedCount++; // a duplicate file costs almost nothing
      // Nothing playable yet: keep walking every server, as before.
      if (collected.length === 0) continue;
      if (this._ladderIsComplete(collected, enabled)) break;
      if (resolvedCount >= this.MAX_RESOLVED_PER_TYPE) break;
      if (walked >= this.MAX_SERVERS_PER_TYPE) break;
      // A playable stream is already in hand; a slow origin must not hold the
      // episode hostage while we shop for a second opinion.
      if (Date.now() - walkStart > this.EXTRA_WALK_BUDGET_MS) break;
    }
    return collected;
  }

  // Fetch servers from /ajax/server/list?servers={ids} and resolve sub and dub separately.
  // The response groups servers in .type[data-type="sub/hsub/dub"] containers, each with
  // its own li[data-link-id][data-sv-id] entries. Per type we resolve the first
  // working server plus up to EXTRA_SERVERS_PER_TYPE more, merging their streams,
  // because the hosts carry different renditions (see EXTRA_SERVERS_PER_TYPE).
  // resolveTypes: { sub: bool, dub: bool } — skip types the caller doesn't need (saves time).
  async _fetchServerListStreams(ids, resolveTypes) {
    var empty = { sub: [], dub: [] };
    if (!ids) return empty;
    var wantSub = !resolveTypes || resolveTypes.sub !== false;
    var wantDub = !resolveTypes || resolveTypes.dub !== false;
    var enabled = this._enabledServers();
    try {
      var res = await this.client.get(
        this.source.baseUrl + "/ajax/server/list?servers=" + ids,
        { "User-Agent": this.ua, "Referer": this.source.baseUrl + "/", "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/javascript, */*; q=0.01" }
      );
      var html = res.body || "";
      try { var parsed = JSON.parse(html); if (parsed && typeof parsed.result === "string") html = parsed.result; } catch (e) {}

      var doc = new Document(html);
      var subStreams = [], dubStreams = [];

      // Primary path: .type[data-type] containers group sub/hsub/dub servers.
      var typeEls = doc.select(".type[data-type]");
      if (typeEls.length > 0) {
        for (var t = 0; t < typeEls.length; t++) {
          var typeEl = typeEls[t];
          var dataType = typeEl.attr("data-type") || "";
          var isDub = dataType === "dub";
          // sub and hsub both count as subtitled; skip if we already have that track
          if (!isDub && (!wantSub || subStreams.length > 0)) continue;
          if (isDub && (!wantDub || dubStreams.length > 0)) continue;
          var audioLabel = isDub ? "Dub" : "Sub";
          var tiers = this._tierServers(typeEl.select("li[data-link-id]"), enabled);
          var collected = [];
          this._seenSources = {}; // per audio track — sub and dub are different files
          this._trackSubs = null;
          collected = await this._walkServers(tiers[0], audioLabel, collected, enabled);
          // Rescue lane: only when the chosen servers gave this track nothing.
          if (collected.length === 0) {
            collected = await this._walkServers(tiers[1], audioLabel, collected, enabled);
          }
          if (isDub) dubStreams = dubStreams.concat(collected);
          else       subStreams = subStreams.concat(collected);
        }
        return { sub: subStreams, dub: dubStreams };
      }

      // Fallback: untyped list — treat all as sub.
      var flatTiers = this._tierServers(doc.select("li[data-link-id]"), enabled);
      this._seenSources = {};
      this._trackSubs = null;
      subStreams = await this._walkServers(flatTiers[0], "", subStreams, enabled);
      if (subStreams.length === 0) {
        subStreams = await this._walkServers(flatTiers[1], "", subStreams, enabled);
      }
      return { sub: subStreams, dub: [] };
    } catch (e) {}
    return empty;
  }

  async getVideoList(url) {
    // Chapter URL format: "{slug}||{epNum}||{malId}||{timestamp}||{ids}"
    // Older cached formats may have fewer parts — fall back to fetching ep metadata.
    var parts = url.split("||");
    var slug = parts[0] || "";
    var epNum = parts[1] || "1";
    var malId = parts[2] || "";
    var timestamp = parts[3] || "";
    var ids = parts[4] || "";

    if (!malId || !timestamp) {
      var meta = await this._fetchEpMeta(slug, epNum);
      if (meta) {
        malId = meta.malId || malId;
        timestamp = meta.timestamp || timestamp;
        ids = meta.ids || ids;
      }
      if (!malId || !timestamp) return [];
    }

    var serverPref = "megaplay";
    try { serverPref = new SharedPreferences().get("anikoto_pref_server") || "megaplay"; } catch (e) {}
    var audioPref = "sub_dub";
    try { audioPref = new SharedPreferences().get("anikoto_pref_audio") || "sub_dub"; } catch (e) {}
    var qualityPref = "auto";
    try { qualityPref = new SharedPreferences().get("anikoto_pref_quality") || "auto"; } catch (e) {}
    // The first switched-on server leads the picker, so it is also what the
    // quality sort must not reorder around.
    var serverOrder = this._enabledServers()[0];

    this._seenSources = {};
    var subStreams = [], dubStreams = [];

    // Server list — VidPlay (VidTube CDN) / HD (MegaPlay CDN) / Vidstream / VidCloud
    // "megaplay" pref also routes here: MegaPlay streams are served via the HD server entry.
    if (serverPref !== "mapper") {
      // Always re-fetch fresh ids — cached ids from the episode list can go stale
      // (site rotates server link IDs) and point to a completely different episode.
      var m2 = await this._fetchEpMeta(slug, epNum);
      if (m2 && m2.ids) ids = m2.ids;
      if (!ids) return [];
      var resolveTypes = { sub: audioPref !== "dub", dub: audioPref !== "sub" };
      var listResult = await this._fetchServerListStreams(ids, resolveTypes);
      subStreams = subStreams.concat(listResult.sub);
      dubStreams = dubStreams.concat(listResult.dub);
    }

    // Kiwi-Stream via mapper (legacy — mapper no longer returns streaming linkIds)
    if (serverPref === "mapper") {
      var mapRes;
      try {
        mapRes = await this.client.get(
          "https://mapper.nekostream.site/api/mal/" + malId + "/" + epNum + "/" + timestamp,
          { "User-Agent": this.ua, "Referer": this.source.baseUrl + "/", "Accept": "application/json" }
        );
      } catch (e) {}
      if (mapRes) {
        var mapData;
        try { mapData = JSON.parse(mapRes.body); } catch (e) {}
        if (mapData) {
          var kiwi = mapData["Kiwi-Stream-"] || {};
          var subLinkId = kiwi.sub && kiwi.sub.url ? kiwi.sub.url : "";
          var dubLinkId = kiwi.dub && kiwi.dub.url ? kiwi.dub.url : "";
          if (subLinkId) { this._seenSources = {}; this._trackSubs = null; var ks = await this._resolveStreams(subLinkId, "Sub [Kiwi-Stream]"); subStreams = subStreams.concat(ks); }
          if (dubLinkId) { this._seenSources = {}; this._trackSubs = null; var kd = await this._resolveStreams(dubLinkId, "Dub [Kiwi-Stream]"); dubStreams = dubStreams.concat(kd); }
        }
      }
    }

    // Sort each track on its own: the audio preference below decides which track
    // leads, these two only reorder within a track.
    subStreams = this._applyPlaybackPrefs(subStreams, serverOrder, qualityPref);
    dubStreams = this._applyPlaybackPrefs(dubStreams, serverOrder, qualityPref);

    if (audioPref === "dub_sub") return dubStreams.concat(subStreams);
    if (audioPref === "sub")     return subStreams;
    if (audioPref === "dub")     return dubStreams;
    return subStreams.concat(dubStreams);
  }

  getFilterList() {
    return [];
  }

  getSourcePreferences() {
    return [
      {
        key: "anikoto_pref_server",
        listPreference: {
          title: "Stream source",
          summary: "Server List walks the AniKoto servers (VidPlay / MegaPlay HD / Vidstream / VidCloud) and merges what they carry, so the picker holds more than one quality and more than one CDN. If a stream keeps buffering, pick another server from the same picker — their delivery speeds differ enormously. Kiwi-Stream is legacy and unlikely to work.",
          valueIndex: 0,
          entries: [
            "Server List (MegaPlay / VidPlay)",
            "Kiwi-Stream (Mapper) [legacy]",
          ],
          entryValues: ["list", "mapper"],
        },
      },
      {
        key: "anikoto_pref_ep_thumbnails",
        switchPreferenceCompat: {
          title: "Episode thumbnails",
          summary: "Fetch per-episode thumbnails from ani.zip. Adds one extra network request when opening an anime.",
          value: false,
        },
      },
      {
        key: "anikoto_pref_servers",
        multiSelectListPreference: {
          title: "Servers",
          summary: "VidPlay only, by default: its CDN was measured delivering an episode 70-300x faster than realtime, while MegaPlay's ran at 0.95-0.99x — slower than playback, which is what makes episodes stall. Tick more to widen the quality picker at the cost of a slower start. Titles with no VidPlay copy fall back to whatever the site does have, whatever is ticked here.",
          values:      ["vidplay"],
          entries:     ["VidPlay (fast CDN)", "MegaPlay HD (often stalls)", "Vidstream (often stalls)", "VidCloud"],
          entryValues: ["vidplay", "hd", "vidstream", "vidcloud"],
        },
      },
      {
        key: "anikoto_pref_proxy_enabled",
        checkBoxPreference: {
          title: "Fix playback on Windows/Android",
          summary: "Turn on if episodes buffer forever or skip instantly. Not needed on iOS. Requires the proxy to be reachable at the address below.",
          value: false,
        },
      },
      {
        key: "anikoto_pref_proxy_url",
        editTextPreference: {
          title: "Proxy address (advanced)",
          summary: "Already filled in — only change this if you run the proxy somewhere other than this PC.",
          value: DEFAULT_PROXY,
          dialogTitle: "Proxy address",
          dialogMessage: "AniKoto's CDN hides video segments inside PNG images, which Windows/Android cannot decode (iOS plays them fine). The default points at proxy/proxy.js running on this PC. Replace it with a deployed worker's https URL to cover several devices from one place.",
        },
      },
      {
        key: "anikoto_pref_quality",
        listPreference: {
          title: "Preferred quality",
          summary: "Plays this resolution first when the episode has it. Every quality stays in the picker either way — Auto keeps the server's own order, highest first. Lowering this also helps on a slow server, though switching server usually helps more.",
          valueIndex: 0,
          entries: [
            "Auto (highest available)",
            "1080p",
            "720p",
            "480p",
            "360p",
          ],
          entryValues: ["auto", "1080", "720", "480", "360"],
        },
      },
      {
        key: "anikoto_pref_audio",
        listPreference: {
          title: "Preferred audio",
          summary: "Choose playback order. When both tracks are selected the first plays automatically; the second is available as a fallback.",
          valueIndex: 0,
          entries: [
            "Sub then Dub (Sub plays, Dub as backup)",
            "Dub then Sub (Dub plays, Sub as backup)",
            "Sub only",
            "Dub only",
          ],
          entryValues: ["sub_dub", "dub_sub", "sub", "dub"],
        },
      },
    ];
  }
}
