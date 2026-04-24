//update
const mangayomiSources = [
  {
    "name": "AnimeParadise",
    "id": 419768715,
    "lang": "en",
    "baseUrl": "https://animeparadise.moe",
    "apiUrl": "https://api.animeparadise.moe",
    "iconUrl":
      "https://www.google.com/s2/favicons?sz=128&domain=https://animeparadise.moe",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.2.5",
    "pkgPath": "anime/src/en/animeparadise.js",
  },
];

class DefaultExtension extends MProvider {
  getPreference(key) {
    const preferences = new SharedPreferences();
    return preferences.get(key);
  }

  async extractFromUrl(url) {
    var res = await new Client().get(this.source.baseUrl + url);
    var doc = new Document(res.body);
    var jsonData = doc.selectFirst("#__NEXT_DATA__").text;
    return JSON.parse(jsonData).props.pageProps;
  }

  async requestAPI(slug) {
    var api = `${this.source.apiUrl}/${slug}`;
    var response = await new Client().get(api);
    var body = JSON.parse(response.body);
    return body;
  }

  async formList(slug) {
    var jsonData = await this.requestAPI(slug);
    var list = [];
    var isEpisodeList = slug.includes("recently-added");
    if (isEpisodeList) {
      jsonData.data.forEach((item) => {
        list.push({
          "name": item.origin.title,
          "link": item.origin.link,
          "imageUrl": item.image,
        });
      });
    } else {
      jsonData.data.forEach((item) => {
        list.push({
          "name": item.title,
          "link": item.link,
          "imageUrl": item.posterImage.original,
        });
      });
    }

    return {
      "list": list,
      "hasNextPage": false,
    };
  }

  async getPopular(page) {
    return await this.formList("search?q=");
  }

  async getLatestUpdates(page) {
    var pref = this.getPreference("animeparadise_pref_latest_tab");
    if (pref === "recent_ani") {
      return await this.formList("search?q=");
    }
    return await this.formList("ep/recently-added");
  }
  async search(query, page, filters) {
    var season = filters[0].values[filters[0].state].value;
    var year = filters[1].values[filters[1].state].value;

    var genre = "genre[]=";
    for (var filter of filters[2].state) {
      if (filter.state == true) genre += `${filter.value}&genre[]=`;
    }
    var slug = `search?q=${query}&year=${year}&season=${season}&${genre}`;
    return await this.formList(slug);
  }
  statusCode(status) {
    return (
      {
        "current": 0,
        "finished": 1,
      }[status] ?? 5
    );
  }

  async getDetail(url) {
    var linkSlug = this.source.baseUrl + `/anime/`;
    if (url.includes(linkSlug)) url = url.replace(linkSlug, "");

    var res = await this.requestAPI(`anime/${url}`);
    var jsonData = res.data;
    var details = {};
    var chapters = [];
    details.imageUrl = jsonData.posterImage.original;
    details.description = jsonData.synopsys;
    details.genre = jsonData.genres;
    details.status = this.statusCode(jsonData.status);
    var id = jsonData._id;
    var epAPI = await this.requestAPI(`anime/${id}/episode`);
    epAPI.data.forEach((ep) => {
      var epName = `E${ep.number}: ${ep.title}`;
      var epUrl = `${ep.uid}?origin=${ep.origin}`;
      chapters.push({ name: epName, url: epUrl });
    });
    details.link = `${linkSlug}${url}`;
    details.chapters = chapters.reverse();
    return details;
  }
  // Sorts streams based on user preference.
  async sortStreams(streams) {
    var sortedStreams = [];
    var copyStreams = streams.slice();

    var pref = await this.getPreference("animeparadise_pref_video_resolution");
    for (var stream of streams) {
      if (stream.quality.indexOf(pref) > -1) {
        sortedStreams.push(stream);
        var index = copyStreams.indexOf(stream);
        if (index > -1) {
          copyStreams.splice(index, 1);
        }
        break;
      }
    }
    return [...sortedStreams, ...copyStreams];
  }

  // Rewrites relative segment lines in an m3u8 body to absolute URLs.
  rewriteM3u8Segments(body, baseUrl) {
    return body.split("\n").map(line => {
      var trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        return trimmed.startsWith("http") ? trimmed : baseUrl + trimmed;
      }
      return line;
    }).join("\n");
  }

  // Encodes rewritten m3u8 content as a data URI so Mangayomi's downloader
  // gets absolute segment URLs instead of bare filenames.
  m3u8ToDataUri(content) {
    var encoded = btoa(unescape(encodeURIComponent(content)));
    return "data:application/vnd.apple.mpegurl;base64," + encoded;
  }

  // Extracts the streams url for different resolutions from a hls stream.
  async extractStreams(url) {
    var proxyUrl = "https://stream.animeparadise.moe/";
    var streamHeaders = {
      "Referer": "https://animeparadise.moe/",
      "Origin": "https://animeparadise.moe",
    };
    var proxiedUrl = proxyUrl + "m3u8?url=" + url;
    var streams = [];

    const response = await new Client().get(proxiedUrl, streamHeaders);
    if (response.statusCode == 200) {
      const body = response.body;
      const lines = body.split("\n");
      var hasMaster = lines.some(l => l.startsWith("#EXT-X-STREAM-INF:"));

      if (hasMaster) {
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith("#EXT-X-STREAM-INF:")) {
            var resolution = lines[i].match(/RESOLUTION=(\d+x\d+)/)[1];
            var nextLine = lines[i + 1].trim();
            var qualityUrl = nextLine.startsWith("http") ? nextLine : proxyUrl + nextLine;

            try {
              var qRes = await new Client().get(qualityUrl, streamHeaders);
              if (qRes.statusCode == 200) {
                var rewritten = this.rewriteM3u8Segments(qRes.body, proxyUrl);
                var dataUri = this.m3u8ToDataUri(rewritten);
                streams.push({
                  url: qualityUrl,
                  originalUrl: dataUri,
                  quality: resolution,
                  headers: streamHeaders,
                });
              }
            } catch (e) {
              streams.push({
                url: qualityUrl,
                originalUrl: qualityUrl,
                quality: resolution,
                headers: streamHeaders,
              });
            }
          }
        }
      }

      // Always include Auto using the rewritten master/media content
      var rewrittenAuto = this.rewriteM3u8Segments(body, proxyUrl);
      var autoDataUri = this.m3u8ToDataUri(rewrittenAuto);
      streams.unshift({
        url: proxiedUrl,
        originalUrl: autoDataUri,
        quality: "Auto",
        headers: streamHeaders,
      });
    } else {
      streams.push({
        url: proxiedUrl,
        originalUrl: proxiedUrl,
        quality: "Auto",
        headers: streamHeaders,
      });
    }

    return streams;
  }

  // For anime episode video list
  async getVideoList(url) {
    var jsonData = await this.requestAPI(`ep/${url}`);
    var epData = jsonData.data.episode;
    var streams = await this.extractStreams(epData.streamLink);

    var subtitles = [];
    epData.subData.forEach((sub) => {
      subtitles.push({
        "label": sub.label,
        "file": `${this.source.apiUrl}/stream/file/${sub.src}`,
      });
    });

    streams[0].subtitles = subtitles;

    return streams;
  }

  addCatogory(arr, typ) {
    arr = arr.map((x) => ({ type_name: typ, name: x, value: x }));
    arr.unshift({
      type_name: typ,
      name: "All",
      value: "",
    });
    return arr;
  }

  getFilterList() {
    var seasons = ["Winter", "Spring", "Summer", "Fall"];

    const currentYear = new Date().getFullYear();
    var years = Array.from({ length: currentYear - 1939 }, (_, i) =>
      (i + 1940).toString()
    ).reverse();

    var genres = [
      "Action",
      "Adventure",
      "Comedy",
      "Drama",
      "Ecchi",
      "Fantasy",
      "Horror",
      "Mahou Shojo",
      "Mecha",
      "Music",
      "Mystery",
      "Psychological",
      "Romance",
      "Sci-Fi",
      "Slice of Life",
      "Sports",
      "Supernatural",
      "Thriller",
    ].map((x) => ({ type_name: "CheckBox", name: x, value: x }));

    return [
      {
        type_name: "SelectFilter",
        name: "Season",
        state: 0,
        values: this.addCatogory(seasons, "SelectOption"),
      },
      {
        type_name: "SelectFilter",
        name: "Year",
        state: 0,
        values: this.addCatogory(years, "SelectOption"),
      },
      {
        type_name: "GroupFilter",
        name: "Genres",
        state: genres,
      },
    ];
  }

  getSourcePreferences() {
    return [
      {
        key: "animeparadise_pref_latest_tab",
        listPreference: {
          title: "Latest tab category",
          summary: "Anime list to be shown in latest tab",
          valueIndex: 0,
          entries: ["Recently added anime", "Recently added episode"],
          entryValues: ["recent_ani", "recent_ep"],
        },
      },
      {
        key: "animeparadise_pref_video_resolution",
        listPreference: {
          title: "Preferred video resolution",
          summary: "",
          valueIndex: 0,
          entries: ["Auto", "1080p", "720p", "360p"],
          entryValues: ["auto", "1080", "720", "360"],
        },
      },
    ];
  }
}
