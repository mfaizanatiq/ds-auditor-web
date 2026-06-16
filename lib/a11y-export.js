/**
 * Accessibility audit export — Excel-compatible SpreadsheetML + CSV fallback.
 */
(function (global) {
  'use strict';

  var WCAG_CRITERION_NAMES = {
    '1.1.1': 'Non-text Content',
    '1.2.1': 'Audio-only and Video-only (Prerecorded)',
    '1.2.2': 'Captions (Prerecorded)',
    '1.2.3': 'Audio Description or Media Alternative',
    '1.3.1': 'Info and Relationships',
    '1.3.2': 'Meaningful Sequence',
    '1.3.3': 'Sensory Characteristics',
    '1.3.4': 'Orientation',
    '1.3.5': 'Identify Input Purpose',
    '1.4.1': 'Use of Color',
    '1.4.2': 'Audio Control',
    '1.4.3': 'Contrast (Minimum)',
    '1.4.4': 'Resize Text',
    '1.4.5': 'Images of Text',
    '1.4.10': 'Reflow',
    '1.4.11': 'Non-text Contrast',
    '1.4.12': 'Text Spacing',
    '1.4.13': 'Content on Hover or Focus',
    '2.1.1': 'Keyboard',
    '2.1.2': 'No Keyboard Trap',
    '2.2.1': 'Timing Adjustable',
    '2.2.2': 'Pause, Stop, Hide',
    '2.3.1': 'Three Flashes or Below Threshold',
    '2.4.1': 'Bypass Blocks',
    '2.4.2': 'Page Titled',
    '2.4.3': 'Focus Order',
    '2.4.4': 'Link Purpose (In Context)',
    '2.4.5': 'Multiple Ways',
    '2.4.6': 'Headings and Labels',
    '2.4.7': 'Focus Visible',
    '2.5.3': 'Label in Name',
    '3.1.1': 'Language of Page',
    '3.1.2': 'Language of Parts',
    '3.2.1': 'On Focus',
    '3.2.2': 'On Input',
    '3.2.5': 'Change on Request',
    '3.3.1': 'Error Identification',
    '3.3.2': 'Labels or Instructions',
    '4.1.1': 'Parsing',
    '4.1.2': 'Name, Role, Value',
  };

  function escapeXml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function criterionNames(wcagList) {
    return (wcagList || []).map(function (c) {
      return WCAG_CRITERION_NAMES[c] ? c + ' ' + WCAG_CRITERION_NAMES[c] : c;
    }).join('; ');
  }

  function issueRows(issues) {
    return (issues || []).map(function (issue, idx) {
      return {
        num: idx + 1,
        wcag: (issue.wcag || []).join(', '),
        wcagNames: criterionNames(issue.wcag),
        level: issue.wcagLevel || '',
        category: issue.a11yCategory || '',
        ruleId: issue.ruleId || issue.property || '',
        ruleName: issue.wcagName || issue.propertyLabel || '',
        severity: issue.severity || '',
        element: issue.element || '',
        selector: issue.selector || '',
        found: issue.found || '',
        message: issue.message || '',
        guidance: issue.guidance || '',
      };
    });
  }

  function buildExcelXml(options) {
    options = options || {};
    var report = options.report || {};
    var issues = options.issues || report.issues || [];
    var page = report.page || {};
    var rows = issueRows(issues);
    var auditedAt = report.auditedAt || new Date().toISOString();
    var score = report.complianceScore != null ? report.complianceScore : '';

    var xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<?mso-application progid="Excel.Sheet"?>\n' +
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ' +
      'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n' +
      '<Worksheet ss:Name="Accessibility Audit">\n<Table>\n';

    function cell(val, type) {
      type = type || 'String';
      if (val === null || val === undefined) val = '';
      if (type === 'Number') {
        return '<Cell><Data ss:Type="Number">' + escapeXml(val) + '</Data></Cell>';
      }
      return '<Cell><Data ss:Type="String">' + escapeXml(val) + '</Data></Cell>';
    }

    function row(cells) {
      return '<Row>' + cells.join('') + '</Row>\n';
    }

    xml += row([cell('DS Auditor — Accessibility Report')]);
    xml += row([cell('Page URL'), cell(page.url || '')]);
    xml += row([cell('Page Title'), cell(page.title || '')]);
    xml += row([cell('Audited At'), cell(auditedAt)]);
    xml += row([cell('Elements Scanned'), cell(report.scannedElements || 0, 'Number')]);
    xml += row([cell('Total Issues'), cell(issues.length, 'Number')]);
    xml += row([cell('Accessibility Score'), cell(score + '%')]);
    xml += row([cell('')]);

    var headers = [
      '#', 'WCAG Criterion', 'Criterion Name(s)', 'Level', 'Category', 'Rule ID', 'Rule Name',
      'Severity', 'Element', 'Selector', 'Found', 'Issue', 'How to Fix',
    ];
    xml += row(headers.map(function (h) { return cell(h); }));

    rows.forEach(function (r) {
      xml += row([
        cell(r.num, 'Number'),
        cell(r.wcag),
        cell(r.wcagNames),
        cell(r.level),
        cell(r.category),
        cell(r.ruleId),
        cell(r.ruleName),
        cell(r.severity),
        cell(r.element),
        cell(r.selector),
        cell(r.found),
        cell(r.message),
        cell(r.guidance),
      ]);
    });

    if (report.byWcag) {
      xml += row([cell('')]);
      xml += row([cell('Issues by WCAG criterion')]);
      xml += row([cell('Criterion'), cell('Count', 'Number')]);
      Object.keys(report.byWcag).sort().forEach(function (c) {
        xml += row([
          cell(c + (WCAG_CRITERION_NAMES[c] ? ' — ' + WCAG_CRITERION_NAMES[c] : '')),
          cell(report.byWcag[c], 'Number'),
        ]);
      });
    }

    xml += '</Table>\n</Worksheet>\n</Workbook>';
    return xml;
  }

  function csvEscape(val) {
    var s = String(val == null ? '' : val);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function buildCsv(options) {
    options = options || {};
    var report = options.report || {};
    var issues = options.issues || report.issues || [];
    var rows = issueRows(issues);
    var lines = [
      ['#', 'WCAG Criterion', 'Criterion Name(s)', 'Level', 'Category', 'Rule ID', 'Rule Name',
        'Severity', 'Element', 'Selector', 'Found', 'Issue', 'How to Fix'].map(csvEscape).join(','),
    ];
    rows.forEach(function (r) {
      lines.push([
        r.num, r.wcag, r.wcagNames, r.level, r.category, r.ruleId, r.ruleName,
        r.severity, r.element, r.selector, r.found, r.message, r.guidance,
      ].map(csvEscape).join(','));
    });
    return '\uFEFF' + lines.join('\n');
  }

  global.DSAuditorA11yExport = {
    buildExcelXml: buildExcelXml,
    buildCsv: buildCsv,
    WCAG_CRITERION_NAMES: WCAG_CRITERION_NAMES,
  };
})(typeof window !== 'undefined' ? window : self);
