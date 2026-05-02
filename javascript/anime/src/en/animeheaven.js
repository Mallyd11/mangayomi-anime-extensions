const mangayomiSources = [
  {
    "name": "AnimeHeaven",
    "id": -1744325818,
    "lang": "en",
    "baseUrl": "https://animeheaven.me",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://animeheaven.me",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.0.1",
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
    };
  }

  async fetchHtml(path) {
    var url = path.startsWith("http") ? path : this.source.baseUrl + "/" + path.replace(/^\/+/, "");
    var res = await this.client.get(url, this.headers);
    return res.body || "";
  }

  // Parse a list page (popular.php / new.php / search.php). The site uses two
  // structures: chart cards (popular, new) and similar cards (search). Both
  // wrap an <img class='coverimg'> inside an <a href='anime.php?ID'>.
  parseList(html) {
    var list = [];
    // Pull every anchor that wraps a coverimg. Site uses single-quoted attrs.
    var rx = /<a[^>]+href='(anime\.php\?[\w]+)'[^>]*>\s*<img[^>]+class='coverimg'[^>]+src='([^']+)'[^>]+alt='([^']*)'/g;
    var seen = {};
    var m;
    while ((m = rx.exec(html)) !== null) {
      var path = m[1];
      var imgRel = m[2];
      var name = m[3];
      if (!path || !name) continue;
      if (seen[path]) continue;
      seen[path] = true;
      var imageUrl = imgRel.indexOf("http") === 0 ? imgRel : this.source.baseUrl + "/" + imgRel.replace(/^\/+/, "");
      list.push({
        name: this._decodeHtml(name),
        link: this.source.baseUrl + "/" + path,
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
    // Site shows the entire popular list on one page (no pagination).
    if (page > 1) return { list: [], hasNextPage: false };
    var html = await this.fetchHtml("popular.php");
    return { list: this.parseList(html), hasNextPage: false };
  }

  async getLatestUpdates(page) {
    if (page > 1) return { list: [], hasNextPage: false };
    var html = await this.fetchHtml("new.php");
    return { list: this.parseList(html), hasNextPage: false };
  }

  async search(query, page, filters) {
    if (page > 1) return { list: [], hasNextPage: false };
    var html = await this.fetchHtml("search.php?s=" + encodeURIComponent(query));
    return { list: this.parseList(html), hasNextPage: false };
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
    var nameMatch = html.match(/<div class='infotitle c'>([^<]+)<\/div>/);
    if (nameMatch) name = this._decodeHtml(nameMatch[1].trim());

    // Cover image (look for cover-style img after the title)
    var imageUrl = "";
    var coverMatch = html.match(/<img[^>]+class='[^']*infoimg[^']*'[^>]+src='([^']+)'/);
    if (!coverMatch) coverMatch = html.match(/<img[^>]+class='[^']*coverimg[^']*'[^>]+src='([^']+)'/);
    if (coverMatch) {
      var rel = coverMatch[1];
      imageUrl = rel.indexOf("http") === 0 ? rel : this.source.baseUrl + "/" + rel.replace(/^\/+/, "");
    }
    // Fall back to og:image
    if (!imageUrl) {
      var og = html.match(/<meta property='og:image' content='([^']+)'/);
      if (og) imageUrl = og[1];
    }

    // Description
    var description = "";
    var descMatch = html.match(/<div class='infodes c'>([\s\S]*?)<\/div>/);
    if (descMatch) {
      description = this._decodeHtml(descMatch[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
    }

    // Genres — every <a class='boxitem ...'> in the tags section is a genre tag.
    var genre = [];
    var genreSection = html.match(/<div class='infotags[^']*'[^>]*>([\s\S]*?)<\/div>\s*<div class='infoyear/);
    if (genreSection) {
      var gRx = /<a[^>]+href='tags\.php\?[^']+'[^>]*>([^<]+)<\/a>/g;
      var gm;
      while ((gm = gRx.exec(genreSection[1])) !== null) {
        genre.push(this._decodeHtml(gm[1].trim()));
      }
    }
    // Fallback: just look for any tags.php links
    if (genre.length === 0) {
      var gRx2 = /<a[^>]+href='tags\.php\?tag=([^']+)'/g;
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
    var statusBlock = html.match(/Status[\s\S]{0,40}?<div[^>]+class='inline c2'>([^<]+)</);
    if (statusBlock) status = this.statusCode(statusBlock[1]);
    else {
      // If no status label, infer: if "Episodes" count appears followed by total, treat as completed; else default unknown
      // Site mostly shows finished anime; default to 5 (UNKNOWN) when not stated.
    }

    // Episodes — every anchor with onclick="gatea(...)" is an episode.
    var chapters = [];
    var epRx = /<a[^>]*onclick='gatea\(\\?["']([a-f0-9]+)\\?["']\)'[^>]*>([\s\S]*?)<\/a>/g;
    var em;
    while ((em = epRx.exec(html)) !== null) {
      var hash = em[1];
      var body = em[2];
      var numMatch = body.match(/watch2[^>]*>(\d+(?:\.\d+)?)/);
      var epNum = numMatch ? numMatch[1] : String(chapters.length + 1);
      chapters.push({
        name: "Episode " + epNum,
        url: hash, // chapter URL is just the gate cookie key
      });
    }
    // Latest episode is usually first in the source; reverse so episode 1 is at the
    // bottom (Mangayomi convention: most recent at top).
    // The site already lists newest first, so no reverse needed.

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

    // Pull every distinct mp4 URL. Different subdomains rotate per refresh, but
    // each page lists ax/ct/ck etc. as fallbacks. We surface them as quality options.
    var seen = {};
    var rx = /['"](https?:\/\/[\w\-]+\.animeheaven\.me\/video\.mp4\?[^'"\s]+)['"]/g;
    var m;
    var streamHeaders = {
      "User-Agent": this.ua,
      "Referer": this.source.baseUrl + "/",
    };
    while ((m = rx.exec(html)) !== null) {
      var u = m[1];
      // Strip the trailing "&error" / "&error2" / "&d" markers used by the
      // site's player to switch fallbacks — they don't change which file is
      // served, just how the player labels it.
      var clean = u.replace(/&(error2?|d)$/, "");
      // The cleaned url may now be a duplicate of another entry.
      if (seen[clean]) continue;
      seen[clean] = true;

      // Label by suffix so users can pick a fallback if the primary 404s.
      var label;
      if (/&error2(\b|$)/.test(u)) label = "Server 3";
      else if (/&error(\b|$)/.test(u)) label = "Server 2";
      else if (/&d(\b|$)/.test(u)) label = "Download";
      else label = "Server 1";

      streams.push({
        url: clean,
        originalUrl: clean,
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
