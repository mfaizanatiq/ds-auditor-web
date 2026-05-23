/**
 * Build a self-contained HTML audit report for developer handoff.
 */
(function (global) {
  'use strict';

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function cssPropLabel(property, propertyLabel) {
    if (propertyLabel) return propertyLabel;
    if (!property) return '—';
    return property.replace(/([A-Z])/g, '-$1').toLowerCase();
  }

  function fixTokenName(fix) {
    if (!fix) return '—';
    if (fix.typeStyleLabel) return fix.typeStyleLabel;
    if (fix.compositeTokenName) return fix.compositeTokenName;
    return fix.tokenName || '—';
  }

  function fixCssSnippet(issue, fix) {
    if (!fix) return '—';
    var prop = issue.property === 'font' ? 'font' : (issue.property || '').replace(/([A-Z])/g, '-$1').toLowerCase();
    var token = fix.compositeTokenName || fix.tokenName;
    if (!token) return escapeHtml(fix.displayValue || fix.fix || '—');
    var varName = token.indexOf('--') === 0 ? token : '--' + token.replace(/^--/, '');
    if (issue.property === 'font' || issue.type === 'typography') {
      return 'font: var(' + escapeHtml(varName) + ');';
    }
    return escapeHtml(prop) + ': var(' + escapeHtml(varName) + ');';
  }

  function typeLabel(type) {
    var map = {
      color: 'Colour',
      typography: 'Typography',
      spacing: 'Padding / spacing',
      size: 'Size',
      effect: 'Shadow / effect',
    };
    return map[type] || type || 'Other';
  }

  function buildTableRows(rows, rowBuilder) {
    if (!rows.length) {
      return '<tr><td colspan="8" class="empty">None</td></tr>';
    }
    return rows.map(function (row, i) {
      return rowBuilder(row, i);
    }).join('');
  }

  function buildOpenRow(issue, index, fix) {
    fix = fix || (issue.fixes && issue.fixes[0]);
    return (
      '<tr>' +
        '<td class="num">' + index + '</td>' +
        '<td><code class="el">' + escapeHtml(issue.element) + '</code></td>' +
        '<td><code class="sel">' + escapeHtml(issue.selector || '—') + '</code></td>' +
        '<td>' + escapeHtml(typeLabel(issue.type)) + '</td>' +
        '<td>' + escapeHtml(cssPropLabel(issue.property, issue.propertyLabel)) + '</td>' +
        '<td><code class="val">' + escapeHtml(issue.found) + '</code></td>' +
        '<td><code class="token">' + escapeHtml(fixTokenName(fix)) + '</code></td>' +
        '<td><code class="css">' + fixCssSnippet(issue, fix) + '</code></td>' +
      '</tr>'
    );
  }

  function buildAppliedRow(entry, index) {
    return (
      '<tr class="applied-row">' +
        '<td class="num">' + index + '</td>' +
        '<td><code class="el">' + escapeHtml(entry.element) + '</code></td>' +
        '<td><code class="sel">' + escapeHtml(entry.selector || '—') + '</code></td>' +
        '<td>' + escapeHtml(typeLabel(entry.type)) + '</td>' +
        '<td>' + escapeHtml(cssPropLabel(entry.property, entry.propertyLabel)) + '</td>' +
        '<td><code class="val">' + escapeHtml(entry.found) + '</code></td>' +
        '<td><code class="token">' + escapeHtml(entry.tokenDisplay || entry.tokenName) + '</code></td>' +
        '<td><code class="css">' + escapeHtml(entry.cssSnippet || entry.cssValue || '—') + '</code></td>' +
      '</tr>'
    );
  }

  function buildIgnoredRow(issue, index, fix) {
    fix = fix || (issue.fixes && issue.fixes[0]);
    return (
      '<tr class="ignored-row">' +
        '<td class="num">' + index + '</td>' +
        '<td><code class="el">' + escapeHtml(issue.element) + '</code></td>' +
        '<td><code class="sel">' + escapeHtml(issue.selector || '—') + '</code></td>' +
        '<td>' + escapeHtml(typeLabel(issue.type)) + '</td>' +
        '<td>' + escapeHtml(cssPropLabel(issue.property, issue.propertyLabel)) + '</td>' +
        '<td><code class="val">' + escapeHtml(issue.found) + '</code></td>' +
        '<td><code class="token">' + escapeHtml(fixTokenName(fix)) + '</code></td>' +
        '<td class="note">Ignored for this page</td>' +
      '</tr>'
    );
  }

  var TABLE_HEAD =
    '<thead><tr>' +
      '<th>#</th><th>Element</th><th>Selector</th><th>Category</th>' +
      '<th>Property</th><th>Current value</th><th>Token to use</th><th>CSS change</th>' +
    '</tr></thead>';

  function buildReportHtml(options) {
    options = options || {};
    var report = options.report || {};
    var page = report.page || {};
    var openIssues = options.openIssues || [];
    var appliedFixes = options.appliedFixes || [];
    var ignoredIssues = options.ignoredIssues || [];
    var libraries = options.libraries || [];
    var auditedAt = report.auditedAt || new Date().toISOString();
    var exportAt = new Date().toISOString();
    var score = report.complianceScore != null ? report.complianceScore : '—';

    var openRows = buildTableRows(openIssues, function (issue, i) {
      return buildOpenRow(issue, i + 1, issue.fixes && issue.fixes[0]);
    });

    var appliedRows = buildTableRows(appliedFixes, function (entry, i) {
      return buildAppliedRow(entry, i + 1);
    });

    var ignoredRows = buildTableRows(ignoredIssues, function (issue, i) {
      return buildIgnoredRow(issue, i + 1, issue.fixes && issue.fixes[0]);
    });

    return (
      '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
      '<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>DS Auditor Report — ' + escapeHtml(page.title || 'Page') + '</title>\n' +
      '<style>\n' +
      ':root { --bg:#f6f7f9; --card:#fff; --text:#1a1a1a; --muted:#5c5c5c; --border:#e2e4e8; --brand:#0d99ff; --success:#0d7a3f; --warn:#b45309; }\n' +
      '* { box-sizing: border-box; }\n' +
      'body { margin: 0; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 14px; line-height: 1.5; color: var(--text); background: var(--bg); }\n' +
      '.wrap { max-width: 1200px; margin: 0 auto; padding: 32px 24px 48px; }\n' +
      'header { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 24px 28px; margin-bottom: 24px; }\n' +
      'h1 { margin: 0 0 8px; font-size: 22px; font-weight: 700; }\n' +
      '.subtitle { color: var(--muted); font-size: 13px; margin: 0 0 20px; }\n' +
      '.meta { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px 24px; font-size: 13px; }\n' +
      '.meta dt { color: var(--muted); font-weight: 600; margin: 0 0 2px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }\n' +
      '.meta dd { margin: 0; word-break: break-all; }\n' +
      '.score { font-size: 28px; font-weight: 800; color: var(--brand); }\n' +
      'section { background: var(--card); border: 1px solid var(--border); border-radius: 12px; margin-bottom: 20px; overflow: hidden; }\n' +
      'section h2 { margin: 0; padding: 16px 20px; font-size: 15px; font-weight: 700; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; }\n' +
      '.badge { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }\n' +
      '.badge-open { background: #fef3c7; color: var(--warn); }\n' +
      '.badge-applied { background: #d1fae5; color: var(--success); }\n' +
      '.badge-ignored { background: #e5e7eb; color: var(--muted); }\n' +
      '.hint { padding: 12px 20px; font-size: 12px; color: var(--muted); border-bottom: 1px solid var(--border); background: #fafbfc; }\n' +
      'table { width: 100%; border-collapse: collapse; font-size: 12px; }\n' +
      'th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; }\n' +
      'th { background: #f9fafb; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--muted); }\n' +
      'tr:last-child td { border-bottom: none; }\n' +
      'tr:hover td { background: #fafbfc; }\n' +
      '.num { color: var(--muted); width: 36px; }\n' +
      'code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11px; }\n' +
      'code.el { color: #1e40af; }\n' +
      'code.sel { color: #6b21a8; word-break: break-all; }\n' +
      'code.val { color: #b45309; }\n' +
      'code.token { color: #0d7a3f; font-weight: 600; }\n' +
      'code.css { color: #0f766e; white-space: nowrap; }\n' +
      'td.empty, .empty { text-align: center; color: var(--muted); font-style: italic; }\n' +
      'td.note { color: var(--muted); font-size: 11px; }\n' +
      '.applied-row td { background: #f0fdf4; }\n' +
      '.ignored-row td { opacity: 0.75; }\n' +
      'footer { text-align: center; font-size: 11px; color: var(--muted); margin-top: 24px; }\n' +
      '@media print { body { background: #fff; } section { break-inside: avoid; } }\n' +
      '</style>\n</head>\n<body>\n<div class="wrap">\n' +
      '<header>\n' +
        '<h1>DS Auditor — Design token report</h1>\n' +
        '<p class="subtitle">Action list for developers: what to change, which token to use, and where on the page.</p>\n' +
        '<dl class="meta">\n' +
          '<div><dt>Page</dt><dd>' + escapeHtml(page.title || '—') + '</dd></div>\n' +
          '<div><dt>URL</dt><dd><a href="' + escapeHtml(page.url || '#') + '">' + escapeHtml(page.url || '—') + '</a></dd></div>\n' +
          '<div><dt>Audited</dt><dd>' + escapeHtml(auditedAt) + '</dd></div>\n' +
          '<div><dt>Exported</dt><dd>' + escapeHtml(exportAt) + '</dd></div>\n' +
          '<div><dt>Compliance</dt><dd class="score">' + escapeHtml(score) + '%</dd></div>\n' +
          '<div><dt>Elements scanned</dt><dd>' + escapeHtml(report.scannedElements || 0) + '</dd></div>\n' +
          '<div><dt>Token libraries</dt><dd>' + escapeHtml(libraries.join(', ') || '—') + '</dd></div>\n' +
        '</dl>\n' +
      '</header>\n' +

      '<section id="action-required">\n' +
        '<h2>Action required <span class="badge badge-open">' + openIssues.length + ' open</span></h2>\n' +
        '<p class="hint">Update each element to use the design token in your codebase or CMS. Selector helps locate the node in DevTools.</p>\n' +
        '<table>' + TABLE_HEAD + '<tbody>' + openRows + '</tbody></table>\n' +
      '</section>\n' +

      '<section id="applied">\n' +
        '<h2>Applied in browser preview <span class="badge badge-applied">' + appliedFixes.length + '</span></h2>\n' +
        '<p class="hint">These fixes were previewed on the live page. Implement the same tokens in source for a permanent fix.</p>\n' +
        '<table>' + TABLE_HEAD + '<tbody>' + appliedRows + '</tbody></table>\n' +
      '</section>\n' +

      '<section id="ignored">\n' +
        '<h2>Ignored on this page <span class="badge badge-ignored">' + ignoredIssues.length + '</span></h2>\n' +
        '<p class="hint">Rules marked as accepted for this URL — no action needed unless you change your mind.</p>\n' +
        '<table>' + TABLE_HEAD.replace('CSS change', 'Note') + '<tbody>' + ignoredRows + '</tbody></table>\n' +
      '</section>\n' +

      '<footer>Generated by DS Auditor for Web</footer>\n' +
      '</div>\n</body>\n</html>'
    );
  }

  global.DSAuditorHtmlReport = {
    build: buildReportHtml,
    escapeHtml: escapeHtml,
  };
})(typeof window !== 'undefined' ? window : self);
