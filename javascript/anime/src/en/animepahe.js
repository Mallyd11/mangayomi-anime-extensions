const mangayomiSources = [
  {
    "name": "AnimePahe",
    "id": 728456139,
    "lang": "en",
    "baseUrl": "https://animepahe.pw",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://animepahe.pw",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.2.1",
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

// animepahe.pw — the real AnimePahe (Laravel app + JSON API), behind Cloudflare.
// Metadata comes from /api (m=airing|search|release). Streams come from the
// /play/{animeSession}/{episodeSession} page, which embeds kwik.cx players.
// Each kwik /e/{id} page carries a P.A.C.K.E.R-obfuscated script; unpacking it
// exposes `const source='https://vault-NN.uwucdn.top/.../uwu.m3u8'` — an
// AES-128 HLS playlist that plays once served with a kwik.cx Referer.
class DefaultExtension extends MProvider {
  constructor() {
    super();
    // animepahe.pw + kwik.cx fingerprint-gate Cloudflare: the app's default
    // rhttp (Rust) stack can be stalled/blocked with no CF-signature response,
    // so tabs silently fail. Cap rhttp at 12s so a stall fails fast, and keep a
    // Dart-stack client as a fallback (its TLS fingerprint differs from rhttp's).
    this.client = new Client({ timeout: 12 });
    this.fallbackClient = new Client({ useDartHttpClient: true });
  }

  // GET via rhttp first, then the Dart HTTP stack. Both share the app's
  // cookie/Cloudflare interceptors; only the transport (TLS fingerprint) differs.
  async _get(url, headers) {
    try {
      var res = await this.client.get(url, headers);
      if (res && res.body) return res;
    } catch (e) {}
    return await this.fallbackClient.get(url, headers);
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

  get apiHeaders() {
    return {
      "User-Agent": this.ua,
      "Referer": this.source.baseUrl + "/",
      "Accept": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    };
  }

  async getJson(path) {
    var url = path.startsWith("http") ? path : this.source.baseUrl + path;
    var res = await this._get(url, this.apiHeaders);
    try { return JSON.parse(res.body); } catch (e) { return null; }
  }

  // ---- Browse / search -------------------------------------------------

  // The airing feed is per-episode; collapse to one card per anime.
  animeListFromAiring(data) {
    var list = [];
    var seen = {};
    var rows = (data && data.data) ? data.data : [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r.anime_session || seen[r.anime_id]) continue;
      seen[r.anime_id] = true;
      list.push({
        name: r.anime_title,
        imageUrl: r.snapshot || "",
        link: this.source.baseUrl + "/anime/" + r.anime_session,
      });
    }
    return list;
  }

  get supportsLatest() {
    return true;
  }

  async getPopular(page) {
    try {
      var data = await this.getJson("/api?m=airing&page=" + page);
      var list = this.animeListFromAiring(data);
      return { list: list, hasNextPage: data ? page < (data.last_page || 1) : false };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  async getLatestUpdates(page) {
    return await this.getPopular(page);
  }

  async search(query, page, filters) {
    try {
      var data = await this.getJson("/api?m=search&q=" + encodeURIComponent(query));
      var rows = (data && data.data) ? data.data : [];
      var list = [];
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (!r.session) continue;
        list.push({
          name: r.title,
          imageUrl: r.poster || "",
          link: this.source.baseUrl + "/anime/" + r.session,
        });
      }
      return { list: list, hasNextPage: false };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  // ---- Detail ----------------------------------------------------------

  statusCode(status) {
    var s = (status || "").toLowerCase();
    if (s.includes("finished") || s.includes("completed")) return 1;
    if (s.includes("currently") || s.includes("airing") || s.includes("ongoing") || s.includes("releasing")) return 0;
    if (s.includes("not yet") || s.includes("upcoming")) return 4;
    return 5;
  }

  sessionFromUrl(url) {
    var m = url.match(/\/anime\/([^\/?#]+)/);
    return m ? m[1] : "";
  }

  async getDetail(url) {
    var session = this.sessionFromUrl(url);
    if (!session) throw new Error("Could not parse anime session from: " + url);

    // Metadata page + first episode page in parallel.
    var animeUrl = this.source.baseUrl + "/anime/" + session;
    var [pageRes, firstRelease] = await Promise.all([
      this._get(animeUrl, this.headers),
      this.getJson("/api?m=release&id=" + session + "&sort=episode_asc&page=1"),
    ]);
    var doc = new Document(pageRes.body);

    var name = "";
    var ogTitle = doc.selectFirst("meta[property='og:title']");
    if (ogTitle) name = (ogTitle.attr("content") || "").trim();
    if (!name) {
      var h1 = doc.selectFirst("h1");
      if (h1) {
        name = h1.text.trim();
        // The h1 renders the title twice; halve it if it is an exact doubling.
        var half = name.length / 2;
        if (name.length % 2 === 0 && name.slice(0, half) === name.slice(half)) {
          name = name.slice(0, half);
        }
      }
    }

    var imageUrl = "";
    var ogImage = doc.selectFirst("meta[property='og:image']");
    if (ogImage) imageUrl = ogImage.attr("content") || "";

    var description = "";
    var syn = doc.selectFirst(".anime-synopsis");
    if (syn) description = syn.text.trim();

    var genre = [];
    var genreEls = doc.select(".anime-genre a");
    for (var g = 0; g < genreEls.length; g++) {
      var gt = genreEls[g].text.trim();
      if (gt) genre.push(gt);
    }

    var status = 5;
    var infoEls = doc.select(".anime-info p");
    for (var p = 0; p < infoEls.length; p++) {
      var t = infoEls[p].text.replace(/\s+/g, " ").trim();
      if (/^Status:/i.test(t)) { status = this.statusCode(t); break; }
    }

    var chapters = await this.buildChapters(session, firstRelease);

    return {
      name: name,
      imageUrl: imageUrl,
      description: description,
      genre: genre,
      status: status,
      link: animeUrl,
      chapters: chapters,
    };
  }

  // Episodes come from the paginated release API. Fetch page 1 (already have it),
  // then the rest in parallel, and return newest-first.
  async buildChapters(session, firstRelease) {
    var pages = [firstRelease];
    var lastPage = firstRelease ? (firstRelease.last_page || 1) : 1;
    if (lastPage > 1) {
      var reqs = [];
      for (var pg = 2; pg <= lastPage; pg++) {
        reqs.push(this.getJson("/api?m=release&id=" + session + "&sort=episode_asc&page=" + pg));
      }
      var rest = await Promise.all(reqs);
      pages = pages.concat(rest);
    }

    var chapters = [];
    for (var i = 0; i < pages.length; i++) {
      var rows = (pages[i] && pages[i].data) ? pages[i].data : [];
      for (var j = 0; j < rows.length; j++) {
        var ep = rows[j];
        if (!ep.session) continue;
        var epLabel = "Episode " + ep.episode;
        if (ep.title && ep.title.trim()) epLabel += ": " + ep.title.trim();
        var dateUpload = null;
        if (ep.created_at) {
          var ms = Date.parse(ep.created_at.replace(" ", "T") + "Z");
          if (!isNaN(ms)) dateUpload = String(ms);
        }
        chapters.push({
          name: epLabel,
          url: this.source.baseUrl + "/play/" + session + "/" + ep.session,
          dateUpload: dateUpload,
          scanlator: ep.audio === "eng" ? "Dub" : "Sub",
        });
      }
    }
    chapters.reverse(); // newest first (Mangayomi convention)
    return chapters;
  }

  // ---- Streams ---------------------------------------------------------

  // Deobfuscate kwik's P.A.C.K.E.R script by *running* the packer (with its
  // eval calls redirected to a capture hook) rather than reversing it by regex.
  // Kwik's payload contains "}(" sequences that break naive arg-extraction, so
  // regex unpackers (including the app's built-in unpackJs) yield the wrong
  // layer and never expose `const source`. Running the packer is exact.
  // A global capture is used (not an `eval`-named parameter) so it stays valid
  // under strict mode.
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
    // Last-resort: the app's regex unpacker, in case Function is unavailable.
    if (!out || out.indexOf("source") < 0) {
      try { var u = unpackJs(scriptText); if (u && u.indexOf("source") >= 0) out = u; } catch (e) {}
    }
    return out;
  }

  // Pull the <script> element that carries the P.A.C.K.E.R payload from raw HTML.
  extractPackerScript(html) {
    try {
      var doc = new Document(html);
      var scripts = doc.select("script");
      for (var i = 0; i < scripts.length; i++) {
        var t = scripts[i].text;
        if (t && t.indexOf("eval(function(p,a,c,k,e,d)") >= 0) return t.trim();
      }
    } catch (e) {}
    // Fallback: isolate a single <script> block by non-greedy scan.
    var m = html.match(/<script[^>]*>((?:(?!<\/script>)[\s\S])*?eval\(function\(p,a,c,k,e,d\)(?:(?!<\/script>)[\s\S])*?)<\/script>/);
    return m ? m[1].trim() : "";
  }

  // Resolve a kwik /e/ embed URL to its HLS source URL.
  async resolveKwik(embedUrl) {
    try {
      var res = await this._get(embedUrl, {
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
    var res = await this._get(url, this.headers);
    if (!res || !res.body) return [];
    var doc = new Document(res.body);

    var audioPref = "sub";
    try { audioPref = new SharedPreferences().get("animepahe_pref_audio") || "sub"; } catch (e) {}

    // Collect kwik buttons: data-src (embed), data-resolution, data-audio, data-fansub.
    var buttons = doc.select("button[data-src]");
    var entries = [];
    for (var i = 0; i < buttons.length; i++) {
      var src = buttons[i].attr("data-src");
      if (!src || src.indexOf("kwik") < 0) continue;
      entries.push({
        src: src.indexOf("http") === 0 ? src : "https:" + src,
        res: parseInt(buttons[i].attr("data-resolution") || "0", 10),
        audio: buttons[i].attr("data-audio") || "jpn",
        fansub: buttons[i].attr("data-fansub") || "",
      });
    }

    // Resolve all kwik embeds in parallel.
    var self = this;
    var resolved = await Promise.all(entries.map(function (e) {
      return self.resolveKwik(e.src).then(function (m3u8) {
        return m3u8 ? { entry: e, url: m3u8 } : null;
      });
    }));

    var streamHeaders = { "User-Agent": this.ua, "Referer": "https://kwik.cx/" };
    var streams = [];
    for (var s = 0; s < resolved.length; s++) {
      if (!resolved[s]) continue;
      var e = resolved[s].entry;
      var audioLabel = e.audio === "eng" ? "Dub" : "Sub";
      var quality = e.res + "p " + audioLabel + (e.fansub ? " · " + e.fansub : "") + " - Kwik";
      streams.push({
        url: resolved[s].url,
        originalUrl: resolved[s].url,
        quality: quality,
        headers: streamHeaders,
        _res: e.res,
        _isDub: e.audio === "eng",
      });
    }

    // Sort: preferred audio first, then resolution high → low.
    var wantDub = audioPref === "dub";
    streams.sort(function (a, b) {
      if (a._isDub !== b._isDub) {
        if (wantDub) return a._isDub ? -1 : 1;
        return a._isDub ? 1 : -1;
      }
      return b._res - a._res;
    });
    for (var k = 0; k < streams.length; k++) { delete streams[k]._res; delete streams[k]._isDub; }
    return streams;
  }

  getFilterList() {
    return [];
  }

  getSourcePreferences() {
    return [
      {
        key: "animepahe_pref_audio",
        listPreference: {
          title: "Preferred audio",
          summary: "Which audio track is listed first for streaming and downloads",
          valueIndex: 0,
          entries: ["Sub (Japanese)", "Dub (English)"],
          entryValues: ["sub", "dub"],
        },
      },
    ];
  }
}
