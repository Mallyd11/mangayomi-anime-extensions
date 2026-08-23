const mangayomiSources = [{
    "name": "NovelFire",
    "id": 1881171594,
    "lang": "en",
    "baseUrl": "https://novelfire.net",
    "apiUrl": "",
    "iconUrl": "https://m.media-amazon.com/images/I/31957gKv8WL.jpg",
    "typeSource": "single",
    "isNsfw": false,
    "hasCloudflare": false,
    "itemType": 2,
    "version": "0.1.0",
    "pkgPath": "novel/src/en/NovelFire.js",
    "notes": ""
}];

// Chapters are listed 100 per page. A very long novel would need dozens of
// requests and the app kills any extension call after ~40s, so the chapter walk
// runs against a time budget and synthesises whatever it could not fetch --
// chapter URLs on this site are strictly {book}/chapter-1..N.
const CHAPTERS_PER_PAGE = 100;
const CHAPTER_FETCH_BUDGET_MS = 18000;

class DefaultExtension extends MProvider {
    getHeaders(url) {
        return {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            "Referer": this.source.baseUrl + "/"
        };
    }

    abs(link) {
        if (!link) return "";
        return link.startsWith("http") ? link : `${this.source.baseUrl}${link}`;
    }

    async getBooks(url) {
        const client = new Client();
        const res = await client.get(url, this.getHeaders(url));
        const doc = new Document(res.body);

        const bookList = [];
        for (const book of doc.select("ul.novel-list li.novel-item")) {
            const anchor = book.selectFirst("a");
            if (!anchor) continue;

            const href = anchor.attr("href");
            if (!href) continue;

            const cover = book.selectFirst("figure.novel-cover img");
            const imgAttr = cover ? (cover.attr("data-src") || cover.attr("src")) : "";

            bookList.push({
                name: (anchor.attr("title") || anchor.text || "").trim(),
                link: this.abs(href),
                imageUrl: this.abs(imgAttr)
            });
        }

        return { list: bookList, hasNextPage: this.hasNextPage(doc) };
    }

    // The pager renders a rel="next" anchor on every page except the last, where
    // it degrades to a disabled <span>. Anything else means there is one page.
    hasNextPage(doc) {
        const next = doc.selectFirst("ul.pagination a[rel=next]");
        if (!next) return false;
        const href = next.attr("href");
        return !!href && href !== "#";
    }

    async getPopular(page) {
        return await this.getBooks(`${this.source.baseUrl}/genre-all/sort-popular/status-all/all-novel?page=${page}`);
    }

    get supportsLatest() {
        return true;
    }

    async getLatestUpdates(page) {
        return await this.getBooks(`${this.source.baseUrl}/latest-release-novels?page=${page}`);
    }

    async search(query, page, filters) {
        const baseUrl = this.source.baseUrl;

        if (query) {
            return await this.getBooks(`${baseUrl}/search?keyword=${encodeURIComponent(query)}&type=both&page=${page}`);
        }

        // No keyword typed: fall back to the filterable browse listing.
        const pick = (i, fallback) => {
            const f = filters && filters[i];
            if (!f || !f.values || typeof f.state !== "number") return fallback;
            return (f.values[f.state] || {}).value || fallback;
        };
        const genre = pick(0, "all");
        const sort = pick(1, "popular");
        const status = pick(2, "all");

        return await this.getBooks(`${baseUrl}/genre-${genre}/sort-${sort}/status-${status}/all-novel?page=${page}`);
    }

    async getDetail(url) {
        const client = new Client();
        const bookUrl = this.abs(url);
        const res = await client.get(bookUrl, this.getHeaders(bookUrl));
        const doc = new Document(res.body);

        const titleEl = doc.selectFirst("div.main-head h1.novel-title");
        const coverEl = doc.selectFirst("figure.cover img");
        const descEl = doc.selectFirst("meta[itemprop=description]");
        const authorEl = doc.selectFirst("span[itemprop=author]");
        const keywordsEl = doc.selectFirst("meta[itemprop=keywords]");

        const keywords = keywordsEl ? keywordsEl.attr("content") : "";
        const bookGenres = keywords
            ? keywords.split(",")
                .map(g => g.trim())
                .filter(g => g && g.toLowerCase() !== "novel" && g.toLowerCase() !== "webnovel")
            : [];

        return {
            name: titleEl ? titleEl.text.trim() : "",
            link: bookUrl,
            imageUrl: coverEl ? this.abs(coverEl.attr("data-src") || coverEl.attr("src")) : "",
            description: descEl ? (descEl.attr("content") || "").trim() : "",
            author: authorEl ? authorEl.text.trim() : "",
            genre: bookGenres,
            status: this.readStatus(doc),
            chapters: await this.getChapters(client, bookUrl, this.readStat(doc, "chapters"))
        };
    }

    // header-stats renders several <span><strong>value</strong><small>label</small></span>
    // pairs. Read them by their <small> label -- the first <strong> on the page is
    // the chapter count, not the status.
    readStat(doc, label) {
        for (const span of doc.select("div.header-stats span")) {
            const small = span.selectFirst("small");
            if (!small || small.text.trim().toLowerCase() !== label) continue;

            const strong = span.selectFirst("strong");
            const n = parseInt((strong ? strong.text : "").replace(/[^0-9]/g, ""), 10);
            return isNaN(n) ? 0 : n;
        }
        return 0;
    }

    readStatus(doc) {
        for (const span of doc.select("div.header-stats span")) {
            const small = span.selectFirst("small");
            if (!small || small.text.trim().toLowerCase() !== "status") continue;

            const strong = span.selectFirst("strong");
            const text = strong ? strong.text.trim().toLowerCase() : "";
            if (text.includes("completed")) return 1;
            if (text.includes("ongoing")) return 0;
            if (text.includes("hiatus")) return 5;
            if (text.includes("dropped") || text.includes("cancelled")) return 3;
            return 5;
        }
        return 5;
    }

    async getChapters(client, bookUrl, expectedCount) {
        const chapters = [];
        const seen = {};
        const started = Date.now();

        let totalPages = expectedCount > 0 ? Math.ceil(expectedCount / CHAPTERS_PER_PAGE) : 1;
        let highestNumber = 0;
        let page = 1;

        while (page <= totalPages) {
            if (page > 1 && Date.now() - started > CHAPTER_FETCH_BUDGET_MS) break;

            const pageUrl = `${bookUrl}/chapters?page=${page}`;
            let doc;
            try {
                const res = await client.get(pageUrl, this.getHeaders(pageUrl));
                doc = new Document(res.body);
            } catch (_) {
                break;
            }

            const rows = doc.select("ul.chapter-list li a");
            if (rows.length === 0) break;

            for (const row of rows) {
                const noEl = row.selectFirst("span.chapter-no");
                const number = parseInt((noEl ? noEl.text : "").replace(/[^0-9]/g, ""), 10);

                const href = row.attr("href");
                const chapterUrl = href ? this.abs(href) : `${bookUrl}/chapter-${number}`;
                if (seen[chapterUrl]) continue;
                seen[chapterUrl] = true;

                const titleEl = row.selectFirst("strong.chapter-title");
                const timeEl = row.selectFirst("time.chapter-update");
                const dateAttr = timeEl ? timeEl.attr("datetime") : null;
                const parsedDate = dateAttr ? new Date(dateAttr.replace(" ", "T")).valueOf() : NaN;

                if (!isNaN(number) && number > highestNumber) highestNumber = number;

                chapters.push({
                    name: titleEl ? titleEl.text.trim() : `Chapter ${number}`,
                    url: chapterUrl,
                    scanlator: "",
                    dateUpload: isNaN(parsedDate) ? null : String(parsedDate)
                });
            }

            // Page 1 tells us the real page count when the header stat was
            // missing or stale.
            if (page === 1 && expectedCount <= 0) {
                totalPages = Math.max(totalPages, this.lastPageNumber(doc));
            }
            page++;
        }

        // Ran out of budget (or the site cut us off): fill the tail in from the
        // known {book}/chapter-N pattern so no chapter goes missing.
        for (let n = highestNumber + 1; n <= expectedCount; n++) {
            const chapterUrl = `${bookUrl}/chapter-${n}`;
            if (seen[chapterUrl]) continue;
            seen[chapterUrl] = true;
            chapters.push({ name: `Chapter ${n}`, url: chapterUrl, scanlator: "", dateUpload: null });
        }

        return chapters.reverse();
    }

    lastPageNumber(doc) {
        let last = 1;
        for (const a of doc.select("ul.pagination a.page-link")) {
            const m = (a.attr("href") || "").match(/[?&]page=(\d+)/);
            if (m) last = Math.max(last, parseInt(m[1], 10));
        }
        return last;
    }

    async getHtmlContent(name, url) {
        const client = new Client();
        const chapterUrl = this.abs(url);
        const res = await client.get(chapterUrl, this.getHeaders(chapterUrl));
        return await this.cleanHtmlContent(res.body);
    }

    async cleanHtmlContent(html) {
        const doc = new Document(html);
        const content = doc.selectFirst("div#content");
        if (!content) return html;

        let cleaned = "";
        for (const node of content.select("h1, h2, h3, h4, p")) {
            const text = node.text.trim();
            if (!text) continue;
            // Drop the credits block and the site's own in-body nags.
            if (/^(translator|editor|proofreader)\s*:/i.test(text)) continue;
            if (/novelfire/i.test(text) && text.length < 120) continue;
            cleaned += node.outerHtml;
        }

        return cleaned || content.innerHtml;
    }

    getFilterList() {
        const options = (items, values) =>
            items.map((name, i) => ({ type_name: "SelectOption", name, value: values[i] }));

        const genreNames = ["All", "Action", "Adult", "Adventure", "Anime", "Arts", "Comedy", "Drama", "Eastern",
            "Ecchi", "Fan-fiction", "Fantasy", "Game", "Gender Bender", "Harem", "Historical", "Horror", "Isekai",
            "Josei", "LGBT", "Magic", "Magical Realism", "Manhua", "Martial Arts", "Mature", "Mecha", "Military",
            "Modern Life", "Movies", "Mystery", "Other", "Psychological", "Realistic Fiction", "Reincarnation",
            "Romance", "School Life", "Sci-fi", "Seinen", "Shoujo", "Shoujo Ai", "Shounen", "Shounen Ai",
            "Slice of Life", "Smut", "Sports", "Supernatural", "System", "Tragedy", "Urban", "Urban Life",
            "Video Games", "War", "Wuxia", "Xianxia", "Xuanhuan", "Yaoi", "Yuri"];
        const genreValues = ["all", "action", "adult", "adventure", "anime", "arts", "comedy", "drama", "eastern",
            "ecchi", "fan-fiction", "fantasy", "game", "gender-bender", "harem", "historical", "horror", "isekai",
            "josei", "lgbt", "magic", "magical-realism", "manhua", "martial-arts", "mature", "mecha", "military",
            "modern-life", "movies", "mystery", "other", "psychological", "realistic-fiction", "reincarnation",
            "romance", "school-life", "sci-fi", "seinen", "shoujo", "shoujo-ai", "shounen", "shounen-ai",
            "slice-of-life", "smut", "sports", "supernatural", "system", "tragedy", "urban", "urban-life",
            "video-games", "war", "wuxia", "xianxia", "xuanhuan", "yaoi", "yuri"];

        return [
            {
                type_name: "SelectFilter",
                name: "Genre",
                state: 0,
                values: options(genreNames, genreValues)
            },
            {
                type_name: "SelectFilter",
                name: "Order by",
                state: 0,
                values: options(["Popular", "New", "Latest release"], ["popular", "new", "latest-release"])
            },
            {
                type_name: "SelectFilter",
                name: "Status",
                state: 0,
                values: options(["All", "Ongoing", "Completed"], ["all", "ongoing", "completed"])
            }
        ];
    }

    getSourcePreferences() {
        return [];
    }
}
