const mangayomiSources = [
  {
    "name": "MangaFire",
    "id": 2301122562,
    "lang": "en",
    "baseUrl": "https://mangafire.to",
    "apiUrl": "",
    "iconUrl":
      "https://www.google.com/s2/favicons?sz=64&domain=https://mangafire.to/",
    "typeSource": "single",
    "isManga": true,
    "itemType": 0,
    "hasCloudflare": false,
    "version": "0.2.0",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "manga/src/en/mangafire.js",
  },
];

// Author: Mallyd11
// MangaFire moved to a JSON API (/api/titles, /api/titles/{hid}, /api/titles/{hid}/chapters,
// /api/chapters/{id}) behind an SPA shell. The API itself is not behind the Cloudflare
// challenge that protects the HTML pages, so it is fetched directly.

const EXCLUDED_GENRES = [7, 268929, 268930, 268932]; // Ecchi, Adult, Hentai, Smut

class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
  }

  getHeaders(url) {
    return { Referer: `${this.source.baseUrl}/` };
  }

  async getPreference(key) {
    return new SharedPreferences().get(key);
  }

  statusCode(status) {
    return (
      {
        releasing: 0,
        finished: 1,
        on_hiatus: 2,
        discontinued: 3,
        not_yet_released: 4,
      }[status] ?? 5
    );
  }

  stripHtml(html) {
    if (!html) return "";
    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ")
      .trim();
  }

  buildQuery(params) {
    var parts = [];
    for (var key in params) {
      var value = params[key];
      if (value === undefined || value === null || value === "") continue;
      if (Array.isArray(value)) {
        if (value.length === 0) continue;
        for (var v of value) {
          parts.push(
            `${encodeURIComponent(key)}%5B%5D=${encodeURIComponent(v)}`
          );
        }
      } else {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
      }
    }
    return parts.join("&");
  }

  async getContentRatings() {
    var mature = false;
    try {
      mature = !!(await this.getPreference("mangafire_pref_mature"));
    } catch (e) {}
    var ratings = ["safe", "suggestive"];
    if (mature) ratings.push("erotica", "pornographic");
    return { ratings, mature };
  }

  async fetchTitles(params) {
    var qs = this.buildQuery(params);
    var url = `${this.source.baseUrl}/api/titles?${qs}`;
    var res = await this.client.get(url, this.getHeaders());
    var data = JSON.parse(res.body);
    var list = (data.items || []).map((item) => ({
      name: item.title,
      imageUrl:
        (item.poster && (item.poster.medium || item.poster.large)) || "",
      link: item.url,
    }));
    var hasNextPage = !!(data.meta && data.meta.hasNext);
    return { list, hasNextPage };
  }

  async getPopular(page) {
    var cr = await this.getContentRatings();
    var params = {
      content_rating: cr.ratings,
      "order[follows_total]": "desc",
      page,
      limit: 30,
    };
    if (!cr.mature) params["genres_ex"] = EXCLUDED_GENRES;
    return await this.fetchTitles(params);
  }

  async getLatestUpdates(page) {
    var cr = await this.getContentRatings();
    var params = {
      content_rating: cr.ratings,
      "order[chapter_updated_at]": "desc",
      page,
      limit: 30,
    };
    if (!cr.mature) params["genres_ex"] = EXCLUDED_GENRES;
    return await this.fetchTitles(params);
  }

  async search(query, page, filters) {
    var cr = await this.getContentRatings();
    var params = {
      content_rating: cr.ratings,
      page,
      limit: 30,
    };
    if (query) {
      params.keyword = query;
    } else if (!cr.mature) {
      params["genres_ex"] = EXCLUDED_GENRES;
    }

    var sortFilter = filters && filters[0];
    var sortValue =
      (sortFilter && sortFilter.values[sortFilter.state]?.value) ||
      "chapter_updated_at:desc";
    var sortParts = sortValue.split(":");
    params[`order[${sortParts[0]}]`] = sortParts[1] || "desc";

    var typeFilter = filters && filters[1];
    var types = [];
    if (typeFilter)
      for (var f of typeFilter.state) if (f.state) types.push(f.value);
    if (types.length) params.types = types;

    var statusFilter = filters && filters[2];
    var statuses = [];
    if (statusFilter)
      for (var f of statusFilter.state) if (f.state) statuses.push(f.value);
    if (statuses.length) params.statuses = statuses;

    var demoFilter = filters && filters[3];
    var demographics = [];
    if (demoFilter)
      for (var f of demoFilter.state) if (f.state) demographics.push(f.value);
    if (demographics.length) params.demographics = demographics;

    var genreIds = [];
    for (var idx of [4, 5, 6]) {
      var f = filters && filters[idx];
      if (!f) continue;
      for (var opt of f.state) if (opt.state) genreIds.push(opt.value);
    }
    if (genreIds.length) params.genres_in = genreIds;

    return await this.fetchTitles(params);
  }

  hidFromUrl(url) {
    var path = url.includes(this.source.baseUrl)
      ? url.replace(this.source.baseUrl, "")
      : url;
    var afterTitle = path.split("/title/")[1] || path.split("/").pop();
    return afterTitle.split("-")[0];
  }

  async getDetail(url) {
    var hid = this.hidFromUrl(url);
    var res = await this.client.get(
      `${this.source.baseUrl}/api/titles/${hid}`,
      this.getHeaders()
    );
    var data = JSON.parse(res.body).data;

    var showUnofficial = false;
    try {
      showUnofficial = !!(await this.getPreference(
        "mangafire_pref_show_unofficial"
      ));
    } catch (e) {}

    var rawChapters = [];
    var page = 1;
    while (true) {
      var chRes = await this.client.get(
        `${this.source.baseUrl}/api/titles/${hid}/chapters?language=en&sort=number&order=desc&page=${page}&limit=200`,
        this.getHeaders()
      );
      var chData = JSON.parse(chRes.body);
      rawChapters.push(...(chData.items || []));
      if (!chData.meta || !chData.meta.hasNext) break;
      page++;
    }

    var chapterItems = rawChapters;
    if (!showUnofficial) {
      // Hide unofficial duplicates when an official release of the same
      // number exists; keep unofficial chapters that have no official
      // counterpart yet (e.g. the newest chapter ahead of the official release).
      var officialNumbers = new Set(
        rawChapters.filter((c) => c.type === "official").map((c) => c.number)
      );
      chapterItems = rawChapters.filter(
        (c) => c.type === "official" || !officialNumbers.has(c.number)
      );
    }

    var chapters = chapterItems.map((chap) => {
      var label = `Chapter ${chap.number}${chap.name ? ": " + chap.name : ""}`;
      if (chap.type && chap.type !== "official") label += " [Unofficial]";
      return {
        name: label,
        url: `/title/${data.hid}-${data.slug}/chapter/${chap.id}`,
        dateUpload: (chap.createdAt * 1000).toString(),
      };
    });

    return {
      name: data.title,
      link: data.url,
      imageUrl: (data.poster && data.poster.large) || "",
      description: this.stripHtml(data.synopsisHtml),
      genre: (data.genres || []).map((g) => g.title),
      status: this.statusCode(data.status),
      author: (data.authors || []).map((a) => a.title).join(", "),
      artist: (data.artists || []).map((a) => a.title).join(", "),
      chapters,
    };
  }

  async getPageList(url) {
    var chapterId = url.split("/").pop();
    var res = await this.client.get(
      `${this.source.baseUrl}/api/chapters/${chapterId}`,
      this.getHeaders()
    );
    var data = JSON.parse(res.body).data;
    return (data.pages || []).map((p) => ({
      url: p.url,
      headers: { Referer: `${this.source.baseUrl}/` },
    }));
  }

  getFilterList() {
    return [
      {
        type_name: "SelectFilter",
        name: "Sort",
        state: 1,
        values: [
          ["Best match", "relevance:desc"],
          ["Latest update", "chapter_updated_at:desc"],
          ["Recently added", "created_at:desc"],
          ["Title (A-Z)", "title:asc"],
          ["Title (Z-A)", "title:desc"],
          ["Year (newest)", "year:desc"],
          ["Year (oldest)", "year:asc"],
          ["Highest rated", "score:desc"],
          ["Trending", "trending:desc"],
          ["Most viewed - 7 days", "views_7d:desc"],
          ["Most viewed - 30 days", "views_30d:desc"],
          ["Most viewed - all time", "views_total:desc"],
          ["Most followed", "follows_total:desc"],
        ].map((x) => ({ type_name: "SelectOption", name: x[0], value: x[1] })),
      },
      {
        type_name: "GroupFilter",
        name: "Type",
        state: [
          ["Manga", "manga"],
          ["Manhwa", "manhwa"],
          ["Manhua", "manhua"],
          ["Other", "other"],
        ].map((x) => ({ type_name: "CheckBox", name: x[0], value: x[1] })),
      },
      {
        type_name: "GroupFilter",
        name: "Status",
        state: [
          ["Releasing", "releasing"],
          ["Finished", "finished"],
          ["On Hiatus", "on_hiatus"],
          ["Discontinued", "discontinued"],
          ["Not Yet Released", "not_yet_released"],
        ].map((x) => ({ type_name: "CheckBox", name: x[0], value: x[1] })),
      },
      {
        type_name: "GroupFilter",
        name: "Demographic",
        state: [
          ["Shounen", "268918"],
          ["Shoujo", "268917"],
          ["Seinen", "268920"],
          ["Josei", "268919"],
        ].map((x) => ({ type_name: "CheckBox", name: x[0], value: x[1] })),
      },
      {
        type_name: "GroupFilter",
        name: "Genre",
        state: [
          ["Action", "1"],
          ["Adult", "268929"],
          ["Adventure", "78"],
          ["Avant Garde", "3"],
          ["Boys Love", "4"],
          ["Comedy", "5"],
          ["Crime", "268921"],
          ["Demons", "77"],
          ["Drama", "6"],
          ["Ecchi", "7"],
          ["Fantasy", "79"],
          ["Girls Love", "9"],
          ["Gourmet", "10"],
          ["Harem", "11"],
          ["Hentai", "268930"],
          ["Historical", "268922"],
          ["Horror", "530"],
          ["Isekai", "13"],
          ["Iyashikei", "531"],
          ["Josei", "15"],
          ["Kids", "532"],
          ["Magic", "539"],
          ["Magical Girls", "268923"],
          ["Mahou Shoujo", "533"],
          ["Martial Arts", "534"],
          ["Mature", "268931"],
          ["Mecha", "19"],
          ["Medical", "268924"],
          ["Military", "535"],
          ["Music", "21"],
          ["Mystery", "22"],
          ["Parody", "23"],
          ["Philosophical", "268925"],
          ["Psychological", "536"],
          ["Reverse Harem", "25"],
          ["Romance", "26"],
          ["School", "73"],
          ["Sci-Fi", "28"],
          ["Seinen", "537"],
          ["Shoujo", "30"],
          ["Shounen", "31"],
          ["Slice of Life", "538"],
          ["Smut", "268932"],
          ["Space", "33"],
          ["Sports", "34"],
          ["Super Power", "75"],
          ["Superhero", "268926"],
          ["Supernatural", "76"],
          ["Suspense", "37"],
          ["Thriller", "38"],
          ["Tragedy", "268927"],
          ["Vampire", "39"],
          ["Wuxia", "268928"],
        ].map((x) => ({ type_name: "CheckBox", name: x[0], value: x[1] })),
      },
      {
        type_name: "GroupFilter",
        name: "Theme",
        state: [
          ["Aliens", "268933"],
          ["Animals", "268934"],
          ["Cooking", "268935"],
          ["Crossdressing", "268936"],
          ["Delinquents", "268937"],
          ["Demons", "268938"],
          ["Genderswap", "268939"],
          ["Ghosts", "268940"],
          ["Gyaru", "268941"],
          ["Harem", "268942"],
          ["Incest", "268943"],
          ["Loli", "268944"],
          ["Mafia", "268945"],
          ["Magic", "268946"],
          ["Martial Arts", "268947"],
          ["Military", "268948"],
          ["Monster Girls", "268949"],
          ["Monsters", "268950"],
          ["Music", "268951"],
          ["Ninja", "268952"],
          ["Office Workers", "268953"],
          ["Police", "268954"],
          ["Post-Apocalyptic", "268955"],
          ["Reincarnation", "268956"],
          ["Reverse Harem", "268957"],
          ["Samurai", "268958"],
          ["School Life", "268959"],
          ["Shota", "268960"],
          ["Supernatural", "268961"],
          ["Survival", "268962"],
          ["Time Travel", "268963"],
          ["Traditional Games", "268964"],
          ["Vampires", "268965"],
          ["Video Games", "268966"],
          ["Villainess", "268967"],
          ["Virtual Reality", "268968"],
          ["Zombies", "268969"],
        ].map((x) => ({ type_name: "CheckBox", name: x[0], value: x[1] })),
      },
      {
        type_name: "GroupFilter",
        name: "Format",
        state: [
          ["4-Koma", "268970"],
          ["Adaptation", "268973"],
          ["Anthology", "268971"],
          ["Award Winning", "268972"],
          ["Doujinshi", "268974"],
          ["Full Color", "268978"],
          ["Long Strip", "268976"],
          ["Oneshot", "268975"],
          ["Web Comic", "268977"],
        ].map((x) => ({ type_name: "CheckBox", name: x[0], value: x[1] })),
      },
    ];
  }

  getSourcePreferences() {
    return [
      {
        key: "mangafire_pref_mature",
        switchPreferenceCompat: {
          title: "Include mature content",
          summary:
            "Also fetch erotica/pornographic rated titles and remove the default Ecchi/Adult/Hentai/Smut exclusion applied to Popular, Latest and genre-only browsing.",
          value: false,
        },
      },
      {
        key: "mangafire_pref_show_unofficial",
        switchPreferenceCompat: {
          title: "Show unofficial chapters",
          summary:
            "Show fan/unofficial chapter releases even when an official release of the same number exists. Off by default, which hides the unofficial duplicate but still shows unofficial chapters that have no official counterpart yet.",
          value: false,
        },
      },
    ];
  }
}
