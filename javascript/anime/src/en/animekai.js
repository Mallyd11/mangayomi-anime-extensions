const mangayomiSources = [
  {
    "name": "AnimeKai",
    "id": 753902841,
    "lang": "en",
    "baseUrl": "https://anikai.to",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://anikai.to",
    "typeSource": "single",
    "itemType": 1,
    "version": "1.0.9",
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
    var res = await this.client.post(
      "https://enc-dec.app/api/dec-kai",
      { "Content-Type": "application/json", "User-Agent": this.ua },
      JSON.stringify({ text: text })
    );
    var result = JSON.parse(res.body).result;
    return typeof result === "string" ? JSON.parse(result) : result;
  }

  async decMega(text) {
    var res = await this.client.post(
      "https://enc-dec.app/api/dec-mega",
      { "Content-Type": "application/json", "User-Agent": this.ua, "Referer": this.source.baseUrl + "/" },
      JSON.stringify({ text: text, agent: this.ua })
    );
    var result = JSON.parse(res.body).result;
    return typeof result === "string" ? JSON.parse(result) : result;
  }

  parseList(body) {
    var list = [];
    var rx = /<div class="aitem">[\s\S]*?<a href="([^"]*)" class="poster">[\s\S]*?data-src="([^"]*)"[\s\S]*?<a class="title"[^>]*title="([^"]*)"/g;
    var m;
    while ((m = rx.exec(body)) !== null) {
      var href = m[1];
      var imageUrl = m[2];
      var name = m[3];
      var link = href.startsWith("http") ? href : this.source.baseUrl + href;
      if (name && link) list.push({ name, imageUrl, link });
    }
    return list;
  }

  hasNextPage(body) {
    return /rel=["']next["']/.test(body);
  }

  async fetchBody(path) {
    var url = path.startsWith("http") ? path : this.source.baseUrl + path;
    var res = await this.client.get(url, this.headers);
    return res.body;
  }

  async fetchDoc(path) {
    return new Document(await this.fetchBody(path));
  }

  async getPopular(page) {
    var body = await this.fetchBody("/browser?sort=most_viewed&page=" + page);
    return { list: this.parseList(body), hasNextPage: this.hasNextPage(body) };
  }

  get supportsLatest() {
    return true;
  }

  async getLatestUpdates(page) {
    var body = await this.fetchBody("/updates?page=" + page);
    return { list: this.parseList(body), hasNextPage: this.hasNextPage(body) };
  }

  async search(query, page, filters) {
    var body = await this.fetchBody(
      "/browser?keyword=" + encodeURIComponent(query) + "&page=" + page
    );
    return { list: this.parseList(body), hasNextPage: this.hasNextPage(body) };
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
          chapters.push({ name: "E" + num + ": " + epTitle + langTag, url: this.source.baseUrl + "/iframe/" + epToken });
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
    var epToken = url.includes("/iframe/") ? url.split("/iframe/").pop() : url;
    var streams = [];

    var tokenB = await this.encKai(epToken);
    var serverRes = await this.client.get(
      this.source.baseUrl + "/ajax/links/list?token=" + epToken + "&_=" + tokenB,
      this.ajaxHeaders
    );
    var serverHtml = JSON.parse(serverRes.body).result;

    // Parse groups+servers via regex — Mangayomi's Document API fails on multi-class
    // selectors (e.g. "server-items lang-group" doesn't match div.server-items)
    var groups = [];
    var curGroup = null;
    var rx = /<div[^>]*server-items[^>]*data-id="([^"]+)"|<span[^>]*class="server"[^>]*data-lid="([^"]+)"[^>]*>([^<]*)/g;
    var mm;
    while ((mm = rx.exec(serverHtml)) !== null) {
      if (mm[1] !== undefined) {
        curGroup = { sourceType: mm[1], servers: [] };
        groups.push(curGroup);
      } else if (mm[2] !== undefined && curGroup) {
        curGroup.servers.push({ serverId: mm[2], serverName: mm[3].trim() || "Server" });
      }
    }

    for (var group of groups) {
      for (var serverObj of group.servers) {
        try {
          var tokenC = await this.encKai(serverObj.serverId);
          var linkRes = await this.client.get(
            this.source.baseUrl + "/ajax/links/view?id=" + serverObj.serverId + "&_=" + tokenC,
            this.ajaxHeaders
          );
          var kaiEncoded = JSON.parse(linkRes.body).result;
          var decrypted = await this.decKai(kaiEncoded);
          var megaUrl = decrypted.url;
          var megaDomain = megaUrl.match(/https?:\/\/([^\/]+)/)[1];
          var megaReferer = "https://" + megaDomain + "/";
          var mediaUrl = megaUrl.replace("/e/", "/media/");

          var megaRes = await this.client.get(
            mediaUrl,
            { "User-Agent": this.ua, "Referer": megaReferer }
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
              quality: serverObj.serverName + " [" + group.sourceType + "]",
              subtitles: subtitles,
              headers: {
                "User-Agent": this.ua,
                "Referer": megaReferer,
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
