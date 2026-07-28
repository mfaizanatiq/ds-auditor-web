/**
 * DS Auditor Web — popup controller
 */
(function () {
  'use strict';

  var embeddedTabId = null;
  var embeddedPageUrl = null;

  if (/[?&]embedded=1(?:&|$)/.test(location.search)) {
    document.documentElement.classList.add('embedded');
    requestEmbeddedContext();
  }

  window.addEventListener('message', function (e) {
    if (!e.data || e.data.source !== 'ds-auditor-panel') return;
    if (e.data.type !== 'PANEL_CONTEXT') return;
    if (e.data.tabId) embeddedTabId = e.data.tabId;
    if (e.data.pageUrl) embeddedPageUrl = e.data.pageUrl;
    if (!lastReport && embeddedPageUrl) restorePersistedAudit();
  });

  function requestEmbeddedContext() {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          source: 'ds-auditor-popup',
          type: 'REQUEST_PANEL_CONTEXT',
        }, '*');
      }
    } catch (err) { /* ignore */ }
  }

  function getActiveTabContext(done) {
    // 1) Context from panel shell (most reliable once received)
    if (embeddedTabId) {
      done({ id: embeddedTabId, url: embeddedPageUrl || '' });
      return;
    }

    // 2) Ask background — uses sender.tab for embedded iframe
    chrome.runtime.sendMessage({ type: 'WHO_AM_I' }, function (res) {
      if (chrome.runtime.lastError) {
        requestEmbeddedContext();
        setTimeout(function () {
          if (embeddedTabId) {
            done({ id: embeddedTabId, url: embeddedPageUrl || '' });
          } else {
            // Allow audit to proceed — service worker will resolve via sender.tab
            done({ id: null, url: embeddedPageUrl || '' });
          }
        }, 150);
        return;
      }
      var tab = res && (res.tab || (res.tabId ? { id: res.tabId, url: res.pageUrl } : null));
      if (tab && tab.id) {
        embeddedTabId = tab.id;
        embeddedPageUrl = tab.url || embeddedPageUrl || null;
        done({ id: tab.id, url: embeddedPageUrl || tab.url || '' });
        return;
      }
      requestEmbeddedContext();
      setTimeout(function () {
        if (embeddedTabId) {
          done({ id: embeddedTabId, url: embeddedPageUrl || '' });
        } else {
          done({ id: null, url: embeddedPageUrl || '' });
        }
      }, 150);
    });
  }

  var Parser = window.DSAuditorTokenParser;

  var libraries = [];
  var activeLibraryIds = [];
  var lastReport = null;
  var activeFilter = 'all';
  var auditViewMode = 'foundation';
  var auditMode = 'tokens';
  var hoveredCard = null;
  var auditedTabId = null;
  var appliedFixKeys = Object.create(null);
  var highlightTimer = null;
  var applyAllEnabled = false;
  var bulkPreviewActive = false;
  var suppressApplyAllToggle = false;
  var ignoredRuleKeys = Object.create(null);
  var ignorePageKey = null;
  var appliedFixLog = [];
  var appliedFixPageKey = null;
  var AUDIT_CACHE_KEY = 'auditReportCache';
  var restoringAudit = false;

  var IGNORE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  var RESTORE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';

  function tokenPayload() {
    return getActiveTokens().map(function (t) { return { name: t.name, value: t.value }; });
  }

  function rebuildAppliedKeysFromLog() {
    appliedFixKeys = Object.create(null);
    appliedFixLog.forEach(function (entry) {
      var key = entry.type === 'typography'
        ? entry.elementRef + '|font'
        : entry.elementRef + '|' + entry.property + '|' + entry.tokenName;
      appliedFixKeys[key] = true;
    });
  }

  function buildCssSnippet(issue, fix, result) {
    if (result && result.cssProperty && result.cssValue) {
      return result.cssProperty + ': ' + result.cssValue + ';';
    }
    var token = (fix && (fix.compositeTokenName || fix.tokenName)) || '';
    if (!token) return fix && (fix.displayValue || fix.fix) || '';
    var varName = token.indexOf('--') === 0 ? token : '--' + token.replace(/^--/, '');
    if (issue.type === 'typography' || issue.property === 'font') {
      return 'font: var(' + varName + ');';
    }
    var prop = (issue.property || '').replace(/([A-Z])/g, '-$1').toLowerCase();
    return prop + ': var(' + varName + ');';
  }

  function logAppliedFix(issue, fix, result) {
    if (!issue || !fix) return;
    var tokenName = (result && result.compositeTokenName) || fix.tokenName;
    var entryId = issue.elementRef + '|' +
      (issue.type === 'typography' ? 'font' : issue.property) + '|' + tokenName;
    var entry = {
      id: entryId,
      elementRef: issue.elementRef,
      selector: issue.selector,
      element: issue.element,
      type: issue.type,
      property: issue.property,
      propertyLabel: issue.propertyLabel,
      found: issue.found,
      tokenName: tokenName,
      tokenDisplay: fixDisplayName(fix),
      cssSnippet: buildCssSnippet(issue, fix, result),
      cssValue: result && result.cssValue,
      appliedAt: new Date().toISOString(),
    };
    var existing = -1;
    for (var i = 0; i < appliedFixLog.length; i++) {
      if (appliedFixLog[i].id === entryId) {
        existing = i;
        break;
      }
    }
    if (existing >= 0) appliedFixLog[existing] = entry;
    else appliedFixLog.push(entry);
    saveAppliedFixLog();
    rebuildAppliedKeysFromLog();
  }

  function loadAppliedFixLog(pageKey, done) {
    appliedFixPageKey = pageKey;
    chrome.storage.local.get(['appliedAuditFixes'], function (data) {
      appliedFixLog = ((data && data.appliedAuditFixes) || {})[pageKey] || [];
      rebuildAppliedKeysFromLog();
      if (done) done();
    });
  }

  function saveAppliedFixLog() {
    if (!appliedFixPageKey) return;
    chrome.storage.local.get(['appliedAuditFixes'], function (data) {
      var all = (data && data.appliedAuditFixes) || {};
      if (appliedFixLog.length) {
        all[appliedFixPageKey] = appliedFixLog;
      } else {
        delete all[appliedFixPageKey];
      }
      chrome.storage.local.set({ appliedAuditFixes: all });
    });
  }

  function clearAppliedFixLog() {
    appliedFixLog = [];
    saveAppliedFixLog();
    rebuildAppliedKeysFromLog();
  }

  function getIgnoredIssuesForExport() {
    if (!lastReport || !lastReport.issues) return [];
    return lastReport.issues.filter(function (issue) {
      return isIssueIgnored(issue);
    });
  }

  function getActiveLibraryNames() {
    return libraries
      .filter(function (l) { return activeLibraryIds.indexOf(l.id) !== -1; })
      .map(function (l) { return l.name; });
  }

  function downloadBlob(content, filename, mime) {
    var blob = new Blob([content], { type: mime });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportA11yExcel() {
    if (!lastReport || lastReport.auditMode !== 'a11y') return;
    var Exp = window.DSAuditorA11yExport;
    if (!Exp) {
      showStatus('Export module not loaded', 'error');
      return;
    }
    try {
      var issues = (lastReport.issues || []).filter(function (issue) {
        return !isIssueIgnored(issue);
      });
      var xml = Exp.buildExcelXml({ report: lastReport, issues: issues });
      var slug = getPageIgnoreKey((lastReport.page && lastReport.page.url) || 'report')
        .replace(/[^\w.-]+/g, '-')
        .slice(0, 60);
      downloadBlob(xml, 'accessibility-audit-' + slug + '.xls', 'application/vnd.ms-excel');
      showStatus('Excel report downloaded · ' + issues.length + ' issues with WCAG criteria', 'success');
    } catch (err) {
      showStatus(err && err.message ? err.message : 'Could not export Excel report', 'error');
    }
  }

  function exportHtmlReport() {
    if (!lastReport) return;
    if (!window.DSAuditorHtmlReport) {
      showStatus('HTML export module not loaded', 'error');
      return;
    }
    try {
      var html = window.DSAuditorHtmlReport.build({
        report: lastReport,
        openIssues: remainingIssues(),
        appliedFixes: lastReport.auditMode === 'a11y' ? [] : appliedFixLog.slice(),
        ignoredIssues: getIgnoredIssuesForExport(),
        libraries: getActiveLibraryNames(),
      });
      var slug = getPageIgnoreKey((lastReport.page && lastReport.page.url) || 'report')
        .replace(/[^\w.-]+/g, '-')
        .slice(0, 60);
      var prefix = lastReport.auditMode === 'a11y' ? 'accessibility-audit-' : 'ds-audit-';
      downloadBlob(html, prefix + slug + '.html', 'text/html;charset=utf-8');
      showStatus('HTML report downloaded. Share with your team.', 'success');
    } catch (err) {
      showStatus(err && err.message ? err.message : 'Could not export HTML report', 'error');
    }
  }

  function exportJsonReport() {
    if (!lastReport) return;
    var payload = Object.assign({}, lastReport, {
      exportedAt: new Date().toISOString(),
      openIssues: remainingIssues(),
      appliedFixes: appliedFixLog.slice(),
      ignoredIssues: getIgnoredIssuesForExport(),
    });
    downloadBlob(JSON.stringify(payload, null, 2), 'ds-audit-report.json', 'application/json');
    showStatus('JSON report downloaded', 'success');
  }

  function fixTrackingKey(issue, fix) {
    if (issue.type === 'typography') {
      return (issue.elementRef || issue.selector) + '|font';
    }
    return (issue.elementRef || issue.selector) + '|' + issue.property + '|' + fix.tokenName;
  }

  function buildBulkFixes() {
    if (!lastReport || !lastReport.issues) return [];
    var fixes = [];
    var typoSeen = Object.create(null);
    lastReport.issues.forEach(function (issue) {
      if (!issue.fixes || !issue.fixes.length) return;
      if (isIssueIgnored(issue)) return;
      if (issue.type === 'typography') {
        if (typoSeen[issue.elementRef]) return;
        typoSeen[issue.elementRef] = true;
      }
      var fix = issue.fixes[0];
      fixes.push({
        elementRef: issue.elementRef,
        selector: issue.selector,
        property: issue.property,
        tokenName: fix.tokenName,
        cssValue: fix.fix || ('var(' + fix.tokenName + ')'),
        resolvedCssValue: fix.resolvedCssValue,
      });
    });
    return fixes;
  }

  function markBulkFixKeysFromReport() {
    if (!lastReport || !lastReport.issues) return;
    var typoSeen = Object.create(null);
    lastReport.issues.forEach(function (issue) {
      if (!issue.fixes || !issue.fixes.length) return;
      if (isIssueIgnored(issue)) return;
      if (issue.type === 'typography') {
        if (typoSeen[issue.elementRef]) return;
        typoSeen[issue.elementRef] = true;
      }
      var fix = issue.fixes[0];
      appliedFixKeys[fixTrackingKey(issue, fix)] = true;
    });
  }

  function isIssueApplied(issue) {
    var ref = issue.elementRef || issue.selector;
    if (issue.type === 'typography') {
      return !!appliedFixKeys[ref + '|font'];
    }
    var prefix = ref + '|' + issue.property + '|';
    return Object.keys(appliedFixKeys).some(function (key) {
      return key.indexOf(prefix) === 0;
    });
  }

  function countFixableIssues() {
    if (!lastReport || !lastReport.issues) return 0;
    var typoSeen = Object.create(null);
    var count = 0;
    lastReport.issues.forEach(function (issue) {
      if (!issue.fixes || !issue.fixes.length) return;
      if (isIssueIgnored(issue)) return;
      if (issue.type === 'typography') {
        if (typoSeen[issue.elementRef]) return;
        typoSeen[issue.elementRef] = true;
      }
      count++;
    });
    return count;
  }

  function allFixableIssuesApplied() {
    if (!lastReport || !lastReport.issues) return false;
    var typoSeen = Object.create(null);
    return lastReport.issues.filter(function (issue) {
      return issue.fixes && issue.fixes.length && !isIssueIgnored(issue);
    }).every(function (issue) {
      if (issue.type === 'typography') {
        if (typoSeen[issue.elementRef]) return true;
        typoSeen[issue.elementRef] = true;
      }
      return isIssueApplied(issue);
    });
  }

  function syncApplyAllToggle() {
    if (!countFixableIssues()) {
      setApplyAllToggle(false, true);
      return;
    }
    var shouldOn = bulkPreviewActive || allFixableIssuesApplied();
    setApplyAllToggle(shouldOn, true);
  }

  function syncFromPageFixState(done) {
    var tabId = resolveAuditTabId();
    if (!tabId) {
      syncApplyAllToggle();
      if (done) done();
      return;
    }
    sendTabMessage(
      { type: 'GET_FIX_STATE', tabId: tabId },
      function (state) {
        if (state && state.active) {
          bulkPreviewActive = true;
          if (lastReport) {
            var beforeCount = appliedFixLog.length;
            markBulkFixKeysFromReport();
            var typoSeen = Object.create(null);
            lastReport.issues.forEach(function (issue) {
              if (!issue.fixes || !issue.fixes.length) return;
              if (isIssueIgnored(issue)) return;
              if (!isIssueApplied(issue)) return;
              if (issue.type === 'typography') {
                if (typoSeen[issue.elementRef]) return;
                typoSeen[issue.elementRef] = true;
              }
              logAppliedFix(issue, issue.fixes[0], null);
            });
            if (appliedFixLog.length > beforeCount) renderIssues(lastReport);
          }
        }
        syncApplyAllToggle();
        if (done) done(state);
      }
    );
  }
  function resolveAuditTabId() {
    return auditedTabId || embeddedTabId || null;
  }

  function sendTabMessage(payload, done) {
    var msg = Object.assign({}, payload);
    if (!msg.tabId) msg.tabId = resolveAuditTabId();
    chrome.runtime.sendMessage(msg, function (result) {
      if (chrome.runtime.lastError) {
        done(null, chrome.runtime.lastError.message);
        return;
      }
      if (result && result.tabId) auditedTabId = result.tabId;
      done(result || null, null);
    });
  }

  function setApplyAllToggle(on, silent) {
    applyAllEnabled = on;
    var toggle = $('applyAllToggle');
    if (!toggle) return;
    if (silent) {
      suppressApplyAllToggle = true;
      toggle.checked = on;
      setTimeout(function () {
        suppressApplyAllToggle = false;
      }, 0);
    } else {
      toggle.checked = on;
    }
    var wrap = $('applyAllWrap');
    if (wrap) {
      wrap.title = on
        ? 'Fixes applied on page. Turn off to remove them.'
        : 'Turn on to preview all suggested token fixes on the page';
      wrap.setAttribute('aria-label', wrap.title);
    }
  }

  function updateApplyAllBar(report) {
    var wrap = $('applyAllWrap');
    if (!wrap) return;
    if (report && report.auditMode === 'a11y') {
      wrap.style.display = 'none';
      return;
    }
    var bulkCount = buildBulkFixes().length;
    var show = report && bulkCount > 0;
    wrap.style.display = show ? 'inline-block' : 'none';
    if (!show) {
      bulkPreviewActive = false;
      setApplyAllToggle(false, true);
    }
  }

  function applyAllFixesBulk() {
    var fixes = buildBulkFixes();
    var tabId = resolveAuditTabId();
    if (!fixes.length) {
      bulkPreviewActive = false;
      setApplyAllToggle(false, true);
      showStatus('No token fixes available to apply', 'error');
      return;
    }

    var toggle = $('applyAllToggle');
    if (toggle) toggle.disabled = true;
    showStatus('Applying ' + fixes.length + ' fixes…');

    sendTabMessage({
      type: 'APPLY_ALL_FIXES',
      tabId: tabId,
      fixes: fixes,
      tokens: tokenPayload(),
    }, function (result, err) {
      if (toggle) toggle.disabled = false;
      if (err || !result || !result.ok) {
        bulkPreviewActive = false;
        setApplyAllToggle(false, true);
        showStatus(err || (result && result.error) || 'Could not apply all fixes', 'error');
        return;
      }
      if (result.tabId) auditedTabId = result.tabId;
      markBulkFixKeysFromReport();
      bulkPreviewActive = true;
      applyAllEnabled = true;
      if (lastReport) {
        var typoSeen = Object.create(null);
        lastReport.issues.forEach(function (issue) {
          if (!issue.fixes || !issue.fixes.length) return;
          if (isIssueIgnored(issue)) return;
          if (issue.type === 'typography') {
            if (typoSeen[issue.elementRef]) return;
            typoSeen[issue.elementRef] = true;
          }
          logAppliedFix(issue, issue.fixes[0], null);
        });
        renderFilters(lastReport);
        renderIssues(lastReport);
      }
      setApplyAllToggle(true, true);
      showStatus(
        'Applied ' + (result.applied || 0) + ' fixes on the page' +
        (result.skipped ? ' (' + result.skipped + ' already applied)' : '') +
        '. Turn off to remove them.',
        'success'
      );
    });
  }

  function clearAllFixesBulk() {
    var tabId = resolveAuditTabId();
    var toggle = $('applyAllToggle');
    if (toggle) toggle.disabled = true;
    showStatus('Removing all fixes…');

    function finishLocalClear() {
      appliedFixKeys = Object.create(null);
      bulkPreviewActive = false;
      applyAllEnabled = false;
      clearAppliedFixLog();
      setApplyAllToggle(false, true);
      if (lastReport) {
        renderFilters(lastReport);
        renderIssues(lastReport);
      }
      showStatus('All fixes removed from page', 'success');
    }

    if (!tabId) {
      if (toggle) toggle.disabled = false;
      finishLocalClear();
      return;
    }

    sendTabMessage({
      type: 'CLEAR_ALL_FIXES',
      tabId: tabId,
    }, function (result, err) {
      if (toggle) toggle.disabled = false;
      if (err || !result || !result.ok) {
        // Still clear local UI state so toggle can turn off; page may need refresh.
        finishLocalClear();
        showStatus(
          'Preview cleared in the panel' +
          (err || (result && result.error) ? ' (' + (err || result.error) + ')' : '') +
          '. Refresh the page if styles remain.',
          'success'
        );
        return;
      }
      finishLocalClear();
    });
  }

  function onApplyAllToggleChange() {
    if (suppressApplyAllToggle) return;
    var toggle = $('applyAllToggle');
    if (!toggle) return;
    if (toggle.checked) {
      applyAllFixesBulk();
    } else {
      clearAllFixesBulk();
    }
  }

  function highlightIssue(issue, scroll) {
    if (!auditedTabId) return;
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(function () {
      chrome.runtime.sendMessage({
        type: 'HIGHLIGHT_ELEMENT',
        tabId: auditedTabId,
        elementRef: issue.elementRef,
        selector: issue.selector,
        scroll: scroll !== false,
      }).catch(function () {});
    }, scroll === false ? 30 : 0);
  }

  function applyFix(issue, fix, fixRowEl) {
    var fixKey = fixTrackingKey(issue, fix);
    if (appliedFixKeys[fixKey]) {
      showStatus('Already applied', 'success');
      return;
    }

    chrome.runtime.sendMessage({
      type: 'APPLY_FIX',
      tabId: auditedTabId,
      elementRef: issue.elementRef,
      selector: issue.selector,
      property: issue.property,
      tokenName: fix.tokenName,
      cssValue: fix.fix || ('var(' + fix.tokenName + ')'),
      resolvedCssValue: fix.resolvedCssValue,
      tokens: tokenPayload(),
    }).then(function (result) {
      if (!result || !result.ok) {
        showStatus((result && result.error) || 'Could not apply fix', 'error');
        return;
      }
      if (result.alreadyApplied) {
        showStatus('Already applied', 'success');
      } else {
        var appliedName = (result && result.compositeTokenName) || fix.tokenName;
        showStatus('Applied ' + appliedName, 'success');
      }
      appliedFixKeys[fixKey] = true;
      bulkPreviewActive = true;
      logAppliedFix(issue, fix, result);
      if (fixRowEl) {
        fixRowEl.classList.add('applied');
        fixRowEl.querySelector('.fix-row-action').textContent = 'Applied';
      }
      syncApplyAllToggle();
      if (lastReport) renderFilters(lastReport);
      if (lastReport) renderIssues(lastReport);
      highlightIssue(issue, true);
    }).catch(function (err) {
      showStatus(err && err.message ? err.message : 'Could not apply fix', 'error');
    });
  }

  function clearPageHighlight() {
    if (highlightTimer) clearTimeout(highlightTimer);
    if (!auditedTabId) return;
    chrome.runtime.sendMessage({
      type: 'CLEAR_HIGHLIGHT',
      tabId: auditedTabId,
    }).catch(function () {});
  }

  function setHoveredCard(card) {
    if (hoveredCard) hoveredCard.classList.remove('is-hovered');
    hoveredCard = card || null;
    if (hoveredCard) hoveredCard.classList.add('is-hovered');
  }

  var $ = function (id) { return document.getElementById(id); };

  var scoreValue = $('scoreValue');
  var scoreMeta = $('scoreMeta');
  var runAuditBtn = $('runAuditBtn');
  var exportBtn = $('exportBtn');
  var filterBar = $('filterBar');
  var filterSegments = $('filterSegments');
  var viewSwitcher = $('viewSwitcher');
  var issueList = $('issueList');
  var emptyState = $('emptyState');
  var loader = $('loader');
  var statusMsg = $('statusMsg');
  var libraryList = $('libraryList');
  var fileInput = $('fileInput');
  var uploadZone = $('uploadZone');
  var issueHint = $('issueHint');
  var sessionToast = $('sessionToast');
  var sessionToastTitle = $('sessionToastTitle');
  var sessionToastMeta = $('sessionToastMeta');
  var sessionToastTimer = null;

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(function (s) {
      s.classList.toggle('active', s.id === id);
    });
  }

  function showStatus(msg, type) {
    statusMsg.textContent = msg || '';
    statusMsg.className = 'status-msg' + (type ? ' ' + type : '');
  }

  function hideSessionToast() {
    if (sessionToastTimer) {
      clearTimeout(sessionToastTimer);
      sessionToastTimer = null;
    }
    if (sessionToast) sessionToast.hidden = true;
  }

  function showSessionToast(report) {
    if (!sessionToast) return;
    var count = report && report.issueCount != null ? report.issueCount : 0;
    var modeLabel = report && report.auditMode === 'a11y' ? 'Accessibility' : 'Design tokens';
    if (sessionToastTitle) sessionToastTitle.textContent = modeLabel + ' audit complete';
    if (sessionToastMeta) {
      sessionToastMeta.textContent = count + ' issue' + (count === 1 ? '' : 's') +
        ' found. Re-run this page or start a new session.';
    }
    sessionToast.hidden = false;
    if (sessionToastTimer) clearTimeout(sessionToastTimer);
    sessionToastTimer = setTimeout(function () {
      sessionToastTimer = null;
      // Keep toast available; don't auto-hide so Re-run / New session stay reachable.
    }, 0);
  }

  function clearCachedReportForCurrentMode(done) {
    getActiveTabContext(function (tab) {
      var url = (lastReport && lastReport.page && lastReport.page.url) ||
        (tab && tab.url) || embeddedPageUrl || '';
      if (!url) {
        if (done) done();
        return;
      }
      var pageKey = getPageIgnoreKey(url);
      chrome.storage.local.get([AUDIT_CACHE_KEY], function (data) {
        var all = (data && data[AUDIT_CACHE_KEY]) || {};
        if (all[pageKey] && all[pageKey].modes) {
          delete all[pageKey].modes[auditMode];
          if (!Object.keys(all[pageKey].modes).length) delete all[pageKey];
        }
        var payload = {};
        payload[AUDIT_CACHE_KEY] = all;
        chrome.storage.local.set(payload, function () {
          if (done) done();
        });
      });
    });
  }

  function startNewSession() {
    hideSessionToast();
    clearPageHighlight();
    if (auditMode === 'tokens' && resolveAuditTabId()) {
      sendTabMessage({ type: 'CLEAR_ALL_FIXES', tabId: resolveAuditTabId() }, function () {});
    }
    appliedFixKeys = Object.create(null);
    appliedFixLog = [];
    bulkPreviewActive = false;
    applyAllEnabled = false;
    activeFilter = 'all';
    lastReport = null;
    setReportLayout(false);
    exportBtn.style.display = 'none';
    filterBar.style.display = 'none';
    if (issueHint) issueHint.style.display = 'none';
    issueList.innerHTML = '';
    emptyState.style.display = 'block';
    setApplyAllToggle(false, true);
    var wrap = $('applyAllWrap');
    if (wrap) wrap.style.display = 'none';
    clearCachedReportForCurrentMode(function () {
      showModeEmptyState();
      showStatus('New session ready. Run an audit when you are ready.', 'success');
    });
  }

  var auditRequestTimer = null;

  function setLoading(on, label) {
    loader.classList.toggle('visible', on);
    runAuditBtn.disabled = on || (auditMode === 'tokens' && !getActiveTokens().length);
    if (label) {
      var textEl = loader.querySelector('.loader-text');
      if (textEl) textEl.textContent = label;
    }
    if (auditRequestTimer) {
      clearTimeout(auditRequestTimer);
      auditRequestTimer = null;
    }
    if (on) {
      auditRequestTimer = setTimeout(function () {
        auditRequestTimer = null;
        if (loader.classList.contains('visible')) {
          setLoading(false);
          showStatus('Audit timed out. Refresh the page and try again.', 'error');
        }
      }, 45000);
    }
  }

  function getActiveTokens() {
    return Parser.mergeLibrariesWithIndex
      ? Parser.mergeLibrariesWithIndex(
        libraries.filter(function (l) { return activeLibraryIds.indexOf(l.id) !== -1; })
      )
      : Parser.mergeLibraries(
        libraries.filter(function (l) { return activeLibraryIds.indexOf(l.id) !== -1; })
      );
  }

  function saveLibraries() {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage(
        { type: 'SAVE_LIBRARIES', libraries: libraries, activeLibraryIds: activeLibraryIds },
        resolve
      );
    });
  }

  function loadLibraries() {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage({ type: 'GET_LIBRARIES' }, function (data) {
        libraries = data.libraries || [];
        activeLibraryIds = data.activeLibraryIds || libraries.map(function (l) { return l.id; });
        if (!activeLibraryIds.length && libraries.length) {
          activeLibraryIds = libraries.map(function (l) { return l.id; });
        }
        resolve();
      });
    });
  }

  function formatLibraryReadyMeta(tokenCount) {
    var tokens = getActiveTokens();
    var Synth = window.DSAuditorTokenSynthesizer;
    if (Synth && tokens.length) {
      var idx = Synth.getTokenIndex(tokens);
      if (idx && idx.stats) {
        return tokenCount + ' tokens · ' + idx.stats.semantic + ' semantic · ' +
          idx.stats.composites + ' type styles. Ready to audit.';
      }
    }
    return tokenCount + ' tokens loaded. Ready to audit.';
  }

  function updateAuditButton() {
    var hasTokens = getActiveTokens().length > 0;
    var count = getActiveTokens().length;
    if (auditMode === 'a11y') {
      runAuditBtn.disabled = false;
      runAuditBtn.textContent = 'Run accessibility audit';
      if (lastReport && lastReport.auditMode === 'a11y') {
        refreshComplianceUI();
      } else if (!lastReport) {
        scoreMeta.textContent = 'WCAG 2.x · Level A & AA · single-pass scan';
      }
      return;
    }
    runAuditBtn.textContent = 'Audit this page';
    runAuditBtn.disabled = !hasTokens;
    if (lastReport && lastReport.auditMode === 'tokens') {
      refreshComplianceUI();
      return;
    }
    if (!hasTokens) {
      scoreMeta.textContent = 'Upload or enable a token library to audit';
    } else {
      scoreMeta.textContent = formatLibraryReadyMeta(count);
    }
  }

  function renderLibraries() {
    libraryList.innerHTML = '';
    if (!libraries.length) {
      libraryList.innerHTML = '<li class="empty-state" style="padding:12px 0">No libraries yet</li>';
      return;
    }

    libraries.forEach(function (lib) {
      var li = document.createElement('li');
      li.className = 'library-item';
      var checked = activeLibraryIds.indexOf(lib.id) !== -1;
      var isBundled = lib.bundled || lib.id === 'fds-variables-light';
      li.innerHTML =
        '<label>' +
          '<input type="checkbox" data-id="' + lib.id + '"' + (checked ? ' checked' : '') + '>' +
          '<div><div class="library-name">' + escapeHtml(lib.name) +
            (isBundled ? ' <span class="library-badge">Bundled</span>' : '') +
          '</div>' +
          '<div class="library-meta">' + (lib.tokenCount || lib.tokens?.length || 0) + ' tokens</div></div>' +
        '</label>' +
        (isBundled
          ? '<span class="library-bundled-note" title="Shipped with extension">Preloaded</span>'
          : '<button class="library-remove" data-id="' + lib.id + '">Remove</button>');

      li.querySelector('input').addEventListener('change', function (e) {
        var id = e.target.dataset.id;
        if (e.target.checked) {
          if (activeLibraryIds.indexOf(id) === -1) activeLibraryIds.push(id);
        } else {
          activeLibraryIds = activeLibraryIds.filter(function (x) { return x !== id; });
        }
        saveLibraries().then(function () {
          updateAuditButton();
          refreshReportUI();
        });
      });

      var removeBtn = li.querySelector('.library-remove');
      if (removeBtn) {
        removeBtn.addEventListener('click', function () {
          var id = this.dataset.id;
          libraries = libraries.filter(function (l) { return l.id !== id; });
          activeLibraryIds = activeLibraryIds.filter(function (x) { return x !== id; });
          saveLibraries().then(function () {
            renderLibraries();
            updateAuditButton();
            refreshReportUI();
          });
        });
      }

      libraryList.appendChild(li);
    });
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function colorSwatchStyle(value) {
    var C = window.DSAuditorColor;
    if (!C || !value) return null;
    var parsed = C.parseColor(String(value).trim());
    if (!parsed || parsed.type === 'var') return null;
    if (parsed.a !== undefined && parsed.a < 1) {
      return 'rgba(' + parsed.r + ', ' + parsed.g + ', ' + parsed.b + ', ' + parsed.a + ')';
    }
    return C.colorToHex(parsed);
  }

  function colorSwatchHtml(value, sizeClass) {
    var bg = colorSwatchStyle(value);
    if (!bg) return '';
    return '<span class="color-swatch' + (sizeClass ? ' ' + sizeClass : '') +
      '" style="background-color:' + bg + ';" aria-hidden="true"></span>';
  }

  function renderIssueFoundHtml(issue) {
    if (issue.type !== 'color') {
      return '<div class="issue-found">' + escapeHtml(issue.found) + '</div>';
    }
    return (
      '<div class="issue-found issue-found-color">' +
        colorSwatchHtml(issue.found, 'color-swatch-lg') +
        '<span class="issue-found-value">' + escapeHtml(issue.found) + '</span>' +
      '</div>'
    );
  }

  function fixColorPreviewValue(fix) {
    return fix.displayValue || fix.resolvedCssValue || fix.fix || '';
  }

  function handleFiles(files) {
    var promises = Array.from(files).map(function (file) {
      return new Promise(function (resolve) {
        var reader = new FileReader();
        reader.onload = function () {
          var tokens = Parser.parseFile(reader.result, file.name);
          resolve({
            id: 'lib_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            name: file.name,
            tokens: tokens,
            tokenCount: tokens.length,
            uploadedAt: new Date().toISOString(),
          });
        };
        reader.readAsText(file);
      });
    });

    Promise.all(promises).then(function (newLibs) {
      libraries = libraries.concat(newLibs);
      newLibs.forEach(function (l) { activeLibraryIds.push(l.id); });
      return saveLibraries();
    }).then(function () {
      renderLibraries();
      updateAuditButton();
      showStatus('Added ' + files.length + ' library(ies)', 'success');
    });
  }

  function scoreClass(score) {
    if (score >= 85) return 'score-high';
    if (score >= 60) return 'score-mid';
    return 'score-low';
  }

  /** Same formula as lib/auditor.js — weighted by scanned elements, not raw issue count. */
  function computeComplianceScore(scannedElements, issues) {
    var scanned = Math.max(scannedElements || 1, 1);
    var weightedPenalty = 0;
    (issues || []).forEach(function (iss) {
      if (iss.severity === 'error' || iss.severity === 'warn') weightedPenalty += 0.5;
      else if (iss.severity === 'info') weightedPenalty += 0.15;
    });
    if (weightedPenalty === 0) return 100;
    return Math.round((scanned / (scanned + weightedPenalty)) * 100);
  }

  function getPageIgnoreKey(url) {
    try {
      var u = new URL(url);
      return u.hostname + u.pathname;
    } catch (e) {
      return String(url || 'unknown');
    }
  }

  function persistAuditReport(report) {
    if (!report || !report.page || !report.page.url) return;
    var pageKey = getPageIgnoreKey(report.page.url);
    var mode = report.auditMode || 'tokens';
    chrome.storage.local.get([AUDIT_CACHE_KEY], function (data) {
      var all = (data && data[AUDIT_CACHE_KEY]) || {};
      if (!all[pageKey] || typeof all[pageKey] !== 'object' || all[pageKey].report) {
        all[pageKey] = { modes: {} };
      }
      if (!all[pageKey].modes) all[pageKey].modes = {};
      all[pageKey].modes[mode] = {
        report: report,
        auditedTabId: auditedTabId,
        activeFilter: activeFilter,
        auditViewMode: auditViewMode,
        activeLibraryIds: activeLibraryIds.slice(),
        savedAt: new Date().toISOString(),
      };
      var keys = Object.keys(all);
      if (keys.length > 30) {
        keys.sort(function (a, b) {
          var aT = (all[a].modes && all[a].modes.tokens && all[a].modes.tokens.savedAt) || '';
          var bT = (all[b].modes && all[b].modes.tokens && all[b].modes.tokens.savedAt) || '';
          return String(bT).localeCompare(String(aT));
        });
        keys.slice(30).forEach(function (k) { delete all[k]; });
      }
      var payload = {};
      payload[AUDIT_CACHE_KEY] = all;
      chrome.storage.local.set(payload);
    });
  }

  function isValidFilterForMode(mode, filter) {
    if (!filter || filter === 'all') return true;
    if (mode === 'a11y') {
      return ['contrast', 'images', 'structure', 'forms', 'keyboard', 'focus', 'aria'].indexOf(filter) !== -1;
    }
    return ['color', 'typography', 'spacing', 'size', 'effect'].indexOf(filter) !== -1;
  }

  function restorePersistedAudit(done) {
    if (restoringAudit) {
      if (done) done(false);
      return;
    }
    if (lastReport && lastReport.auditMode === auditMode) {
      if (done) done(true);
      return;
    }
    getActiveTabContext(function (tab) {
      if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        if (done) done(false);
        return;
      }
      var pageKey = getPageIgnoreKey(tab.url);
      chrome.storage.local.get([AUDIT_CACHE_KEY], function (data) {
        var pageCache = ((data && data[AUDIT_CACHE_KEY]) || {})[pageKey];
        var cached = pageCache && pageCache.modes && pageCache.modes[auditMode];
        if (!cached && pageCache && pageCache.report) {
          cached = pageCache.report.auditMode === auditMode ? pageCache : null;
        }
        if (!cached || !cached.report) {
          if (done) done(false);
          return;
        }
        restoringAudit = true;
        auditedTabId = tab.id || cached.auditedTabId || null;
        activeFilter = isValidFilterForMode(auditMode, cached.activeFilter)
          ? (cached.activeFilter || 'all')
          : 'all';
        auditViewMode = cached.auditViewMode || 'foundation';
        loadIgnoredRules(pageKey, function () {
          loadAppliedFixLog(pageKey, function () {
            rebuildAppliedKeysFromLog();
            renderReport(cached.report);
            restoringAudit = false;
            if (done) done(true);
          });
        });
      });
    });
  }

  function refreshReportUI() {
    if (!lastReport || lastReport.auditMode !== auditMode) {
      showModeEmptyState();
      return;
    }
    setReportLayout(true);
    exportBtn.style.display = 'flex';
    emptyState.style.display = 'none';
    refreshComplianceUI();
    renderFilters(lastReport);
    renderIssues(lastReport);
    updateApplyAllBar(lastReport);
    if (auditMode === 'tokens') syncApplyAllToggle();
    else {
      var wrap = $('applyAllWrap');
      if (wrap) wrap.style.display = 'none';
    }
  }

  function setReportLayout(hasReport) {
    document.body.classList.toggle('has-report', !!hasReport);
  }

  function showModeEmptyState() {
    hideSessionToast();
    setReportLayout(false);
    issueList.innerHTML = '';
    filterBar.style.display = 'none';
    exportBtn.style.display = 'none';
    if (issueHint) issueHint.style.display = 'none';
    emptyState.style.display = 'block';
    if (auditMode === 'a11y') {
      emptyState.innerHTML = '<p><strong>Accessibility mode</strong>. Audits WCAG 2.x Level A &amp; AA criteria: contrast, images, structure, forms, keyboard, focus, and ARIA.</p>';
      scoreValue.textContent = '-';
      scoreValue.className = 'score-value';
      scoreMeta.textContent = 'Run accessibility audit to scan this page';
    } else {
      emptyState.innerHTML = '<p>Upload any design-system token file (CSS custom properties or JSON). The auditor scans your library, infers semantic layers, and suggests the right tokens automatically.</p>';
      if (!lastReport || lastReport.auditMode !== 'tokens') {
        scoreValue.textContent = '-';
        scoreValue.className = 'score-value';
      }
      updateAuditButton();
    }
  }

  function setAuditMode(mode) {
    if (!mode || mode === auditMode) return;
    if (lastReport) persistAuditReport(lastReport);
    auditMode = mode;
    activeFilter = 'all';
    document.querySelectorAll('.audit-mode-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    var scoreLabelEl = $('scoreLabel');
    if (scoreLabelEl) {
      scoreLabelEl.textContent = mode === 'a11y' ? 'Accessibility score' : 'Compliance';
    }
    updateAuditButton();
    if (lastReport && lastReport.auditMode === mode) {
      refreshReportUI();
    } else {
      restorePersistedAudit(function (restored) {
        if (!restored) showModeEmptyState();
      });
    }
  }

  function loadIgnoredRules(pageKey, done) {
    ignorePageKey = pageKey;
    chrome.storage.local.get(['ignoredAuditRules'], function (data) {
      ignoredRuleKeys = Object.create(null);
      var list = ((data && data.ignoredAuditRules) || {})[pageKey] || [];
      list.forEach(function (k) {
        ignoredRuleKeys[k] = true;
      });
      if (done) done();
    });
  }

  function saveIgnoredRules() {
    if (!ignorePageKey) return;
    chrome.storage.local.get(['ignoredAuditRules'], function (data) {
      var all = (data && data.ignoredAuditRules) || {};
      var keys = Object.keys(ignoredRuleKeys);
      if (keys.length) {
        all[ignorePageKey] = keys;
      } else {
        delete all[ignorePageKey];
      }
      chrome.storage.local.set({ ignoredAuditRules: all });
    });
  }

  function isIssueIgnored(issue) {
    return !!ignoredRuleKeys[getIssueGroupKey(issue)];
  }

  function isGroupIgnored(group) {
    return !!ignoredRuleKeys[group.key];
  }

  function setRuleIgnored(ruleKey, ignored, issueCount) {
    if (ignored) {
      ignoredRuleKeys[ruleKey] = true;
    } else {
      delete ignoredRuleKeys[ruleKey];
    }
    saveIgnoredRules();
    clearPageHighlight();
    if (lastReport) {
      renderFilters(lastReport);
      renderIssues(lastReport);
    }
    if (ignored) {
      showStatus(
        issueCount > 1
          ? 'Ignored rule for ' + issueCount + ' elements on this page'
          : 'Rule ignored for this page',
        'success'
      );
    } else {
      showStatus('Rule restored', 'success');
    }
  }

  function remainingIssues() {
    if (!lastReport || !lastReport.issues) return [];
    if (lastReport.auditMode === 'a11y') {
      return lastReport.issues.filter(function (issue) {
        return !isIssueIgnored(issue);
      });
    }
    return lastReport.issues.filter(function (issue) {
      if (isIssueIgnored(issue)) return false;
      if (!issue.fixes || !issue.fixes.length) return true;
      return !isIssueApplied(issue);
    });
  }

  function getIgnoredGroups() {
    var groups = [];
    var map = Object.create(null);
    if (!lastReport || !lastReport.issues) return groups;
    lastReport.issues.forEach(function (issue) {
      if (!isIssueIgnored(issue)) return;
      var key = getIssueGroupKey(issue);
      if (!map[key]) {
        map[key] = { key: key, issues: [], representative: issue };
        groups.push(map[key]);
      }
      map[key].issues.push(issue);
    });
    groups.sort(function (a, b) {
      return b.issues.length - a.issues.length;
    });
    return groups;
  }

  function countIgnoredIssues() {
    if (!lastReport || !lastReport.issues) return 0;
    return lastReport.issues.filter(function (issue) {
      return isIssueIgnored(issue);
    }).length;
  }

  function refreshComplianceUI() {
    if (!lastReport || lastReport.auditMode !== auditMode) return;
    var remaining = remainingIssues();
    var score = lastReport.auditMode === 'a11y'
      ? (window.DSAuditorA11y && window.DSAuditorA11y.computeA11yScore
        ? window.DSAuditorA11y.computeA11yScore(remaining, lastReport.scannedElements)
        : lastReport.complianceScore)
      : computeComplianceScore(lastReport.scannedElements, remaining);
    var ignored = countIgnoredIssues();
    var fixed = lastReport.auditMode === 'a11y' ? 0 : lastReport.issues.filter(function (issue) {
      if (isIssueIgnored(issue)) return false;
      if (!issue.fixes || !issue.fixes.length) return false;
      return isIssueApplied(issue);
    }).length;
    scoreValue.textContent = score + '%';
    scoreValue.className = 'score-value ' + scoreClass(score);
    if (lastReport.auditMode === 'a11y') {
      var errCount = remaining.filter(function (i) { return i.severity === 'error'; }).length;
      var warnCount = remaining.filter(function (i) { return i.severity === 'warn'; }).length;
      scoreMeta.textContent =
        remaining.length + ' issues · ' + errCount + ' errors · ' + warnCount + ' warnings' +
        (ignored ? ' · ' + ignored + ' ignored' : '') +
        ' · ' + lastReport.scannedElements + ' elements scanned';
    } else {
      scoreMeta.textContent =
        remaining.length + ' open · ' + fixed + ' fixed' +
        (ignored ? ' · ' + ignored + ' ignored' : '') +
        ' · ' + lastReport.scannedElements + ' elements';
    }
  }

  function countByType(issues) {
    var byType = {};
    issues.forEach(function (i) {
      byType[i.type] = (byType[i.type] || 0) + 1;
    });
    return byType;
  }

  var FOUNDATION_CATS = [
    { key: 'color', label: 'Colours', accent: '#fbbf24', test: function (i) { return i.type === 'color'; } },
    { key: 'typography', label: 'Typography', accent: '#a78bfa', test: function (i) { return i.type === 'typography'; } },
    { key: 'spacing', label: 'Padding', accent: '#2dd4bf', test: function (i) {
      return i.type === 'spacing' && i.property !== 'borderRadius';
    } },
    { key: 'size', label: 'Size', accent: '#94a3b8', test: function (i) { return i.type === 'size'; } },
    { key: 'radius', label: 'Radius', accent: '#7dd3fc', test: function (i) {
      return i.type === 'spacing' && i.property === 'borderRadius';
    } },
    { key: 'effect', label: 'Effects', accent: '#c084fc', test: function (i) { return i.type === 'effect'; } },
  ];

  var A11Y_CATS = [
    { key: 'contrast', label: 'Contrast', accent: '#fb7185', test: function (i) { return i.a11yCategory === 'contrast'; } },
    { key: 'images', label: 'Images', accent: '#60a5fa', test: function (i) { return i.a11yCategory === 'images'; } },
    { key: 'structure', label: 'Structure', accent: '#a78bfa', test: function (i) { return i.a11yCategory === 'structure'; } },
    { key: 'forms', label: 'Forms', accent: '#34d399', test: function (i) { return i.a11yCategory === 'forms'; } },
    { key: 'keyboard', label: 'Keyboard', accent: '#fbbf24', test: function (i) { return i.a11yCategory === 'keyboard'; } },
    { key: 'focus', label: 'Focus', accent: '#2dd4bf', test: function (i) { return i.a11yCategory === 'focus'; } },
    { key: 'aria', label: 'ARIA', accent: '#c084fc', test: function (i) { return i.a11yCategory === 'aria'; } },
  ];

  function getIssueGroupKey(issue) {
    if (issue.type === 'a11y') {
      return 'a11y|' + issue.ruleId + '|' + String(issue.found || '').trim();
    }
    var fix = issue.fixes && issue.fixes[0];
    var token = fix ? fix.tokenName : '';
    var found = String(issue.found || '').trim();
    if (issue.type === 'typography') {
      return 'typography|font|' + found + '|' + token;
    }
    return issue.type + '|' + issue.property + '|' + found + '|' + token;
  }

  function groupIssuesBySimilarity(issues) {
    var map = Object.create(null);
    var groups = [];
    issues.forEach(function (issue) {
      var key = getIssueGroupKey(issue);
      if (!map[key]) {
        map[key] = {
          key: key,
          issues: [],
          representative: issue,
        };
        groups.push(map[key]);
      }
      map[key].issues.push(issue);
    });
    groups.sort(function (a, b) {
      return b.issues.length - a.issues.length;
    });
    return groups;
  }

  function isGroupApplied(group) {
    return group.issues.every(function (issue) {
      return isIssueApplied(issue);
    });
  }

  function renderCardHeader(issue, group, isIgnored) {
    var count = group ? group.issues.length : 0;
    var ruleKey = group ? group.key : getIssueGroupKey(issue);
    var typeLabel = issue.type === 'a11y' ? 'A11y' : issue.type;
    var wcagHtml = issue.wcag && issue.wcag.length
      ? '<span class="wcag-badge">WCAG ' + escapeHtml(issue.wcag.join(', ')) + '</span>' +
        (issue.wcagLevel ? '<span class="wcag-level">' + escapeHtml(issue.wcagLevel) + '</span>' : '')
      : '';
    return (
      '<div class="issue-card-header-bar">' +
        '<div class="issue-card-header-left">' +
          '<span class="issue-type-label">' + typeLabel +
            (count > 1 ? '<span class="group-count">' + count + '</span>' : '') +
            wcagHtml +
          '</span>' +
          '<span class="issue-header-meta">' + escapeHtml(issue.propertyLabel || issue.wcagName || '') + '</span>' +
        '</div>' +
        '<div class="issue-card-header-actions">' +
          '<button type="button" class="ignore-btn icon-btn" data-rule-key="' + escapeHtml(ruleKey) + '" data-ignored="' + (isIgnored ? '1' : '0') + '" data-issue-count="' + (group ? group.issues.length : 1) + '" title="' + (isIgnored ? 'Restore this rule' : 'Ignore this rule') + '" aria-label="' + (isIgnored ? 'Restore this rule' : 'Ignore this rule') + '">' +
            (isIgnored ? RESTORE_ICON : IGNORE_ICON) +
          '</button>' +
        '</div>' +
      '</div>'
    );
  }

  function wireIgnoreButtons(card) {
    card.querySelectorAll('.ignore-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var key = btn.dataset.ruleKey;
        var isIgnored = btn.dataset.ignored === '1';
        var count = parseInt(btn.dataset.issueCount, 10) || 1;
        setRuleIgnored(key, !isIgnored, count);
      });
    });
  }

  function fixDisplayName(fix) {
    if (fix.typeStyleLabel) return fix.typeStyleLabel;
    if (fix.compositeTokenName && window.DSAuditorTokenEngine && window.DSAuditorTokenEngine.compositeTypeDisplayName) {
      return window.DSAuditorTokenEngine.compositeTypeDisplayName(fix.compositeTokenName);
    }
    return fix.tokenName;
  }

  function renderGuidanceHtml(issue) {
    if (!issue.guidance) return '';
    return (
      '<div class="guidance-box">' +
        '<strong>How to fix</strong>' +
        escapeHtml(issue.guidance) +
      '</div>'
    );
  }

  function renderFixesHtml(issue, group) {
    if (issue.type === 'a11y') return renderGuidanceHtml(issue);
    var isColor = issue.type === 'color';
    return (issue.fixes || []).map(function (f, idx) {
      var isApplied = group
        ? isGroupApplied(group)
        : appliedFixKeys[fixTrackingKey(issue, f)];
      var previewColor = isColor ? fixColorPreviewValue(f) : '';
      var swatch = isColor ? colorSwatchHtml(previewColor, '') : '';
      return (
        '<div class="fix-row' + (isApplied ? ' applied' : '') +
          (swatch ? ' fix-row-has-swatch' : '') + '" data-fix-idx="' + idx + '" role="button" tabindex="0">' +
          swatch +
          '<div class="fix-row-main">' +
            '<span class="fix-row-name">' + escapeHtml(fixDisplayName(f)) +
              (f.matchRole ? ' <span class="fix-role">' + escapeHtml(f.matchRole) + '</span>' : '') +
              (f.tier && f.tier !== 'base' ? ' <span class="fix-tier fix-tier-' + f.tier + '">' + f.tier + '</span>' : '') +
            '</span>' +
            '<span class="fix-row-value">' + escapeHtml(f.displayValue || f.fix) +
              (f.compositeTokenName && fixDisplayName(f) !== f.tokenName
                ? ' <span class="fix-token-ref">' + escapeHtml(f.tokenName) + '</span>'
                : '') +
              (f.confidence ? ' <span class="fix-confidence">' + f.confidence + '% match</span>' : '') +
            '</span>' +
          '</div>' +
          '<span class="fix-row-action">' + (isApplied ? 'Applied' : (group && group.issues.length > 1 ? 'Apply all' : 'Apply')) + '</span>' +
        '</div>'
      );
    }).join('');
  }

  function wireIssueCard(card, issue, group) {
    card.addEventListener('mouseenter', function () {
      setHoveredCard(card);
      highlightIssue(issue, false);
    });
    card.addEventListener('mouseleave', function () {
      setHoveredCard(null);
      clearPageHighlight();
    });
    card.addEventListener('click', function (e) {
      if (e.target.closest('.fix-row') || e.target.closest('.group-element-chip') || e.target.closest('.ignore-btn')) return;
      if (group && group.issues.length > 1) {
        card.classList.toggle('expanded');
      }
      highlightIssue(issue, true);
    });

    card.querySelectorAll('.group-element-chip').forEach(function (chip) {
      chip.addEventListener('click', function (e) {
        e.stopPropagation();
        var idx = parseInt(chip.dataset.issueIdx, 10);
        if (!isNaN(idx) && group && group.issues[idx]) {
          highlightIssue(group.issues[idx], true);
        }
      });
    });

    card.querySelectorAll('.fix-row').forEach(function (row) {
      var idx = parseInt(row.dataset.fixIdx, 10);
      var fix = issue.fixes[idx];
      function onApply(e) {
        e.stopPropagation();
        if (group && group.issues.length > 1) {
          applyFixToGroup(group, fix, row);
        } else {
          applyFix(issue, fix, row);
        }
      }
      row.addEventListener('click', onApply);
      row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onApply(e);
        }
      });
    });

    wireIgnoreButtons(card);
  }

  function createIssueCardElement(issue) {
    var card = document.createElement('div');
    card.className = 'issue-card issue-type-' + issue.type +
      (issue.severity ? ' issue-severity-' + issue.severity : '');
    card.innerHTML =
      renderCardHeader(issue, null, false) +
      '<div class="issue-card-body">' +
        '<div class="issue-title">' + escapeHtml(issue.element) + '</div>' +
        '<div class="issue-description">' + escapeHtml(issue.message) + '</div>' +
        renderIssueFoundHtml(issue) +
        renderFixesHtml(issue, null) +
      '</div>';
    wireIssueCard(card, issue, null);
    return card;
  }

  function createGroupCardElement(group) {
    var issue = group.representative;
    var count = group.issues.length;
    var card = document.createElement('div');
    card.className = 'issue-card issue-type-' + issue.type + ' grouped' + (count > 1 ? '' : ' single');
    var title = count > 1
      ? escapeHtml(issue.element) + ' + ' + (count - 1) + ' more'
      : escapeHtml(issue.element);
    var chipsHtml = count > 1
      ? (function () {
          var maxChips = 48;
          var slice = group.issues.slice(0, maxChips);
          var html = slice.map(function (item, idx) {
            return '<span class="group-element-chip" data-issue-idx="' + idx + '">' + escapeHtml(item.element) + '</span>';
          }).join('');
          if (group.issues.length > maxChips) {
            html += '<span class="group-element-chip" style="cursor:default;opacity:0.7">+' +
              (group.issues.length - maxChips) + ' more</span>';
          }
          return '<div class="group-elements">' + html + '</div>';
        })()
      : '';
    card.innerHTML =
      renderCardHeader(issue, group, false) +
      '<div class="issue-card-body">' +
        '<div class="issue-title">' + title + '</div>' +
        '<div class="issue-description">' + escapeHtml(issue.message) + '</div>' +
        renderIssueFoundHtml(issue) +
        renderFixesHtml(issue, group) +
        chipsHtml +
      '</div>';
    wireIssueCard(card, issue, group);
    return card;
  }

  function createIgnoredRuleCard(group) {
    var issue = group.representative;
    var count = group.issues.length;
    var card = document.createElement('div');
    card.className = 'issue-card issue-type-' + issue.type + ' ignored-rule';
    var title = count > 1
      ? escapeHtml(issue.propertyLabel) + ' · ' + count + ' elements'
      : escapeHtml(issue.element);
    card.innerHTML =
      renderCardHeader(issue, group, true) +
      '<div class="issue-card-body">' +
        '<div class="issue-title">' + title + '</div>' +
        '<div class="issue-description">' + escapeHtml(issue.message) + '</div>' +
        renderIssueFoundHtml(issue) +
      '</div>';
    wireIgnoreButtons(card);
    card.addEventListener('mouseenter', function () {
      setHoveredCard(card);
      highlightIssue(issue, false);
    });
    card.addEventListener('mouseleave', function () {
      setHoveredCard(null);
      clearPageHighlight();
    });
    card.addEventListener('click', function (e) {
      if (e.target.closest('.ignore-btn')) return;
      highlightIssue(issue, true);
    });
    return card;
  }

  function createAppliedFixCard(entry) {
    var card = document.createElement('div');
    card.className = 'issue-card issue-type-' + entry.type + ' applied-fix';
    card.innerHTML =
      '<div class="issue-card-header">' +
        '<span class="issue-type-badge">' + escapeHtml(entry.propertyLabel || entry.property || entry.type) + '</span>' +
        '<span class="applied-badge">Applied</span>' +
      '</div>' +
      '<div class="issue-card-body">' +
        '<div class="issue-title">' + escapeHtml(entry.element) + '</div>' +
        '<div class="issue-description">Use token in source · Preview active on page</div>' +
        (entry.type === 'color'
          ? '<div class="issue-found issue-found-color">' +
              colorSwatchHtml(entry.found, 'color-swatch-lg') +
              '<span class="issue-found-value">' + escapeHtml(entry.found) + '</span>' +
            '</div>'
          : '<div class="issue-found">' + escapeHtml(entry.found) + '</div>') +
        '<div class="applied-fix-token">' +
          '<span class="applied-fix-label">Token</span>' +
          '<code>' + escapeHtml(entry.tokenDisplay || entry.tokenName) + '</code>' +
        '</div>' +
        '<div class="applied-fix-token">' +
          '<span class="applied-fix-label">CSS</span>' +
          '<code>' + escapeHtml(entry.cssSnippet || '') + '</code>' +
        '</div>' +
        '<div class="applied-fix-selector"><span class="applied-fix-label">Selector</span> <code>' +
          escapeHtml(entry.selector || '-') + '</code></div>' +
      '</div>';
    return card;
  }

  function renderAppliedSection() {
    if (!appliedFixLog.length) return;
    var entries = appliedFixLog.slice();
    if (activeFilter !== 'all') {
      entries = entries.filter(function (e) { return e.type === activeFilter; });
    }
    if (!entries.length) return;

    var section = document.createElement('div');
    section.className = 'applied-section';
    var header = document.createElement('div');
    header.className = 'applied-header';
    header.innerHTML =
      '<span>' + entries.length + ' applied fix' + (entries.length !== 1 ? 'es' : '') +
        ' · kept in report</span>' +
      '<span class="applied-chevron">▾</span>';
    var body = document.createElement('div');
    body.className = 'applied-body';
    body.style.display = entries.length <= 3 ? 'block' : 'none';
    if (entries.length <= 3) {
      header.querySelector('.applied-chevron').textContent = '▴';
    }
    entries.forEach(function (entry) {
      body.appendChild(createAppliedFixCard(entry));
    });
    header.addEventListener('click', function () {
      var open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'block';
      header.querySelector('.applied-chevron').textContent = open ? '▾' : '▴';
    });
    section.appendChild(header);
    section.appendChild(body);
    issueList.appendChild(section);
  }

  function renderIgnoredSection(report) {
    var groups = getIgnoredGroups();
    if (activeFilter !== 'all') {
      groups = groups.filter(function (g) {
        var rep = g.representative;
        if (report && report.auditMode === 'a11y') return rep.a11yCategory === activeFilter;
        return rep.type === activeFilter;
      });
    }
    if (!groups.length) return;

    var section = document.createElement('div');
    section.className = 'ignored-section';
    var header = document.createElement('div');
    header.className = 'ignored-header';
    var total = groups.reduce(function (n, g) { return n + g.issues.length; }, 0);
    header.innerHTML =
      '<span>' + total + ' ignored rule' + (total !== 1 ? 's' : '') + '</span>' +
      '<span class="ignored-chevron">▾</span>';
    var body = document.createElement('div');
    body.className = 'ignored-body';
    body.style.display = 'none';
    groups.forEach(function (group) {
      body.appendChild(createIgnoredRuleCard(group));
    });
    header.addEventListener('click', function () {
      var open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'block';
      header.querySelector('.ignored-chevron').textContent = open ? '▾' : '▴';
    });
    section.appendChild(header);
    section.appendChild(body);
    issueList.appendChild(section);
  }

  function applyFixToGroup(group, fix, fixRowEl) {
    if (isGroupApplied(group)) {
      showStatus('Already applied', 'success');
      return;
    }

    var fixes = group.issues.map(function (issue) {
      return {
        elementRef: issue.elementRef,
        selector: issue.selector,
        property: issue.property,
        tokenName: fix.tokenName,
        cssValue: fix.fix || ('var(' + fix.tokenName + ')'),
        resolvedCssValue: fix.resolvedCssValue,
      };
    });

    if (fixRowEl) fixRowEl.querySelector('.fix-row-action').textContent = 'Applying…';

    chrome.runtime.sendMessage({
      type: 'APPLY_ALL_FIXES',
      tabId: auditedTabId,
      fixes: fixes,
      tokens: tokenPayload(),
    }).then(function (result) {
      if (!result || !result.ok) {
        if (fixRowEl) fixRowEl.querySelector('.fix-row-action').textContent = 'Apply all';
        showStatus((result && result.error) || 'Could not apply fixes', 'error');
        return;
      }
      group.issues.forEach(function (issue) {
        appliedFixKeys[fixTrackingKey(issue, fix)] = true;
        logAppliedFix(issue, fix, null);
      });
      bulkPreviewActive = true;
      if (fixRowEl) {
        fixRowEl.classList.add('applied');
        fixRowEl.querySelector('.fix-row-action').textContent = 'Applied';
      }
      syncApplyAllToggle();
      if (lastReport) {
        renderFilters(lastReport);
        renderIssues(lastReport);
      }
      showStatus(
        'Applied ' + result.applied + ' fixes' +
        (result.skipped ? ' (' + result.skipped + ' already applied)' : ''),
        'success'
      );
      highlightIssue(group.representative, true);
    }).catch(function (err) {
      if (fixRowEl) fixRowEl.querySelector('.fix-row-action').textContent = 'Apply all';
      showStatus(err && err.message ? err.message : 'Could not apply fixes', 'error');
    });
  }

  function updateViewSwitcher() {
    if (!viewSwitcher) return;
    viewSwitcher.querySelectorAll('.view-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.view === auditViewMode);
    });
  }

  function updateIssueHint(openCount) {
    if (!issueHint) return;
    if (!openCount) {
      issueHint.style.display = 'none';
      return;
    }
    issueHint.style.display = 'block';
    if (lastReport && lastReport.auditMode === 'a11y') {
      issueHint.textContent = 'Hover a card to locate on page · WCAG criteria shown per issue';
      return;
    }
    issueHint.textContent = auditViewMode === 'foundation'
      ? 'Similar violations grouped · Ignore a rule to hide it for this page · Export HTML report when done'
      : 'Hover a card to locate on page · Apply fixes then export HTML report for dev handoff';
  }

  function countByCategory(issues) {
    var byCat = {};
    issues.forEach(function (i) {
      var k = i.a11yCategory || 'structure';
      byCat[k] = (byCat[k] || 0) + 1;
    });
    return byCat;
  }

  function renderFilters(report) {
    var open = remainingIssues();
    var isA11y = report.auditMode === 'a11y';
    var types;

    if (isA11y) {
      var byCat = countByCategory(open);
      types = [
        { id: 'all', label: 'All', count: open.length },
        { id: 'contrast', label: 'Contrast', count: byCat.contrast || 0 },
        { id: 'images', label: 'Images', count: byCat.images || 0 },
        { id: 'structure', label: 'Structure', count: byCat.structure || 0 },
        { id: 'forms', label: 'Forms', count: byCat.forms || 0 },
        { id: 'keyboard', label: 'Keyboard', count: byCat.keyboard || 0 },
        { id: 'focus', label: 'Focus', count: byCat.focus || 0 },
        { id: 'aria', label: 'ARIA', count: byCat.aria || 0 },
      ];
    } else {
      var byType = countByType(open);
      types = [
        { id: 'all', label: 'All', count: open.length },
        { id: 'color', label: 'Color', count: byType.color || 0 },
        { id: 'typography', label: 'Type', count: byType.typography || 0 },
        { id: 'spacing', label: 'Padding', count: byType.spacing || 0 },
        { id: 'size', label: 'Size', count: byType.size || 0 },
        { id: 'effect', label: 'Shadow', count: byType.effect || 0 },
      ];
    }

    filterSegments.innerHTML = '';
    if (activeFilter !== 'all') {
      var filterStillValid = types.some(function (t) {
        return t.id === activeFilter && (t.id === 'all' || t.count > 0);
      });
      if (!filterStillValid) activeFilter = 'all';
    }
    types.forEach(function (t) {
      if (t.id !== 'all' && !t.count) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'filter-chip' + (activeFilter === t.id ? ' active' : '');
      btn.dataset.filter = t.id;
      btn.innerHTML = '<span class="chip-label">' + t.label + '</span><span class="chip-count">' + t.count + '</span>';
      btn.addEventListener('click', function () {
        activeFilter = t.id;
        if (lastReport) persistAuditReport(lastReport);
        renderFilters(report);
        renderIssues(report);
      });
      filterSegments.appendChild(btn);
    });
    filterBar.style.display = report.issueCount ? 'block' : 'none';
    updateViewSwitcher();
    updateIssueHint(open.length);
  }

  function renderFoundationIssues(issues, report) {
    var groups = groupIssuesBySimilarity(issues);
    var anyRendered = false;
    var cats = report && report.auditMode === 'a11y' ? A11Y_CATS : FOUNDATION_CATS;

    cats.forEach(function (cat) {
      var catGroups = groups.filter(function (g) {
        return cat.test(g.representative);
      });
      if (!catGroups.length) return;
      anyRendered = true;

      var section = document.createElement('div');
      section.className = 'foundation-section';

      var hdr = document.createElement('div');
      hdr.className = 'foundation-section-header';
      hdr.innerHTML =
        '<div style="display:flex;align-items:center;gap:8px;">' +
          '<span style="width:8px;height:8px;border-radius:50%;background:' + cat.accent + ';flex-shrink:0;"></span>' +
          '<span style="font-size:12px;font-weight:700;">' + cat.label + '</span>' +
          '<span style="background:var(--warning);color:#fff;border-radius:10px;padding:1px 7px;font-size:10px;font-weight:700;">' +
            catGroups.reduce(function (n, g) { return n + g.issues.length; }, 0) +
          '</span>' +
        '</div>' +
        '<svg class="foundation-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
      hdr.addEventListener('click', function () {
        section.classList.toggle('collapsed');
      });

      var body = document.createElement('div');
      body.className = 'foundation-section-body';
      catGroups.forEach(function (group) {
        body.appendChild(createGroupCardElement(group));
      });

      section.appendChild(hdr);
      section.appendChild(body);
      issueList.appendChild(section);
    });

    return anyRendered;
  }

  function renderComponentIssues(issues) {
    issues.forEach(function (issue) {
      issueList.appendChild(createIssueCardElement(issue));
    });
    return issues.length > 0;
  }

  function renderIssues(report) {
    var issues = remainingIssues();
    if (activeFilter !== 'all') {
      if (report.auditMode === 'a11y') {
        issues = issues.filter(function (i) { return i.a11yCategory === activeFilter; });
      } else {
        issues = issues.filter(function (i) { return i.type === activeFilter; });
      }
    }

    issueList.innerHTML = '';
    if (!issues.length) {
      emptyState.style.display = 'block';
      var ignoredCount = countIgnoredIssues();
      var appliedCount = appliedFixLog.length;
      if (report.issueCount && activeFilter === 'all' && appliedCount > 0 && !ignoredCount) {
        emptyState.innerHTML =
          '<p><strong>All open issues addressed.</strong> ' + appliedCount +
          ' fix' + (appliedCount !== 1 ? 'es' : '') +
          ' applied. See list below or export HTML report for your dev team.</p>';
      } else if (report.issueCount) {
        emptyState.innerHTML = activeFilter !== 'all'
          ? '<p>No open issues in this category.</p>'
          : (ignoredCount > 0 || appliedCount > 0
            ? '<p>All open issues resolved, applied, or ignored.</p>'
            : (report.auditMode === 'a11y'
              ? '<p>No accessibility violations found on this page.</p>'
              : '<p>No token violations found on this page.</p>'));
      } else {
        emptyState.innerHTML = report.auditMode === 'a11y'
          ? '<p>No accessibility violations found on this page.</p>'
          : '<p>No token violations found on this page.</p>';
      }
      renderAppliedSection();
      renderIgnoredSection(report);
      refreshComplianceUI();
      if (report.auditMode !== 'a11y') syncApplyAllToggle();
      return;
    }

    emptyState.style.display = 'none';

    var rendered = auditViewMode === 'foundation'
      ? renderFoundationIssues(issues, report)
      : renderComponentIssues(issues);

    if (!rendered) {
      emptyState.style.display = 'block';
      emptyState.innerHTML = '<p>No open issues in this category.</p>';
    }

    renderAppliedSection();
    renderIgnoredSection(report);

    refreshComplianceUI();
    if (report.auditMode !== 'a11y') syncApplyAllToggle();
  }

  function renderReport(report) {
    lastReport = report;
    if (report && report.auditMode) auditMode = report.auditMode;
    if (!isValidFilterForMode(auditMode, activeFilter)) activeFilter = 'all';
    setReportLayout(!!report);
    document.querySelectorAll('.audit-mode-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.mode === auditMode);
    });
    var scoreLabelEl = $('scoreLabel');
    if (scoreLabelEl) {
      scoreLabelEl.textContent = auditMode === 'a11y' ? 'Accessibility score' : 'Compliance';
    }
    exportBtn.style.display = report ? 'flex' : 'none';
    persistAuditReport(report);
    refreshComplianceUI();

    renderFilters(report);
    renderIssues(report);
    updateApplyAllBar(report);
    if (auditMode === 'tokens') syncFromPageFixState();
  }

  function sendAuditRequest(payload, tab, onReport) {
    var msg = {
      type: 'RUN_AUDIT_ON_TAB',
      auditMode: payload.auditMode,
      tokens: payload.tokens || [],
      tabId: payload.tabId || embeddedTabId || (tab && tab.id),
      pageUrl: payload.pageUrl || embeddedPageUrl || (tab && tab.url),
    };
    chrome.runtime.sendMessage(msg, function (report) {
      setLoading(false);
      if (chrome.runtime.lastError) {
        showStatus(chrome.runtime.lastError.message, 'error');
        return;
      }
      if (!report || typeof report !== 'object') {
        showStatus('Audit failed. Refresh the page and try again.', 'error');
        return;
      }
      if (report.error) {
        showStatus(report.error, 'error');
        return;
      }
      if (report.tabId) auditedTabId = report.tabId;
      onReport(report, tab);
    });
  }

  function runAudit() {
    if (auditMode === 'a11y') {
      getActiveTabContext(function (tab) {
        auditedTabId = tab && tab.id;
        activeFilter = 'all';
        setLoading(true, 'Scanning accessibility…');
        showStatus('Scanning page for accessibility issues…');
        sendAuditRequest({ auditMode: 'a11y', tokens: [] }, tab, function (report) {
          report.auditMode = 'a11y';
          var pageUrl = (report.page && report.page.url) || (tab && tab.url) || embeddedPageUrl || '';
          var pageKey = getPageIgnoreKey(pageUrl);
          loadIgnoredRules(pageKey, function () {
            appliedFixLog = [];
            rebuildAppliedKeysFromLog();
            renderReport(report);
            showSessionToast(report);
            showStatus(
              'Accessibility audit · ' + (report.issueCount || 0) + ' issues · Export HTML report',
              'success'
            );
          });
        });
      });
      return;
    }

    var tokens = getActiveTokens();
    if (!tokens.length) {
      showStatus('Add at least one token library', 'error');
      return;
    }

    getActiveTabContext(function (tab) {
      auditedTabId = tab && tab.id;
      activeFilter = 'all';
      setLoading(true, 'Auditing design tokens…');
      showStatus('Scanning page against your token libraries…');
      sendAuditRequest({ auditMode: 'tokens', tokens: tokens }, tab, function (report) {
        report.auditMode = 'tokens';
        var pageUrl = (report.page && report.page.url) || (tab && tab.url) || embeddedPageUrl || '';
        var pageKey = getPageIgnoreKey(pageUrl);
        loadIgnoredRules(pageKey, function () {
          loadAppliedFixLog(pageKey, function () {
            rebuildAppliedKeysFromLog();
            renderReport(report);
            showSessionToast(report);
            var kept = appliedFixLog.length;
            if (kept > 0) {
              showStatus(
                'Audit refreshed · ' + kept + ' applied fix' + (kept !== 1 ? 'es' : '') +
                ' kept · Export HTML report for dev handoff',
                'success'
              );
            } else {
              showStatus('Hover cards to preview · Click Apply to inject the token fix', 'success');
            }
          });
        });
      });
    });
  }

  function exportReport(e) {
    if (!lastReport) return;
    // Default: HTML for both modes.
    // Shift+click: Excel (a11y) or JSON (tokens). Alt+click: JSON.
    if (e && e.altKey) {
      exportJsonReport();
      return;
    }
    if (lastReport.auditMode === 'a11y' && e && e.shiftKey) {
      exportA11yExcel();
      return;
    }
    if (lastReport.auditMode !== 'a11y' && e && e.shiftKey) {
      exportJsonReport();
      return;
    }
    exportHtmlReport();
  }

  // Wire events
  $('settingsBtn').addEventListener('click', function () { showScreen('librariesScreen'); });
  $('backBtn').addEventListener('click', function () {
    showScreen('mainScreen');
    refreshReportUI();
  });
  runAuditBtn.addEventListener('click', runAudit);
  exportBtn.addEventListener('click', exportReport);
  var sessionRerunBtn = $('sessionRerunBtn');
  var sessionNewBtn = $('sessionNewBtn');
  var sessionToastDismiss = $('sessionToastDismiss');
  if (sessionRerunBtn) {
    sessionRerunBtn.addEventListener('click', function () {
      hideSessionToast();
      runAudit();
    });
  }
  if (sessionNewBtn) {
    sessionNewBtn.addEventListener('click', startNewSession);
  }
  if (sessionToastDismiss) {
    sessionToastDismiss.addEventListener('click', hideSessionToast);
  }
  var auditModeBar = $('auditModeBar');
  if (auditModeBar) {
    auditModeBar.querySelectorAll('.audit-mode-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setAuditMode(btn.dataset.mode);
      });
    });
  }
  var applyAllToggle = $('applyAllToggle');
  if (applyAllToggle) applyAllToggle.addEventListener('change', onApplyAllToggleChange);

  if (viewSwitcher) {
    viewSwitcher.querySelectorAll('.view-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var mode = btn.dataset.view;
        if (!mode || mode === auditViewMode) return;
        auditViewMode = mode;
        updateViewSwitcher();
        if (lastReport) {
          persistAuditReport(lastReport);
          renderIssues(lastReport);
          updateIssueHint(remainingIssues().length);
        }
      });
    });
  }

  uploadZone.addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () {
    if (fileInput.files.length) handleFiles(fileInput.files);
    fileInput.value = '';
  });
  uploadZone.addEventListener('dragover', function (e) { e.preventDefault(); });
  uploadZone.addEventListener('drop', function (e) {
    e.preventDefault();
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });

  // Keyboard: Cmd/Ctrl+E HTML report, Shift+Cmd/Ctrl+E Excel (a11y) / JSON (tokens)
  document.addEventListener('keydown', function (e) {
    if (e.key === 'e' && (e.metaKey || e.ctrlKey) && lastReport) {
      e.preventDefault();
      if (e.shiftKey && lastReport.auditMode === 'a11y') exportA11yExcel();
      else if (e.shiftKey) exportJsonReport();
      else exportHtmlReport();
    }
  });

  loadLibraries().then(function () {
    renderLibraries();
    updateAuditButton();
    restorePersistedAudit(function (restored) {
      if (!restored) syncFromPageFixState();
    });
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && !lastReport) restorePersistedAudit();
  });

  window.addEventListener('beforeunload', clearPageHighlight);
  issueList.addEventListener('mouseleave', function () {
    setHoveredCard(null);
    clearPageHighlight();
  });
})();
