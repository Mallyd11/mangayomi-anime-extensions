const mangayomiSources = [
  {
    "name": "AniDB",
    "id": 927456318,
    "lang": "en",
    "baseUrl": "https://anidb.app",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://anidb.app",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.1.2",
    "pkgPath": "anime/src/en/anidb.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": false,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/anidb.js",
    "dateFormat": "",
    "dateFormatLocale": "",
    "additionalParams": "",
    "sourceCodeLanguage": 1,
    "notes": "Not affiliated with the real AniDB.net metadata database - anidb.app is an unrelated free streaming site.",
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
      "Accept-Encoding": "identity",
    };
  }

  async fetchPage(path) {
    var url = path.startsWith("http") ? path : this.source.baseUrl + path;
    var res = await this.client.get(url, this.headers);
    return { doc: new Document(res.body), html: res.body };
  }

  async apiGet(path) {
    var res = await this.client.get(this.source.baseUrl + path, this.headers);
    return JSON.parse(res.body);
  }

  // ── Listing helpers ──────────────────────────────────────────────────────

  parseAnimeList(doc) {
    var list = [];
    var items = doc.select("a.anime-card");
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var link = item.attr("href");
      var name = (item.attr("title") || item.text || "").trim();
      var img = item.selectFirst("img");
      var imageUrl = img ? (img.attr("src") || "") : "";
      if (name && link) list.push({ name: name, imageUrl: imageUrl, link: link });
    }
    return list;
  }

  // Next-page link renders as <a>Next →</a> when a next page exists, and as a
  // disabled <span>Next →</span> on the last page.
  hasNextPage(html) {
    return /<a[^>]*>\s*Next\s*(&#8594;|→)?\s*<\/a>/.test(html);
  }

  buildQuery(params) {
    var parts = [];
    for (var key in params) {
      if (!params.hasOwnProperty(key)) continue;
      var v = params[key];
      if (v === undefined || v === null || v === "") continue;
      parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(v));
    }
    return parts.join("&");
  }

  async fetchList(params) {
    try {
      var qs = this.buildQuery(params);
      var p = await this.fetchPage("/browse" + (qs ? "?" + qs : ""));
      return { list: this.parseAnimeList(p.doc), hasNextPage: this.hasNextPage(p.html) };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  // ── Filters ──────────────────────────────────────────────────────────────

  filterParamKeys() {
    return { "Sort": "sort", "Type": "type", "Status": "status", "Season": "season", "Year": "year", "Genre": "genres" };
  }

  applyFilters(params, filters) {
    if (!filters || !Array.isArray(filters)) return;
    var keys = this.filterParamKeys();
    for (var i = 0; i < filters.length; i++) {
      var f = filters[i];
      if (f.type_name !== "SelectFilter" || f.state <= 0) continue;
      var key = keys[f.name];
      if (!key) continue;
      var v = f.values[f.state] ? f.values[f.state].value : "";
      if (v) params[key] = v;
    }
  }

  getFilterList() {
    var years = [];
    var currentYear = new Date().getFullYear() + 1;
    for (var y = currentYear; y >= 1963; y--) years.push(String(y));

    var opt = function(name, value) { return { type_name: "SelectOption", name: name, value: value }; };
    var sel = function(name, values) { return { type_name: "SelectFilter", name: name, state: 0, values: values }; };

    return [
      sel("Sort", [
        opt("Trending", "order_trending"),
        opt("Top Rated", "order_top"),
        opt("Latest Updated", "order_updated"),
        opt("Most Popular", "order_popular"),
        opt("Most Favorited", "order_favorite"),
        opt("Top Airing", "order_top_airing"),
        opt("Title A-Z", "title"),
        opt("Newest First", "aired_start"),
      ]),
      sel("Type", [
        opt("All Types", ""),
        opt("Movie", "Movie"),
        opt("Music", "Music"),
        opt("ONA", "ONA"),
        opt("OVA", "OVA"),
        opt("Special", "Special"),
        opt("TV", "TV"),
      ]),
      sel("Status", [
        opt("All Status", ""),
        opt("Currently Airing", "Currently Airing"),
        opt("Finished Airing", "Finished Airing"),
      ]),
      sel("Season", [
        opt("All Seasons", ""),
        opt("Fall", "fall"),
        opt("Spring", "spring"),
        opt("Summer", "summer"),
        opt("Winter", "winter"),
      ]),
      sel("Year", [opt("All Years", "")].concat(years.map(function(y) { return opt(y, y); }))),
      sel("Genre", [
        opt("All Genres", ""),
        opt("Action", "1"),
        opt("Adventure", "3"),
        opt("Avant Garde", "19"),
        opt("Award Winning", "12"),
        opt("Boys Love", "16"),
        opt("Comedy", "5"),
        opt("Drama", "2"),
        opt("Ecchi", "13"),
        opt("Erotica", "17"),
        opt("Fantasy", "4"),
        opt("Girls Love", "20"),
        opt("Gourmet", "8"),
        opt("Hentai", "15"),
        opt("Horror", "21"),
        opt("Mystery", "7"),
        opt("Romance", "14"),
        opt("Sci-Fi", "6"),
        opt("Slice of Life", "9"),
        opt("Sports", "11"),
        opt("Supernatural", "10"),
        opt("Suspense", "18"),
      ]),
    ];
  }

  // ── Listings ─────────────────────────────────────────────────────────────

  get supportsLatest() { return true; }

  async getPopular(page) {
    return await this.fetchList({ page: page, sort: "order_popular" });
  }

  async getLatestUpdates(page) {
    return await this.fetchList({ page: page, sort: "order_updated" });
  }

  async search(query, page, filters) {
    var params = { page: page };
    if (query && query.trim()) params.q = query.trim();
    this.applyFilters(params, filters);
    if (!params.sort) params.sort = "order_trending";
    return await this.fetchList(params);
  }

  // ── Detail ───────────────────────────────────────────────────────────────

  extractId(url) {
    var clean = url.split("?")[0].split("#")[0].replace(/\/$/, "");
    var m = clean.match(/-(\d+)$/);
    return m ? m[1] : clean.split("-").pop();
  }

  statusCode(status) {
    var map = { "Currently Airing": 0, "Finished Airing": 1 };
    return map.hasOwnProperty(status) ? map[status] : 5;
  }

  extractGenres(html) {
    try {
      var m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
      if (m) {
        var ld = JSON.parse(m[1]);
        if (Array.isArray(ld.genre)) return ld.genre;
      }
    } catch (e) {}
    return [];
  }

  extractStatus(html) {
    var m = html.match(/href="\/browse\?status=[^"]*"[^>]*>([^<]+)<\/a>/);
    return m ? m[1].trim() : "";
  }

  decodeEntities(str) {
    return (str || "")
      .replace(/&amp;/g, "&")
      .replace(/&#0?39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  extractDescription(html) {
    var m = html.match(/<p class="text-sm text-faint leading-relaxed">([\s\S]*?)<\/p>/);
    if (!m) return "";
    return this.decodeEntities(
      m[1].replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "").trim()
    );
  }

  async getDetail(url) {
    var id = this.extractId(url);
    var p = await this.fetchPage(url);
    var doc = p.doc;
    var html = p.html;

    var nameEl = doc.selectFirst("h1");
    var name = nameEl ? nameEl.text.trim() : "";

    var imageUrl = "";
    var ogImage = doc.selectFirst("meta[property='og:image']");
    if (ogImage) imageUrl = ogImage.attr("content") || "";

    var description = this.extractDescription(html);
    var genre = this.extractGenres(html);
    var status = this.statusCode(this.extractStatus(html));

    var epData = await this.apiGet("/api/frontend/anime/" + id + "/episodes");
    var episodes = (epData && epData.episodes) || [];

    var chapters = [];
    for (var i = 0; i < episodes.length; i++) {
      var ep = episodes[i];
      var label = "Episode " + ep.number + (ep.number2 ? "." + ep.number2 : "");
      if (ep.filler) label += " [Filler]";
      chapters.push({ name: label, url: String(ep.id) });
    }
    chapters.reverse();

    return {
      name: name,
      imageUrl: imageUrl,
      description: description,
      genre: genre,
      status: status,
      link: url,
      chapters: chapters,
    };
  }

  // ── HLS helpers ──────────────────────────────────────────────────────────

  async resolveMasterPlaylist(masterUrl, headers) {
    try {
      var res = await this.client.get(masterUrl, headers);
      var body = res.body || "";
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
      variants.sort(function(a, b) {
        return (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0);
      });
      return variants;
    } catch (e) {
      return [];
    }
  }

  // ── Video sources ────────────────────────────────────────────────────────

  async getVideoList(url) {
    var episodeId = url;
    var subVideos = [];
    var dubVideos = [];
    var streamHeaders = { "User-Agent": this.ua, "Referer": this.source.baseUrl + "/" };

    var langData;
    try {
      langData = await this.apiGet("/api/frontend/episode/" + episodeId + "/languages");
    } catch (e) {
      return [];
    }
    var languages = (langData && langData.languages) || [];

    for (var i = 0; i < languages.length; i++) {
      var lang = languages[i];
      if (!lang.embed_url) continue;
      var isSub = lang.code === "jpn";
      var label = isSub ? "Sub" : ((lang.name || lang.code) + " Dub");

      try {
        var res = await this.client.get(lang.embed_url, this.headers);
        var body = res.body || "";
        var m = body.match(/file:\s*['"]([^'"]+\.m3u8)['"]/);
        if (!m) continue;
        var masterUrl = m[1];

        var variants = await this.resolveMasterPlaylist(masterUrl, this.headers);
        if (variants.length > 0) {
          for (var v = 0; v < variants.length; v++) {
            var entry = {
              url: variants[v].url,
              originalUrl: masterUrl,
              quality: label + " [" + variants[v].quality + "]",
              headers: streamHeaders,
              subtitles: [],
            };
            if (isSub) subVideos.push(entry); else dubVideos.push(entry);
          }
        } else {
          var flatEntry = {
            url: masterUrl,
            originalUrl: masterUrl,
            quality: label + " [Auto]",
            headers: streamHeaders,
            subtitles: [],
          };
          if (isSub) subVideos.push(flatEntry); else dubVideos.push(flatEntry);
        }
      } catch (e) {}
    }

    var pref = "sub";
    try { pref = new SharedPreferences().get("anidb_pref_audio") || "sub"; } catch (e) {}
    if (pref === "dub") return dubVideos.concat(subVideos);
    return subVideos.concat(dubVideos);
  }

  // ── Preferences ──────────────────────────────────────────────────────────

  getSourcePreferences() {
    return [
      {
        key: "anidb_pref_audio",
        listPreference: {
          title: "Preferred language",
          summary: "Primary language to use. If unavailable, the other will be used as fallback.",
          valueIndex: 0,
          entries: ["Sub first, Dub fallback", "Dub first, Sub fallback"],
          entryValues: ["sub", "dub"],
        },
      },
    ];
  }
}
