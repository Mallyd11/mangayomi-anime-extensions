const mangayomiSources = [
  {
    "name": "AniKoto",
    "id": 1356478902,
    "lang": "en",
    "baseUrl": "https://anikototv.to",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://anikototv.to",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.2.0",
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
    var doc = await this.fetchDoc("/filter?keyword=" + encodeURIComponent(query) + "&page=" + page);
    return { list: this.parseList(doc), hasNextPage: this.hasNextPage(doc) };
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

    // Genres and status from .meta span elements.
    // Observed values: "TV", "WINTER 2025", "Jan 5, 2025 to ...", "Finished Airing",
    //                  "Action  ,  Adventure  ,  Fantasy", "8.87", "24m min", "13", "Studio"
    var genre = [];
    var status = 5;
    var metaSpans = doc.select(".meta span");
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
          var thumbMap = {}; // epNum (string) → thumbnail URL
          if (animeMALId) {
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
          for (var j = 0; j < epEls.length; j++) {
            var ep = epEls[j];
            var epNum = ep.attr("data-num") || "";
            var malId = ep.attr("data-mal") || "";
            var timestamp = ep.attr("data-timestamp") || "";
            if (!epNum || !malId || !timestamp) continue;

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
              url: slug + "||" + epNum + "||" + malId + "||" + timestamp,
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

  // Unpack a JavaScript p,a,c,k,e,d packer (as used by kwik.cx).
  // Returns the decoded script string, or null on failure.
  _unpackPacker(packed) {
    var m = packed.match(/\('([\s\S]+?)',\s*(\d+),\s*(\d+),\s*'([\s\S]+?)'\.split\('\|'\)/);
    if (!m) return null;
    var encoded = m[1];
    var a = parseInt(m[2], 10);
    var c = parseInt(m[3], 10);
    var dict = m[4].split("|");

    function toBase(n) {
      return (n < a ? "" : toBase(Math.floor(n / a))) +
        ((n % a) > 35 ? String.fromCharCode((n % a) + 29) : (n % a).toString(36));
    }

    var result = encoded;
    while (c--) {
      if (dict[c]) {
        result = result.replace(new RegExp("\\b" + toBase(c) + "\\b", "g"), dict[c]);
      }
    }
    return result;
  }

  // Extract the m3u8/mp4 stream URL from a kwik.cx embed page HTML.
  // The page contains multiple eval packers (e.g. a cookie helper first, then the
  // video player). We iterate through ALL of them and return the first URL found.
  _extractKwikStreamUrl(html) {
    var searchFrom = 0;
    var marker = "eval(function(p,a,c,k,e,";
    while (true) {
      var packerIdx = html.indexOf(marker, searchFrom);
      if (packerIdx < 0) break;
      searchFrom = packerIdx + 1; // advance so the next loop iteration skips this one

      var packerSection = html.substring(packerIdx, packerIdx + 30000);
      var decoded = this._unpackPacker(packerSection);
      if (!decoded) continue;

      // Look for m3u8 URL (vault-*.owocdn.top/…/uwu.m3u8)
      var urlM = decoded.match(/https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*/);
      if (urlM) return urlM[0];

      // Look for mp4 URL
      urlM = decoded.match(/https?:\/\/[^\s"'\\]+\.mp4[^\s"'\\]*/);
      if (urlM) return urlM[0];

      // Generic source/file pattern
      var srcM = decoded.match(/(?:source|file)\s*[:=]\s*["']([^"']+)["']/);
      if (srcM) return srcM[1];
    }
    return null;
  }

  // Step 1: Call /ajax/server?get={linkId} on anikototv.to to get the kwik embed URL.
  // Step 2: Fetch the kwik embed page and unpack the JS packer to extract the m3u8.
  // Returns a stream object, or null on failure.
  async _resolveViaServer(linkId, qualityLabel, audioType) {
    try {
      // Step 1: Resolve the encrypted linkId to a kwik.cx embed URL via the site API.
      var serverRes = await this.client.get(
        this.source.baseUrl + "/ajax/server?get=" + encodeURIComponent(linkId),
        {
          "User-Agent": this.ua,
          "Referer": this.source.baseUrl + "/",
          "X-Requested-With": "XMLHttpRequest",
          "Accept": "application/json, text/javascript, */*; q=0.01",
        }
      );
      var serverData;
      try { serverData = JSON.parse(serverRes.body); } catch (e) { return null; }
      if (!serverData || serverData.status !== 200 || !serverData.result || !serverData.result.url) return null;

      var embedUrl = serverData.result.url; // "https://kwik.cx/e/{id}"

      // Step 2: Fetch the kwik embed page (has an obfuscated JS packer with the m3u8 URL).
      var kwikRes = await this.client.get(embedUrl, {
        "User-Agent": this.ua,
        "Referer": this.source.baseUrl + "/",
        "Accept": "text/html,application/xhtml+xml,*/*",
      });
      var kwikHtml = kwikRes.body || "";

      // Step 3: Unpack the obfuscated JavaScript and extract the m3u8 stream URL.
      var streamUrl = this._extractKwikStreamUrl(kwikHtml);
      if (!streamUrl) return null;

      return {
        url: streamUrl,
        originalUrl: streamUrl,
        quality: qualityLabel + " [" + audioType + "]",
        headers: { "User-Agent": this.ua, "Referer": "https://kwik.cx/" },
        subtitles: [],
      };
    } catch (e) {
      return null;
    }
  }

  async getVideoList(url) {
    // Chapter URL format: "{slug}||{epNum}||{malId}||{timestamp}"
    var parts = url.split("||");
    var epNum = parts[1] || "1";
    var malId = parts[2] || "";
    var timestamp = parts[3] || "";

    if (!malId || !timestamp) return [];

    // Call the mapper API: returns per-quality linkIds (encrypted keys).
    // Response shape: { "Kiwi-Stream-1080p": { sub: { url: "<b64>" }, dub: { url: "<b64>" } }, ... }
    var mapRes;
    try {
      mapRes = await this.client.get(
        "https://mapper.mewcdn.online/api/mal/" + malId + "/" + epNum + "/" + timestamp,
        {
          "User-Agent": this.ua,
          "Referer": this.source.baseUrl + "/",
          "Accept": "application/json",
        }
      );
    } catch (e) {
      return [];
    }

    var data;
    try { data = JSON.parse(mapRes.body); } catch (e) { return []; }

    var qualities = [
      { key: "Kiwi-Stream-1080p", label: "1080p" },
      { key: "Kiwi-Stream-720p",  label: "720p"  },
      { key: "Kiwi-Stream-360p",  label: "360p"  },
    ];

    var pref = "sub_dub";
    try { pref = new SharedPreferences().get("anikoto_pref_audio") || "sub_dub"; } catch (e) {}

    var subStreams = [];
    var dubStreams = [];

    for (var q = 0; q < qualities.length; q++) {
      var qKey = qualities[q].key;
      var qLabel = qualities[q].label;
      var qData = data[qKey] || {};

      // Sub: data["Kiwi-Stream-1080p"].sub.url  →  /ajax/server?get=…  →  kwik embed  →  m3u8
      var subLinkId = qData.sub && qData.sub.url;
      if (subLinkId) {
        var subStream = await this._resolveViaServer(subLinkId, qLabel, "Sub");
        if (subStream) subStreams.push(subStream);
      }

      // Dub: same path
      var dubLinkId = qData.dub && qData.dub.url;
      if (dubLinkId) {
        var dubStream = await this._resolveViaServer(dubLinkId, qLabel, "Dub");
        if (dubStream) dubStreams.push(dubStream);
      }
    }

    // Return streams in preferred order.
    // When both are included (sub_dub / dub_sub) the first group plays and
    // the second acts as an automatic fallback if the player can't load the first.
    if (pref === "dub_sub") return dubStreams.concat(subStreams);
    if (pref === "sub")     return subStreams;
    if (pref === "dub")     return dubStreams;
    return subStreams.concat(dubStreams); // default: sub_dub
  }

  getFilterList() {
    return [];
  }

  getSourcePreferences() {
    return [
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
