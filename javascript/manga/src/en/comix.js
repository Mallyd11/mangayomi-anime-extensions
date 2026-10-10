const mangayomiSources = [{
    "name": "Comix",
    "lang": "en",
    "baseUrl": "https://comix.to",
    "apiUrl": "https://comix.to/api",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://comix.to",
    "typeSource": "single",
    "itemType": 0,
    "isManga": true,
    "isNsfw": true,
    "version": "0.1.0",
    "pkgPath": "manga/src/en/comix.js",
    "notes": ""
}];

const StatusMap = {
    "releasing": 0,
    "finished": 1,
    "on_hiatus": 2,
    "discontinued": 3,
    "not_yet_released": 4,
    "unknown": 5
}

function parseRelativeTime(str) {
  const units = {
    s:   1000,
    m:   60000,
    h:   3600000,
    d:   86400000,
    w:   604800000,
    mo:  2592000000,
    mos: 2592000000,
    y:   31536000000,
  };

  const match = str.match(/^(\d+)\s*(mos|mo|[smhdwy])(?:\s*ago)?$/);
  if (!match) throw new Error("Unknown format: " + str);

  const amount = parseInt(match[1]);
  const unit   = match[2];
  if (!(unit in units)) throw new Error("Unknown unit: " + unit);

  return String(Date.now() - (amount * units[unit]));
}

function stripModule(src) {
    return src
        .replace(/export\s+default/g, "const __default_export =")
        .replace(/export\s+function/g, "function")
        .replace(/export\s+const/g, "const")
        .replace(/export\s*\{/g, "// export {");
}

let comixSigner = null; // { at, signRequest, readResponse }
const COMIX_SIGNER_TTL = 10 * 60 * 1000;

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
        this.prefs = new SharedPreferences();
        this.limit = 100;
        this.signer = false;
    }
    

    // The app's client decodes charset-less script bodies as Latin-1, which corrupts the
    // site's non-ASCII constants and makes its decoder silently skip. Undo that.
    _fixUtf8(text) {
        for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0xff) return text;
        try { return decodeURIComponent(escape(text)); } catch (e) { return text; }
    }

    async getSigner() {
        if (this.signer) return;
        if (comixSigner && Date.now() - comixSigner.at < COMIX_SIGNER_TTL) {
            this.signRequest = comixSigner.signRequest;
            this.readResponse = comixSigner.readResponse;
            this.signer = true;
            return;
        }

        const home = await this.client.get(`${this.source.baseUrl}/`);
        const cfg = (home.body.match(/<meta[^>]*name="cfg"[^>]*content="([^"]*)"/) || [])[1] || "";
        const mainPath = (home.body.match(/\/assets\/build\/[^"'\s]+\/dist\/main-[^"'\s]+\.js/) || [])[0];
        if (!mainPath) throw new Error("comix: main script not found");
        const dir = mainPath.slice(0, mainPath.lastIndexOf("/") + 1);
        const main = await this.client.get(`${this.source.baseUrl}${mainPath}`);
        const secureName = (main.body.match(/secure-[A-Za-z0-9_-]+\.js/) || [])[0];
        if (!secureName) throw new Error("comix: secure script not found");
        const res = await this.client.get(`${this.source.baseUrl}${dir}${secureName}`);

        const src = stripModule(this._fixUtf8(res.body)).replace(/\/\/ export \{([^}]*)\}\s*;?\s*$/, (m, list) =>
            "globalThis.__ex={" + list.split(",").map(x => {
                const [a, b] = x.trim().split(/\s+as\s+/);
                return b + ":" + a;
            }).join(",") + "};");

        const fn = new Function("context", `
            with (context) {
                ${src}
            }
            return context;
        `);

        (function(global) {
            if (global.TextEncoder) return;
            function TextEncoder() {
                if (!(this instanceof TextEncoder))
                    throw new TypeError("Class constructor TextEncoder cannot be invoked without 'new'");
            }
            TextEncoder.prototype.encode = function(str) {
                str = String(str);
                const utf8 = [];
                let i = 0;
                while (i < str.length) {
                    let code = str.charCodeAt(i++);
                    if (code < 0x80) utf8.push(code);
                    else if (code < 0x800) {
                        utf8.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
                    } else if (code >= 0xd800 && code <= 0xdbff && i < str.length) {
                        const next = str.charCodeAt(i++);
                        const cp = 0x10000 + ((code & 0x3ff) << 10) + (next & 0x3ff);
                        utf8.push(
                            0xf0 | (cp >> 18),
                            0x80 | ((cp >> 12) & 0x3f),
                            0x80 | ((cp >> 6) & 0x3f),
                            0x80 | (cp & 0x3f)
                        );
                    } else {
                        utf8.push(
                            0xe0 | (code >> 12),
                            0x80 | ((code >> 6) & 0x3f),
                            0x80 | (code & 0x3f)
                        );
                    }
                }
                return new Uint8Array(utf8);
            };
            Object.defineProperty(TextEncoder.prototype, "encoding", {
                get: () => "utf-8"
            });
            global.TextEncoder = TextEncoder;
        })(globalThis);

        (function (global) {
            if (global.TextDecoder) return;
            function TextDecoder(label = "utf-8") {
                this.label = String(label).toLowerCase();
            }
            TextDecoder.prototype.decode = function (input) {
                if (!input) return "";

                // ensure Uint8Array
                if (input instanceof ArrayBuffer)
                    input = new Uint8Array(input);
                else if (!(input instanceof Uint8Array))
                    input = new Uint8Array(input);
                let out = "";
                let i = 0;
                while (i < input.length) {
                    let c = input[i++];

                    if (c < 0x80) {
                        out += String.fromCharCode(c);
                    } 
                    else if (c >> 5 === 0x6) {
                        const c2 = input[i++] & 0x3f;
                        out += String.fromCharCode(((c & 0x1f) << 6) | c2);
                    } 
                    else if (c >> 4 === 0xe) {
                        const c2 = input[i++] & 0x3f;
                        const c3 = input[i++] & 0x3f;
                        out += String.fromCharCode(
                            ((c & 0x0f) << 12) |
                            (c2 << 6) |
                            c3
                        );
                    } 
                    else {
                        // 4-byte (surrogate pair)
                        const c2 = input[i++] & 0x3f;
                        const c3 = input[i++] & 0x3f;
                        const c4 = input[i++] & 0x3f;

                        let codepoint =
                            ((c & 0x07) << 18) |
                            (c2 << 12) |
                            (c3 << 6) |
                            c4;

                        codepoint -= 0x10000;

                        out += String.fromCharCode(
                            0xd800 + (codepoint >> 10),
                            0xdc00 + (codepoint & 0x3ff)
                        );
                    }
                }
                return out;
            };
            Object.defineProperty(TextDecoder.prototype, "encoding", {
                get: () => "utf-8"
            });
            global.TextDecoder = TextDecoder;
        })(typeof globalThis !== "undefined" ? globalThis : this);
        var fakeEl = {
            appendChild() {},
            setAttribute() {},
            addEventListener() {},
            removeChild() {}
        };
        const cfgEl = {
            content: cfg,
            getAttribute(n) { return n === "content" ? cfg : null; },
            setAttribute() {}, appendChild() {}, removeChild() {}, addEventListener() {}
        };
        const querySelector = function querySelector(q) { return /cfg/.test(String(q)) ? cfgEl : null; };
        Object.defineProperty(querySelector, "toString", {
            value: () => "function querySelector() { [native code] }"
        });
        Object.defineProperty(querySelector, "name", {
            value: "querySelector"
        });
        var B64CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        var B64TABLE = (function() {
            var t = {};
            for (var i = 0; i < B64CHARS.length; i++) t[B64CHARS[i]] = i;
            return t;
        })();
        function _atob(s) {
            s = String(s).replace(/[\t\n\f\r ]/g, "");
            var rem = s.length % 4;
            if (rem === 1) s += "A==";
            else if (rem === 2) s += "==";
            else if (rem === 3) s += "=";
            var o = "";
            for (var i = 0; i < s.length; i += 4) {
                var a = B64TABLE[s[i]]   | 0;
                var b = B64TABLE[s[i+1]] | 0;
                var c = s[i+2] === "=" ? 0 : (B64TABLE[s[i+2]] | 0);
                var d = s[i+3] === "=" ? 0 : (B64TABLE[s[i+3]] | 0);
                var n = (a << 18) | (b << 12) | (c << 6) | d;
                o += String.fromCharCode((n >> 16) & 255);
                if (s[i+2] !== "=") o += String.fromCharCode((n >> 8) & 255);
                if (s[i+3] !== "=") o += String.fromCharCode(n & 255);
            }
            return o;
        }

        function _btoa(s) {
            s = String(s);
            for (var i = 0; i < s.length; i++)
                if (s.charCodeAt(i) > 255) throw new Error("btoa: not latin1");
            var o = "";
            for (var i = 0; i < s.length; i += 3) {
                var a = s.charCodeAt(i);
                var b = s.charCodeAt(i+1);
                var c = s.charCodeAt(i+2);
                o += B64CHARS[a >> 2];
                o += B64CHARS[((a & 3) << 4) | (isNaN(b) ? 0 : b >> 4)];
                o += isNaN(b) ? "=" : B64CHARS[((b & 15) << 2) | (isNaN(c) ? 0 : c >> 6)];
                o += isNaN(c) ? "=" : B64CHARS[c & 63];
            }
            return o;
        }

        var fakeGlobal = {
            setTimeout(fn, ms) { return 1; },
            setInterval(fn, ms) { return 1; },
            clearTimeout() {},
            clearInterval() {},
            navigator: {
                appCodeName: "Mozilla",
                userAgent: "Mozilla/5.0",
                platform: "Win32",
            },
            location: {
                host: "comix.to",
                hostname: "comix.to",
                origin: "https://comix.to",
                href: "https://comix.to/",
                protocol: "https:",
                pathname: "/"
            },
            document: {
                createElement: () => fakeEl,
                addEventListener() {},
                querySelector,
                body: fakeEl,
                documentElement: fakeEl,
            },
            atob: _atob,
            btoa: _btoa,
            queueMicrotask: fn => Promise.resolve().then(fn),
            crypto: {
                getRandomValues(a) {
                    for (let i = 0; i < a.length; i++)
                        a[i] = (Math.random() * 256) | 0;
                    return a;
                }
            },
            performance: { now: () => Date.now() },
            TextEncoder,
            TextDecoder,
            encodeURIComponent,
            decodeURIComponent,
            isNaN, isFinite,
            parseInt, parseFloat,
            Math, Object, Array, String, Date,
            Promise, JSON, RegExp, Error,
            TypeError, RangeError,
            Map, Set, WeakMap, WeakSet,
            Symbol, Proxy, Reflect,
            Uint8Array, Int32Array, Float64Array, ArrayBuffer
        };

        fakeGlobal.window = fakeGlobal;
        fakeGlobal.self = fakeGlobal;
        fakeGlobal.globalThis = fakeGlobal;
        const g = fn(fakeGlobal);
        const fakeAxios = {
            defaults: { baseURL: "/api/v1", headers: { common: {} } },
            interceptors: {
                request: { use: f => { this.signRequest = f; } },
                response: { use: f => { this.readResponse = f; } }
            }
        };
        g.__ex.r(fakeAxios);
        if (!this.signRequest || !this.readResponse) throw new Error("comix: signer not available");
        this.signer = true;
        comixSigner = { at: Date.now(), signRequest: this.signRequest, readResponse: this.readResponse };
    }

    nest(flat) {
        const out = {};
        for (const key of Object.keys(flat)) {
            const m = key.match(/^([^\[]+)\[(.*)\]$/);
            if (!m) out[key] = flat[key];
            else if (m[2] === "") out[m[1]] = [].concat(flat[key]);
            else (out[m[1]] = out[m[1]] || {})[m[2]] = flat[key];
        }
        return out;
    }

    // GET /api/v1<path> with the site's own request signing and response decoding.
    async api(path, flat, retry) {
        await this.getSigner();
        const cfg = await this.signRequest({
            url: path, baseURL: "/api/v1", method: "get",
            params: this.nest(flat), headers: {}
        });
        const pairs = [];
        for (const k of Object.keys(flat)) {
            for (const v of [].concat(flat[k])) pairs.push(`${k}=${encodeURIComponent(v)}`);
        }
        pairs.push(`_=${encodeURIComponent(cfg.params._)}`);
        const resp = await this.client.get(`${this.source.apiUrl}/v1${path}?${pairs.join("&")}`);
        let data = JSON.parse(resp.body);
        if (data && data.code && /token|key_retired/.test(String(data.code)) && !retry) {
            comixSigner = null;
            this.signer = false;
            return await this.api(path, flat, true);
        }
        if (data && typeof data === "object" && "e" in data) {
            const r = await this.readResponse({
                data, config: cfg, status: 200, statusText: "OK",
                headers: { "content-type": "application/json", "x-enc": "2" }, request: {}
            });
            data = r.data;
            if (data && typeof data === "object" && "e" in data) {
                throw new Error("comix: response could not be decoded");
            }
        }
        if (data && data.status === "ok" && "result" in data) data = data.result;
        return data;
    }

    async getAPI(type, days, exclude_genres) {
        const flat = { type, days, limit: this.limit };
        if (exclude_genres.length) flat["exclude_genres[]"] = exclude_genres;
        return await this.api("/manga/top", flat);
    }

    comicData(comic) {
        return {
            name: comic.title,
            imageUrl: comic?.poster?.large ?? comic?.poster?.medium,
            link: `${this.source.baseUrl}/title/${comic.hid}`,
            description: comic.synopsis,
            status: StatusMap[comic.status] ?? 5,
            genre: comic?.genres?.map((g)=>g?.title)?.filter((g)=>g != null),
            author: comic?.authors?.map((a)=>a?.title)?.filter((a)=>a != null).join(" & "),
            artist: comic?.artists?.map((a)=>a?.title)?.filter((a)=>a != null).join(" & "),
        };
    }

    async getPopular(page) {
        const days = [1,7,30,90,180,365];
        const res = await this.getAPI("trending", days[page > 6 ? 6 : page-1], []);
        return {
            list: res.map(c => this.comicData(c)),
            hasNextPage: (page < 6)
        };
    }

    get supportsLatest() {
        return true;
    }

    getHeaders(url) {
        return {}
    }
    async getLatestUpdates(page) {
        const res = await this.api("/manga", {
            scope: "hot", limit: this.limit, "order[chapter_updated_at]": "desc", page
        });
        return {
            list: res.items.map(c => this.comicData(c)),
            hasNextPage: page != res.meta.lastPage
        }
    }
    async search(query, page, filters) {
        // just use order[relevance]=desc for now
        const res = await this.api("/manga", {
            keyword: query, limit: this.limit, page, "order[relevance]": "desc"
        });
        return {
            list: res.items.map(c => this.comicData(c)),
            hasNextPage: page != res.meta.lastPage
        }
    }
    mapChapter(c, url) {
        return {
            number: c.number,
            chapter: {
                name: c.name && c.name.length ? c.name : `Chapter ${c.number}`,
                url: `${url}/${c.id}`,
                dateUpload: parseRelativeTime(c.createdAtFormatted),
                scanlator: c.isOfficial ? "Official" : c.group?.name ?? "Unknown"
            }
        };
    }

    // Every chapter page for one /chapters query (optionally one group), pages fetched together.
    async fetchChapters(id, url, groupId) {
        const fetchPage = page => {
            const q = { limit: this.limit, "order[number]": "desc", page };
            if (groupId !== undefined && groupId !== null) q.group_id = groupId;
            return this.api(`/manga/${id}/chapters`, q);
        };
        const first = await fetchPage(1);
        const rest = [];
        for (let page = 2; page <= first.meta.lastPage; page++) rest.push(fetchPage(page));
        const results = [first].concat(await Promise.all(rest));
        const out = [];
        for (const j of results) for (const c of j.items) out.push(this.mapChapter(c, url));
        return out;
    }

    readPrefs() {
        let picked = ["auto"], other = "", fill = false;
        try {
            const v = new SharedPreferences().get("comix_pref_sources");
            if (v && v.length) picked = v;
        } catch (e) {}
        try { other = String(new SharedPreferences().get("comix_pref_other") || ""); } catch (e) {}
        try { fill = !!new SharedPreferences().get("comix_pref_fill"); } catch (e) {}
        const names = picked.filter(x => x !== "auto" && x !== "all");
        other.split(",").map(x => x.trim()).filter(x => x).forEach(x => names.push(x));
        return { auto: picked.indexOf("auto") >= 0, all: picked.indexOf("all") >= 0, names, fill };
    }

    async getChapters(url, comic) {
        const id = url.split("/").pop();
        const pref = this.readPrefs();

        if (pref.all || pref.fill) {
            // Needs the whole list: every group's copy (all) or the gaps in the chosen groups' copies (fill).
            const everything = await this.fetchChapters(id, url, null);
            if (pref.all) return everything.map(x => x.chapter);
            return await this.fillGaps(id, url, pref, everything);
        }
        const chosen = await this.chosenChapters(id, url, pref);
        return chosen.map(x => x.chapter);
    }

    async groupsOf(id) {
        const g = await this.api(`/manga/${id}/groups`, {});
        return (g && g.items) || [];
    }

    // Group ids picked by name; falls back to the most active group when none of the picks exist here.
    async pickGroupIds(id, pref, groups) {
        const ids = [];
        for (const name of pref.names) {
            const n = name.toLowerCase();
            const hit = groups.find(g => g.name.toLowerCase() === n) ||
                groups.find(g => g.name.toLowerCase().indexOf(n) >= 0);
            if (hit && ids.indexOf(hit.id) < 0) ids.push(hit.id);
        }
        if (ids.length && !pref.auto) return ids;

        // Most active group: whoever posted the most of the newest 20 chapters.
        const newest = await this.api(`/manga/${id}/chapters`, { limit: 20, "order[number]": "desc", page: 1 });
        const counts = {};
        for (const c of newest.items) if (c.group && c.group.id !== undefined) counts[c.group.id] = (counts[c.group.id] || 0) + 1;
        const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
        if (top !== undefined && ids.indexOf(Number(top)) < 0) ids.push(Number(top));
        return ids;
    }

    async chosenChapters(id, url, pref) {
        const groups = pref.names.length ? await this.groupsOf(id) : [];
        const ids = await this.pickGroupIds(id, pref, groups);
        if (!ids.length) return await this.fetchChapters(id, url, null);
        const lists = await Promise.all(ids.map(gid => this.fetchChapters(id, url, gid)));
        const merged = [].concat(...lists);
        merged.sort((a, b) => b.number - a.number);
        return merged;
    }

    async fillGaps(id, url, pref, everything) {
        const groups = await this.groupsOf(id);
        const ids = await this.pickGroupIds(id, pref, groups);
        const wanted = {};
        groups.filter(g => ids.indexOf(g.id) >= 0).forEach(g => { wanted[g.name] = true; });
        const out = [], have = {};
        for (const x of everything) if (wanted[x.chapter.scanlator]) { out.push(x); have[x.number] = true; }
        for (const x of everything) if (!wanted[x.chapter.scanlator] && !have[x.number]) { have[x.number] = true; out.push(x); }
        out.sort((a, b) => b.number - a.number);
        return out.map(x => x.chapter);
    }
    async getDetail(link) {
        const [id] = link.split("/").slice(-1);
        await this.getSigner();
        const [comic, chapters] = await Promise.all([
            this.api(`/manga/${id}`, {
                "includes[]": ["author", "artist", "genre", "theme", "demographic"]
            }),
            this.getChapters(link, null)
        ]);
        return {
            link,
            chapters,
            ...this.comicData(comic)
        };
    }
    async getPageList(url) {
        const chapter_id = url.split("/")[5];
        const res = await this.api(`/chapters/${chapter_id}`, {});
        const images = [];
        for (const page of res.pages.items) {
            images.push(/^https?:/.test(page.url) ? page.url : (res.pages.baseUrl ?? "") + page.url);
        }
        return images;
    }
    getFilterList() {
        return []
    }
    getSourcePreferences() {
        return [
            {
                key: "comix_pref_sources",
                multiSelectListPreference: {
                    title: "Chapter sources",
                    summary: "Comix lists a chapter once per scanlation group. Only the ticked groups are loaded (just that group's chapters are fetched, which is much faster than loading everything). Automatic picks the most active group for each title. If none of the ticked groups carry a title, Automatic is used for it.",
                    values: ["auto"],
                    entries: ["Automatic (most active group per title)", "All groups (everything, slower)", "Asura Scans", "CrowScans", "Demonic Scans", "Diva Scans", "DivaScans", "Dragon Tea", "Dusk Scans", "Elf Toon", "Eris Scans", "Eva Scans", "EZManga", "Flame Comics", "Genz Toons", "HiveToons", "Kaizen Scan", "KaynScan", "Lagoon Scans", "Lezhin", "Lonely Desk Scans", "Lua Comic", "Luna Toons", "MadaraScans", "MagusManga", "Manhuaga", "Manta", "Mewing Scanlation", "MistScans", "Nyrax manga", "Nyx Scans", "Official", "QI Scans", "Rage scans", "RedPandy", "Reset Scans", "Rezo Scans", "RinkoComics", "Rokari Comics", "Siren Scans", "StoneScape", "Tapas", "Temple Scan", "The Blank", "Thunderscans", "UToon", "Valir Scans", "Violet Scans", "Vortex Scans", "WebToon", "Witch Scans", "Writers Scans"],
                    entryValues: ["auto", "all", "Asura Scans", "CrowScans", "Demonic Scans", "Diva Scans", "DivaScans", "Dragon Tea", "Dusk Scans", "Elf Toon", "Eris Scans", "Eva Scans", "EZManga", "Flame Comics", "Genz Toons", "HiveToons", "Kaizen Scan", "KaynScan", "Lagoon Scans", "Lezhin", "Lonely Desk Scans", "Lua Comic", "Luna Toons", "MadaraScans", "MagusManga", "Manhuaga", "Manta", "Mewing Scanlation", "MistScans", "Nyrax manga", "Nyx Scans", "Official", "QI Scans", "Rage scans", "RedPandy", "Reset Scans", "Rezo Scans", "RinkoComics", "Rokari Comics", "Siren Scans", "StoneScape", "Tapas", "Temple Scan", "The Blank", "Thunderscans", "UToon", "Valir Scans", "Violet Scans", "Vortex Scans", "WebToon", "Witch Scans", "Writers Scans"],
                },
            },
            {
                key: "comix_pref_other",
                editTextPreference: {
                    title: "Other groups (optional)",
                    summary: "Comma-separated names of groups that are not in the list above. Part of the name is enough.",
                    value: "",
                    dialogTitle: "Other groups",
                    dialogMessage: "Matched case-insensitively against each title's group names.",
                },
            },
            {
                key: "comix_pref_fill",
                switchPreferenceCompat: {
                    title: "Fill gaps from other groups",
                    summary: "Show another group's copy of any chapter the ticked groups are missing. Slower: loads every group's chapters.",
                    value: false,
                },
            },
        ]
    }
}
