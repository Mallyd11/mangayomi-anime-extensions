const mangayomiSources = [
  {
    "name": "Animetsu",
    "id": 802511794,
    "baseUrl": "https://animetsu.bz",
    "lang": "en",
    "typeSource": "single",
    "iconUrl":
      "https://www.google.com/s2/favicons?sz=256&domain=https://animetsu.bz/",
    "dateFormat": "",
    "dateFormatLocale": "",
    "isNsfw": false,
    "hasCloudflare": true,
    "sourceCodeUrl": "",
    "apiUrl": "",
    "version": "1.2.4",
    "isManga": false,
    "itemType": 1,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "additionalParams": "",
    "sourceCodeLanguage": 1,
    "notes": "",
    "pkgPath": "anime/src/en/animetsu.js",
  },
];
class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
  }

  getPreference(key) {
    return new SharedPreferences().get(key);
  }

  getBaseUrl() {
    return this.getPreference("animetsu_base_url");
  }

  getHeaders(url) {
    url = url != null && url.length > 0 ? url : this.getBaseUrl();
    return {
      "Referer": url,
      "n1": "1",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    };
  }

  getProxyMediaUrl(url) {
    return "https://swiftstream.top/proxy" + url;
  }

  async request(slug) {
    var baseUrl = this.getBaseUrl();
    var hdr = this.getHeaders(baseUrl);
    var url = baseUrl + "/v2/api/anime" + slug;
    var res = await this.client.get(url, hdr);
    if (res.statusCode != 200) {
      throw new Error("Request failed: HTTP " + res.statusCode);
    }
    return JSON.parse(res.body);
  }

  async searchAnime({
    query = "",
    sort = "popular",
    status = "",
    page = "1",
  }) {
    var titlePref = this.getPreference("animetsu_title_lang");

    var slug = "/search/?";
    if (query.length > 0) slug += "query=" + query + "&";
    slug += "sort=" + sort;
    if (status.length > 0) slug += "&status=" + status;
    slug += "&page=" + page;
    slug += "&per_page=20";

    var doc = await this.request(slug);

    var hasNextPage = page != doc.last_page;
    var list = [];
    doc.results.forEach((item) => {
      var romajiTitle = item.title.romaji;
      var prefTitle = item.title[titlePref];

      var name = prefTitle != null ? prefTitle : romajiTitle;
      var link = item.id;
      var imageUrl = item.cover_image.medium;
      list.push({
        name,
        link,
        imageUrl,
      });
    });
    return { list, hasNextPage };
  }

  async getPopular(page) {
    return await this.searchAnime({ page: page });
  }

  async getLatestUpdates(page) {
    var titlePref = this.getPreference("animetsu_title_lang");
    var doc = await this.request("/recent?page=" + page + "&per_page=20");
    var hasNextPage = page != doc.last_page;
    var list = [];
    doc.results.forEach((item) => {
      var romajiTitle = item.title.romaji;
      var prefTitle = item.title[titlePref];
      var name = prefTitle != null ? prefTitle : romajiTitle;
      var link = item.id;
      var imageUrl = item.cover_image.medium;
      list.push({ name, link, imageUrl });
    });
    return { list, hasNextPage };
  }

  async search(query, page, filters) {
    return await this.searchAnime({ query: query, page: page });
  }

  async getDetail(url) {
    function statusCode(status) {
      return (
        {
          RELEASING: 0,
          FINISHED: 1,
          NOT_YET_RELEASED: 4,
        }[status] ?? 5
      );
    }

    if (url.includes("/anime/")) url = url.split("/anime/")[1];
    var id = url;

    var baseUrl = this.getBaseUrl();
    var link = baseUrl + "/anime/" + id;

    var infoSlug = "/info/" + id;
    var body = await this.request(infoSlug);

    var titlePref = this.getPreference("animetsu_title_lang");
    var romajiTitle = body.title.romaji;
    var prefTitle = body.title[titlePref];

    var name = prefTitle != null ? prefTitle : romajiTitle;
    var imageUrl = body.cover_image.medium;
    var description = body.description;
    var status = statusCode(body.status);
    var genre = body.genres;
    var format = body.format;

    var chapters = [];
    var epSlug = "/eps/" + id;
    var epData = await this.request(epSlug);

    var epThumbPref = this.getPreference("animetsu_pref_ep_thumbnail");
    var epDescPref = this.getPreference("animetsu_pref_ep_description");
    epData.forEach((item) => {
      var ep_num = item.ep_num;
      var ep_title = item.name;
      var epName = format == "MOVIE" ? ep_title : `E${ep_num} : ${ep_title}`;
      var isFiller = item.is_filler;
      var token = `${id}/${ep_num}`;

      var thumbnailUrl = (epThumbPref !== false) && item.img ? this.getProxyMediaUrl(item.img) : null;
      var epDescription = (epDescPref !== false) ? item.desc : null;
      var dateUpload = item.hasOwnProperty("aired_at")
        ? new Date(item.aired_at).valueOf().toString()
        : null;

      chapters.push({
        name: epName,
        url: token,
        isFiller,
        thumbnailUrl,
        description: epDescription,
        dateUpload: dateUpload,
      });
    });

    chapters.reverse();
    return { name, imageUrl, link, description, genre, status, chapters };
  }

  async getVideoList(url) {
    var serverPref = this.getPreference("animetsu_pref_stream_server");
    if (!serverPref || serverPref.length < 1) serverPref = ["pahe", "kite"];

    var audioPref = this.getPreference("animetsu_pref_stream_subdub_type");
    if (!audioPref || audioPref.length < 1) audioPref = ["sub"];

    var combinations = [];
    for (var serverName of serverPref) {
      for (var audioType of audioPref) {
        combinations.push({ serverName, audioType });
      }
    }

    var dlPref = this.getPreference("animetsu_pref_dl_links");

    var streamPromise = Promise.all(
      combinations.map(async ({ serverName, audioType }) => {
        try {
          var epSlug = `/oppai/${url}?server=${serverName}&source_type=${audioType}`;
          var epData = await this.request(epSlug);

          if (!epData.hasOwnProperty("sources")) return [];

          var skips = (this.getPreference("animetsu_pref_skip_timestamps") !== false) && epData.skips
            ? epData.skips
            : null;

          if (serverName == "pahe" || serverName == "meg") {
            return this.getPaheMegStreams(epData.sources, audioType, serverName, skips);
          } else if (serverName == "kite") {
            return await this.getKiteStreams(epData, audioType, skips);
          }
          return [];
        } catch (e) {
          return [];
        }
      })
    );

    // Sort: Pahe first (reliable, works for streaming + download), then Kite,
    // then kwik direct MP4, then Meg. Within each server, higher resolution first.
    function dlFirst(a, b) {
      function serverScore(s) {
        const q = (s.quality || "").toUpperCase();
        if (q.includes(": PAHE")) return 40;  // Pahe — most reliable
        if (q.includes(": KITE")) return 30;  // Kite — unencrypted HLS
        if (s._kwikDl)           return 20;  // kwik direct MP4
        if (s._megDl)            return 10;  // Meg — loads slowly
        return 0;
      }
      function resScore(s) {
        const q = (s.quality || "").toUpperCase();
        if (q.includes("2160") || q.includes("4K"))  return 4;
        if (q.includes("1920") || q.includes("1080")) return 3;
        if (q.includes("1280") || q.includes("720"))  return 2;
        if (q.includes("480"))                        return 1;
        return 0;
      }
      return (serverScore(b) + resScore(b)) - (serverScore(a) + resScore(a));
    }

    if (dlPref === false) {
      var results = await streamPromise;
      return results.flat().sort(dlFirst);
    }

    var [streamResults, dlStreams] = await Promise.all([
      streamPromise,
      this.getDownloadStreams(url),
    ]);

    return [...streamResults.flat(), ...dlStreams].sort(dlFirst);
  }

  streamNamer(res, dubType, serverName) {
    return `${res.toUpperCase()} - ${dubType.toUpperCase()} : ${serverName.toUpperCase()}`;
  }

  getPaheMegStreams(epData, audioType, serverName, skips) {
    var hdr = this.getHeaders();
    var skipAttrs = skips ? {
      introStart: skips.intro?.start,
      introEnd:   skips.intro?.end,
      outroStart: skips.outro?.start,
      outroEnd:   skips.outro?.end,
    } : {};
    var streams = [];

    epData.forEach((item) => {
      var quality = item.quality;
      var link = this.getProxyMediaUrl(item.url);

      if (serverName === "meg") {
        // meg serves a direct MP4 via swiftstream proxy.
        //
        // Mangayomi's download_provider.dart checks `originalUrl` to classify
        // the stream (isMediaVideo → .mp4 path), but uses `url` for the actual
        // download/playback request. These are DIFFERENT fields.
        //
        // Problem: swiftstream returns 500 for TOKEN.mp4 (with or without Range)
        // but 206 for plain TOKEN + Range: bytes=0-. So we cannot use the .mp4
        // URL as the real download URL.
        //
        // Fix: set originalUrl to a fake .mp4 path (passes isMediaVideo() check
        // → Mangayomi routes to direct-streaming download path), while url stays
        // as the real plain token URL that actually serves 206 MP4 content.
        var megHdr = Object.assign({}, hdr, { "Range": "bytes=0-" });
        streams.push(Object.assign({
          url: link,                  // real URL — plain token, Range → 206 MP4
          originalUrl: link + ".mp4", // fake suffix — tricks isMediaVideo() = true
          quality: this.streamNamer(quality + " [DL]", audioType, serverName),
          headers: megHdr,
          _megDl: true,
        }, skipAttrs));
      } else {
        // pahe = AES-128 encrypted HLS.
        // Setting originalUrl with .m3u8 extension tells Mangayomi's download manager
        // to use HLS segment download mode (fetch playlist → download each segment)
        // instead of saving the raw playlist text as a "file".
        streams.push(Object.assign({
          url: link,
          originalUrl: link + ".m3u8",
          quality: this.streamNamer(quality, audioType, serverName),
          headers: hdr,
        }, skipAttrs));
      }
    });

    return streams;
  }

  async getKiteStreams(epData, audioType, skips) {
    var hdr = this.getHeaders();
    var skipAttrs = skips ? {
      introStart: skips.intro?.start,
      introEnd:   skips.intro?.end,
      outroStart: skips.outro?.start,
      outroEnd:   skips.outro?.end,
    } : {};
    var streams = [];

    var subtitles = [];
    if (epData.hasOwnProperty("subs")) {
      epData.subs.forEach((item) => {
        subtitles.push({ file: item.url, label: item.lang, headers: hdr });
      });
    }

    for (var item of epData.sources) {
      var masterUrl = this.getProxyMediaUrl(item.url);
      var baseDir = masterUrl.substring(0, masterUrl.lastIndexOf("/") + 1);
      var parsed = false;

      try {
        var res = await this.client.get(masterUrl, hdr);
        if (res.statusCode == 200) {
          var lines = res.body.split("\n");
          for (var i = 0; i < lines.length; i++) {
            if (lines[i].startsWith("#EXT-X-STREAM-INF:")) {
              var resMatch = lines[i].match(/RESOLUTION=(\d+x\d+)/);
              var resolution = resMatch ? resMatch[1] : "Auto";
              var nextLine = lines[i + 1] ? lines[i + 1].trim() : "";
              if (!nextLine) continue;
              var variantUrl = nextLine.startsWith("http") ? nextLine : baseDir + nextLine;
              var stream = Object.assign({
                url: variantUrl,
                // .m3u8 suffix tells Mangayomi's downloader this is HLS —
                // it will fetch the playlist then download each segment token,
                // rather than saving the raw playlist text as the "file".
                originalUrl: variantUrl + ".m3u8",
                quality: this.streamNamer(resolution + " [DL]", "soft" + audioType, "kite"),
                headers: hdr,
              }, skipAttrs);
              if (!parsed) {
                stream.subtitles = subtitles;
                parsed = true;
              }
              streams.push(stream);
            }
          }
        }
      } catch (e) {}

      if (!parsed) {
        streams.push(Object.assign({
          url: masterUrl,
          originalUrl: masterUrl + ".m3u8",
          quality: this.streamNamer("Auto [DL]", "soft" + audioType, "kite"),
          headers: hdr,
          subtitles: subtitles,
        }, skipAttrs));
      }
    }

    return streams;
  }

  // Resolve a pahe.win shortlink → direct MP4 CDN URL via kwik.cx.
  // owocdn.top (the final CDN) is Cloudflare-protected; this chain only works
  // when Mangayomi's HTTP client already holds a valid kwik.cx CF session.
  async resolveKwikDownload(paheWinUrl) {
    try {
      var ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

      // Step 1: pahe.win embeds the kwik URL in JS before the CF countdown resolves.
      var paheRes = await this.client.get(paheWinUrl, {
        "User-Agent": ua, "Referer": "https://animetsu.bz/",
      });
      var paheBody = paheRes.body || "";
      var kwikMatch = paheBody.match(/["'](https?:\/\/kwik\.[a-z]{2,3}\/[ef]\/[A-Za-z0-9]+)["']/);
      if (!kwikMatch) return null;
      var kwikFileUrl = kwikMatch[1].replace("/e/", "/f/");

      // Step 2: GET kwik.cx/f/{hash} — plain form, no packer obfuscation.
      var kwikRes = await this.client.get(kwikFileUrl, {
        "User-Agent": ua, "Referer": paheWinUrl,
      });
      var kwikBody = kwikRes.body || "";
      if (kwikBody.length < 100) return null;

      var tokenMatch = kwikBody.match(/name=["']_token["'][^>]*value=["']([^"']+)["']/)
                    || kwikBody.match(/value=["']([^"']{20,})["'][^>]*name=["']_token["']/);
      if (!tokenMatch) return null;
      var actionMatch = kwikBody.match(/action=["'](https?:\/\/kwik\.[^"']+\/d\/[^"']+)["']/);
      if (!actionMatch) return null;
      var dlAction = actionMatch[1];

      // Step 3: POST → 302 redirect to vault-*.owocdn.top MP4 CDN URL.
      var postRes = await this.client.post(
        dlAction,
        { "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": ua, "Referer": kwikFileUrl, "Origin": "https://kwik.cx" },
        "_token=" + encodeURIComponent(tokenMatch[1])
      );

      // Case 1: Location header (redirect not auto-followed)
      if (postRes.headers) {
        var loc = postRes.headers["location"] || postRes.headers["Location"];
        if (loc && loc.startsWith("http")) return loc;
      }
      // Case 2: redirect was followed, final URL in .url
      if (postRes.url && postRes.url !== dlAction && /\.(mp4|webm|mkv)/i.test(postRes.url)) {
        return postRes.url;
      }
      // Case 3: body contains CDN URL
      if (postRes.body && typeof postRes.body === "string") {
        var hrefM = postRes.body.match(/href=["'](https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)["']/i);
        if (hrefM) return hrefM[1];
        var rawM = postRes.body.match(/https?:\/\/[a-z0-9-]+\.[a-z0-9.-]+\/[^\s"'<>]+\.mp4[^\s"'<>]*/i);
        if (rawM) return rawM[0];
      }
      return null;
    } catch (e) { return null; }
  }

  // Resolve the kwik.cx → owocdn.top chain to get direct BD MP4 download links.
  // These are the highest-quality offline-playable files available.
  // _kwikDl:true gives them sort score 2 (above kite [DL] score 1) so Mangayomi
  // picks them first for downloads.
  // Silently returns [] on any failure — kite [DL] acts as automatic fallback.
  async getDownloadStreams(url) {
    var ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    var results = [];

    try {
      var dlData = await this.request("/dl/" + url);
      if (!Array.isArray(dlData) || dlData.length === 0) return results;

      var kwikStreams = await Promise.all(dlData.map(async (item) => {
        try {
          if (!item.link) return null;
          var directUrl = await this.resolveKwikDownload(item.link);
          if (!directUrl) return null;
          return {
            url: directUrl,
            originalUrl: directUrl,
            // "[DL]" so Mangayomi recognises it as downloadable.
            // _kwikDl sorts it above kite [DL] streams (score 2 vs 1).
            quality: (item.name || "Download") + " [DL]",
            headers: { "User-Agent": ua, "Referer": "https://kwik.cx/" },
            _kwikDl: true,
          };
        } catch (e) { return null; }
      }));
      results.push(...kwikStreams.filter(Boolean));
    } catch (e) {}

    return results;
  }

  getFilterList() {
    throw new Error("getFilterList not implemented");
  }

  getSourcePreferences() {
    return [
      {
        key: "animetsu_base_url",
        editTextPreference: {
          title: "Override base url",
          summary: "",
          value: "https://animetsu.bz",
          dialogTitle: "Override base url",
          dialogMessage: "",
        },
      },
      {
        key: "animetsu_title_lang",
        listPreference: {
          title: "Preferred title language",
          summary: "Choose in which language anime title should be shown",
          valueIndex: 0,
          entries: ["English", "Romaji", "Native"],
          entryValues: ["english", "romaji", "native"],
        },
      },
      {
        key: "animetsu_pref_ep_thumbnail",
        switchPreferenceCompat: {
          title: "Episode thumbail",
          summary: "",
          value: true,
        },
      },
      {
        key: "animetsu_pref_ep_description",
        switchPreferenceCompat: {
          title: "Episode description",
          summary: "",
          value: true,
        },
      },
      {
        key: "animetsu_pref_skip_timestamps",
        switchPreferenceCompat: {
          title: "Include intro/outro skip timestamps",
          summary: "Pass intro and outro timestamps to Mangayomi's skip button. Requires 'Enable AniSkip' to be on in Mangayomi player settings.",
          value: true,
        },
      },
      {
        key: "animetsu_pref_dl_links",
        switchPreferenceCompat: {
          title: "Fetch direct download links",
          summary: "Resolve kwik.cx → direct BD MP4 URLs for offline-playable downloads. On by default — disable only if episode loading becomes slow.",
          value: true,
        },
      },
      {
        key: "animetsu_pref_stream_server",
        multiSelectListPreference: {
          title: "Preferred server",
          summary: "Choose the server/s you want to extract streams from",
          values: ["pahe", "kite"],
          entries: ["Pahe", "Kite", "Meg"],
          entryValues: ["pahe", "kite", "meg"],
        },
      },
      {
        key: "animetsu_pref_stream_subdub_type",
        multiSelectListPreference: {
          title: "Preferred stream sub/dub type",
          summary: "",
          values: ["sub", "dub"],
          entries: ["Sub", "Dub"],
          entryValues: ["sub", "dub"],
        },
      },
    ];
  }
}
