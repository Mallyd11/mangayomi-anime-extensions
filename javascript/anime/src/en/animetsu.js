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
    "version": "1.5.0",
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
    try {
      return await this.searchAnime({ query: query, page: page });
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
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
      var epName = ep_title
        ? (format == "MOVIE" ? ep_title : `Episode ${ep_num} : ${ep_title}`)
        : `Episode ${ep_num}`;
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
    if (serverPref.length < 1) serverPref.push("meg");

    var audioPref = this.getPreference("animetsu_pref_stream_subdub_type");
    if (audioPref.length < 1) audioPref.push("sub");

    var urlParts = url.split("/");
    var anilistUrl = urlParts[0] + "/" + urlParts[1];

    var combinations = [];
    for (var serverName of serverPref) {
      for (var audioType of audioPref) {
        combinations.push({ serverName, audioType });
      }
    }

    var results = await Promise.all(
      combinations.map(async ({ serverName, audioType }) => {
        try {
          var epSlug = `/oppai/${anilistUrl}?server=${serverName}&source_type=${audioType}`;
          var epData = await this.request(epSlug);
          if (!epData.hasOwnProperty("sources")) return [];
          return await this.getDioKissStreams(epData, audioType, serverName);
        } catch (e) {
          return [];
        }
      })
    );

    return results.flat();
  }

  streamNamer(res, dubType, serverName) {
    return `${res.toUpperCase()} - ${dubType.toUpperCase()} : ${serverName.toUpperCase()}`;
  }

  // All servers route through here.
  // old_hls=false → HLS master: pre-parse variants so the player gets a direct
  // playlist URL rather than an adaptive master.
  // old_hls=true  → already a direct playlist: pass through unchanged.
  // kiss/sage = soft-sub → "soft" prefix in quality label.
  async getDioKissStreams(epData, audioType, serverName) {
    var hdr = this.getHeaders();
    var subtitles = [];
    if (epData.hasOwnProperty("subs")) {
      epData.subs.forEach((item) => {
        subtitles.push({ file: item.url, label: item.lang, headers: hdr });
      });
    }

    var isSoftSub = serverName === "kiss" || serverName === "sage";

    // Fetch all source masters in parallel instead of sequentially.
    var perSource = await Promise.all(epData.sources.map(async (item) => {
      var masterUrl = this.getProxyMediaUrl(item.url);
      var audioLabel = isSoftSub ? "soft" + audioType : audioType;
      var result = [];
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
                result.push({
                  url: variantUrl,
                  originalUrl: variantUrl, // no extension — libmpv via content-type, not M3u8Downloader
                  quality: this.streamNamer(resolution, audioLabel, serverName),
                  headers: hdr,
                  subtitles: subtitles,
                });
                parsed = true;
              }
            }
          }
        } catch (e) {}
      }

      // Direct playlist (old_hls == true) or master parse failed — pass through like Pahe.
      if (!parsed) {
        result.push({
          url: masterUrl,
          originalUrl: masterUrl,
          quality: this.streamNamer(item.quality || "auto", audioLabel, serverName),
          headers: hdr,
          subtitles: subtitles,
        });
      }

      // Highest resolution first so the player auto-selects best quality.
      result.sort((a, b) => {
        var hA = parseInt((a.quality.match(/\d+[xX](\d+)/) || [0, 0])[1]) || 0;
        var hB = parseInt((b.quality.match(/\d+[xX](\d+)/) || [0, 0])[1]) || 0;
        return hB - hA;
      });

      return result;
    }));

    return perSource.flat();
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
        key: "animetsu_pref_stream_server",
        multiSelectListPreference: {
          title: "Preferred server",
          summary: "Fewer servers = faster load.",
          values: ["meg"],
          entries: ["Meg", "Kiss", "Pahe", "Dio", "Sage"],
          entryValues: ["meg", "kiss", "pahe", "dio", "sage"],
        },
      },
      {
        key: "animetsu_pref_stream_subdub_type",
        multiSelectListPreference: {
          title: "Preferred stream sub/dub type",
          summary: "Selecting both Sub and Dub doubles the number of requests per server.",
          values: ["sub"],
          entries: ["Sub", "Dub"],
          entryValues: ["sub", "dub"],
        },
      },
    ];
  }
}
