const mangayomiSources = [
  {
    "name": "AnimeKai",
    "id": 753902841,
    "lang": "en",
    "baseUrl": "https://anikai.to",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://anikai.to",
    "typeSource": "single",
    "itemType": 1,
    "version": "1.1.2",
    "pkgPath": "anime/src/en/animekai.js",
  },
];

class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
  }

  get ua() {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
  }

  // Fetch a regular HTML page from anikai.to
  async fetchPage(path) {
    var url = path.startsWith("http") ? path : this.source.baseUrl + path;
    var res = await this.client.get(url, {
      "User-Agent": this.ua,
      "Referer": this.source.baseUrl + "/",
      "Cookie": "__ddg1_=;__ddg2_=;",
    });
    return res.body;
  }

  // Fetch a JSON-returning AJAX endpoint on anikai.to
  async fetchAjax(path) {
    var res = await this.client.get(this.source.baseUrl + path, {
      "User-Agent": this.ua,
      "Referer": this.source.baseUrl + "/",
      "X-Requested-With": "XMLHttpRequest",
    });
    return res.body;
  }

  // enc-dec.app: encrypt a token for use in anikai.to AJAX calls
  async encKai(text) {
    var res = await this.client.get(
      "https://enc-dec.app/api/enc-kai?text=" + encodeURIComponent(text),
      { "User-Agent": this.ua }
    );
    return JSON.parse(res.body).result;
  }

  // enc-dec.app: decrypt the encrypted link returned by /ajax/links/view
  async decKai(text) {
    var res = await this.client.post(
      "https://enc-dec.app/api/dec-kai",
      { "Content-Type": "application/json", "User-Agent": this.ua },
      JSON.stringify({ text: text })
    );
    var result = JSON.parse(res.body).result;
    return typeof result === "string" ? JSON.parse(result) : result;
  }

  // enc-dec.app: decrypt the encrypted payload from megaup /media/ endpoint
  async decMega(text) {
    var res = await this.client.post(
      "https://enc-dec.app/api/dec-mega",
      { "Content-Type": "application/json", "User-Agent": this.ua },
      JSON.stringify({ text: text, agent: this.ua })
    );
    var result = JSON.parse(res.body).result;
    return typeof result === "string" ? JSON.parse(result) : result;
  }

  // Parse the anime grid present on /browser and /updates pages
  parseList(html) {
    var items = [];
    var rx = /<div class="aitem">[\s\S]*?<a href="([^"]*)" class="poster">[\s\S]*?data-src="([^"]*)"[\s\S]*?<a class="title"[^>]*title="([^"]*)"/g;
    var m;
    while ((m = rx.exec(html)) !== null) {
      var link = m[1].startsWith("http") ? m[1] : this.source.baseUrl + m[1];
      if (m[3] && link) items.push({ name: m[3], imageUrl: m[2], link: link });
    }
    return items;
  }

  hasNextPage(html) {
    return /rel=["']next["']/.test(html);
  }

  // ── MProvider interface ────────────────────────────────────────────────────

  async getPopular(page) {
    var html = await this.fetchPage("/browser?sort=most_viewed&page=" + page);
    return { list: this.parseList(html), hasNextPage: this.hasNextPage(html) };
  }

  get supportsLatest() {
    return true;
  }

  async getLatestUpdates(page) {
    var html = await this.fetchPage("/updates?page=" + page);
    return { list: this.parseList(html), hasNextPage: this.hasNextPage(html) };
  }

  async search(query, page, filters) {
    var html = await this.fetchPage(
      "/browser?keyword=" + encodeURIComponent(query) + "&page=" + page
    );
    return { list: this.parseList(html), hasNextPage: this.hasNextPage(html) };
  }

  async getDetail(url) {
    var html = await this.fetchPage(url);

    // Title
    var name = "";
    var nm = html.match(/<h1[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)/) ||
              html.match(/<h2[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)/);
    if (nm) name = nm[1].trim();

    // Cover image (inside .poster wrapper)
    var imageUrl = "";
    var im = html.match(/class="[^"]*poster[^"]*"[\s\S]{0,300}?(?:src|data-src)="([^"]+)"/);
    if (im) imageUrl = im[1];

    // Synopsis
    var description = "";
    var dm = html.match(/<div[^>]*class="desc"[^>]*>([\s\S]*?)<\/div>/);
    if (dm) description = dm[1].replace(/<[^>]+>/g, "").trim();

    // Genres
    var genre = [];
    var genreRx = /href="[^"]*\/genres\/[^"]*"[^>]*>([^<]+)/g;
    var gm;
    while ((gm = genreRx.exec(html)) !== null) genre.push(gm[1].trim());

    // Status
    var status = 5;
    var stm = html.match(/class="status"[^>]*>[\s\S]*?<span>([^<]+)/);
    if (stm) {
      var raw = stm[1].trim().toLowerCase();
      if (raw === "releasing") status = 0;
      else if (raw === "completed") status = 1;
    }

    // Internal anime ID (needed for the episodes AJAX call)
    var aniId = "";
    var aim = html.match(/class="rate-box"[^>]*data-id="([^"]+)"/) ||
               html.match(/data-id="([^"]+)"[^>]*class="rate-box"/) ||
               html.match(/id="anime-rating"[^>]*data-id="([^"]+)"/) ||
               html.match(/data-id="([^"]+)"[^>]*id="anime-rating"/);
    if (aim) aniId = aim[1];

    // Episode list
    var chapters = [];
    if (aniId) {
      try {
        var epToken = await this.encKai(aniId);
        var epBody = await this.fetchAjax(
          "/ajax/episodes/list?ani_id=" + aniId + "&_=" + epToken
        );
        var epHtml = JSON.parse(epBody).result;

        // Each episode: <a num="1" token="..." langs="1">...<span>Title</span>...</a>
        var epRx = /<a\s[^>]*\btoken="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
        var em;
        while ((em = epRx.exec(epHtml)) !== null) {
          var tok = em[1];
          var fullTag = em[0];
          var inner = em[2];
          var numM = fullTag.match(/\bnum="(\d+)"/);
          if (!numM) continue;
          var num = numM[1];
          var langsM = fullTag.match(/\blangs="(\d)"/);
          var langs = langsM ? langsM[1] : "1";
          var titleM = inner.match(/<span[^>]*>([^<]+)/);
          var epTitle = titleM ? titleM[1].trim() : "Episode " + num;
          var dub = langs === "2" || langs === "3";
          chapters.push({
            name: "E" + num + ": " + epTitle + (dub ? " [Sub+Dub]" : " [Sub]"),
            url: this.source.baseUrl + "/iframe/" + tok,
          });
        }
        chapters.reverse();
      } catch (e) {}
    }

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

  async getVideoList(url) {
    // Chapter URLs are stored as baseUrl/iframe/{epToken}
    var epToken = url.includes("/iframe/") ? url.split("/iframe/").pop() : url;
    var streams = [];
    var errors = [];

    try {
      // Step 1: encrypt the episode token to request the server list
      var tokenB = await this.encKai(epToken);
      var serverBody = await this.fetchAjax(
        "/ajax/links/list?token=" + epToken + "&_=" + tokenB
      );
      var serverHtml = JSON.parse(serverBody).result;

      // Step 2: parse server groups + server entries from the HTML.
      // NOTE: Mangayomi's Document API does exact class matching, so
      //   doc.select("div.server-items") misses <div class="server-items lang-group">.
      // We use a single-pass regex scan instead.
      var groups = [];
      var curGroup = null;
      var srx = /<div[^>]*server-items[^>]*data-id="([^"]+)"|<span[^>]*class="server"[^>]*data-lid="([^"]+)"[^>]*>([^<]*)/g;
      var mm;
      while ((mm = srx.exec(serverHtml)) !== null) {
        if (mm[1] !== undefined) {
          curGroup = { sourceType: mm[1], servers: [] };
          groups.push(curGroup);
        } else if (mm[2] !== undefined && curGroup) {
          curGroup.servers.push({
            serverId: mm[2],
            serverName: mm[3].trim() || "Server",
          });
        }
      }

      errors.push("groups:" + groups.length);

      // Step 3: for each group try servers in order until one resolves
      for (var gi = 0; gi < groups.length; gi++) {
        var group = groups[gi];
        for (var si = 0; si < group.servers.length; si++) {
          var server = group.servers[si];
          try {
            var tokenC = await this.encKai(server.serverId);
            var linkBody = await this.fetchAjax(
              "/ajax/links/view?id=" + server.serverId + "&_=" + tokenC
            );
            var kaiEncoded = JSON.parse(linkBody).result;
            var decrypted = await this.decKai(kaiEncoded);
            var megaUrl = decrypted.url;

            var domainM = megaUrl.match(/https?:\/\/([^\/]+)/);
            var megaDomain = domainM[1];
            var megaReferer = "https://" + megaDomain + "/";
            var mediaUrl = megaUrl.replace("/e/", "/media/");

            var megaRes = await this.client.get(mediaUrl, {
              "User-Agent": this.ua,
              "Referer": megaReferer,
            });
            var megaEncoded = JSON.parse(megaRes.body).result;
            var decoded = await this.decMega(megaEncoded);

            var subtitles = [];
            if (decoded.tracks) {
              for (var ti = 0; ti < decoded.tracks.length; ti++) {
                var track = decoded.tracks[ti];
                if (track.kind === "captions" || track.kind === "subtitles") {
                  subtitles.push({ label: track.label || "Unknown", file: track.file });
                }
              }
            }

            if (decoded.sources && decoded.sources.length > 0) {
              var m3u8 = decoded.sources[0].file;
              streams.push({
                url: m3u8,
                originalUrl: m3u8,
                quality: server.serverName + " [" + group.sourceType + "]",
                subtitles: subtitles,
                headers: { "User-Agent": this.ua, "Referer": megaReferer },
              });
              break;
            }
          } catch (e) {
            errors.push(group.sourceType + si + ":" + String(e).substring(0, 60));
          }
        }
      }
    } catch (e) {
      errors.push("outer:" + String(e).substring(0, 100));
    }

    // If no streams found, surface a debug entry with error info in the quality name.
    // Uses a real m3u8 URL so Mangayomi doesn't filter the entry out.
    if (streams.length === 0) {
      streams.push({
        url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
        originalUrl: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
        quality: "[DBG] " + errors.join(" | ").substring(0, 250),
        subtitles: [],
        headers: {},
      });
    }

    return streams;
  }

  getSourcePreferences() {
    return [];
  }
}
