const mangayomiSources = [
  {
    "name": "AnimeHeaven",
    "id": -1744325818,
    "lang": "en",
    "baseUrl": "https://animeheaven.me",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://animeheaven.me",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.0.14",
    "pkgPath": "anime/src/en/animeheaven.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": false,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/animeheaven.js",
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
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      // Without these an intermediary can hand back a copy of anime.php from
      // before the newest episode was published, so the app shows one episode
      // fewer than the site does.
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
    };
  }

  async fetchHtml(path) {
    var url = path.startsWith("http") ? path : this.source.baseUrl + "/" + path.replace(/^\/+/, "");
    var res = await this.client.get(url, this.headers);
    return res.body || "";
  }

  // Parse a list page (popular.php / new.php / search.php).
  // Site structure per item:
  //   <a href="anime.php?CODE"><img src="image.php?CODE"></a>
  //   <a href="anime.php?CODE">Title Text</a>
  // Attributes use double quotes; no class on img tags.
  parseList(html) {
    var list = [];
    var seen = {};

    // First pass: build href → imgSrc map from image-anchor elements.
    var imgMap = {};
    var imgRx = /<a[^>]+href=["'](anime\.php\?[\w]+)["'][^>]*>\s*<img[^>]+src=["']([^"']+)["']/g;
    var im;
    while ((im = imgRx.exec(html)) !== null) {
      if (!imgMap[im[1]]) imgMap[im[1]] = im[2];
    }

    // Second pass: find plain-text title anchors and assemble list items.
    var titleRx = /<a[^>]+href=["'](anime\.php\?[\w]+)["'][^>]*>([^<]{2,120})<\/a>/g;
    var tm;
    while ((tm = titleRx.exec(html)) !== null) {
      var href = tm[1];
      var name = tm[2].trim();
      if (!name || seen[href]) continue;
      seen[href] = true;
      var imgSrc = imgMap[href] || "";
      var imageUrl = imgSrc ? (imgSrc.indexOf("http") === 0 ? imgSrc : this.source.baseUrl + "/" + imgSrc) : "";
      list.push({
        name: this._decodeHtml(name),
        link: this.source.baseUrl + "/" + href,
        imageUrl: imageUrl,
      });
    }
    return list;
  }

  _decodeHtml(s) {
    return (s || "")
      .replace(/&#0*39;|&apos;/g, "'")
      .replace(/&#0*34;|&quot;/g, '"')
      .replace(/&#0*38;|&amp;/g, "&")
      .replace(/&#0*60;|&lt;/g, "<")
      .replace(/&#0*62;|&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/&#(\d+);/g, function(_m, n) { return String.fromCharCode(parseInt(n, 10)); })
      .replace(/&#x([0-9a-fA-F]+);/g, function(_m, n) { return String.fromCharCode(parseInt(n, 16)); });
  }

  get supportsLatest() {
    return true;
  }

  async getPopular(page) {
    // The site returns all items on one HTML page. We slice client-side so
    // Mangayomi only receives 30 items at a time and can load more on scroll.
    var html = await this.fetchHtml("popular.php");
    var all = this.parseList(html);
    var pageSize = 30;
    var start = (page - 1) * pageSize;
    var slice = all.slice(start, start + pageSize);
    return { list: slice, hasNextPage: (start + pageSize) < all.length };
  }

  async getLatestUpdates(page) {
    var html = await this.fetchHtml("new.php");
    var all = this.parseList(html);
    var pageSize = 30;
    var start = (page - 1) * pageSize;
    var slice = all.slice(start, start + pageSize);
    return { list: slice, hasNextPage: (start + pageSize) < all.length };
  }

  async search(query, page, filters) {
    if (page > 1) return { list: [], hasNextPage: false };
    try {
      var html = await this.fetchHtml("search.php?s=" + encodeURIComponent(query));
      return { list: this.parseList(html), hasNextPage: false };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  // Status mapping. AnimeHeaven uses "Currently Airing" / "Finished Airing".
  statusCode(status) {
    var s = (status || "").toLowerCase();
    if (s.includes("finished") || s.includes("completed")) return 1;
    if (s.includes("not yet") || s.includes("upcoming")) return 4;
    if (s.includes("airing") || s.includes("ongoing") || s.includes("releasing")) return 0;
    return 5;
  }

  async getDetail(url) {
    var html = await this.fetchHtml(url);

    // Title
    var name = "";
    var nameMatch = html.match(/<div class=["']infotitle c["']>([^<]+)<\/div>/);
    if (nameMatch) name = this._decodeHtml(nameMatch[1].trim());

    // Cover image — detail page uses class='posterimg' for the main poster.
    // Do NOT match 'coverimg'; those are related-anime thumbnails lower on the page.
    // Fall back to og:image which always points to the correct art.
    var imageUrl = "";
    var posterMatch = html.match(/<img[^>]+class=["'][^"']*posterimg[^"']*["'][^>]+src=["']([^"']+)["']/);
    if (posterMatch) {
      var rel = posterMatch[1];
      imageUrl = rel.indexOf("http") === 0 ? rel : this.source.baseUrl + "/" + rel.replace(/^\/+/, "");
    }
    if (!imageUrl) {
      var og = html.match(/<meta property=["']og:image["'] content=["']([^"']+)["']/);
      if (og) imageUrl = og[1];
    }

    // Description
    var description = "";
    var descMatch = html.match(/<div class=["']infodes c["']>([\s\S]*?)<\/div>/);
    if (descMatch) {
      description = this._decodeHtml(descMatch[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
    }

    // Genres — every <a class='boxitem ...'> in the tags section is a genre tag.
    var genre = [];
    var genreSection = html.match(/<div class=["']infotags[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<div class=["']infoyear/);
    if (genreSection) {
      var gRx = /<a[^>]+href=["']tags\.php\?[^"']+["'][^>]*>([^<]+)<\/a>/g;
      var gm;
      while ((gm = gRx.exec(genreSection[1])) !== null) {
        genre.push(this._decodeHtml(gm[1].trim()));
      }
    }
    // Fallback: just look for any tags.php links
    if (genre.length === 0) {
      var gRx2 = /<a[^>]+href=["']tags\.php\?tag=([^"']+)["']/g;
      var seen = {};
      var gm2;
      while ((gm2 = gRx2.exec(html)) !== null) {
        var t = decodeURIComponent(gm2[1]);
        if (!seen[t]) { seen[t] = true; genre.push(t); }
      }
    }

    // Status — site shows "Status:" inline followed by an inline div.
    // "Episodes:" 11 etc. are in inline divs after labels. Use "Status" label if present.
    var status = 5;
    var statusBlock = html.match(/Status[\s\S]{0,40}?<div[^>]+class=["']inline c2["']>([^<]+)</);
    if (statusBlock) status = this.statusCode(statusBlock[1]);
    else {
      // If no status label, infer: if "Episodes" count appears followed by total, treat as completed; else default unknown
      // Site mostly shows finished anime; default to 5 (UNKNOWN) when not stated.
    }

    // Episodes — every anchor that calls gatea('<key>') is one episode. The key
    // is what getVideoList() sends back to gate.php as the `key` cookie.
    //
    // Match on the gatea() call itself rather than on a whole <a ...>...</a>
    // shape. The page mixes quote styles, sometimes escapes the quotes inside
    // the onclick attribute, and the key alphabet is not guaranteed to stay
    // lowercase hex — any anchor a stricter pattern misses is an episode that
    // silently disappears from the list while still being visible on the site.
    // Read the episode number out of the markup that follows the call.
    var order = [];
    var byHash = {};
    var gateRx = /gatea\s*\(\s*(?:\\?["']|&quot;|&#0*39;|&#0*34;)([^"'\\()\s<>]{2,128})/g;
    var em;
    while ((em = gateRx.exec(html)) !== null) {
      var hash = em[1];

      // The number sits in the anchor body right after the onclick attribute,
      // e.g. <div class='watch2 c'>12</div>. Stop the window at the next
      // gatea() call so we can never read the following episode's number.
      var after = html.slice(gateRx.lastIndex, gateRx.lastIndex + 500);
      var nextGate = after.search(/gatea\s*\(/);
      if (nextGate !== -1) after = after.slice(0, nextGate);
      var numMatch = after.match(/watch2[^>]*>\s*(\d+(?:\.\d+)?)/);
      if (!numMatch) numMatch = after.match(/>\s*(\d+(?:\.\d+)?)\s*</);
      var num = numMatch ? numMatch[1] : "";

      if (byHash[hash]) {
        // Same episode linked twice (a "latest episode" shortcut above the
        // grid, for instance). Keep the first position, but take the number
        // from this copy if the first one carried none.
        if (!byHash[hash].num && num) byHash[hash].num = num;
        continue;
      }
      byHash[hash] = { hash: hash, num: num };
      order.push(byHash[hash]);
    }

    // The site lists newest first (Mangayomi convention: most recent at top),
    // so no reverse is needed. When every entry carries a number, sort by it so
    // a stray duplicate link can't shuffle the list; entries whose number we
    // could not read fall back to their position.
    var allNumbered = order.length > 0;
    for (var oi = 0; oi < order.length; oi++) {
      if (order[oi].num === "") { allNumbered = false; break; }
    }
    if (allNumbered) {
      order.sort(function (a, b) { return parseFloat(b.num) - parseFloat(a.num); });
    }

    var chapters = [];
    for (var ci = 0; ci < order.length; ci++) {
      chapters.push({
        name: "Episode " + (order[ci].num || String(order.length - ci)),
        url: order[ci].hash, // chapter URL is just the gate cookie key
      });
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

  // Fetch the gate.php page for an episode and pull every video URL out of it.
  async getVideoList(url) {
    var hash = url; // we stored just the hash as the chapter URL
    var streams = [];

    var refer = this.source.baseUrl + "/anime.php";
    var headers = {
      "User-Agent": this.ua,
      "Referer": refer,
      "Cookie": "key=" + hash,
    };
    var res;
    try {
      res = await this.client.get(this.source.baseUrl + "/gate.php", headers);
    } catch (e) {
      return streams;
    }
    var html = res.body || "";

    // Pull the media URLs out of the player page, in two passes ordered by
    // trust.
    //
    // Pass 1 looks for the exact form the player has always used for an
    // episode: <sub>.animeheaven.me/video.mp4?<token>. Pass 2 — anything
    // shaped like media, on any host — only runs if pass 1 found nothing, so
    // that a new CDN or container still plays. The order matters: the site
    // embeds a short branded "Watch episode on AnimeHeaven.Me" clip, which is
    // also an .mp4, and a loose match can rank it above the real stream. It
    // then plays for a few seconds and stops, which looks like a broken
    // episode rather than the wrong URL.
    //
    // The CDN also checks where the request came from, so send what the
    // browser sends from the player page.
    var streamHeaders = {
      "User-Agent": this.ua,
      "Referer": this.source.baseUrl + "/gate.php",
      "Origin": this.source.baseUrl,
      "Cookie": "key=" + hash,
    };

    var self = this;
    function collect(rx, group) {
      var out = [];
      var seen = {};
      var m;
      rx.lastIndex = 0;
      while ((m = rx.exec(html)) !== null) {
        // URLs sit in HTML, so &amp; can stand in for &.
        var u = self._decodeHtml(group ? m[group] : m[0]);

        // "&d" is the download alias: the same URL with the access token
        // deliberately left off, so it 404s. Skip it.
        if (/&d(\b|$)/.test(u)) continue;

        // &error / &error2 mark the 2nd and 3rd fallback; strip them to get
        // the clean URL but remember which one this was.
        var clean = u.replace(/&error2?$/, "");
        if (seen[clean]) continue;
        seen[clean] = true;
        out.push({ url: clean, raw: u });
      }
      return out;
    }

    var strictRx = /https?:\/\/[\w\-]+\.animeheaven\.me\/video\.mp4\?[^'"\s<>\\]+/g;
    var looseRx = /(?:^|['"(=\s])(https?:\/\/[^'"()\s<>\\]+?\.(?:mp4|m3u8|mkv|webm)(?:\?[^'"()\s<>\\]*)?)(?=['")\s<>\\]|$)/g;

    var found = collect(strictRx, 0);
    if (found.length > 0) {
      // The primary node — the URL with no &error suffix, usually ax — serves
      // the short branded "Watch episode on AnimeHeaven.Me" clip instead of
      // the episode, while the &error and &error2 fallbacks serve the real
      // file. Confirmed by playing all three: only the primary is wrong. Drop
      // it so the player cannot default to the clip, but keep it when it is
      // the only URL on the page rather than leave the episode unplayable.
      var fallbacks = [];
      for (var fi = 0; fi < found.length; fi++) {
        if (/&error2?(\b|$)/.test(found[fi].raw)) fallbacks.push(found[fi]);
      }
      if (fallbacks.length > 0) found = fallbacks;
    } else {
      found = collect(looseRx, 1);
    }

    // Label each entry so the server picker says which URL it actually is.
    // Several candidates used to collapse onto the name "Server 1", which
    // made a wrong pick impossible to tell from a right one.
    var usedLabels = {};
    for (var i = 0; i < found.length; i++) {
      var entry = found[i];
      var hostMatch = entry.url.match(/^https?:\/\/([^\/?#]+)/);
      var host = hostMatch ? hostMatch[1] : "";
      var label;
      if (/(^|\.)animeheaven\.me$/.test(host)) {
        var n = /&error2(\b|$)/.test(entry.raw) ? "3" : (/&error(\b|$)/.test(entry.raw) ? "2" : "1");
        label = "Server " + n + " \u00b7 " + host.replace(/\.animeheaven\.me$/, "");
      } else {
        var file = entry.url.split("?")[0].split("/").pop() || "stream";
        label = host + " \u00b7 " + file;
      }
      // Keep labels unique so two candidates are never indistinguishable.
      if (usedLabels[label]) {
        usedLabels[label] += 1;
        label = label + " (" + usedLabels[label] + ")";
      } else {
        usedLabels[label] = 1;
      }
      streams.push({
        url: entry.url,
        originalUrl: entry.url,
        quality: label,
        headers: streamHeaders,
        subtitles: [],
      });
    }
    return streams;
  }

  getFilterList() {
    return [];
  }

  getSourcePreferences() {
    return [];
  }
}
