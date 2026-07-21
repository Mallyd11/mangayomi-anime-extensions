const mangayomiSources = [
  {
    "name": "Miruro",
    "id": 617345892,
    "baseUrl": "https://www.miruro.to",
    "lang": "en",
    "typeSource": "single",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://www.miruro.to",
    "dateFormat": "",
    "dateFormatLocale": "",
    "isNsfw": false,
    "hasCloudflare": false,
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/miruro.js",
    "apiUrl": "",
    "version": "6.1.9",
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

  get ua() {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
  }

  pref(key) {
    return new SharedPreferences().get(key);
  }

  // ── AniList GraphQL ────────────────────────────────────────────────────────

  async anilist(query, vars) {
    try {
      var res = await this.client.post(
        "https://graphql.anilist.co",
        { "Content-Type": "application/json", "Accept": "application/json" },
        { query: query, variables: vars || {} }
      );
      if (!res || res.statusCode !== 200) return {};
      var d = JSON.parse(res.body);
      return (d && d.data) ? d.data : {};
    } catch (e) { return {}; }
  }

  preferredTitle(t) {
    if (!t) return "Unknown";
    var lang = this.pref("miruro_lang") || "english";
    return t[lang] || t.english || t.romaji || t.native || "Unknown";
  }

  mediaToItem(m) {
    return {
      name: this.preferredTitle(m.title),
      link: "https://www.miruro.to/info/" + m.id,
      imageUrl: (m.coverImage && m.coverImage.large) || "",
    };
  }

  // ── Browse ─────────────────────────────────────────────────────────────────

  async getPopular(page) {
    try {
      var n = page || 1;
      var d = await this.anilist("{Page(page:" + n + ",perPage:20){pageInfo{hasNextPage}media(sort:[POPULARITY_DESC],type:ANIME,isAdult:false){id title{romaji english}coverImage{large}}}}");
      var pg = d.Page || {};
      var self = this;
      return { list: (pg.media || []).map(function(m) { return self.mediaToItem(m); }), hasNextPage: !!(pg.pageInfo && pg.pageInfo.hasNextPage) };
    } catch (e) { return { list: [], hasNextPage: false }; }
  }

  async getLatestUpdates(page) {
    try {
      var n = page || 1;
      var d = await this.anilist(
        "query($p:Int){Page(page:$p,perPage:40){pageInfo{hasNextPage}airingSchedules(notYetAired:false,sort:[TIME_DESC]){media{id title{romaji english}coverImage{large}}}}}",
        { p: n }
      );
      var pg = d.Page || {};
      var seen = {};
      var list = [];
      var self = this;
      var schedules = pg.airingSchedules || [];
      for (var i = 0; i < schedules.length; i++) {
        var m = schedules[i].media;
        if (m && !seen[m.id]) {
          seen[m.id] = true;
          list.push(self.mediaToItem(m));
          if (list.length >= 20) break;
        }
      }
      return { list: list, hasNextPage: !!(pg.pageInfo && pg.pageInfo.hasNextPage) };
    } catch (e) { return { list: [], hasNextPage: false }; }
  }

  async search(query, page, filters) {
    try {
      var n = page || 1;
      var conds = ["type:ANIME", "isAdult:false"], args = "$p:Int,$n:Int", vars = { p: n, n: 20 };
      if (query && query.length) { conds.push("search:$q"); args += ",$q:String"; vars.q = query; }
      else { conds.push("sort:TRENDING_DESC"); }
      if (filters && Array.isArray(filters)) {
        for (var fi = 0; fi < filters.length; fi++) {
          var f = filters[fi];
          if (f.type_name === "SelectFilter" && f.state > 0) {
            var v = f.values[f.state].value;
            if (f.name === "Season" && v) { conds.push("season:$season"); args += ",$season:MediaSeason"; vars.season = v; }
            else if (f.name === "Format" && v) { conds.push("format:$format"); args += ",$format:MediaFormat"; vars.format = v; }
            else if (f.name === "Status" && v) { conds.push("status:$status"); args += ",$status:MediaStatus"; vars.status = v; }
            else if (f.name === "Year"   && v) { conds.push("seasonYear:$yr"); args += ",$yr:Int"; vars.yr = parseInt(v); }
            else if (f.name === "Sort"   && v) { conds.push("sort:[$sort]"); args += ",$sort:[MediaSort]"; vars.sort = [v]; }
          } else if (f.type_name === "GroupFilter") {
            var genres = [], gs = f.state || [];
            for (var gi = 0; gi < gs.length; gi++) if (gs[gi].state === true) genres.push(gs[gi].value);
            if (genres.length) { conds.push("genre_in:$genres"); args += ",$genres:[String]"; vars.genres = genres; }
          }
        }
      }
      var q = "query(" + args + "){Page(page:$p,perPage:$n){pageInfo{hasNextPage}media(" + conds.join(",") + "){id title{romaji english}coverImage{large}}}}";
      var d = await this.anilist(q, vars);
      var pg = d.Page || {};
      var self = this;
      return { list: (pg.media || []).map(function(m) { return self.mediaToItem(m); }), hasNextPage: !!(pg.pageInfo && pg.pageInfo.hasNextPage) };
    } catch (e) { return { list: [], hasNextPage: false }; }
  }

  // ── Detail ─────────────────────────────────────────────────────────────────

  async getDetail(url) {
    var id = parseInt(url, 10);
    if (!id) { var m2 = url.match(/(\d+)/); id = m2 ? parseInt(m2[1], 10) : 0; }
    if (!id) throw new Error("cannot parse AniList ID from: " + url);

    var _d = await this.anilist(
      "{Media(id:" + id + ",type:ANIME){" +
        "id idMal title{romaji english native} coverImage{large extraLarge}" +
        " description status episodes nextAiringEpisode{episode} genres" +
      "}}"
    );
    var m = _d.Media || null;

    var statusMap = { RELEASING: 0, FINISHED: 1, NOT_YET_RELEASED: 4, CANCELLED: 5, HIATUS: 5 };
    var status = m ? (statusMap[m.status] !== undefined ? statusMap[m.status] : 5) : 5;

    var epCount = 0;
    if (m) {
      if (m.status === "RELEASING") {
        epCount = (m.nextAiringEpisode && m.nextAiringEpisode.episode > 1)
          ? m.nextAiringEpisode.episode - 1 : (m.episodes || 0);
      } else {
        epCount = m.episodes || 0;
      }
    }

    var chapters = [];
    for (var i = 1; i <= epCount; i++) {
      chapters.push({
        name: "Episode " + i,
        url: JSON.stringify({ animeId: id, num: i }),
        isFiller: false,
      });
    }
    if (!chapters.length) {
      chapters.push({ name: "No episodes available", url: "n/a", isFiller: false });
    }
    chapters.reverse();

    return {
      name:        m ? this.preferredTitle(m.title) : "Unknown",
      imageUrl:    m && m.coverImage ? (m.coverImage.extraLarge || m.coverImage.large || "") : "",
      description: m && m.description ? m.description.replace(/<[^>]+>/g, "") : "",
      genre:       m && m.genres ? m.genres : [],
      status:      status,
      link:        "https://www.miruro.to/info/" + id,
      chapters:    chapters,
    };
  }

  // ── HLS playlist resolver ──────────────────────────────────────────────────

  async resolveMasterPlaylist(masterUrl, headers) {
    try {
      var res = await this.client.get(masterUrl, headers);
      var body = (res && res.body) || "";
      if (body.indexOf("#EXT-X-STREAM-INF") < 0) return [];
      var base = masterUrl.substring(0, masterUrl.lastIndexOf("/") + 1);
      var variants = [];
      var lines = body.split("\n");
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.indexOf("#EXT-X-STREAM-INF") !== 0) continue;
        var resMatch = line.match(/RESOLUTION=\d+x(\d+)/);
        var quality = resMatch ? resMatch[1] + "p" : "auto";
        for (var j = i + 1; j < lines.length; j++) {
          var u = lines[j].trim();
          if (!u || u.charAt(0) === "#") continue;
          variants.push({ url: u.indexOf("http") === 0 ? u : base + u, quality: quality });
          break;
        }
      }
      variants.sort(function(a, b) { return (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0); });
      return variants;
    } catch (e) { return []; }
  }

  // ── Video list ─────────────────────────────────────────────────────────────

  async getVideoList(url) {
    if (!url || url === "n/a") return [];
    var info;
    try { info = JSON.parse(url); } catch (e) { return []; }
    var id = info.animeId, num = info.num;
    if (!id || !num) return [];

    var audioList = this.pref("miruro_audio");
    if (!audioList || !audioList.length) audioList = ["sub"];

    var streams = [];
    var self = this;
    var providers = ["animegg", "gogoanime", "vidstreaming", "megaplay"];

    for (var pi = 0; pi < providers.length; pi++) {
      var provider = providers[pi];
      try {
        var res = await this.client.get(
          "https://core.justanime.to/api/watch/" + id + "/episode/" + num + "/" + provider,
          { "User-Agent": this.ua, "Origin": "https://justanime.to", "Referer": "https://justanime.to/", "Accept": "application/json" }
        );
        if (!res || res.statusCode !== 200) continue;
        var data = JSON.parse(res.body);
        if (!data || data.error) continue;

        for (var ti = 0; ti < audioList.length; ti++) {
          var type = audioList[ti];
          var typeData = data[type];
          if (!typeData || !typeData.sources) continue;

          var streamHeaders;
          if (provider === "megaplay") {
            var rhdrs = typeData.headers || {};
            streamHeaders = { "User-Agent": this.ua, "Referer": rhdrs["Referer"] || "https://megaplay.buzz/" };
            if (rhdrs["Origin"]) streamHeaders["Origin"] = rhdrs["Origin"];
          } else {
            streamHeaders = { "User-Agent": this.ua, "Referer": "https://justanime.to/" };
          }

          var subtitles = [];
          var tracks = typeData.subtitles || typeData.tracks || [];
          for (var sti = 0; sti < tracks.length; sti++) {
            var track = tracks[sti];
            var tUrl = track.file || track.src || track.url;
            if (tUrl && (track.kind === "captions" || track.kind === "subtitles" || !track.kind)) {
              subtitles.push({ file: tUrl, label: track.label || "Unknown", default: !!(track.default || track.isDefault) });
            }
          }
          if (type === "sub" && subtitles.length > 0 && !subtitles.some(function(s) { return s.default; })) {
            subtitles[0].default = true;
          }

          var sources = typeData.sources;
          for (var si = 0; si < sources.length; si++) {
            var s = sources[si];
            var streamUrl = s.url || s.file;
            if (!streamUrl) continue;
            if ((s.isM3U8 || streamUrl.indexOf(".m3u8") >= 0) && (!s.quality || s.quality === "auto")) {
              var variants = await self.resolveMasterPlaylist(streamUrl, streamHeaders);
              if (variants.length > 0) {
                for (var vi = 0; vi < variants.length; vi++) {
                  streams.push({ url: variants[vi].url, originalUrl: streamUrl,
                    quality: variants[vi].quality + " [" + type.toUpperCase() + " · mega]",
                    headers: streamHeaders, subtitles: subtitles });
                }
                continue;
              }
            }
            streams.push({ url: streamUrl, originalUrl: streamUrl,
              quality: (s.quality || "auto") + " [" + type.toUpperCase() + " · " + provider + "]",
              headers: streamHeaders, subtitles: subtitles });
          }
        }
      } catch (e) {}

      if (streams.length > 0) break;
    }

    return streams;
  }

  // ── Filters ────────────────────────────────────────────────────────────────

  getFilterList() {
    return [
      { type_name: "SelectFilter", name: "Sort", state: 0, values: [
        { type_name: "SelectOption", name: "Trending",   value: "TRENDING_DESC"   },
        { type_name: "SelectOption", name: "Popularity", value: "POPULARITY_DESC" },
        { type_name: "SelectOption", name: "Score",      value: "SCORE_DESC"      },
        { type_name: "SelectOption", name: "Newest",     value: "START_DATE_DESC" },
      ]},
      { type_name: "SelectFilter", name: "Season", state: 0, values: [
        { type_name: "SelectOption", name: "Any",    value: ""       },
        { type_name: "SelectOption", name: "Winter", value: "WINTER" },
        { type_name: "SelectOption", name: "Spring", value: "SPRING" },
        { type_name: "SelectOption", name: "Summer", value: "SUMMER" },
        { type_name: "SelectOption", name: "Fall",   value: "FALL"   },
      ]},
      { type_name: "SelectFilter", name: "Format", state: 0, values: [
        { type_name: "SelectOption", name: "Any",     value: ""        },
        { type_name: "SelectOption", name: "TV",      value: "TV"      },
        { type_name: "SelectOption", name: "Movie",   value: "MOVIE"   },
        { type_name: "SelectOption", name: "OVA",     value: "OVA"     },
        { type_name: "SelectOption", name: "ONA",     value: "ONA"     },
        { type_name: "SelectOption", name: "Special", value: "SPECIAL" },
      ]},
      { type_name: "SelectFilter", name: "Status", state: 0, values: [
        { type_name: "SelectOption", name: "Any",           value: ""                 },
        { type_name: "SelectOption", name: "Airing",        value: "RELEASING"        },
        { type_name: "SelectOption", name: "Finished",      value: "FINISHED"         },
        { type_name: "SelectOption", name: "Not Yet Aired", value: "NOT_YET_RELEASED" },
      ]},
      { type_name: "SelectFilter", name: "Year", state: 0, values: [
        { type_name: "SelectOption", name: "Any",  value: ""     },
        { type_name: "SelectOption", name: "2026", value: "2026" },
        { type_name: "SelectOption", name: "2025", value: "2025" },
        { type_name: "SelectOption", name: "2024", value: "2024" },
        { type_name: "SelectOption", name: "2023", value: "2023" },
        { type_name: "SelectOption", name: "2022", value: "2022" },
        { type_name: "SelectOption", name: "2021", value: "2021" },
        { type_name: "SelectOption", name: "2020", value: "2020" },
      ]},
    ];
  }

  getSourcePreferences() {
    return [
      {
        key: "miruro_lang",
        listPreference: {
          title: "Title language",
          summary: "",
          valueIndex: 0,
          entries:     ["English", "Romaji", "Native"],
          entryValues: ["english", "romaji", "native"],
        },
      },
      {
        key: "miruro_audio",
        multiSelectListPreference: {
          title: "Audio type",
          summary: "",
          values:      ["sub"],
          entries:     ["Sub", "Dub"],
          entryValues: ["sub", "dub"],
        },
      },
    ];
  }
}
