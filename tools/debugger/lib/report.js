'use strict';

function generateReport({ extension, version, baseUrl, method, methodArgs, result, fatalError, logEntries, requestLog }) {
  const lines = [];
  const now = new Date().toISOString();

  lines.push('# Mangayomi Extension Debug Report');
  lines.push('');
  lines.push(`**Date:** ${now}  `);
  lines.push(`**Extension:** ${extension} v${version}  `);
  lines.push(`**Base URL:** ${baseUrl}  `);
  lines.push(`**Method:** \`${method}\`  `);

  const argParts = [];
  if (methodArgs.url)   argParts.push(`url: \`${methodArgs.url}\``);
  if (methodArgs.query) argParts.push(`query: \`${methodArgs.query}\``);
  if (methodArgs.page)  argParts.push(`page: ${methodArgs.page}`);
  if (argParts.length)  lines.push(`**Args:** ${argParts.join(', ')}  `);
  lines.push('');

  // ── Summary ──────────────────────────────────────────────────────────────
  lines.push('## Summary');
  lines.push('');

  if (fatalError) {
    lines.push(`- **Status:** ❌ FATAL ERROR`);
    lines.push(`- **Error:** ${fatalError.message}`);
  } else if (result === null || result === undefined) {
    lines.push('- **Status:** ⚠️ RETURNED NULL — extension silently failed');
    const last = requestLog[requestLog.length - 1];
    if (last) {
      if (last.error) {
        lines.push(`- **Likely cause:** Network error — \`${last.error}\``);
      } else if (last.status >= 400) {
        lines.push(`- **Likely cause:** HTTP ${last.status} on last request`);
      } else {
        lines.push('- **Likely cause:** HTML/JSON parsing failure — all requests returned 2xx but result is null');
        lines.push('  > Check the response preview in Request Details below. A selector mismatch or changed page structure is the usual culprit.');
      }
    }
  } else if (Array.isArray(result) && result.length === 0) {
    lines.push('- **Status:** ⚠️ EMPTY ARRAY — no items found (selectors may not match)');
  } else if (result && Array.isArray(result.list) && result.list.length === 0) {
    lines.push('- **Status:** ⚠️ EMPTY LIST — no items found (selectors may not match)');
  } else {
    lines.push('- **Status:** ✅ SUCCESS');
  }

  lines.push(`- **HTTP Requests made:** ${requestLog.length}`);
  const errors = requestLog.filter(r => r.error || (r.status != null && r.status >= 400));
  if (errors.length) lines.push(`- **Failed requests:** ${errors.length} (see details below)`);
  lines.push('');

  // ── Request table ─────────────────────────────────────────────────────────
  lines.push('## Request Log');
  lines.push('');
  if (requestLog.length === 0) {
    lines.push('_No HTTP requests were made._');
  } else {
    lines.push('| # | Method | Status | Time | Size | URL |');
    lines.push('|---|--------|--------|------|------|-----|');
    for (const r of requestLog) {
      const status  = r.error ? '⚡ ERR' : String(r.status ?? '?');
      const time    = r.elapsed != null ? `${r.elapsed}ms` : '—';
      const size    = r.size   != null ? `${(r.size / 1024).toFixed(1)} KB` : '—';
      const urlText = r.url.length > 90 ? r.url.substring(0, 87) + '…' : r.url;
      lines.push(`| ${r.seq} | ${r.method} | ${status} | ${time} | ${size} | \`${urlText}\` |`);
    }
  }
  lines.push('');

  // ── Request details with response previews ────────────────────────────────
  if (requestLog.length > 0) {
    lines.push('## Request Details');
    lines.push('');
    for (const r of requestLog) {
      lines.push(`### Request #${r.seq}`);
      lines.push('');
      lines.push(`**${r.method}** \`${r.url}\``);
      lines.push('');

      if (Object.keys(r.headers || {}).length > 0) {
        lines.push('**Headers sent:**');
        lines.push('```');
        for (const [k, v] of Object.entries(r.headers)) lines.push(`${k}: ${v}`);
        lines.push('```');
        lines.push('');
      }

      if (r.requestBody != null) {
        const b = typeof r.requestBody === 'string' ? r.requestBody : JSON.stringify(r.requestBody);
        lines.push('**Request body:**');
        lines.push('```');
        lines.push(b.substring(0, 500));
        if (b.length > 500) lines.push('…(truncated)');
        lines.push('```');
        lines.push('');
      }

      if (r.error) {
        lines.push(`**Result:** ❌ Network error — \`${r.error}\``);
      } else {
        const ok = r.status >= 200 && r.status < 300 ? '✅' : '❌';
        lines.push(`**Result:** ${ok} HTTP ${r.status} — ${(r.size / 1024).toFixed(1)} KB in ${r.elapsed}ms`);
        lines.push('');
        lines.push('**Response body preview:**');
        lines.push('```html');
        lines.push(r.preview || '(empty body)');
        if (r.size > r.preview.length) lines.push(`\n…(${((r.size - r.preview.length) / 1024).toFixed(1)} KB more not shown)`);
        lines.push('```');
      }
      lines.push('');
    }
  }

  // ── Result ────────────────────────────────────────────────────────────────
  lines.push('## Result Value');
  lines.push('');
  if (fatalError) {
    lines.push('```');
    lines.push(fatalError.stack || fatalError.message);
    lines.push('```');
  } else {
    lines.push('```json');
    try {
      lines.push(JSON.stringify(result, null, 2) ?? 'null');
    } catch {
      lines.push(String(result));
    }
    lines.push('```');
  }
  lines.push('');

  // ── Full timestamped log ──────────────────────────────────────────────────
  lines.push('## Full Debug Log');
  lines.push('');
  lines.push('```');
  for (const e of logEntries) {
    lines.push(`[${e.time}] [${e.level.padEnd(8)}] ${e.message}`);
  }
  lines.push('```');
  lines.push('');
  lines.push('---');
  lines.push('_Generated by mangayomi-extension-debugger_');

  return lines.join('\n');
}

module.exports = { generateReport };
