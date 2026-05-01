const mangayomiSources = [
  {
    "name": "HiAnime",
    "id": 1183439094,
    "lang": "en",
    "baseUrl": "https://hianime.ws",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://hianime.ws",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.0.2",
    "pkgPath": "anime/src/en/hianime.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": false,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/hianime.js",
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

  get ajaxHeaders() {
    return {
      "User-Agent": this.ua,
      "Referer": this.source.baseUrl + "/",
      "X-Requested-With": "XMLHttpRequest",
    };
  }

  async fetchDoc(path) {
    var url = path.startsWith("http") ? path : this.source.baseUrl + path;
    var res = await this.client.get(url, this.headers);
    return new Document(res.body);
  }

  async ajaxGet(path) {
    var url = path.startsWith("http") ? path : this.source.baseUrl + path;
    var res = await this.client.get(url, this.ajaxHeaders);
    return JSON.parse(res.body);
  }

  parseList(doc) {
    var list = [];
    var items = doc.select(".flw-item");
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var anchor = item.selectFirst(".film-poster a");
      var href = anchor ? anchor.attr("href") : "";
      var link = href.startsWith("http") ? href : this.source.baseUrl + href;
      var nameEl = item.selectFirst(".film-name a");
      var name = nameEl ? nameEl.text.trim() : "";
      var img = item.selectFirst(".film-poster img");
      var imageUrl = img ? (img.attr("data-src") || img.attr("src")) : "";
      if (name && link) list.push({ name, imageUrl, link });
    }
    return list;
  }

  hasNextPage(doc) {
    return !!doc.selectFirst("ul.pagination a[rel=next]");
  }

  extractAnimeId(url) {
    // URL format: /watch/{slug}-{id} where id is alphanumeric e.g. x2p0, vnw5, 5626
    var match = url.match(/\/watch\/[^?#]*-([a-zA-Z0-9]+)(?:[?#].*)?$/);
    return match ? match[1] : "";
  }

  get supportsLatest() {
    return true;
  }

  async getPopular(page) {
    var doc = await this.fetchDoc("/browser?sort=most_popular&page=" + page);
    return { list: this.parseList(doc), hasNextPage: this.hasNextPage(doc) };
  }

  async getLatestUpdates(page) {
    var doc = await this.fetchDoc("/browser?sort=recently_updated&page=" + page);
    return { list: this.parseList(doc), hasNextPage: this.hasNextPage(doc) };
  }

  async search(query, page, filters) {
    var doc = await this.fetchDoc("/browser?keyword=" + encodeURIComponent(query) + "&page=" + page);
    return { list: this.parseList(doc), hasNextPage: this.hasNextPage(doc) };
  }

  statusCode(status) {
    var s = (status || "").toLowerCase();
    if (s.includes("airing") || s.includes("ongoing")) return 0;
    if (s.includes("completed") || s.includes("finished")) return 1;
    if (s.includes("upcoming") || s.includes("not yet")) return 4;
    return 5;
  }

  async getDetail(url) {
    var path = url.replace(this.source.baseUrl, "");
    var doc = await this.fetchDoc(path);

    var name = "";
    var nameEl = doc.selectFirst("h2.film-name, h1.film-name");
    if (nameEl) name = nameEl.text.trim();

    var imageUrl = "";
    var imgEl = doc.selectFirst(".film-poster img");
    if (imgEl) imageUrl = imgEl.attr("src") || imgEl.attr("data-src");

    var description = "";
    var descEl = doc.selectFirst(".film-description .text, .film-description p");
    if (descEl) description = descEl.text.trim();

    var genre = [];
    var genreEls = doc.select(".item-list a[href*='/genre/']");
    for (var i = 0; i < genreEls.length; i++) genre.push(genreEls[i].text.trim());

    var statusEl = doc.selectFirst(".item:has(.item-head) .name");
    var status = statusEl ? this.statusCode(statusEl.text.trim()) : 5;

    var animeId = this.extractAnimeId(url);
    var chapters = [];
    if (animeId) {
      try {
        var epData = await this.ajaxGet("/ajax/v2/episode/list/" + animeId);
        var epDoc = new Document(epData.html || "");
        var epEls = epDoc.select("a[data-id]");
        for (var i = 0; i < epEls.length; i++) {
          var ep = epEls[i];
          var epId = ep.attr("data-id");
          var epNum = ep.attr("data-number") || String(i + 1);
          var epTitle = ep.attr("title") || ("Episode " + epNum);
          var cls = ep.attr("class") || "";
          var label = "E" + epNum + ": " + epTitle + (cls.includes("filler") ? " [Filler]" : "");
          chapters.push({ name: label, url: animeId + "||" + epId });
        }
      } catch (e) {}
    }

    return {
      name,
      imageUrl,
      description,
      genre,
      status,
      link: url,
      chapters: chapters.reverse(),
    };
  }

  async extractMegaCloud(embedUrl) {
    var streams = [];
    try {
      var idMatch = embedUrl.match(/\/e-1\/([^?#]+)/);
      if (!idMatch) return streams;
      var mcId = idMatch[1];

      var sourcesRes = await this.client.get(
        "https://megacloud.tv/embed-2/ajax/e-1/getSources?id=" + mcId,
        { "User-Agent": this.ua, "Referer": embedUrl, "X-Requested-With": "XMLHttpRequest" }
      );
      var data = JSON.parse(sourcesRes.body);

      if (data.encrypted || !data.sources) return streams;

      var subtitles = [];
      if (data.tracks) {
        for (var t of data.tracks) {
          if (t.kind === "captions" || t.kind === "subtitles") {
            subtitles.push({ label: t.label || "Unknown", file: t.file });
          }
        }
      }

      for (var src of data.sources) {
        if (src.file) {
          streams.push({
            url: src.file,
            originalUrl: src.file,
            quality: "MegaCloud",
            headers: { "Referer": "https://megacloud.tv/", "User-Agent": this.ua },
            subtitles,
          });
        }
      }
    } catch (e) {}
    return streams;
  }

  async extractStreamTape(embedUrl) {
    var streams = [];
    try {
      var res = await this.client.get(embedUrl, { "User-Agent": this.ua, "Referer": this.source.baseUrl + "/" });
      // StreamTape builds the URL from two concatenated JS vars
      var match = res.body.match(/id=([^&'"]+).*?token=([^&'"]+)/s);
      if (!match) {
        match = res.body.match(/robotlink['"]\)\.innerHTML\s*=\s*"([^"]+)"/);
        if (match) {
          var stUrl = "https:" + match[1];
          streams.push({
            url: stUrl,
            originalUrl: stUrl,
            quality: "StreamTape",
            headers: { "Referer": "https://streamtape.com/", "User-Agent": this.ua },
            subtitles: [],
          });
        }
      }
    } catch (e) {}
    return streams;
  }

  async getVideoList(url) {
    var parts = url.split("||");
    var animeId = parts[0];
    var episodeId = parts[1];
    var allStreams = [];

    var pref = "";
    try { pref = new SharedPreferences().get("hianime_pref_audio") || "sub"; } catch (e) { pref = "sub"; }

    try {
      var serverData = await this.ajaxGet("/ajax/v2/episode/servers?episodeId=" + episodeId);
      var serverDoc = new Document(serverData.html || "");
      var serverEls = serverDoc.select(".server-item[data-id][data-type]");

      var subServers = [];
      var dubServers = [];
      for (var i = 0; i < serverEls.length; i++) {
        var el = serverEls[i];
        if ((el.attr("data-type") || "") === "dub") {
          dubServers.push(el);
        } else {
          subServers.push(el);
        }
      }
      var ordered = pref === "dub" ? dubServers.concat(subServers) : subServers.concat(dubServers);

      for (var i = 0; i < ordered.length; i++) {
        var serverEl = ordered[i];
        var serverId = serverEl.attr("data-id");
        var serverType = serverEl.attr("data-type") || "sub";
        var serverName = serverEl.text.trim() || serverId;

        try {
          var srcData = await this.ajaxGet("/ajax/v2/episode/sources?id=" + serverId);
          var embedUrl = srcData.link || srcData.url || "";
          if (!embedUrl) continue;

          var serverStreams = [];
          if (embedUrl.includes("megacloud")) {
            serverStreams = await this.extractMegaCloud(embedUrl);
          } else if (embedUrl.includes("streamtape")) {
            serverStreams = await this.extractStreamTape(embedUrl);
          }

          for (var s of serverStreams) {
            s.quality = serverName + " [" + serverType + "] " + s.quality;
            allStreams.push(s);
          }
        } catch (e) {}
      }
    } catch (e) {}

    return allStreams;
  }

  getFilterList() {
    return [];
  }

  getSourcePreferences() {
    return [
      {
        key: "hianime_pref_audio",
        listPreference: {
          title: "Preferred audio",
          summary: "Which audio track appears first for streaming and downloads",
          valueIndex: 0,
          entries: ["Sub", "Dub"],
          entryValues: ["sub", "dub"],
        },
      },
    ];
  }
}
