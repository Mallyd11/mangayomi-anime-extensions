const mangayomiSources = [
  {
    "id": 584920173,
    "name": "Comix",
    "lang": "en",
    "baseUrl": "https://comix.to",
    "apiUrl": "",
    "iconUrl":
      "https://www.google.com/s2/favicons?sz=128&domain=https://comix.to",
    "typeSource": "single",
    "isManga": true,
    "itemType": 0,
    "hasCloudflare": true,
    "version": "0.1.0",
    "pkgPath": "manga/src/en/comix.js"
  }
];

// Request signing (HMAC-SHA256 from the site's precomputed key states) and
// response decoding for the site's /api/v1.

var KEY_B64='2yo5+KX8ZB/4gN7uMDqpQWN7lItlzW9ecvON6a62iSLoG0LadgmlHKn1FoesG0sPqyCazZjtFnukSECKqN1nBZ43l2gGtXOzNoQylA8oxO9vMvh3xp0zdvHgnN/70BfrZRavHbxSNASAMvi/N2fHGSvg/bdn2QH+oEA8ooCoN8PxTDmSeChm7NzvfYVQPWEviUuFXRPHausYkNAGJGSDiJH2OPMXuzK6ntwplbe9KnWHiAP7yPAFlMjQFiLUAIPBu6zu0RqIovV6QFc/4yc0zYAW+/kYTIg4M4kurZ/xWyM2o1vhJV1m9AlwIrmu4maiSWTLlfYqUb3J8EkltNbJIez0ZvGiyPEO54EcTdiAYMNezRNlAHB/wN+rrH/oFULI+Aigmn2JR87zUzMa9vQHFdgV7Q+22LOU6U3N+9HaVmsAS/aCQShsGyDeMp++wrJa3xAw/O4hCxqbZAafUp/ieniyZZJZTg1oKz1L7KyYRhFPCK3E81lCf/Bbd+5l1GBG67Id3RMj4Ztg9OPBMf9o3h9Nzxf6vS+0E9M/be710kc6eYsAlfMOtDbkklK3/H2dxDV+aTaG69IGLN6F+2ccD7nHmWnEVt3X/dWJHtSVAkG+PZeQhNUZO0vXIg/iuz3bz6wohzIdh4wEc2LfnkSdVxZSQskISRRSFp346QswWNQ/NRN5+1Msth9gKI1Xx1IXIRTwWv5OELWH4YZnDn4Umn31kVhlI99CqAfFx9kfRcH6uFICjs1S1kSDISvwQ8K0pUTgRO3GUPmYbbEU/W5XS3ZMiEUgSAuhNMMgeWFqCdQ6we9mRhkBZyuDkphNLPa3djldqVbc0DXLccQNoyrRwzQWPFtNfGvAst+TGVbGTlozzhi75h8xJsxZCql4B8ZKFPFH59QufwhgfUaWhPmcDp8rREPNEbOqTLrTcfw5l0TOBgR7ju2sn4+t8AzqdFREjK6uwdgPLThiLnWHh9odJLEjrilCtUJLoz0k/+C2lfLPLHEKy35PsSTZwsD+i95MKhZBTlYbBwITFYK83nBBEqzX/5rGLL4TUEWBYMHTomyjgXPW9ChzriEdF4UwLywaGnm4nmiFD+l/B5xr0yrEYKadZ4kSNZnDXZLr0/xV39e3jd7q6yHJK9JvZLB80KHcHxGaD/iVmSIHi5DyAV2aqfzO0oG2V97UC1zRvp58Elv+1L2KhVzDGV1W+ILkttt6jASMwfzY770GiucKUh3TUivODL1bJ0CiR/lhp4ZDW9GrcW/2QQoZqOEyk2fEOjEfStBEB+hUtR36gJwjT4PQP7vz2WYbmQmxV8CAgImnkl03UeccKDQ0K+UyFrwKzwKuVfZcvjDrWd3mwQaFZ1sDvzq05rUPSvOvlfUdbd1s168tp6aT3TW0vb/M02GShqb8CdU412+nwJElCtTzgMWvl07a65H3FHnOEQ81ldFmzXs=';
var B64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function b64dec(s){var t={},i,o=[],a=0,n=0;for(i=0;i<64;i++)t[B64[i]]=i;t['+']=62;t['/']=63;
 for(i=0;i<s.length;i++){var v=t[s[i]];if(v===undefined)continue;a=((a<<6)|v)&0xffff;n+=6;if(n>=8){n-=8;o.push((a>>n)&255);}}return o;}
function b64url(b){var s='',i;for(i=0;i<b.length;i+=3){var x=b[i],y=b[i+1],z=b[i+2];s+=B64[x>>2]+B64[((x&3)<<4)|(y>>4)];if(i+1<b.length)s+=B64[((y&15)<<2)|(z>>6)];if(i+2<b.length)s+=B64[z&63];}return s;}
var K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
function sha(state,msg,pre){var h=state.slice(),n=msg.length+pre,l=msg.length+1;while(l%64!==56)l++;var m=new Array(l+8).fill(0),i,j;for(i=0;i<msg.length;i++)m[i]=msg[i];m[msg.length]=128;var bits=n*8,hi=Math.floor(bits/4294967296),lo=bits>>>0,p=m.length-8;m[p]=hi>>>24&255;m[p+1]=hi>>>16&255;m[p+2]=hi>>>8&255;m[p+3]=hi&255;m[p+4]=lo>>>24&255;m[p+5]=lo>>>16&255;m[p+6]=lo>>>8&255;m[p+7]=lo&255;
 for(var o=0;o<m.length;o+=64){var w=[];for(i=0;i<16;i++)w[i]=((m[o+4*i]<<24)|(m[o+4*i+1]<<16)|(m[o+4*i+2]<<8)|m[o+4*i+3])|0;for(i=16;i<64;i++){var a=w[i-15],b=w[i-2];var s0=((a>>>7)|(a<<25))^((a>>>18)|(a<<14))^(a>>>3),s1=((b>>>17)|(b<<15))^((b>>>19)|(b<<13))^(b>>>10);w[i]=(w[i-16]+s0+w[i-7]+s1)|0;}
 var A=h[0],B=h[1],C=h[2],D=h[3],E=h[4],F=h[5],G=h[6],H=h[7];for(i=0;i<64;i++){var S1=((E>>>6)|(E<<26))^((E>>>11)|(E<<21))^((E>>>25)|(E<<7)),ch=(E&F)^(~E&G),t1=(H+S1+ch+K[i]+w[i])|0,S0=((A>>>2)|(A<<30))^((A>>>13)|(A<<19))^((A>>>22)|(A<<10)),mj=(A&B)^(A&C)^(B&C),t2=(S0+mj)|0;H=G;G=F;F=E;E=(D+t1)|0;D=C;C=B;B=A;A=(t1+t2)|0;}
 h[0]=(h[0]+A)|0;h[1]=(h[1]+B)|0;h[2]=(h[2]+C)|0;h[3]=(h[3]+D)|0;h[4]=(h[4]+E)|0;h[5]=(h[5]+F)|0;h[6]=(h[6]+G)|0;h[7]=(h[7]+H)|0;}
 var out=[];for(i=0;i<8;i++)out.push(h[i]>>>24&255,h[i]>>>16&255,h[i]>>>8&255,h[i]&255);return out;}
function utf8(s){var o=[],i;s=unescape(encodeURIComponent(s));for(i=0;i<s.length;i++)o.push(s.charCodeAt(i));return o;}
var KEY=null;function key(){if(!KEY){var r=b64dec(KEY_B64);KEY=r;}return KEY;}
function words(k,off){var r=[],i;for(i=0;i<8;i++){var p=off+i*4;r.push(((k[p]<<24)|(k[p+1]<<16)|(k[p+2]<<8)|k[p+3])|0);}return r;}
function sign(path){var k=key();var inner=sha(words(k,0),utf8(path),64);return 's8c.'+b64url(sha(words(k,32),inner,64)).slice(0,16);}
function canon(params){var parts=[];function add(n,v){if(v===undefined||v===null)return;if(Array.isArray(v)){v.forEach(function(x,i){add(n+'['+i+']',x);});return;}if(typeof v==='object'){Object.keys(v).sort().forEach(function(c){add(n===''?c:n+'['+c+']',v[c]);});return;}parts.push(n+'='+String(v));}
 Object.keys(params).filter(function(x){return x!=='_';}).sort().forEach(function(x){add(x,params[x]);});return parts.join('&');}
function flat(params){var o=[];function add(n,v){if(v===undefined||v===null)return;if(Array.isArray(v)){v.forEach(function(x,i){add(n+'['+i+']',x);});return;}if(typeof v==='object'){Object.keys(v).sort().forEach(function(c){add(n+'['+c+']',v[c]);});return;}o.push([n,String(v)]);}Object.keys(params).forEach(function(k){add(k,params[k]);});return o;}
function signedQuery(path,params){var q=canon(params);var s=sign(q?path+'?'+q:path);var o=flat(params).map(function(p){return p[0].replace(/\[/g,'%5B').replace(/\]/g,'%5D')+'='+encodeURIComponent(p[1]);});o.push('_='+s);return o.join('&');}
function decode(e){var d=b64dec(e);var kk=key();var off=((d[0]<<8)|d[1])%1024;var out=[],i;for(i=2;i<d.length;i++){out.push(d[i]^kk[64+((i-2+off)%1024)]);}return out;}

class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
  }

  getHeaders(url) {
    return {};
  }

  async api(path, params) {
    var url = `${this.source.baseUrl}/api/v1${path}?${signedQuery(path, params || {})}`;
    var res = await this.client.get(url, { Accept: "application/json" });
    var j = JSON.parse(res.body);
    if (j && typeof j.e === "string") {
      var bytes = decode(j.e);
      var s = "";
      for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      j = JSON.parse(decodeURIComponent(escape(s)));
    }
    if (j && j.error) throw new Error(j.message || j.error);
    if (j && j.status === "ok" && "result" in j) return j.result;
    return j;
  }

  mapList(result) {
    var list = (result.items || []).map((m) => ({
      name: m.title,
      imageUrl: (m.poster && (m.poster.large || m.poster.medium)) || "",
      link: m.hid,
    }));
    var meta = result.meta || {};
    return { list, hasNextPage: !!meta.hasNext };
  }

  async getPopular(page) {
    var r = await this.api("/manga", {
      page: parseInt(page),
      limit: 30,
      order: { views_30d: "desc" },
    });
    return this.mapList(r);
  }

  async getLatestUpdates(page) {
    var r = await this.api("/manga", {
      page: parseInt(page),
      limit: 30,
      order: { chapter_updated_at: "desc" },
    });
    return this.mapList(r);
  }

  async search(query, page, filters) {
    var params = { page: parseInt(page), limit: 30 };
    var q = (query || "").trim();
    if (q) params.keyword = q;
    var sort = filters[0].values[filters[0].state].value;
    if (!q || sort !== "relevance") {
      params.order = {};
      params.order[sort === "relevance" ? "views_30d" : sort] = "desc";
    } else {
      params.order = { relevance: "desc" };
    }
    var pick = (f) => f.state.filter((x) => x.state).map((x) => x.value);
    var types = pick(filters[1]);
    var statuses = pick(filters[2]);
    var genres = pick(filters[3]).map((x) => parseInt(x));
    if (types.length) params.types = types;
    if (statuses.length) params.statuses = statuses;
    if (genres.length) params.genres = genres;
    var r = await this.api("/manga", params);
    return this.mapList(r);
  }

  statusCode(s) {
    return (
      {
        releasing: 0,
        finished: 1,
        on_hiatus: 2,
        hiatus: 2,
        discontinued: 3,
        cancelled: 3,
      }[s] ?? 5
    );
  }

  async getDetail(url) {
    var hid = url.startsWith("http")
      ? url.split("/title/")[1].split("/")[0].split("-")[0]
      : url;
    var m = await this.api(`/manga/${hid}`);
    var names = (arr) => (arr || []).map((x) => x.title);
    var genre = names(m.genres).concat(names(m.demographics), names(m.formats));
    var author = names(m.authors).join(", ");
    var artist = names(m.artists).join(", ");
    var description = (m.synopsis || "").replace(/\r/g, "");

    var showAll = new SharedPreferences().get("comix_show_all_groups");
    var all = [];
    var page = 1;
    while (page <= 40) {
      var r = await this.api(`/manga/${hid}/chapters`, {
        page: page,
        limit: 100,
        order: { number: "desc" },
      });
      all = all.concat(r.items || []);
      if (!r.meta || !r.meta.hasNext) break;
      page++;
    }

    var chosen = all;
    if (!showAll) {
      var best = {};
      var order = [];
      for (var c of all) {
        var k = String(c.number);
        var cur = best[k];
        if (!cur) {
          best[k] = c;
          order.push(k);
        } else if (
          (c.isOfficial && !cur.isOfficial) ||
          (c.isOfficial === cur.isOfficial && (c.votes || 0) > (cur.votes || 0))
        ) {
          best[k] = c;
        }
      }
      chosen = order.map((k) => best[k]);
    }

    var chapters = chosen.map((c) => {
      var name = `Chapter ${c.number}`;
      if (c.volume) name = `Vol. ${c.volume} ${name}`;
      if (c.name) name += ` - ${c.name}`;
      var item = { name, url: String(c.id) };
      if (showAll && c.group && c.group.name) item.scanlator = c.group.name;
      return item;
    });

    return {
      name: m.title,
      imageUrl: (m.poster && (m.poster.large || m.poster.medium)) || "",
      description,
      author,
      artist,
      genre,
      status: this.statusCode(m.status),
      chapters,
    };
  }

  async getPageList(url) {
    var r = await this.api(`/chapters/${url}`);
    var items = (r.pages && r.pages.items) || [];
    // the image hosts reject requests that carry a comix.to Referer
    return items.map((p) => ({ url: p.url, headers: {} }));
  }

  getFilterList() {
    var opt = (arr) =>
      arr.map((x) => ({ type_name: "SelectOption", name: x[0], value: x[1] }));
    var cb = (arr) =>
      arr.map((x) => ({ type_name: "CheckBox", name: x[0], value: x[1] }));
    return [
      {
        type_name: "SelectFilter",
        name: "Sort",
        state: 0,
        values: opt([
          ["Relevance / Popular", "relevance"],
          ["Latest Update", "chapter_updated_at"],
          ["Recently Added", "created_at"],
          ["Most Followed", "follows_total"],
          ["Views (7 days)", "views_7d"],
          ["Views (30 days)", "views_30d"],
          ["Views (all time)", "views_total"],
          ["Title", "title"],
          ["Year", "year"],
        ]),
      },
      {
        type_name: "GroupFilter",
        name: "Type",
        state: cb([
          ["Manga", "manga"],
          ["Manhwa", "manhwa"],
          ["Manhua", "manhua"],
        ]),
      },
      {
        type_name: "GroupFilter",
        name: "Status",
        state: cb([
          ["Releasing", "releasing"],
          ["Finished", "finished"],
        ]),
      },
      {
        type_name: "GroupFilter",
        name: "Genre",
        state: cb([
          ["Action", "6"],
          ["Adventure", "7"],
          ["Drama", "11"],
          ["Fantasy", "12"],
        ]),
      },
    ];
  }

  getSourcePreferences() {
    return [
      {
        key: "comix_show_all_groups",
        switchPreferenceCompat: {
          title: "Show every scanlation group",
          summary:
            "Off: one entry per chapter number (official, then most voted). On: list each group's upload.",
          value: false,
        },
      },
    ];
  }
}
