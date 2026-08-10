const mangayomiSources = [
  {
    "name": "AnimePahe",
    "id": 728456139,
    "lang": "en",
    "baseUrl": "https://animepahe.ch",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://animepahe.ch",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.4.0",
    "pkgPath": "anime/src/en/animepahe.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": true,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/animepahe.js",
    "dateFormat": "",
    "dateFormatLocale": "",
    "additionalParams": "",
    "sourceCodeLanguage": 1,
    "notes": "",
  },
];

// animepahe.ch is a Themesia/AnimeStream WordPress site. Metadata is plain HTML
// with no Cloudflare gate. Playback is the hard part: the episode page's HD 1/2/3
// switcher (blogger / flixcloud / megaplay) is all dead — blogger delegates to an
// origin-authorized YouTube handshake, flixcloud's CDN blocks byte delivery even
// for its own player, and megaplay returns a ~96% ad-poisoned playlist.
//
// The one viable stream is the **kwik.cx** mirror in the `.soraddl` download box.
// kwik is the real AnimePahe player: its /e/{id} embed carries a P.A.C.K.E.R
// script that unpacks to `const source='https://…uwucdn.top/…/uwu.m3u8'` — an
// AES-128 HLS playlist that plays with a kwik.cx Referer.
//
// kwik.cx sits behind a Cloudflare Turnstile challenge (the solvable, cookie-
// issuing kind), so this source declares hasCloudflare:true — the app's WebView
// clears it once and the cf_clearance cookie carries subsequent requests.
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

  get supportsLatest() {
    return true;
  }

  async fetchDoc(path) {
    var url = path.startsWith("http") ? path : this.source.baseUrl + path;
    var res = await this.client.get(url, this.headers);
    return new Document(res.body || "");
  }

  // Listing grids are identical across /series/, search and the homepage:
  //   <div class="listupd"><article><div class="bsx">
  //     <a href title><div class="limit"><div class="bt"><span class="epx">…</span></div>
  //       <img src></div></a><div class="tt"><h2>Title</h2>
  parseList(doc) {
    var list = [];
    var items = doc.select(".listupd article");
    for (var i = 0; i < items.length; i++) {
      var a = items[i].selectFirst("a");
      if (!a) continue;
      var link = a.attr("href") || "";
      if (!link) continue;
      if (!link.startsWith("http")) link = this.source.baseUrl + link;

      var name = (a.attr("title") || "").trim();
      if (!name) {
        var t = items[i].selectFirst(".tt h2, .ntitle, h2");
        if (t) name = (t.text || "").trim();
      }
      if (!name) continue;

      var img = items[i].selectFirst("img");
      var imageUrl = img ? (img.attr("src") || img.attr("data-src") || "") : "";

      list.push({ name: name, imageUrl: imageUrl, link: link });
    }
    return list;
  }

  hasNextPage(doc) {
    return !!doc.selectFirst(".hpage a.r, a.next.page-numbers, .pagination .next");
  }

  async getPopular(page) {
    var doc = await this.fetchDoc("/series/?page=" + page + "&status=&type=&order=popular");
    return { list: this.parseList(doc), hasNextPage: this.hasNextPage(doc) };
  }

  async getLatestUpdates(page) {
    var doc = await this.fetchDoc("/series/?page=" + page + "&status=&type=&order=update");
    return { list: this.parseList(doc), hasNextPage: this.hasNextPage(doc) };
  }

  async search(query, page, filters) {
    try {
      var doc = await this.fetchDoc("/page/" + page + "/?s=" + encodeURIComponent(query));
      return { list: this.parseList(doc), hasNextPage: this.hasNextPage(doc) };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  statusCode(text) {
    var t = (text || "").toLowerCase();
    if (t.includes("completed") || t.includes("finished")) return 1;
    if (t.includes("upcoming") || t.includes("not yet")) return 4;
    if (t.includes("ongoing") || t.includes("airing") || t.includes("releasing")) return 0;
    return 5;
  }

  async getDetail(url) {
    var doc = await this.fetchDoc(url);

    var name = "";
    var h1 = doc.selectFirst("h1.entry-title, h1");
    if (h1) name = (h1.text || "").trim();

    var img = doc.selectFirst(".thumb img, .thumbook img, img.ts-post-image");
    var imageUrl = img ? (img.attr("src") || img.attr("data-src") || "") : "";

    var description = "";
    var syn = doc.selectFirst(".entry-content");
    if (syn) description = (syn.text || "").trim();

    var genre = [];
    var gs = doc.select(".genxed a, .genre-info a");
    for (var g = 0; g < gs.length; g++) {
      var gt = (gs[g].text || "").trim();
      if (gt) genre.push(gt);
    }

    var status = 5;
    var spans = doc.select(".spe span");
    for (var s = 0; s < spans.length; s++) {
      var txt = (spans[s].text || "").trim();
      if (txt.toLowerCase().startsWith("status")) {
        status = this.statusCode(txt);
        break;
      }
    }

    // Episode list: <ul class="eplister"><li><a href>
    //   <div class="epl-num">3</div><div class="epl-title">…</div><div class="epl-date">…</div>
    var chapters = [];
    var eps = doc.select(".eplister li");
    for (var e = 0; e < eps.length; e++) {
      var ea = eps[e].selectFirst("a");
      if (!ea) continue;
      var href = ea.attr("href") || "";
      if (!href) continue;
      if (!href.startsWith("http")) href = this.source.baseUrl + href;

      var numEl = eps[e].selectFirst(".epl-num");
      var num = numEl ? (numEl.text || "").trim() : "";
      var dateEl = eps[e].selectFirst(".epl-date");
      var dateStr = dateEl ? (dateEl.text || "").trim() : "";

      chapters.push({
        name: num ? "Episode " + num : ((eps[e].selectFirst(".epl-title") || {}).text || "Episode").trim(),
        url: href,
        dateUpload: this._parseDate(dateStr),
      });
    }
    // Site already lists newest-first (Mangayomi convention).

    return {
      name: name,
      imageUrl: imageUrl,
      description: description,
      genre: genre,
      status: status,
      link: url.startsWith("http") ? url : this.source.baseUrl + url,
      chapters: chapters,
    };
  }

  // "July 12, 2026" → epoch millis (string). "" when unparseable so the app omits it.
  _parseDate(s) {
    if (!s) return "";
    var months = {
      january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
      july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    };
    var m = s.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
    if (!m) return "";
    var mo = months[m[1].toLowerCase()];
    if (mo === undefined) return "";
    return String(Date.UTC(parseInt(m[3], 10), mo, parseInt(m[2], 10)));
  }

  // ── kwik.cx stream resolution ───────────────────────────────────────────────

  // Deobfuscate kwik's P.A.C.K.E.R script by *running* the packer (with its eval
  // calls redirected to a capture hook) rather than reversing it by regex. Kwik's
  // payload contains "}(" sequences that break naive arg-extraction, so regex
  // unpackers (including the app's built-in unpackJs) yield the wrong layer and
  // never expose `const source`. A global capture is used (not an `eval`-named
  // parameter) so it stays valid under strict mode.
  runPacker(scriptText) {
    try {
      globalThis.__kwikOut = "";
      globalThis.__kwikCap = function (c) { globalThis.__kwikOut = String(c); return c; };
      var patched = scriptText.replace(/\beval\(/g, "globalThis.__kwikCap(");
      (new Function(patched))();
      return globalThis.__kwikOut || "";
    } catch (e) {
      return "";
    }
  }

  unpack(scriptText) {
    var out = this.runPacker(scriptText);
    if (!out || out.indexOf("source") < 0) {
      try { var u = unpackJs(scriptText); if (u && u.indexOf("source") >= 0) out = u; } catch (e) {}
    }
    return out;
  }

  // Pull the <script> element carrying the P.A.C.K.E.R payload from raw HTML.
  extractPackerScript(html) {
    try {
      var doc = new Document(html);
      var scripts = doc.select("script");
      for (var i = 0; i < scripts.length; i++) {
        var t = scripts[i].text;
        if (t && t.indexOf("eval(function(p,a,c,k,e,d)") >= 0) return t.trim();
      }
    } catch (e) {}
    var m = html.match(/<script[^>]*>((?:(?!<\/script>)[\s\S])*?eval\(function\(p,a,c,k,e,d\)(?:(?!<\/script>)[\s\S])*?)<\/script>/);
    return m ? m[1].trim() : "";
  }

  // Resolve a kwik /e/{id} embed URL to its HLS source URL.
  async resolveKwik(embedUrl) {
    try {
      var res = await this.client.get(embedUrl, {
        "User-Agent": this.ua,
        "Referer": this.source.baseUrl + "/",
      });
      if (!res || !res.body) return null;
      var scriptText = this.extractPackerScript(res.body);
      if (!scriptText) return null;
      var unpacked = this.unpack(scriptText);
      var srcMatch = unpacked.match(/source\s*=\s*'([^']+\.m3u8[^']*)'/) ||
                     unpacked.match(/source\s*=\s*"([^"]+\.m3u8[^"]*)"/);
      return srcMatch ? srcMatch[1] : null;
    } catch (e) {
      return null;
    }
  }

  async getVideoList(url) {
    var epUrl = url.startsWith("http") ? url : this.source.baseUrl + url;
    var res = await this.client.get(epUrl, this.headers);
    var html = (res && res.body) || "";

    // The `.soraddl` download box lists mirror servers as
    //   <li><span class="q"><b>Pahe</b></span><span class="w">720</span>
    //     <span class="e"><a href="https://kwik.cx/f/{id}">Download</a></span></li>
    // Collect every kwik id, deduped. The /f/ (download) and /e/ (embed) forms
    // share the id; the P.A.C.K.E.R m3u8 lives on /e/.
    var ids = [];
    var seen = {};
    var re = /kwik\.cx\/[efd]\/([A-Za-z0-9]+)/g;
    var m;
    while ((m = re.exec(html)) !== null) {
      if (!seen[m[1]]) {
        seen[m[1]] = true;
        ids.push(m[1]);
      }
    }
    if (ids.length === 0) return [];

    var streams = [];
    for (var i = 0; i < ids.length; i++) {
      var embed = "https://kwik.cx/e/" + ids[i];
      var m3u8 = await this.resolveKwik(embed);
      if (!m3u8) continue;

      var streamHeaders = {
        "User-Agent": this.ua,
        "Referer": "https://kwik.cx/",
        "Origin": "https://kwik.cx",
      };

      // Split the master into per-resolution entries so the app's quality picker
      // has real choices; fall back to the master URL if it's a media playlist.
      var variants = await this._parseHlsVariants(m3u8, streamHeaders);
      if (variants.length) {
        for (var v = 0; v < variants.length; v++) {
          streams.push({
            url: variants[v].url,
            originalUrl: m3u8,
            quality: variants[v].label + " - Kwik",
            headers: streamHeaders,
            subtitles: [],
          });
        }
      } else {
        streams.push({
          url: m3u8,
          originalUrl: m3u8,
          quality: "Kwik",
          headers: streamHeaders,
          subtitles: [],
        });
      }
    }
    return streams;
  }

  // Fetch a master playlist and return [{url,label}] for each RESOLUTION variant.
  // Returns [] for a media playlist (no variants) or on any failure.
  async _parseHlsVariants(m3u8Url, headers) {
    try {
      var res = await this.client.get(m3u8Url, headers);
      var body = (res && res.body) || "";
      if (body.indexOf("#EXT-X-STREAM-INF") < 0) return [];
      var base = m3u8Url.replace(/\/[^/]*$/, "/");
      var out = [];
      var lines = body.split("\n");
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].indexOf("#EXT-X-STREAM-INF") !== 0) continue;
        var resM = lines[i].match(/RESOLUTION=\d+x(\d+)/);
        var label = resM ? resM[1] + "p" : "Auto";
        // The URL is on the next non-comment line.
        for (var j = i + 1; j < lines.length; j++) {
          var u = lines[j].trim();
          if (!u || u.charAt(0) === "#") continue;
          out.push({ url: u.startsWith("http") ? u : base + u, label: label });
          break;
        }
      }
      return out;
    } catch (e) {
      return [];
    }
  }

  getFilterList() {
    return [];
  }

  getSourcePreferences() {
    return [];
  }
}
