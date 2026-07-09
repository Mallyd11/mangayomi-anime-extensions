const mangayomiSources = [
  {
    "name": "AniCove",
    "id": 1839274651,
    "lang": "en",
    "baseUrl": "https://mwask-anicove.hf.space",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://mwask-anicove.hf.space",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.3.5",
    "pkgPath": "anime/src/en/anicove.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": false,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/anicove.js",
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

  getPreference(key) {
    return new SharedPreferences().get(key);
  }

  get supportsLatest() {
    return true;
  }

  // Extract home-row-card entries from a named section of the /home page HTML.
  // Uses pure string scanning — no DOM — to avoid Mangayomi selector limitations.
  extractSectionCards(html, sectionTitle) {
    var list = [];
    var titleStr = sectionTitle + "</h2>";
    var sectionStart = html.indexOf(titleStr);
    if (sectionStart < 0) return list;

    var chunk = html.slice(sectionStart + titleStr.length);
    // Stop at the next section heading so we don't bleed into other sections.
    var nextH2 = chunk.indexOf("<h2 class=\"home-section-title\">");
    if (nextH2 > 0) chunk = chunk.slice(0, nextH2);

    var pos = 0;
    while (pos < chunk.length) {
      var cardIdx = chunk.indexOf("home-row-card\"", pos);
      if (cardIdx < 0) break;

      // href is an attribute on the same <a> tag, before the class attribute.
      var hrefStart = chunk.lastIndexOf("href=\"", cardIdx);
      if (hrefStart < 0) { pos = cardIdx + 1; continue; }
      var hrefEnd = chunk.indexOf("\"", hrefStart + 6);
      var href = chunk.slice(hrefStart + 6, hrefEnd);

      // img tag follows in the card body.
      var imgIdx = chunk.indexOf("<img ", cardIdx);
      if (imgIdx < 0) { pos = cardIdx + 1; continue; }
      var imgClose = chunk.indexOf(">", imgIdx);
      var imgTag = chunk.slice(imgIdx, imgClose);

      var srcIdx = imgTag.indexOf("src=\"");
      var src = "";
      if (srcIdx >= 0) { var srcEnd = imgTag.indexOf("\"", srcIdx + 5); src = imgTag.slice(srcIdx + 5, srcEnd); }

      var altIdx = imgTag.indexOf("alt=\"");
      var alt = "";
      if (altIdx >= 0) { var altEnd = imgTag.indexOf("\"", altIdx + 5); alt = imgTag.slice(altIdx + 5, altEnd); }

      // Derive anime detail URL from /watch/{id} → /anime/{id}
      var watchIdx = href.indexOf("/watch/");
      if (watchIdx >= 0 && alt) {
        var animeId = href.slice(watchIdx + 7);
        list.push({ name: alt, imageUrl: src, link: this.source.baseUrl + "/anime/" + animeId });
      }
      pos = cardIdx + 1;
    }
    return list;
  }

  // Parse search results — the search page still uses .anime-card.
  parseSearchCards(doc) {
    var cards = doc.select(".anime-card");
    var list = [];
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var href = card.attr("href") || "";
      if (!href) continue;
      var link = href.indexOf("http") === 0 ? href : this.source.baseUrl + href;
      if (link.indexOf("/anime/") < 0) continue;
      var titleEl = card.selectFirst(".anime-card-title");
      var name = titleEl ? (titleEl.text || "").trim() : "";
      if (!name) continue;
      var img = card.selectFirst("img");
      var imageUrl = img ? (img.attr("src") || img.attr("data-src") || "") : "";
      list.push({ name: name, imageUrl: imageUrl, link: link });
    }
    return list;
  }

  async getPopular(page) {
    try {
      var res = await this.client.get(this.source.baseUrl + "/home", this.headers);
      var html = (res && res.body) || "";
      var list = this.extractSectionCards(html, "Trending Now");
      if (list.length === 0) list = this.extractSectionCards(html, "Popular This Season");
      return { list: list, hasNextPage: false };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    try {
      var res = await this.client.get(this.source.baseUrl + "/home", this.headers);
      var html = (res && res.body) || "";
      var list = this.extractSectionCards(html, "Recent Updates");
      return { list: list, hasNextPage: false };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    try {
      var res = await this.client.get(
        this.source.baseUrl + "/search?q=" + encodeURIComponent(query),
        this.headers
      );
      var doc = new Document(res.body || "");
      return { list: this.parseSearchCards(doc), hasNextPage: false };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  extractAnimeId(url) {
    var m = url.match(/\/(?:anime|watch)\/(\d+)/);
    return m ? m[1] : "";
  }

  async getDetail(url) {
    var animeId = this.extractAnimeId(url);
    if (!animeId) throw new Error("Cannot parse anime ID from: " + url);

    var watchRes = await this.client.get(
      this.source.baseUrl + "/watch/" + animeId + "/ep-1",
      this.headers
    );
    var html = (watchRes && watchRes.body) || "";
    var doc = new Document(html);

    // Scrape name and poster from the WATCH_CONFIG JS block embedded in the page.
    var animeNameM = html.match(/animeName:\s*"([^"]+)"/);
    var name = animeNameM ? animeNameM[1] : "";
    var posterM = html.match(/poster:\s*"([^"]+)"/);
    var imageUrl = posterM ? posterM[1] : "";

    // Extract season number directly from the title AniCove shows (e.g. "Season 4").
    // No AniList needed — if the page says "Season 4" we use 4, otherwise 1.
    var seasonNum = 1;
    var snLower = name.toLowerCase();
    var snIdx = snLower.indexOf("season ");
    if (snIdx >= 0) {
      var snRest = name.slice(snIdx + 7);
      var snStr = "";
      for (var si = 0; si < snRest.length; si++) {
        if (snRest[si] >= "0" && snRest[si] <= "9") { snStr += snRest[si]; } else { break; }
      }
      if (snStr) seasonNum = parseInt(snStr);
    }
    if (seasonNum === 1) {
      var ordinals = ["2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];
      for (var oi = 0; oi < ordinals.length; oi++) {
        if (snLower.indexOf(ordinals[oi] + " season") >= 0) { seasonNum = oi + 2; break; }
      }
    }

    var epEls = doc.select("a.episode-sidebar-item");
    var chapters = [];
    for (var i = 0; i < epEls.length; i++) {
      var ep = epEls[i];
      var epNum = ep.attr("data-number") || String(i + 1);
      var titleEl = ep.selectFirst(".episode-title");
      var rawTitle = titleEl ? (titleEl.text || "").trim() : "";
      var epTitle = rawTitle.replace(/\s*Filler\s*$/i, "").trim();
      var label = "Episode " + epNum;
      if (epTitle && epTitle !== epNum) label += ": " + epTitle;
      chapters.push({
        name: label,
        url: animeId + "||" + epNum + "||" + seasonNum,
        thumbnailUrl: "",
        scanlator: (ep.attr("class") || "").indexOf("is-filler") >= 0 ? "Filler" : "",
      });
    }
    chapters.reverse();

    return {
      name: name,
      imageUrl: imageUrl,
      description: "",
      genre: [],
      status: 5,
      link: this.source.baseUrl + "/anime/" + animeId,
      chapters: chapters,
    };
  }

  // Resolve an anixtv.in embed URL to a real HLS m3u8 by following the iframe chain:
  // Resolve an anixtv.in embed URL to a real HLS m3u8 by following the iframe chain:
  // anixtv.in page → as-cdn21.top/video/{hash} iframe → /player/index.php?do=getVideo API
  async resolveAnixTvEmbed(embedUrl, lang) {
    // Step 1: GET the anixtv.in wrapper page — it just has one <iframe> pointing to as-cdn21.top
    var anixRes = await this.client.get(embedUrl, {
      "User-Agent": this.ua,
      "Referer": this.source.baseUrl + "/",
    });
    var anixHtml = (anixRes && anixRes.body) || "";

    // Extract <iframe src="https://as-cdn21.top/video/{hash}">
    var iframeIdx = anixHtml.indexOf("<iframe ");
    if (iframeIdx < 0) return null;
    var srcIdx = anixHtml.indexOf('src="', iframeIdx);
    if (srcIdx < 0) return null;
    var srcEnd = anixHtml.indexOf('"', srcIdx + 5);
    var playerUrl = anixHtml.slice(srcIdx + 5, srcEnd);
    if (playerUrl.indexOf("as-cdn") < 0) return null;

    // Extract the hash from the end of the path.
    var hashIdx = playerUrl.lastIndexOf("/");
    var hash = playerUrl.slice(hashIdx + 1);
    if (!hash) return null;

    // Step 2: POST to the getVideo API — returns the actual time-limited m3u8 URL.
    var apiRes = await this.client.post(
      "https://as-cdn21.top/player/index.php?data=" + hash + "&do=getVideo",
      {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": this.ua,
        "Referer": playerUrl,
        "Origin": "https://as-cdn21.top",
        "X-Requested-With": "XMLHttpRequest",
      },
      "hash=" + hash + "&r=https://anixtv.in/"
    );

    var videoData = JSON.parse(apiRes.body || "{}");
    var streamUrl = videoData.securedLink || videoData.videoSource || "";
    if (!streamUrl) return null;

    return {
      url: streamUrl,
      originalUrl: streamUrl,
      quality: "AnixTv [" + lang.toUpperCase() + "]",
      headers: {
        "User-Agent": this.ua,
        "Referer": "https://as-cdn21.top/",
        "Origin": "https://as-cdn21.top",
      },
      subtitles: [],
    };
  }

  async getVideoList(url) {
    var parts = url.split("||");
    var animeId = parts[0];
    var epNum = parts[1] || "1";
    var seasonNum = parts[2] ? parseInt(parts[2]) : 1;

    // Read multi-select language preference — defaults to both sub and dub.
    var langs = ["sub", "dub"];
    try {
      var pref = this.getPreference("anicove_lang");
      if (pref && pref.length > 0) langs = pref;
    } catch (e) {}

    // The site now delivers streams via /api/watch/sources (POST) rather than
    // embedding videoLink in the page HTML. Try all three providers for each
    // selected language and collect every available stream.
    var providers = ["zenith", "zoro", "anixtv"];

    var apiHeaders = {
      "Content-Type": "application/json",
      "User-Agent": this.ua,
      "Referer": this.source.baseUrl + "/watch/" + animeId + "/ep-" + epNum,
      "Origin": this.source.baseUrl,
    };
    var streamHeaders = { "User-Agent": this.ua, "Referer": this.source.baseUrl + "/" };

    var streams = [];

    for (var li = 0; li < langs.length; li++) {
      var lang = langs[li];

      for (var pi = 0; pi < providers.length; pi++) {
        var provider = providers[pi];
        try {
          var res = await this.client.post(
            this.source.baseUrl + "/api/watch/sources",
            apiHeaders,
            {
              anime_id: animeId,
              episode_number: parseInt(epNum),
              language: lang,
              provider: provider,
            }
          );

          var data = JSON.parse(res.body || "{}");
          if (!data.available) continue;

          var srcType = data.source_type || "";
          var isEmbed = (srcType === "embed");

          // video_link — only usable when source_type is hls or mp4.
          // When source_type is "embed", video_link is an HTML proxy page that
          // causes the player to buffer forever — skip it in that case.
          if (!isEmbed) {
            var topLink = (typeof data.video_link === "string") ? data.video_link : "";
            if (topLink) {
              streams.push({ url: topLink, originalUrl: topLink,
                quality: provider + " [" + lang.toUpperCase() + "]",
                headers: streamHeaders, subtitles: [] });
            }
          }

          // hls_sources — each entry is a string URL or {file, url, quality}
          var hlsSources = data.hls_sources || [];
          for (var hi = 0; hi < hlsSources.length; hi++) {
            var hs = hlsSources[hi];
            var hsUrl = (typeof hs === "string") ? hs : (hs.file || hs.url || "");
            if (!hsUrl) continue;
            var hsQ = (hs.quality || provider) + " HLS [" + lang.toUpperCase() + "]";
            streams.push({ url: hsUrl, originalUrl: hsUrl, quality: hsQ, headers: streamHeaders, subtitles: [] });
          }

          // video_sources — MP4
          var mp4Sources = data.video_sources || [];
          for (var mi = 0; mi < mp4Sources.length; mi++) {
            var ms = mp4Sources[mi];
            var msUrl = (typeof ms === "string") ? ms : (ms.file || ms.url || "");
            if (!msUrl) continue;
            var msQ = (ms.quality || provider) + " MP4 [" + lang.toUpperCase() + "]";
            streams.push({ url: msUrl, originalUrl: msUrl, quality: msQ, headers: streamHeaders, subtitles: [] });
          }

          // embed_sources — resolve anixtv iframe chain to get a real m3u8
          var embedSources = data.embed_sources || [];
          for (var ei = 0; ei < embedSources.length; ei++) {
            var es = embedSources[ei];
            var esUrl = es.url || "";
            if (!esUrl) continue;
            if (esUrl.indexOf("anixtv.in") >= 0) {
              try {
                // Patch season= param using the number extracted from the page title
                if (seasonNum > 1) {
                  var si = esUrl.indexOf("season=");
                  if (si >= 0) {
                    var se = esUrl.indexOf("&", si);
                    if (se < 0) se = esUrl.length;
                    esUrl = esUrl.slice(0, si + 7) + seasonNum + esUrl.slice(se);
                  }
                }
                var resolved = await this.resolveAnixTvEmbed(esUrl, lang);
                if (resolved) streams.push(resolved);
              } catch (ex) {}
            }
          }
        } catch (ex) {}
      }
    }

    return streams;
  }

  getFilterList() {
    return [];
  }

  getSourcePreferences() {
    return [
      {
        key: "anicove_lang",
        multiSelectListPreference: {
          title: "Preferred language",
          summary: "Select sub, dub, or both. All checked types will appear as separate stream options.",
          values: ["sub", "dub"],
          entries: ["Sub (subtitled)", "Dub (dubbed)"],
          entryValues: ["sub", "dub"],
        },
      },
    ];
  }
}
