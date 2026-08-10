const mangayomiSources = [
  {
    "name": "AniWave",
    "id": -367725331,
    "lang": "en",
    "baseUrl": "https://aniwaves.ru",
    "apiUrl": "",
    "iconUrl":
      "https://www.google.com/s2/favicons?sz=256&domain=https://aniwaves.ru",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.1.0",
    "pkgPath": "anime/src/en/aniwave.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": false,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "sourceCodeUrl":
      "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/aniwave.js",
    "dateFormat": "",
    "dateFormatLocale": "",
    "additionalParams": "",
    "sourceCodeLanguage": 1,
    "notes": "",
  },
];

// AniWave (aniwaves.ru) — a 9anime/AniWave-template site.
//
// Everything is server-rendered HTML plus three unauthenticated ajax endpoints:
//   /ajax/episode/list/{animeId}            -> episode <li> list
//   /ajax/server/list?servers={id}&eps={n}  -> sub/dub server <li> list
//   /ajax/sources?id={linkId}               -> {result:{url:"<embed url>"}}
// None of them need the `vrf` token the site's own JS computes, so no crypto
// is reimplemented here.
class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
  }

  get ua() {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
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

  getPreference(key) {
    try {
      return new SharedPreferences().get(key);
    } catch (e) {
      return null;
    }
  }

  abs(path) {
    if (!path) return "";
    if (path.indexOf("http") === 0) return path;
    return this.source.baseUrl + (path.charAt(0) === "/" ? path : "/" + path);
  }

  async fetchDoc(path, headers) {
    var res = await this.client.get(this.abs(path), headers || this.headers);
    return new Document(res.body);
  }

  async fetchAjax(path) {
    var res = await this.client.get(this.abs(path), this.ajaxHeaders);
    var json = JSON.parse(res.body);
    if (!json || json.status !== 200) throw new Error("ajax failed: " + path);
    return json.result;
  }

  // ── Browse ────────────────────────────────────────────────────────────────

  // Cards look like:
  //   #list-items .item > .inner > .ani.poster > a[href] > img[src]
  //                              > .info .b1 > a.name.d-title (English title)
  // The sidebar ("Top rated anime") also uses .item, hence the #list-items scope.
  parseList(doc) {
    var list = [];
    var items = doc.select("#list-items .item");
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var anchor = item.selectFirst("a.name.d-title") || item.selectFirst(".poster a");
      if (!anchor) continue;
      var href = anchor.attr("href");
      if (!href) continue;

      // a.name.d-title carries the English title as text and the romaji in
      // data-jp; fall back to the poster's alt, which is "<romaji> Japanese
      // english subbed", when the card has no title anchor.
      var name = (anchor.text || "").trim();
      var img = item.selectFirst("img");
      if (!name && img) {
        name = (img.attr("alt") || "").replace(/\s+Japanese english subbed$/i, "").trim();
      }
      if (!name) continue;

      list.push({
        name: name,
        link: this.abs(href),
        imageUrl: img ? (img.attr("src") || "") : "",
      });
    }
    return list;
  }

  // The pager renders every reachable page plus « ‹ › » links, so "is there a
  // page number greater than the current one" is a reliable next-page test.
  hasNextPage(doc, page) {
    var links = doc.select(".pagination a.page-link");
    var max = 0;
    for (var i = 0; i < links.length; i++) {
      var href = links[i].attr("href") || "";
      var m = href.match(/[?&]page=(\d+)/);
      if (m) {
        var n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
    return max > page;
  }

  async filterPage(query, page) {
    var sep = query ? "&" : "";
    var doc = await this.fetchDoc("/filter?" + query + sep + "page=" + page);
    var list = this.parseList(doc);
    return { list: list, hasNextPage: this.hasNextPage(doc, page) };
  }

  async getPopular(page) {
    var sort = this.getPreference("aniwave_pref_popular_sort") || "m_view";
    return await this.filterPage("sort_by=" + sort, page);
  }

  async getLatestUpdates(page) {
    return await this.filterPage("sort_by=last_updated", page);
  }

  async search(query, page, filters) {
    var parts = [];
    if (query) parts.push("keyword=" + encodeURIComponent(query));

    // Mangayomi round-trips filters through its own model classes, which keep
    // only type_name/name/state/values — a custom key on the filter object
    // would not survive. So the query param for each filter comes from its
    // position in FILTER_DEFS, the same array getFilterList() is built from.
    try {
      var defs = this.filterDefs();
      for (var i = 0; i < defs.length; i++) {
        var f = (filters || [])[i];
        if (!f) continue;
        var param = defs[i].param;
        if (defs[i].kind === "group") {
          // Checkbox groups repeat the param: genre[]=1&genre[]=4
          for (var j = 0; j < (f.state || []).length; j++) {
            var cb = f.state[j];
            if (cb && cb.state === true && cb.value) {
              parts.push(encodeURIComponent(param) + "=" + encodeURIComponent(cb.value));
            }
          }
        } else {
          var opt = (f.values || [])[f.state || 0];
          if (opt && opt.value) {
            parts.push(encodeURIComponent(param) + "=" + encodeURIComponent(opt.value));
          }
        }
      }
    } catch (e) {}

    // /filter with no criteria at all returns the full catalogue, which is a
    // sensible "browse everything" result rather than an error.
    return await this.filterPage(parts.join("&"), page);
  }

  // ── Detail ────────────────────────────────────────────────────────────────

  statusCode(text) {
    var s = (text || "").toLowerCase();
    if (s.indexOf("finished") >= 0 || s.indexOf("completed") >= 0) return 1;
    if (s.indexOf("releasing") >= 0 || s.indexOf("airing") >= 0 || s.indexOf("ongoing") >= 0) return 0;
    if (s.indexOf("not yet") >= 0 || s.indexOf("upcoming") >= 0) return 4;
    return 5;
  }

  // The li's title attribute comes in three shapes:
  //   "Release: 2002/10/02 15:00 GMT - Enter: Naruto Uzumaki!"
  //   "** Recap Episode ** - Release: <date> GMT - Special Report: ..."
  //   "Episode 17"                       (not yet aired — no real title)
  // Only the trailing episode title is wanted; the filler/recap flag is read
  // from data-filler/data-recap instead, which is set even when the marker
  // prefix is absent.
  episodeTitleFromAttr(title) {
    var t = (title || "").trim();
    t = t.replace(/^\*\*[^*]+\*\*\s*-\s*/, "");
    var m = t.match(/^Release:.*?GMT\s*-\s*([\s\S]+)$/i);
    if (m) return m[1].trim();
    if (/^Episode\s+\d+$/i.test(t)) return "";
    return t;
  }

  async parseEpisodes(animeId) {
    var html = await this.fetchAjax("/ajax/episode/list/" + animeId);
    var doc = new Document(html);
    var chapters = [];
    var lis = doc.select(".episodes li");

    for (var i = 0; i < lis.length; i++) {
      var li = lis[i];
      var a = li.selectFirst("a");
      if (!a) continue;
      var href = a.attr("href");
      if (!href) continue;

      var num = a.attr("data-num") || "";
      // The "detail" list style renders the English title in a span; the
      // "number" style (used for long-running shows) only has the li's title
      // attribute, which holds the same text behind a "Release: ..." prefix.
      var titleEl = a.selectFirst(".d-title");
      var title = titleEl ? (titleEl.text || "").trim() : "";
      if (!title || /^Episode\s+\d+$/i.test(title)) {
        title = this.episodeTitleFromAttr(li.attr("title"));
      }

      var name = "E" + num + (title ? ": " + title : "");

      var hasSub = a.attr("data-sub") === "1";
      var hasDub = a.attr("data-dub") === "1";
      var badge = hasSub && hasDub ? "Sub | Dub" : hasDub ? "Dub" : hasSub ? "Sub" : "";
      // Filler/recap is worth surfacing but not worth cluttering the title with.
      if (a.attr("data-filler") === "1") badge += (badge ? " • " : "") + "Filler";
      if (a.attr("data-recap") === "1") badge += (badge ? " • " : "") + "Recap";

      // data-timestamp is "YYYY-MM-DD HH:MM:SS" in UTC.
      var dateUpload = null;
      var ts = a.attr("data-timestamp");
      if (ts) {
        var parsed = Date.parse(ts.replace(" ", "T") + "Z");
        if (!isNaN(parsed)) dateUpload = String(parsed);
      }

      chapters.push({
        name: name,
        url: this.abs(href),
        scanlator: badge,
        dateUpload: dateUpload,
      });
    }

    return chapters.reverse();
  }

  async getDetail(url) {
    var doc = await this.fetchDoc(url);

    var main = doc.selectFirst("#watch-main");
    var animeId = main ? main.attr("data-id") : null;
    if (!animeId) {
      // /watch/<slug>-<id> — the trailing numeric segment is the anime id.
      var m = String(url).match(/-(\d+)(?:[/?#]|$)/);
      if (m) animeId = m[1];
    }
    if (!animeId) throw new Error("Could not determine anime id from " + url);

    var details = { link: this.abs(url) };

    var titleEl = doc.selectFirst("#w-info h1.title");
    if (titleEl) details.name = (titleEl.text || "").trim();

    var poster = doc.selectFirst("#w-info .binfo .poster img");
    if (poster) details.imageUrl = poster.attr("src") || "";
    if (!details.imageUrl) {
      var og = doc.selectFirst("meta[property='og:image']");
      if (og) details.imageUrl = og.attr("content") || "";
    }

    var desc = doc.selectFirst("#w-info .synopsis .text");
    details.description = desc ? (desc.text || "").trim() : "";

    var genre = [];
    var seen = {};
    var genreLinks = doc.select("#w-info .bmeta a[href^='/genre/']");
    for (var i = 0; i < genreLinks.length; i++) {
      var g = (genreLinks[i].text || "").trim();
      if (g && !seen[g.toLowerCase()]) {
        seen[g.toLowerCase()] = true;
        genre.push(g);
      }
    }
    details.genre = genre;

    // Status sits in an unlabelled <div>Status: <span><a>Finished</a></span></div>,
    // so match on the label text rather than a class.
    details.status = 5;
    var metaRows = doc.select("#w-info .bmeta .meta div");
    for (var r = 0; r < metaRows.length; r++) {
      var rowText = (metaRows[r].text || "").trim();
      if (/^Status\s*:/i.test(rowText)) {
        details.status = this.statusCode(rowText);
        break;
      }
    }

    details.chapters = await this.parseEpisodes(animeId);
    return details;
  }

  // ── Playback ──────────────────────────────────────────────────────────────

  resolveUrl(u, baseUrl) {
    if (!u) return "";
    if (u.indexOf("http") === 0) return u;
    var origin = baseUrl.match(/^(https?:\/\/[^\/]+)/);
    origin = origin ? origin[1] : "";
    if (u.charAt(0) === "/") return origin + u;
    return baseUrl.substring(0, baseUrl.lastIndexOf("/") + 1) + u;
  }

  // Expand an HLS master into one stream per variant. Flat playlists (a single
  // rendition, which is what echovideo usually serves) come back as-is.
  async expandHls(playlistUrl, headers, label) {
    var streams = [];
    var body = null;
    try {
      var res = await this.client.get(playlistUrl, headers);
      if (res && res.body) body = res.body;
    } catch (e) {}

    if (!body || body.indexOf("#EXT-X-STREAM-INF") < 0) {
      streams.push({
        url: playlistUrl,
        originalUrl: playlistUrl,
        quality: label,
        headers: headers,
      });
      return streams;
    }

    var lines = body.split("\n");
    var variants = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.indexOf("#EXT-X-STREAM-INF:") !== 0) continue;
      var resMatch = line.match(/RESOLUTION=\d+x(\d+)/);
      var bwMatch = line.match(/BANDWIDTH=(\d+)/);
      for (var j = i + 1; j < lines.length; j++) {
        var uri = lines[j].trim();
        if (!uri || uri.charAt(0) === "#") continue;
        variants.push({
          url: this.resolveUrl(uri, playlistUrl),
          quality: resMatch
            ? resMatch[1] + "p"
            : bwMatch
            ? Math.round(bwMatch[1] / 1000) + "kbps"
            : "Auto",
        });
        break;
      }
    }

    if (variants.length === 0) {
      streams.push({ url: playlistUrl, originalUrl: playlistUrl, quality: label, headers: headers });
      return streams;
    }

    variants.sort(function (a, b) {
      return (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0);
    });
    for (var v = 0; v < variants.length; v++) {
      streams.push({
        url: variants[v].url,
        originalUrl: playlistUrl,
        quality: variants[v].quality + " · " + label,
        headers: headers,
      });
    }
    return streams;
  }

  // Vidplay / echovideo: https://play.echovideo.ru/embed-1/<id>?...
  // The embed page's own JS is obfuscated, but the endpoint it ends up calling
  // is plain: /embed-1/getSources?id=<id> -> {"sources":"<m3u8 url>"}.
  async extractEchovideo(embedUrl, label) {
    var m = embedUrl.match(/^(https?:\/\/[^\/]+)\/embed-1\/([^?#]+)/);
    if (!m) return [];
    var origin = m[1];
    var id = m[2];

    var res = await this.client.get(origin + "/embed-1/getSources?id=" + id, {
      "User-Agent": this.ua,
      "X-Requested-With": "XMLHttpRequest",
      "Referer": embedUrl,
    });
    var json = JSON.parse(res.body);
    var sources = json ? json.sources : null;
    if (!sources) return [];
    if (typeof sources !== "string") {
      sources = sources.file || sources.url || (sources[0] && (sources[0].file || sources[0].url));
    }
    if (!sources) return [];

    // Segments are plain MPEG-TS served with an image/jpeg content type and no
    // referer check; the header is only needed for the playlists themselves.
    var headers = { "User-Agent": this.ua, "Referer": origin + "/", "Origin": origin };
    return await this.expandHls(sources, headers, label);
  }

  // DoodStream family (myvidplay.com -> playmogo.com and friends).
  // The embed page holds a /pass_md5/<path> URL that returns the video's base
  // URL; the playable URL is that base + 10 random chars + token/expiry query.
  async extractDood(embedUrl, label) {
    var origin = (embedUrl.match(/^(https?:\/\/[^\/]+)/) || [])[1];
    if (!origin) return [];

    var res = await this.client.get(embedUrl, { "User-Agent": this.ua, "Referer": this.source.baseUrl + "/" });
    var html = res.body || "";

    var pass = html.match(/\/pass_md5\/[^'"\s]+/);
    var token = html.match(/token=([a-zA-Z0-9]+)/);
    if (!pass || !token) return [];

    // The pass_md5 path is relative; requesting it on the original host works
    // even when that host 301s to the current DoodStream domain.
    var baseRes = await this.client.get(origin + pass[0], {
      "User-Agent": this.ua,
      "Referer": embedUrl,
    });
    var base = (baseRes.body || "").trim();
    if (base.indexOf("http") !== 0) return [];

    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    var suffix = "";
    for (var i = 0; i < 10; i++) {
      suffix += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    var videoUrl = base + suffix + "?token=" + token[1] + "&expiry=" + Date.now();

    return [
      {
        url: videoUrl,
        originalUrl: videoUrl,
        quality: label,
        headers: { "User-Agent": this.ua, "Referer": origin + "/" },
      },
    ];
  }

  async extractEmbed(embedUrl, label) {
    try {
      if (/echovideo|\/embed-1\//.test(embedUrl)) {
        return await this.extractEchovideo(embedUrl, label);
      }
      if (/myvidplay|playmogo|dood|d0o0d|ds2play|vide0/.test(embedUrl)) {
        return await this.extractDood(embedUrl, label);
      }
    } catch (e) {}
    return [];
  }

  // /watch/<animeId>/ep-<slug> -> {id, eps} for the server-list query.
  parseEpisodeRef(url) {
    var m = String(url).match(/\/watch\/(\d+)\/ep-([^/?#]+)/);
    if (m) return { id: m[1], eps: m[2] };
    // Older stored URLs may already be the ajax form.
    m = String(url).match(/servers=(\d+)&eps=([^&]+)/);
    if (m) return { id: m[1], eps: m[2] };
    return null;
  }

  audioLabel(type) {
    return { sub: "Sub", dub: "Dub", ssub: "Soft Sub" }[type] || type.toUpperCase();
  }

  async getVideoList(url) {
    var ref = this.parseEpisodeRef(url);
    if (!ref) throw new Error("Unrecognised episode URL: " + url);

    var html = await this.fetchAjax(
      "/ajax/server/list?servers=" + ref.id + "&eps=" + ref.eps
    );
    var doc = new Document(html);

    var audioPref = this.getPreference("aniwave_pref_audio") || "sub";
    var types = doc.select(".servers .type");

    // Collect every (audio type, server) pair, ordered so the preferred audio
    // comes first — Mangayomi auto-plays the first entry.
    var jobs = [];
    for (var t = 0; t < types.length; t++) {
      var type = types[t].attr("data-type") || "";
      var lis = types[t].select("li[data-link-id]");
      for (var i = 0; i < lis.length; i++) {
        jobs.push({
          type: type,
          linkId: lis[i].attr("data-link-id"),
          server: (lis[i].text || "").trim(),
        });
      }
    }
    jobs.sort(function (a, b) {
      var rank = function (x) { return x.type === audioPref ? 0 : x.type === "sub" ? 1 : 2; };
      return rank(a) - rank(b);
    });

    var self = this;
    var results = await Promise.all(
      jobs.map(async function (job) {
        try {
          var srcRes = await self.client.get(
            self.source.baseUrl + "/ajax/sources?id=" + encodeURIComponent(job.linkId),
            self.ajaxHeaders
          );
          var srcJson = JSON.parse(srcRes.body);
          var embedUrl = srcJson && srcJson.result ? srcJson.result.url : null;
          if (!embedUrl) return [];
          var label = job.server + " [" + self.audioLabel(job.type) + "]";
          return await self.extractEmbed(embedUrl, label);
        } catch (e) {
          return [];
        }
      })
    );

    var streams = [];
    for (var r = 0; r < results.length; r++) {
      streams = streams.concat(results[r]);
    }
    if (streams.length === 0) throw new Error("No playable stream found for this episode");
    return streams;
  }

  // ── Filters & preferences ─────────────────────────────────────────────────

  // Single ordered source of truth for the filter UI and for turning the
  // user's selections back into /filter query params. Index == filter position.
  filterDefs() {
    var genres = [
      ["Action", "1"], ["Adult Cast", "15"], ["Adventure", "10"], ["Anthropomorphic", "9"],
      ["Avant Garde", "396"], ["Award Winning", "2035"], ["CGDCT", "20"], ["Childcare", "863"],
      ["Combat Sports", "1143"], ["Comedy", "4"], ["Delinquents", "307"], ["Detective", "593"],
      ["Drama", "30"], ["Ecchi", "77"], ["Educational", "1571"], ["Erotica", "4721"],
      ["Fantasy", "5"], ["Gag Humor", "444"], ["Gore", "190"], ["Gourmet", "90"],
      ["Harem", "78"], ["High Stakes Game", "395"], ["Historical", "180"], ["Horror", "188"],
      ["Idols (Female)", "316"], ["Idols (Male)", "972"], ["Isekai", "12"], ["Iyashikei", "133"],
      ["Josei", "298"], ["Kids", "93"], ["Love Polygon", "1982"], ["Mahou Shoujo", "241"],
      ["Martial Arts", "209"], ["Mecha", "45"], ["Medical", "289"], ["Military", "55"],
      ["Music", "317"], ["Mystery", "272"], ["Mythology", "24"], ["Organized Crime", "391"],
      ["Otaku Culture", "1567"], ["Parody", "748"], ["Performing Arts", "1011"], ["Pets", "296"],
      ["Psychological", "139"], ["Racing", "1162"], ["Reincarnation", "13"], ["Reverse Harem", "1124"],
      ["Romance", "23"], ["Romantic Subtext", "157"], ["Samurai", "181"], ["School", "106"],
      ["Sci-Fi", "44"], ["Seinen", "17"], ["Shoujo", "25"], ["Shounen", "7"],
      ["Showbiz", "3022"], ["Slice of Life", "8"], ["Space", "869"], ["Sports", "96"],
      ["Strategy Game", "2"], ["Super Power", "6"], ["Supernatural", "19"], ["Survival", "677"],
      ["Suspense", "138"], ["Team Sports", "463"], ["Time Travel", "470"], ["Urban Fantasy", "586648"],
      ["Vampire", "934"], ["Video Game", "94"], ["Villainess", "359345"], ["Visual Arts", "780"],
      ["Workplace", "16"],
    ];

    var years = [];
    var currentYear = new Date().getFullYear();
    for (var y = currentYear; y >= 2004; y--) years.push([String(y), String(y)]);
    ["2000s", "1990s", "1980s", "1970s", "1960s", "1950s", "1940s", "1930s", "1920s"].forEach(
      function (d) { years.push([d, d]); }
    );

    return [
      { kind: "group", param: "genre[]", name: "Genres", options: genres },
      { kind: "group", param: "type[]", name: "Type", options: [
        ["Movie", "movie"], ["TV", "tv"], ["OVA", "ova"], ["ONA", "ona"],
        ["Special", "special"], ["TV Special", "tv-special"], ["CM", "cm"], ["Music", "music"],
      ] },
      { kind: "group", param: "status[]", name: "Status", options: [
        ["Currently Airing", "0"], ["Finished Airing", "1"],
      ] },
      { kind: "group", param: "season[]", name: "Season", options: [
        ["Spring", "spring"], ["Summer", "summer"], ["Fall", "fall"],
        ["Winter", "winter"], ["Unknown", "null"],
      ] },
      { kind: "group", param: "year[]", name: "Year", options: years },
      { kind: "group", param: "country[]", name: "Country", options: [
        ["China", "cn"], ["Japan", "jp"], ["Korea", "kr"],
      ] },
      { kind: "group", param: "rating[]", name: "Rating", options: [
        ["G - All Ages", "g"], ["PG - Children", "pg"],
        ["PG-13 - Teens 13 or older", "pg13"],
        ["R - 17+ (violence & profanity)", "r17"], ["R+ - Mild Nudity", "r"],
      ] },
      { kind: "select", param: "lang", name: "Language", options: [
        ["Sub", "sub"], ["Dub", "dub"], ["Sub & Dub", "subdub"],
      ] },
      { kind: "select", param: "sort_by", name: "Sort by", options: [
        ["Recently updated", "last_updated"], ["Recently added", "created_at"],
        ["Most relevant", "most_relevant"], ["Most watched", "members"],
        ["Most favourited", "favorites"], ["Most viewed", "m_view"],
        ["Release date", "year"], ["Name A-Z", "title"], ["Scores", "scored_by"],
        ["Popularity", "popularity"], ["Rank", "rank"], ["MAL scores", "score"],
        ["Reviews", "reviews"], ["Rating", "rating"],
        ["# of episodes", "episodes"], ["# of episodes released", "ep_released"],
      ] },
    ];
  }

  getFilterList() {
    return this.filterDefs().map(function (def) {
      if (def.kind === "group") {
        return {
          type_name: "GroupFilter",
          name: def.name,
          state: def.options.map(function (o) {
            return { type_name: "CheckBox", name: o[0], value: o[1] };
          }),
        };
      }
      return {
        type_name: "SelectFilter",
        name: def.name,
        state: 0,
        values: [{ type_name: "SelectOption", name: "Any", value: "" }].concat(
          def.options.map(function (o) {
            return { type_name: "SelectOption", name: o[0], value: o[1] };
          })
        ),
      };
    });
  }

  getSourcePreferences() {
    return [
      {
        key: "aniwave_pref_audio",
        listPreference: {
          title: "Preferred audio",
          summary: "Which audio track is listed first for streaming and downloads",
          valueIndex: 0,
          entries: ["Sub", "Dub"],
          entryValues: ["sub", "dub"],
        },
      },
      {
        key: "aniwave_pref_popular_sort",
        listPreference: {
          title: "Popular tab sorting",
          summary: "How the Popular tab orders results",
          valueIndex: 0,
          entries: ["Most viewed", "Most watched", "Most favourited", "Popularity", "Scores"],
          entryValues: ["m_view", "members", "favorites", "popularity", "scored_by"],
        },
      },
    ];
  }
}
