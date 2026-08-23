const mangayomiSources = [{
    "name": "bookReadFree",
    "id": 2088776723,
    "lang": "en",
    "baseUrl": "https://bookreadfree.com",
    "apiUrl": "",
    "iconUrl": "https://cdn.pixabay.com/photo/2016/09/16/09/20/books-1673578_1280.png",
    "typeSource": "single",
    "isNsfw": false,
    "hasCloudflare": false,
    "itemType": 2,
    "version": "0.1.0",
    "pkgPath": "novel/src/en/bookReadFree.js",
    "notes": ""
}];

// The site has no global listing -- only per-category index pages -- so Popular
// browses one category (picked in the source preferences) and Latest reads the
// home page's NEW RELEASES column.
const CATEGORY_NAMES = ["Romance", "Fiction", "Fantasy", "Young Adult", "Adventure", "Contemporary",
    "Paranormal", "Mystery", "Thriller", "Horror", "Historical", "Suspense", "Christian", "Other",
    "Billionaire", "Humorous", "Western", "Vampires"];
const CATEGORY_SLUGS = ["romance", "fiction", "fantasy", "young_adult", "adventure", "contemporary",
    "paranormal", "mystery", "thriller", "horror", "historical", "suspense", "christian", "other",
    "billionaire", "humorous", "western", "vampires"];

// Latest has no covers in the markup, so they are fetched from the book pages.
// Kept small and batched: the app kills any extension call after ~40s.
const LATEST_LIMIT = 24;
const COVER_CONCURRENCY = 6;

class DefaultExtension extends MProvider {
    getHeaders(url) {
        return {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            "Referer": this.source.baseUrl + "/"
        };
    }

    getPreference(key) {
        return new SharedPreferences().get(key);
    }

    abs(link) {
        if (!link) return "";
        return link.startsWith("http") ? link : `${this.source.baseUrl}${link}`;
    }

    async getDoc(url) {
        const res = await new Client().get(url, this.getHeaders(url));
        return new Document(res.body);
    }

    // Category index pages carry the cover inline, so no follow-up request is
    // needed per book.
    booksFromIndex(doc) {
        const list = [];
        for (const li of doc.select("ul.l1 li")) {
            const anchor = li.selectFirst("a");
            if (!anchor) continue;

            const href = anchor.attr("href");
            if (!href || href.indexOf("/book/") === -1) continue;

            const img = li.selectFirst("img");
            const title = li.selectFirst("b");

            list.push({
                name: (title ? title.text : anchor.attr("alt") || anchor.text).trim(),
                link: this.abs(href),
                imageUrl: img ? this.abs(img.attr("src")) : ""
            });
        }
        return list;
    }

    async getPopular(page) {
        const slug = this.getPreference("brf_popular_category") || "romance";
        const url = page > 1
            ? `${this.source.baseUrl}/${slug}/index_${page}.html`
            : `${this.source.baseUrl}/${slug}/`;

        const doc = await this.getDoc(url);
        const list = this.booksFromIndex(doc);

        // The pager is a flat <tt class="i2"> strip; a "Next Page" anchor is the
        // only reliable signal that another page exists.
        let hasNextPage = false;
        for (const a of doc.select("tt.i2 a")) {
            if (a.text.trim().toLowerCase().startsWith("next page")) hasNextPage = true;
        }

        return { list, hasNextPage };
    }

    get supportsLatest() {
        return true;
    }

    async getLatestUpdates(page) {
        if (page > 1) return { list: [], hasNextPage: false };

        const doc = await this.getDoc(`${this.source.baseUrl}/`);

        // Covers for the newest books are already on the page in the
        // RECOMMENDED strip; reuse them and only fetch the ones still missing.
        const covers = {};
        for (const book of this.booksFromIndex(doc)) {
            covers[book.link] = book.imageUrl;
        }

        const entries = [];
        for (const p of doc.select("ol.l2 p")) {
            const anchor = p.selectFirst("a");
            if (!anchor) continue;

            const href = anchor.attr("href");
            const name = anchor.text.trim();
            if (!href || href.indexOf("/book/") === -1) continue;
            if (name.toLowerCase().startsWith("view more")) continue;

            const author = p.selectFirst("em");
            entries.push({
                name,
                link: this.abs(href),
                imageUrl: covers[this.abs(href)] || "",
                author: author ? author.text.trim() : ""
            });

            if (entries.length >= LATEST_LIMIT) break;
        }

        await this.fillCovers(entries);
        return { list: entries, hasNextPage: false };
    }

    async fillCovers(entries) {
        const pending = entries.filter(e => !e.imageUrl);

        for (let i = 0; i < pending.length; i += COVER_CONCURRENCY) {
            const batch = pending.slice(i, i + COVER_CONCURRENCY);
            await Promise.all(batch.map(async (entry) => {
                try {
                    const doc = await this.getDoc(entry.link);
                    const img = doc.selectFirst("div.d img");
                    entry.imageUrl = img ? this.abs(img.attr("src")) : "";
                } catch (_) {
                    entry.imageUrl = "";
                }
            }));
        }
    }

    async search(query, page, filters) {
        const baseUrl = this.source.baseUrl;

        // No keyword typed: browse the category chosen in the filter sheet.
        if (!query) {
            const f = filters && filters[0];
            const slug = (f && f.values && typeof f.state === "number")
                ? (f.values[f.state] || {}).value || "romance"
                : "romance";
            const url = page > 1 ? `${baseUrl}/${slug}/index_${page}.html` : `${baseUrl}/${slug}/`;

            const doc = await this.getDoc(url);
            let hasNextPage = false;
            for (const a of doc.select("tt.i2 a")) {
                if (a.text.trim().toLowerCase().startsWith("next page")) hasNextPage = true;
            }
            return { list: this.booksFromIndex(doc), hasNextPage };
        }

        let searchUrl = `${baseUrl}/s/search?q=${encodeURIComponent(query)}`;
        if (page > 1) searchUrl += `&offset=${page}`;

        const doc = await this.getDoc(searchUrl);

        const list = [];
        for (const li of doc.select("ul.books li")) {
            const anchor = li.selectFirst("a.row");
            if (!anchor) continue;

            const href = anchor.attr("href");
            if (!href) continue;

            const title = anchor.selectFirst("i.hh");
            const cover = anchor.selectFirst("div.a");

            list.push({
                name: title ? title.text.trim() : "",
                link: this.abs(href),
                imageUrl: cover ? this.abs(cover.attr("src")) : ""
            });
        }

        let hasNextPage = false;
        for (const a of doc.select("a.more")) {
            if (a.text.trim().toLowerCase().startsWith("next")) hasNextPage = true;
        }

        return { list, hasNextPage };
    }

    async getDetail(url) {
        const bookUrl = this.abs(url);
        const doc = await this.getDoc(bookUrl);

        const info = doc.selectFirst("div.d");
        const titleEl = info ? info.selectFirst("b.t") : null;
        const coverEl = info ? info.selectFirst("img") : null;

        // The metadata rows are plain <p> tags with no classes, so they are read
        // by their label rather than by a :contains() selector -- the app's CSS
        // engine does not implement :contains().
        let author = "";
        let genres = [];
        if (info) {
            for (const p of info.select("p")) {
                const text = p.text.trim();
                if (/^by\s/i.test(text)) {
                    const link = p.selectFirst("a");
                    author = (link ? link.text : text.replace(/^by\s+/i, "")).trim();
                } else if (/^genre\s*:/i.test(text)) {
                    genres = text.replace(/^genre\s*:/i, "")
                        .split(",")
                        .map(g => g.trim())
                        .filter(g => g);
                }
            }
        }

        const descEl = doc.selectFirst("div.dd");
        let description = descEl ? descEl.text.trim() : "";
        description = description.replace(/^Read\s+.*?Storyline:\s*/i, "").trim();

        return {
            name: titleEl ? titleEl.text.trim() : "",
            link: bookUrl,
            imageUrl: coverEl ? this.abs(coverEl.attr("src")) : "",
            description,
            author,
            genre: genres,
            status: 1,
            chapters: await this.getChapters(bookUrl)
        };
    }

    async getChapters(bookUrl) {
        const chaptersUrl = bookUrl.replace("/book/", "/all/");
        const chapters = [];

        let doc;
        try {
            doc = await this.getDoc(chaptersUrl);
        } catch (_) {
            return chapters;
        }

        const container = doc.selectFirst("div.l");
        if (!container) return chapters;

        for (const a of container.select("a")) {
            const href = a.attr("href");
            if (!href) continue;

            chapters.push({
                name: a.text.trim(),
                url: this.abs(href),
                scanlator: "",
                dateUpload: null
            });
        }

        return chapters.reverse();
    }

    async getHtmlContent(name, url) {
        const doc = await this.getDoc(this.abs(url));
        const content = doc.selectFirst("section.con");
        if (!content) return "";
        return await this.cleanHtmlContent(content.innerHtml);
    }

    // Chapter bodies are one big <p> of <br>-separated lines, so they are
    // flattened to text and rebuilt as real paragraphs. Structure only -- no
    // fonts or sizes, so the reader's own theme settings still apply.
    async cleanHtmlContent(html) {
        if (!html) return "";

        const cleaned = html
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gmi, "")
            .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gmi, "")
            .replace(/<br\s*\/?\/?>/gi, "\n")
            .replace(/<\/p>/gi, "\n")
            .replace(/<p[^>]*>/gi, "")
            .replace(/<[^>]+>/g, "")
            .replace(/&nbsp;/g, " ")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#0?39;/g, "'")
            .replace(/&#8217;/g, "’")
            .replace(/&amp;/g, "&")
            .replace(/[ \t]+/g, " ")
            .replace(/\n\s*\n/g, "\n")
            .trim();

        return this.formatNovelText(cleaned);
    }

    formatNovelText(text) {
        if (!text) return "";

        const out = [];
        for (const line of text.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (/^\s*(CHAPTER\s+[A-Z0-9IVXLC]+|PROLOGUE|EPILOGUE|ACKNOWLEDGE?MENTS)\s*$/i.test(trimmed)) {
                out.push(`<h2 style="text-align:center;">${trimmed.toUpperCase()}</h2>`);
                continue;
            }

            if (/^([*.\-—])\1{2,}$/.test(trimmed) || /^[*.\-—\s]{3,}$/.test(trimmed)) {
                out.push('<hr style="width:30%;margin:1.5em auto;opacity:0.4;">');
                continue;
            }

            if (trimmed.length < 60 && !/[.?!,;:]$/.test(trimmed) && trimmed === trimmed.toUpperCase()) {
                out.push(`<h3 style="text-align:center;">${trimmed}</h3>`);
                continue;
            }

            out.push(`<p>${trimmed}</p>`);
        }

        return out.join("");
    }

    getFilterList() {
        return [
            {
                type_name: "SelectFilter",
                name: "Category (used when the search box is empty)",
                state: 0,
                values: CATEGORY_NAMES.map((name, i) => ({
                    type_name: "SelectOption",
                    name,
                    value: CATEGORY_SLUGS[i]
                }))
            }
        ];
    }

    getSourcePreferences() {
        return [
            {
                key: "brf_popular_category",
                listPreference: {
                    title: "Category for the Popular tab",
                    summary: "This site has no site-wide ranking, so Popular browses one category.",
                    valueIndex: 0,
                    entries: CATEGORY_NAMES,
                    entryValues: CATEGORY_SLUGS
                }
            }
        ];
    }
}
