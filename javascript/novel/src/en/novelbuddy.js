const mangayomiSources = [{
    "name": "Novelbuddy",
    "id": 2507947282,
    "lang": "en",
    "baseUrl": "https://novelbuddy.me",
    "apiUrl": "https://api.novelbuddy.me",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://novelbuddy.me/",
    "typeSource": "single",
    "isNsfw": false,
    "hasCloudflare": false,
    "itemType": 2,
    "version": "0.2.0",
    "pkgPath": "novel/src/en/novelbuddy.js",
    "notes": "Site is a Next.js app - all data comes from api.novelbuddy.me"
}];

// novelbuddy.com now redirects to novelbuddy.me, which renders client-side --
// there is no server-rendered markup left to scrape. Everything below talks to
// the site's own public JSON API instead.
const API_FALLBACK = "https://api.novelbuddy.me";
const SITE_FALLBACK = "https://novelbuddy.me";
const PAGE_SIZE = 24;
const CHAPTER_LIMIT = 500;

const GENRE_NAMES = ["Action", "Adult", "Adventure", "Comedy", "Drama", "Eastern", "Ecchi", "Fan-Fiction",
    "Fantasy", "Game", "Gender Bender", "Harem", "Historical", "Horror", "Josei", "Martial Arts", "Mature",
    "Mecha", "Military", "Modern Life", "Mystery", "Psychological", "Reincarnation", "Romance", "School Life",
    "Sci-fi", "Seinen", "Shoujo", "Shoujo Ai", "Shounen", "Shounen Ai", "Slice of Lif", "Slice Of Life", "Smut",
    "Sports", "Supernatural", "System", "Tragedy", "Urban", "Urban Life", "Wuxia", "Xianxia", "Xuanhuan",
    "Yaoi", "Yuri"];
const GENRE_SLUGS = ["action", "adult", "adventure", "comedy", "drama", "eastern", "ecchi", "fan-fiction",
    "fantasy", "game", "gender-bender", "harem", "historical", "horror", "josei", "martial-arts", "mature",
    "mecha", "military", "modern-life", "mystery", "psychological", "reincarnation", "romance", "school-life",
    "sci-fi", "seinen", "shoujo", "shoujo-ai", "shounen", "shounen-ai", "slice-of-lif", "slice-of-life", "smut",
    "sports", "supernatural", "system", "tragedy", "urban", "urban-life", "wuxia", "xianxia", "xuanhuan",
    "yaoi", "yuri"];

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
    }

    get apiUrl() {
        return (this.source && this.source.apiUrl) || API_FALLBACK;
    }

    get siteUrl() {
        // The stored baseUrl may still be the old novelbuddy.com; it redirects,
        // but keep display links on the canonical host.
        const base = (this.source && this.source.baseUrl) || SITE_FALLBACK;
        return base.replace("novelbuddy.com", "novelbuddy.me").replace(/\/$/, "");
    }

    // Also used by the app for cover requests, so it stays content-neutral.
    getHeaders(url) {
        return {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            "Referer": this.siteUrl + "/"
        };
    }

    async api(path) {
        const url = `${this.apiUrl}${path}`;
        const headers = this.getHeaders(url);
        headers["Accept"] = "application/json";

        const res = await this.client.get(url, headers);

        let json;
        try {
            json = JSON.parse(res.body);
        } catch (_) {
            throw new Error(`Novelbuddy: non-JSON reply from ${path}`);
        }

        if (!json || json.success === false) {
            throw new Error(`Novelbuddy: ${(json && json.message) || "request failed"} (${path})`);
        }
        return json.data || {};
    }

    stripTags(html) {
        if (!html) return "";
        return String(html)
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/p>/gi, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&nbsp;/g, " ")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#0?39;/g, "'")
            .replace(/&amp;/g, "&")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }

    statusCode(status) {
        switch (String(status || "").toLowerCase()) {
            case "ongoing": return 0;
            case "completed": return 1;
            case "cancelled":
            case "dropped": return 3;
            case "hiatus":
            case "on hiatus": return 5;
            default: return 5;
        }
    }

    // Canonical book link, e.g. https://novelbuddy.me/titles/gRDx9a21-some-slug
    bookLink(item) {
        const slug = item.slug || String(item.url || "").split("/").filter(s => s).pop() || "";
        return `${this.siteUrl}/titles/${item.id}-${slug}`;
    }

    itemToBook(item) {
        return {
            name: item.name || "",
            link: this.bookLink(item),
            imageUrl: item.cover || "",
            description: this.stripTags(item.summary)
        };
    }

    async listTitles({ query = "", genres = [], status = "", sort = "views", page = 1 } = {}) {
        // The API rejects an empty `q`, so it is omitted entirely when browsing.
        let path = `/titles/search?page=${page}&limit=${PAGE_SIZE}&sort=${encodeURIComponent(sort)}`;
        if (query) path += `&q=${encodeURIComponent(query)}`;
        if (status && status !== "all") path += `&status=${encodeURIComponent(status)}`;
        for (const genre of genres) path += `&genres[]=${encodeURIComponent(genre)}`;

        const data = await this.api(path);
        const items = data.items || [];
        const pagination = data.pagination || {};

        return {
            list: items.map(item => this.itemToBook(item)),
            hasNextPage: pagination.has_next === true
        };
    }

    async getPopular(page) {
        return await this.listTitles({ sort: "views", page });
    }

    get supportsLatest() {
        return true;
    }

    async getLatestUpdates(page) {
        return await this.listTitles({ sort: "latest", page });
    }

    async search(query, page, filters) {
        const checked = (state) => (state || []).filter(i => i.state).map(i => i.value);
        const selected = (filter, fallback) => {
            if (!filter || !filter.values || typeof filter.state !== "number") return fallback;
            return (filter.values[filter.state] || {}).value || fallback;
        };

        const hasFilters = !!(filters && filters.length);
        const genres = hasFilters ? checked(filters[0].state) : [];
        const status = hasFilters ? selected(filters[1], "all") : "all";
        const sort = hasFilters ? selected(filters[2], "views") : "views";

        return await this.listTitles({ query, genres, status, sort, page });
    }

    // Accepts the canonical /titles/{id}-{slug} link and also the pre-0.2.0
    // links that were plain site slugs, so existing library entries keep working.
    async fetchTitle(url) {
        const path = String(url || "").replace(/^https?:\/\/[^/]+/, "");

        const byId = path.match(/\/titles\/([^/\-]+)-/);
        if (byId) {
            const data = await this.api(`/titles/${byId[1]}`);
            if (data.title) return data.title;
        }

        const slug = path.split("?")[0].split("/").filter(s => s).pop();
        if (!slug) throw new Error(`Novelbuddy: cannot resolve "${url}"`);

        const data = await this.api(`/titles/by-slug/${encodeURIComponent(slug)}?include=details`);
        if (!data.title) throw new Error(`Novelbuddy: no title at "${url}"`);
        return data.title;
    }

    async getDetail(url) {
        const title = await this.fetchTitle(url);

        // The API repeats entries across its genre/author arrays.
        const unique = (values) => {
            const seen = {};
            const out = [];
            for (const value of values) {
                if (!value || seen[value]) continue;
                seen[value] = true;
                out.push(value);
            }
            return out;
        };

        const genre = unique((title.genres || []).map(g => g.name));
        const author = unique((title.authors || []).map(a => a.name)).join(", ");

        return {
            name: title.name || "",
            link: this.bookLink(title),
            imageUrl: title.cover || "",
            description: this.stripTags(title.summary),
            author,
            genre,
            status: this.statusCode(title.status),
            chapters: await this.getChapters(title.id)
        };
    }

    async getChapters(titleId) {
        const data = await this.api(`/titles/${titleId}/chapters?limit=${CHAPTER_LIMIT}`);
        const rows = data.chapters || data.items || [];

        const ordered = rows.slice().sort((a, b) => (b.number || 0) - (a.number || 0));

        return ordered.map((chapter) => {
            const uploaded = chapter.updated_at ? new Date(chapter.updated_at).valueOf() : NaN;
            return {
                name: chapter.name || `Chapter ${chapter.number}`,
                // Self-contained: the reader only ever hands this string back.
                url: `/titles/${titleId}/chapters/${chapter.id}`,
                scanlator: "",
                dateUpload: isNaN(uploaded) ? null : String(uploaded)
            };
        });
    }

    async getHtmlContent(name, url) {
        const path = String(url || "").replace(/^https?:\/\/[^/]+/, "");

        let chapter;
        if (/^\/titles\/[^/]+\/chapters\/[^/]+$/.test(path)) {
            chapter = (await this.api(path)).chapter;
        } else {
            // Legacy link shape: /{title-slug}/{chapter-slug}
            const parts = path.split("?")[0].split("/").filter(s => s);
            if (parts.length < 2) throw new Error(`Novelbuddy: cannot resolve chapter "${url}"`);

            const data = await this.api(
                `/titles/by-slug/${encodeURIComponent(parts[parts.length - 2])}` +
                `/chapters/${encodeURIComponent(parts[parts.length - 1])}?include=details`
            );
            chapter = data.chapter;
        }

        if (!chapter) throw new Error(`Novelbuddy: no content for "${url}"`);
        return await this.cleanHtmlContent(chapter.content || "");
    }

    // Content arrives as <p> blocks padded with stray <br> pairs, preceded by a
    // bare (untagged) chapter title line.
    async cleanHtmlContent(html) {
        if (!html) return "";

        let text = String(html)
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gmi, "")
            .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gmi, "")
            .replace(/(<\/p>)\s*(?:<br\s*\/?>\s*)+/gi, "$1")
            .replace(/(?:<br\s*\/?>\s*)+(?=<p[\s>])/gi, "")
            .trim();

        const firstTag = text.indexOf("<");
        if (firstTag > 0) {
            const heading = text.slice(0, firstTag).trim();
            if (heading) text = `<h2>${heading}</h2>${text.slice(firstTag)}`;
        }

        return text.trim();
    }

    getFilterList() {
        const options = (items, values) =>
            items.map((name, i) => ({ type_name: "SelectOption", name, value: values[i] }));

        return [
            {
                type_name: "GroupFilter",
                name: "Genres",
                state: GENRE_NAMES.map((name, i) => ({
                    type_name: "CheckBox",
                    name,
                    value: GENRE_SLUGS[i]
                }))
            },
            {
                type_name: "SelectFilter",
                name: "Status",
                state: 0,
                values: options(["All", "Ongoing", "Completed"], ["all", "ongoing", "completed"])
            },
            {
                type_name: "SelectFilter",
                name: "Order by",
                state: 0,
                values: options(
                    ["Views", "Popular", "Newest", "Latest update", "Rating", "Bookmarks", "Chapters",
                        "Views today", "Views this week", "Views this month"],
                    ["views", "popular", "newest", "latest", "rating", "bookmarks", "chapters",
                        "views_today", "views_7days", "views_30days"]
                )
            }
        ];
    }

    getSourcePreferences() {
        return [];
    }
}
