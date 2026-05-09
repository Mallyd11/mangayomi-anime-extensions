const mangayomiSources = [
  {
    "name": "Miruro",
    "id": 617345892,
    "baseUrl": "https://www.miruro.tv",
    "lang": "en",
    "typeSource": "single",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://www.miruro.tv",
    "dateFormat": "",
    "dateFormatLocale": "",
    "isNsfw": false,
    "hasCloudflare": false,
    "sourceCodeUrl": "",
    "apiUrl": "https://public-miruro-consumet-api.vercel.app/",
    "version": "1.0.0",
    "isManga": false,
    "itemType": 1,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "additionalParams": "",
    "sourceCodeLanguage": 1,
    "notes": "",
    "pkgPath": "anime/src/en/miruro.js",
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

  getApiUrl() {
    var url = this.getPreference("miruro_api_url");
    return url.endsWith("/") ? url : url + "/";
  }

  get headers() {
    return {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Referer": this.source.baseUrl + "/",
    };
  }

  async request(path) {
    var url = this.getApiUrl() + path;
    var res = await this.client.get(url, this.headers);
    if (res.statusCode !== 200) {
      throw new Error("HTTP " + res.statusCode + " for " + url);
    }
    return JSON.parse(res.body);
  }

  getTitle(title, pref) {
    if (!title) return "Unknown";
    return title[pref] || title.english || title.romaji || title.userPreferred || "Unknown";
  }

  statusCode(status) {
    return (
      {
        Ongoing: 0,
        Completed: 1,
        "Not yet aired": 4,
      }[status] ?? 5
    );
  }

  parseList(results, titlePref) {
    var list = [];
    if (!results || !Array.isArray(results)) return list;
    results.forEach((item) => {
      var name = this.getTitle(item.title, titlePref);
      var link = String(item.id);
      var imageUrl = item.image || item.cover || "";
      if (name && link) {
        list.push({ name, link, imageUrl });
      }
    });
    return list;
  }

  async getPopular(page) {
    var titlePref = this.getPreference("miruro_title_lang");
    var data = await this.request(
      "meta/anilist/trending?page=" + page + "&perPage=20"
    );
    var list = this.parseList(data.results, titlePref);
    var hasNextPage = data.hasNextPage === true;
    return { list, hasNextPage };
  }

  async getLatestUpdates(page) {
    var titlePref = this.getPreference("miruro_title_lang");
    var data = await this.request(
      "meta/anilist/advanced-search?type=ANIME&status=RELEASING&sort=%5B%22UPDATED_AT_DESC%22%5D&page=" +
        page +
        "&perPage=20"
    );
    var list = this.parseList(data.results, titlePref);
    var hasNextPage = data.hasNextPage === true;
    return { list, hasNextPage };
  }

  async search(query, page, filters) {
    var titlePref = this.getPreference("miruro_title_lang");
    var path =
      "meta/anilist/advanced-search?type=ANIME&page=" +
      page +
      "&perPage=20";

    if (query && query.length > 0) {
      path += "&query=" + encodeURIComponent(query);
    }

    // Apply filters
    if (filters && Array.isArray(filters)) {
      for (var filter of filters) {
        if (filter.type_name === "SelectFilter" && filter.state > 0) {
          var val = filter.values[filter.state].value;
          if (filter.name === "Season") path += "&season=" + val;
          else if (filter.name === "Format") path += "&format=" + val;
          else if (filter.name === "Status") path += "&status=" + val;
          else if (filter.name === "Year") path += "&year=" + val;
          else if (filter.name === "Sort") path += "&sort=%5B%22" + val + "%22%5D";
        } else if (filter.type_name === "GroupFilter") {
          var genres = [];
          for (var item of filter.state) {
            if (item.state === true) genres.push(item.value);
          }
          if (genres.length > 0) {
            path += "&genres=" + encodeURIComponent(JSON.stringify(genres));
          }
        }
      }
    }

    var data = await this.request(path);
    var list = this.parseList(data.results, titlePref);
    var hasNextPage = data.hasNextPage === true;
    return { list, hasNextPage };
  }

  async getDetail(url) {
    var animeId = url.includes("/") ? url.split("/").pop() : url;
    var titlePref = this.getPreference("miruro_title_lang");
    var dubPref = this.getPreference("miruro_pref_dub");
    var isDub = dubPref === "dub";

    var info = await this.request(
      "meta/anilist/info/" + animeId + "?provider=gogoanime"
    );

    var name = this.getTitle(info.title, titlePref);
    var imageUrl = info.image || info.cover || "";
    var description = info.description || "";
    var status = this.statusCode(info.status);
    var genre = info.genres || [];
    var link = this.source.baseUrl + "/watch/" + animeId;

    // Fetch episodes (sub or dub)
    var episodes = [];
    try {
      episodes = await this.request(
        "meta/anilist/episodes/" +
          animeId +
          "?provider=gogoanime&dub=" +
          (isDub ? "true" : "false")
      );
    } catch (e) {
      // Fall back to info episodes
      episodes = info.episodes || [];
    }

    if (!Array.isArray(episodes) || episodes.length === 0) {
      episodes = info.episodes || [];
    }

    var chapters = [];
    episodes.forEach((ep) => {
      var epNum = ep.number || ep.id;
      var epTitle = ep.title || ("Episode " + epNum);
      var name = "E" + epNum + (ep.title ? " : " + ep.title : "");
      var token = ep.id || String(epNum);
      var imageUrl = ep.image || "";
      var dateUpload = ep.airDate
        ? String(new Date(ep.airDate).valueOf())
        : null;
      chapters.push({
        name: name,
        url: token,
        isFiller: false,
        thumbnailUrl: imageUrl,
        description: ep.description || null,
        dateUpload: dateUpload,
      });
    });

    chapters.reverse();
    return { name, imageUrl, link, description, genre, status, chapters };
  }

  async getVideoList(url) {
    var dubPref = this.getPreference("miruro_pref_dub");
    var isDub = dubPref === "dub";
    var label = isDub ? "DUB" : "SUB";

    var data = await this.request(
      "meta/anilist/watch/" + encodeURIComponent(url)
    );

    if (!data || !data.sources || data.sources.length === 0) {
      return [];
    }

    var streamHeaders = Object.assign({}, this.headers);
    if (data.headers && data.headers.Referer) {
      streamHeaders["Referer"] = data.headers.Referer;
    }

    // Build subtitles list
    var subtitles = [];
    if (data.subtitles && Array.isArray(data.subtitles)) {
      data.subtitles.forEach((sub) => {
        if (sub.url && sub.lang && sub.lang !== "Thumbnails") {
          subtitles.push({ file: sub.url, label: sub.lang });
        }
      });
    }

    var streams = [];
    var autoStream = null;

    for (var source of data.sources) {
      if (!source.url) continue;

      var quality = source.quality || "auto";
      var isM3U8 = source.isM3U8 === true || source.url.includes(".m3u8");

      if (quality === "auto" || quality === "default") {
        // Try to parse master playlist for individual qualities
        autoStream = { url: source.url, isM3U8, headers: streamHeaders };
      } else {
        // Already a specific quality variant
        var qLabel = quality.toUpperCase() + " [" + label + "]";
        streams.push({
          url: source.url,
          originalUrl: source.url,
          quality: qLabel,
          headers: streamHeaders,
          subtitles: subtitles,
        });
      }
    }

    // If we only got an "auto" master playlist, parse it for quality variants
    if (autoStream && streams.length === 0) {
      try {
        var masterRes = await this.client.get(autoStream.url, streamHeaders);
        if (masterRes.statusCode === 200 && masterRes.body.includes("#EXT-X-STREAM-INF")) {
          var lines = masterRes.body.split("\n");
          var baseDir = autoStream.url.substring(0, autoStream.url.lastIndexOf("/") + 1);
          var first = true;
          for (var i = 0; i < lines.length; i++) {
            if (lines[i].startsWith("#EXT-X-STREAM-INF:")) {
              var resMatch = lines[i].match(/RESOLUTION=(\d+x\d+)/);
              var bwMatch = lines[i].match(/BANDWIDTH=(\d+)/);
              var resolution = resMatch ? resMatch[1] : null;
              var bw = bwMatch ? parseInt(bwMatch[1]) : 0;
              var nextLine = lines[i + 1] ? lines[i + 1].trim() : "";
              if (!nextLine || nextLine.startsWith("#")) continue;
              var variantUrl = nextLine.startsWith("http") ? nextLine : baseDir + nextLine;
              var qLabel = (resolution || Math.round(bw / 1000) + "kbps") + " [" + label + "]";
              var stream = {
                url: variantUrl,
                originalUrl: variantUrl,
                quality: qLabel,
                headers: streamHeaders,
              };
              if (first) {
                stream.subtitles = subtitles;
                first = false;
              }
              streams.push(stream);
            }
          }
        }
      } catch (e) {}

      // Fallback: return the auto stream if parsing failed
      if (streams.length === 0) {
        streams.push({
          url: autoStream.url,
          originalUrl: autoStream.url,
          quality: "Auto [" + label + "]",
          headers: streamHeaders,
          subtitles: subtitles,
        });
      }
    }

    // If no specific streams yet but we have an auto stream, add it as fallback too
    if (autoStream && streams.length > 0) {
      streams.push({
        url: autoStream.url,
        originalUrl: autoStream.url,
        quality: "Auto [" + label + "]",
        headers: streamHeaders,
        subtitles: [],
      });
    }

    return streams;
  }

  getFilterList() {
    return [
      {
        type_name: "SelectFilter",
        name: "Sort",
        state: 0,
        values: [
          { type_name: "SelectOption", name: "Default", value: "" },
          { type_name: "SelectOption", name: "Trending", value: "TRENDING_DESC" },
          { type_name: "SelectOption", name: "Popularity", value: "POPULARITY_DESC" },
          { type_name: "SelectOption", name: "Score", value: "SCORE_DESC" },
          { type_name: "SelectOption", name: "Newest", value: "START_DATE_DESC" },
          { type_name: "SelectOption", name: "Oldest", value: "START_DATE" },
        ],
      },
      {
        type_name: "SelectFilter",
        name: "Season",
        state: 0,
        values: [
          { type_name: "SelectOption", name: "Any", value: "" },
          { type_name: "SelectOption", name: "Winter", value: "WINTER" },
          { type_name: "SelectOption", name: "Spring", value: "SPRING" },
          { type_name: "SelectOption", name: "Summer", value: "SUMMER" },
          { type_name: "SelectOption", name: "Fall", value: "FALL" },
        ],
      },
      {
        type_name: "SelectFilter",
        name: "Format",
        state: 0,
        values: [
          { type_name: "SelectOption", name: "Any", value: "" },
          { type_name: "SelectOption", name: "TV", value: "TV" },
          { type_name: "SelectOption", name: "TV Short", value: "TV_SHORT" },
          { type_name: "SelectOption", name: "Movie", value: "MOVIE" },
          { type_name: "SelectOption", name: "OVA", value: "OVA" },
          { type_name: "SelectOption", name: "ONA", value: "ONA" },
          { type_name: "SelectOption", name: "Special", value: "SPECIAL" },
        ],
      },
      {
        type_name: "SelectFilter",
        name: "Status",
        state: 0,
        values: [
          { type_name: "SelectOption", name: "Any", value: "" },
          { type_name: "SelectOption", name: "Airing", value: "RELEASING" },
          { type_name: "SelectOption", name: "Finished", value: "FINISHED" },
          { type_name: "SelectOption", name: "Not Yet Aired", value: "NOT_YET_RELEASED" },
          { type_name: "SelectOption", name: "Cancelled", value: "CANCELLED" },
        ],
      },
      {
        type_name: "SelectFilter",
        name: "Year",
        state: 0,
        values: [
          { type_name: "SelectOption", name: "Any", value: "" },
          { type_name: "SelectOption", name: "2025", value: "2025" },
          { type_name: "SelectOption", name: "2024", value: "2024" },
          { type_name: "SelectOption", name: "2023", value: "2023" },
          { type_name: "SelectOption", name: "2022", value: "2022" },
          { type_name: "SelectOption", name: "2021", value: "2021" },
          { type_name: "SelectOption", name: "2020", value: "2020" },
          { type_name: "SelectOption", name: "2019", value: "2019" },
          { type_name: "SelectOption", name: "2018", value: "2018" },
          { type_name: "SelectOption", name: "2017", value: "2017" },
          { type_name: "SelectOption", name: "2016", value: "2016" },
          { type_name: "SelectOption", name: "2015", value: "2015" },
          { type_name: "SelectOption", name: "2010", value: "2010" },
          { type_name: "SelectOption", name: "2005", value: "2005" },
          { type_name: "SelectOption", name: "2000", value: "2000" },
        ],
      },
      {
        type_name: "GroupFilter",
        name: "Genres",
        state: [
          { type_name: "CheckBox", name: "Action", value: "Action", state: false },
          { type_name: "CheckBox", name: "Adventure", value: "Adventure", state: false },
          { type_name: "CheckBox", name: "Comedy", value: "Comedy", state: false },
          { type_name: "CheckBox", name: "Drama", value: "Drama", state: false },
          { type_name: "CheckBox", name: "Ecchi", value: "Ecchi", state: false },
          { type_name: "CheckBox", name: "Fantasy", value: "Fantasy", state: false },
          { type_name: "CheckBox", name: "Horror", value: "Horror", state: false },
          { type_name: "CheckBox", name: "Mahou Shoujo", value: "Mahou Shoujo", state: false },
          { type_name: "CheckBox", name: "Mecha", value: "Mecha", state: false },
          { type_name: "CheckBox", name: "Music", value: "Music", state: false },
          { type_name: "CheckBox", name: "Mystery", value: "Mystery", state: false },
          { type_name: "CheckBox", name: "Psychological", value: "Psychological", state: false },
          { type_name: "CheckBox", name: "Romance", value: "Romance", state: false },
          { type_name: "CheckBox", name: "Sci-Fi", value: "Sci-Fi", state: false },
          { type_name: "CheckBox", name: "Slice of Life", value: "Slice of Life", state: false },
          { type_name: "CheckBox", name: "Sports", value: "Sports", state: false },
          { type_name: "CheckBox", name: "Supernatural", value: "Supernatural", state: false },
          { type_name: "CheckBox", name: "Thriller", value: "Thriller", state: false },
        ],
      },
    ];
  }

  getSourcePreferences() {
    return [
      {
        key: "miruro_api_url",
        editTextPreference: {
          title: "Override API URL",
          summary: "Consumet-compatible API base URL",
          value: "https://public-miruro-consumet-api.vercel.app/",
          dialogTitle: "Override API URL",
          dialogMessage: "Must end with / and be a consumet-compatible API",
        },
      },
      {
        key: "miruro_title_lang",
        listPreference: {
          title: "Preferred title language",
          summary: "Language for anime titles",
          valueIndex: 0,
          entries: ["English", "Romaji", "Native", "User Preferred"],
          entryValues: ["english", "romaji", "native", "userPreferred"],
        },
      },
      {
        key: "miruro_pref_dub",
        listPreference: {
          title: "Audio preference",
          summary: "Sub or Dub",
          valueIndex: 0,
          entries: ["Sub", "Dub"],
          entryValues: ["sub", "dub"],
        },
      },
    ];
  }
}
