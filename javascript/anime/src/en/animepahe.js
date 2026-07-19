const mangayomiSources = [
  {
    "name": "AnimePahe",
    "id": 728456139,
    "lang": "en",
    "baseUrl": "https://animepahe.ch",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://animepahe.ch",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.3.1",
    "pkgPath": "anime/src/en/animepahe.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": false,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/animepahe.js",
    "dateFormat": "",
    "dateFormatLocale": "",
    "additionalParams": "",
    "sourceCodeLanguage": 1,
    "notes": "",
  },
];

// animepahe.ch — WordPress site on the Themesia AnimeStream theme.
// Series list: /series/?page=N&order=popular|update (article.bs cards).
// Search: /?s=q (page 2+ is /page/N/?s=q). Detail: /series/{slug}/ with
// .eplister episode list. Episode posts embed a MegaPlay player
// (megaplay.buzz/stream/s-2/{id}/{sub|dub}) — same extractor as HiAnime.
// The player may be an inline <iframe>, a lazy-loaded data-src, or one of the
// base64-encoded options in the "mirror" server switcher (getVideoList scans
// all three so titles that default to a non-MegaPlay server still resolve).
class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client({ timeout: 12 });
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

  // Parse article.bs cards on list/search pages
  parseList(doc) {
    var list = [];
    var items = doc.select("article.bs");
    for (var i = 0; i < items.length; i++) {
      var anchor = items[i].selectFirst(".bsx a");
      if (!anchor) continue;
      var link = anchor.attr("href") || "";
      var name = (anchor.attr("title") || "").trim();
      if (!name) {
        var tt = items[i].selectFirst(".tt");
        if (tt) name = tt.text.trim();
      }
      var img = items[i].selectFirst("img");
      var imageUrl = "";
      if (img) imageUrl = img.attr("data-src") || img.attr("src") || "";
      if (name && link) list.push({ name: name, imageUrl: imageUrl, link: link });
    }
    return list;
  }

  hasNextPage(doc, html, listLength) {
    // Series listing uses .hpage with a "Next" anchor (class r)
    var next = doc.selectFirst(".hpage a.r");
    if (next) return true;
    // WP search pagination
    if (html && html.indexOf('class="next page-numbers"') >= 0) return true;
    if (doc.selectFirst("a.next")) return true;
    // Full listing pages carry 30 cards; search pages 10
    return (listLength || 0) >= 10;
  }

  get supportsLatest() {
    return true;
  }

  async getPopular(page) {
    try {
      var p = await this.fetchPage("/series/?page=" + page + "&order=popular");
      var list = this.parseList(p.doc);
      return { list: list, hasNextPage: this.hasNextPage(p.doc, p.html, list.length) };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    try {
      var p = await this.fetchPage("/series/?page=" + page + "&order=update");
      var list = this.parseList(p.doc);
      return { list: list, hasNextPage: this.hasNextPage(p.doc, p.html, list.length) };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    try {
      var path = page > 1
        ? "/page/" + page + "/?s=" + encodeURIComponent(query)
        : "/?s=" + encodeURIComponent(query);
      var p = await this.fetchPage(path);
      var list = this.parseList(p.doc);
      return { list: list, hasNextPage: this.hasNextPage(p.doc, p.html, list.length) };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  statusCode(status) {
    var s = (status || "").toLowerCase();
    if (s.includes("completed") || s.includes("finished")) return 1;
    if (s.includes("upcoming") || s.includes("not yet")) return 4;
    if (s.includes("ongoing") || s.includes("airing") || s.includes("releasing")) return 0;
    if (s.includes("hiatus")) return 2;
    return 5;
  }

  // "March 25, 2026" -> epoch millis string (QuickJS Date.parse is unreliable
  // for this format, so parse by hand)
  parseDate(text) {
    try {
      var m = (text || "").trim().match(/^(\w+)\s+(\d{1,2}),\s*(\d{4})$/);
      if (!m) return null;
      var months = { january:0, february:1, march:2, april:3, may:4, june:5,
        july:6, august:7, september:8, october:9, november:10, december:11 };
      var mo = months[m[1].toLowerCase()];
      if (mo === undefined) return null;
      return String(new Date(parseInt(m[3], 10), mo, parseInt(m[2], 10)).getTime());
    } catch (e) {
      return null;
    }
  }

  async getDetail(url) {
    var res = await this.client.get(url, this.headers);
    var html = res.body;
    var doc = new Document(html);

    var name = "";
    var nameEl = doc.selectFirst("h1.entry-title");
    if (nameEl) name = nameEl.text.trim();

    var imageUrl = "";
    var ogImage = doc.selectFirst("meta[property='og:image']");
    if (ogImage) imageUrl = ogImage.attr("content") || "";
    if (!imageUrl) {
      var thumbImg = doc.selectFirst(".thumb img, img.ts-post-image");
      if (thumbImg) imageUrl = thumbImg.attr("data-src") || thumbImg.attr("src") || "";
    }

    var description = "";
    var descEl = doc.selectFirst(".entry-content[itemprop='description'], .entry-content");
    if (descEl) description = descEl.text.trim();

    var genre = [];
    var genreEls = doc.select(".genxed a");
    for (var i = 0; i < genreEls.length; i++) {
      var g = genreEls[i].text.trim();
      if (g) genre.push(g);
    }

    var status = 5;
    var statusMatch = html.match(/Status:<\/b>\s*([A-Za-z ]+)/);
    if (statusMatch) status = this.statusCode(statusMatch[1]);

    var chapters = [];
    var epEls = doc.select(".eplister ul li a");
    for (var j = 0; j < epEls.length; j++) {
      var ep = epEls[j];
      var href = ep.attr("href");
      if (!href) continue;
      var numEl = ep.selectFirst(".epl-num");
      var epNum = numEl ? numEl.text.trim() : "";
      var label = epNum ? "Episode " + epNum : "Episode " + (epEls.length - j);
      var dateEl = ep.selectFirst(".epl-date");
      var dateUpload = dateEl ? this.parseDate(dateEl.text) : null;
      chapters.push({ name: label, url: href, dateUpload: dateUpload });
    }
    // .eplister is already newest-first, which matches Mangayomi's convention

    return {
      name: name,
      imageUrl: imageUrl,
      description: description,
      genre: genre,
      status: status,
      link: url,
      chapters: chapters,
    };
  }

  // Fetch a MegaPlay embed URL, pull the player data-id, then call getSources.
  async extractMegaplayFromPageUrl(pageUrl, referer) {
    try {
      var res = await this.client.get(pageUrl, { "User-Agent": this.ua, "Referer": referer });
      if (!res || !res.body) return [];
      var m = res.body.match(/id="megaplay-player"[\s\S]*?data-id="(\d+)"/);
      if (m) return await this.fetchMegaplaySourcesById(m[1], pageUrl);
    } catch (e) {}
    return [];
  }

  // Origin ("https://host") of a URL, defaulting to megaplay.buzz.
  originOf(u) {
    var m = String(u || "").match(/^(https?:\/\/[^/]+)/);
    return m ? m[1] : "https://megaplay.buzz";
  }

  async fetchMegaplaySourcesById(dataId, refererUrl) {
    var streams = [];
    try {
      // Derive the MegaPlay origin from the embed URL so a rotated domain
      // (megaplay.buzz -> megaplay.<tld>) still resolves against the right host.
      var origin = this.originOf(refererUrl);
      var res = await this.client.get(origin + "/stream/getSources?id=" + dataId, {
        "User-Agent": this.ua,
        "Referer": refererUrl,
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "application/json",
      });
      var data = JSON.parse(res.body);
      if (!data || !data.sources) return streams;
      var sourceList = Array.isArray(data.sources) ? data.sources : (data.sources.file ? [data.sources] : []);
      var subtitles = [];
      if (Array.isArray(data.tracks)) {
        for (var t = 0; t < data.tracks.length; t++) {
          var track = data.tracks[t];
          if (track && track.file && track.kind !== "thumbnails") {
            subtitles.push({ file: track.file, label: track.label || "Unknown" });
          }
        }
      }
      var streamHeaders = { "User-Agent": this.ua, "Referer": origin + "/", "Origin": origin };
      for (var s = 0; s < sourceList.length; s++) {
        var src = sourceList[s];
        var fileUrl = src.file || src.url;
        if (!fileUrl) continue;
        if (fileUrl.indexOf(".m3u8") >= 0) {
          var resolved = await this.resolveHlsPlaylist(fileUrl, streamHeaders);
          if (resolved.kind === "master") {
            for (var v = 0; v < resolved.variants.length; v++) {
              streams.push({ url: resolved.variants[v].url, originalUrl: fileUrl, quality: resolved.variants[v].label + " - MegaPlay", headers: streamHeaders, subtitles: subtitles });
            }
          } else if (resolved.kind === "flat") {
            streams.push({ url: fileUrl, originalUrl: fileUrl, quality: "MegaPlay", headers: streamHeaders, subtitles: subtitles });
          }
        } else {
          streams.push({ url: fileUrl, originalUrl: fileUrl, quality: "MegaPlay", headers: streamHeaders, subtitles: subtitles });
        }
      }
    } catch (e) {}
    return streams;
  }

  // Resolve an HLS playlist URL to one stream entry per variant (same approach
  // as hianime.js — resolving to absolute variant URLs avoids Mangayomi's
  // cross-domain Referer propagation failure on master playlists).
  async resolveHlsPlaylist(playlistUrl, baseHeaders) {
    var body = null;
    try {
      var hlsRes = await this.client.get(playlistUrl, baseHeaders);
      if (hlsRes && hlsRes.body) body = hlsRes.body;
    } catch (e) {}
    if (!body) return { kind: "fetch-failed" };

    var hasStreamInf = body.indexOf("#EXT-X-STREAM-INF") >= 0;
    var hasExtinf = body.indexOf("#EXTINF") >= 0;

    if (hasExtinf && !hasStreamInf) return { kind: "flat" };
    if (!hasStreamInf) return { kind: "empty-master" };

    var lastSlash = playlistUrl.lastIndexOf("/");
    var baseDir = lastSlash > 0 ? playlistUrl.substring(0, lastSlash + 1) : playlistUrl;
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
        var variantUrl = u.indexOf("http") === 0 ? u : baseDir + u;
        variants.push({
          url: variantUrl,
          label: resolution || (bwMatch ? Math.round(bwMatch[1] / 1000) + "kbps" : "Auto"),
        });
        break;
      }
    }
    if (variants.length === 0) return { kind: "empty-master" };

    variants.sort(function(a, b) {
      var aRes = parseInt((a.label || "0").replace(/[^0-9]/g, ""), 10) || 0;
      var bRes = parseInt((b.label || "0").replace(/[^0-9]/g, ""), 10) || 0;
      return bRes - aRes;
    });
    return { kind: "master", variants: variants };
  }

  // Pure-JS base64 decoder — atob() is not available in Mangayomi's QuickJS
  // runtime. Used to decode AnimeStream "mirror" server options.
  _b64decode(s) {
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var output = "";
    s = String(s).replace(/[^A-Za-z0-9+/]/g, "");
    for (var i = 0; i < s.length; i += 4) {
      var c0 = chars.indexOf(s.charAt(i));
      var c1 = chars.indexOf(s.charAt(i + 1));
      var c2 = chars.indexOf(s.charAt(i + 2));
      var c3 = chars.indexOf(s.charAt(i + 3));
      var n = (c0 << 18) | (c1 << 12) | ((c2 & 0x3f) << 6) | (c3 & 0x3f);
      output += String.fromCharCode((n >> 16) & 0xff);
      if (c2 !== -1) output += String.fromCharCode((n >> 8) & 0xff);
      if (c3 !== -1) output += String.fromCharCode(n & 0xff);
    }
    return output;
  }

  // Collect every MegaPlay stream-embed URL referenced by an episode page.
  // The AnimeStream theme only renders one server inline (as an <iframe>);
  // the rest live as base64-encoded values in the "mirror" server switcher.
  // For some titles the inline default is a non-MegaPlay server, so scanning
  // only the raw iframe missed the MegaPlay embed entirely (empty video list).
  collectMegaplayEmbeds(html) {
    var seen = {};
    var out = [];
    // Match MegaPlay embeds regardless of quoting, attribute (src / data-src),
    // or a rotated megaplay.<tld> domain.
    var urlRe = /(?:https?:)?\/\/(?:www\.)?megaplay\.[a-z0-9.-]+\/stream\/[^"'\\\s<>)]+/gi;
    var add = function (u) {
      if (!u) return;
      u = u.replace(/&amp;/g, "&");
      if (u.indexOf("//") === 0) u = "https:" + u;
      if (u.indexOf("http") !== 0) return;
      if (u.indexOf("/getSources") >= 0) return; // AJAX endpoint, not an embed
      if (seen[u]) return;
      seen[u] = true;
      out.push(u);
    };
    var m;
    while ((m = urlRe.exec(html)) !== null) add(m[0]);
    // Server switcher options carry base64-encoded embed markup. Decode each
    // candidate and pull any MegaPlay URLs out of the decoded HTML.
    var b64Re = /(?:value|data-em|data-embed)="([A-Za-z0-9+/=]{24,})"/g;
    while ((m = b64Re.exec(html)) !== null) {
      var decoded = "";
      try { decoded = this._b64decode(m[1]); } catch (e) {}
      if (!decoded || decoded.indexOf("megaplay") < 0) continue;
      var im;
      urlRe.lastIndex = 0;
      while ((im = urlRe.exec(decoded)) !== null) add(im[0]);
    }
    return out;
  }

  async getVideoList(url) {
    // url is the episode post URL; the page embeds one or more MegaPlay players.
    var res = await this.client.get(url, this.headers);
    if (!res || !res.body) return [];
    var embeds = this.collectMegaplayEmbeds(res.body);
    var streams = [];
    for (var i = 0; i < embeds.length; i++) {
      var s = await this.extractMegaplayFromPageUrl(embeds[i], url);
      streams = streams.concat(s);
    }
    return streams;
  }

  getFilterList() {
    return [];
  }

  getSourcePreferences() {
    return [];
  }
}
