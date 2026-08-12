const mangayomiSources = [
  {
    "name": "AniLight",
    "id": 671614911,
    "lang": "en",
    "baseUrl": "https://anilight.live",
    "apiUrl": "https://api.anilight.live/api",
    "iconUrl": "https://www.google.com/s2/favicons?sz=128&domain=https://anilight.live",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.5.0",
    "pkgPath": "anime/src/en/anilight.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": false,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/anilight.js",
    "dateFormat": "",
    "dateFormatLocale": "",
    "additionalParams": "",
    "sourceCodeLanguage": 1,
    "notes": "",
  },
];

// AniLight is a React SPA in front of a fully open JSON API at
// api.anilight.live/api — no auth, no vrf/token handshake, no Cloudflare
// challenge.  The site's own Clerk login only gates /user/* (bookmarks,
// watch progress), none of which this extension needs.
//
// Endpoints used:
//   /filter?page=&sort=&search=&genres=&format=&status=&season=&seasonYear=
//                              → { pageInfo: { hasNextPage }, media: [...] }
//   /search?q=                 → flat array (no paging; /filter is used instead)
//   /anime/{slug}              → AniList-sourced metadata
//   /watch/{slug}              → { episodes: [ { number, title, embed_url } ] }
//
// Metadata is AniList-backed, so titles/covers/genres match AniList exactly.
//
// Streams: /watch/{slug} hands back a MegaPlay embed per episode, e.g.
//   https://megaplay.buzz/stream/s-2/494179/sub
// The number in that path is NOT the id the stream API wants — the embed page
// carries the real one as data-id="177667", and only
//   /stream/getSources?id=177667
// returns the playlist.  Skipping the embed-page fetch 404s every time.
// Only the s-2 server responds; s-1/s-3/s-4 return an error or an empty player.
//
// Subtitle VTTs live on lostproject.club and 403 without a megaplay.buzz
// Referer, so they are downloaded here and inlined as SRT text rather than
// handed to the player as URLs (the player sends no Referer and would 403).
//
// Playback on Windows/Android needs a proxy — measured, not assumed:
// segments are MPEG-TS behind a 70-byte PNG header, served from an image CDN
// at .image URLs.  ffprobe on the raw stream reports
//   "... is not in allowed_extensions" -> Invalid data found
// and with -extension_picky 0 it gets further only to call the segments
// png_pipe / 0x0, i.e. an image, not video.  So the PNG wrapper is the real
// cause and the extension check is a second, downstream symptom; neither is
// reachable from an extension.  iOS AVPlayer scans forward for the 0x47 sync
// byte and plays anyway, which is why the source looks fine there while
// libmpv races through a whole season.
//
// There is no clean-CDN escape: all four hosts MegaPlay hands out
// (megap.mikora.top / shiora.top / shiora.site / akirax.buzz) point their
// segments at the same tiktokcdn image host, and every provider AniLight
// lists resolves to this one MegaPlay stream.
//
// AnimeGG (providerId=ryu on /sources) is the way out, and it needs no proxy:
// progressive MP4s, one URL per quality, so there is no playlist, no segment
// extension check and no PNG wrapper.  Verified h264 1080p + aac on default
// flags.  It only serves with an animegg.org Referer (anilight.live gets a
// 500), and coverage is partial - plenty of episodes 404 - so it is offered
// first and MegaPlay stays behind it.
//
// /sources is keyed by the numeric anime id, NOT the slug; passing the slug
// 404s, which is why this endpoint looked like dead code at first.  The other
// providers were measured and are all unusable: light (vivibebe) is
// PNG-wrapped at extension-less URLs, near (hls.anidb.app) disguises its
// segments as .xls, raye (uwucdn) 403s on hotlink.
//
// MegaPlay works on Windows too, and needs no byte rewriting at all.  The
// PNG wrapper only exists on the megap.* hosts reached via the embed page;
// the same content through /sources?providerId=misa comes back as clean
// MPEG-TS.  Its segments are merely *named* .jpg, which is the only reason
// libmpv refuses them.  Same for misora once the site's own host rewrite is
// applied (bd.24stream.xyz is dead, bd.aniwatchtv.site answers).
//
// So those go through the proxy in redirect mode: the playlist is rewritten
// so segment URLs end in .ts and each one 302s straight back to the CDN.  No
// video passes through the proxy - a few hundred bytes per episode instead of
// gigabytes - and it covers the series AnimeGG lacks.  These entries must
// carry the Referer themselves, because after the 302 the player is talking
// to the CDN directly.
//
// Hence the "Fix playback on Windows/Android" toggle: it routes through a
// proxy that strips the header and serves segments under a .ts path, and an
// "⟨unwrapped⟩" entry is offered ahead of the direct ones.  The address is
// pre-filled (DEFAULT_PROXY) so enabling it is one toggle, no typing.
// Verified with proxy/worker.js in this repo — through it ffprobe reports
// h264 1920x1080 + aac on default flags.
//
// Neither trick that avoids a proxy works, both measured: a Range header
// skipping the 252-byte wrapper is never applied to segment requests (ffmpeg
// owns those), and appending a .ts query to segment URLs only moves the error
// on to "detected format png_pipe".  The segment URLs live in the provider's
// playlist body, so nothing an extension returns can reach them.
// Byte-level segment checks cannot catch any of this: the bytes are valid
// MPEG-TS once the 70-byte header is gone, so a naive probe reports success
// on a stream the app cannot play.  Always ffprobe the URL actually returned.

var GENRES = [
  "Action", "Adventure", "Comedy", "Drama", "Ecchi", "Fantasy", "Horror",
  "Mahou Shoujo", "Mecha", "Music", "Mystery", "Psychological", "Romance",
  "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller",
];

var FORMATS = [
  ["TV Series", "TV"], ["TV Short", "TV_SHORT"], ["Movie", "MOVIE"],
  ["Special", "SPECIAL"], ["OVA", "OVA"], ["ONA", "ONA"], ["Music", "MUSIC"],
];

var STATUSES = [
  ["Airing", "RELEASING"], ["Finished", "FINISHED"],
  ["Upcoming", "NOT_YET_RELEASED"], ["Cancelled", "CANCELLED"],
  ["On Hiatus", "HIATUS"],
];

var SEASONS = [
  ["Winter", "WINTER"], ["Spring", "SPRING"],
  ["Summer", "SUMMER"], ["Fall", "FALL"],
];

var SORTS = [
  ["Most Popular", "POPULARITY_DESC"], ["Trending", "TRENDING_DESC"],
  ["Highest Rated", "SCORE_DESC"], ["Newest First", "START_DATE_DESC"],
  ["Oldest First", "START_DATE"], ["Most Episodes", "EPISODES_DESC"],
  ["Most Favourited", "FAVOURITES_DESC"],
];

// Pre-filled proxy address, so switching this on is one toggle per machine
// instead of a URL anyone has to be told.
//
// NOTE: localhost means *that* PC — this is not a shared address.  Every
// machine needs proxy/proxy.js running locally (Node + a Startup shortcut).
// To cover several machines, and phones, from one place, deploy
// proxy/worker.js and put its https URL here instead; the toggle then needs
// no per-machine setup at all.
var DEFAULT_PROXY = "http://localhost:8765";

// The API hands out hostnames that are frequently dead (Cloudflare 522) and
// only answer under a replacement name.  The site ships the same mapping in
// its own bundle and applies it before playing, so this is not a workaround
// so much as the missing half of the response.
var HOST_REWRITES = [
  ["bd.24stream.xyz", "bd.aniwatchtv.site"],
  ["vibeplayer.site", "vivibebe.site"],
];

// Providers reachable through /sources that serve *clean* MPEG-TS.  Their
// segments are misnamed (.jpg), which is the only reason libmpv rejects them,
// so they need nothing more than a URL that ends in .ts — the proxy's redirect
// mode, which passes no video bytes at all.
var TS_PROVIDERS = [
  { id: "misa",   name: "MegaPlay", referer: "https://megaplay.buzz/" },
  { id: "misora", name: "Misora",   referer: null },   // referer = its own origin
];

class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
  }

  get ua() {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
  }

  get apiUrl() {
    return this.source.apiUrl || "https://api.anilight.live/api";
  }

  get apiHeaders() {
    return {
      "User-Agent": this.ua,
      "Accept": "application/json",
      "Referer": this.source.baseUrl + "/",
      "Origin": this.source.baseUrl,
    };
  }

  getPreference(key) {
    try {
      return new SharedPreferences().get(key);
    } catch (e) {
      return null;
    }
  }

  // Base URL of the unwrapping proxy, or "" when it is switched off.
  //
  // The URL is pre-filled so that turning this on is a single toggle on every
  // machine — nobody has to know or type the address.  The box stays editable
  // for anyone pointing at a deployed worker instead of a local proxy, and
  // anything that is not an http(s) origin is ignored rather than pasted into
  // a stream URL.
  proxyBase() {
    if (this.getPreference("anilight_pref_proxy_enabled") !== true) return "";
    var raw = String(this.getPreference("anilight_pref_proxy_url") || "").trim();
    // Empty box → fall back to the default rather than silently doing nothing.
    if (!raw) raw = DEFAULT_PROXY;
    if (!/^https?:\/\/[^/\s]+/.test(raw)) return "";
    return raw.replace(/\/+$/, "");
  }

  async getJson(path) {
    var res = await this.client.get(this.apiUrl + path, this.apiHeaders);
    try {
      return JSON.parse((res && res.body) || "");
    } catch (e) {
      return null;
    }
  }

  // AniList titles come as { romaji, english, native } — honour the user's pick
  // but never return an empty string.
  pickTitle(title) {
    if (!title) return "Unknown";
    var pref = this.getPreference("anilight_pref_title") || "english";
    return (
      title[pref] || title.english || title.romaji || title.native || "Unknown"
    );
  }

  cover(item) {
    var img = item.coverImage || {};
    return img.extraLarge || img.large || item.bannerImage || "";
  }

  toEntry(item) {
    return {
      name: this.pickTitle(item.title),
      link: this.source.baseUrl + "/anime/" + item.slug,
      imageUrl: this.cover(item),
    };
  }

  // ── List pages ──────────────────────────────────────────────────────────────

  async filterPage(params, page) {
    var qs = ["page=" + (page || 1)];
    for (var i = 0; i < params.length; i++) qs.push(params[i]);
    var data = await this.getJson("/filter?" + qs.join("&"));
    if (!data || !Array.isArray(data.media)) {
      return { list: [], hasNextPage: false };
    }
    var self = this;
    return {
      list: data.media.map(function (m) { return self.toEntry(m); }),
      hasNextPage: !!(data.pageInfo && data.pageInfo.hasNextPage),
    };
  }

  get supportsLatest() {
    return true;
  }

  async getPopular(page) {
    return await this.filterPage(["sort=POPULARITY_DESC"], page);
  }

  // /filter has no "recently updated" sort — START_DATE_DESC returns an empty
  // first page upstream (entries with no start date sort ahead of everything).
  // The homepage's recentlyAddedEpisodes rail is the real "what just aired"
  // list; it is a fixed 15 items with no paging.
  async getLatestUpdates(page) {
    if ((page || 1) > 1) return { list: [], hasNextPage: false };
    var data = await this.getJson("/homepage");
    var recent = (data && Array.isArray(data.recentlyAddedEpisodes))
      ? data.recentlyAddedEpisodes
      : [];
    if (recent.length === 0) {
      // Fall back to trending so the tab is never blank.
      return await this.filterPage(["sort=TRENDING_DESC"], 1);
    }
    var self = this;
    var seen = {};
    var list = [];
    for (var i = 0; i < recent.length; i++) {
      var item = recent[i];
      if (!item || !item.slug || seen[item.slug]) continue;
      seen[item.slug] = true;
      list.push(self.toEntry(item));
    }
    return { list: list, hasNextPage: false };
  }

  async search(query, page, filters) {
    var params = [];
    if (query) params.push("search=" + encodeURIComponent(query));

    // Filters arrive positionally, in the same order as getFilterList().
    try {
      var defs = this.filterDefs();
      for (var i = 0; i < defs.length; i++) {
        var f = (filters || [])[i];
        if (!f) continue;
        var def = defs[i];
        if (def.kind === "group") {
          // Genres go over as one comma-separated `genres=` param.
          var picked = [];
          var st = f.state || [];
          for (var j = 0; j < st.length; j++) {
            if (st[j] && st[j].state === true && st[j].value) picked.push(st[j].value);
          }
          if (picked.length) {
            params.push(def.param + "=" + encodeURIComponent(picked.join(",")));
          }
        } else {
          var opt = (f.values || [])[f.state || 0];
          if (opt && opt.value) {
            params.push(def.param + "=" + encodeURIComponent(opt.value));
          }
        }
      }
    } catch (e) { /* fall back to a plain title search */ }

    // A bare browse with no query and no filters should still be ordered.
    if (params.length === 0) params.push("sort=POPULARITY_DESC");
    return await this.filterPage(params, page);
  }

  // ── Detail ──────────────────────────────────────────────────────────────────

  slugFrom(url) {
    var m = String(url || "").match(/\/(?:anime|watch)\/([^/?#]+)/);
    return m ? m[1] : String(url || "").replace(/^\/+|\/+$/g, "");
  }

  statusCode(s) {
    var t = String(s || "").toUpperCase();
    if (t === "FINISHED") return 1;
    if (t === "NOT_YET_RELEASED") return 4;
    if (t === "RELEASING") return 0;
    return 5;
  }

  stripHtml(s) {
    return String(s || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&quot;/g, '"')
      .replace(/&#0*39;|&apos;|&rsquo;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .trim();
  }

  async getDetail(url) {
    var slug = this.slugFrom(url);
    // Metadata and the episode list are two separate endpoints; neither
    // depends on the other, so fetch them together.
    var pair = await Promise.all([
      this.getJson("/anime/" + slug),
      this.getJson("/watch/" + slug),
    ]);
    var info = pair[0] || {};
    var watch = pair[1] || {};

    var chapters = [];
    var eps = Array.isArray(watch.episodes) ? watch.episodes : [];
    for (var i = 0; i < eps.length; i++) {
      var ep = eps[i];
      if (!ep || ep.number === undefined || ep.number === null) continue;
      var label = "Episode " + ep.number;
      // Episodes with no English title come back as "#" (and occasionally as
      // "Episode N" repeated) — neither is worth appending.
      var epTitle = this.stripHtml(ep.title || "");
      if (/^[\s#\-–—.]*$/.test(epTitle)) epTitle = "";
      if (epTitle && epTitle !== label) label += ": " + epTitle;
      if (ep.isFiller) label += " (Filler)";
      chapters.push({
        name: label,
        // The numeric id rides along because /sources (AnimeGG) keys off it and
        // will not accept the slug — carrying it here saves a lookup per play.
        url: this.source.baseUrl + "/watch/" + slug + "?ep=" + ep.number +
             (info.id ? "&id=" + info.id : ""),
      });
    }
    // The API returns episode 1 first; Mangayomi lists newest at the top.
    chapters.reverse();

    var genre = Array.isArray(info.genres) ? info.genres : [];
    var studios = "";
    if (info.studios && Array.isArray(info.studios.nodes) && info.studios.nodes.length) {
      studios = info.studios.nodes.map(function (n) { return n.name; }).join(", ");
    }

    var description = this.stripHtml(info.description || "");
    var extra = [];
    if (studios) extra.push("Studio: " + studios);
    if (info.seasonYear) {
      extra.push("Season: " + ((info.season || "") + " " + info.seasonYear).trim());
    }
    if (info.averageScore) extra.push("Score: " + info.averageScore + "%");
    if (extra.length) description = extra.join("\n") + (description ? "\n\n" + description : "");

    return {
      name: this.pickTitle(info.title) !== "Unknown"
        ? this.pickTitle(info.title)
        : this.slugFrom(url),
      imageUrl: this.cover(info),
      description: description,
      genre: genre,
      status: this.statusCode(info.status),
      author: studios,
      link: this.source.baseUrl + "/anime/" + slug,
      chapters: chapters,
    };
  }

  // ── Streaming ───────────────────────────────────────────────────────────────

  // Convert a WebVTT timestamp to SRT format.
  // These VTTs use MM:SS.mmm (no hours); libmpv rejects that two-part form.
  _vttTsToSrt(ts) {
    var dotIdx = ts.lastIndexOf(".");
    var ms = ts.substring(dotIdx + 1);
    var parts = ts.substring(0, dotIdx).split(":");
    while (parts.length < 3) parts.unshift("00");
    return parts.join(":") + "," + ms;
  }

  _vttToSrt(vtt) {
    var lines = vtt.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    var srt = "", cueNum = 1, i = 0;
    while (i < lines.length && lines[i].trim() !== "") i++;
    while (i < lines.length) {
      while (i < lines.length && lines[i].trim() === "") i++;
      if (i >= lines.length) break;
      var line = lines[i];
      if (/^(NOTE|STYLE|REGION)\b/.test(line)) {
        while (i < lines.length && lines[i].trim() !== "") i++;
        continue;
      }
      if (line.indexOf("-->") < 0) { i++; if (i >= lines.length) break; line = lines[i]; }
      if (line.indexOf("-->") < 0) { i++; continue; }
      var m = line.match(/([\d:]+\.\d{3})\s*-->\s*([\d:]+\.\d{3})/);
      if (!m) { i++; continue; }
      var start = this._vttTsToSrt(m[1]), end = this._vttTsToSrt(m[2]);
      i++;
      var textLines = [];
      while (i < lines.length && lines[i].trim() !== "") {
        textLines.push(lines[i].replace(/<[\d:]+\.\d{3}>/g, ""));
        i++;
      }
      if (textLines.length > 0) {
        srt += cueNum + "\n" + start + " --> " + end + "\n" + textLines.join("\n") + "\n\n";
        cueNum++;
      }
    }
    return srt || vtt;
  }

  // Download the tracks with a megaplay Referer and inline them as SRT.
  // Mangayomi auto-enables subtitles[0], and MegaPlay returns the list in
  // alphabetical order (Arabic first), so the track flagged `default` — and
  // English after it — has to be pulled to the front or the wrong language
  // turns itself on.
  async inlineSubtitles(tracks, referer) {
    if (!Array.isArray(tracks)) return [];
    var self = this;
    // The two stream endpoints disagree on the field name: /stream/getSources
    // calls it `file`, /sources calls it `url`. Accept either.
    var wanted = tracks.filter(function (t) {
      return t && (t.file || t.url) && t.kind !== "thumbnails";
    }).map(function (t) {
      return { file: t.file || t.url, label: t.label, default: t.default, kind: t.kind };
    });
    var rank = function (t) {
      if (t.default === true) return 0;
      var label = String(t.label || "").toLowerCase();
      if (label.indexOf("english") === 0) return 1;
      return 2;
    };
    // Stable ordering: keep the original sequence inside each rank.
    wanted = wanted
      .map(function (t, i) { return { t: t, i: i }; })
      .sort(function (a, b) { return rank(a.t) - rank(b.t) || a.i - b.i; })
      .map(function (x) { return x.t; });

    // Every track has to be downloaded in full to be inlined, and some releases
    // carry 14+ languages. Firing all of them gets the CDN to throttle (which
    // then takes the playlist request down with it and the episode resolves to
    // no sources at all), and the app's isolate gives the whole call ~40s.
    // The ranked head of the list is what anyone actually turns on.
    var cap = parseInt(this.getPreference("anilight_pref_sub_count"), 10);
    if (!cap || cap < 1) cap = 6;
    wanted = wanted.slice(0, cap);
    var fetched = await Promise.all(wanted.map(function (track) {
      return self.client
        .get(track.file, { "User-Agent": self.ua, "Referer": referer })
        .then(function (res) {
          var body = ((res && res.body) || "").replace(/^\s+/, "");
          if (body.indexOf("WEBVTT") !== 0) return null;
          return { file: self._vttToSrt(body), label: track.label || "Unknown" };
        })
        .catch(function () { return null; });
    }));
    return fetched.filter(function (s) { return s !== null; });
  }

  // Split a master playlist into one entry per quality.
  // Returns [] when the URL is already a flat media playlist.
  async hlsVariants(masterUrl, headers) {
    try {
      var res = await this.client.get(masterUrl, headers);
      var body = (res && res.body) || "";
      if (body.indexOf("#EXTM3U") < 0) return null;   // blocked or an error page
      if (body.indexOf("#EXT-X-STREAM-INF") < 0) return [];

      var lastSlash = masterUrl.lastIndexOf("/");
      var baseDir = lastSlash > 0 ? masterUrl.substring(0, lastSlash + 1) : masterUrl;
      var lines = body.split("\n");
      var variants = [];
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.indexOf("#EXT-X-STREAM-INF:") !== 0) continue;
        var resM = line.match(/RESOLUTION=\d+x(\d+)/);
        var bwM = line.match(/BANDWIDTH=(\d+)/);
        var label = resM
          ? resM[1] + "p"
          : (bwM ? Math.round(parseInt(bwM[1], 10) / 1000) + "kbps" : "Auto");
        for (var j = i + 1; j < lines.length; j++) {
          var u = lines[j].trim();
          if (!u || u.charAt(0) === "#") continue;
          variants.push({ url: u.indexOf("http") === 0 ? u : baseDir + u, label: label });
          break;
        }
      }
      variants.sort(function (a, b) {
        return (parseInt(b.label, 10) || 0) - (parseInt(a.label, 10) || 0);
      });
      return variants;
    } catch (e) {
      return null;
    }
  }

  // MegaPlay embed → playable streams.
  // The id in the embed path is a lookup key only; the page's data-id is what
  // /stream/getSources actually accepts.
  async resolveMegaplay(embedUrl, audioLabel) {
    var streams = [];
    try {
      var hostM = embedUrl.match(/^(https?:\/\/[^/]+)/);
      if (!hostM) return streams;
      var origin = hostM[1];

      var page = await this.client.get(embedUrl, {
        "User-Agent": this.ua,
        "Referer": this.source.baseUrl + "/",
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
      });
      var html = (page && page.body) || "";
      var idM = html.match(/data-id="(\d+)"/) || html.match(/<title>File (\d+)/i);
      if (!idM) return streams;

      var srcRes = await this.client.get(
        origin + "/stream/getSources?id=" + idM[1],
        {
          "User-Agent": this.ua,
          "Referer": embedUrl,
          "X-Requested-With": "XMLHttpRequest",
          "Accept": "application/json",
        }
      );
      var data;
      try { data = JSON.parse((srcRes && srcRes.body) || ""); } catch (e) { return streams; }
      if (!data) return streams;

      var m3u8 = "";
      if (data.sources) {
        if (typeof data.sources === "string") m3u8 = data.sources;
        else if (data.sources.file) m3u8 = data.sources.file;
        else if (Array.isArray(data.sources) && data.sources.length) {
          m3u8 = data.sources[0].file || data.sources[0].url || "";
        }
      }
      if (!m3u8) return streams;

      var hdrs = { "User-Agent": this.ua, "Referer": origin + "/", "Origin": origin };
      var subtitles = await this.inlineSubtitles(data.tracks, origin + "/");
      var variants = await this.hlsVariants(m3u8, hdrs);
      if (variants === null) return streams;   // playlist unreachable — skip

      var playlists = variants.length > 0
        ? variants
        : [{ url: m3u8, label: "Auto" }];

      // An unwrapping proxy, when the user has one, is emitted first: on
      // Windows/Android it is the only thing that plays (see the header note).
      // The direct entries stay as fallback so iOS — where the raw stream is
      // fine — still has them, and so the source degrades to plain behaviour
      // if the proxy is down.
      var proxy = this.proxyBase();
      for (var p = 0; p < playlists.length; p++) {
        if (!proxy) break;
        streams.push({
          url: proxy + "/m3u8?url=" + encodeURIComponent(playlists[p].url) +
               "&referer=" + encodeURIComponent(origin + "/"),
          originalUrl: playlists[p].url,
          quality: "MegaPlay " + playlists[p].label + " [" + audioLabel + "] ⟨unwrapped⟩",
          // The proxy attaches the upstream Referer itself; forwarding ours
          // would make Mangayomi send it to the proxy instead.
          headers: { "User-Agent": this.ua },
          subtitles: subtitles,
        });
      }
      for (var v = 0; v < playlists.length; v++) {
        streams.push({
          url: playlists[v].url,
          originalUrl: m3u8,
          quality: "MegaPlay " + playlists[v].label + " [" + audioLabel + "]",
          headers: hdrs,
          subtitles: subtitles,
        });
      }
    } catch (e) {}
    return streams;
  }

  // AnimeGG (the API's "ryu" provider) hands back progressive MP4s, one URL
  // per quality.  This is the only backend AniLight exposes that Windows can
  // play untouched: no playlist, so no segment-extension check and no PNG
  // wrapper.  Coverage is partial — plenty of episodes 404 here — so it is
  // offered first and MegaPlay stays behind it.
  //
  // The MP4s only serve with an animegg.org Referer; anilight.live gets a 500.
  async resolveAnimeGG(animeId, epNum, type, audioLabel) {
    var streams = [];
    if (!animeId || epNum === null || epNum === undefined) return streams;
    try {
      var data = await this.getJson(
        "/sources?id=" + encodeURIComponent(animeId) +
        "&epNum=" + encodeURIComponent(epNum) +
        "&type=" + type + "&providerId=ryu"
      );
      var list = (data && Array.isArray(data.sources)) ? data.sources : [];
      var hdrs = {
        "User-Agent": this.ua,
        "Referer": "https://www.animegg.org/",
        "Origin": "https://www.animegg.org",
      };
      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        if (!s || !s.url || !/^https?:\/\//.test(s.url)) continue;
        streams.push({
          url: s.url,
          originalUrl: s.url,
          quality: "AnimeGG " + (s.quality || "MP4") + " [" + audioLabel + "]",
          headers: hdrs,
          subtitles: [],
          _h: parseInt(s.quality, 10) || 0,
        });
      }
      // Highest quality first within the group.
      streams.sort(function (a, b) { return b._h - a._h; });
    } catch (e) {}
    return streams;
  }

  applyHostRewrites(u) {
    var out = String(u || "");
    for (var i = 0; i < HOST_REWRITES.length; i++) {
      out = out.split(HOST_REWRITES[i][0]).join(HOST_REWRITES[i][1]);
    }
    return out;
  }

  // Providers whose segments are already valid MPEG-TS and are only refused
  // because they are named .jpg.  Nothing needs unwrapping, so these go out
  // through the proxy's redirect mode when it is on: the playlist is rewritten
  // so segment URLs end in .ts, and each one 302s straight back to the CDN.
  // Without the proxy they are still listed — iOS plays them as-is.
  async resolveTsProvider(prov, animeId, epNum, type, audioLabel) {
    var streams = [];
    if (!animeId || epNum === null || epNum === undefined) return streams;
    try {
      var data = await this.getJson(
        "/sources?id=" + encodeURIComponent(animeId) +
        "&epNum=" + encodeURIComponent(epNum) +
        "&type=" + type + "&providerId=" + prov.id
      );
      var list = (data && Array.isArray(data.sources)) ? data.sources : [];
      if (list.length === 0) return streams;

      var master = this.applyHostRewrites(list[0].url || "");
      if (!/^https?:\/\//.test(master)) return streams;

      var origin = master.match(/^(https?:\/\/[^/]+)/)[1];
      var referer = prov.referer || (origin + "/");
      var hdrs = { "User-Agent": this.ua, "Referer": referer, "Origin": origin.replace(/\/$/, "") };

      var subtitles = await this.inlineSubtitles(data.tracks, referer);
      var variants = await this.hlsVariants(master, hdrs);
      if (variants === null) return streams;   // host down — skip quietly
      var playlists = variants.length > 0 ? variants : [{ url: master, label: "Auto" }];

      var proxy = this.proxyBase();
      for (var p = 0; p < playlists.length && proxy; p++) {
        streams.push({
          url: proxy + "/m3u8?url=" + encodeURIComponent(playlists[p].url) +
               "&referer=" + encodeURIComponent(referer) + "&mode=redirect",
          originalUrl: playlists[p].url,
          quality: prov.name + " " + playlists[p].label + " [" + audioLabel + "] ⟨fixed⟩",
          // Redirect mode means the player talks to the CDN itself once the
          // 302 lands, so it has to carry the Referer — unlike the unwrapping
          // path, where the proxy makes the upstream request.
          headers: hdrs,
          subtitles: subtitles,
        });
      }
      for (var v = 0; v < playlists.length; v++) {
        streams.push({
          url: playlists[v].url,
          originalUrl: master,
          quality: prov.name + " " + playlists[v].label + " [" + audioLabel + "]",
          headers: hdrs,
          subtitles: subtitles,
        });
      }
    } catch (e) {}
    return streams;
  }

  async getVideoList(url) {
    var slug = this.slugFrom(url);
    var epM = String(url || "").match(/[?&]ep=([0-9.]+)/);
    var epNum = epM ? epM[1] : null;
    // getDetail puts the numeric id in the link; older bookmarks predate that,
    // so fall back to looking it up.
    var idM = String(url || "").match(/[?&]id=(\d+)/);
    var animeId = idM ? idM[1] : null;

    var watch = await this.getJson("/watch/" + slug);
    var eps = (watch && Array.isArray(watch.episodes)) ? watch.episodes : [];
    if (eps.length === 0) return [];
    if (!animeId) animeId = watch.id || null;
    if (!animeId) {
      var info = await this.getJson("/anime/" + slug);
      animeId = (info && info.id) || null;
    }

    var episode = null;
    for (var i = 0; i < eps.length; i++) {
      if (String(eps[i].number) === String(epNum)) { episode = eps[i]; break; }
    }
    if (!episode) episode = eps[0];

    var embeds = episode.embed_url || {};
    var self = this;
    var epKey = episode.number;

    // Every backend is an independent lookup — run them together.
    var jobs = [];
    jobs.push({ kind: "gg", type: "sub", label: "Sub" });
    jobs.push({ kind: "gg", type: "dub", label: "Dub" });
    for (var t = 0; t < TS_PROVIDERS.length; t++) {
      jobs.push({ kind: "ts", prov: TS_PROVIDERS[t], type: "sub", label: "Sub" });
      jobs.push({ kind: "ts", prov: TS_PROVIDERS[t], type: "dub", label: "Dub" });
    }
    // The embed path reaches MegaPlay's PNG-wrapped hosts; kept last because
    // it is the only one that needs bytes rewritten, but it is also the one
    // that always exists.
    if (embeds.sub) jobs.push({ kind: "mp", url: embeds.sub, label: "Sub" });
    if (embeds.dub) jobs.push({ kind: "mp", url: embeds.dub, label: "Dub" });

    var groups = await Promise.all(jobs.map(function (j) {
      var p;
      if (j.kind === "gg") p = self.resolveAnimeGG(animeId, epKey, j.type, j.label);
      else if (j.kind === "ts") p = self.resolveTsProvider(j.prov, animeId, epKey, j.type, j.label);
      else p = self.resolveMegaplay(j.url, j.label);
      return p.catch(function () { return []; });
    }));

    var videos = [];
    for (var g = 0; g < groups.length; g++) {
      for (var k = 0; k < groups[g].length; k++) videos.push(groups[g][k]);
    }
    if (videos.length === 0) return [];

    // Mangayomi plays the first entry and takes auto-play subtitles from it,
    // so the preferred audio track has to lead.  Within that, AnimeGG goes
    // first: it is the only source that plays on Windows without a proxy.
    // MegaPlay carries the soft subtitles, so anyone who wants those (or a
    // higher quality than AnimeGG has) picks it from the list.
    var prefType = this.getPreference("anilight_pref_type") || "sub";
    var wantDub = prefType === "dub";
    // Playable-on-Windows first: AnimeGG needs nothing, the ⟨fixed⟩ entries
    // need only a redirect, ⟨unwrapped⟩ needs every byte proxied, and the bare
    // entries are iOS-only.
    var rank = function (v) {
      if (v.quality.indexOf("AnimeGG") === 0) return 0;
      if (v.quality.indexOf("⟨fixed⟩") >= 0) return 1;
      if (v.quality.indexOf("⟨unwrapped⟩") >= 0) return 2;
      return 3;
    };
    videos.sort(function (a, b) {
      var aDub = a.quality.indexOf("[Dub]") >= 0;
      var bDub = b.quality.indexOf("[Dub]") >= 0;
      if (aDub !== bDub) return (aDub === wantDub) ? -1 : 1;
      var r = rank(a) - rank(b);
      if (r !== 0) return r;
      return 0;   // each group is already ordered high→low
    });
    videos.forEach(function (v) { delete v._h; });
    return videos;
  }

  // ── Filters & preferences ───────────────────────────────────────────────────

  filterDefs() {
    var years = [];
    for (var y = new Date().getFullYear() + 1; y >= 1970; y--) years.push([String(y), String(y)]);
    return [
      {
        kind: "group", param: "genres", name: "Genres",
        options: GENRES.map(function (g) { return [g, g]; }),
      },
      { kind: "select", param: "format", name: "Format", options: FORMATS },
      { kind: "select", param: "status", name: "Status", options: STATUSES },
      { kind: "select", param: "season", name: "Season", options: SEASONS },
      { kind: "select", param: "seasonYear", name: "Year", options: years },
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
        key: "anilight_pref_title",
        listPreference: {
          title: "Preferred title language",
          summary: "Which AniList title to display",
          valueIndex: 0,
          entries: ["English", "Romaji", "Native"],
          entryValues: ["english", "romaji", "native"],
        },
      },
      {
        key: "anilight_pref_type",
        listPreference: {
          title: "Preferred audio",
          summary: "Which version is listed first (and supplies auto-play subtitles)",
          valueIndex: 0,
          entries: ["Sub", "Dub"],
          entryValues: ["sub", "dub"],
        },
      },
      {
        key: "anilight_pref_proxy_enabled",
        checkBoxPreference: {
          title: "Fix playback on Windows/Android",
          summary: "Turn on if episodes skip instantly or refuse to start. Not needed on iOS. Requires the proxy to be reachable at the address below.",
          value: false,
        },
      },
      {
        key: "anilight_pref_proxy_url",
        editTextPreference: {
          title: "Proxy address (advanced)",
          summary: "Already filled in — only change this if you run the proxy somewhere other than this PC.",
          value: DEFAULT_PROXY,
          dialogTitle: "Proxy address",
          dialogMessage: "AniLight's CDN disguises video segments as PNG images, which Windows/Android cannot decode (iOS plays them fine). The default points at a proxy running on this PC. Replace it with a deployed worker's https URL to cover several devices from one place.",
        },
      },
      {
        key: "anilight_pref_sub_count",
        listPreference: {
          title: "Subtitle languages to load",
          summary: "Subtitles must be downloaded to work, so loading more slows episodes down. English first either way.",
          valueIndex: 1,
          entries: ["2 (fastest)", "6 (default)", "12", "All available"],
          entryValues: ["2", "6", "12", "99"],
        },
      },
    ];
  }
}
