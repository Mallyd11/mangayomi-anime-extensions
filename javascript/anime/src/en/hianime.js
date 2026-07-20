const mangayomiSources = [
  {
    "name": "HiAnime",
    "id": 1183439094,
    "lang": "en",
    "baseUrl": "https://hianime.ms",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://hianime.ms",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.3.7",
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
    var p = await this.fetchPage("/browse?page=" + page);
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

  // Extract anime slug+id from a /details/ URL or build it from a watch URL
  // /details/{slug}-{id} or /watch-{slug}-episode-{n}-{id}
  extractAnimeIdAndSlug(url) {
    var path = url.replace(this.source.baseUrl, "").replace(/^https?:\/\/[^\/]+/, "");
    var m = path.match(/\/details\/(.+)$/);
    if (m) {
      return { slug: m[1].replace(/[?#].*$/, ""), full: m[1].replace(/[?#].*$/, "") };
    }
    m = path.match(/\/watch-(.+)-episode-\d+-([\w]+)/);
    if (m) {
      return { slug: m[1] + "-" + m[2], full: m[1] + "-" + m[2] };
    }
    return { slug: "", full: "" };
  }

  // Build the watch URL for episode 1 from a slug
  // The watch URL format: /watch-{slugBase}-episode-1-{animeId}
  // where {slug} = "{slugBase}-{animeId}"
  buildWatchUrl(slug, episodeNum) {
    var lastDash = slug.lastIndexOf("-");
    if (lastDash < 0) return null;
    var slugBase = slug.substring(0, lastDash);
    var animeId = slug.substring(lastDash + 1);
    return "/watch-" + slugBase + "-episode-" + (episodeNum || 1) + "-" + animeId;
  }

  // Decode a base64url stream token: "MjE0Mjo2MDVmMjBkYg" -> "2142:605f20db" -> realEpId="2142"
  decodeStreamToken(token) {
    if (!token) return null;
    try {
      var t = token.replace(/-/g, "+").replace(/_/g, "/");
      while (t.length % 4 !== 0) t += "=";
      var decoded = this._b64decode(t);
      var colonIdx = decoded.indexOf(":");
      if (colonIdx > 0) return decoded.substring(0, colonIdx);
      return decoded || null;
    } catch (e) {
      return null;
    }
  }

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

  async getDetail(url) {
    var info = this.extractAnimeIdAndSlug(url);
    if (!info.slug) {
      throw new Error("Could not parse anime slug from URL: " + url);
    }

    // Fetch watch page (episodes + metadata) and details page (description, IDs) in parallel
    var watchPath = this.buildWatchUrl(info.slug, 1);
    var watchUrl  = this.source.baseUrl + watchPath;
    var infoUrl   = this.source.baseUrl + "/details/" + info.slug;
    var [res, infoRes] = await Promise.all([
      this.client.get(watchUrl, this.headers),
      this.client.get(infoUrl, this.headers).catch(function() { return { body: "" }; }),
    ]);
    var html    = res.body;
    var infoHtml = infoRes.body || "";
    var doc = new Document(html);
    var infoDoc = infoHtml ? new Document(infoHtml) : null;

    // Title - prefer the h1/h2 on the page, fall back to og:title
    var name = "";
    var nameEl = doc.selectFirst("h1.anime-title, h1.film-name, .ws-anime__name, .anime__details__title h3");
    if (nameEl) name = nameEl.text.trim();
    if (!name) {
      var ogTitle = doc.selectFirst("meta[property='og:title']");
      if (ogTitle) {
        name = (ogTitle.attr("content") || "")
          .replace(/^Watch\s+/i, "")
          .replace(/\s+Episode\s+\d+.*$/i, "")
          .replace(/\s+\(\d{4}\).*$/, "")
          .trim();
      }
    }

    // Image - og:image
    var imageUrl = "";
    var ogImage = doc.selectFirst("meta[property='og:image']");
    if (ogImage) imageUrl = ogImage.attr("content") || "";

    // Description - full synopsis from details page (#synopsis-text), fall back to meta
    var description = "";
    if (infoDoc) {
      var synopsisEl = infoDoc.selectFirst("#synopsis-text, .film-description .text");
      if (synopsisEl) description = synopsisEl.text.trim();
    }
    if (!description) {
      var descMeta = doc.selectFirst("meta[name='description'], meta[property='og:description']");
      if (descMeta) {
        description = (descMeta.attr("content") || "")
          .replace(/^Watch\s+[^.]+\.\s*/i, "")
          .replace(/^[^.]+anime with Sub\/Dub\.\s*/i, "")
          .trim();
      }
    }

    // Genres - use badge--genre anchors on the watch page (accurate, no nav pollution)
    var genre = [];
    var genreEls = doc.select("a.badge--genre");
    var seenGenre = {};
    for (var i = 0; i < genreEls.length; i++) {
      var g = genreEls[i].text.trim();
      if (g && !seenGenre[g.toLowerCase()]) {
        seenGenre[g.toLowerCase()] = true;
        genre.push(g);
      }
    }

    // Status - look for status text near labels
    var status = 5;
    var statusMatch = html.match(/Status[\s\S]{0,80}?(Currently Airing|Finished Airing|Ongoing|Completed|Releasing|Not Yet Released|Upcoming)/i);
    if (statusMatch) status = this.statusCode(statusMatch[1]);

    // Parse AniList/MAL IDs from page JS vars — needed for stream URLs and thumbnails
    var combined = html + infoHtml;
    var anilistId = null;
    var malId = null;
    var aMatch = combined.match(/var\s+anilistId\s*=\s*(\d+)/i)
              || combined.match(/anilist\.co\/anime\/(\d+)/i)
              || combined.match(/anilist[_\-]?id["'\s]*[:=]["'\s]*(\d+)/i);
    var mMatch = combined.match(/var\s+malId\s*=\s*(\d+)/i)
              || combined.match(/myanimelist\.net\/anime\/(\d+)/i)
              || combined.match(/mal[_\-]?id["'\s]*[:=]["'\s]*(\d+)/i);
    if (aMatch) anilistId = aMatch[1];
    if (mMatch) malId = mMatch[1];

    // Episode thumbnails via ani.zip (only if user has enabled them in settings).
    var thumbsEnabled = false;
    try { thumbsEnabled = new SharedPreferences().get("hianime_pref_thumbnails") === true; } catch (e) {}

    var thumbMap = {};
    if (thumbsEnabled) try {
      var zipUrl = anilistId
        ? "https://api.ani.zip/mappings?anilist_id=" + anilistId
        : malId
          ? "https://api.ani.zip/mappings?mal_id=" + malId
          : null;

      if (zipUrl) {
        var zipRes = await this.client.get(zipUrl, {});
        if (zipRes.statusCode === 200) {
          var zipData = JSON.parse(zipRes.body);
          if (zipData && zipData.episodes) {
            Object.keys(zipData.episodes).forEach(function(k) {
              if (zipData.episodes[k].image) thumbMap[k] = zipData.episodes[k].image;
            });
          }
        }
      }
    } catch (e) {}

    // Episodes - parse every <a> with data-stream-token attribute
    var chapters = [];
    var epAnchors = doc.select("a[data-stream-token]");
    for (var j = 0; j < epAnchors.length; j++) {
      var ep = epAnchors[j];
      var token = ep.attr("data-stream-token");
      var realEpId = this.decodeStreamToken(token);
      if (!realEpId) continue;
      var epNum = ep.attr("data-episode") || String(j + 1);
      var hasSub = ep.attr("data-has-sub") === "1";
      var hasDub = ep.attr("data-has-dub") === "1";
      var titleSpan = ep.selectFirst(".ws-ep__title, .ep-name");
      var epTitle = titleSpan ? titleSpan.text.trim() : "";
      // Skip non-Latin titles: walk chars and reject any CJK/hiragana/katakana codepoint
      var isNonLatin = false;
      for (var ci = 0; ci < epTitle.length; ci++) {
        var cp = epTitle.charCodeAt(ci);
        if ((cp >= 0x3000 && cp <= 0x9FFF) || (cp >= 0xF900 && cp <= 0xFFEF)) {
          isNonLatin = true; break;
        }
      }
      var label = "Episode " + epNum;
      if (epTitle && !isNonLatin) label += ": " + epTitle;
      var langs = [];
      if (hasSub) langs.push("Sub");
      if (hasDub) langs.push("Dub");
      if (langs.length) label += " [" + langs.join("+") + "]";
      // chapter url: realEpId|hasSub|hasDub|malId|anilistId|episodeNum
      var chUrl = realEpId + "|" + (hasSub ? "1" : "0") + "|" + (hasDub ? "1" : "0") + "|" + (malId || "") + "|" + (anilistId || "") + "|" + epNum;
      var thumbnailUrl = thumbMap[epNum] || thumbMap[String(parseInt(epNum, 10))] || null;
      chapters.push({ name: label, url: chUrl, thumbnailUrl: thumbnailUrl });
    }

    // Reverse so newest episodes are at the top (Mangayomi convention)
    chapters.reverse();

    return {
      name: name,
      imageUrl: imageUrl,
      description: description,
      genre: genre,
      status: status,
      link: this.source.baseUrl + "/details/" + info.slug,
      chapters: chapters,
    };
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
      // Only fetch VTT content for sub streams — dub subtitles are stripped at the
      // getVideoList level since Mangayomi only auto-activates from the first stream.
      var subtitles = [];
      if (audioType === "sub" && Array.isArray(data.tracks)) {
        for (var t = 0; t < data.tracks.length; t++) {
          var track = data.tracks[t];
          if (!track || !track.file || track.kind === "thumbnails") continue;
          try {
            var vttRes = await this.client.get(track.file, {
              "User-Agent": this.ua,
              "Referer": "https://megaplay.buzz/",
            });
            var vttBody = (vttRes.body || "").trimStart();
            subtitles.push({
              file: vttBody.startsWith("WEBVTT") ? this.vttToSrt(vttBody) : track.file,
              label: track.label || "Unknown",
            });
          } catch (e) {
            subtitles.push({ file: track.file, label: track.label || "Unknown" });
          }
        }
      }
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

  // Ad CDNs seen injecting fake segments. Fast path only — the host-mismatch
  // rule below is the general check and catches hosts not listed here.
  get AD_SEGMENT_HOSTS() {
    return ["ibyteimg.com", "byteimg.com", "ipstatp.com", "doubleclick.net", "googlesyndication.com"];
  }

  // Last two labels of a hostname. Coarse, but enough to tell "same CDN,
  // different shard" from "an entirely unrelated advertiser".
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
  // and auto-advances — which the user sees as the player skipping through an
  // entire season without playing anything, marking it watched on the way.
  //
  // Judge by duration, not segment count: a few long real segments among many
  // short ad ones is still watchable, and the reverse is not.
  _playlistIsPoisoned(body, playlistUrl) {
    var hostM = (playlistUrl || "").match(/^https?:\/\/([^/]+)/);
    if (!hostM) return false;
    var ownRoot = this._rootDomain(hostM[1]);
    var adHosts = this.AD_SEGMENT_HOSTS;
    var lines = String(body).split("\n");
    var realSec = 0, foreignSec = 0;

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
      // Relative URIs resolve against the playlist, so they are always own-host.
      if (uri.indexOf("http") !== 0) { realSec += dur; continue; }
      var segHostM = uri.match(/^https?:\/\/([^/]+)/);
      if (!segHostM) { realSec += dur; continue; }
      var segRoot = this._rootDomain(segHostM[1]);
      var isAd = segRoot !== ownRoot;
      if (!isAd) {
        for (var a = 0; a < adHosts.length; a++) {
          if (segRoot === adHosts[a]) { isAd = true; break; }
        }
      }
      if (isAd) foreignSec += dur; else realSec += dur;
    }

    var total = realSec + foreignSec;
    if (total <= 0) return false; // nothing parseable — let the player decide
    // A CDN that legitimately shards segments across domains would trip the
    // host-mismatch rule on its own, so also require that too little real video
    // remains to be an episode at all. Poisoned streams leave ~1 minute; a
    // genuinely ad-heavy but watchable stream keeps its full runtime.
    if (realSec >= 300) return false;
    // Loose on purpose: legitimate mid-roll or a domain-sharded CDN stays well
    // under this, while the observed poisoning runs ~96%.
    return (foreignSec / total) > 0.5;
  }

  // Resolve an HLS playlist URL to one stream entry per variant.
  // Returns one of:
  //   { kind: "master", variants: [{url, label}, ...] }  — fan out to one stream per quality
  //   { kind: "flat" }                                    — already-flat playlist; caller emits URL as-is
  //   { kind: "fetch-failed" }                            — could not fetch the playlist
  //   { kind: "empty-master" }                            — master with no parseable variants
  //   { kind: "poisoned" }                                — ad-injected; caller emits nothing
  // The caller only emits streams for "master" and "flat", so "poisoned" drops
  // the source rather than handing the player something that cannot play.
  async resolveHlsPlaylist(playlistUrl, baseHeaders) {
    var body = null;
    try {
      var hlsRes = await this.client.get(playlistUrl, baseHeaders);
      if (hlsRes && hlsRes.body) body = hlsRes.body;
    } catch (e) {}
    if (!body) return { kind: "fetch-failed" };

    var hasStreamInf = body.indexOf("#EXT-X-STREAM-INF") >= 0;
    var hasExtinf = body.indexOf("#EXTINF") >= 0;

    // Flat playlist — segments are already in hand, so check without refetching.
    if (hasExtinf && !hasStreamInf) {
      if (this._playlistIsPoisoned(body, playlistUrl)) return { kind: "poisoned" };
      return { kind: "flat" };
    }
    if (!hasStreamInf) return { kind: "empty-master" };

    // Master playlist: parse every variant.
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

    // Sort variants high → low so the user gets the best quality first.
    variants.sort(function(a, b) {
      var aRes = parseInt((a.label || "0").replace(/[^0-9]/g, ""), 10) || 0;
      var bRes = parseInt((b.label || "0").replace(/[^0-9]/g, ""), 10) || 0;
      return bRes - aRes;
    });

    // Poisoning lives in the media playlists, not the master, so the master
    // alone cannot be judged. Sample one variant — injection is applied per
    // stream rather than per rendition, so the top variant speaks for all of
    // them. One extra GET, which matters against the app's 40s isolate
    // deadline; sampling more would risk the timeout for no more signal.
    try {
      var probe = await this.client.get(variants[0].url, baseHeaders);
      var probeBody = (probe && probe.body) || "";
      if (probeBody.indexOf("#EXTM3U") >= 0 &&
          this._playlistIsPoisoned(probeBody, variants[0].url)) return { kind: "poisoned" };
    } catch (e) {} // probe failure is not proof of poisoning — let it through

    return { kind: "master", variants: variants };
  }

  // MegaPlay stream fetch.
  // HiAnime's player tries /stream/ani/{epId}/{type} first (stream-token based),
  // then falls back to /stream/mal/{malId}/{epNum}/{type} (MAL ID based).
  // The mal URL is the reliable path — ani often returns an error page.
  async extractMegaplaySources(realEpId, audioType, audioLabel, malId, episodeNum) {
    var streams = await this.extractMegaplayFromPageUrl(
      "https://megaplay.buzz/stream/ani/" + realEpId + "/" + audioType,
      this.source.baseUrl + "/",
      audioType, audioLabel
    );
    if (streams.length > 0) return streams;
    if (malId && episodeNum) {
      streams = await this.extractMegaplayFromPageUrl(
        "https://megaplay.buzz/stream/mal/" + malId + "/" + episodeNum + "/" + audioType,
        this.source.baseUrl + "/",
        audioType, audioLabel
      );
    }
    return streams;
  }

  // Decode a vidnest/megaplay encrypted API response.
  // APIs return {encrypted:true, data:"<custom_b64_string>"} where the alphabet is
  // "RB0fpH8ZEyVLkv7c2i6MAJ5u3IKFDxlS1NTsnGaqmXYdUrtzjwObCgQP94hoeW+/="
  _decodeVidnestResponse(json) {
    if (!json.encrypted) return json;
    var alpha = "RB0fpH8ZEyVLkv7c2i6MAJ5u3IKFDxlS1NTsnGaqmXYdUrtzjwObCgQP94hoeW+/=";
    var lookup = {};
    for (var i = 0; i < alpha.length; i++) lookup[alpha[i]] = i;
    var enc = json.data || "";
    var result = [];
    for (var i = 0; i < enc.length; i += 4) {
      var chunk = enc.substring(i, i + 4);
      var vals = [64, 64, 64, 64];
      for (var c = 0; c < 4; c++) {
        var ch = chunk[c] || "=";
        vals[c] = lookup[ch] !== undefined ? lookup[ch] : 64;
      }
      result.push((vals[0] << 2) | (vals[1] >> 4));
      if (vals[2] !== 64) result.push(((vals[1] & 15) << 4) | (vals[2] >> 2));
      if (vals[3] !== 64) result.push(((vals[2] & 3) << 6) | vals[3]);
    }
    var str = "";
    for (var j = 0; j < result.length; j++) str += String.fromCharCode(result[j]);
    return JSON.parse(str);
  }

  // VidNest fallback: used for older anime that MegaPlay doesn't carry.
  // Hits new.vidnest.fun which backends against the same nekostream/lostproject
  // CDN as MegaPlay — same stream quality, different routing.
  async fetchVidnestSources(anilistId, epNum, audioType, audioLabel) {
    var streams = [];
    if (!anilistId || !epNum) return streams;
    try {
      var apiUrl = "https://new.vidnest.fun/hianime/anime/" + anilistId + "/" + epNum + "/" + audioType;
      var res = await this.client.get(apiUrl, {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:137.0) Gecko/20100101 Firefox/137.0",
        "Accept": "*/*",
        "Origin": "https://megaplay.buzz",
        "Referer": "https://megaplay.buzz/",
      });
      var data = this._decodeVidnestResponse(JSON.parse(res.body));
      if (!data || !data.sources || !data.sources.length) return streams;
      // Subtitles: same flow as MegaPlay — fetch VTT and convert to SRT
      var subtitles = [];
      if (audioType === "sub" && Array.isArray(data.tracks)) {
        for (var t = 0; t < data.tracks.length; t++) {
          var track = data.tracks[t];
          if (!track || !track.file || track.kind === "thumbnails") continue;
          try {
            var vttRes = await this.client.get(track.file, {
              "User-Agent": this.ua,
              "Referer": "https://megaplay.buzz/",
            });
            var vttBody = (vttRes.body || "").trimStart();
            subtitles.push({
              file: vttBody.startsWith("WEBVTT") ? this.vttToSrt(vttBody) : track.file,
              label: track.label || "Unknown",
            });
          } catch (e) {
            subtitles.push({ file: track.file, label: track.label || "Unknown" });
          }
        }
      }
      var streamHeaders = { "User-Agent": this.ua, "Referer": "https://megaplay.buzz/", "Origin": "https://megaplay.buzz" };
      for (var s = 0; s < data.sources.length; s++) {
        var src = data.sources[s];
        var fileUrl = src.file || src.url;
        if (!fileUrl) continue;
        if (fileUrl.indexOf(".m3u8") >= 0) {
          var resolved = await this.resolveHlsPlaylist(fileUrl, streamHeaders);
          if (resolved.kind === "master") {
            for (var v = 0; v < resolved.variants.length; v++) {
              streams.push({ url: resolved.variants[v].url, originalUrl: fileUrl, quality: resolved.variants[v].label + " - VidNest [" + audioLabel + "]", headers: streamHeaders, subtitles: subtitles });
            }
          } else if (resolved.kind === "flat") {
            streams.push({ url: fileUrl, originalUrl: fileUrl, quality: "VidNest [" + audioLabel + "]", headers: streamHeaders, subtitles: subtitles });
          }
        } else {
          streams.push({ url: fileUrl, originalUrl: fileUrl, quality: "VidNest [" + audioLabel + "]", headers: streamHeaders, subtitles: subtitles });
        }
      }
    } catch (e) {}
    return streams;
  }

  // API approach: use HiAnime's own AJAX to discover servers and get embed URLs
  async getStreamsViaHiAnimeApi(hiAnimeEpId, audioType, audioLabel) {
    var streams = [];
    if (!hiAnimeEpId) return streams;
    try {
      var apiHeaders = {
        "User-Agent": this.ua,
        "Referer": this.source.baseUrl + "/",
        "X-Requested-With": "XMLHttpRequest",
      };
      var sRes = await this.client.get(
        this.source.baseUrl + "/ajax/v2/episode/servers?episodeId=" + hiAnimeEpId,
        apiHeaders
      );
      var sData = JSON.parse(sRes.body);
      if (!sData || !sData.html) return streams;
      var sDoc = new Document(sData.html);
      var items = sDoc.select("div.server-item");
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if ((item.attr("data-type") || "").toLowerCase() !== audioType) continue;
        var serverId = item.attr("data-id");
        if (!serverId) continue;
        try {
          var srcRes = await this.client.get(
            this.source.baseUrl + "/ajax/v2/episode/sources?id=" + serverId,
            apiHeaders
          );
          var srcData = JSON.parse(srcRes.body);
          var embedUrl = srcData && (srcData.link || srcData.url);
          if (!embedUrl) continue;
          if (embedUrl.indexOf("megaplay.buzz") >= 0) {
            var epStreams = await this.extractMegaplayFromPageUrl(embedUrl, this.source.baseUrl + "/", audioType, audioLabel);
            streams = streams.concat(epStreams);
          }
        } catch (e) {}
      }
    } catch (e) {}
    return streams;
  }

  async getVideoList(url) {
    // chapter url: "{realEpId}|{hasSub}|{hasDub}|{malId}|{anilistId}|{episodeNum}"
    var parts = url.split("|");
    var realEpId  = parts[0];
    var hasSub    = parts[1] === "1";
    var hasDub    = parts[2] === "1";
    var malId     = parts[3] || "";
    var anilistId = parts[4] || "";
    var episodeNum = parts[5] || "";

    var pref = "sub";
    try { pref = new SharedPreferences().get("hianime_pref_audio") || "sub"; } catch (e) {}
    var server = "auto";
    try { server = new SharedPreferences().get("hianime_pref_server") || "auto"; } catch (e) {}

    var getStreams = async (audioType, audioLabel) => {
      var streams;
      if (server === "ani") {
        // ani URL only (stream-token based)
        streams = await this.extractMegaplayFromPageUrl(
          "https://megaplay.buzz/stream/ani/" + realEpId + "/" + audioType,
          this.source.baseUrl + "/", audioType, audioLabel
        );
      } else if (server === "mal") {
        // mal URL only (MAL ID + episode number based — reliable)
        streams = await this.extractMegaplayFromPageUrl(
          "https://megaplay.buzz/stream/mal/" + malId + "/" + episodeNum + "/" + audioType,
          this.source.baseUrl + "/", audioType, audioLabel
        );
      } else {
        // "auto": try ani first, fall back to mal
        streams = await this.extractMegaplaySources(realEpId, audioType, audioLabel, malId, episodeNum);
      }
      // VidNest fallback: older anime that MegaPlay doesn't carry (e.g. Shiki, 2010)
      if (streams.length === 0 && anilistId && episodeNum) {
        streams = await this.fetchVidnestSources(anilistId, episodeNum, audioType, audioLabel);
      }
      return streams;
    };

    var results = await Promise.all([
      hasSub ? getStreams("sub", "Sub") : Promise.resolve([]),
      hasDub ? getStreams("dub", "Dub") : Promise.resolve([]),
    ]);
    var allStreams = pref === "dub" ? results[1].concat(results[0]) : results[0].concat(results[1]);
    // Mangayomi auto-activates subtitles only from the first stream (videos.first).
    // Strip inline VTT content from every other stream to keep the response payload small.
    for (var i = 1; i < allStreams.length; i++) allStreams[i].subtitles = [];
    return allStreams;
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
        key: "hianime_pref_server",
        listPreference: {
          title: "MegaPlay URL mode",
          summary: "Auto tries stream/ani first then stream/mal. Use stream/mal if Auto is slow (mal is the reliable fallback HiAnime uses).",
          valueIndex: 0,
          entries: ["Auto (ani → mal)", "stream/mal only", "stream/ani only"],
          entryValues: ["auto", "mal", "ani"],
        },
      },
      {
        key: "hianime_pref_thumbnails",
        switchPreferenceCompat: {
          title: "Episode thumbnails",
          summary: "Fetch episode thumbnails from ani.zip (adds a small delay when loading episodes)",
          value: false,
        },
      },
    ];
  }
}
