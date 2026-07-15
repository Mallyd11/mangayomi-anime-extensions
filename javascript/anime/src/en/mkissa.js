const mangayomiSources = [
  {
    "name": "MKissa",
    "id": 951847623,
    "lang": "en",
    "baseUrl": "https://mkissa.to",
    "apiUrl": "https://api.mkissa.net/api",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://mkissa.to",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.1.1",
    "pkgPath": "anime/src/en/mkissa.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": false,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/mkissa.js",
    "dateFormat": "",
    "dateFormatLocale": "",
    "additionalParams": "",
    "sourceCodeLanguage": 1,
    "notes": "",
  },
];

// mkissa.to's frontend is a pure client-side SvelteKit app; every page (search,
// details, episodes, streams) is fetched from api.mkissa.net as an Apollo-style
// persisted GraphQL query over GET. Responses are usually wrapped as
// {"data":{"_m":"b7","tobeparsed":"<base64>"}} — AES-256-GCM ciphertext with a
// STATIC key (verified stable across shows/episodes/sessions): key =
// SHA-256("Xot36i3lK3:v" + version), where "Xot36i3lK3" is a literal constant
// baked into the site's JS bundle (obfuscated as char codes, not derived from
// anything request-specific). Layout of the decoded "tobeparsed" bytes:
//   [0]        version byte (currently always 1)
//   [1..13)    12-byte AES-GCM IV
//   [13..-16)  ciphertext
//   [-16:]     16-byte GCM auth tag
// Mangayomi's QuickJS runtime has no crypto.subtle/WebAssembly, so AES-256 is
// reimplemented in pure JS below (GCM used purely as CTR-mode keystream —
// starting counter = IV || 0x00000002 — the auth tag is not re-verified since
// we trust our own request). Validated byte-for-byte against crypto.subtle in
// a real browser.
//
// Video sourceUrls come back either as a direct embed URL, or (for the site's
// AllAnime-native mirrors) as "--<hex>" where hex-decoded-then-XOR-56'd bytes
// yield a relative "/apivtwo/clock?id=..." path — AllAnime's well-known clock
// endpoint (https://api.allanime.day) that resolves to real HLS/MP4 links.
// Only those AllAnime-native sources are resolved here; the other embeds
// (Filemoon/bysekoze, OK.ru, Vidnest, MP4Upload) each need their own bespoke
// extractor that hasn't been implemented yet, so they're skipped.

var AA_SBOX = [
  0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
  0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
  0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
  0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
  0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
  0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
  0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
  0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
  0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
  0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
  0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
  0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
  0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
  0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
  0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
  0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16,
];
var AA_RCON = [0x00,0x01,0x02,0x04,0x08,0x10,0x20,0x40];
// SHA-256("Xot36i3lK3:v1") — static per-deployment secret pinned into the JS
// bundle; only changes if mkissa ships a new build. Precomputed so the
// extension never needs a SHA-256 implementation at runtime.
var AA_KEY_V1 = [162,84,170,39,196,16,242,151,189,4,186,51,160,192,223,127,244,231,6,191,58,226,114,113,198,112,63,132,231,80,245,82];

class DefaultExtension extends MProvider {
  get ua() {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
  }

  get headers() {
    return { "User-Agent": this.ua, "Accept": "application/json", "Referer": this.source.baseUrl + "/" };
  }

  // ── base64 → byte array (atob() is not available in Mangayomi's QuickJS runtime) ──
  b64ToBytes(s) {
    var t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    s = s.replace(/[^A-Za-z0-9+/]/g, "");
    var out = [], i = 0;
    while (i < s.length) {
      var a = t.indexOf(s[i++]), b = t.indexOf(s[i++]);
      var c = t.indexOf(s[i++]), d = t.indexOf(s[i++]);
      if (a < 0 || b < 0) break;
      out.push((a << 2) | (b >> 4));
      if (c >= 0) out.push(((b & 15) << 4) | (c >> 2));
      if (d >= 0) out.push(((c & 3) << 6) | d);
    }
    return out;
  }

  // ── pure-JS AES-256 (encrypt primitive only, used to drive GCM's CTR keystream) ──
  aesKeyExpansion256(key) {
    var Nk = 8, Nr = 14, Nb = 4;
    var w = [];
    for (var i = 0; i < Nk; i++) w.push([key[4*i], key[4*i+1], key[4*i+2], key[4*i+3]]);
    for (var i = Nk; i < Nb*(Nr+1); i++) {
      var temp = w[i-1].slice();
      if (i % Nk === 0) {
        temp = [temp[1], temp[2], temp[3], temp[0]];
        temp = [AA_SBOX[temp[0]], AA_SBOX[temp[1]], AA_SBOX[temp[2]], AA_SBOX[temp[3]]];
        temp[0] ^= AA_RCON[i / Nk];
      } else if (i % Nk === 4) {
        temp = [AA_SBOX[temp[0]], AA_SBOX[temp[1]], AA_SBOX[temp[2]], AA_SBOX[temp[3]]];
      }
      var prev = w[i-Nk];
      w.push([prev[0]^temp[0], prev[1]^temp[1], prev[2]^temp[2], prev[3]^temp[3]]);
    }
    return w;
  }

  gmul(a, b) {
    var p = 0;
    for (var i = 0; i < 8; i++) {
      if (b & 1) p ^= a;
      var hi = a & 0x80;
      a = (a << 1) & 0xff;
      if (hi) a ^= 0x1b;
      b >>= 1;
    }
    return p;
  }

  aesEncryptBlock256(inBytes, w) {
    var self = this;
    var Nr = 14;
    var state = [];
    for (var c = 0; c < 4; c++) state.push([inBytes[4*c], inBytes[4*c+1], inBytes[4*c+2], inBytes[4*c+3]]);
    function addRoundKey(round) {
      for (var c = 0; c < 4; c++) { var word = w[round*4+c]; for (var r = 0; r < 4; r++) state[c][r] ^= word[r]; }
    }
    function subBytes() { for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) state[c][r] = AA_SBOX[state[c][r]]; }
    function shiftRows() {
      for (var r = 1; r < 4; r++) {
        var tmp = [];
        for (var c = 0; c < 4; c++) tmp.push(state[(c+r)%4][r]);
        for (var c = 0; c < 4; c++) state[c][r] = tmp[c];
      }
    }
    function mixColumns() {
      for (var c = 0; c < 4; c++) {
        var a0 = state[c][0], a1 = state[c][1], a2 = state[c][2], a3 = state[c][3];
        state[c][0] = self.gmul(a0,2) ^ self.gmul(a1,3) ^ a2 ^ a3;
        state[c][1] = a0 ^ self.gmul(a1,2) ^ self.gmul(a2,3) ^ a3;
        state[c][2] = a0 ^ a1 ^ self.gmul(a2,2) ^ self.gmul(a3,3);
        state[c][3] = self.gmul(a0,3) ^ a1 ^ a2 ^ self.gmul(a3,2);
      }
    }
    addRoundKey(0);
    for (var round = 1; round < Nr; round++) { subBytes(); shiftRows(); mixColumns(); addRoundKey(round); }
    subBytes(); shiftRows(); addRoundKey(Nr);
    var out = new Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) out[4*c+r] = state[c][r];
    return out;
  }

  // GCM data keystream starts at IV || 0x00000002 (0x00000001 is reserved for the tag)
  aesGcmDecrypt(keyBytes, ivBytes, ciphertextAndTag) {
    var ciphertext = ciphertextAndTag.slice(0, ciphertextAndTag.length - 16);
    var w = this.aesKeyExpansion256(keyBytes);
    var counter = ivBytes.concat([0, 0, 0, 2]);
    var out = new Array(ciphertext.length);
    var pos = 0;
    while (pos < ciphertext.length) {
      var ks = this.aesEncryptBlock256(counter, w);
      var n = Math.min(16, ciphertext.length - pos);
      for (var i = 0; i < n; i++) out[pos + i] = ciphertext[pos + i] ^ ks[i];
      pos += n;
      for (var b = 15; b >= 12; b--) { counter[b] = (counter[b] + 1) & 0xff; if (counter[b] !== 0) break; }
    }
    var bytesToStr = "";
    for (var j = 0; j < out.length; j++) bytesToStr += "%" + (out[j] < 16 ? "0" : "") + out[j].toString(16);
    return decodeURIComponent(bytesToStr);
  }

  // Unwraps mkissa's AES-256-GCM response envelope, if present.
  decryptEnvelope(body) {
    var json = JSON.parse(body);
    if (!json.data || typeof json.data.tobeparsed !== "string") return json.data || null;
    var bytes = this.b64ToBytes(json.data.tobeparsed);
    var version = bytes[0];
    var iv = bytes.slice(1, 13);
    var ctAndTag = bytes.slice(13);
    var keyBytes = version === 1 ? AA_KEY_V1 : AA_KEY_V1;
    var plaintext = this.aesGcmDecrypt(keyBytes, iv, ctAndTag);
    return JSON.parse(plaintext).data;
  }

  // ── AllAnime-style "--<hex>" source obfuscation (XOR 0x38 per byte) ──
  decodeSourceUrl(url) {
    if (!url || url.indexOf("--") !== 0) return url;
    var hex = url.slice(2);
    var out = "";
    for (var i = 0; i < hex.length; i += 2) {
      out += String.fromCharCode(parseInt(hex.substr(i, 2), 16) ^ 0x38);
    }
    return out;
  }

  async gql(sha256Hash, variables) {
    var url = this.source.apiUrl +
      "?variables=" + encodeURIComponent(JSON.stringify(variables)) +
      "&extensions=" + encodeURIComponent(JSON.stringify({ persistedQuery: { version: 1, sha256Hash: sha256Hash } }));
    var res = await new Client().get(url, this.headers);
    return this.decryptEnvelope(res.body);
  }

  // ── Listings ──────────────────────────────────────────────────────────────

  get supportsLatest() { return true; }

  showTitle(s) { return s.englishName || s.name || s.nativeName || ""; }

  parseShowList(edges) {
    var list = [];
    for (var i = 0; i < (edges || []).length; i++) {
      var s = edges[i];
      var epHint = (s.lastEpisodeInfo && (s.lastEpisodeInfo.sub && s.lastEpisodeInfo.sub.episodeString)) ||
        (s.lastEpisodeInfo && (s.lastEpisodeInfo.dub && s.lastEpisodeInfo.dub.episodeString)) || "1";
      list.push({ name: this.showTitle(s), link: s._id + "|" + epHint, imageUrl: s.thumbnail || "" });
    }
    return list;
  }

  async getPopular(page) {
    try {
      var data = await this.gql("a24c500a1b765c68ae1d8dd85174931f661c71369c89b92b88b75a725afc471c",
        { search: { query: "" }, limit: 26, page: page, translationType: "sub" });
      var shows = (data && data.shows) || {};
      var total = (shows.pageInfo && shows.pageInfo.total) || 0;
      return { list: this.parseShowList(shows.edges), hasNextPage: page * 26 < total };
    } catch (e) { return { list: [], hasNextPage: false }; }
  }

  async getLatestUpdates(page) {
    try {
      var data = await this.gql("a24c500a1b765c68ae1d8dd85174931f661c71369c89b92b88b75a725afc471c",
        { search: { query: "", sortBy: "Recent" }, limit: 26, page: page, translationType: "sub" });
      var shows = (data && data.shows) || {};
      var total = (shows.pageInfo && shows.pageInfo.total) || 0;
      return { list: this.parseShowList(shows.edges), hasNextPage: page * 26 < total };
    } catch (e) { return { list: [], hasNextPage: false }; }
  }

  async search(query, page, filters) {
    try {
      var data = await this.gql("a24c500a1b765c68ae1d8dd85174931f661c71369c89b92b88b75a725afc471c",
        { search: { query: query || "" }, limit: 26, page: page, translationType: "sub" });
      var shows = (data && data.shows) || {};
      var total = (shows.pageInfo && shows.pageInfo.total) || 0;
      return { list: this.parseShowList(shows.edges), hasNextPage: page * 26 < total };
    } catch (e) { return { list: [], hasNextPage: false }; }
  }

  // ── Detail ────────────────────────────────────────────────────────────────

  // Show metadata is only returned nested inside a valid episode query — there is
  // no standalone "show(id)" lookup here — so fetch a single known-good episode
  // (the hint carried on the list entry, falling back to "1") to get both.
  async fetchShow(showId, epHint) {
    var attempts = [["sub", epHint], ["dub", epHint], ["sub", "1"], ["dub", "1"]];
    for (var i = 0; i < attempts.length; i++) {
      try {
        var data = await this.gql("d405d0edd690624b66baba3068e0edc3ac90f1597d898a1ec8db4e5c43c00fec",
          { showId: showId, translationType: attempts[i][0], episodeString: attempts[i][1] });
        if (data && data.episode && data.episode.show) return data.episode.show;
      } catch (e) {}
    }
    return null;
  }

  statusCode(show) {
    var subCount = (show.availableEpisodes && show.availableEpisodes.sub) || 0;
    if (show.episodeCount && subCount >= show.episodeCount) return 1; // finished
    if (show.broadcastInterval) return 0; // releasing
    return 5; // unknown
  }

  // Accepts the list-item format ("showId|epHint") or the canonical detail
  // link this extension itself returns ("{baseUrl}/anime/{showId}") — Mangayomi
  // re-calls getDetail with the stored canonical link once an anime is in the
  // library, not just the original list link.
  async getDetail(url) {
    var raw = url;
    var base = this.source.baseUrl + "/anime/";
    if (raw.indexOf(base) === 0) raw = raw.slice(base.length);
    var pipe = raw.indexOf("|");
    var showId = pipe >= 0 ? raw.substring(0, pipe) : raw;
    var epHint = pipe >= 0 ? raw.substring(pipe + 1) : "1";
    var slash = showId.indexOf("/");
    if (slash >= 0) showId = showId.substring(0, slash);

    var show = await this.fetchShow(showId, epHint);
    if (!show) throw new Error("MKissa: could not load show " + showId);

    var epSet = {};
    var subEps = (show.availableEpisodesDetail && show.availableEpisodesDetail.sub) || [];
    var dubEps = (show.availableEpisodesDetail && show.availableEpisodesDetail.dub) || [];
    for (var i = 0; i < subEps.length; i++) epSet[subEps[i]] = true;
    for (var j = 0; j < dubEps.length; j++) epSet[dubEps[j]] = true;

    var chapters = [];
    var epNums = Object.keys(epSet).sort(function(a, b) { return (parseFloat(a) || 0) - (parseFloat(b) || 0); });
    for (var k = 0; k < epNums.length; k++) {
      chapters.push({ name: "Episode " + epNums[k], url: showId + "||" + epNums[k] });
    }

    return {
      name: this.showTitle(show),
      imageUrl: show.thumbnail || show.banner || "",
      description: (show.description || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "").trim(),
      genre: [],
      status: this.statusCode(show),
      link: this.source.baseUrl + "/anime/" + showId,
      chapters: chapters.reverse(),
    };
  }

  // ── Video sources ─────────────────────────────────────────────────────────

  async resolveClockSource(relativePath, sourceName, type) {
    var out = [];
    try {
      var clockHeaders = { "User-Agent": this.ua, "Referer": "https://allanime.day/" };
      var res = await new Client().get("https://api.allanime.day" + relativePath, clockHeaders);
      var json = JSON.parse(res.body);
      var links = json.links || [];
      for (var i = 0; i < links.length; i++) {
        var l = links[i];
        if (!l.link) continue;
        var subtitles = (l.subtitles || []).filter(function(t) { return t && t.src; })
          .map(function(t) { return { url: t.src, label: t.lang || "Unknown" }; });
        out.push({
          url: l.link,
          originalUrl: l.link,
          quality: sourceName + " " + type.toUpperCase() + " [" + (l.resolutionStr || "auto") + "]",
          headers: l.headers && Object.keys(l.headers).length ? l.headers : clockHeaders,
          subtitles: subtitles,
        });
      }
    } catch (e) {}
    return out;
  }

  async fetchStreamsFor(showId, epNum, type) {
    var out = [];
    try {
      var data = await this.gql("d405d0edd690624b66baba3068e0edc3ac90f1597d898a1ec8db4e5c43c00fec",
        { showId: showId, translationType: type, episodeString: epNum });
      var episode = data && data.episode;
      if (!episode || !episode.sourceUrls) return out;

      for (var i = 0; i < episode.sourceUrls.length; i++) {
        var s = episode.sourceUrls[i];
        var decoded = this.decodeSourceUrl(s.sourceUrl);
        if (!decoded || decoded.indexOf("/") !== 0) continue; // only AllAnime-native (clock) sources are resolved
        var streams = await this.resolveClockSource(decoded, s.sourceName || "Server", type);
        out = out.concat(streams);
      }
    } catch (e) {}
    return out;
  }

  async getVideoList(url) {
    var parts = url.split("||");
    var showId = parts[0];
    var epNum = parts[1];

    var pref = "sub";
    try { pref = new SharedPreferences().get("mkissa_pref_audio") || "sub"; } catch (e) {}

    var results = await Promise.all([
      this.fetchStreamsFor(showId, epNum, "sub"),
      this.fetchStreamsFor(showId, epNum, "dub"),
    ]);
    var subVideos = results[0], dubVideos = results[1];

    return pref === "dub" ? dubVideos.concat(subVideos) : subVideos.concat(dubVideos);
  }

  // ── Preferences ───────────────────────────────────────────────────────────

  getFilterList() { return []; }

  getSourcePreferences() {
    return [
      {
        key: "mkissa_pref_audio",
        listPreference: {
          title: "Preferred language",
          summary: "Primary audio track to list first. Only AllAnime-native mirror sources (labelled e.g. \"Luf-Mp4\"/\"Ak\") are resolved to playable streams; other embeds (Filemoon, OK.ru, Vidnest, MP4Upload) are not yet supported.",
          valueIndex: 0,
          entries: ["Sub first, Dub fallback", "Dub first, Sub fallback"],
          entryValues: ["sub", "dub"],
        },
      },
    ];
  }
}
