const mangayomiSources = [
  {
    "name": "Just4Anime",
    "id": 573920184,
    "lang": "en",
    "baseUrl": "https://just4anime.online",
    "apiUrl": "https://api.just4anime.online",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://just4anime.online",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.1.0",
    "pkgPath": "anime/src/en/just4anime.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": false,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/just4anime.js",
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
      "Origin": this.source.baseUrl,
      "Accept": "application/json",
    };
  }

  // ── Listings ──────────────────────────────────────────────────────────────

  get supportsLatest() { return true; }

  // The site's own Next.js route proxies AniList; ids are AniList media ids.
  async searchApi(params) {
    var url = this.source.baseUrl + "/api/advanced-search?" + params;
    var res = await this.client.get(url, this.headers);
    var data = JSON.parse(res.body);
    if (!data.success || !data.data) return { list: [], hasNextPage: false };
    return {
      list: this.parseAnimeList(data.data.results || []),
      hasNextPage: !!data.data.hasNextPage,
    };
  }

  animeTitle(item) {
    var t = item.title || {};
    if (typeof t === "string") return t;
    return t.english || t.romaji || t.userPreferred || t.native || "";
  }

  parseAnimeList(items) {
    var list = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      list.push({
        name: this.animeTitle(item),
        link: String(item.id),
        imageUrl: item.image || item.cover || "",
      });
    }
    return list;
  }

  async getPopular(page) {
    try {
      return await this.searchApi("page=" + page + "&perPage=20&sort=" +
        encodeURIComponent('["POPULARITY_DESC"]'));
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  // "Latest" = currently airing, ordered by trending. UPDATED_AT_DESC on this API
  // surfaces long-dead entries whose metadata was touched, which is not useful.
  async getLatestUpdates(page) {
    try {
      return await this.searchApi("page=" + page + "&perPage=20&status=RELEASING&sort=" +
        encodeURIComponent('["TRENDING_DESC"]'));
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async search(query, page, filters) {
    var params = ["page=" + page, "perPage=20"];
    var sort = "POPULARITY_DESC";
    var genres = [];

    if (filters && Array.isArray(filters)) {
      for (var i = 0; i < filters.length; i++) {
        var f = filters[i];
        if (f.type_name === "SelectFilter" && f.state > 0) {
          var v = f.values[f.state].value;
          if (!v) continue;
          if (f.name === "Sort") sort = v;
          else if (f.name === "Format") params.push("format=" + v);
          else if (f.name === "Status") params.push("status=" + v);
          else if (f.name === "Season") params.push("season=" + v);
          else if (f.name === "Year") params.push("seasonYear=" + v);
        } else if (f.type_name === "GroupFilter" && f.name === "Genres") {
          var gs = f.state || [];
          for (var g = 0; g < gs.length; g++) {
            if (gs[g].state === true) genres.push(gs[g].value);
          }
        }
      }
    }

    if (query && query.trim().length) params.push("query=" + encodeURIComponent(query.trim()));
    if (genres.length) params.push("genres=" + encodeURIComponent(JSON.stringify(genres)));
    params.push("sort=" + encodeURIComponent(JSON.stringify([sort])));

    try {
      return await this.searchApi(params.join("&"));
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  // ── Detail ────────────────────────────────────────────────────────────────

  statusCode(status) {
    return ({
      "Ongoing": 0,
      "RELEASING": 0,
      "Completed": 1,
      "FINISHED": 1,
      "Not yet aired": 4,
      "NOT_YET_RELEASED": 4,
      "Cancelled": 5,
      "CANCELLED": 5,
      "Hiatus": 6,
      "HIATUS": 6,
    }[status]);
  }

  stripHtml(str) {
    return (str || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;/g, "'")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  extractId(url) {
    var base = this.source.baseUrl;
    if (url.indexOf(base) === 0) {
      var path = url.slice(base.length).replace(/^\//, "");
      var m = path.match(/^anime\/(\d+)/);
      if (m) return m[1];
      return path.split("/").pop();
    }
    return url;
  }

  async getDetail(url) {
    var id = this.extractId(url);

    // Episode list and the richer metadata live on the site's own route.
    var epRes = await this.client.get(
      this.source.baseUrl + "/api/episodes/" + id + "?full=true", this.headers);
    var epData = JSON.parse(epRes.body);
    var d = (epData && epData.data) || {};

    // AniList-shaped fields (description, genres, status) only exist on the search
    // route, which has no id lookup — so search by title and match the id back.
    var meta = await this.lookupMeta(id, [d.title, this.stripYear(d.title),
                                          this.stripYear(d.titleJa)]);

    var name = this.animeTitle(meta) || d.title || String(id);
    var imageUrl = meta.image || this.imageOfType(d.images, "Poster") || "";

    var episodes = d.episodes || [];
    var chapters = [];
    for (var e = 0; e < episodes.length; e++) {
      var ep = episodes[e];
      if (ep.hasAired === false) continue; // unaired entries have no source
      var label = "Episode " + ep.number;
      if (ep.title && ep.title !== label && !/^Episode\s+\d+$/i.test(ep.title)) {
        label += " - " + ep.title;
      }
      chapters.push({
        name: label,
        url: id + "||" + ep.number,
        dateUpload: this.toEpochMs(ep.airDate),
      });
    }

    return {
      name: name,
      imageUrl: imageUrl,
      description: this.stripHtml(meta.description || ""),
      genre: meta.genres || [],
      status: this.statusCode(meta.status),
      link: this.source.baseUrl + "/anime/" + id,
      chapters: chapters.reverse(),
    };
  }

  // The episode route's titles carry a "(2026)" disambiguator that the search
  // index does not have, which otherwise loses the match for current seasons.
  stripYear(title) {
    if (!title) return "";
    return title.replace(/\s*\(\d{4}\)\s*$/, "").trim();
  }

  // Try each candidate title until one search returns our id.
  async lookupMeta(id, candidates) {
    var tried = {};
    for (var c = 0; c < candidates.length; c++) {
      var title = candidates[c];
      if (!title || tried[title]) continue;
      tried[title] = true;
      try {
        var res = await this.client.get(this.source.baseUrl +
          "/api/advanced-search?page=1&perPage=20&query=" + encodeURIComponent(title),
          this.headers);
        var json = JSON.parse(res.body);
        var results = ((json.data || {}).results) || [];
        for (var i = 0; i < results.length; i++) {
          if (String(results[i].id) === String(id)) return results[i];
        }
      } catch (e) {}
    }
    return {};
  }

  imageOfType(images, type) {
    var arr = images || [];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].coverType === type) return arr[i].url;
    }
    return "";
  }

  toEpochMs(dateStr) {
    if (!dateStr) return null;
    var t = Date.parse(dateStr);
    return isNaN(t) ? null : String(t);
  }

  // ── Stream extraction ─────────────────────────────────────────────────────

  // The sources endpoint only ever returns URLs behind cors.just4anime.online,
  // whose playlists reference extension-less segments (/proxy/e/<token>). ffmpeg
  // rejects those with "not in allowed_extensions" unless extension_picky=0, which
  // a Mangayomi extension cannot set — the proxied URL is unplayable in the app.
  // So we take the embed URL the same response carries and resolve the host
  // directly; StreamHG hands back a real .m3u8 whose segments are absolute .ts.
  async fetchSources(id, epNum, provider, type) {
    var url = this.source.apiUrl + "/api/v1/meta/sources/" + id +
      "?provider=" + provider + "&num=" + epNum + "&type=" + type;
    var res = await this.client.get(url, this.headers);
    var data = JSON.parse(res.body);
    return (data && data.data) || null;
  }

  // Pure-JS P.A.C.K.E.R. decoder — the isolate has no eval/Function.
  unpack(src) {
    var m = src.match(
      /\}\s*\(\s*'([\s\S]*?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]*?)'\s*\.\s*split\s*\(\s*'\|'\s*\)/);
    if (!m) return "";
    var payload = m[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    var radix = parseInt(m[2], 10);
    var count = parseInt(m[3], 10);
    var words = m[4].replace(/\\'/g, "'").split("|");
    var DIGITS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

    function encode(n) {
      if (n === 0) return "0";
      var out = "";
      while (n > 0) { out = DIGITS.charAt(n % radix) + out; n = Math.floor(n / radix); }
      return out;
    }

    for (var i = count - 1; i >= 0; i--) {
      if (words[i]) {
        payload = payload.replace(new RegExp("\\b" + encode(i) + "\\b", "g"), words[i]);
      }
    }
    return payload;
  }

  // StreamHG-family embeds (otakuhg.site and rotations) hide the playlist in a
  // packed script; vivibebe-style embeds inline it directly.
  async resolveEmbed(embedUrl) {
    var hostMatch = embedUrl.match(/^https?:\/\/[^/]+/);
    if (!hostMatch) return null;
    var host = hostMatch[0];
    var embedHeaders = { "User-Agent": this.ua, "Referer": host + "/", "Origin": host };

    var res = await this.client.get(embedUrl, { "User-Agent": this.ua, "Referer": host + "/" });
    var body = res.body || "";

    var master = "";
    var packedAt = body.indexOf("eval(function(p,a,c,k,e");
    if (packedAt >= 0) {
      var unpacked = this.unpack(body.slice(packedAt));
      master = (unpacked.match(/https?:\/\/[^"'\s\\]+?master\.m3u8[^"'\s\\]*/) || [])[0] || "";
    }
    if (!master) {
      master = (body.match(/https?:\/\/[^"'\s\\]+?\.m3u8[^"'\s\\]*/) || [])[0] || "";
    }
    if (!master) return null;
    return { master: master, headers: embedHeaders };
  }

  // Expand a master playlist into absolute variant URLs so the player gets a
  // single-rendition playlist and the user gets real quality labels.
  async resolveVariants(masterUrl, headers) {
    try {
      var res = await this.client.get(masterUrl, headers);
      var body = res.body || "";
      if (body.indexOf("#EXTM3U") < 0) return null;
      if (body.indexOf("#EXT-X-STREAM-INF") < 0) return [];

      var base = masterUrl.slice(0, masterUrl.lastIndexOf("/") + 1);
      var lines = body.split("\n");
      var variants = [];
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
      variants.sort(function (a, b) {
        return (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0);
      });
      return variants;
    } catch (e) {
      return null;
    }
  }

  // Prefer the direct CDN subtitle the embed URL carries over the API's proxied copy.
  collectSubtitles(data, embedUrl) {
    var subs = [];
    var seen = {};

    function push(url, lang) {
      if (!url || seen[url]) return;
      seen[url] = true;
      subs.push({ file: url, label: lang || "English" });
    }

    if (embedUrl) {
      var re = /(?:caption|sub)_?\d*=([^&]+)/g, m;
      while ((m = re.exec(embedUrl)) !== null) {
        var val = decodeURIComponent(m[1]);
        if (val.indexOf("http") === 0 && /\.(vtt|srt|ass)(\?|$)/i.test(val)) push(val, "English");
      }
    }

    var tracks = (data && (data.subtitles || data.subtitleTracks)) || [];
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      var u = t.url || t.file;
      if (!u) continue;
      var lang = t.lang || t.language || t.label || "Unknown";
      if (/thumbnail|storyboard/i.test(lang)) continue;
      push(u, lang);
    }

    // English first
    subs.sort(function (a, b) {
      var ae = /eng/i.test(a.label) ? 0 : 1;
      var be = /eng/i.test(b.label) ? 0 : 1;
      return ae - be;
    });
    return subs;
  }

  async streamsFor(id, epNum, type, provider, label) {
    var videos = [];
    var data;
    try { data = await this.fetchSources(id, epNum, provider, type); } catch (e) { return videos; }
    if (!data) return videos;

    var embedUrl = ((data.iframe || [])[0] || {}).url;
    if (!embedUrl) return videos;

    var resolved;
    try { resolved = await this.resolveEmbed(embedUrl); } catch (e) { return videos; }
    if (!resolved) return videos;

    var subtitles = this.collectSubtitles(data, embedUrl);
    var autoSubs = false;
    try { autoSubs = new SharedPreferences().get("j4a_pref_auto_subs") === "true"; } catch (e) {}
    if (autoSubs && subtitles.length) subtitles[0].default = true;

    var variants = await this.resolveVariants(resolved.master, resolved.headers);
    if (variants === null) return videos; // playlist unreachable — treat as no source

    if (variants.length) {
      for (var i = 0; i < variants.length; i++) {
        videos.push({
          url: variants[i].url,
          originalUrl: resolved.master,
          quality: label + " [" + variants[i].quality + "]",
          headers: resolved.headers,
          subtitles: subtitles,
        });
      }
    } else {
      videos.push({
        url: resolved.master,
        originalUrl: resolved.master,
        quality: label + " [auto]",
        headers: resolved.headers,
        subtitles: subtitles,
      });
    }
    return videos;
  }

  async getVideoList(url) {
    var parts = url.split("||");
    var id = parts[0];
    var epNum = parts[1];

    var audioPref = "sub";
    try { audioPref = new SharedPreferences().get("j4a_pref_audio") || "sub"; } catch (e) {}

    // Only the StreamHG-backed providers yield a playable direct stream:
    //  - jin  → megaplay, proxy-only (no embed URL is returned at all)
    //  - kai / zeke → vivibebe, every segment is an extension-less ad URL
    //  - mai / sai  → StreamHG, clean .m3u8 with absolute .ts segments
    var providers = ["mai", "sai"];

    var subVideos = [];
    var dubVideos = [];

    for (var p = 0; p < providers.length; p++) {
      if (!subVideos.length && audioPref !== "dub_only") {
        subVideos = await this.streamsFor(id, epNum, "sub", providers[p], "SUB");
      }
      if (!dubVideos.length && audioPref !== "sub_only") {
        dubVideos = await this.streamsFor(id, epNum, "dub", providers[p], "DUB");
      }
      if (subVideos.length && dubVideos.length) break;
      if (audioPref === "sub_only" && subVideos.length) break;
      if (audioPref === "dub_only" && dubVideos.length) break;
    }

    if (audioPref === "dub" || audioPref === "dub_only") {
      return dubVideos.concat(subVideos);
    }
    return subVideos.concat(dubVideos);
  }

  // ── Filters & preferences ─────────────────────────────────────────────────

  getFilterList() {
    var genres = ["Action", "Adventure", "Comedy", "Drama", "Ecchi", "Fantasy",
      "Horror", "Mahou Shoujo", "Mecha", "Music", "Mystery", "Psychological",
      "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller"];

    return [
      { type_name: "SelectFilter", name: "Sort", state: 0, values: [
        { type_name: "SelectOption", name: "Popularity", value: "POPULARITY_DESC" },
        { type_name: "SelectOption", name: "Trending",   value: "TRENDING_DESC"   },
        { type_name: "SelectOption", name: "Score",      value: "SCORE_DESC"      },
        { type_name: "SelectOption", name: "Newest",     value: "START_DATE_DESC" },
        { type_name: "SelectOption", name: "Title",      value: "TITLE_ROMAJI"    },
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
      { type_name: "SelectFilter", name: "Season", state: 0, values: [
        { type_name: "SelectOption", name: "Any",    value: ""       },
        { type_name: "SelectOption", name: "Winter", value: "WINTER" },
        { type_name: "SelectOption", name: "Spring", value: "SPRING" },
        { type_name: "SelectOption", name: "Summer", value: "SUMMER" },
        { type_name: "SelectOption", name: "Fall",   value: "FALL"   },
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
      {
        type_name: "GroupFilter",
        name: "Genres",
        state: genres.map(function (g) {
          return { type_name: "CheckBox", name: g, value: g, state: false };
        }),
      },
    ];
  }

  getSourcePreferences() {
    return [
      {
        key: "j4a_pref_audio",
        listPreference: {
          title: "Preferred language",
          summary: "Which audio track to list first. The other is offered as a fallback unless you pick an \"only\" option.",
          valueIndex: 0,
          entries: ["Sub first, Dub fallback", "Dub first, Sub fallback", "Sub only", "Dub only"],
          entryValues: ["sub", "dub", "sub_only", "dub_only"],
        },
      },
      {
        key: "j4a_pref_auto_subs",
        checkBoxPreference: {
          title: "Auto-enable subtitles",
          summary: "Automatically activate the first (English) subtitle track when playing.",
          value: false,
        },
      },
    ];
  }
}
