const mangayomiSources = [
  {
    "name": "AniKoto",
    "id": 1356478902,
    "lang": "en",
    "baseUrl": "https://anikototv.to",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://anikototv.to",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.4.0",
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

  // Resolve a server linkId → embed URL → array of playable streams.
  async _resolveStreams(linkId, audioLabel) {
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
      return await this._extractGetSourcesStreams(embedUrl, gsM[1], audioLabel);
    }
    if (embedUrl.indexOf("vidtube.site/stream/") >= 0) {
      return await this._extractVidtubeStreams(embedUrl, audioLabel);
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

  // Extract streams via {host}/stream/getSources?id={streamId} (megaplay, vidwish, etc.)
  async _extractGetSourcesStreams(embedUrl, streamId, audioLabel) {
    var streams = [];
    try {
      var hostM = embedUrl.match(/^(https?:\/\/[^/]+)/);
      if (!hostM) return streams;
      var apiHost = hostM[1];
      var srcRes = await this.client.get(
        apiHost + "/stream/getSources?id=" + streamId,
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
      var subtitles = [];
      if (Array.isArray(srcData.tracks)) {
        for (var ti = 0; ti < srcData.tracks.length; ti++) {
          var track = srcData.tracks[ti];
          if (track && track.file && track.kind !== "thumbnails") subtitles.push({ file: track.file, label: track.label || "Unknown" });
        }
      }
      var hdrs = { "User-Agent": this.ua, "Referer": apiHost + "/" };
      var variants = await this._resolveHlsVariants(m3u8, hdrs);
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
  async _extractVidtubeStreams(embedUrl, audioLabel) {
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

      var subtitles = [];
      if (Array.isArray(srcData.tracks)) {
        for (var ti = 0; ti < srcData.tracks.length; ti++) {
          var track = srcData.tracks[ti];
          if (track && track.file && track.kind !== "thumbnails") subtitles.push({ file: track.file, label: track.label || "Unknown" });
        }
      }

      var hdrs = { "User-Agent": this.ua, "Referer": "https://vidtube.site/" };
      var variants = await this._resolveHlsVariants(m3u8, hdrs);
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

  // Fetch a master HLS playlist and return one entry per quality variant.
  // Returns [] if the URL is a flat media playlist (no #EXT-X-STREAM-INF, use as-is).
  // Returns null if the response is not a valid m3u8 (Cloudflare block, error page, or fetch failure).
  async _resolveHlsVariants(masterUrl, headers) {
    try {
      var res = await this.client.get(masterUrl, headers);
      var body = res.body || "";
      if (body.indexOf("#EXTM3U") < 0) return null; // not a valid m3u8 (blocked or error)
      if (body.indexOf("#EXT-X-STREAM-INF") < 0) return []; // flat media playlist, use master URL as-is
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

  // Fetch all unique servers from /ajax/server/list?servers={ids} and resolve each.
  // data-type is no longer present on server elements, so we can't split sub/dub here.
  // We deduplicate by data-sv-id so each server type is tried only once.
  async _fetchServerListStreams(ids) {
    var streams = [];
    if (!ids) return streams;
    try {
      var res = await this.client.get(
        this.source.baseUrl + "/ajax/server/list?servers=" + ids,
        { "User-Agent": this.ua, "Referer": this.source.baseUrl + "/", "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/javascript, */*; q=0.01" }
      );
      var html = res.body || "";
      try { var parsed = JSON.parse(html); if (parsed && typeof parsed.result === "string") html = parsed.result; } catch (e) {}

      var doc = new Document(html);
      var serverEls = doc.select("li[data-link-id]");
      var seenSvIds = {};

      for (var i = 0; i < serverEls.length; i++) {
        var el = serverEls[i];
        var svId = el.attr("data-sv-id") || ("srv" + i);
        if (seenSvIds[svId]) continue;
        seenSvIds[svId] = true;
        var linkId = el.attr("data-link-id") || "";
        if (!linkId) continue;
        var svName = (el.text || "").trim().slice(0, 20) || "Srv" + (i + 1);
        var resolved = await this._resolveStreams(linkId, svName);
        streams = streams.concat(resolved);
        if (streams.length > 0) break; // stop at first server that returns streams
      }
    } catch (e) {}
    return streams;
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

    var subStreams = [], dubStreams = [];

    // Server list — VidPlay (VidTube CDN) / HD (MegaPlay CDN) / Vidstream / VidCloud
    // "megaplay" pref also routes here: MegaPlay streams are served via the HD server entry.
    if (serverPref !== "mapper") {
      if (!ids) {
        var m2 = await this._fetchEpMeta(slug, epNum);
        if (m2 && m2.ids) ids = m2.ids;
      }
      var listStreams = await this._fetchServerListStreams(ids);
      subStreams = subStreams.concat(listStreams);
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
          if (subLinkId) { var ks = await this._resolveStreams(subLinkId, "Sub [Kiwi-Stream]"); subStreams = subStreams.concat(ks); }
          if (dubLinkId) { var kd = await this._resolveStreams(dubLinkId, "Dub [Kiwi-Stream]"); dubStreams = dubStreams.concat(kd); }
        }
      }
    }

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
          summary: "Server List tries each AniKoto server in order (VidPlay → MegaPlay HD → Vidstream → VidCloud) and uses the first that returns a working stream. Kiwi-Stream is legacy and unlikely to work.",
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
