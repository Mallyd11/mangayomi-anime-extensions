const mangayomiSources = [
  {
    "name": "AniKoto",
    "id": 1356478902,
    "lang": "en",
    "baseUrl": "https://anikototv.to",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://anikototv.to",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.4.18",
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
      if (!m3u8) return streams;
      if (this._alreadyResolved(m3u8)) return streams; // another server, same file
      var hdrs = { "User-Agent": this.ua, "Referer": apiHost + "/" };
      var subtitles = await this._trackSubtitles(srcData.tracks, apiHost + "/");
      var variants = await this._resolveHlsVariants(m3u8, hdrs, isExtra);
      if (variants === null) return streams; // CDN blocked (Cloudflare) — skip this server
      if (variants.length > 0) {
        for (var v = 0; v < variants.length; v++) {
          streams.push({ url: variants[v].url, originalUrl: m3u8, quality: variants[v].label + " - " + audioLabel, headers: hdrs, subtitles: subtitles });
        }
      } else {
        streams.push({ url: m3u8, originalUrl: m3u8, quality: audioLabel, headers: hdrs, subtitles: subtitles });
      }
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
      if (!m3u8) return streams;
      if (this._alreadyResolved(m3u8)) return streams; // another server, same file
      var subtitles = await this._trackSubtitles(srcData.tracks, "https://vidtube.site/");
      var hdrs = { "User-Agent": this.ua, "Referer": "https://vidtube.site/" };
      var variants = await this._resolveHlsVariants(m3u8, hdrs, isExtra);
      if (variants === null) return streams; // CDN blocked (Cloudflare) — skip this server
      if (variants.length > 0) {
        for (var v = 0; v < variants.length; v++) {
          streams.push({ url: variants[v].url, originalUrl: m3u8, quality: variants[v].label + " - " + audioLabel, headers: hdrs, subtitles: subtitles });
        }
      } else {
        streams.push({ url: m3u8, originalUrl: m3u8, quality: audioLabel, headers: hdrs, subtitles: subtitles });
      }
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

  // Fetch a master HLS playlist and return one entry per quality variant.
  // Returns [] if the URL is a flat media playlist (no #EXT-X-STREAM-INF, use as-is).
  // Returns null if the response is not a valid m3u8 (Cloudflare block, error, or fetch failure).
  // nekostream.site streams are routed through the shirayuki proxy, which strips the
  // 70-byte PNG wrapper from every segment and serves clean MPEG-TS to libmpv.
  async _resolveHlsVariants(masterUrl, headers, isExtra) {
    var isNeko = this._isWrappedCdnUrl(masterUrl);
    // Streams whose playlist Referer is megaplay.buzz come from the same CDN
    // family regardless of hostname rotation — proxy them unconditionally.
    if (!isNeko) {
      var ref = (headers["Referer"] || headers["referer"] || "");
      if (ref.indexOf("megaplay.buzz") >= 0 || ref.indexOf("vidnest.fun") >= 0) isNeko = true;
    }
    try {
      var res = await this.client.get(masterUrl, headers);
      var body = res.body || "";
      if (body.indexOf("#EXTM3U") < 0) return null; // not a valid m3u8 (blocked or error)
      if (body.indexOf("#EXT-X-STREAM-INF") < 0) {
        // Flat media playlist — also detect by extension-less URL (CDN rotation).
        if (!isNeko) {
          var masterPath = (masterUrl || "").split("?")[0];
          var masterLast = masterPath.split("/").pop();
          if (masterLast && masterLast.indexOf(".") === -1) isNeko = true;
        }
        if (isNeko) {
          return [{ url: masterUrl, label: "Auto" }];
        }
        if (this._playlistIsPoisoned(body, masterUrl)) {
          return [{ url: this._rewriteWithByterange(body), label: "Auto" }];
        }
        return []; // use master URL as-is
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

      // Fallback: extension-less variant URL is the other signature of CDNs whose
      // segments libmpv rejects (extension_picky), regardless of hostname.
      if (!isNeko && variants.length > 0) {
        var samplePath = variants[0].url.split("?")[0];
        var lastPart = samplePath.split("/").pop();
        if (lastPart && lastPart.indexOf(".") === -1) isNeko = true;
      }

      if (isNeko) {
        // nekostream-family CDN: extension-less segment URLs + PNG-wrapped TS.
        // Return the variants directly — iOS plays fine; Windows skips (known limitation).
        return variants;
      }

      // Not nekostream: check the top variant for ad-injected segments. Only for
      // the server that leads the picker — the probe downloads a full media
      // playlist, which cost 3s per alternate on a slow origin, and a poisoned
      // alternate is a bad entry the viewer can simply skip past, not a stream
      // that plays on its own.
      if (variants.length > 0 && !isExtra) {
        try {
          var probe = await this.client.get(variants[0].url, headers);
          var probeBody = probe.body || "";
          if (probeBody.indexOf("#EXTM3U") >= 0 && this._playlistIsPoisoned(probeBody, variants[0].url)) {
            return [{ url: this._rewriteWithByterange(probeBody), label: variants[0].label }];
          }
        } catch (e) {} // probe failure is not proof of poisoning — let it through
      }
      return variants;
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
