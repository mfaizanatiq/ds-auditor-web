/**
 * DOM design-system auditor — scans elements and produces issues with fixes.
 */
(function (global) {
  'use strict';

  var C = global.DSAuditorColor;
  var E = global.DSAuditorTokenEngine;
  var P = global.DSAuditorTokenParser;

  var SKIP_TAGS = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, META: 1, LINK: 1,
    HEAD: 1, HTML: 1, IFRAME: 1, CANVAS: 1, VIDEO: 1, AUDIO: 1, TEMPLATE: 1,
  };

  var MAX_ELEMENTS = 8000;

  var COLOR_PROPS = [
    { key: 'color', label: 'Text color', category: 'color' },
    { key: 'backgroundColor', label: 'Background', category: 'color' },
    { key: 'borderColor', label: 'Border color', category: 'color' },
    { key: 'outlineColor', label: 'Outline color', category: 'color' },
  ];

  var SVG_COLOR_PROPS = [
    { key: 'fill', label: 'Fill', category: 'color' },
    { key: 'stroke', label: 'Stroke', category: 'color' },
  ];

  var SVG_SHAPE_TAGS = {
    SVG: 1, PATH: 1, CIRCLE: 1, RECT: 1, G: 1, LINE: 1, POLYGON: 1, USE: 1, ELLIPSE: 1,
  };

  var SPACING_PROPS = [
    { key: 'paddingTop', label: 'Padding top', category: 'spacing' },
    { key: 'paddingRight', label: 'Padding right', category: 'spacing' },
    { key: 'paddingBottom', label: 'Padding bottom', category: 'spacing' },
    { key: 'paddingLeft', label: 'Padding left', category: 'spacing' },
    { key: 'gap', label: 'Gap', category: 'spacing' },
    { key: 'rowGap', label: 'Row gap', category: 'spacing' },
    { key: 'columnGap', label: 'Column gap', category: 'spacing' },
  ];

  var SIZE_PROPS = [
    { key: 'width', label: 'Width' },
    { key: 'height', label: 'Height' },
    { key: 'minWidth', label: 'Min width' },
    { key: 'minHeight', label: 'Min height' },
  ];

  var TYPO_PROPS = [
    { key: 'fontFamily', label: 'Font family', category: 'typography' },
    { key: 'fontSize', label: 'Font size', category: 'typography' },
    { key: 'fontWeight', label: 'Font weight', category: 'typography' },
    { key: 'lineHeight', label: 'Line height', category: 'typography' },
    { key: 'letterSpacing', label: 'Letter spacing', category: 'typography' },
  ];

  function isVisible(el, rect) {
    if (!el) return false;
    var st = el.ownerDocument.defaultView.getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) === 0) return false;
    // Keep very small interactive / SVG hosts; only skip empty layout boxes with no box.
    if (rect && rect.width < 0.5 && rect.height < 0.5) {
      var tag = el.tagName;
      if (tag !== 'SVG' && tag !== 'PATH' && tag !== 'IMG' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        return false;
      }
    }
    return true;
  }

  function cssEscape(value) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, function (c) {
      return '\\' + c;
    });
  }

  function isAuditorUi(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.id === 'ds-auditor-panel-host' || el.id === 'ds-auditor-overlay' || el.id === 'ds-auditor-fixes') {
      return true;
    }
    if (el.getAttribute && el.getAttribute('data-ds-auditor-ui')) return true;
    try {
      if (el.closest && el.closest('[data-ds-auditor-ui], #ds-auditor-panel-host, #ds-auditor-overlay')) {
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function getSelector(el) {
    if (el.id) return '#' + cssEscape(el.id);
    var parts = [];
    var cur = el;
    var depth = 0;
    while (cur && cur.nodeType === 1 && depth < 4) {
      var part = cur.tagName.toLowerCase();
      if (cur.id) {
        parts.unshift('#' + cssEscape(cur.id));
        break;
      }
      if (cur.className && typeof cur.className === 'string') {
        var cls = cur.className.trim().split(/\s+/).filter(Boolean)[0];
        if (cls) part += '.' + cssEscape(cls);
      }
      parts.unshift(part);
      cur = cur.parentElement;
      depth++;
    }
    return parts.join(' > ');
  }

  function isTransparentColor(val) {
    return !val || val === 'transparent' || val === 'rgba(0, 0, 0, 0)';
  }

  function isTextElement(el) {
    return ['P', 'SPAN', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'A', 'LABEL', 'BUTTON', 'LI', 'TD', 'TH', 'INPUT', 'TEXTAREA'].indexOf(el.tagName) !== -1;
  }

  function isSvgShape(el) {
    return Boolean(SVG_SHAPE_TAGS[el.tagName]);
  }

  function auditColorProp(el, elementRef, tokens, tokenNames, issues, seen, selector, label, cs, prop, isText, ctx) {
    var val = cs[prop.key];
    if (isTransparentColor(val)) return;
    if (prop.key === 'backgroundColor' && val === 'rgba(0, 0, 0, 0)') return;
    if ((prop.key === 'fill' || prop.key === 'stroke') && (val === 'none' || val === 'currentColor')) return;

    var sig = selector + '|' + prop.key + '|' + val;
    if (seen.has(sig)) return;
    if (usesKnownToken(val, tokenNames)) return;

    var parsed = C.parseColor(val);
    if (!parsed || parsed.type === 'var') return;

    var usageRole = E.inferColorUsageRole(el, prop.key);
    var fixes = E.findMatchingColors(val, tokens, {
      propKey: prop.key,
      usageRole: usageRole,
      isText: isText,
      context: ctx,
    });

    // Always surface hardcoded colors — even when no token match exists yet.
    seen.add(sig);
    issues.push({
      id: issues.length + 1,
      type: 'color',
      colorRole: usageRole,
      severity: fixes.length ? 'warn' : 'info',
      property: prop.key,
      propertyLabel: E.colorRoleLabel(usageRole),
      element: label,
      elementRef: elementRef,
      selector: selector,
      found: val,
      message: fixes.length
        ? E.colorRoleMessage(usageRole)
        : 'Hardcoded ' + (E.colorRoleLabel(usageRole) || 'color') + ' with no matching token in the library.',
      fixes: fixes,
    });
  }

  function spacingMessage(propKey) {
    var usage = E.inferSpacingUsage(propKey);
    if (usage === 'padding') return 'Hardcoded padding — use a spacing token.';
    if (usage === 'gap') return 'Hardcoded gap — use a spacing token.';
    if (usage === 'radius') return 'Hardcoded border radius — use a radius token.';
    return 'Hardcoded spacing — use a spacing token.';
  }

  function sizeMessage(propKey) {
    var usage = E.inferSpacingUsage(propKey);
    if (usage === 'width') return 'Hardcoded width — consider a size token if close to the scale.';
    if (usage === 'height') return 'Hardcoded height — consider a size token if close to the scale.';
    return 'Hardcoded dimension — consider a size token if close to the scale.';
  }

  function spacingLabel(propKey) {
    var usage = E.inferSpacingUsage(propKey);
    if (usage === 'padding') return 'Padding';
    if (usage === 'gap') return 'Gap';
    if (usage === 'radius') return 'Border radius';
    if (usage === 'width') return 'Width';
    if (usage === 'height') return 'Height';
    return 'Spacing';
  }

  function isFluidSizeValue(val) {
    if (!val) return true;
    var v = String(val).trim().toLowerCase();
    return v === 'auto' || v === 'inherit' || v === 'initial' || v === 'unset' ||
      v === 'fit-content' || v === 'max-content' || v === 'min-content' ||
      v.indexOf('%') !== -1 || v.indexOf('vw') !== -1 || v.indexOf('vh') !== -1;
  }
  function usesKnownToken(value, tokenNames) {
    if (!C.isTokenized(value)) return false;
    var varName = C.extractVarName(value);
    if (!varName) return false;
    return tokenNames.has(varName) || tokenNames.has('--' + varName.replace(/^--/, ''));
  }

  function auditElement(el, elementRef, tokens, tokenNames, issues, seen) {
    var rect = el.getBoundingClientRect();
    if (!isVisible(el, rect)) return;

    var cs = getComputedStyle(el);
    var selector = getSelector(el);
    var label = (el.tagName || '').toLowerCase() + (el.className ? '.' + String(el.className).trim().split(/\s+/)[0] : '');
    var isText = isTextElement(el);
    var ctx = E.buildElementContext(el, cs);

    COLOR_PROPS.forEach(function (prop) {
      auditColorProp(el, elementRef, tokens, tokenNames, issues, seen, selector, label, cs, prop, isText, ctx);
    });

    if (isSvgShape(el)) {
      SVG_COLOR_PROPS.forEach(function (prop) {
        auditColorProp(el, elementRef, tokens, tokenNames, issues, seen, selector, label, cs, prop, false, ctx);
      });
    }

    SPACING_PROPS.forEach(function (prop) {
      var val = cs[prop.key];
      var px = E.parsePx(val);
      if (px === null || px === 0) return;

      var sig = selector + '|' + prop.key + '|' + px;
      if (seen.has(sig)) return;
      if (usesKnownToken(val, tokenNames)) return;

      var fixes = E.findMatchingSpacing(px, tokens, prop.key, ctx);
      if (!fixes.length) return;

      seen.add(sig);
      issues.push({
        id: issues.length + 1,
        type: 'spacing',
        severity: 'warn',
        property: prop.key,
        propertyLabel: spacingLabel(prop.key),
        element: label,
        elementRef: elementRef,
        selector: selector,
        found: val,
        message: spacingMessage(prop.key),
        fixes: fixes,
      });
    });

    if (E.isTypographyCandidate(el, ctx)) {
      var typoStyles = {
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing,
      };

      var fontSizeHardcoded = typoStyles.fontSize && !usesKnownToken(typoStyles.fontSize, tokenNames);
      var fontFamilyHardcoded = typoStyles.fontFamily && !usesKnownToken(typoStyles.fontFamily, tokenNames);

      if ((fontSizeHardcoded || fontFamilyHardcoded) &&
          E.isTypographyCandidate(el, ctx) &&
          E.shouldFlagTypography(el, cs, typoStyles, tokens, ctx)) {
        var typoSig = selector + '|typo|font|' + typoStyles.fontSize + '|' + E.normalizeFontStack(typoStyles.fontFamily);
        if (!seen.has(typoSig)) {
          var typoFixes = E.findMatchingCompositeTypography(typoStyles, tokens, ctx);
          seen.add(typoSig);
          issues.push({
            id: issues.length + 1,
            type: 'typography',
            severity: typoFixes.length ? 'warn' : 'info',
            property: 'font',
            propertyLabel: 'Type style',
            element: label,
            elementRef: elementRef,
            selector: selector,
            found: E.formatTypographyFound(typoStyles),
            message: typoFixes.length
              ? 'Hardcoded typography. Use a type style token (e.g. body-medium).'
              : 'Hardcoded typography with no matching type style in the library.',
            fixes: typoFixes,
          });
        }
      }
    }

    SIZE_PROPS.forEach(function (prop) {
      var val = cs[prop.key];
      if (isFluidSizeValue(val)) return;
      var px = E.parsePx(val);
      if (px === null || px <= 0) return;

      var sig = selector + '|size|' + prop.key + '|' + px;
      if (seen.has(sig)) return;
      if (usesKnownToken(val, tokenNames)) return;

      var sizeFixes = E.findMatchingSize(px, tokens, prop.key, ctx);
      if (!sizeFixes.length) return;

      seen.add(sig);
      issues.push({
        id: issues.length + 1,
        type: 'size',
        severity: 'info',
        property: prop.key,
        propertyLabel: spacingLabel(prop.key),
        element: label,
        elementRef: elementRef,
        selector: selector,
        found: val,
        message: sizeMessage(prop.key),
        fixes: sizeFixes,
      });
    });

    var boxShadow = cs.boxShadow;
    if (boxShadow && boxShadow !== 'none') {
      var sigSh = selector + '|shadow|' + boxShadow;
      if (!seen.has(sigSh) && !usesKnownToken(boxShadow, tokenNames)) {
        var shFixes = E.findMatchingShadow(boxShadow, tokens);
        if (shFixes.length) {
          seen.add(sigSh);
          issues.push({
            id: issues.length + 1,
            type: 'effect',
            severity: 'info',
            property: 'boxShadow',
            propertyLabel: 'Box shadow',
            element: label,
            elementRef: elementRef,
            selector: selector,
            found: boxShadow.length > 80 ? boxShadow.slice(0, 80) + '…' : boxShadow,
            message: 'Hardcoded box shadow — use an elevation/shadow token.',
            fixes: shFixes,
          });
        }
      }
    }

    var radius = cs.borderRadius;
    var pxR = E.parsePx(radius.split(' ')[0]);
    if (pxR !== null && pxR > 0) {
      var sigR = selector + '|radius|' + pxR;
      if (!seen.has(sigR) && !usesKnownToken(radius, tokenNames)) {
        var rFixes = E.findMatchingSpacing(pxR, tokens, 'borderRadius', ctx);
        if (rFixes.length) {
          seen.add(sigR);
          issues.push({
            id: issues.length + 1,
            type: 'spacing',
            severity: 'info',
            property: 'borderRadius',
            propertyLabel: spacingLabel('borderRadius'),
            element: label,
            elementRef: elementRef,
            selector: selector,
            found: radius,
            message: spacingMessage('borderRadius'),
            fixes: rFixes,
          });
        }
      }
    }
  }

  function walk(el, tokens, tokenNames, issues, seen, count, refCounter) {
    if (!el || count.n >= MAX_ELEMENTS) return count;
    if (el.nodeType !== 1) return count;
    if (SKIP_TAGS[el.tagName]) return count;
    if (isAuditorUi(el)) return count;

    count.n++;
    if (!el.dataset.dsAuditorRef) {
      el.dataset.dsAuditorRef = 'dsa-' + refCounter.n++;
    }
    auditElement(el, el.dataset.dsAuditorRef, tokens, tokenNames, issues, seen);

    if (el.shadowRoot) {
      var shadowKids = el.shadowRoot.children || [];
      for (var s = 0; s < shadowKids.length; s++) {
        walk(shadowKids[s], tokens, tokenNames, issues, seen, count, refCounter);
        if (count.n >= MAX_ELEMENTS) return count;
      }
    }

    var children = el.children;
    for (var i = 0; i < children.length; i++) {
      walk(children[i], tokens, tokenNames, issues, seen, count, refCounter);
      if (count.n >= MAX_ELEMENTS) break;
    }
    return count;
  }

  function computeComplianceScore(scannedElements, issues) {
    var scanned = Math.max(scannedElements || 1, 1);
    var weightedPenalty = 0;

    (issues || []).forEach(function (iss) {
      if (iss.severity === 'error' || iss.severity === 'warn') {
        weightedPenalty += 0.5;
      } else if (iss.severity === 'info') {
        weightedPenalty += 0.15;
      }
    });

    if (weightedPenalty === 0) return 100;
    return Math.round((scanned / (scanned + weightedPenalty)) * 100);
  }

  function runAudit(tokens, pageMeta) {
    tokens = tokens || [];
    if (P && P.resolveTokenValues) tokens = P.resolveTokenValues(tokens.slice());
    var tokenNames = new Set(tokens.map(function (t) { return t.name; }));
    var issues = [];
    var seen = new Set();
    var count = { n: 0 };
    var refCounter = { n: 0 };

    walk(document.body, tokens, tokenNames, issues, seen, count, refCounter);

    E.enrichIssueFixes(issues, tokens);

    var byType = {};
    issues.forEach(function (i) {
      byType[i.type] = (byType[i.type] || 0) + 1;
    });

    var total = issues.length;
    var score = computeComplianceScore(count.n, issues);

    return {
      page: pageMeta || { url: location.href, title: document.title },
      scannedElements: count.n,
      tokenCount: tokens.length,
      issueCount: total,
      complianceScore: score,
      byType: byType,
      issues: issues,
      auditedAt: new Date().toISOString(),
    };
  }

  global.DSAuditor = {
    runAudit: runAudit,
    computeComplianceScore: computeComplianceScore,
  };
})(typeof window !== 'undefined' ? window : self);
