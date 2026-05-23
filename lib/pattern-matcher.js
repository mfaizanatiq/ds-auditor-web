/**
 * Pattern matcher — multi-signal scoring (context + semantics + value proximity).
 * Ranks tokens like weighted nearest-neighbor retrieval, not hard rule gates.
 */
(function (global) {
  'use strict';

  var C = global.DSAuditorColor;
  var P = global.DSAuditorTokenParser;

  var SEMANTIC_GROUPS = {
    error: ['error', 'danger', 'invalid', 'destructive'],
    disabled: ['disabled', 'inactive'],
    primary: ['primary', 'brand', 'cta'],
    accent: ['accent', 'highlight'],
    success: ['success', 'positive', 'valid'],
    warning: ['warning', 'caution', 'alert'],
    muted: ['muted', 'subtle', 'secondary', 'placeholder'],
    link: ['link', 'anchor', 'href'],
    heading: ['heading', 'headline', 'title', 'hero'],
    caption: ['caption', 'helper', 'footnote', 'fineprint'],
    loyalty: ['loyalty', 'tier', 'burgundy', 'gold', 'silver', 'platinum'],
    dark: ['dark', 'ondark', 'inverse', 'night'],
    light: ['light', 'onlight', 'inverse'],
    icon: ['icon', 'glyph', 'symbol'],
    overlay: ['overlay', 'scrim', 'modal', 'backdrop'],
    divider: ['divider', 'separator', 'rule'],
  };

  var HEADING_TAGS = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };

  function atomise(text) {
    return P && P.atomise ? P.atomise(text) : String(text || '').toLowerCase().split(/[\/\-_.\s]+/).filter(Boolean);
  }

  function tokenAtoms(name) {
    var n = String(name || '')
      .replace(/^--f-(base|brand|component)-/, '')
      .replace(/^--/, '');
    n = n.replace(/^(color|spacing|typography|size|radius|shadow)[\-\/]/, '');
    return atomise(n);
  }

  function jaccard(a, b) {
    if (!a.length || !b.length) return 0;
    var setB = Object.create(null);
    b.forEach(function (x) { setB[x] = 1; });
    var inter = 0;
    a.forEach(function (x) { if (setB[x]) inter++; });
    return inter / (a.length + b.length - inter);
  }

  function haystack(el, cs) {
    var parts = [
      el.id || '',
      typeof el.className === 'string' ? el.className : '',
      el.getAttribute && el.getAttribute('role') || '',
      el.getAttribute && el.getAttribute('aria-label') || '',
      el.getAttribute && el.getAttribute('data-testid') || '',
      el.getAttribute && el.getAttribute('name') || '',
      el.getAttribute && el.getAttribute('type') || '',
    ];
    if (cs && cs.fontSize) parts.push('size-' + cs.fontSize);
    return parts.join(' ').toLowerCase();
  }

  function inferSemanticHints(el, cs) {
    var text = haystack(el, cs);
    var hints = Object.create(null);
    Object.keys(SEMANTIC_GROUPS).forEach(function (group) {
      SEMANTIC_GROUPS[group].forEach(function (kw) {
        if (text.indexOf(kw) !== -1) hints[group] = (hints[group] || 0) + 1;
      });
    });
    if (el.tagName === 'A') hints.link = (hints.link || 0) + 2;
    if (HEADING_TAGS[el.tagName]) hints.heading = (hints.heading || 0) + 3;
    if (el.tagName === 'BUTTON') hints.primary = (hints.primary || 0) + 1;
    if (el.disabled || cs.opacity < 0.45) hints.disabled = (hints.disabled || 0) + 2;
    if (el.getAttribute && el.getAttribute('aria-invalid') === 'true') hints.error = (hints.error || 0) + 3;
    return hints;
  }

  function relativeLuminance(r, g, b) {
    var a = [r, g, b].map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }

  function parseColorLuminance(val) {
    if (!C || !val) return null;
    var p = C.parseColor(val);
    if (!p || p.type === 'var') return null;
    return relativeLuminance(p.r, p.g, p.b);
  }

  function estimateSurfaceMode(el, cs) {
    var bg = cs.backgroundColor;
    var lum = parseColorLuminance(bg);
    if (lum !== null) {
      if (lum < 0.35) return 'dark';
      if (lum > 0.7) return 'light';
    }
    var cur = el.parentElement;
    var depth = 0;
    while (cur && depth < 4) {
      var pcs = cur.ownerDocument.defaultView.getComputedStyle(cur);
      lum = parseColorLuminance(pcs.backgroundColor);
      if (lum !== null) {
        if (lum < 0.35) return 'dark';
        if (lum > 0.7) return 'light';
      }
      cur = cur.parentElement;
      depth++;
    }
    return 'unknown';
  }

  function isIconLike(el) {
    var tag = el.tagName;
    if (['SVG', 'PATH', 'CIRCLE', 'RECT', 'G', 'LINE', 'POLYGON', 'USE', 'ELLIPSE'].indexOf(tag) !== -1) return true;
    if (el.closest && el.closest('svg')) return true;
    var cls = String(el.className || '');
    if (/\b(icon|glyph|symbol|svg)\b/i.test(cls)) return true;
    if (['BUTTON', 'A'].indexOf(tag) !== -1) {
      var t = (el.textContent || '').trim();
      if (!t.length && el.querySelector && el.querySelector('svg, [class*="icon"], [class*="glyph"]')) return true;
    }
    return el.getAttribute && el.getAttribute('role') === 'img';
  }

  function buildElementContext(el, cs) {
    cs = cs || (el.ownerDocument && el.ownerDocument.defaultView.getComputedStyle(el));
    var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
    var hints = inferSemanticHints(el, cs);
    return {
      tag: (el.tagName || '').toLowerCase(),
      headingLevel: HEADING_TAGS[el.tagName] || 0,
      isText: ['P', 'SPAN', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'A', 'LABEL', 'BUTTON', 'LI', 'TD', 'TH', 'INPUT', 'TEXTAREA'].indexOf(el.tagName) !== -1,
      isIcon: isIconLike(el),
      isCompact: rect.width > 0 && rect.width <= 40 && rect.height <= 40,
      surface: estimateSurfaceMode(el, cs),
      hints: hints,
      hintAtoms: Object.keys(hints),
      classAtoms: atomise(typeof el.className === 'string' ? el.className : ''),
      fontSize: cs && cs.fontSize,
      fontWeight: cs && cs.fontWeight,
    };
  }

  function hintBoost(tokenName, hints) {
    if (!hints) return 0;
    var atoms = tokenAtoms(tokenName);
    var n = tokenName.toLowerCase();
    var score = 0;
    Object.keys(hints).forEach(function (group) {
      var weight = hints[group];
      SEMANTIC_GROUPS[group].forEach(function (kw) {
        if (n.indexOf(kw) !== -1 || atoms.indexOf(kw) !== -1) score += 6 * weight;
      });
    });
    return Math.min(score, 28);
  }

  function roleAlignment(tokenRole, usageRole) {
    var matrix = {
      text: { fg: 1, icon: 0.35, bg: 0.05, stroke: 0.12, shadow: 0.05, unknown: 0.18 },
      icon: { fg: 0.35, icon: 1, bg: 0.05, stroke: 0.18, shadow: 0.05, unknown: 0.18 },
      background: { fg: 0.05, icon: 0.05, bg: 1, stroke: 0.15, shadow: 0.08, unknown: 0.12 },
      stroke: { fg: 0.12, icon: 0.12, bg: 0.08, stroke: 1, shadow: 0.05, unknown: 0.15 },
    };
    var row = matrix[usageRole] || matrix.text;
    return row[tokenRole] !== undefined ? row[tokenRole] : 0.1;
  }

  function proximityPoints(dist, maxDist, maxPoints) {
    if (dist <= 0.5) return maxPoints;
    if (dist >= maxDist) return 0;
    return maxPoints * (1 - dist / maxDist);
  }

  function confidenceFromScore(score, maxScore) {
    return Math.max(1, Math.min(99, Math.round((score / maxScore) * 100)));
  }

  function scoreColorPattern(token, parsed, dist, usageRole, context, tierScoreFn, classifyRoleFn) {
    var tokenRole = classifyRoleFn(token.name);
    var score = 0;

    score += proximityPoints(dist, C.COLOR_DISTANCE_THRESHOLD, 38);
    score += roleAlignment(tokenRole, usageRole) * 34;
    score += (tierScoreFn(token) / 65) * 22;
    score += hintBoost(token.name, context && context.hints) * 1.1;
    score += jaccard(tokenAtoms(token.name), (context && context.classAtoms) || []) * 14;

    if (context && context.surface === 'dark' && (usageRole === 'text' || usageRole === 'icon')) {
      if (/ondark|on-dark|text-light|icon-light|light/.test(token.name) && !/background/.test(token.name)) score += 12;
      if (/text-default|icon-default|grey-900|900/.test(token.name)) score -= 8;
    }
    if (context && context.surface === 'light' && usageRole === 'background') {
      if (/background-light|background-default|surface/.test(token.name)) score += 8;
    }
    if (context && context.isCompact && usageRole === 'icon') score += 4;
    if (context && context.hints && context.hints.error && /error|danger|invalid/.test(token.name)) score += 10;
    if (context && context.hints && context.hints.disabled && /disabled/.test(token.name)) score += 10;
    if (context && context.hints && context.hints.primary && /primary/.test(token.name)) score += 8;

    if (tokenRole === 'bg' && usageRole === 'text') score -= 18;
    if (tokenRole === 'fg' && usageRole === 'background') score -= 18;

    return score;
  }

  function scoreSpacingPattern(token, diff, usageRole, pxValue, context, tierScoreFn) {
    var n = token.name.toLowerCase();
    var atoms = tokenAtoms(token.name);
    var score = 0;
    var maxDiff = Math.min(12, Math.max(2, Math.abs(pxValue || 0) * 0.55));

    score += proximityPoints(diff, maxDiff, 42);
    score += (tierScoreFn(token) / 65) * 24;

    if (usageRole === 'radius') {
      if (/radius|corner|round/.test(n)) score += 22;
      else score -= 20;
    } else {
      var tier = token.inferredTier;
      if (/-space-/.test(n) || /spacing/.test(n) || atoms.indexOf('space') !== -1) score += 12;
      if (tier === 'semantic' || tier === 'brand' || tier === 'component') score += 10;
      if (/-radius-/.test(n)) score -= 18;
      if (usageRole === 'gap' && (/gap|gutter/.test(n) || atoms.indexOf('gap') !== -1)) score += 10;
      if (pxValue < 0 && (/-n$|negative/.test(n))) score += 14;
    }

    if (context && context.isCompact && diff <= 4) score += 6;
    if (context && context.hints && context.hints.caption && diff <= 4) score += 4;

    return score;
  }

  function scoreTypographyPattern(token, propKey, styles, context, tierScoreFn, suffixMatch) {
    if (!suffixMatch) return 0;
    var score = (tierScoreFn(token) / 65) * 20 + 24;
    var n = token.name.toLowerCase();
    var resolved = String(token.resolvedValue || token.value).toLowerCase();
    var base = n.replace(/-font-(size|family|weight)$/, '').replace(/-line-height$/, '').replace(/-letter-spacing$/, '');

    if (propKey === 'fontSize' && styles && styles.fontSize) {
      var px = parseFloat(String(styles.fontSize));
      if (!isNaN(px) && resolved.indexOf(String(px)) !== -1) score += 24;
    }
    if (propKey === 'fontFamily' && styles && styles.fontFamily) {
      var fam = styles.fontFamily.split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
      if (fam && resolved.indexOf(fam) !== -1) score += 24;
    }

    if (context && context.headingLevel) {
      if (base.indexOf('title-' + context.headingLevel) !== -1) score += 22;
      if (base.indexOf('page-title') !== -1 && context.headingLevel === 1) score += 18;
      if (base.indexOf('headline') !== -1 && context.headingLevel <= 2) score += 12;
    }
    if (context && context.hints && context.hints.caption && /caption/.test(n)) score += 16;
    if (context && context.hints && context.hints.link && /link/.test(n)) score += 16;
    if (context && context.hints && context.hints.heading && /title|headline|heading/.test(n)) score += 10;
    if (!context || !context.headingLevel) {
      if (/type-body|type-subheading/.test(n)) score += 12;
    }
    if (styles && styles.fontWeight && parseInt(styles.fontWeight, 10) >= 500 && /medium|bold|semibold/.test(n)) score += 8;

    return score;
  }

  global.DSAuditorPattern = {
    buildElementContext: buildElementContext,
    scoreColorPattern: scoreColorPattern,
    scoreSpacingPattern: scoreSpacingPattern,
    scoreTypographyPattern: scoreTypographyPattern,
    hintBoost: hintBoost,
    jaccard: jaccard,
    tokenAtoms: tokenAtoms,
    confidenceFromScore: confidenceFromScore,
    proximityPoints: proximityPoints,
  };
})(typeof window !== 'undefined' ? window : self);
