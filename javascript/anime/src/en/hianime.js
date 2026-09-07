const mangayomiSources = [
  {
    "name": "HiAnime",
    "id": 1183439094,
    "lang": "en",
    "baseUrl": "https://hianime.at",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://hianime.at",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.7.0",
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

// ZokoAnime hides its player payload in `window.__P`: base64 of the JSON XORed
// with this literal repeating key. Straight out of the site's own
// zokoanime1.pages.dev/core/obfuscate.js — there is no server-side secret and no
// session, which is why this server is reachable from an extension at all.
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
      var f = this.buildFilterQuery(filters);
      var parts = [];
      if (query) parts.push("keyword=" + encodeURIComponent(query));
      if (f.query) parts.push(f.query);
      parts.push("page=" + page);
      var p = await this.fetchPage(f.path + "?" + parts.join("&"));
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

  // Resolve a playlist URI that may be absolute or relative to its playlist.
  resolveUrl(uri, playlistUrl) {
    if (uri.indexOf("http") === 0) return uri;
    var lastSlash = playlistUrl.lastIndexOf("/");
    var baseDir = lastSlash > 0 ? playlistUrl.substring(0, lastSlash + 1) : playlistUrl;
    return baseDir + uri;
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

    // ZokoAnime only.
    //
    // It is the sole server whose segments are real MPEG-TS at real .ts URLs, so
    // it plays and downloads untouched. Every other server this site lists is
    // MegaPlay-family: video disguised as PNG images, undecodable by libmpv
    // without a local unwrap proxy. Those used to be offered as a fallback, but
    // an entry nobody can play is not a fallback — it is a dead line in the
    // quality picker — so they are no longer resolved at all.
    var isZoko = function (sv) { return /zoko/i.test(sv.name) || /zokoanime/i.test(sv.url); };
    var label = function (t) { return t === "dub" ? "Dub" : "Sub"; };

    var streams = [];
    for (var a = 0; a < audioOrder.length; a++) {
      for (var i = 0; i < servers.length; i++) {
        if (!isZoko(servers[i]) || servers[i].type !== audioOrder[a]) continue;
        var got = await this.extractZokoStreams(servers[i].url, label(audioOrder[a]));
        streams = streams.concat(got);
      }
    }

    return this.normalizeSubtitles(streams);
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

  // ── Filters ───────────────────────────────────────────────────────────────
  //
  // Everything routes through /filter, which accepts the same `keyword` the
  // search box uses, so a text query and the filters below combine freely.
  //
  // Genre is the exception: the site has no genre field on the filter form and
  // ignores a `genres=` query parameter entirely (measured — results come back
  // identical to no filter at all). Genres live at their own /genres/<slug>
  // pages, which *do* honour the other filter parameters, so picking a genre
  // just swaps the base path and keeps every other choice working.
  filterDefs() {
    var genres = [
      ["Action", "action"], ["Adult Cast", "adult-cast"], ["Adventure", "adventure"],
      ["Animation", "animation"], ["Anthropomorphic", "anthropomorphic"], ["Avant Garde", "avant-garde"],
      ["Award Winning", "award-winning"], ["Boys Love", "boys-love"], ["Cars", "cars"],
      ["CGDCT", "cgdct"], ["Childcare", "childcare"], ["Combat Sports", "combat-sports"],
      ["Comedy", "comedy"], ["Crossdressing", "crossdressing"], ["Delinquents", "delinquents"],
      ["Dementia", "dementia"], ["Demons", "demons"], ["Detective", "detective"],
      ["Drama", "drama"], ["Ecchi", "ecchi"], ["Educational", "educational"],
      ["Erotica", "erotica"], ["Fantasy", "fantasy"], ["Gag Humor", "gag-humor"],
      ["Game", "game"], ["Girls Love", "girls-love"], ["Gore", "gore"],
      ["Gourmet", "gourmet"], ["Harem", "harem"], ["Hentai", "hentai"],
      ["High Stakes Game", "high-stakes-game"], ["Historical", "historical"], ["Horror", "horror"],
      ["Idols (Female)", "idols-female"], ["Idols (Male)", "idols-male"], ["Isekai", "isekai"],
      ["Iyashikei", "iyashikei"], ["Josei", "josei"], ["Kids", "kids"],
      ["Love Polygon", "love-polygon"], ["Magic", "magic"], ["Magical Sex Shift", "magical-sex-shift"],
      ["Mahou Shoujo", "mahou-shoujo"], ["Martial Arts", "martial-arts"], ["Mecha", "mecha"],
      ["Medical", "medical"], ["Military", "military"], ["Music", "music"],
      ["Mystery", "mystery"], ["Mythology", "mythology"], ["Organized Crime", "organized-crime"],
      ["Otaku Culture", "otaku-culture"], ["Parody", "parody"], ["Performing Arts", "performing-arts"],
      ["Pets", "pets"], ["Police", "police"], ["Psychological", "psychological"],
      ["Racing", "racing"], ["Reincarnation", "reincarnation"], ["Reverse Harem", "reverse-harem"],
      ["Romance", "romance"], ["Samurai", "samurai"], ["School", "school"],
      ["Sci-Fi", "sci-fi"], ["Seinen", "seinen"], ["Shoujo", "shoujo"],
      ["Shoujo Ai", "shoujo-ai"], ["Shounen", "shounen"], ["Shounen Ai", "shounen-ai"],
      ["Showbiz", "showbiz"], ["Slice of Life", "slice-of-life"], ["Space", "space"],
      ["Sports", "sports"], ["Strategy Game", "strategy-game"], ["Super Power", "super-power"],
      ["Supernatural", "supernatural"], ["Survival", "survival"], ["Suspense", "suspense"],
      ["Team Sports", "team-sports"], ["Thriller", "thriller"], ["Time Travel", "time-travel"],
      ["Urban Fantasy", "urban-fantasy"], ["Vampire", "vampire"], ["Video Game", "video-game"],
      ["Villainess", "villainess"], ["Visual Arts", "visual-arts"], ["Workplace", "workplace"],
    ];

    var years = [
      ["2027", "2027"], ["2026", "2026"], ["2025", "2025"], ["2024", "2024"], ["2023", "2023"], ["2022", "2022"], ["2021", "2021"], ["2020", "2020"], ["2019", "2019"], ["2018", "2018"],
      ["2017", "2017"], ["2016", "2016"], ["2015", "2015"], ["2014", "2014"], ["2013", "2013"], ["2012", "2012"], ["2011", "2011"], ["2010", "2010"], ["2009", "2009"], ["2008", "2008"],
      ["2007", "2007"], ["2006", "2006"], ["2005", "2005"], ["2004", "2004"], ["2003", "2003"], ["2002", "2002"], ["2001", "2001"], ["2000", "2000"], ["1999", "1999"], ["1998", "1998"],
      ["1997", "1997"], ["1996", "1996"], ["1995", "1995"], ["1994", "1994"], ["1993", "1993"], ["1992", "1992"], ["1991", "1991"], ["1990", "1990"], ["1989", "1989"], ["1988", "1988"],
      ["1987", "1987"], ["1986", "1986"], ["1985", "1985"], ["1984", "1984"], ["1983", "1983"], ["1982", "1982"], ["1981", "1981"], ["1980", "1980"], ["1979", "1979"], ["1978", "1978"],
      ["1977", "1977"], ["1976", "1976"], ["1975", "1975"], ["1974", "1974"], ["1973", "1973"], ["1972", "1972"], ["1971", "1971"], ["1970", "1970"], ["1969", "1969"], ["1968", "1968"],
      ["1967", "1967"], ["1966", "1966"], ["1965", "1965"], ["1964", "1964"], ["1963", "1963"], ["1962", "1962"], ["1961", "1961"], ["1960", "1960"],
    ];

    return [
      { param: "__genre", name: "Genre", options: genres },
      { param: "type", name: "Type", options: [
        ["TV", "tv"], ["Movie", "movie"], ["OVA", "ova"], ["ONA", "ona"],
        ["Special", "special"], ["Music", "music"],
      ] },
      { param: "status", name: "Status", options: [
        ["Finished Airing", "completed"], ["Currently Airing", "airing"],
        ["Not Yet Aired", "not_yet_aired"],
      ] },
      { param: "season", name: "Season", options: [
        ["Spring", "spring"], ["Summer", "summer"], ["Fall", "fall"], ["Winter", "winter"],
      ] },
      { param: "sy", name: "Year", options: years },
      { param: "rating", name: "Rating", options: [
        ["G", "g"], ["PG", "pg"], ["PG-13", "pg_13"], ["R", "r_17"], ["R+", "r_plus"], ["Rx", "rx"],
      ] },
      { param: "score", name: "Minimum score", options: [
        ["(10) Masterpiece", "10"], ["(9) Great", "9"], ["(8) Very Good", "8"],
        ["(7) Good", "7"], ["(6) Fine", "6"], ["(5) Average", "5"],
        ["(4) Bad", "4"], ["(3) Very Bad", "3"], ["(2) Horrible", "2"], ["(1) Appalling", "1"],
      ] },
      { param: "sort", name: "Sort by", options: [
        ["Recently Updated", "updated_date"], ["Recently Added", "added_date"],
        ["Release Date", "release_date"], ["Trending", "trending"],
        ["Name A-Z", "title_az"], ["Score", "avg_score"], ["MAL Score", "mal_score"],
        ["Most Watched", "most_watched"], ["Most Favourited", "most_favourited"],
        ["Number of Episodes", "number_of_episodes"],
      ] },
    ];
  }

  getFilterList() {
    return this.filterDefs().map(function (def) {
      return {
        type_name: "SelectFilter",
        name: def.name,
        state: 0,
        values: [{ type_name: "SelectOption", name: "Any", value: "" }].concat(
          def.options.map(function (o) {
            return { type_name: "SelectOption", name: o[0], value: o[1] };
          })
        ),
      };
    });
  }

  // Mangayomi hands filters back as a positional array matching getFilterList's
  // order, with no names attached — so this must walk filterDefs() in the same
  // order rather than looking anything up by name.
  buildFilterQuery(filters) {
    var path = "/filter", parts = [];
    try {
      var defs = this.filterDefs();
      for (var i = 0; i < defs.length; i++) {
        var f = (filters || [])[i];
        if (!f) continue;
        var opt = (f.values || [])[f.state || 0];
        if (!opt || !opt.value) continue;
        if (defs[i].param === "__genre") path = "/genres/" + opt.value;
        else parts.push(defs[i].param + "=" + encodeURIComponent(opt.value));
      }
    } catch (e) {}
    return { path: path, query: parts.join("&") };
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
    ];
  }
}
