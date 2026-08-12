const mangayomiSources = [
  {
    "name": "AniNeko",
    "id": 782451093,
    "lang": "en",
    "baseUrl": "https://anineko.to",
    "iconUrl": "https://anineko.to/icon/android-chrome-192x192.png",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.1.1",
    "pkgPath": "anime/src/en/anineko.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": false,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/anineko.js",
    "dateFormat": "",
    "dateFormatLocale": "",
    "additionalParams": "",
    "sourceCodeLanguage": 1,
    "notes": "",
  },
];

// AniNeko is a plain server-rendered PHP site — every list, the episode list
// and the full server table are already in the HTML, so there is no JSON API
// and no token/vrf handshake to reproduce. Pages are parsed with regex.
//
// Episode pages expose each server as
//   <button class="... server-video ..." data-video="EMBED" data-tab="tab_N">
// where tab_N maps to a language via
//   <button class="nv-server-tab tab tab_N" data-id="hsub|sub|dub">
//
// Of the five embed hosts only HD-2 (bibiemb) is used. It is a VibePlayer
// instance that prints the playlist as a bare `const src = "...master.m3u8"`,
// and its segments are ordinary .ts MPEG-TS served from its own CDN.
//
// The others are deliberately not used:
//   • HD-1 (vivibebe)  — same easy `const src`, but the segments it serves are
//     MPEG-TS hidden behind a ~252-byte PNG header, hosted on an ad CDN
//     (p16-ad-sg.ibyteimg.com), at extension-less URLs, and it 403s on a
//     portion of them. libmpv refuses those, which shows up in-app as the
//     player skipping straight through every episode.
//   • StreamHG / Earnvids — playlist is behind packed (p,a,c,k,e,d) JS.
//   • Doodstream — needs a token handshake.
// HD-2 is present on all three language tabs, so sub, hardsub and dub all work.

// tab_N id -> [preference value, display label]
var LANG_LABELS = {
  hsub: "Hardsub",
  sub: "Sub",
  dub: "Dub",
};

var GENRES = [
  "action", "adventure", "cars", "comedy", "dementia", "demons", "drama",
  "ecchi", "fantasy", "game", "harem", "historical", "horror", "isekai",
  "josei", "kids", "magic", "mahou-shoujo", "martial-arts", "mecha",
  "military", "music", "mystery", "parody", "police", "psychological",
  "romance", "samurai", "school", "sci-fi", "seinen", "shoujo", "shoujo-ai",
  "shounen", "shounen-ai", "slice-of-life", "space", "sports", "super-power",
  "supernatural", "thriller", "vampire",
];

var TYPES = [
  ["TV", "1"], ["Movie", "2"], ["OVA", "3"], ["ONA", "4"],
  ["Special", "5"], ["Music", "6"], ["TV Short", "7"],
];

var SORTS = [
  ["Latest Update", "recently_updated"],
  ["Release Date", "release_date"],
  ["Recently Added", "recently_added"],
  ["A-Z", "title_az"],
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
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": this.source.baseUrl + "/",
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
    return this.source.baseUrl + "/" + String(path).replace(/^\/+/, "");
  }

  async fetchHtml(path) {
    var res = await this.client.get(this.abs(path), this.headers);
    return (res && res.body) || "";
  }

  decode(s) {
    return (s || "")
      .replace(/&#0*39;|&apos;|&rsquo;/g, "'")
      .replace(/&#0*34;|&quot;|&ldquo;|&rdquo;/g, '"')
      .replace(/&middot;/g, "·")
      .replace(/&nbsp;/g, " ")
      .replace(/&#0*60;|&lt;/g, "<")
      .replace(/&#0*62;|&gt;/g, ">")
      .replace(/&#(\d+);/g, function (_m, n) { return String.fromCharCode(parseInt(n, 10)); })
      .replace(/&#x([0-9a-fA-F]+);/g, function (_m, n) { return String.fromCharCode(parseInt(n, 16)); })
      .replace(/&#0*38;|&amp;/g, "&")
      .trim();
  }

  stripTags(s) {
    return this.decode(String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
  }

  // ── List pages ──────────────────────────────────────────────────────────────

  // Cards look like:
  //   <article class="nv-anime-card ...">
  //     <a class="nv-anime-thumb ..." href="/watch/slug">
  //       <img src="COVER" alt="Title" ...>
  //     ...
  //     <h3 class="nv-anime-title"><a href="/watch/slug">Title</a></h3>
  parseList(html) {
    var list = [];
    var seen = {};

    // Prefer the <h3> title (exact) and fall back to the img alt attribute.
    var titles = {};
    var tRx = /<h3[^>]*class="[^"]*nv-anime-title[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    var tm;
    while ((tm = tRx.exec(html)) !== null) {
      var thref = tm[1].replace(/^https?:\/\/[^/]+/, "");
      if (!titles[thref]) titles[thref] = this.stripTags(tm[2]);
    }

    var rx = /<a[^>]*class="[^"]*nv-anime-thumb[^"]*"[^>]*href="([^"]+)"[^>]*>\s*<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"/g;
    var m;
    while ((m = rx.exec(html)) !== null) {
      var href = m[1].replace(/^https?:\/\/[^/]+/, "");
      if (!href || seen[href]) continue;
      seen[href] = true;
      var name = titles[href] || this.decode(m[3]);
      if (!name) continue;
      list.push({ name: name, link: this.abs(href), imageUrl: m[2] });
    }
    return list;
  }

  // The pager renders a "next" link only while more pages exist.
  hasNext(html, page) {
    if (/class='page-item next'/.test(html) || /class="page-item next"/.test(html)) return true;
    var max = 0;
    var rx = /data-page='(\d+)'|data-page="(\d+)"/g;
    var m;
    while ((m = rx.exec(html)) !== null) {
      var n = parseInt(m[1] || m[2], 10);
      if (n > max) max = n;
    }
    return max > (page || 1);
  }

  async listPage(path, page) {
    var sep = path.indexOf("?") >= 0 ? "&" : "?";
    var html = await this.fetchHtml(path + sep + "page=" + (page || 1));
    return { list: this.parseList(html), hasNextPage: this.hasNext(html, page) };
  }

  get supportsLatest() {
    return true;
  }

  async getPopular(page) {
    return await this.listPage("/ongoing", page);
  }

  async getLatestUpdates(page) {
    return await this.listPage("/updates", page);
  }

  async search(query, page, filters) {
    var parts = [];
    if (query) parts.push("keyword=" + encodeURIComponent(query));

    // Filters arrive positionally, in the same order as getFilterList().
    try {
      var defs = this.filterDefs();
      for (var i = 0; i < defs.length; i++) {
        var f = (filters || [])[i];
        if (!f) continue;
        var def = defs[i];
        if (def.kind === "group") {
          var st = f.state || [];
          for (var j = 0; j < st.length; j++) {
            if (st[j] && st[j].state === true && st[j].value) {
              parts.push(encodeURIComponent(def.param) + "=" + encodeURIComponent(st[j].value));
            }
          }
        } else {
          var opt = (f.values || [])[f.state || 0];
          if (opt && opt.value) {
            parts.push(encodeURIComponent(def.param) + "=" + encodeURIComponent(opt.value));
          }
        }
      }
    } catch (e) { /* fall back to a plain keyword search */ }

    return await this.listPage("/browse?" + parts.join("&"), page);
  }

  // ── Detail ──────────────────────────────────────────────────────────────────

  statusCode(s) {
    var t = (s || "").toLowerCase();
    if (t.indexOf("airing") >= 0 && t.indexOf("finished") < 0) return 0; // Currently Airing
    if (t.indexOf("ongoing") >= 0) return 0;
    if (t.indexOf("completed") >= 0 || t.indexOf("finished") >= 0) return 1;
    if (t.indexOf("not yet") >= 0 || t.indexOf("upcoming") >= 0) return 4;
    return 5;
  }

  async getDetail(url) {
    var html = await this.fetchHtml(url);

    var name = "";
    var nm = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    if (nm) name = this.stripTags(nm[1]);

    var imageUrl = "";
    var im = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/) ||
             html.match(/(https:\/\/cdn\.anizara\.store\/cover\/[^"']+)/);
    if (im) imageUrl = im[1];
    // og:image is the generic site preview on some pages — prefer a real cover.
    var cover = html.match(/(https:\/\/cdn\.anizara\.store\/cover\/[^"']+)/);
    if (cover) imageUrl = cover[1];

    var description = "";
    var dm = html.match(/<div[^>]*class="[^"]*nv-info-synopsis[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (dm) description = this.stripTags(dm[1]);
    if (!description) {
      var meta = html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/);
      if (meta) description = this.decode(meta[1]);
    }

    var genre = [];
    var gm = html.match(/<div[^>]*class="[^"]*nv-info-genres[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (gm) {
      var grx = /<(?:span|a)[^>]*>([^<]+)<\/(?:span|a)>/g;
      var g;
      while ((g = grx.exec(gm[1])) !== null) {
        var gv = this.decode(g[1]);
        if (gv) genre.push(gv);
      }
    }

    // Sidebar rows: <div><span>Status</span><strong>Currently Airing</strong></div>
    var info = {};
    var irx = /<div><span>([^<]+)<\/span><strong>([\s\S]*?)<\/strong><\/div>/g;
    var r;
    while ((r = irx.exec(html)) !== null) {
      info[this.decode(r[1]).toLowerCase()] = this.stripTags(r[2]);
    }
    var status = this.statusCode(info["status"]);

    // Episodes: <a class="nv-info-episode-main" href="/watch/slug/ep-9">
    //             <strong>Episode 9</strong><span>Real Title</span></a>
    var chapters = [];
    var seen = {};
    var erx = /<a[^>]*class="[^"]*nv-info-episode-main[^"]*"[^>]*href="([^"]+)"[^>]*>\s*<strong>([\s\S]*?)<\/strong>\s*(?:<span>([\s\S]*?)<\/span>)?/g;
    var e;
    while ((e = erx.exec(html)) !== null) {
      var href = e[1].replace(/^https?:\/\/[^/]+/, "");
      if (!href || seen[href]) continue;
      seen[href] = true;
      var label = this.stripTags(e[2]);          // "Episode 12"
      var epTitle = this.stripTags(e[3] || "");  // "12 Real Title" | "Episode 12"
      // The title span often repeats the episode number ("12 Real Title");
      // drop that prefix so the label doesn't read "Episode 12: 12 Real Title".
      var numMatch = label.match(/([0-9.]+)\s*$/);
      if (numMatch && epTitle) {
        epTitle = epTitle
          .replace(new RegExp("^" + numMatch[1].replace(".", "\\.") + "\\s*[-–:.]?\\s+"), "")
          .trim();
      }
      if (epTitle && epTitle !== label) label = label + ": " + epTitle;
      chapters.push({ name: label || href, url: this.abs(href) });
    }

    // Fall back to plain /ep-N links if the episode panel markup ever changes.
    if (chapters.length === 0) {
      var frx = /href="([^"]*\/watch\/[^"]*\/ep-([0-9.]+))"/g;
      var f2;
      var fseen = {};
      while ((f2 = frx.exec(html)) !== null) {
        var fh = f2[1].replace(/^https?:\/\/[^/]+/, "");
        if (fseen[fh]) continue;
        fseen[fh] = true;
        chapters.push({ name: "Episode " + f2[2], url: this.abs(fh) });
      }
    }

    chapters.reverse();
    return {
      name: name,
      imageUrl: imageUrl,
      description: description,
      genre: genre,
      status: status,
      link: this.abs(url),
      chapters: chapters,
    };
  }

  // ── Streaming ───────────────────────────────────────────────────────────────

  // tab_N -> hsub | sub | dub
  parseTabs(html) {
    var map = {};
    var rx = /<button[^>]*class="[^"]*nv-server-tab[^"]*\btab_(\d+)\b[^"]*"[^>]*data-id="([^"]+)"/g;
    var m;
    while ((m = rx.exec(html)) !== null) map["tab_" + m[1]] = m[2];
    return map;
  }

  parseServers(html) {
    var tabs = this.parseTabs(html);
    var out = [];
    var rx = /<button[^>]*class="[^"]*server-video[^"]*"[^>]*data-video="([^"]+)"[^>]*data-tab="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g;
    var m;
    while ((m = rx.exec(html)) !== null) {
      var label = this.stripTags(m[3]).split(/\s{2,}/)[0].trim();
      out.push({
        embed: this.decode(m[1]),
        lang: tabs[m[2]] || m[2],
        name: label || "Server",
      });
    }
    return out;
  }

  // Subtitle track is passed to the embed as a query param, named differently
  // per host: ?sub= (VibePlayer), ?caption_1= (StreamHG/Earnvids), ?c1_file=.
  subsFromEmbed(embed) {
    var m = embed.match(/[?&](?:sub|caption_1|c1_file)=([^&]+)/);
    if (!m) return [];
    var file = decodeURIComponent(m[1]);
    if (!/^https?:\/\//.test(file)) return [];
    var lm = embed.match(/[?&](?:sub_1|c1_label)=([^&]+)/);
    var label = lm ? decodeURIComponent(lm[1]) : "English";
    return [{ file: file, label: label }];
  }

  resolveUrl(base, rel) {
    if (/^https?:\/\//.test(rel)) return rel;
    var origin = (base.match(/^(https?:\/\/[^/]+)/) || [])[1] || "";
    if (rel.charAt(0) === "/") return origin + rel;
    var i = base.split("?")[0].lastIndexOf("/");
    return (i > 0 ? base.split("?")[0].substring(0, i + 1) : base) + rel;
  }

  // Expand a master playlist into its per-quality media playlists.
  //
  // Returning the master directly plays fine, but the app counts #EXTINF
  // entries to drive the download progress bar and a master has none — so
  // downloads run with progress stuck at 0 until they suddenly finish.
  // Handing back the media playlists fixes progress and gives a real quality
  // picker at the same time.
  async resolveVariants(masterUrl, headers) {
    var res = await this.client.get(masterUrl, headers);
    var body = (res && res.body) || "";
    if (body.indexOf("#EXTM3U") < 0) return [];
    // Already a media playlist — hand it back as-is.
    if (body.indexOf("#EXT-X-STREAM-INF") < 0) {
      return [{ url: masterUrl, label: "Auto", height: 0 }];
    }

    var lines = body.split("\n");
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.indexOf("#EXT-X-STREAM-INF:") !== 0) continue;
      var target = "";
      for (var j = i + 1; j < lines.length; j++) {
        var l2 = lines[j].trim();
        if (!l2 || l2.charAt(0) === "#") continue;
        target = l2;
        break;
      }
      if (!target) continue;
      var rm = line.match(/RESOLUTION=\d+x(\d+)/);
      var nm = line.match(/NAME="([^"]+)"/);
      var height = rm ? parseInt(rm[1], 10) : 0;
      out.push({
        url: this.resolveUrl(masterUrl, target),
        label: (nm && nm[1]) || (height ? height + "p" : "Auto"),
        height: height,
      });
    }
    out.sort(function (a, b) { return b.height - a.height; });
    return out;
  }

  // Both supported hosts are VibePlayer: the playlist sits in the page as a
  // bare `const src = "..."`, no packing and no second request.
  async resolveEmbed(embed) {
    var origin = "";
    var om = embed.match(/^(https?:\/\/[^/]+)/);
    if (om) origin = om[1];

    var res = await this.client.get(embed, {
      "User-Agent": this.ua,
      "Referer": this.source.baseUrl + "/",
      "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    });
    var body = (res && res.body) || "";

    var m = body.match(/const\s+src\s*=\s*["']([^"']+)["']/);
    if (!m) m = body.match(/(https?:\\?\/\\?\/[^"'\s]+\.m3u8[^"'\s]*)/);
    if (!m) return null;

    var file = m[1].replace(/\\\//g, "/");
    if (!/^https?:\/\//.test(file)) return null;
    return { file: file, origin: origin };
  }

  async getVideoList(url) {
    var html = await this.fetchHtml(url);
    var servers = this.parseServers(html);
    if (servers.length === 0) return [];

    var prefLang = this.getPreference("anineko_pref_lang") || "sub";
    var self = this;

    // HD-2 only — see the note at the top of this file for why the other four
    // servers are skipped.
    var supported = servers.filter(function (s) {
      return /^https?:\/\/(?:[a-z0-9-]+\.)?bibiemb\.xyz\//i.test(s.embed);
    });
    if (supported.length === 0) return [];

    var results = await Promise.all(supported.map(function (s) {
      return self.resolveEmbed(s.embed)
        .then(async function (r) {
          if (!r) return [];
          var langLabel = LANG_LABELS[s.lang] || s.lang.toUpperCase();
          var hdrs = {
            "Referer": r.origin + "/",
            "Origin": r.origin,
            "User-Agent": self.ua,
          };
          var subs = self.subsFromEmbed(s.embed);

          var variants = [];
          try {
            variants = await self.resolveVariants(r.file, hdrs);
          } catch (e) { /* fall back to the master below */ }
          if (!variants.length) {
            variants = [{ url: r.file, label: "Auto", height: 0 }];
          }

          return variants.map(function (v) {
            return {
              url: v.url,
              originalUrl: r.file,
              quality: s.name + " " + v.label + " [" + langLabel + "]",
              headers: hdrs,
              subtitles: subs,
              _lang: s.lang,
              _height: v.height,
            };
          });
        })
        .catch(function () { return []; });
    }));

    var videos = results.reduce(function (acc, r) { return acc.concat(r); }, []);

    // Put the preferred audio/subtitle flavour first — Mangayomi plays the
    // first entry and only auto-enables subtitles from that same entry.
    var rank = function (lang) {
      if (lang === prefLang) return 0;
      if (prefLang === "dub") return lang === "sub" ? 1 : 2;
      if (prefLang === "hsub") return lang === "sub" ? 1 : 2;
      return lang === "hsub" ? 1 : 2;
    };
    videos.sort(function (a, b) {
      var d = rank(a._lang) - rank(b._lang);
      return d !== 0 ? d : (b._height - a._height);
    });
    videos.forEach(function (v) { delete v._lang; delete v._height; });

    return videos;
  }

  // ── Filters & preferences ───────────────────────────────────────────────────

  filterDefs() {
    var cap = function (s) {
      return s.split("-").map(function (w) {
        return w.charAt(0).toUpperCase() + w.slice(1);
      }).join(" ");
    };
    return [
      {
        kind: "group", param: "genre[]", name: "Genre",
        options: GENRES.map(function (g) { return [cap(g), g]; }),
      },
      { kind: "group", param: "type[]", name: "Type", options: TYPES },
      {
        kind: "select", param: "status", name: "Status",
        options: [["Ongoing", "Ongoing"], ["Completed", "Completed"]],
      },
      {
        kind: "select", param: "language", name: "Language",
        options: [["Sub", "sub"], ["Dub", "dub"]],
      },
      {
        kind: "select", param: "year", name: "Year",
        options: (function () {
          var out = [];
          for (var y = 2026; y >= 2009; y--) out.push([String(y), String(y)]);
          return out;
        })(),
      },
      { kind: "select", param: "sort", name: "Sort by", options: SORTS },
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
        key: "anineko_pref_lang",
        listPreference: {
          title: "Preferred version",
          summary: "Which version is listed first (and supplies auto-play subtitles)",
          valueIndex: 0,
          entries: ["Sub (soft subtitles)", "Hardsub (burned in)", "Dub"],
          entryValues: ["sub", "hsub", "dub"],
        },
      },
    ];
  }
}
