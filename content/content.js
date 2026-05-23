/**
 * Content script — highlight, hover preview overlay, idempotent fix injection.
 * Injected on demand when the user audits or previews fixes (not on every page load).
 */
(function () {
  'use strict';

  if (window.__dsAuditorContentInit) return;
  window.__dsAuditorContentInit = true;

  var STYLE_ID = 'ds-auditor-fixes';
  var OVERLAY_ID = 'ds-auditor-overlay';
  var HIGHLIGHT_CLASS = 'ds-auditor-highlight';

  var appliedFixes = Object.create(null);
  var fixRules = Object.create(null);
  var overlayEl = null;
  var highlightedEl = null;
  var scrollListener = null;

  var TYPOGRAPHY_PROPS = ['font', 'fontSize', 'fontFamily', 'fontWeight', 'lineHeight', 'letterSpacing'];

  var CSS_PROP_MAP = {
    color: 'color',
    backgroundColor: 'background-color',
    borderColor: 'border-color',
    outlineColor: 'outline-color',
    marginTop: 'margin-top',
    marginRight: 'margin-right',
    marginBottom: 'margin-bottom',
    marginLeft: 'margin-left',
    paddingTop: 'padding-top',
    paddingRight: 'padding-right',
    paddingBottom: 'padding-bottom',
    paddingLeft: 'padding-left',
    gap: 'gap',
    rowGap: 'row-gap',
    columnGap: 'column-gap',
    fill: 'fill',
    stroke: 'stroke',
    fontFamily: 'font-family',
    fontSize: 'font-size',
    fontWeight: 'font-weight',
    lineHeight: 'line-height',
    letterSpacing: 'letter-spacing',
    boxShadow: 'box-shadow',
    borderRadius: 'border-radius',
    width: 'width',
    height: 'height',
    minWidth: 'min-width',
    minHeight: 'min-height',
    maxWidth: 'max-width',
    maxHeight: 'max-height',
    font: 'font',
  };

  function cssProperty(propKey) {
    return CSS_PROP_MAP[propKey] || propKey.replace(/([A-Z])/g, '-$1').toLowerCase();
  }

  function findElement(elementRef, selector) {
    if (elementRef) {
      var byRef = document.querySelector('[data-ds-auditor-ref="' + elementRef + '"]');
      if (byRef) return byRef;
    }
    if (selector) {
      try {
        return document.querySelector(selector);
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  function ensureOverlay() {
    if (overlayEl && overlayEl.isConnected) return overlayEl;
    overlayEl = document.getElementById(OVERLAY_ID);
    if (!overlayEl) {
      overlayEl = document.createElement('div');
      overlayEl.id = OVERLAY_ID;
      overlayEl.setAttribute('data-ds-auditor-ui', 'overlay');
      document.documentElement.appendChild(overlayEl);
    }
    return overlayEl;
  }

  function positionOverlay(el) {
    if (!el || !overlayEl) return;
    var rect = el.getBoundingClientRect();
    overlayEl.style.display = 'block';
    overlayEl.style.top = rect.top + 'px';
    overlayEl.style.left = rect.left + 'px';
    overlayEl.style.width = Math.max(rect.width, 2) + 'px';
    overlayEl.style.height = Math.max(rect.height, 2) + 'px';
  }

  function attachScrollSync() {
    detachScrollSync();
    scrollListener = function () {
      if (highlightedEl) positionOverlay(highlightedEl);
    };
    window.addEventListener('scroll', scrollListener, true);
    window.addEventListener('resize', scrollListener, true);
  }

  function detachScrollSync() {
    if (scrollListener) {
      window.removeEventListener('scroll', scrollListener, true);
      window.removeEventListener('resize', scrollListener, true);
      scrollListener = null;
    }
  }

  function clearHighlight() {
    if (highlightedEl) {
      highlightedEl.classList.remove(HIGHLIGHT_CLASS);
      highlightedEl = null;
    }
    if (overlayEl) overlayEl.style.display = 'none';
    detachScrollSync();
  }

  function highlightTarget(msg) {
    clearHighlight();
    var el = findElement(msg.elementRef, msg.selector);
    if (!el) return { ok: false, error: 'Element not found on page' };

    highlightedEl = el;
    el.classList.add(HIGHLIGHT_CLASS);
    ensureOverlay();
    positionOverlay(el);
    attachScrollSync();

    if (msg.scroll !== false) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(function () { positionOverlay(el); }, 400);
    }
    return { ok: true };
  }

  function isTypographyProperty(property) {
    return TYPOGRAPHY_PROPS.indexOf(property) !== -1;
  }

  function resolveTypographyApplication(property, tokenName, cssValue, resolvedCssValue, tokens) {
    if (window.DSAuditorTokenEngine && window.DSAuditorTokenEngine.resolveTypographyFix) {
      var resolved = window.DSAuditorTokenEngine.resolveTypographyFix(property, tokenName, tokens || []);
      if (property === 'font' && resolved.compositeTokenName) {
        resolved.cssProperty = 'font';
        resolved.cssValue = 'var(' + resolved.compositeTokenName + ')';
      }
      if (resolvedCssValue) resolved.resolvedCssValue = resolvedCssValue;
      return resolved;
    }
    return {
      cssProperty: cssProperty(property),
      cssValue: cssValue || ('var(' + tokenName + ')'),
      resolvedCssValue: resolvedCssValue,
      compositeTokenName: null,
      propertyTokenName: tokenName,
    };
  }

  function pickCssValue(msg, typoResolved) {
    if (msg.resolvedCssValue) return msg.resolvedCssValue;
    if (typoResolved && typoResolved.resolvedCssValue) return typoResolved.resolvedCssValue;
    if (typoResolved && typoResolved.cssValue) return typoResolved.cssValue;
    return msg.cssValue || ('var(' + msg.tokenName + ')');
  }

  function clearTypographyRulesForElement(elementRef) {
    Object.keys(fixRules).forEach(function (key) {
      var rule = fixRules[key];
      if (rule.elementRef === elementRef && rule.isTypography) delete fixRules[key];
    });
  }

  function ensureFixSheet() {
    var sheet = document.getElementById(STYLE_ID);
    if (!sheet) {
      sheet = document.createElement('style');
      sheet.id = STYLE_ID;
      sheet.setAttribute('data-ds-auditor-ui', 'fixes');
      document.documentElement.appendChild(sheet);
    }
    return sheet;
  }

  function ruleKey(elementRef, property, isTypographyComposite) {
    if (isTypographyComposite) return elementRef + '|font';
    return elementRef + '|' + property;
  }

  function fixKey(elementRef, property, tokenName, isTypographyComposite) {
    if (isTypographyComposite) return elementRef + '|font|' + tokenName;
    return elementRef + '|' + property + '|' + tokenName;
  }

  function rebuildFixSheet() {
    var sheet = ensureFixSheet();
    var blocks = Object.keys(fixRules).map(function (key) {
      var rule = fixRules[key];
      return '[data-ds-auditor-ref="' + rule.elementRef + '"] {\n  ' +
        rule.cssProperty + ': ' + rule.cssValue + ' !important;\n}';
    });
    sheet.textContent = blocks.join('\n\n');
  }

  function applyFix(msg) {
    var elementRef = msg.elementRef;
    var property = msg.property;
    var tokenName = msg.tokenName;
    var tokens = msg.tokens || [];
    var typo = isTypographyProperty(property);
    var typoResolved = typo
      ? resolveTypographyApplication(property, tokenName, msg.cssValue, msg.resolvedCssValue, tokens)
      : null;
    var appliedTokenName = typoResolved && typoResolved.compositeTokenName
      ? typoResolved.compositeTokenName
      : tokenName;
    var appliedCssValue = typo ? pickCssValue(msg, typoResolved) : pickCssValue(msg, null);
    var appliedCssProperty = typoResolved ? typoResolved.cssProperty : cssProperty(property);
    var isTypographyComposite = Boolean(typoResolved && typoResolved.compositeTokenName);
    var idempotentKey = fixKey(elementRef, property, appliedTokenName, isTypographyComposite);

    if (appliedFixes[idempotentKey]) {
      return { ok: true, alreadyApplied: true, fixKey: idempotentKey };
    }

    var el = findElement(elementRef, msg.selector);
    if (!el) return { ok: false, error: 'Element not found on page' };

    if (typo) clearTypographyRulesForElement(elementRef);

    var rk = ruleKey(elementRef, property, isTypographyComposite);
    fixRules[rk] = {
      elementRef: elementRef,
      cssProperty: appliedCssProperty,
      cssValue: appliedCssValue,
      tokenName: appliedTokenName,
      isTypography: typo,
    };
    appliedFixes[idempotentKey] = {
      elementRef: elementRef,
      property: isTypographyComposite ? 'font' : property,
      tokenName: appliedTokenName,
      cssValue: appliedCssValue,
      appliedAt: Date.now(),
    };

    rebuildFixSheet();
    el.classList.add('ds-auditor-fixed');
    el.setAttribute('data-ds-auditor-fixed-' + appliedCssProperty, appliedTokenName);

    return {
      ok: true,
      alreadyApplied: false,
      fixKey: idempotentKey,
      cssProperty: appliedCssProperty,
      cssValue: appliedCssValue,
      compositeTokenName: typoResolved && typoResolved.compositeTokenName,
    };
  }

  function clearAllFixes() {
    appliedFixes = Object.create(null);
    fixRules = Object.create(null);
    var sheet = document.getElementById(STYLE_ID);
    if (sheet) sheet.textContent = '';
    document.querySelectorAll('.ds-auditor-fixed').forEach(function (el) {
      el.classList.remove('ds-auditor-fixed');
      Array.from(el.attributes).forEach(function (attr) {
        if (attr.name.indexOf('data-ds-auditor-fixed-') === 0) el.removeAttribute(attr.name);
      });
    });
    return { ok: true };
  }

  function normalizeBulkFixes(items, tokens) {
    var others = [];
    var typoByElement = Object.create(null);

    (items || []).forEach(function (item) {
      if (!isTypographyProperty(item.property)) {
        others.push(item);
        return;
      }
      var ref = item.elementRef;
      if (!typoByElement[ref]) typoByElement[ref] = [];
      typoByElement[ref].push(item);
    });

    Object.keys(typoByElement).forEach(function (ref) {
      var group = typoByElement[ref];
      var primary = group.find(function (g) { return g.property === 'font'; }) ||
        group.find(function (g) { return g.property === 'fontSize'; }) ||
        group[0];
      var resolved = resolveTypographyApplication(
        primary.property,
        primary.tokenName,
        primary.cssValue,
        primary.resolvedCssValue,
        tokens
      );
      others.push({
        elementRef: primary.elementRef,
        selector: primary.selector,
        property: resolved.compositeTokenName ? 'font' : primary.property,
        tokenName: resolved.compositeTokenName || primary.tokenName,
        cssValue: resolved.cssValue,
        resolvedCssValue: resolved.resolvedCssValue || primary.resolvedCssValue,
      });
    });

    return others;
  }

  function applyAllFixes(msg) {
    var tokens = msg.tokens || [];
    var items = normalizeBulkFixes(msg.fixes || [], tokens);

    var applied = 0;
    var skipped = 0;
    var failed = 0;

    items.forEach(function (item) {
      var result = applyFix({
        elementRef: item.elementRef,
        selector: item.selector,
        property: item.property,
        tokenName: item.tokenName,
        cssValue: item.cssValue,
        resolvedCssValue: item.resolvedCssValue,
        tokens: tokens,
      });
      if (!result.ok) failed++;
      else if (result.alreadyApplied) skipped++;
      else applied++;
    });

    return { ok: true, applied: applied, skipped: skipped, failed: failed, total: items.length };
  }

  function getFixState() {
    return {
      ok: true,
      active: Object.keys(fixRules).length > 0,
      count: Object.keys(fixRules).length,
    };
  }

  chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
    try {
      if (msg.type === 'PING') {
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === 'GET_FIX_STATE') {
        sendResponse(getFixState());
        return;
      }

      if (msg.type === 'RUN_AUDIT') {
        var result = window.DSAuditor.runAudit(msg.tokens || [], {
          url: msg.pageUrl || location.href,
          title: document.title,
        });
        sendResponse(result);
        return;
      }

      if (msg.type === 'HIGHLIGHT') {
        sendResponse(highlightTarget(msg));
        return;
      }

      if (msg.type === 'CLEAR_HIGHLIGHT') {
        clearHighlight();
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === 'APPLY_FIX') {
        sendResponse(applyFix(msg));
        return;
      }

      if (msg.type === 'APPLY_ALL_FIXES') {
        sendResponse(applyAllFixes(msg));
        return;
      }

      if (msg.type === 'CLEAR_ALL_FIXES') {
        sendResponse(clearAllFixes());
        return;
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  });
})();
