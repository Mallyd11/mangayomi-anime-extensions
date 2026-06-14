const mangayomiSources = [
  {
    "name": "AniKoto",
    "id": 1356478902,
    "lang": "en",
    "baseUrl": "https://anikototv.to",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://anikototv.to",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.3.0",
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
          for (var j = 0; j < epEls.length; j++) {
            var ep = epEls[j];
            var epNum = ep.attr("data-num") || "";
            if (!epNum) continue;

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
              url: slug + "||" + epNum,
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

  // Call /ajax/server?get={linkId} → get mewcdn URL → base64-decode fragment → m3u8.
  // URL format: https://mewcdn.online/player/plyr.php#BASE64_ENCODED_M3U8_URL#
  async _resolveStream(linkId, audioType) {
    try {
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

      var embedUrl = serverData.result.url;
      var hashPart = embedUrl.split("#")[1];
      if (!hashPart) return null;

      var streamUrl;
      try { streamUrl = atob(hashPart); } catch (e) { return null; }
      if (!streamUrl || (!streamUrl.includes(".m3u8") && !streamUrl.includes(".mp4"))) return null;

      return {
        url: streamUrl,
        originalUrl: streamUrl,
        quality: audioType,
        headers: { "User-Agent": this.ua, "Referer": "https://vibeplayer.site/" },
        subtitles: [],
      };
    } catch (e) {
      return null;
    }
  }

  async getVideoList(url) {
    // Chapter URL format: "{slug}||{epNum}"
    var parts = url.split("||");
    var slug = parts[0] || "";
    var epNum = parts[1] || "1";
    if (!slug) return [];

    // Fetch the watch page for this episode — the server list is embedded in the HTML.
    var watchUrl = this.source.baseUrl + "/watch/" + slug + "/ep-" + epNum;
    var res;
    try {
      res = await this.client.get(watchUrl, {
        "User-Agent": this.ua,
        "Referer": this.source.baseUrl + "/",
        "Accept": "text/html,application/xhtml+xml,*/*",
      });
    } catch (e) { return []; }

    var doc = new Document(res.body || "");

    // Kiwi-Stream (data-sv-id="xtp") appears twice in the page:
    // first occurrence = H-SUB (soft-sub), second = A-DUB.
    var kiwiItems = doc.select('li[data-sv-id="xtp"]');
    var subLinkId = kiwiItems.length > 0 ? (kiwiItems[0].attr("data-link-id") || "") : "";
    var dubLinkId = kiwiItems.length > 1 ? (kiwiItems[1].attr("data-link-id") || "") : "";

    var pref = "sub_dub";
    try { pref = new SharedPreferences().get("anikoto_pref_audio") || "sub_dub"; } catch (e) {}

    var subStreams = [], dubStreams = [];
    if (subLinkId) {
      var s = await this._resolveStream(subLinkId, "Sub");
      if (s) subStreams.push(s);
    }
    if (dubLinkId) {
      var d = await this._resolveStream(dubLinkId, "Dub");
      if (d) dubStreams.push(d);
    }

    if (pref === "dub_sub") return dubStreams.concat(subStreams);
    if (pref === "sub")     return subStreams;
    if (pref === "dub")     return dubStreams;
    return subStreams.concat(dubStreams);
  }

  getFilterList() {
    return [];
  }

  getSourcePreferences() {
    return [
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
