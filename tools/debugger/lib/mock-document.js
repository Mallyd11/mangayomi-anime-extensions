'use strict';

const cheerio = require('cheerio');

class MockElement {
  constructor($, el) {
    this._$ = $;
    this._el = el;
  }

  // Property getter — matches mangayomi's Document API
  get text() {
    return this._$(this._el).text() || '';
  }

  attr(name) {
    const v = this._$(this._el).attr(name);
    return v !== undefined ? v : null;
  }

  get getSrc()    { return this.attr('src'); }
  get getHref()   { return this.attr('href'); }
  get outerHtml() { return this._$.html(this._el) || ''; }

  select(selector) {
    try {
      return this._$(this._el).find(selector).toArray()
        .map(el => new MockElement(this._$, el));
    } catch { return []; }
  }

  selectFirst(selector) {
    const r = this.select(selector);
    return r.length ? r[0] : null;
  }
}

class MockDocument {
  constructor(html) {
    this._$ = cheerio.load(html || '');
  }

  select(selector) {
    try {
      return this._$(selector).toArray()
        .map(el => new MockElement(this._$, el));
    } catch { return []; }
  }

  selectFirst(selector) {
    const r = this.select(selector);
    return r.length ? r[0] : null;
  }

  get text() {
    return this._$('body').text() || '';
  }

  attr(name) {
    const v = this._$('html').attr(name);
    return v !== undefined ? v : null;
  }
}

module.exports = { MockDocument, MockElement };
