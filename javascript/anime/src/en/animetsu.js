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
    "version": "1.1.7",
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

    var epThumbPref = this.getPreference("animetsu_pref_ep_thumbnail");
    var epDescPref = this.getPreference("animetsu_pref_ep_description");
    epData.forEach((item) => {
      var ep_num = item.ep_num;
      var ep_title = item.name;
      var epName = format == "MOVIE" ? ep_title : `E${ep_num} : ${ep_title}`;
      var isFiller = item.is_filler;
      var token = `${id}/${ep_num}`;

      var thumbnailUrl = epThumbPref ? this.getProxyMediaUrl(item.img) : null;
      var epDescription = epDescPref ? item.desc : null;
      var dateUpload = item.hasOwnProperty("aired_at")
        ? new Date(item.aired_at).valueOf().toString()
        : null;

      chapters.push({
        name: epName,
        url: token,
        isFiller,
        thumbnailUrl,
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
          var epSlug = `/oppai/${url}?server=${serverName}&source_type=${audioType}`;
          var epData = await this.request(epSlug);

          if (!epData.hasOwnProperty("sources")) return [];

          if (serverName == "pahe" || serverName == "meg") {
            return this.getPaheMegStreams(epData.sources, audioType, serverName);
          } else if (serverName == "kite") {
            return await this.getKiteStreams(epData, audioType);
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
      this.getDownloadStreams(url),
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
      var isMp4 = item.type === "video/mp4" || item.old_hls === false;
      var label = isMp4
        ? this.streamNamer(quality + " [DL]", audioType, serverName)
        : this.streamNamer(quality, audioType, serverName);
      streams.push({
        url: link,
        originalUrl: link,
        quality: label,
        headers: hdr,
      });
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
                originalUrl: variantUrl,
                quality: this.streamNamer(resolution, "soft" + audioType, "kite"),
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
          originalUrl: masterUrl,
          quality: this.streamNamer("Auto", "soft" + audioType, "kite"),
          headers: hdr,
          subtitles: subtitles,
        });
      }
    }

    return streams;
  }

  // Resolve a pahe.win shortlink → kwik.cx download form → direct MP4 URL
  async resolveKwikDownload(paheWinUrl) {
    try {
      var ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

      // Step 1: GET pahe.win page — it contains the kwik.cx/f/{hash} URL in JS
      // e.g. $("a.redirect").attr("href","https://kwik.cx/f/HASH")
      var paheRes = await this.client.get(paheWinUrl, {
        "User-Agent": ua,
        "Referer": "https://animetsu.bz/",
      });
      var paheBody = paheRes.body || "";

      // Extract kwik.cx URL from the countdown script
      var kwikMatch = paheBody.match(/["'](https?:\/\/kwik\.cx\/f\/[^"']+)["']/);
      if (!kwikMatch) return null;
      var kwikFileUrl = kwikMatch[1];

      // Step 2: GET kwik.cx/f/{hash} download page
      var kwikRes = await this.client.get(kwikFileUrl, {
        "User-Agent": ua,
        "Referer": "https://pahe.win/",
      });
      var kwikBody = kwikRes.body || "";
      if (kwikBody.length < 50) return null;

      // Step 3: Extract Laravel CSRF token — handle both attribute orderings
      var tokenMatch = kwikBody.match(/name=["']_token["'][^>]*value=["']([^"']+)["']/)
                    || kwikBody.match(/value=["']([^"']{20,})["'][^>]*name=["']_token["']/);
      if (!tokenMatch) return null;
      var csrfToken = tokenMatch[1];

      // Extract form action URL e.g. https://kwik.cx/d/HASH
      var actionMatch = kwikBody.match(/action=["'](https?:\/\/kwik\.[^"']+\/d\/[^"']+)["']/);
      if (!actionMatch) return null;
      var dlAction = actionMatch[1];

      // Step 4: POST to kwik.cx/d/{hash} — server 302s to the direct MP4 URL
      var postRes = await this.client.post(
        dlAction,
        { "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": ua,
          "Referer": kwikFileUrl,
          "Origin": "https://kwik.cx" },
        "_token=" + encodeURIComponent(csrfToken)
      );

      // 302 redirect Location header is the direct MP4 URL
      if (postRes.headers) {
        var directUrl = postRes.headers["location"] || postRes.headers["Location"];
        if (directUrl && directUrl.startsWith("http")) return directUrl;
      }

      // If client auto-followed the redirect, look for MP4 URL in body
      if (postRes.body) {
        var mp4Match = postRes.body.match(/https?:\/\/[^\s"'<>]*\.mp4[^\s"'<>]*/);
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
        key: "animetsu_pref_ep_thumbnail",
        switchPreferenceCompat: {
          title: "Episode thumbail",
          summary: "",
          value: true,
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
          summary: "Resolve kwik.cx URLs for direct MP4 downloads (adds extra requests on episode load)",
          value: true,
        },
      },
      {
        key: "animetsu_pref_stream_server",
        multiSelectListPreference: {
          title: "Preferred server",
          summary: "Choose the server/s you want to extract streams from",
          values: ["pahe", "kite", "meg"],
          entries: ["Pahe", "Kite", "Meg"],
          entryValues: ["pahe", "kite", "meg"],
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
