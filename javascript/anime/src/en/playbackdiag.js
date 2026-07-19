const mangayomiSources = [
  {
    "name": "Playback Diagnostic",
    "id": 918273645,
    "lang": "en",
    "baseUrl": "https://example.invalid",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://apple.com",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.0.1",
    "pkgPath": "anime/src/en/playbackdiag.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": false,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/playbackdiag.js",
    "dateFormat": "",
    "dateFormatLocale": "",
    "additionalParams": "",
    "sourceCodeLanguage": 1,
    "notes": "Diagnostic only — plays reference streams from Apple/Blender to isolate player bugs from provider breakage. Not a real anime source.",
  },
];

// Diagnostic extension. Not a content source.
//
// Purpose: every failing extension on this repo is HLS, and the one that works
// (AnimeHeaven) is progressive MP4. That correlation has two mutually exclusive
// explanations which cannot be told apart from the provider side:
//
//   (a) Mangayomi's Windows player cannot handle HLS, or
//   (b) each HLS provider independently serves broken playlists.
//
// This extension removes the providers from the equation entirely. It makes no
// network requests to browse or resolve — the browse list, detail page and
// episode list are hardcoded, and getVideoList returns reference streams that
// are known-good and vendor-maintained (Apple's HLS conformance streams,
// Blender's Big Buck Bunny MP4). If these play, HLS on Windows is fine and the
// providers are rotten. If the MP4 plays and the HLS entries do not, the player
// is at fault and no extension change can fix it.
//
// Each episode isolates one variable; see EPISODES below.
class DefaultExtension extends MProvider {
  // Ordered so the diagnosis narrows as you go down the list. Every entry is a
  // separate episode so each can be launched and judged independently.
  get EPISODES() {
    return [
      {
        key: "mp4",
        name: "1. MP4 progressive (control)",
        // Matches AnimeHeaven's shape. Expected to play. If this fails, the
        // problem is broader than HLS and nothing below will be informative.
        sources: [{
          url: "https://download.blender.org/peach/bigbuckbunny_movies/BigBuckBunny_320x180.mp4",
          quality: "MP4 — Blender (Big Buck Bunny)",
        }],
      },
      {
        key: "hls-flat",
        name: "2. HLS media playlist, TS segments",
        // Simplest possible HLS: no master, one rendition, plain MPEG-TS. If
        // HLS works at all, it works here.
        sources: [{
          url: "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/gear1/prog_index.m3u8",
          quality: "HLS flat — Apple bipbop gear1",
        }],
      },
      {
        key: "hls-master",
        name: "3. HLS master playlist, TS segments",
        // Adds variant selection on top of #2. Isolates master-playlist parsing
        // as a distinct failure point from segment decoding.
        sources: [{
          url: "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8",
          quality: "HLS master — Apple bipbop",
        }],
      },
      {
        key: "hls-fmp4",
        name: "4. HLS master, fMP4 segments",
        // Fragmented MP4 rather than TS. Some builds handle one container and
        // not the other, so a split between #3 and #4 is itself diagnostic.
        sources: [{
          url: "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8",
          quality: "HLS fMP4 — Apple advanced",
        }],
      },
      {
        key: "hls-thirdparty",
        name: "5. HLS master, non-Apple CDN",
        // Rules out anything specific to Apple's CDN (routing, TLS, headers).
        sources: [{
          url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
          quality: "HLS master — Mux test-streams",
        }],
      },
      {
        key: "hls-hdr",
        name: "6. HLS + custom headers",
        // Same stream as #2, but returned with a headers map. The repo's real
        // extensions all attach Referer/Origin; if headers are mishandled on
        // Windows this fails while #2 passes, which no other pair reveals.
        sources: [{
          url: "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/gear1/prog_index.m3u8",
          quality: "HLS flat + headers",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
            "Referer": "https://devstreaming-cdn.apple.com/",
          },
        }],
      },
    ];
  }

  get supportsLatest() {
    return false;
  }

  // The single fake entry every browse tab returns. Hardcoded so that a network
  // or parsing failure can never be confused with a playback failure.
  get ENTRY() {
    return {
      name: "▶ Playback Diagnostic (6 reference streams)",
      link: "diag",
      imageUrl: "https://www.google.com/s2/favicons?sz=256&domain=https://apple.com",
    };
  }

  async getPopular(page) {
    return { list: [this.ENTRY], hasNextPage: false };
  }

  async getLatestUpdates(page) {
    return { list: [this.ENTRY], hasNextPage: false };
  }

  async search(query, page, filters) {
    return { list: [this.ENTRY], hasNextPage: false };
  }

  async getDetail(url) {
    var eps = this.EPISODES;
    var chapters = [];
    // Mangayomi lists most-recent-first, so reverse to keep "1." at the top.
    for (var i = eps.length - 1; i >= 0; i--) {
      chapters.push({ name: eps[i].name, url: eps[i].key });
    }
    return {
      name: "Playback Diagnostic",
      imageUrl: this.ENTRY.imageUrl,
      description:
        "Reference streams for isolating a player problem from a provider problem.\n\n" +
        "Play each episode in order and note which ones show real video.\n\n" +
        "• All 6 play → HLS on this device is fine; the broken extensions are broken at the provider.\n" +
        "• Only #1 (MP4) plays → the player cannot handle HLS. Not fixable in extension code.\n" +
        "• #2 plays but #3 fails → master-playlist parsing is the fault.\n" +
        "• #3 plays but #4 fails → fMP4 segment support is the fault.\n" +
        "• #2 plays but #6 fails → custom request headers are mishandled.\n\n" +
        "Sources: Apple HLS examples, Mux test-streams, Blender. No anime content.",
      genre: ["Diagnostic"],
      status: 1,
      link: "diag",
      chapters: chapters,
    };
  }

  async getVideoList(url) {
    var eps = this.EPISODES;
    for (var i = 0; i < eps.length; i++) {
      if (eps[i].key !== url) continue;
      var out = [];
      for (var s = 0; s < eps[i].sources.length; s++) {
        var src = eps[i].sources[s];
        out.push({
          url: src.url,
          originalUrl: src.url,
          quality: src.quality,
          // Only entry #6 carries headers — the rest deliberately send none so
          // that header handling is the single variable between #2 and #6.
          headers: src.headers || {},
          subtitles: [],
        });
      }
      return out;
    }
    return [];
  }

  getFilterList() {
    return [];
  }

  getSourcePreferences() {
    return [];
  }
}
