'use strict';

class MockClient {
  constructor(logger) {
    this._logger = logger;
  }

  async _request(method, url, headers, body) {
    const entry = this._logger.startRequest(method, url, headers, body);
    const start = Date.now();

    const opts = {
      method,
      headers: headers || {},
      // 30-second timeout per request
      signal: AbortSignal.timeout(30000),
      // Follow redirects (default behavior)
    };

    if (body != null) {
      opts.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    try {
      const res = await fetch(url, opts);
      const text = await res.text();
      const elapsed = Date.now() - start;

      this._logger.finishRequest(entry, res.status, text.length, elapsed, text);

      // Warn on HTTP errors so they show up even when the extension swallows them
      if (res.status >= 400) {
        this._logger.warn(`Request #${entry.seq} returned HTTP ${res.status} — extension may silently return null`);
      }

      return {
        body: text,
        statusCode: res.status,
        headers: Object.fromEntries(res.headers.entries()),
      };
    } catch (err) {
      this._logger.failRequest(entry, err);
      // Re-throw so the extension's catch block fires; the logger already recorded it
      throw err;
    }
  }

  async get(url, headers) {
    return this._request('GET', url, headers, null);
  }

  async post(url, headers, body) {
    return this._request('POST', url, headers, body);
  }
}

module.exports = { MockClient };
