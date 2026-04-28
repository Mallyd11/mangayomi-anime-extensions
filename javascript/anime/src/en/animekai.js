const mangayomiSources = [
  {
    "name": "AnimeKai",
    "id": 753902841,
    "lang": "en",
    "baseUrl": "https://anikai.to",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://anikai.to",
    "typeSource": "single",
    "itemType": 1,
    "version": "1.0.3",
    "pkgPath": "anime/src/en/animekai.js",
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
      "Cookie": "__ddg1_=;__ddg2_=;",
    };
  }

  get ajaxHeaders() {
    return {
      "User-Agent": this.ua,
      "Referer": this.source.baseUrl + "/",
      "X-Requested-With": "XMLHttpRequest",
    };
  }

  get encDecHeaders() {
    return { "User-Agent": this.ua, "Referer": this.source.baseUrl + "/" };
  }

  async encKai(text) {
    var res = await this.client.get(
      "https://enc-dec.app/api/enc-kai?text=" + encodeURIComponent(text),
      this.encDecHeaders
    );
    return JSON.parse(res.body).result;
  }

  async decKai(text) {
    var res = await this.client.get(
      "https://enc-dec.app/api/dec-kai?text=" + encodeURIComponent(text),
      this.encDecHeaders
    );
    return JSON.parse(res.body).result;
  }

  async decMega(text) {
    var res = await this.client.post(
      "https://enc-dec.app/api/dec-mega",
      { "Content-Type": "application/json", "User-Agent": this.ua, "Referer": this.source.baseUrl + "/" },
      JSON.stringify({ text: text, agent: this.ua })
    );
    return JSON.parse(res.body).result;
  }

  parseList(doc) {
    var list = [];
    var items = doc.select("div.aitem");
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var anchor = item.selectFirst("a.poster");
      var href = anchor ? anchor.attr("href") : "";
      var link = href.startsWith("http") ? href : this.source.baseUrl + href;
      var titleEl = item.selectFirst("a.title");
      var name = titleEl ? (titleEl.attr("title") || titleEl.text) : "";
      var img = item.selectFirst(".poster img");
      var imageUrl = img ? (img.attr("data-src") || img.attr("src")) : "";
      if (name && link) list.push({ name, imageUrl, link });
    }
    return list;
  }

  hasNextPage(doc) {
    return !!doc.selectFirst("ul.pagination a[rel=next]");
  }

  async fetchDoc(path) {
    var url = path.startsWith("http") ? path : this.source.baseUrl + path;
    var res = await this.client.get(url, this.headers);
    return new Document(res.body);
  }

  async getPopular(page) {
    var doc = await this.fetchDoc("/browser?sort=trending&page=" + page);
    return { list: this.parseList(doc), hasNextPage: this.hasNextPage(doc) };
  }

  get supportsLatest() {
    return true;
  }

  async getLatestUpdates(page) {
    var doc = await this.fetchDoc("/recently-updated?page=" + page);
    return { list: this.parseList(doc), hasNextPage: this.hasNextPage(doc) };
  }

  async search(query, page, filters) {
    var doc = await this.fetchDoc(
      "/browser?keyword=" + encodeURIComponent(query) + "&page=" + page
    );
    return { list: this.parseList(doc), hasNextPage: this.hasNextPage(doc) };
  }

  statusCode(status) {
    return { "releasing": 0, "completed": 1, "info": 3 }[status] ?? 5;
  }

  async getDetail(url) {
    var path = url.replace(this.source.baseUrl, "");
    var doc = await this.fetchDoc(path);

    var name = "";
    var nameEl = doc.selectFirst("h1.title, h2.title, .anime-info h1");
    if (nameEl) name = nameEl.text.trim();

    var imageUrl = "";
    var imgEl = doc.selectFirst(".poster img, .anime-poster img, .cover img");
    if (imgEl) imageUrl = imgEl.attr("src") || imgEl.attr("data-src");

    var description = "";
    var descEl = doc.selectFirst("div.desc, .description, .synopsis");
    if (descEl) description = descEl.text.trim();

    var genre = [];
    var genreEls = doc.select("div.detail a[href*='/genres/']");
    for (var i = 0; i < genreEls.length; i++) {
      genre.push(genreEls[i].text.trim());
    }

    var statusEl = doc.selectFirst(".status span, .info-status");
    var status = statusEl
      ? this.statusCode(statusEl.text.trim().toLowerCase())
      : 5;

    var rateBox = doc.selectFirst("div.rate-box");
    var aniId = rateBox ? rateBox.attr("data-id") : "";

    var chapters = [];
    if (aniId) {
      try {
        var token = await this.encKai(aniId);
        var epRes = await this.client.get(
          this.source.baseUrl + "/ajax/episodes/list?ani_id=" + aniId + "&_=" + token,
          this.ajaxHeaders
        );
        var epDoc = new Document(JSON.parse(epRes.body).result);
        var epEls = epDoc.select("a[num][token]");
        for (var i = 0; i < epEls.length; i++) {
          var ep = epEls[i];
          var num = ep.attr("num");
          var epToken = ep.attr("token");
          var titleEl = ep.selectFirst("span");
          var epTitle = titleEl ? titleEl.text.trim() : "Episode " + num;
          var langs = ep.attr("langs");
          var langTag = langs === "2" || langs === "3" ? " [Sub+Dub]" : " [Sub]";
          chapters.push({ name: "E" + num + ": " + epTitle + langTag, url: epToken });
        }
      } catch (e) {}
    }

    chapters.reverse();
    return {
      name,
      imageUrl,
      description,
      genre,
      status,
      link: this.source.baseUrl + path,
      chapters,
    };
  }

  async getVideoList(url) {
    var epToken = url;
    var streams = [];

    var tokenB = await this.encKai(epToken);
    var serverRes = await this.client.get(
      this.source.baseUrl + "/ajax/links/list?token=" + epToken + "&_=" + tokenB,
      this.ajaxHeaders
    );
    var serverDoc = new Document(JSON.parse(serverRes.body).result);
    var groups = serverDoc.select("div.server-items");

    for (var group of groups) {
      var sourceType = group.attr("data-id");
      var serverEls = group.select("span.server");

      for (var serverEl of serverEls) {
        var serverId = serverEl.attr("data-lid");
        var serverName = serverEl.text.trim();

        try {
          var tokenC = await this.encKai(serverId);
          var linkRes = await this.client.get(
            this.source.baseUrl + "/ajax/links/view?id=" + serverId + "&_=" + tokenC,
            this.ajaxHeaders
          );
          var kaiEncoded = JSON.parse(linkRes.body).result;
          var decrypted = await this.decKai(kaiEncoded);
          var megaUrl = decrypted.url;

          var parts = megaUrl.replace(/\/$/, "").split("/");
          var megaToken = parts[parts.length - 1];

          var megaRes = await this.client.get(
            "https://megaup.net/media/" + megaToken,
            { "User-Agent": this.ua, "Referer": megaUrl }
          );
          var megaEncoded = JSON.parse(megaRes.body).result;
          var decoded = await this.decMega(megaEncoded);

          var subtitles = [];
          if (decoded.tracks) {
            for (var t = 0; t < decoded.tracks.length; t++) {
              var track = decoded.tracks[t];
              if (track.kind === "captions" || track.kind === "subtitles") {
                subtitles.push({ label: track.label || "Unknown", file: track.file });
              }
            }
          }

          if (decoded.sources && decoded.sources.length > 0) {
            var m3u8Url = decoded.sources[0].file;
            streams.push({
              url: m3u8Url,
              originalUrl: m3u8Url,
              quality: serverName + " [" + sourceType + "]",
              subtitles: subtitles,
              headers: {
                "User-Agent": this.ua,
                "Referer": "https://megaup.net/",
              },
            });
            break;
          }
        } catch (e) {}
      }
    }

    return streams;
  }

  getSourcePreferences() {
    return [];
  }
}
