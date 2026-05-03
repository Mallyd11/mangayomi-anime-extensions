const mangayomiSources = [
  {
    "name": "HiAnime",
    "id": 1183439094,
    "lang": "en",
    "baseUrl": "https://hianime.ms",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://hianime.ms",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.1.3",
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

  async fetchDoc(path) {
    var url = path.startsWith("http") ? path : this.source.baseUrl + path;
    var res = await this.client.get(url, this.headers);
    return new Document(res.body);
  }

  // Parse anime cards from list pages (.flw-item containers)
  parseList(doc) {
    var list = [];
    var items = doc.select(".flw-item");
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      // Prefer the play button anchor; fall back to the title anchor
      var anchor = item.selectFirst(".film-poster-ahref");
      if (!anchor) anchor = item.selectFirst(".dynamic-name");
      if (!anchor) anchor = item.selectFirst(".film-name a");
      var href = anchor ? anchor.attr("href") : "";
      var link = href.startsWith("http") ? href : this.source.baseUrl + href;

      var nameEl = item.selectFirst(".dynamic-name");
      if (!nameEl) nameEl = item.selectFirst(".film-name a");
      var name = "";
      if (nameEl) {
        name = (nameEl.attr("data-ename") || nameEl.text || "").trim();
      }

      var img = item.selectFirst(".film-poster-img");
      if (!img) img = item.selectFirst(".film-poster img");
      var imageUrl = "";
      if (img) imageUrl = img.attr("src") || img.attr("data-src") || "";

      if (name && link) list.push({ name: name, imageUrl: imageUrl, link: link });
    }
    return list;
  }

  hasNextPage(doc) {
    // Pagination uses <li class="page-item"><a aria-label="Next"> when next is enabled.
    // When next is disabled or not present, no anchor with that aria-label exists.
    var nextLink = doc.selectFirst("a[aria-label='Next']");
    return !!nextLink;
  }

  get supportsLatest() {
    return true;
  }

  async getPopular(page) {
    var doc = await this.fetchDoc("/most-popular?page=" + page);
    return { list: this.parseList(doc), hasNextPage: this.hasNextPage(doc) };
  }

  async getLatestUpdates(page) {
    var doc = await this.fetchDoc("/new-releases?page=" + page);
    return { list: this.parseList(doc), hasNextPage: this.hasNextPage(doc) };
  }

  async search(query, page, filters) {
    var doc = await this.fetchDoc("/search?keyword=" + encodeURIComponent(query) + "&page=" + page);
    return { list: this.parseList(doc), hasNextPage: this.hasNextPage(doc) };
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

    // The watch page has all the data we need: metadata + every episode token
    var watchPath = this.buildWatchUrl(info.slug, 1);
    var watchUrl = this.source.baseUrl + watchPath;
    var res = await this.client.get(watchUrl, this.headers);
    var html = res.body;
    var doc = new Document(html);

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

    // Description - og:description or meta description (strip "Watch X Episode 1 online in HD." prefix)
    var description = "";
    var descMeta = doc.selectFirst("meta[name='description'], meta[property='og:description']");
    if (descMeta) {
      description = (descMeta.attr("content") || "")
        .replace(/^Watch\s+[^.]+\.\s*/i, "")
        .replace(/^[^.]+anime with Sub\/Dub\.\s*/i, "")
        .trim();
    }

    // Genres - links to /genre/ pages
    var genre = [];
    var genreEls = doc.select("a[href*='/genre/']");
    var seenGenre = {};
    for (var i = 0; i < genreEls.length; i++) {
      var g = genreEls[i].text.trim();
      if (g && !seenGenre[g.toLowerCase()] && g.length < 40) {
        // Skip nav-style entries by filtering on length
        seenGenre[g.toLowerCase()] = true;
        genre.push(g);
      }
    }

    // Status - look for status text near labels
    var status = 5;
    var statusMatch = html.match(/Status[\s\S]{0,80}?(Currently Airing|Finished Airing|Ongoing|Completed|Releasing|Not Yet Released|Upcoming)/i);
    if (statusMatch) status = this.statusCode(statusMatch[1]);

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
      var label = "Episode " + epNum;
      if (epTitle) label += ": " + epTitle;
      var langs = [];
      if (hasSub) langs.push("Sub");
      if (hasDub) langs.push("Dub");
      if (langs.length) label += " [" + langs.join("+") + "]";
      // chapter url encodes everything we need: realEpId, hasSub, hasDub
      var chUrl = realEpId + "|" + (hasSub ? "1" : "0") + "|" + (hasDub ? "1" : "0");
      chapters.push({ name: label, url: chUrl });
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

  // Fetch the megaplay.buzz player page and parse data-id from #megaplay-player
  async getMegaplayDataId(realEpId, audioType) {
    var streamPath = "/stream/s-2/" + realEpId + "/" + audioType;
    var url = "https://megaplay.buzz" + streamPath;
    try {
      var res = await this.client.get(url, {
        "User-Agent": this.ua,
        "Referer": this.source.baseUrl + "/",
      });
      // Quickly check for error page
      if (res.body.indexOf("File not found") >= 0 || res.body.indexOf("We can&apos;t find") >= 0 ||
          res.body.indexOf("Error - MegaPlay") >= 0) {
        return null;
      }
      // Find data-id on the player div
      var doc = new Document(res.body);
      var playerEl = doc.selectFirst("#megaplay-player[data-id]");
      if (playerEl) {
        return { dataId: playerEl.attr("data-id"), refererUrl: url };
      }
      // Fallback: regex
      var m = res.body.match(/id="megaplay-player"[^>]*data-id="(\d+)"/);
      if (m) return { dataId: m[1], refererUrl: url };
    } catch (e) {}
    return null;
  }

  async _fetchWithRetry(url, headers, attempts) {
    var maxAttempts = attempts || 3;
    var lastErr = null;
    for (var n = 0; n < maxAttempts; n++) {
      try {
        var res = await this.client.get(url, headers);
        if (res && res.body) return res.body;
      } catch (e) {
        lastErr = e;
      }
    }
    return null;
  }

  // Resolve an HLS playlist URL to one stream entry per variant.
  // The Mangayomi downloader parses segments directly from the first m3u8 it
  // receives, so we have to fetch and inspect the playlist ourselves.
  //
  // Returns one of:
  //   { kind: "master", variants: [{url, label}, ...] }  — fan out to one stream per quality
  //   { kind: "flat" }                                    — already-flat playlist; caller emits URL as-is
  //   { kind: "fetch-failed" }                            — could not fetch the playlist after retries
  //   { kind: "empty-master" }                            — master with no parseable variants
  async resolveHlsPlaylist(playlistUrl, baseHeaders) {
    var body = await this._fetchWithRetry(playlistUrl, baseHeaders, 3);
    if (!body) return { kind: "fetch-failed" };

    var hasStreamInf = body.indexOf("#EXT-X-STREAM-INF") >= 0;
    var hasExtinf = body.indexOf("#EXTINF") >= 0;

    if (hasExtinf && !hasStreamInf) return { kind: "flat" };
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
    return { kind: "master", variants: variants };
  }

  // Extract HLS sources from the megaplay.buzz getSources API
  async extractMegaplaySources(realEpId, audioType, audioLabel) {
    var streams = [];
    var info = await this.getMegaplayDataId(realEpId, audioType);
    if (!info) return streams;

    try {
      var apiUrl = "https://megaplay.buzz/stream/getSources?id=" + info.dataId;
      var res = await this.client.get(apiUrl, {
        "User-Agent": this.ua,
        "Referer": info.refererUrl,
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "application/json",
      });
      var data = JSON.parse(res.body);
      if (!data || !data.sources) return streams;

      // sources can be an object {file: "..."} or an array [{file: "..."}, ...]
      var sourceList = [];
      if (Array.isArray(data.sources)) {
        sourceList = data.sources;
      } else if (data.sources.file) {
        sourceList = [data.sources];
      }

      // Build subtitles list from tracks
      var subtitles = [];
      if (Array.isArray(data.tracks)) {
        for (var t = 0; t < data.tracks.length; t++) {
          var track = data.tracks[t];
          if (track && track.file && (track.kind === "captions" || track.kind === "subtitles" || !track.kind)) {
            subtitles.push({ file: track.file, label: track.label || "Unknown" });
          }
        }
      }

      var streamHeaders = {
        "User-Agent": this.ua,
        "Referer": "https://megaplay.buzz/",
        "Origin": "https://megaplay.buzz",
      };

      for (var s = 0; s < sourceList.length; s++) {
        var src = sourceList[s];
        var fileUrl = src.file || src.url;
        if (!fileUrl) continue;

        // For HLS, resolve the master playlist so Mangayomi sees segments
        // directly. For mp4 or non-m3u8, just emit as-is.
        var emitted = false;
        if (fileUrl.indexOf(".m3u8") >= 0) {
          var resolved = await this.resolveHlsPlaylist(fileUrl, streamHeaders);
          if (resolved.kind === "master") {
            for (var v = 0; v < resolved.variants.length; v++) {
              streams.push({
                url: resolved.variants[v].url,
                originalUrl: fileUrl,
                quality: resolved.variants[v].label + " - MegaPlay [" + audioLabel + "]",
                headers: streamHeaders,
                subtitles: subtitles,
              });
              emitted = true;
            }
          } else if (resolved.kind === "flat") {
            // Already a flat playlist with segments — emit as-is.
            streams.push({
              url: fileUrl,
              originalUrl: fileUrl,
              quality: "MegaPlay [" + audioLabel + "]",
              headers: streamHeaders,
              subtitles: subtitles,
            });
            emitted = true;
          }
          // For "empty-master" or "fetch-failed", deliberately skip emitting:
          // an unresolved master URL would make Mangayomi treat the variant
          // playlist line as a single video segment, breaking downloads.
        } else {
          // Non-HLS (mp4 etc.) — emit as-is.
          streams.push({
            url: fileUrl,
            originalUrl: fileUrl,
            quality: "MegaPlay [" + audioLabel + "]",
            headers: streamHeaders,
            subtitles: subtitles,
          });
          emitted = true;
        }
      }
    } catch (e) {}

    return streams;
  }

  async getVideoList(url) {
    // chapter url format: "{realEpId}|{hasSub}|{hasDub}"
    var parts = url.split("|");
    var realEpId = parts[0];
    var hasSub = parts[1] === "1";
    var hasDub = parts[2] === "1";

    // Determine preferred order
    var pref = "sub";
    try { pref = new SharedPreferences().get("hianime_pref_audio") || "sub"; } catch (e) {}

    var allStreams = [];
    var subStreams = [];
    var dubStreams = [];

    if (hasSub) {
      subStreams = await this.extractMegaplaySources(realEpId, "sub", "Sub");
    }
    if (hasDub) {
      dubStreams = await this.extractMegaplaySources(realEpId, "dub", "Dub");
    }

    if (pref === "dub") {
      allStreams = dubStreams.concat(subStreams);
    } else {
      allStreams = subStreams.concat(dubStreams);
    }
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
    ];
  }
}
