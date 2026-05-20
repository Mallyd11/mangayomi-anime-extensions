const mangayomiSources = [
  {
    "name": "Animetsu",
    "id": 802511794,
    "baseUrl": "https://animetsu.bz",
    "lang": "en",
    "typeSource": "single",
    "iconUrl":
      "https://www.google.com/s2/favicons?sz=256&domain=https://animetsu.bz/",
    "dateFormat": "",
    "dateFormatLocale": "",
    "isNsfw": false,
    "hasCloudflare": true,
    "sourceCodeUrl": "",
    "apiUrl": "",
    "version": "1.3.1",
    "isManga": false,
    "itemType": 1,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "additionalParams": "",
    "sourceCodeLanguage": 1,
    "notes": "",
    "pkgPath": "anime/src/en/animetsu.js",
  },
];
class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
  }

  getPreference(key) {
    return new SharedPreferences().get(key);
  }

  getBaseUrl() {
    return this.getPreference("animetsu_base_url");
  }

  getHeaders(url) {
    url = url != null && url.length > 0 ? url : this.getBaseUrl();
    return {
      "Referer": url,
      "n1": "1",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    };
  }

  getProxyMediaUrl(url) {
    return "https://swiftstream.top/proxy" + url;
  }

  async request(slug) {
    var baseUrl = this.getBaseUrl();
    var hdr = this.getHeaders(baseUrl);
    var url = baseUrl + "/v2/api/anime" + slug;
    var res = await this.client.get(url, hdr);
    if (res.statusCode != 200) {
      throw new Error("Request failed: HTTP " + res.statusCode);
    }
    return JSON.parse(res.body);
  }

  async searchAnime({
    query = "",
    sort = "popular",
    status = "",
    page = "1",
  }) {
    var titlePref = this.getPreference("animetsu_title_lang");

    var slug = "/search/?";
    if (query.length > 0) slug += "query=" + query + "&";
    slug += "sort=" + sort;
    if (status.length > 0) slug += "&status=" + status;
    slug += "&page=" + page;
    slug += "&per_page=20";

    var doc = await this.request(slug);

    var hasNextPage = page != doc.last_page;
    var list = [];
    doc.results.forEach((item) => {
      var romajiTitle = item.title.romaji;
      var prefTitle = item.title[titlePref];

      var name = prefTitle != null ? prefTitle : romajiTitle;
      var link = item.id;
      var imageUrl = item.cover_image.medium;
      list.push({
        name,
        link,
        imageUrl,
      });
    });
    return { list, hasNextPage };
  }

  async getPopular(page) {
    return await this.searchAnime({ page: page });
  }

  async getLatestUpdates(page) {
    var titlePref = this.getPreference("animetsu_title_lang");
    var doc = await this.request("/recent?page=" + page + "&per_page=20");
    var hasNextPage = page != doc.last_page;
    var list = [];
    doc.results.forEach((item) => {
      var romajiTitle = item.title.romaji;
      var prefTitle = item.title[titlePref];
      var name = prefTitle != null ? prefTitle : romajiTitle;
      var link = item.id;
      var imageUrl = item.cover_image.medium;
      list.push({ name, link, imageUrl });
    });
    return { list, hasNextPage };
  }

  async search(query, page, filters) {
    return await this.searchAnime({ query: query, page: page });
  }

  async getDetail(url) {
    function statusCode(status) {
      return (
        {
          RELEASING: 0,
          FINISHED: 1,
          NOT_YET_RELEASED: 4,
        }[status] ?? 5
      );
    }

    if (url.includes("/anime/")) url = url.split("/anime/")[1];
    var id = url;

    var baseUrl = this.getBaseUrl();
    var link = baseUrl + "/anime/" + id;

    var infoSlug = "/info/" + id;
    var body = await this.request(infoSlug);

    var titlePref = this.getPreference("animetsu_title_lang");
    var romajiTitle = body.title.romaji;
    var prefTitle = body.title[titlePref];

    var name = prefTitle != null ? prefTitle : romajiTitle;
    var imageUrl = body.cover_image.medium;
    var description = body.description;
    var status = statusCode(body.status);
    var genre = body.genres;
    var format = body.format;

    var chapters = [];
    var epSlug = "/eps/" + id;
    var epData = await this.request(epSlug);

    var epDescPref = this.getPreference("animetsu_pref_ep_description");
    epData.forEach((item) => {
      var ep_num = item.ep_num;
      var ep_title = item.name;
      var epName = format == "MOVIE" ? ep_title : `E${ep_num} : ${ep_title}`;
      var isFiller = item.is_filler;
      var token = `${id}/${ep_num}`;

      var epDescription = epDescPref ? item.desc : null;
      var dateUpload = item.hasOwnProperty("aired_at")
        ? new Date(item.aired_at).valueOf().toString()
        : null;

      chapters.push({
        name: epName,
        url: token,
        isFiller,
        description: epDescription,
        dateUpload: dateUpload,
      });
    });

    chapters.reverse();
    return { name, imageUrl, link, description, genre, status, chapters };
  }

  async getVideoList(url) {
    var serverPref = this.getPreference("animetsu_pref_stream_server");
    if (serverPref.length < 1) serverPref.push("pahe");

    var audioPref = this.getPreference("animetsu_pref_stream_subdub_type");
    if (audioPref.length < 1) audioPref.push("sub");

    // URL format: "{animeMongoId}/{ep_num}" — the anime's MongoDB ID is the id
    // returned by the search/info API (not a numeric AniList ID).
    var urlParts = url.split("/");
    var anilistUrl = urlParts[0] + "/" + urlParts[1];

    var combinations = [];
    for (var serverName of serverPref) {
      for (var audioType of audioPref) {
        combinations.push({ serverName, audioType });
      }
    }

    var dlPref = this.getPreference("animetsu_pref_dl_links");

    var streamPromise = Promise.all(
      combinations.map(async ({ serverName, audioType }) => {
        try {
          if (serverName == "pahe" || serverName == "meg") {
            var epSlug = `/oppai/${anilistUrl}?server=${serverName}&source_type=${audioType}`;
            var epData = await this.request(epSlug);
            if (!epData.hasOwnProperty("sources")) return [];
            return this.getPaheMegStreams(epData.sources, audioType, serverName);
          } else if (serverName == "kite") {
            var epSlug = `/oppai/${anilistUrl}?server=kite&source_type=${audioType}`;
            var epData = await this.request(epSlug);
            if (!epData.hasOwnProperty("sources")) return [];
            return await this.getKiteStreams(epData, audioType);
          } else if (serverName == "dio" || serverName == "kiss") {
            // Dio and Kiss use the same URL format as pahe/kite/meg.
            var epSlug = `/oppai/${anilistUrl}?server=${serverName}&source_type=${audioType}`;
            var epData = await this.request(epSlug);
            if (!epData.hasOwnProperty("sources")) return [];
            return await this.getDioKissStreams(epData, audioType, serverName);
          }
          return [];
        } catch (e) {
          return [];
        }
      })
    );

    if (!dlPref) {
      var results = await streamPromise;
      return results.flat();
    }

    var [streamResults, dlStreams] = await Promise.all([
      streamPromise,
      this.getDownloadStreams(anilistUrl),
    ]);

    return [...streamResults.flat(), ...dlStreams];
  }

  streamNamer(res, dubType, serverName) {
    return `${res.toUpperCase()} - ${dubType.toUpperCase()} : ${serverName.toUpperCase()}`;
  }

  getPaheMegStreams(epData, audioType, serverName) {
    var hdr = this.getHeaders();
    var streams = [];

    epData.forEach((item) => {
      var quality = item.quality;
      var link = this.getProxyMediaUrl(item.url);

      if (serverName === "meg") {
        // Meg serves direct MP4 via the swiftstream proxy.
        // url == originalUrl (no extension) — swiftstream's HEAD handler returns
        // content-length: 2 which causes Mangayomi's direct-file downloader to
        // reject the stream. Treating it like Pahe (plain URL, no extension)
        // lets libmpv detect the content-type from the actual response instead.
        streams.push({
          url: link,
          originalUrl: link,
          quality: this.streamNamer(quality, audioType, serverName),
          headers: hdr,
        });
      } else {
        // pahe = AES-128 encrypted HLS — stream only, no download label
        streams.push({
          url: link,
          originalUrl: link,
          quality: this.streamNamer(quality, audioType, serverName),
          headers: hdr,
        });
      }
    });

    return streams;
  }

  async getKiteStreams(epData, audioType) {
    var hdr = this.getHeaders();
    var streams = [];

    var subtitles = [];
    if (epData.hasOwnProperty("subs")) {
      epData.subs.forEach((item) => {
        subtitles.push({ file: item.url, label: item.lang, headers: hdr });
      });
    }

    for (var item of epData.sources) {
      var masterUrl = this.getProxyMediaUrl(item.url);
      var baseDir = masterUrl.substring(0, masterUrl.lastIndexOf("/") + 1);
      var parsed = false;

      try {
        var res = await this.client.get(masterUrl, hdr);
        if (res.statusCode == 200) {
          var lines = res.body.split("\n");
          for (var i = 0; i < lines.length; i++) {
            if (lines[i].startsWith("#EXT-X-STREAM-INF:")) {
              var resMatch = lines[i].match(/RESOLUTION=(\d+x\d+)/);
              var resolution = resMatch ? resMatch[1] : "Auto";
              var nextLine = lines[i + 1] ? lines[i + 1].trim() : "";
              if (!nextLine) continue;
              var variantUrl = nextLine.startsWith("http") ? nextLine : baseDir + nextLine;
              var stream = {
                url: variantUrl,
                originalUrl: variantUrl + ".m3u8",
                quality: this.streamNamer(resolution + " [DL]", "soft" + audioType, "kite"),
                headers: hdr,
              };
              if (!parsed) {
                stream.subtitles = subtitles;
                parsed = true;
              }
              streams.push(stream);
            }
          }
        }
      } catch (e) {}

      if (!parsed) {
        streams.push({
          url: masterUrl,
          originalUrl: masterUrl + ".m3u8",
          quality: this.streamNamer("Auto [DL]", "soft" + audioType, "kite"),
          headers: hdr,
          subtitles: subtitles,
        });
      }
    }

    return streams;
  }

  // Dio (hard sub, multi-quality HLS) and Kiss (soft sub, multi-language HLS).
  // Dio returns an HLS master with variant entries — pre-fetch and parse it so
  // libmpv receives a specific variant URL rather than the master (Mangayomi's
  // libmpv build cannot auto-select from an HLS master).
  // Kiss returns a direct playlist — pass straight through like Pahe/Meg.
  // In both cases originalUrl has no extension so libmpv (not M3u8Downloader)
  // handles playback via content-type detection from the GET response.
  // Dio  = baked-in hardsub  → audio label shown without "soft" prefix.
  // Kiss = separate subtitle tracks → audio label shown with "soft" prefix.
  async getDioKissStreams(epData, audioType, serverName) {
    var hdr = this.getHeaders();
    var streams = [];

    var subtitles = [];
    if (epData.hasOwnProperty("subs")) {
      epData.subs.forEach((item) => {
        subtitles.push({ file: item.url, label: item.lang, headers: hdr });
      });
    }

    var isSoftSub = serverName === "kiss";

    for (var item of epData.sources) {
      var masterUrl = this.getProxyMediaUrl(item.url);
      var audioLabel = isSoftSub ? "soft" + audioType : audioType;
      var parsed = false;

      // Only attempt master parsing for non-direct-playlist sources (old_hls == false).
      if (!item.old_hls) {
        try {
          var baseDir = masterUrl.substring(0, masterUrl.lastIndexOf("/") + 1);
          var res = await this.client.get(masterUrl, hdr);
          if (res.statusCode == 200) {
            var lines = res.body.split("\n");
            for (var i = 0; i < lines.length; i++) {
              if (lines[i].startsWith("#EXT-X-STREAM-INF:")) {
                var resMatch = lines[i].match(/RESOLUTION=(\d+x\d+)/);
                var resolution = resMatch ? resMatch[1] : "Auto";
                var nextLine = lines[i + 1] ? lines[i + 1].trim() : "";
                if (!nextLine) continue;
                var variantUrl = nextLine.startsWith("http") ? nextLine : baseDir + nextLine;
                var stream = {
                  url: variantUrl,
                  originalUrl: variantUrl, // no extension — libmpv via content-type, not M3u8Downloader
                  quality: this.streamNamer(resolution, audioLabel, serverName),
                  headers: hdr,
                };
                if (!parsed) { stream.subtitles = subtitles; parsed = true; }
                streams.push(stream);
              }
            }
          }
        } catch (e) {}
      }

      // Direct playlist (old_hls == true) or master parse failed — pass through like Pahe.
      if (!parsed) {
        var stream = {
          url: masterUrl,
          originalUrl: masterUrl,
          quality: this.streamNamer(item.quality || "auto", audioLabel, serverName),
          headers: hdr,
        };
        if (streams.length === 0) stream.subtitles = subtitles;
        streams.push(stream);
      }
    }

    return streams;
  }

  // Decode packer.js obfuscation (eval(function(p,a,c,k,e,d){...})) used on kwik.cx pages.
  // Returns the unpacked JavaScript string, or null if pattern not found / decode failed.
  decodePackerJs(html) {
    try {
      // Match the canonical packer invocation pattern
      var m = html.match(/\(function\s*\(p,a,c,k,e,[a-z]\)\s*\{[\s\S]+?\}\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*\d+\s*,\s*'((?:[^'\\]|\\.)*)'\s*\.split\s*\(\s*['"]\|['"]\s*\)/);
      if (!m) return null;

      var payload = m[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
      var radix = parseInt(m[2]);
      var keys = m[3].split("|");

      // Custom base converter — parseInt only handles up to base 36; kwik uses base 62
      var CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      function fromBase(s) {
        var n = 0;
        for (var i = 0; i < s.length; i++) {
          var d = CHARS.indexOf(s[i]);
          if (d < 0 || d >= radix) return NaN;
          n = n * radix + d;
        }
        return n;
      }

      return payload.replace(/\b([a-zA-Z0-9_$]+)\b/g, function(w) {
        var n = fromBase(w);
        return (!isNaN(n) && n >= 0 && n < keys.length && keys[n] !== "") ? keys[n] : w;
      });
    } catch (e) { return null; }
  }

  // Resolve a pahe.win shortlink → direct MP4 CDN URL (token+expiry embedded in URL).
  // Strategy A: decode packer.js on the kwik page to extract the source URL without a POST.
  // Strategy B: POST the kwik download form and capture the 302 Location redirect.
  async resolveKwikDownload(paheWinUrl) {
    try {
      var ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

      // Step 1: GET pahe.win → the countdown JS contains the kwik URL
      // e.g. $("a.redirect").attr("href","https://kwik.cx/f/HASH")
      var paheRes = await this.client.get(paheWinUrl, {
        "User-Agent": ua,
        "Referer": "https://animetsu.bz/",
      });
      var paheBody = paheRes.body || "";

      // Handle kwik.cx and any other kwik.* TLD, both /f/ and /e/ paths
      var kwikMatch = paheBody.match(/["'](https?:\/\/kwik\.[a-z]{2,3}\/[ef]\/[A-Za-z0-9]+)["']/);
      if (!kwikMatch) return null;
      var kwikFileUrl = kwikMatch[1].replace("/e/", "/f/");

      // Step 2: GET the kwik download page
      var kwikRes = await this.client.get(kwikFileUrl, {
        "User-Agent": ua,
        "Referer": paheWinUrl,
      });
      var kwikBody = kwikRes.body || "";
      if (kwikBody.length < 100) return null;

      // Strategy A: decode packer.js → source URL (no POST, avoids redirect-capture problem)
      var unpacked = this.decodePackerJs(kwikBody);
      if (unpacked) {
        var srcMatch = unpacked.match(/(?:source|src|file|url)\s*=\s*['"]([^'"]+\.mp4[^'"]*)['"]/i);
        if (srcMatch && srcMatch[1].startsWith("http")) return srcMatch[1];
        // Broader CDN URL search in decoded output
        var cdnMatch = unpacked.match(/https?:\/\/[a-z0-9.-]+\/[^\s"'<>]+\.mp4[^\s"'<>]*/i);
        if (cdnMatch) return cdnMatch[0];
      }

      // Strategy B: POST the download form; server 302s to the direct MP4 CDN URL
      var tokenMatch = kwikBody.match(/name=["']_token["'][^>]*value=["']([^"']+)["']/)
                    || kwikBody.match(/value=["']([^"']{20,})["'][^>]*name=["']_token["']/);
      if (!tokenMatch) return null;

      var actionMatch = kwikBody.match(/action=["'](https?:\/\/kwik\.[^"']+\/d\/[^"']+)["']/);
      if (!actionMatch) return null;
      var dlAction = actionMatch[1];

      var postRes = await this.client.post(
        dlAction,
        { "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": ua,
          "Referer": kwikFileUrl,
          "Origin": "https://kwik.cx" },
        "_token=" + encodeURIComponent(tokenMatch[1])
      );

      // Case 1: redirect NOT followed — Location header holds the direct URL
      if (postRes.headers) {
        var loc = postRes.headers["location"] || postRes.headers["Location"];
        if (loc && loc.startsWith("http")) return loc;
      }
      // Case 2: redirect WAS followed — final URL accessible via .url property
      if (postRes.url && /\.mp4/i.test(postRes.url)) return postRes.url;
      // Case 3: text response body may contain the CDN URL
      if (postRes.body && typeof postRes.body === "string") {
        var mp4Match = postRes.body.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/i);
        if (mp4Match) return mp4Match[0];
      }

      return null;
    } catch (e) {
      return null;
    }
  }

  // Fetch the /dl endpoint and resolve all kwik shortlinks to direct MP4 URLs
  async getDownloadStreams(url) {
    try {
      var dlData = await this.request("/dl/" + url);
      if (!Array.isArray(dlData) || dlData.length === 0) return [];

      var ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

      var streams = await Promise.all(
        dlData.map(async (item) => {
          try {
            if (!item.link) return null;
            var directUrl = await this.resolveKwikDownload(item.link);
            if (!directUrl) return null;
            return {
              url: directUrl,
              originalUrl: directUrl,
              quality: (item.name || "Download") + " [DIRECT DL]",
              headers: { "User-Agent": ua },
            };
          } catch (e) {
            return null;
          }
        })
      );

      return streams.filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  getFilterList() {
    throw new Error("getFilterList not implemented");
  }

  getSourcePreferences() {
    return [
      {
        key: "animetsu_base_url",
        editTextPreference: {
          title: "Override base url",
          summary: "",
          value: "https://animetsu.bz",
          dialogTitle: "Override base url",
          dialogMessage: "",
        },
      },
      {
        key: "animetsu_title_lang",
        listPreference: {
          title: "Preferred title language",
          summary: "Choose in which language anime title should be shown",
          valueIndex: 0,
          entries: ["English", "Romaji", "Native"],
          entryValues: ["english", "romaji", "native"],
        },
      },
      {
        key: "animetsu_pref_ep_description",
        switchPreferenceCompat: {
          title: "Episode description",
          summary: "",
          value: true,
        },
      },
      {
        key: "animetsu_pref_dl_links",
        switchPreferenceCompat: {
          title: "Fetch direct download links",
          summary: "Resolve kwik.cx URLs for direct MP4 downloads. WARNING: may delay episode loading by 30–60s if kwik.cx is slow.",
          value: false,
        },
      },
      {
        key: "animetsu_pref_stream_server",
        multiSelectListPreference: {
          title: "Preferred server",
          summary: "Choose the server/s you want to extract streams from",
          values: ["pahe", "kite", "meg", "kiss"],
          entries: ["Pahe", "Kite", "Meg", "Kiss"],
          entryValues: ["pahe", "kite", "meg", "kiss"],
        },
      },
      {
        key: "animetsu_pref_stream_subdub_type",
        multiSelectListPreference: {
          title: "Preferred stream sub/dub type",
          summary: "",
          values: ["sub", "dub"],
          entries: ["Sub", "Dub"],
          entryValues: ["sub", "dub"],
        },
      },
    ];
  }
}
