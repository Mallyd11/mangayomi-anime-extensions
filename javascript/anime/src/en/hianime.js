const mangayomiSources = [
  {
    "name": "HiAnime",
    "id": 1183439094,
    "lang": "en",
    "baseUrl": "https://hianime.at",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://hianime.at",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.5.2",
    "pkgPath": "anime/src/en/hianime.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": false,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/hianime.js",
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
// This replaces two upstream proxies that both went dark: shirayuki
// (shirayuki.eastasia.cloudapp.azure.com:1818) no longer answers at all, and
// vibevibe.workers.dev — the single host servesRawTs() used to whitelist — is
// gone too, which is why every episode ended up on a disguised CDN with nothing
// able to decode it.
//
// NOTE: localhost means *that* PC — this is not a shared address. Every machine
// needs proxy/proxy.js running locally (Node + a Startup shortcut). To cover
// several machines, and phones, from one place, deploy proxy/worker.js and put
// its https URL here instead; the toggle then needs no per-machine setup.
var DEFAULT_PROXY = "http://localhost:8765";

// Hosts measured serving raw MPEG-TS that is merely *named* .jpg — libmpv
// rejects them on the extension alone, so the proxy only has to rename them and
// can 302 straight back to the CDN (mode=redirect): full CDN speed, a few
// hundred bytes through the proxy per episode instead of gigabytes.
//
// Everything else is assumed PNG-wrapped and read through the proxy so the
// header can be stripped. That is the safe default — tsStart() returns 0 for a
// clean transport stream, so routing a raw-TS host this way still plays, it just
// carries bytes it did not need to. Re-measure before trusting: these hosts
// rotate (nekostream became kotocdn within days) and the wrapper is currently
// 252 bytes, not the 70 it used to be.
var RAW_TS_HOSTS = ["s1.akirax.buzz", "s2.norami.top", "vibevibe.workers.dev", "hls2.aniwatchtv.uk", "aniwatchtv.uk"];

// ZokoAnime hides its player payload in `window.__P`: base64 of the JSON XORed
// with this literal repeating key. Straight out of the site's own
// zokoanime1.pages.dev/core/obfuscate.js — there is no server-side secret and no
// session, which is exactly why this server is usable from an extension when
// TryEmbed (same CDN, Cloudflare-fingerprinted) is not.
var ZOKO_KEY = "otaku-embed-v1";

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

  async fetchPage(path) {
    var url = path.startsWith("http") ? path : this.source.baseUrl + path;
    var res = await this.client.get(url, this.headers);
    return { doc: new Document(res.body), html: res.body };
  }

  async fetchDoc(path) {
    return (await this.fetchPage(path)).doc;
  }

  // Build a URL→EnglishName map from the JSON-LD <script> block on list pages.
  // HiAnime embeds structured data with English translated names even when the
  // card HTML only shows romaji.
  buildNameMap(html) {
    var nameMap = {};
    try {
      var re = /<script[^>]+ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
      var m;
      while ((m = re.exec(html)) !== null) {
        try {
          var ld = JSON.parse(m[1]);
          var ldItems = (ld && ld.itemListElement) ? ld.itemListElement : [];
          for (var i = 0; i < ldItems.length; i++) {
            if (ldItems[i].url && ldItems[i].name) {
              nameMap[ldItems[i].url] = ldItems[i].name;
            }
          }
        } catch (e) {}
      }
    } catch (e) {}
    return nameMap;
  }

  // Build list from JSON-LD itemListElement (used when .flw-item cards are absent —
  // HiAnime moved card rendering to client-side JS in 2025, but structured data remains SSR).
  parseListFromJsonLd(html) {
    var list = [];
    try {
      var re = /<script[^>]+ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
      var m;
      while ((m = re.exec(html)) !== null) {
        try {
          var ld = JSON.parse(m[1]);
          var ldItems = (ld && ld.itemListElement) ? ld.itemListElement : [];
          for (var i = 0; i < ldItems.length; i++) {
            var it = ldItems[i];
            if (it.url && it.name) {
              list.push({ name: it.name, imageUrl: it.image || "", link: it.url });
            }
          }
        } catch (e) {}
      }
    } catch (e) {}
    return list;
  }

  // Parse anime cards from list pages (.flw-item containers), with JSON-LD fallback.
  parseList(doc, html) {
    var list = [];
    var items = doc.select(".flw-item");
    if (items.length > 0) {
      var nameMap = this.buildNameMap(html);
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var anchor = item.selectFirst(".film-poster-ahref");
        if (!anchor) anchor = item.selectFirst(".dynamic-name");
        if (!anchor) anchor = item.selectFirst(".film-name a");
        var href = anchor ? anchor.attr("href") : "";
        var link = href.startsWith("http") ? href : this.source.baseUrl + href;

        var name = (nameMap && nameMap[link]) || "";
        if (!name) {
          var nameEl = item.selectFirst(".dynamic-name") || item.selectFirst(".film-name a");
          if (nameEl) name = (nameEl.attr("data-ename") || nameEl.text || "").trim();
        }
        name = name.trim();

        var img = item.selectFirst(".film-poster-img");
        if (!img) img = item.selectFirst(".film-poster img");
        var imageUrl = "";
        if (img) imageUrl = img.attr("src") || img.attr("data-src") || "";

        if (name && link) list.push({ name: name, imageUrl: imageUrl, link: link });
      }
      return list;
    }
    // Fallback: build list from JSON-LD structured data (CSR pages)
    return this.parseListFromJsonLd(html);
  }

  hasNextPage(doc, listLength) {
    // DOM pagination link (present on SSR pages)
    var nextLink = doc.selectFirst("a[aria-label='Next']");
    if (nextLink) return true;
    // Heuristic for CSR pages: full pages typically have 20–24 items
    return (listLength || 0) >= 20;
  }

  get supportsLatest() {
    return true;
  }

  async getPopular(page) {
    var p = await this.fetchPage("/most-popular?page=" + page);
    var list = this.parseList(p.doc, p.html);
    return { list: list, hasNextPage: this.hasNextPage(p.doc, list.length) };
  }

  async getLatestUpdates(page) {
    var p = await this.fetchPage("/recently-updated?page=" + page);
    var list = this.parseList(p.doc, p.html);
    return { list: list, hasNextPage: this.hasNextPage(p.doc, list.length) };
  }

  async search(query, page, filters) {
    try {
      var p = await this.fetchPage("/search?keyword=" + encodeURIComponent(query) + "&page=" + page);
      var list = this.parseList(p.doc, p.html);
      return { list: list, hasNextPage: this.hasNextPage(p.doc, list.length) };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  statusCode(status) {
    var s = (status || "").toLowerCase();
    // Check completed/finished BEFORE "airing" so "Finished Airing" maps to completed.
    if (s.includes("completed") || s.includes("finished")) return 1;
    if (s.includes("upcoming") || s.includes("not yet")) return 4;
    if (s.includes("currently airing") || s.includes("ongoing") || s.includes("releasing")) return 0;
    if (s.includes("airing")) return 0;
    return 5;
  }

  // NOTE: '=' padding must survive the sanitising pass. Stripping it loses the
  // record of how many bytes the final group really carries, and the loop then
  // emits a full 3 bytes for it — which is where the trailing NULs on decoded
  // server URLs came from, poisoning the Referer header and killing extraction.
  _b64decode(s) {
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var str = String(s).replace(/[^A-Za-z0-9+/=]/g, "");
    var output = "";
    for (var i = 0; i < str.length; i += 4) {
      var c0 = chars.indexOf(str.charAt(i));
      var c1 = chars.indexOf(str.charAt(i + 1));
      var c2 = chars.indexOf(str.charAt(i + 2));   // -1 for '=' padding
      var c3 = chars.indexOf(str.charAt(i + 3));
      if (c0 < 0 || c1 < 0) break;
      var n = (c0 << 18) | (c1 << 12) | ((c2 < 0 ? 0 : c2) << 6) | (c3 < 0 ? 0 : c3);
      output += String.fromCharCode((n >> 16) & 0xff);
      if (c2 >= 0) output += String.fromCharCode((n >> 8) & 0xff);
      if (c3 >= 0) output += String.fromCharCode(n & 0xff);
    }
    return output;
  }

  // Anime links come off the grid as /watch/<slug>-<id>; the metadata lives on
  // /<slug>-<id> instead, so accept either and keep both ids.
  //
  // Entries saved before v0.5.0 point at the old site (hianime.ms/details/<slug>),
  // whose slugs carry a hex suffix rather than a numeric id. Those must not throw:
  // getDetail is exactly what Refresh calls, so an exception here would leave a
  // library entry permanently stuck on unplayable episode URLs. Signal the miss
  // with an empty animeId and let the caller look the title up on this site.
  parseAnimeUrl(url) {
    var u = String(url || "").split("?")[0].replace(/\/+$/, "");
    var path = u.replace(/^https?:\/\/[^/]+/, "");
    path = path.replace(/^\/(?:watch|details|anime)\//, "/").replace(/^\//, "");
    var animeId = (path.match(/-(\d+)$/) || [])[1] || "";
    return { slug: path, animeId: animeId };
  }

  // Find this site's entry for a slug carried over from the old one, by
  // searching for the slug's words and taking the closest match. Returns the
  // parsed {slug, animeId} of the match, or null.
  async resolveAnime(slug) {
    var words = String(slug || "").replace(/-[0-9a-f]{4,}$/i, "").replace(/-/g, " ").trim();
    if (!words) return null;
    try {
      var res = await this.client.get(
        this.source.baseUrl + "/search?keyword=" + encodeURIComponent(words), this.headers);
      var doc = new Document(res.body || "");
      var anchors = doc.select(".film-poster-ahref");
      if (!anchors.length) return null;
      // Prefer a slug that starts the same way; otherwise the top hit, which is
      // what a viewer searching that title would pick anyway.
      var wanted = String(slug).replace(/-[0-9a-f]{4,}$/i, "");
      var best = null;
      for (var i = 0; i < anchors.length; i++) {
        var href = anchors[i].attr("href") || "";
        var cand = this.parseAnimeUrl(href);
        if (!cand.animeId) continue;
        if (!best) best = cand;
        if (cand.slug.indexOf(wanted) === 0) return cand;
      }
      return best;
    } catch (e) {
      return null;
    }
  }

  // Pull one labelled row out of the detail sidebar. The app's CSS engine has no
  // :contains(), so the label has to be matched by walking the rows.
  infoValue(doc, label) {
    var items = doc.select(".anisc-info .item");
    for (var i = 0; i < items.length; i++) {
      var head = items[i].selectFirst(".item-head");
      if (!head) continue;
      if (head.text.trim().toLowerCase().indexOf(label.toLowerCase()) !== 0) continue;
      var links = items[i].select("a");
      if (links.length) {
        var out = [];
        for (var j = 0; j < links.length; j++) out.push(links[j].text.trim());
        return out.join(", ");
      }
      var name = items[i].selectFirst(".name");
      if (name) return name.text.trim();
      return items[i].text.replace(head.text, "").trim();
    }
    return "";
  }

  async getDetail(url) {
    var info = this.parseAnimeUrl(url);
    if (!info.animeId) {
      // A library entry from the old site — find the same title here rather than
      // failing, so Refresh can repair the entry instead of dead-ending.
      var found = await this.resolveAnime(info.slug);
      if (!found) throw new Error("Could not find this title on " + this.source.baseUrl + ": " + url);
      info = found;
    }

    var detailUrl = this.source.baseUrl + "/" + info.slug;
    var res = await this.client.get(detailUrl, this.headers);
    var doc = new Document(res.body || "");

    var name = "";
    var nameEl = doc.selectFirst(".anisc-detail .film-name") || doc.selectFirst("h2.film-name");
    if (nameEl) name = nameEl.text.trim();

    var imageUrl = "";
    var img = doc.selectFirst(".anisc-poster .film-poster-img") || doc.selectFirst(".film-poster-img");
    if (img) imageUrl = img.attr("src") || img.attr("data-src") || "";

    var description = "";
    var desc = doc.selectFirst(".film-description .text") || doc.selectFirst(".film-description");
    if (desc) description = desc.text.trim();

    var genre = [];
    var genreStr = this.infoValue(doc, "Genres");
    if (genreStr) genre = genreStr.split(",").map(function (g) { return g.trim(); }).filter(Boolean);

    var status = this.statusCode(this.infoValue(doc, "Status"));

    // Episodes come from the theme API, not the page. Note the route is
    // /api/theme/episode/..., NOT the classic /ajax/v2/episode/... which 404s here.
    var chapters = [];
    try {
      var epRes = await this.client.get(
        this.source.baseUrl + "/api/theme/episode/list/" + info.animeId,
        { "User-Agent": this.ua, "Referer": detailUrl, "X-Requested-With": "XMLHttpRequest",
          "Accept": "application/json, text/javascript, */*; q=0.01" }
      );
      var epJson = JSON.parse(epRes.body || "{}");
      var epDoc = new Document(epJson.html || "");
      var items = epDoc.select("a.ep-item");
      for (var i = 0; i < items.length; i++) {
        var el = items[i];
        var epId = el.attr("data-id") || "";
        var epNum = el.attr("data-number") || String(i + 1);
        if (!epId) continue;
        var title = (el.attr("title") || "").trim();
        var label = "Episode " + epNum;
        if (title && title !== label) label += ": " + title;
        // chapter url: "{episodeId}|{animeId}|{episodeNumber}"
        chapters.push({ name: label, url: epId + "|" + info.animeId + "|" + epNum });
      }
    } catch (e) {}

    chapters.reverse(); // newest first, Mangayomi convention

    return {
      name: name,
      imageUrl: imageUrl,
      description: description,
      genre: genre,
      status: status,
      link: detailUrl,
      chapters: chapters,
    };
  }

  // Decode a binary string (one char per byte, as _b64decode returns) as UTF-8.
  // The site does this with the escape/unescape trick, which the app's JS engine
  // does not reliably provide, so decode the byte sequences directly.
  _utf8Decode(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i++) {
      var c = bytes.charCodeAt(i) & 0xff;
      if (c < 0x80) { out += String.fromCharCode(c); continue; }
      if (c >= 0xc0 && c < 0xe0 && i + 1 < bytes.length) {
        out += String.fromCharCode(((c & 0x1f) << 6) | (bytes.charCodeAt(++i) & 0x3f));
      } else if (c >= 0xe0 && c < 0xf0 && i + 2 < bytes.length) {
        var b1 = bytes.charCodeAt(++i) & 0x3f, b2 = bytes.charCodeAt(++i) & 0x3f;
        out += String.fromCharCode(((c & 0x0f) << 12) | (b1 << 6) | b2);
      } else if (c >= 0xf0 && i + 3 < bytes.length) {
        var c1 = bytes.charCodeAt(++i) & 0x3f, c2 = bytes.charCodeAt(++i) & 0x3f, c3 = bytes.charCodeAt(++i) & 0x3f;
        var cp = (((c & 0x07) << 18) | (c1 << 12) | (c2 << 6) | c3) - 0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      } else {
        out += String.fromCharCode(c);
      }
    }
    return out;
  }

  // base64 -> repeating-key XOR -> JSON. See ZOKO_KEY.
  deobfuscateZoko(blob) {
    try {
      var raw = this._b64decode(String(blob).replace(/-/g, "+").replace(/_/g, "/"));
      var out = "";
      for (var i = 0; i < raw.length; i++) {
        out += String.fromCharCode(raw.charCodeAt(i) ^ ZOKO_KEY.charCodeAt(i % ZOKO_KEY.length));
      }
      return JSON.parse(this._utf8Decode(out));
    } catch (e) {
      return null;
    }
  }

  // ZokoAnime: the one server that hands back a playable stream with no proxy.
  // Its master playlist lives on hls2.aniwatchtv.uk and its segments are real
  // MPEG-TS at real .ts URLs, so libmpv plays them untouched — unlike every
  // MegaPlay-family CDN, which disguises its segments as PNG images.
  async extractZokoStreams(embedUrl, audioLabel) {
    var streams = [];
    try {
      var res = await this.client.get(embedUrl, { "User-Agent": this.ua, "Referer": this.source.baseUrl + "/" });
      var html = res.body || "";
      var m = html.match(/window\.__P\s*=\s*"([^"]+)"/);
      if (!m) return streams;
      var data = this.deobfuscateZoko(m[1]);
      if (!data || !data.src) return streams;

      var hdrs = { "User-Agent": this.ua, "Referer": "https://zokoanime.video/" };
      var subtitles = [];
      var subs = data.subtitles || [];
      for (var i = 0; i < subs.length; i++) {
        if (!subs[i] || !subs[i].src) continue;
        subtitles.push({ file: subs[i].src, label: (subs[i].label || subs[i].lang || "Subtitle").trim() });
      }

      // Hand back the MEDIA playlist, never the master.
      //
      // resolveHlsPlaylist returns {kind, variants} — not an array. Testing it
      // for .length always failed, so every episode fell through to the master
      // URL. libmpv follows a master fine, which is why playback looked correct,
      // but the app's m3u8 downloader treats every non-comment line as a segment
      // (it has no #EXT-X-STREAM-INF handling), so it downloaded "1080/index.m3u8"
      // as if it were video and the download failed.
      var resolved = await this.resolveHlsPlaylist(data.src, hdrs);
      if (resolved.kind === "master") {
        for (var v = 0; v < resolved.variants.length; v++) {
          streams.push({
            url: resolved.variants[v].url, originalUrl: data.src,
            quality: resolved.variants[v].label + " - ZokoAnime [" + audioLabel + "]",
            headers: hdrs, subtitles: subtitles,
          });
        }
      } else {
        // "flat" is already a media playlist; the error kinds leave nothing
        // better to offer than the URL the site gave us.
        streams.push({
          url: data.src, originalUrl: data.src,
          quality: "ZokoAnime [" + audioLabel + "]",
          headers: hdrs, subtitles: subtitles,
        });
      }
    } catch (e) {}
    return streams;
  }

  // The episode's server list. Each entry's data-hash is simply base64 of the
  // embed URL, so no per-server "sources" round trip is needed.
  async fetchServers(episodeId) {
    var out = [];
    try {
      var res = await this.client.get(
        this.source.baseUrl + "/api/theme/episode/servers?episodeId=" + episodeId,
        { "User-Agent": this.ua, "Referer": this.source.baseUrl + "/", "X-Requested-With": "XMLHttpRequest",
          "Accept": "application/json, text/javascript, */*; q=0.01" }
      );
      var json = JSON.parse(res.body || "{}");
      var doc = new Document(json.html || "");
      var items = doc.select(".server-item");
      for (var i = 0; i < items.length; i++) {
        var el = items[i];
        var hash = el.attr("data-hash") || "";
        if (!hash) continue;
        var url = "";
        try { url = this._utf8Decode(this._b64decode(hash.replace(/-/g, "+").replace(/_/g, "/"))); } catch (e) { continue; }
        // Belt and braces: a stray control byte here ends up in a Referer header,
        // and the whole extraction dies on "invalid header value".
        url = url.replace(/[\u0000-\u001F\s]+$/g, "").trim();
        if (!/^https?:\/\//.test(url)) continue;
        out.push({
          type: (el.attr("data-type") || "sub").toLowerCase(),
          name: (el.attr("data-server-name") || "Server").trim(),
          url: url,
        });
      }
    } catch (e) {}
    return out;
  }

  // Fetch a MegaPlay page URL and extract sources.
  // Some pages return error HTML but still embed the player div — we check for
  // data-id first and only bail if it's truly absent. Also follows iframe redirects.
  async extractMegaplayFromPageUrl(pageUrl, referer, audioType, audioLabel) {
    try {
      var res = await this.client.get(pageUrl, { "User-Agent": this.ua, "Referer": referer });
      if (!res || !res.body) return [];
      // Look for player data-id even if the page also contains error HTML
      var m = res.body.match(/id="megaplay-player"[\s\S]*?data-id="(\d+)"/);
      if (m) return await this.fetchMegaplaySourcesById(m[1], pageUrl, audioType, audioLabel);
      // Follow any megaplay iframe redirect
      var iframeM = res.body.match(/src="(https:\/\/megaplay\.buzz\/[^"]+)"/);
      if (iframeM) {
        var iRes = await this.client.get(iframeM[1], { "User-Agent": this.ua, "Referer": pageUrl });
        if (iRes && iRes.body) {
          var im = iRes.body.match(/id="megaplay-player"[\s\S]*?data-id="(\d+)"/);
          if (im) return await this.fetchMegaplaySourcesById(im[1], iframeM[1], audioType, audioLabel);
        }
      }
    } catch (e) {}
    return [];
  }


  // Convert a WebVTT string to SRT format.
  // lostproject.club VTTs use MM:SS.mmm timestamps (no hours prefix); libmpv's
  // WebVTT parser misbehaves with this two-part format for standalone subtitle
  // files. SRT's explicit HH:MM:SS,mmm format is unambiguous and well-tested.
  _vttTsToSrt(ts) {
    // "MM:SS.mmm" or "HH:MM:SS.mmm" → "HH:MM:SS,mmm"
    var dotIdx = ts.lastIndexOf('.');
    var ms = ts.substring(dotIdx + 1);
    var parts = ts.substring(0, dotIdx).split(':');
    while (parts.length < 3) parts.unshift('00');
    return parts.join(':') + ',' + ms;
  }

  vttToSrt(vtt) {
    var lines = vtt.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    var srt = '';
    var cueNum = 1;
    var i = 0;
    // Skip WEBVTT header block (lines until the first blank line)
    while (i < lines.length && lines[i].trim() !== '') i++;
    while (i < lines.length) {
      // Skip blank lines between cues
      while (i < lines.length && lines[i].trim() === '') i++;
      if (i >= lines.length) break;
      var line = lines[i];
      // Skip NOTE / STYLE / REGION blocks
      if (/^(NOTE|STYLE|REGION)\b/.test(line)) {
        while (i < lines.length && lines[i].trim() !== '') i++;
        continue;
      }
      // Skip optional cue identifier (not a timestamp line)
      if (line.indexOf('-->') < 0) {
        i++;
        if (i >= lines.length) break;
        line = lines[i];
      }
      if (line.indexOf('-->') < 0) { i++; continue; }
      // Parse VTT timestamps — both MM:SS.mmm and HH:MM:SS.mmm
      var m = line.match(/([\d:]+\.\d{3})\s*-->\s*([\d:]+\.\d{3})/);
      if (!m) { i++; continue; }
      var start = this._vttTsToSrt(m[1]);
      var end = this._vttTsToSrt(m[2]);
      i++;
      var textLines = [];
      while (i < lines.length && lines[i].trim() !== '') {
        // Strip VTT inline timing tags (<00:01:00.000>), keep <i>/<b>/<u>
        var t = lines[i].replace(/<[\d:]+\.\d{3}>/g, '');
        textLines.push(t);
        i++;
      }
      if (textLines.length > 0) {
        srt += cueNum + '\n' + start + ' --> ' + end + '\n' + textLines.join('\n') + '\n\n';
        cueNum++;
      }
    }
    return srt || vtt;
  }

  // Whether a stream plays untouched on libmpv (Windows/Android).
  //
  // Nothing does, at present. Every CDN HiAnime hands out disguises its segments
  // one of two ways, both measured 2026-09-07:
  //   - PNG-wrapped: a 252-byte PNG header in front of real MPEG-TS, served as
  //     image/png at .image URLs (megap.akirax.buzz, megap.shiora.site,
  //     nekostream-family). iOS AVPlayer scans forward to the 0x47 sync byte and
  //     plays; libmpv treats it as a zero-duration image and races to ENDLIST.
  //   - raw MPEG-TS named .jpg (s1.akirax.buzz): the bytes are already clean and
  //     only the extension makes libmpv refuse it (extension_picky).
  //
  // Both need the proxy — the segment URLs live inside the provider's playlist
  // body, so nothing this extension returns can reach them. This predicate is
  // kept because it is the honest answer to "can the player use this as-is", and
  // it is what decides whether an unwrapped twin is worth emitting.
  servesRawTs(url) {
    var u = url || "";
    for (var i = 0; i < RAW_TS_HOSTS.length; i++) {
      // Raw TS still fails on a .jpg/.image name, so only a sane extension counts.
      if (u.indexOf(RAW_TS_HOSTS[i]) >= 0) return !/\.(jpg|jpeg|png|image)(\?|$)/i.test(u);
    }
    return false;
  }

  // Segments on these hosts are already clean MPEG-TS, so the proxy can 302
  // rather than read every byte. See RAW_TS_HOSTS.
  servesCleanBytes(url) {
    var u = url || "";
    for (var i = 0; i < RAW_TS_HOSTS.length; i++) if (u.indexOf(RAW_TS_HOSTS[i]) >= 0) return true;
    return false;
  }

  // Base URL of the unwrapping proxy, or "" when it is switched off.
  //
  // The URL is pre-filled so turning this on is a single toggle — nobody has to
  // know or type the address. The box stays editable for anyone pointing at a
  // deployed worker, and anything that is not an http(s) origin is ignored
  // rather than pasted into a stream URL.
  proxyBase() {
    var on = false;
    try { on = new SharedPreferences().get("hianime_pref_proxy_enabled"); } catch (e) {}
    if (on !== true) return "";
    var raw = "";
    try { raw = String(new SharedPreferences().get("hianime_pref_proxy_url") || "").trim(); } catch (e) {}
    if (!raw) raw = DEFAULT_PROXY;
    if (!/^https?:\/\/[^/\s]+/.test(raw)) return "";
    return raw.replace(/\/+$/, "");
  }

  // The Referer a CDN demands, which the proxy must send upstream on the
  // extension's behalf. MegaPlay-family hosts 403 without it.
  proxyRefererFor(stream) {
    var h = (stream && stream.headers) || {};
    return h["Referer"] || h["referer"] || "https://megaplay.buzz/";
  }

  // An "⟨unwrapped⟩" twin of one stream, routed through the proxy, or null when
  // the proxy is off or the stream already plays as-is.
  //
  // The proxy attaches the upstream Referer itself; forwarding ours would make
  // Mangayomi send it to the proxy instead of the CDN.
  unwrappedTwin(stream, referer) {
    var proxy = this.proxyBase();
    if (!proxy || !stream || !stream.url) return null;
    if (this.servesRawTs(stream.url)) return null;
    var mode = this.servesCleanBytes(stream.url) ? "&mode=redirect" : "";
    var twin = {};
    for (var k in stream) if (Object.prototype.hasOwnProperty.call(stream, k)) twin[k] = stream[k];
    twin.url = proxy + "/m3u8?url=" + encodeURIComponent(stream.url) +
               "&referer=" + encodeURIComponent(referer || "https://megaplay.buzz/") + mode;
    twin.originalUrl = stream.url;
    twin.quality = String(stream.quality || "") + " ⟨unwrapped⟩";
    twin.headers = { "User-Agent": this.ua };
    return twin;
  }

  // Resolve a playlist URI that may be absolute or relative to its playlist.
  resolveUrl(uri, playlistUrl) {
    if (uri.indexOf("http") === 0) return uri;
    var lastSlash = playlistUrl.lastIndexOf("/");
    var baseDir = lastSlash > 0 ? playlistUrl.substring(0, lastSlash + 1) : playlistUrl;
    return baseDir + uri;
  }

  // Download MegaPlay/VidNest subtitle tracks and inline them as SRT text.
  // The VTTs live on lostproject.club, which 403s without a megaplay.buzz Referer —
  // so a track that fails to download here must be dropped, not emitted as a URL
  // for the player to retry (the player sends no Referer and would 403 too).
  async inlineMegaplayTracks(tracks) {
    if (!Array.isArray(tracks)) return [];
    var pending = [];
    for (var t = 0; t < tracks.length; t++) {
      var track = tracks[t];
      if (!track || !track.file || track.kind === "thumbnails") continue;
      pending.push(this._inlineOneTrack(track));
    }
    var fetched = await Promise.all(pending);
    var subtitles = [];
    for (var r = 0; r < fetched.length; r++) {
      if (fetched[r]) subtitles.push(fetched[r]);
    }
    return subtitles;
  }

  async _inlineOneTrack(track) {
    try {
      var res = await this.client.get(track.file, {
        "User-Agent": this.ua,
        "Referer": "https://megaplay.buzz/",
      });
      var body = (res.body || "").trimStart();
      if (!body.startsWith("WEBVTT")) return null;
      return { file: this.vttToSrt(body), label: track.label || "Unknown" };
    } catch (e) {
      return null;
    }
  }

  // Call the MegaPlay getSources API for a known data-id and build stream list
  async fetchMegaplaySourcesById(dataId, refererUrl, audioType, audioLabel) {
    var streams = [];
    try {
      var res = await this.client.get("https://megaplay.buzz/stream/getSources?id=" + dataId, {
        "User-Agent": this.ua,
        "Referer": refererUrl,
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "application/json",
      });
      var data = JSON.parse(res.body);
      if (!data || !data.sources) return streams;
      var sourceList = Array.isArray(data.sources) ? data.sources : (data.sources.file ? [data.sources] : []);
      var subtitles = audioType === "sub" ? await this.inlineMegaplayTracks(data.tracks) : [];
      var streamHeaders = { "User-Agent": this.ua, "Referer": "https://megaplay.buzz/", "Origin": "https://megaplay.buzz" };
      for (var s = 0; s < sourceList.length; s++) {
        var src = sourceList[s];
        var fileUrl = src.file || src.url;
        if (!fileUrl) continue;
        if (fileUrl.indexOf(".m3u8") >= 0) {
          var resolved = await this.resolveHlsPlaylist(fileUrl, streamHeaders);
          if (resolved.kind === "master") {
            for (var v = 0; v < resolved.variants.length; v++) {
              streams.push({ url: resolved.variants[v].url, originalUrl: fileUrl, quality: resolved.variants[v].label + " - MegaPlay [" + audioLabel + "]", headers: streamHeaders, subtitles: subtitles });
            }
          } else if (resolved.kind === "flat") {
            streams.push({ url: fileUrl, originalUrl: fileUrl, quality: "MegaPlay [" + audioLabel + "]", headers: streamHeaders, subtitles: subtitles });
          }
        } else {
          streams.push({ url: fileUrl, originalUrl: fileUrl, quality: "MegaPlay [" + audioLabel + "]", headers: streamHeaders, subtitles: subtitles });
        }
      }
    } catch (e) {}
    return streams;
  }

  // Resolve an HLS playlist URL to one stream entry per variant.
  // Returns one of:
  //   { kind: "master", variants: [{url, label}, ...] }  — fan out to one stream per quality
  //   { kind: "flat" }                                    — already-flat playlist; caller emits URL as-is
  //   { kind: "fetch-failed" }                            — could not fetch the playlist
  //   { kind: "empty-master" }                            — master with no parseable variants
  async resolveHlsPlaylist(playlistUrl, baseHeaders) {
    var body = null;
    try {
      var hlsRes = await this.client.get(playlistUrl, baseHeaders);
      if (hlsRes && hlsRes.body) body = hlsRes.body;
    } catch (e) {}
    if (!body) return { kind: "fetch-failed" };

    var hasStreamInf = body.indexOf("#EXT-X-STREAM-INF") >= 0;
    var hasExtinf = body.indexOf("#EXTINF") >= 0;

    if (hasExtinf && !hasStreamInf) {
      return { kind: "flat" };
    }
    if (!hasStreamInf) return { kind: "empty-master" };

    // Master playlist: parse every variant.
    var variants = [];
    var lines = body.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.indexOf("#EXT-X-STREAM-INF:") !== 0) continue;
      var resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/);
      var bwMatch = line.match(/BANDWIDTH=(\d+)/);
      var resolution = resMatch ? resMatch[2] + "p" : null;
      for (var j = i + 1; j < lines.length; j++) {
        var u = lines[j].trim();
        if (!u) continue;
        if (u.charAt(0) === "#") continue;
        var variantUrl = this.resolveUrl(u, playlistUrl);
        variants.push({
          url: variantUrl,
          label: resolution || (bwMatch ? Math.round(bwMatch[1] / 1000) + "kbps" : "Auto"),
        });
        break;
      }
    }
    if (variants.length === 0) return { kind: "empty-master" };

    // Sort variants high → low so the user gets the best quality first.
    variants.sort(function(a, b) {
      var aRes = parseInt((a.label || "0").replace(/[^0-9]/g, ""), 10) || 0;
      var bRes = parseInt((b.label || "0").replace(/[^0-9]/g, ""), 10) || 0;
      return bRes - aRes;
    });

    return { kind: "master", variants: variants };
  }

  async getVideoList(url) {
    var parts = String(url).split("|");

    var pref = "sub";
    try { pref = new SharedPreferences().get("hianime_pref_audio") || "sub"; } catch (e) {}
    var audioOrder = pref === "dub" ? ["dub", "sub"] : ["sub", "dub"];

    // Episode URLs saved before v0.5.0 have the old site's 6-part shape,
    //   "{episodeId}|{hasSub}|{hasDub}|{malId}|{anilistId}|{episodeNumber}"
    // and their episode ids mean nothing here. They are still playable without a
    // Refresh, because ZokoAnime is addressed by MAL id and episode number —
    // both of which that old URL already carries. Without this an entry already
    // in the library just reports an empty video list, and Refresh is the only
    // way out (and it appends episodes rather than replacing them, so the stale
    // ones linger and keep failing).
    if (parts.length >= 6) {
      var legacyMal = parts[3] || "";
      var legacyEp = parts[5] || "";
      if (legacyMal && legacyEp) {
        var legacy = [];
        for (var la = 0; la < audioOrder.length; la++) {
          var embed = "https://zokoanime.video/stream/mal/" + legacyMal + "/" + legacyEp + "/" + audioOrder[la];
          var got = await this.extractZokoStreams(embed, audioOrder[la] === "dub" ? "Dub" : "Sub");
          legacy = legacy.concat(got);
        }
        if (legacy.length) return this.normalizeSubtitles(legacy);
      }
      return [];
    }

    // Current shape: "{episodeId}|{animeId}|{episodeNumber}"
    var episodeId = parts[0];
    if (!episodeId || !/^\d+$/.test(episodeId)) return [];

    var servers = await this.fetchServers(episodeId);
    if (!servers.length) return [];

    // ZokoAnime leads: it is the only server whose segments are real MPEG-TS at
    // real .ts URLs, so it plays untouched everywhere. Everything else is
    // MegaPlay-family and needs the unwrap proxy on Windows/Android, so those
    // are resolved only as a fallback — see the "Servers" preference.
    var wanted = "zoko";
    try { wanted = new SharedPreferences().get("hianime_pref_servers") || "zoko"; } catch (e) {}
    var isZoko = function (sv) { return /zoko/i.test(sv.name) || /zokoanime/i.test(sv.url); };

    var zoko = [], rest = [];
    for (var i = 0; i < servers.length; i++) (isZoko(servers[i]) ? zoko : rest).push(servers[i]);

    var label = function (t) { return t === "dub" ? "Dub" : "Sub"; };

    var runZoko = async () => {
      var out = [];
      for (var a = 0; a < audioOrder.length; a++) {
        for (var i = 0; i < zoko.length; i++) {
          if (zoko[i].type !== audioOrder[a]) continue;
          var got = await this.extractZokoStreams(zoko[i].url, label(audioOrder[a]));
          out = out.concat(got);
        }
      }
      return out;
    };

    // MegaPlay embeds reached through the same server list. These are the
    // PNG-wrapped ones; they are kept because ZokoAnime does not carry every
    // title, and an episode that plays on a disguised CDN beats one that does
    // not play at all.
    var runRest = async () => {
      var out = [];
      for (var a = 0; a < audioOrder.length; a++) {
        for (var i = 0; i < rest.length; i++) {
          var sv = rest[i];
          if (sv.type !== audioOrder[a]) continue;
          if (!/megaplay|vidtube|vidnest/i.test(sv.url)) continue;
          try {
            var got = await this.extractMegaplayFromPageUrl(
              sv.url, this.source.baseUrl + "/", audioOrder[a],
              sv.name + " [" + label(audioOrder[a]) + "]"
            );
            out = out.concat(got || []);
          } catch (e) {}
        }
      }
      return out;
    };

    var streams = await runZoko();
    if (wanted === "all" || streams.length === 0) {
      streams = streams.concat(await runRest());
    }

    // Anything that needs the proxy gets an "⟨unwrapped⟩" twin ahead of it when
    // the viewer has one running; ZokoAnime never does, so this is a no-op for
    // the common case and only rescues the MegaPlay fallback.
    var playsAsIs = [], disguised = [];
    for (var k = 0; k < streams.length; k++) {
      if (this.servesRawTs(streams[k].url)) playsAsIs.push(streams[k]);
      else disguised.push(streams[k]);
    }
    var twins = [];
    for (var t = 0; t < disguised.length; t++) {
      var twin = this.unwrappedTwin(disguised[t], this.proxyRefererFor(disguised[t]));
      if (twin) twins.push(twin);
    }

    return this.normalizeSubtitles(playsAsIs.concat(twins, disguised));
  }

  // Make English turn on by itself.
  //
  // The player only auto-selects from the *first* video in this list, and picks
  // with `subtitles.firstWhere(sub => sub.label == <app's default subtitle
  // language>, orElse: subtitles.first)`. So two things decide the outcome, and
  // neither is a flag: the English track has to be labelled exactly "English"
  // for the match to hit, and it has to be first so the fallback lands on it
  // too. Mangayomi's Track model carries only `file` and `label`, so a
  // `default: true` property would be dropped on the way in.
  //
  // Providers label the same track inconsistently ("English", "eng-2",
  // "English (US)"), hence the relabelling rather than a plain sort.
  normalizeSubtitles(streams) {
    var hasUrl = function(subs) {
      return subs && subs.length && /^https?:\/\//.test(String(subs[0].file));
    };
    // Prefer a set backed by real URLs — those are the ones proven to load.
    var shared = null;
    for (var i = 0; i < streams.length; i++) {
      if (hasUrl(streams[i].subtitles)) { shared = this.englishFirst(streams[i].subtitles); break; }
    }
    for (var j = 0; j < streams.length; j++) {
      var s = streams[j];
      // Dub streams carry no subtitles by design; leave them alone.
      if (s.quality.indexOf("[Dub]") >= 0) continue;
      if (shared && !hasUrl(s.subtitles)) s.subtitles = shared;
      else s.subtitles = this.englishFirst(s.subtitles);
    }
    return streams;
  }

  // Put the English track first and give it the exact label the player matches on.
  englishFirst(subs) {
    if (!subs || !subs.length) return subs || [];
    var english = [], other = [];
    for (var i = 0; i < subs.length; i++) {
      var label = String(subs[i].label || "");
      // "English", "eng-2", "English (US)" — but not "Englishsub"-style dub tags,
      // and not the romance languages that merely contain "es"/"en" substrings.
      if (/^(eng|english)\b|^eng-|\benglish\b/i.test(label)) {
        english.push({ file: subs[i].file, label: "English" });
      } else {
        other.push(subs[i]);
      }
    }
    return english.concat(other);
  }

  getFilterList() {
    return [];
  }

  getSourcePreferences() {
    return [
      {
        key: "hianime_pref_audio",
        listPreference: {
          title: "Preferred audio",
          summary: "Which audio track appears first for streaming and downloads",
          valueIndex: 0,
          entries: ["Sub", "Dub"],
          entryValues: ["sub", "dub"],
        },
      },
      {
        key: "hianime_pref_proxy_enabled",
        checkBoxPreference: {
          title: "Fix playback on Windows/Android",
          summary: "Only affects the fallback servers. ZokoAnime, the default, plays everywhere untouched — leave this off unless a title has no ZokoAnime copy and the MegaPlay fallback buffers forever. Requires the proxy to be reachable at the address below.",
          value: false,
        },
      },
      {
        key: "hianime_pref_proxy_url",
        editTextPreference: {
          title: "Proxy address (advanced)",
          summary: "Already filled in — only change this if you run the proxy somewhere other than this PC.",
          value: DEFAULT_PROXY,
          dialogTitle: "Proxy address",
          dialogMessage: "HiAnime's CDNs hide video inside PNG images, which Windows/Android cannot decode (iOS plays them fine). The default points at proxy/proxy.js running on this PC. Replace it with a deployed worker's https URL to cover several devices from one place.",
        },
      },
      {
        key: "hianime_pref_servers",
        listPreference: {
          title: "Servers",
          summary: "ZokoAnime only, by default: it is the one server whose segments are real " +
            "MPEG-TS, so it plays on Windows and Android with nothing else switched on. The " +
            "others disguise video as PNG images and need the unwrap proxy below. They are " +
            "tried anyway when a title has no ZokoAnime copy, whichever option is picked here.",
          valueIndex: 0,
          entries: ["ZokoAnime only (recommended)", "All servers"],
          entryValues: ["zoko", "all"],
        },
      },
    ];
  }
}
