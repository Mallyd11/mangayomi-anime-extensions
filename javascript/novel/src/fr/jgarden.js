const mangayomiSources = [{
    "name": "J-Garden",
    "id": 3180938589,
    "lang": "fr",
    "baseUrl": "https://j-garden.fr",
    "apiUrl": "https://j-garden.fr/wp-json/wp/v2",
    "iconUrl": "https://j-garden.fr/wp-content/uploads/2025/04/cropped-JG-logo-original-1-300x300.webp",
    "typeSource": "single",
    "isNsfw": false,
    "hasCloudflare": false,
    "itemType": 2,
    "version": "0.1.0",
    "pkgPath": "novel/src/fr/jgarden.js",
    "notes": "French fan-translation team on WordPress + Elementor. Series are pages, chapters are posts."
}];

// J-Garden is a WordPress site built with Elementor. There is no catalogue API:
// the team hand-builds one page per series, and that page carries the whole
// table of contents in reading order (volume cover -> chapter links). It is
// therefore the source of truth for chapters, and it is parsed from raw HTML
// rather than through DOM queries, because the chapter list is a document-ordered
// interleaving of <figcaption> volume labels and <p> link rows that
// selector-by-selector queries cannot reassemble.
//
// The one exception is the ORV web-novel page, which uses Elementor's "posts"
// widget with load-more pagination (so the HTML only holds the first 50
// chapters). That case is detected and completed through the open WP REST API.

const SECTION_PAGES = [
    { path: "/jg-ln/", section: "JG LN" },
    { path: "/jg-web-novel/", section: "JG Web Novel" },
    { path: "/jg-autres-lns/", section: "Autres LNs" }
];

// Pages that are navigation, not series -- they must never be mistaken for a
// chapter link when a series page links back to them.
const NON_SERIES_SLUGS = ["jg-ln", "jg-web-novel", "jg-autres-lns", "jg-manga", "actualites",
    "a-propos", "faq-jgarden", "recrutement", "series-en-pause", "series-abandonnees",
    "series-en-terminees", "elementor-19", "accueil", "free-download"];

// Link shorteners and shops the team puts on the volume covers, plus the
// partner teams advertised in the "Autres LNs" section.
const EXTERNAL_HOSTS = ["clictune.com", "amazon.", "discord.", "twitch.tv", "youtube.com",
    "x.com", "twitter.com", "ko-fi.com", "novelfrance.fr", "toaruln.fr", "kisswood.eu",
    "yumenovel.wordpress.com", "yumenovel.fr", "facebook.com", "instagram.com"];

// WordPress categories that hold site news rather than a series' chapters.
const NON_SERIES_CATEGORIES = ["actualite", "actualites", "non-classe", "uncategorized"];

const ENTITIES = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", shy: "",
    hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
    ndash: "–", mdash: "—", laquo: "«", raquo: "»", middot: "·",
    deg: "°", eacute: "é", egrave: "è", ecirc: "ê", euml: "ë",
    agrave: "à", acirc: "â", ccedil: "ç", icirc: "î", iuml: "ï",
    ocirc: "ô", oelig: "œ", ugrave: "ù", ucirc: "û", uuml: "ü",
    Eacute: "É", Egrave: "È", Agrave: "À", Ccedil: "Ç"
};

// Tags kept in a chapter body. Images are handled separately, because the pass
// that strips every attribute would take their src with it.
const KEEP_TAGS = "p|br|i|em|b|strong|u|s|h1|h2|h3|h4|h5|h6|hr|blockquote|ul|ol|li";
const IMAGE_MARKER = "{{jg-img-N}}";
const IMAGE_MARKER_RE = /\{\{jg-img-(\d+)\}\}/g;

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
        this._catalog = null;
        this._titles = null;
    }

    getPreference(key) {
        return new SharedPreferences().get(key);
    }

    boolPreference(key, fallback) {
        const value = this.getPreference(key);
        if (value === null || value === undefined) return fallback;
        return value === true || value === "true";
    }

    get baseUrl() {
        return ((this.source && this.source.baseUrl) || "https://j-garden.fr").replace(/\/+$/, "");
    }

    get apiUrl() {
        return (this.source && this.source.apiUrl) || this.baseUrl + "/wp-json/wp/v2";
    }

    getHeaders(url) {
        return {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            "Accept-Language": "fr-FR,fr;q=0.9",
            "Referer": this.baseUrl + "/"
        };
    }

    // -- HTTP -----------------------------------------------------------------

    async fetchText(url) {
        const res = await this.client.get(url, this.getHeaders(url));
        if (!res || res.statusCode >= 400) {
            throw new Error(`J-Garden: HTTP ${res ? res.statusCode : "?"} sur ${url}`);
        }
        return res.body || "";
    }

    // WP REST always answers JSON; a themed HTML error page means the API has
    // been switched off, and callers fall back to scraping.
    async fetchApi(path) {
        const body = await this.fetchText(this.apiUrl + path);
        try {
            return JSON.parse(body);
        } catch (_) {
            throw new Error(`J-Garden: reponse non-JSON sur ${path}`);
        }
    }

    // -- Text helpers ---------------------------------------------------------

    decodeEntities(text) {
        return String(text || "").replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity) => {
            if (entity[0] === "#") {
                const hex = entity[1] === "x" || entity[1] === "X";
                const code = parseInt(hex ? entity.slice(2) : entity.slice(1), hex ? 16 : 10);
                return isNaN(code) ? match : String.fromCharCode(code);
            }
            if (ENTITIES[entity] !== undefined) return ENTITIES[entity];
            const lower = entity.toLowerCase();
            return ENTITIES[lower] !== undefined ? ENTITIES[lower] : match;
        });
    }

    // Flattens markup onto one line -- used for names, labels and captions.
    textOf(html) {
        const stripped = String(html || "")
            .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
            .replace(/<br\s*\/?>/gi, " ")
            .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, " ")
            .replace(/<[^>]*>/g, "");
        return this.decodeEntities(stripped).replace(/ /g, " ").replace(/\s+/g, " ").trim();
    }

    // Same, but keeps paragraph breaks -- used for the synopsis.
    blockTextOf(html) {
        const stripped = String(html || "")
            .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
            .replace(/<[^>]*>/g, "");
        return this.decodeEntities(stripped)
            .replace(/ /g, " ")
            .replace(/[ \t]+/g, " ")
            .replace(/ *\n */g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }

    // Everything worth parsing lives inside <main>; the header and footer menus
    // link to every series on the site and would poison every scan.
    mainOf(html) {
        const text = String(html || "");
        const start = text.indexOf("<main");
        if (start < 0) return text;
        const end = text.indexOf("</main>", start);
        return end < 0 ? text.slice(start) : text.slice(start, end);
    }

    // -- URL helpers ----------------------------------------------------------

    // The team hand-writes hrefs, so pages mix absolute, root-relative and
    // outright broken links -- e.g. "http://the-insipid-prince-t1-chapitre-1-partie-5/",
    // where the slug ended up as the host. Anything whose host has no dot in it
    // is treated as one of those typos and folded back onto the site.
    absoluteUrl(href) {
        let value = this.decodeEntities(String(href || "").trim());
        if (!value) return "";
        if (value.startsWith("//")) value = "https:" + value;

        const scheme = value.match(/^https?:\/\/([^/?#]*)(.*)$/i);
        if (scheme) {
            const host = scheme[1];
            if (host.indexOf(".") < 0) return this.baseUrl + "/" + host + (scheme[2] || "");
            if (host.indexOf("j-garden.fr") < 0) return value;
            return this.baseUrl + (scheme[2] || "/");
        }
        return this.baseUrl + (value.startsWith("/") ? value : "/" + value);
    }

    pathOf(url) {
        const absolute = this.absoluteUrl(url);
        return absolute.indexOf(this.baseUrl) === 0 ? absolute.slice(this.baseUrl.length) || "/" : absolute;
    }

    slugOf(url) {
        const parts = this.pathOf(url).split(/[?#]/)[0].split("/").filter(part => part);
        return parts.length ? parts[parts.length - 1] : "";
    }

    isExternal(url) {
        const lower = String(url || "").toLowerCase();
        return EXTERNAL_HOSTS.some(host => lower.indexOf(host) >= 0);
    }

    // A link is a content candidate when it stays on the site, is not one of the
    // navigation pages, and is not a WordPress archive route.
    isSiteContentLink(href) {
        if (!href || href.startsWith("#") || href.toLowerCase().startsWith("mailto:")) return false;
        if (this.isExternal(href)) return false;

        const url = this.absoluteUrl(href);
        if (url.indexOf(this.baseUrl) !== 0) return false;

        const path = this.pathOf(url).split(/[?#]/)[0];
        if (path === "/" || path === "") return false;
        if (/^\/(category|tag|author|feed|wp-|comments|page)\b/i.test(path)) return false;
        return NON_SERIES_SLUGS.indexOf(this.slugOf(url)) < 0;
    }

    normalizeText(text) {
        const lower = String(text || "").toLowerCase();
        return lower.normalize ? lower.normalize("NFD").replace(/[̀-ͯ]/g, "") : lower;
    }

    prettifySlug(slug) {
        const words = String(slug || "").replace(/-/g, " ").trim();
        return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Sans titre";
    }

    // -- Catalogue ------------------------------------------------------------

    // The section pages show each series as a banner image wrapped in a link,
    // with no readable title anywhere in the markup (the images have empty alt
    // text) -- so titles come from the pages endpoint, one request for the site.
    async pageTitles() {
        if (this._titles) return this._titles;
        const titles = {};
        try {
            const pages = await this.fetchApi("/pages?per_page=100&_fields=slug,title");
            for (const page of pages || []) {
                if (page && page.slug) titles[page.slug] = this.textOf((page.title || {}).rendered || "");
            }
        } catch (_) {
            // Titles fall back to the slug; browsing still works.
        }
        this._titles = titles;
        return titles;
    }

    async getCatalog() {
        if (this._catalog) return this._catalog;

        const titles = await this.pageTitles();
        const list = [];
        const seen = {};

        for (const entry of SECTION_PAGES) {
            let main;
            try {
                main = this.mainOf(await this.fetchText(this.baseUrl + entry.path));
            } catch (_) {
                continue;
            }

            const anchor = /<a\b([^>]*)>\s*(<img\b[^>]*>)\s*<\/a>/gi;
            let match;
            while ((match = anchor.exec(main)) !== null) {
                const href = (match[1].match(/href\s*=\s*["']([^"']*)["']/i) || [])[1];
                // "Autres LNs" also advertises partner teams; those live on
                // other sites and cannot be read through this extension.
                if (!href || !this.isSiteContentLink(href)) continue;

                const link = this.absoluteUrl(href).replace(/\/?$/, "/");
                if (seen[link]) continue;
                seen[link] = true;

                const slug = this.slugOf(link);
                const src = (match[2].match(/\ssrc\s*=\s*["']([^"']*)["']/i) || [])[1];
                list.push({
                    name: titles[slug] || this.prettifySlug(slug),
                    link: link,
                    imageUrl: src ? this.absoluteUrl(src) : "",
                    section: entry.section
                });
            }
        }

        this._catalog = list;
        return list;
    }

    // -- Browse ---------------------------------------------------------------

    get supportsLatest() {
        return true;
    }

    // The whole catalogue fits on the section pages, so there is never a page 2.
    async getPopular(page) {
        const list = (await this.getCatalog())
            .map(item => ({ name: item.name, link: item.link, imageUrl: item.imageUrl }));
        return { list, hasNextPage: false };
    }

    // The home page carousel is the team's own "latest releases" shelf, and it
    // carries portrait volume covers instead of the wide section banners.
    async getLatestUpdates(page) {
        const catalog = await this.getCatalog();
        const titles = await this.pageTitles();
        const byLink = {};
        for (const item of catalog) byLink[item.link] = item;

        let main;
        try {
            main = this.mainOf(await this.fetchText(this.baseUrl + "/"));
        } catch (_) {
            return await this.getPopular(page);
        }

        const list = [];
        const seen = {};
        const slide = /<div class="swiper-slide"[^>]*>([\s\S]*?)<\/div>\s*<\/a>/gi;
        let match;
        while ((match = slide.exec(main)) !== null) {
            const block = match[1];
            const href = (block.match(/href\s*=\s*["']([^"']*)["']/i) || [])[1];
            if (!href || !this.isSiteContentLink(href)) continue;

            const link = this.absoluteUrl(href).replace(/\/?$/, "/");
            if (seen[link]) continue;
            seen[link] = true;

            const cover = (block.match(/background-image:\s*url\(\s*(?:&#0?39;|['"])?([^'")&]+)/i) || [])[1];
            const known = byLink[link];
            const slug = this.slugOf(link);
            list.push({
                name: (known && known.name) || titles[slug] || this.prettifySlug(slug),
                link: link,
                imageUrl: cover ? this.absoluteUrl(cover) : (known ? known.imageUrl : "")
            });
        }

        if (!list.length) return await this.getPopular(page);
        return { list, hasNextPage: false };
    }

    // Barely two dozen series exist, so search filters the catalogue locally.
    // WordPress' own search returns chapters, not series, which is not useful here.
    async search(query, page, filters) {
        const selected = (filter, fallback) => {
            if (!filter || !filter.values || typeof filter.state !== "number") return fallback;
            return (filter.values[filter.state] || {}).value || fallback;
        };

        const hasFilters = !!(filters && filters.length);
        const section = hasFilters ? selected(filters[0], "all") : "all";
        const sort = hasFilters ? selected(filters[1], "site") : "site";

        let list = (await this.getCatalog()).slice();
        if (section !== "all") list = list.filter(item => item.section === section);

        const needle = this.normalizeText(query).trim();
        if (needle) {
            list = list.filter(item =>
                this.normalizeText(item.name).indexOf(needle) >= 0 ||
                this.normalizeText(this.slugOf(item.link)).indexOf(needle) >= 0);
        }

        if (sort === "az") list.sort((a, b) => a.name.localeCompare(b.name));
        else if (sort === "za") list.sort((a, b) => b.name.localeCompare(a.name));

        return {
            list: list.map(item => ({ name: item.name, link: item.link, imageUrl: item.imageUrl })),
            hasNextPage: false
        };
    }

    // -- Detail ---------------------------------------------------------------

    async getDetail(url) {
        const link = this.absoluteUrl(url).replace(/\/?$/, "/");
        const main = this.mainOf(await this.fetchText(link));

        const heading = main.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
        let name = heading ? this.textOf(heading[1]) : "";
        if (!name) {
            const titles = await this.pageTitles();
            name = titles[this.slugOf(link)] || this.prettifySlug(this.slugOf(link));
        }

        // The first uploaded image inside <main> is the series' presentation art;
        // the header logo sits outside <main>, so it is skipped for free.
        const cover = main.match(/<img\b[^>]*?\ssrc\s*=\s*["']([^"']*\/wp-content\/uploads\/[^"']+)["']/i);
        const imageUrl = cover ? this.absoluteUrl(cover[1]) : ((this.source && this.source.iconUrl) || "");

        const info = this.readInfo(main);
        let chapters = this.readChapters(main, link);
        if (chapters.length) chapters = await this.enrichChapters(chapters);
        else chapters = await this.readWidgetChapters(main);

        let description = info.description;
        if (!chapters.length) {
            description = (description ? description + "\n\n" : "") +
                "Aucun chapitre n'est lisible en ligne pour cette serie : la J-Garden " +
                "n'en propose que les tomes complets, en telechargement sur le site.";
        }

        return {
            name,
            imageUrl,
            description,
            link,
            status: info.status,
            author: info.author,
            genre: info.genre,
            chapters: chapters.reverse()
        };
    }

    // The header block above the table of contents is a run of text widgets: an
    // emoji-labelled metadata list, then the synopsis. Everything before the
    // first chapter link belongs to the description.
    readInfo(main) {
        const widget = /elementor-widget-text-editor[\s\S]*?<div class="elementor-widget-container">([\s\S]*?)<\/div>\s*<\/div>/gi;
        const parts = [];
        let match;
        while ((match = widget.exec(main)) !== null) {
            const block = match[1];
            if (this.blockLinks(block).length) break;
            const text = this.blockTextOf(block);
            if (text) parts.push(text);
        }

        const description = parts.join("\n\n");
        const readLine = label => {
            const found = description.match(new RegExp(label + "\\s*:\\s*([^\\n]+)", "i"));
            return found ? found[1].trim() : "";
        };

        const author = readLine("Auteur(?:e|s|es)?");
        const genre = readLine("Genres?")
            .split(/[–—,/]|\s-\s/)
            .map(value => value.trim())
            .filter(value => value);

        // "Nombre de volumes : 11 Tomes (en cours)" is the closest thing the
        // site has to a publication status.
        const volumes = readLine("Nombre de volumes?");
        let status = 5;
        if (/en\s*cours/i.test(volumes)) status = 0;
        else if (/termin/i.test(volumes)) status = 1;

        return { description, author, genre, status };
    }

    blockLinks(block) {
        const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
        const links = [];
        let match;
        while ((match = anchor.exec(block)) !== null) {
            if (/<img\b/i.test(match[2])) continue;
            const href = (match[1].match(/href\s*=\s*["']([^"']*)["']/i) || [])[1];
            if (!href || !this.isSiteContentLink(href)) continue;
            links.push({ href, text: this.textOf(match[2]), at: match.index });
        }
        return links;
    }

    // Walks <figcaption>, <p> and <li> in document order. A <figcaption> is a
    // volume cover's caption ("Tome 3"), so it opens a new volume; a paragraph
    // holding links is a chapter row.
    //
    // Long chapters are split into parts, and the site writes those two ways:
    // a title paragraph followed by a "P1 / P2 / P3" row (hence the pending
    // title carried over between paragraphs), or the title and the part links
    // inside one paragraph (hence the text before the first link).
    readChapters(main, seriesLink) {
        const node = /<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>|<p\b[^>]*>([\s\S]*?)<\/p>|<li\b[^>]*>([\s\S]*?)<\/li>/gi;
        const withVolume = this.boolPreference("jgarden_pref_volume_prefix", true);
        const chapters = [];
        const seen = {};
        let volume = "";
        let pending = "";
        let match;

        while ((match = node.exec(main)) !== null) {
            if (match[1] !== undefined) {
                const caption = this.textOf(match[1]);
                if (caption) volume = caption.length > 60 ? caption.slice(0, 60).trim() : caption;
                pending = "";
                continue;
            }

            const block = match[2] !== undefined ? match[2] : match[3];
            const links = this.blockLinks(block)
                .filter(item => this.absoluteUrl(item.href).replace(/\/?$/, "/") !== seriesLink);

            if (!links.length) {
                const text = this.textOf(block);
                if (text && text.length <= 200) pending = text;
                continue;
            }

            const blockText = this.textOf(block);
            const title = this.textOf(block.slice(0, links[0].at)) || pending;
            for (const item of links) {
                let label;
                if (links.length === 1) label = blockText || item.text;
                else if (title) label = title + " – " + item.text;
                else label = item.text;

                this.pushChapter(chapters, seen,
                    withVolume && volume ? volume + " – " + label : label, item.href, null);
            }
            pending = "";
        }
        return chapters;
    }

    // Identity of a chapter, used for de-duplication and for matching a scraped
    // table-of-contents row against the WP post behind it. Lower-cased because
    // a handful of hand-written links capitalise the slug (WordPress resolves
    // those, but they must not be mistaken for a second, different chapter).
    chapterKey(url) {
        return this.pathOf(url).split(/[?#]/)[0].replace(/\/?$/, "/").toLowerCase();
    }

    pushChapter(chapters, seen, name, href, dateUpload) {
        const path = this.chapterKey(href);
        if (path === "/" || seen[path]) return;
        seen[path] = true;
        chapters.push({
            name: name || this.prettifySlug(this.slugOf(path)),
            url: path,
            scanlator: "",
            dateUpload
        });
    }

    // The table of contents is maintained by hand, so it regularly trails the
    // chapters that are already published -- and it carries no dates at all.
    // Chapters are WP posts filed under one category per series, so looking up
    // the category of a few sampled chapters gives both: real upload dates for
    // the listed chapters, and the published ones the page has yet to link.
    async enrichChapters(chapters) {
        try {
            const sample = [];
            for (const index of [0, Math.floor(chapters.length / 2), chapters.length - 1]) {
                const slug = this.slugOf(chapters[index].url);
                if (slug && sample.indexOf(slug) < 0) sample.push(slug);
            }

            const probes = await this.fetchApi(
                `/posts?slug=${sample.map(encodeURIComponent).join(",")}&per_page=10&_fields=categories`);
            const ids = [];
            for (const probe of probes || []) {
                for (const id of probe.categories || []) if (ids.indexOf(id) < 0) ids.push(id);
            }
            if (!ids.length) return chapters;

            const terms = await this.fetchApi(`/categories?include=${ids.join(",")}&_fields=id,slug`);
            const usable = (terms || [])
                .filter(term => NON_SERIES_CATEGORIES.indexOf(term.slug) < 0)
                .map(term => term.id);
            if (!usable.length) return chapters;

            const posts = {};
            for (const id of usable) {
                for (let page = 1; page <= 5; page++) {
                    const batch = await this.fetchApi(
                        `/posts?categories=${id}&per_page=100&page=${page}` +
                        "&orderby=date&order=asc&_fields=title,link,date_gmt");
                    if (!batch || !batch.length) break;
                    for (const post of batch) posts[this.chapterKey(post.link)] = post;
                    if (batch.length < 100) break;
                }
            }

            const seen = {};
            for (const chapter of chapters) {
                const key = this.chapterKey(chapter.url);
                seen[key] = true;
                const date = posts[key] ? Date.parse(posts[key].date_gmt + "Z") : NaN;
                if (!isNaN(date)) chapter.dateUpload = String(date);
            }

            const missing = Object.keys(posts)
                .filter(key => !seen[key])
                .map(key => posts[key])
                .sort((a, b) => Date.parse(a.date_gmt) - Date.parse(b.date_gmt));

            for (const post of missing) {
                const date = Date.parse(post.date_gmt + "Z");
                this.pushChapter(chapters, seen, this.textOf((post.title || {}).rendered || ""),
                    post.link, isNaN(date) ? null : String(date));
            }
        } catch (_) {
            // REST unavailable -- the scraped table of contents stands on its own.
        }
        return chapters;
    }

    // The ORV web-novel page uses Elementor's posts widget with load-more, so
    // only the first 50 chapters are in the HTML. The widget stamps the WP
    // category onto every card (class="... category-orv"), which is enough to
    // pull the complete, correctly ordered list from the REST API.
    async readWidgetChapters(main) {
        const chapters = [];
        const seen = {};

        const category = (main.match(/<article[^>]*\bclass="[^"]*\bcategory-([\w-]+)/i) || [])[1];
        if (category) {
            try {
                const terms = await this.fetchApi(`/categories?slug=${encodeURIComponent(category)}&_fields=id`);
                const id = terms && terms.length ? terms[0].id : null;
                if (id) {
                    for (let page = 1; page <= 10; page++) {
                        const posts = await this.fetchApi(
                            `/posts?categories=${id}&per_page=100&page=${page}` +
                            "&orderby=date&order=asc&_fields=title,link,date_gmt");
                        if (!posts || !posts.length) break;
                        for (const post of posts) {
                            const date = Date.parse(post.date_gmt + "Z");
                            this.pushChapter(chapters, seen,
                                this.textOf((post.title || {}).rendered || ""),
                                post.link, isNaN(date) ? null : String(date));
                        }
                        if (posts.length < 100) break;
                    }
                    if (chapters.length) return chapters;
                }
            } catch (_) {
                // REST unavailable -- fall through to the cards present in the HTML.
            }
        }

        const card = /<h2 class="elementor-post__title">\s*<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
        let match;
        while ((match = card.exec(main)) !== null) {
            const href = (match[1].match(/href\s*=\s*["']([^"']*)["']/i) || [])[1];
            if (!href || !this.isSiteContentLink(href)) continue;
            this.pushChapter(chapters, seen, this.textOf(match[2]), href, null);
        }
        return chapters;
    }

    // -- Chapter content ------------------------------------------------------

    // Chapters are ordinary WP posts, so the REST API hands back just the body
    // instead of a 100 KB themed page. Scraping stays as the fallback.
    async getHtmlContent(name, url) {
        const slug = this.slugOf(url);
        let body = "";

        if (slug) {
            try {
                const posts = await this.fetchApi(`/posts?slug=${encodeURIComponent(slug)}&_fields=content`);
                if (posts && posts.length) body = (posts[0].content || {}).rendered || "";
            } catch (_) {
                // fall through to the rendered page
            }
        }
        if (!body) body = this.mainOf(await this.fetchText(this.absoluteUrl(url)));

        return await this.cleanHtmlContent(body, name);
    }

    async cleanHtmlContent(html, name) {
        const widget = /elementor-widget-text-editor[\s\S]*?<div class="elementor-widget-container">([\s\S]*?)<\/div>\s*<\/div>/gi;
        const blocks = [];
        let match;
        while ((match = widget.exec(html)) !== null) blocks.push(match[1]);

        // Every chapter body sits in text widgets; if Elementor is ever dropped,
        // fall back to whatever markup the post returned.
        let content = blocks.length ? blocks.join("\n") : String(html || "");
        const keepImages = this.boolPreference("jgarden_pref_images", true);

        // Illustrations are lifted out first and put back at the end, so the
        // attribute-stripping pass below cannot take their src with it.
        const images = [];
        content = content
            .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, "")
            .replace(/<figcaption\b[\s\S]*?<\/figcaption>/gi, "")
            .replace(/<img\b[^>]*>/gi, tag => {
                const src = (tag.match(/\ssrc\s*=\s*["']([^"']+)["']/i) || [])[1];
                if (!keepImages || !src) return "";
                images.push(this.absoluteUrl(src));
                return IMAGE_MARKER.replace("N", String(images.length - 1));
            })
            // Inline styles hard-code the site's colours and fonts, which are
            // unreadable against the reader's own theme, so every attribute goes.
            .replace(new RegExp(`<(/?)(${KEEP_TAGS})\\b[^>]*>`, "gi"), "<$1$2>")
            .replace(new RegExp(`<(?!/?(?:${KEEP_TAGS})\\b)[^>]*>`, "gi"), "")
            .replace(/(?:\s*<p>\s*<\/p>)+/gi, "")
            .replace(/[ \t]+/g, " ")
            .replace(IMAGE_MARKER_RE, (marker, index) => `<img src="${images[index]}">`)
            .trim();

        // The body normally opens with its own title heading; only add one when
        // the post does not have it (the ORV chapters, for instance).
        if (name && !/^\s*<h[1-3]>/i.test(content)) {
            content = `<h2>${this.decodeEntities(name)}</h2><hr>` + content;
        }
        return content;
    }

    // -- Filters & preferences ------------------------------------------------

    getFilterList() {
        const options = (names, values) =>
            names.map((name, index) => ({ type_name: "SelectOption", name, value: values[index] }));

        return [
            {
                type_name: "SelectFilter",
                name: "Section",
                state: 0,
                values: options(
                    ["Toutes", "JG LN", "JG Web Novel", "Autres LNs"],
                    ["all", "JG LN", "JG Web Novel", "Autres LNs"])
            },
            {
                type_name: "SelectFilter",
                name: "Trier par",
                state: 0,
                values: options(["Ordre du site", "Titre (A-Z)", "Titre (Z-A)"], ["site", "az", "za"])
            }
        ];
    }

    getSourcePreferences() {
        return [
            {
                key: "jgarden_pref_volume_prefix",
                checkBoxPreference: {
                    title: "Prefixer les chapitres par le tome",
                    summary: "Affiche \"Tome 2 - 3. ...\" au lieu de \"3. ...\". Utile pour les series a plusieurs tomes.",
                    value: true
                }
            },
            {
                key: "jgarden_pref_images",
                checkBoxPreference: {
                    title: "Afficher les illustrations",
                    summary: "Conserve les images inserees dans les chapitres. Decochez pour du texte seul.",
                    value: true
                }
            }
        ];
    }
}
