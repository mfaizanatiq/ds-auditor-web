/**
 * Token matching engine — role-aware matching (text, icon, background, stroke, spacing).
 * Prefers brand/semantic tokens over base primitives.
 */
(function (global) {
  'use strict';

  var C = global.DSAuditorColor;
  var P = global.DSAuditorTokenParser;

  function getIndex(tokens) {
    var S = global.DSAuditorTokenSynthesizer;
    return S && tokens && tokens.length ? S.getTokenIndex(tokens) : null;
  }

  var _activeTokens = null;

  function classifyColorRole(name) {
    var index = _activeTokens ? getIndex(_activeTokens) : null;
    if (index && index.colorRole[name] && index.colorRole[name] !== 'unknown') {
      return index.colorRole[name];
    }
    return classifyColorRoleLegacy(name);
  }

  var FG_KEYWORDS = ['text', 'txt', 'copy', 'label', 'content', 'ink', 'foreground', 'fg', 'on', 'heading', 'link'];
  var BG_KEYWORDS = ['background', 'bg', 'surface', 'fill', 'layer', 'container', 'panel', 'overlay'];
  var STROKE_KEYWORDS = ['border', 'stroke', 'outline', 'divider', 'separator', 'ring'];
  var ICON_KEYWORDS = ['icon', 'glyph', 'symbol'];
  var GAP_KEYWORDS = ['gap', 'gutter'];
  var MARGIN_KEYWORDS = ['margin', 'offset'];
  var PADDING_KEYWORDS = ['padding', 'inset'];

  var TIER_SCORE = { brand: 60, semantic: 65, component: 55, unknown: 20, base: 0 };

  var COLOR_ROLE_LABELS = {
    text: 'Text color',
    icon: 'Icon color',
    background: 'Background',
    stroke: 'Stroke / border',
  };

  var SPACING_ROLE_LABELS = {
    margin: 'Margin',
    padding: 'Padding',
    gap: 'Gap',
    radius: 'Border radius',
    spacing: 'Spacing',
    width: 'Width',
    height: 'Height',
    size: 'Size',
  };

  function hasAny(atoms, keywords) {
    for (var i = 0; i < atoms.length; i++) {
      if (keywords.indexOf(atoms[i]) !== -1) return true;
    }
    return false;
  }

  function tokenTier(token) {
    return token.tier || P.getTokenTier(token.name);
  }

  function tierScore(token) {
    if (token.inferredTier) {
      var inferred = { brand: 60, semantic: 65, component: 58, unknown: 22, base: 0 };
      if (inferred[token.inferredTier] !== undefined) return inferred[token.inferredTier];
    }
    return TIER_SCORE[tokenTier(token)] || 0;
  }

  function isBaseTier(token) {
    return tokenTier(token) === 'base';
  }

  function parsedColor(token) {
    var p = token.parsedResolved || token.parsed;
    return p && p.color ? p.color : null;
  }

  function parsedNumber(token) {
    var p = token.parsedResolved || token.parsed;
    return p && typeof p.number === 'number' ? p.number : null;
  }

  /** Classify token name into color semantic role. */
  function classifyColorRoleLegacy(name) {
    var n = String(name || '').toLowerCase();
    var atoms = P.atomise(name);

    if (/-color-icon-/.test(n) || /-icon-/.test(n) && /color/.test(n)) return 'icon';
    if (/-color-text-/.test(n) || /-text-/.test(n) && /color/.test(n)) return 'fg';
    if (/-color-background-/.test(n) || /-background-/.test(n) && /color/.test(n)) return 'bg';
    if (/-color-border-/.test(n) || /-border-/.test(n) && /color/.test(n)) return 'stroke';
    if (/-shadow-/.test(n) && /color/.test(n)) return 'shadow';
    if (hasAny(atoms, ICON_KEYWORDS) && !hasAny(atoms, BG_KEYWORDS)) return 'icon';
    if (hasAny(atoms, STROKE_KEYWORDS) && !hasAny(atoms, FG_KEYWORDS)) return 'stroke';
    if (hasAny(atoms, BG_KEYWORDS) && !hasAny(atoms, FG_KEYWORDS) && !/-text-/.test(n)) return 'bg';
    if (hasAny(atoms, FG_KEYWORDS) && !hasAny(atoms, BG_KEYWORDS)) return 'fg';
    if (hasAny(atoms, ICON_KEYWORDS)) return 'icon';
    if (hasAny(atoms, BG_KEYWORDS)) return 'bg';
    if (hasAny(atoms, FG_KEYWORDS)) return 'fg';
    return 'unknown';
  }

  function usageRoleFromPropKey(propKey) {
    if (propKey === 'backgroundColor') return 'background';
    if (propKey === 'borderColor' || propKey === 'outlineColor') return 'stroke';
    if (propKey === 'stroke') return 'stroke';
    if (propKey === 'fill') return 'icon';
    return 'text';
  }

  function normalizeColorOptions(propKeyOrOptions, isText) {
    if (propKeyOrOptions && typeof propKeyOrOptions === 'object') {
      var o = propKeyOrOptions;
      if (!o.usageRole) o.usageRole = usageRoleFromPropKey(o.propKey || 'color');
      if (!o.context) o.context = {};
      return o;
    }
    return {
      propKey: propKeyOrOptions || 'color',
      usageRole: usageRoleFromPropKey(propKeyOrOptions || 'color'),
      isText: Boolean(isText),
      context: {},
    };
  }

  function getPattern() {
    return global.DSAuditorPattern || null;
  }

  function buildElementContext(el, cs) {
    var Pat = getPattern();
    if (Pat && Pat.buildElementContext) return Pat.buildElementContext(el, cs);
    return {};
  }

  function tokenMatchesColorUsage(token, usageRole, strict) {
    var role = classifyColorRole(token.name);
    if (usageRole === 'background') return role === 'bg';
    if (usageRole === 'text') return role === 'fg';
    if (usageRole === 'icon') return role === 'icon' || (!strict && role === 'fg');
    if (usageRole === 'stroke') return role === 'stroke';
    if (strict) return false;
    return role === 'unknown';
  }

  function scoreColorRole(token, options) {
    var role = classifyColorRole(token.name);
    var usageRole = options.usageRole || 'text';
    var isText = options.isText;

    if (usageRole === 'background') {
      if (role === 'bg') return 45;
      if (role === 'stroke') return 6;
      return 0;
    }
    if (usageRole === 'stroke') {
      if (role === 'stroke') return 45;
      if (role === 'bg') return 5;
      return 0;
    }
    if (usageRole === 'icon') {
      if (role === 'icon') return 45;
      if (role === 'fg' && isText) return 18;
      if (role === 'fg') return 12;
      return 0;
    }
    if (usageRole === 'text') {
      if (role === 'fg') return 45;
      if (role === 'icon' && isText) return 10;
      return 0;
    }
    return 12;
  }

  function scoreColorToken(token, options) {
    var roleScore = scoreColorRole(token, options);
    if (roleScore <= 0) return 0;
    return tierScore(token) + roleScore;
  }

  function buildFix(token, displayValue, score, tier, extra) {
    var fix = {
      tokenName: token.name,
      tokenValue: token.value,
      displayValue: displayValue,
      tier: tier || tokenTier(token),
      score: score,
      fix: 'var(' + token.name + ')',
    };
    if (extra) Object.assign(fix, extra);
    return fix;
  }

  function rankFixes(list) {
    list.sort(function (a, b) {
      var as = a.patternScore != null ? a.patternScore : a.score;
      var bs = b.patternScore != null ? b.patternScore : b.score;
      if (bs !== as) return bs - as;
      if (a.tier === 'base' && b.tier !== 'base') return 1;
      if (b.tier === 'base' && a.tier !== 'base') return -1;
      return (a.dist || 0) - (b.dist || 0);
    });
    return list;
  }

  function pickFixes(semanticMatches, baseMatches, limit) {
    var out = rankFixes(semanticMatches).slice(0, limit);
    if (out.length < limit && baseMatches.length) {
      var room = limit - out.length;
      out = out.concat(rankFixes(baseMatches).slice(0, room));
    }
    return out;
  }

  function findMatchingColors(value, tokens, propKeyOrOptions, isText) {
    _activeTokens = tokens;
    var options = normalizeColorOptions(propKeyOrOptions, isText);
    var context = options.context || {};
    var Pat = getPattern();
    var parsed = C.parseColor(value);
    if (!parsed || parsed.type === 'var') return [];
    if (!tokens || !tokens.length) return [];

    var usageRole = options.usageRole || 'text';
    var matchRole = COLOR_ROLE_LABELS[usageRole] || usageRole;
    var candidates = [];
    var maxDist = C.COLOR_DISTANCE_THRESHOLD * 1.75;

    tokens.forEach(function (token) {
      if (token.category !== 'color') return;
      var tc = parsedColor(token);
      if (!tc) return;

      var dist = C.colorDistance(parsed, tc);
      if (dist > maxDist) return;

      var patternScore = Pat
        ? Pat.scoreColorPattern(token, parsed, dist, usageRole, context, tierScore, classifyColorRole)
        : scoreColorToken(token, options);

      if (patternScore < 26) return;

      var fix = buildFix(token, C.colorToHex(tc), patternScore, tokenTier(token), {
        matchRole: matchRole,
        tokenRole: classifyColorRole(token.name),
        patternScore: Math.round(patternScore),
        confidence: Pat ? Pat.confidenceFromScore(patternScore, 96) : undefined,
      });
      fix.dist = dist;
      candidates.push(fix);
    });

    return rankFixes(candidates).slice(0, 3);
  }

  function endMatching() {
    _activeTokens = null;
  }

  function inferSpacingUsage(propKey) {
    if (propKey === 'borderRadius') return 'radius';
    if (propKey === 'gap' || propKey === 'rowGap' || propKey === 'columnGap') return 'gap';
    if (propKey === 'width' || propKey === 'minWidth' || propKey === 'maxWidth') return 'width';
    if (propKey === 'height' || propKey === 'minHeight' || propKey === 'maxHeight') return 'height';
    if (/^margin/.test(propKey)) return 'margin';
    if (/^padding/.test(propKey)) return 'padding';
    return 'spacing';
  }

  function isSizeToken(name, token) {
    if (token && token.category === 'size') return true;
    var n = String(name || '').toLowerCase();
    if (/font-size|type-scale|typography|line-height|letter-spacing/.test(n)) return false;
    if (/(?:^--f-(?:base|brand)-size-)/.test(n)) return true;
    var atoms = P.atomise(name);
    if (atoms.indexOf('size') !== -1 || atoms.indexOf('dimension') !== -1) return true;
    if (atoms.indexOf('width') !== -1 || atoms.indexOf('height') !== -1) return true;
    return false;
  }

  function spacingNameAffinity(n, atoms, usageRole) {
    if (usageRole === 'radius') {
      return /radius|corner|round/.test(n) || hasAny(atoms, ['radius', 'corner', 'round']);
    }
    if (usageRole === 'gap') {
      return /gap|gutter/.test(n) || hasAny(atoms, GAP_KEYWORDS) || (/-space-/.test(n) && !/radius/.test(n));
    }
    if (usageRole === 'margin' || usageRole === 'padding' || usageRole === 'spacing') {
      return (/-space-/.test(n) || /spacing/.test(n) || hasAny(atoms, ['space', 'spacing'])) && !/radius|corner|round/.test(n);
    }
    return true;
  }

  function scoreSpacingToken(token, propKey, usageRole, pxValue) {
    var score = tierScore(token);
    var n = token.name.toLowerCase();
    var atoms = P.atomise(token.name);
    var index = _activeTokens ? getIndex(_activeTokens) : null;
    var tier = (index && index.tiers[token.name]) || token.inferredTier || tokenTier(token);

    if (usageRole === 'radius' || propKey.indexOf('radius') !== -1) {
      if (spacingNameAffinity(n, atoms, 'radius')) score += 35;
      else score = 0;
    } else {
      if (!spacingNameAffinity(n, atoms, usageRole)) score = 0;
      else {
        if (/-space-/.test(n) || /spacing/.test(n) || hasAny(atoms, ['space', 'spacing'])) score += 28;
        if (tier === 'semantic' || tier === 'brand' || tier === 'component') score += 16;
        if (/-size-/.test(n) && !/-space-/.test(n) && usageRole !== 'gap') score -= 12;
        if (/-radius-/.test(n) || hasAny(atoms, ['radius', 'corner'])) score = 0;
        if (usageRole === 'gap' && (hasAny(atoms, GAP_KEYWORDS) || /gap/.test(n))) score += 15;
        if (usageRole === 'margin' && hasAny(atoms, MARGIN_KEYWORDS)) score += 12;
        if (usageRole === 'padding' && hasAny(atoms, PADDING_KEYWORDS)) score += 12;
        if (pxValue < 0 && (/-n$|space-.*-n/.test(n) || /negative/.test(n))) score += 18;
      }
    }

    return score;
  }

  function findMatchingSpacing(pxValue, tokens, propKey, context) {
    if (pxValue === null || pxValue === undefined) return [];

    var Pat = getPattern();
    var usageRole = inferSpacingUsage(propKey);
    var matchRole = SPACING_ROLE_LABELS[usageRole] || 'Spacing';
    var candidates = [];

    tokens.forEach(function (token) {
      if (token.category !== 'spacing' && token.category !== 'radius') return;
      if (usageRole !== 'radius' && (token.category === 'radius' || /radius|corner|round/.test(token.name.toLowerCase()))) return;
      if (usageRole === 'radius' && token.category !== 'radius' && !/radius|corner|round/.test(token.name.toLowerCase())) return;

      var rv = parsedNumber(token);
      if (rv === null || rv === undefined) return;

      var diff = Math.abs(rv - pxValue);
      var maxDiff = Math.min(12, Math.max(2, Math.abs(pxValue) * 0.55));
      if (diff > maxDiff) return;

      var patternScore = Pat
        ? Pat.scoreSpacingPattern(token, diff, usageRole, pxValue, context || {}, tierScore)
        : scoreSpacingToken(token, propKey, usageRole, pxValue);

      if (patternScore < 24) return;

      var fix = buildFix(token, rv + 'px', patternScore, tokenTier(token), {
        matchRole: matchRole,
        patternScore: Math.round(patternScore),
        confidence: Pat ? Pat.confidenceFromScore(patternScore, 88) : undefined,
      });
      fix.dist = diff;
      fix.resolved = rv;
      candidates.push(fix);
    });

    var semantic = candidates.filter(function (f) { return f.tier !== 'base'; });
    var base = candidates.filter(function (f) { return f.tier === 'base'; });
    if (semantic.length) return pickFixes(semantic, base, 3);
    return rankFixes(base).slice(0, 3);
  }

  /** Lenient width/height matching — only suggests when a token is reasonably close. */
  function findMatchingSize(pxValue, tokens, propKey, context) {
    if (pxValue === null || pxValue === undefined || pxValue <= 0) return [];

    var Pat = getPattern();
    var usageRole = inferSpacingUsage(propKey);
    var matchRole = usageRole === 'width' ? 'Width' : usageRole === 'height' ? 'Height' : 'Size';
    var candidates = [];
    var maxDiff = Math.min(32, Math.max(8, Math.abs(pxValue) * 0.12));

    tokens.forEach(function (token) {
      if (token.category !== 'size' && !isSizeToken(token.name, token)) return;

      var rv = parsedNumber(token);
      if (rv === null || rv === undefined || rv <= 0) return;

      var diff = Math.abs(rv - pxValue);
      if (diff > maxDiff) return;

      var patternScore = Pat
        ? Pat.scoreSpacingPattern(token, diff, 'spacing', pxValue, context || {}, tierScore)
        : tierScore(token) + 30;

      if (/-brand-size-/.test(token.name)) patternScore += 14;
      if (patternScore < 30) return;

      var fix = buildFix(token, rv + 'px', patternScore, tokenTier(token), {
        matchRole: matchRole,
        patternScore: Math.round(patternScore),
        confidence: Pat ? Pat.confidenceFromScore(patternScore, 72) : undefined,
      });
      fix.dist = diff;
      fix.resolved = rv;
      candidates.push(fix);
    });

    var semantic = candidates.filter(function (f) { return f.tier !== 'base'; });
    var base = candidates.filter(function (f) { return f.tier === 'base'; });
    if (semantic.length) return pickFixes(semantic, base, 2);
    return rankFixes(base).slice(0, 2);
  }

  function typographyIsInheritedFromParent(el, cs) {
    var parent = el && el.parentElement;
    if (!parent || parent.nodeType !== 1) return false;
    var doc = el.ownerDocument;
    if (!doc || !doc.defaultView) return false;
    var pcs = doc.defaultView.getComputedStyle(parent);
    return cs.fontSize === pcs.fontSize &&
      cs.fontWeight === pcs.fontWeight &&
      normalizeFontStack(cs.fontFamily) === normalizeFontStack(pcs.fontFamily);
  }

  function shouldFlagTypography(el, cs, typoStyles, tokens, ctx) {
    _activeTokens = tokens;
    if (!typoStyles.fontSize && !typoStyles.fontFamily) return false;
    if (ctx && ctx.isIcon && !(el.textContent || '').trim()) return false;
    if (typographyIsInheritedFromParent(el, cs)) return false;

    var fixes = findMatchingCompositeTypography(typoStyles, tokens, ctx || {});
    if (fixes.length) {
      var best = fixes[0];
      if ((best.valueMatchScore || 0) >= 72 && (best.roleAffinity || 0) >= 12) return false;
      if ((best.score || 0) >= 118) return false;
    }

    return true;
  }

  function isTypographyCandidate(el, ctx) {
    var tag = el.tagName;
    if (['P', 'SPAN', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'A', 'LABEL', 'BUTTON', 'LI', 'TD', 'TH', 'INPUT', 'TEXTAREA'].indexOf(tag) !== -1) {
      return true;
    }
    if (ctx && ctx.headingLevel) return true;
    if (ctx && ctx.hints && (ctx.hints.link || ctx.hints.heading || ctx.hints.caption)) return true;
    if (tag === 'INPUT') {
      var type = (el.getAttribute && el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'hidden' || type === 'checkbox' || type === 'radio') return false;
    }
    return false;
  }

  function normalizeFontStack(fontFamily) {
    if (!fontFamily) return '';
    return fontFamily.split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
  }

  var PRIMARY_FONT_HINTS = ['jotia', 'almarai', 'noto sans', 'noto arabic', 'noto sans turk', 'noto sans viet'];
  var SECONDARY_FONT_HINTS = ['graphik', 'graphik web'];

  function fontRoleKey(family) {
    if (!family) return '';
    if (SECONDARY_FONT_HINTS.some(function (hint) { return family.indexOf(hint) !== -1; })) return 'secondary';
    if (PRIMARY_FONT_HINTS.some(function (hint) { return family.indexOf(hint) !== -1; })) return 'primary';
    return family;
  }

  function isSameFontRole(a, b) {
    if (!a || !b) return false;
    var index = _activeTokens ? getIndex(_activeTokens) : null;
    if (index && index.isSameFontRole(a, b)) return true;
    var ra = fontRoleKey(a);
    var rb = fontRoleKey(b);
    return ra === rb && ra !== a;
  }

  function isCompositeTypography(name, tokens) {
    var index = tokens ? getIndex(tokens) : (_activeTokens ? getIndex(_activeTokens) : null);
    if (index && index.isComposite(name)) return true;
    var n = String(name || '').toLowerCase();
    if (/-font-(size|family|weight)|-line-height|-letter-spacing/.test(n)) return false;
    if (/-type-family-|-type-weight-|-type-scale-|-type-line-height-/.test(n)) return false;
    if (/^--f-brand-type-[a-z0-9-]+$/.test(n)) return true;
    if (/^--f-[a-z0-9-]+-type$/.test(n)) return true;
    return false;
  }

  function compositeTypeDisplayName(name, tokens) {
    var index = tokens ? getIndex(tokens) : (_activeTokens ? getIndex(_activeTokens) : null);
    if (index) return index.getDisplayName(name);
    var n = String(name || '');
    var brand = n.match(/^--f-brand-type-(.+)$/);
    if (brand) return brand[1];
    var component = n.match(/^--f-([a-z0-9-]+)-type$/);
    if (component) return component[1] + '-type';
    return n.replace(/^--f-/, '').replace(/^--/, '');
  }

  function typographyPropSuffix(propKey) {
    if (propKey === 'fontSize') return '-font-size';
    if (propKey === 'fontFamily') return '-font-family';
    if (propKey === 'fontWeight') return '-font-weight';
    if (propKey === 'lineHeight') return '-line-height';
    if (propKey === 'letterSpacing') return '-letter-spacing';
    return '';
  }

  function formatTypographyFound(styles) {
    var weight = styles.fontWeight && styles.fontWeight !== 'normal' ? styles.fontWeight : null;
    var size = styles.fontSize || '';
    var lh = styles.lineHeight && styles.lineHeight !== 'normal' ? styles.lineHeight : null;
    var family = styles.fontFamily
      ? styles.fontFamily.split(',')[0].replace(/['"]/g, '').trim()
      : '';
    var core = weight ? weight + ' ' + size : size;
    if (lh) core += '/' + lh;
    if (family) core += ' ' + family;
    return core.trim();
  }

  function typeStyleBaseFromToken(name) {
    return String(name || '')
      .replace(/-font-size$/, '')
      .replace(/-font-family$/, '')
      .replace(/-font-weight$/, '')
      .replace(/-line-height$/, '')
      .replace(/-letter-spacing$/, '');
  }

  function siblingTypographyToken(tokens, baseName, suffix) {
    var index = getIndex(tokens);
    if (index) {
      var propMap = {
        '-font-size': 'fontSize',
        '-font-weight': 'fontWeight',
        '-font-family': 'fontFamily',
        '-line-height': 'lineHeight',
        '-letter-spacing': 'letterSpacing',
      };
      if (propMap[suffix]) return index.getTypoProp(baseName, propMap[suffix]);
    }
    var target = baseName + suffix;
    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i].name === target) return tokens[i];
    }
    return null;
  }

  function scoreTypographyToken(token, propKey, styles, tokens) {
    var score = tierScore(token);
    var n = token.name.toLowerCase();
    var suffix = typographyPropSuffix(propKey);

    if (suffix && n.endsWith(suffix)) score += 40;
    else return 0;

    if (/-type-(body|headline|title|caption|subheading|link|label|page-title)/.test(n)) score += 15;

    var resolved = token.resolvedValue || token.value;
    var rv = String(resolved).toLowerCase();
    var size = parsePx(styles.fontSize);
    var family = normalizeFontStack(styles.fontFamily);
    var baseName = typeStyleBaseFromToken(token.name);

    if (propKey === 'fontSize' && size && rv === String(size) + 'px') score += 30;
    if (propKey === 'fontSize' && size && rv.indexOf(String(size)) !== -1) score += 20;
    if (propKey === 'fontFamily' && family && rv.indexOf(family) !== -1) score += 30;

    if (tokens && tokens.length) {
      var sizeToken = siblingTypographyToken(tokens, baseName, '-font-size');
      var familyToken = siblingTypographyToken(tokens, baseName, '-font-family');
      if (size && sizeToken) {
        var sizeResolved = String(sizeToken.resolvedValue || sizeToken.value);
        if (sizeResolved.indexOf(String(size)) !== -1) score += 20;
      }
      if (family && familyToken) {
        var familyResolved = String(familyToken.resolvedValue || familyToken.value).toLowerCase();
        if (familyResolved.indexOf(family) !== -1) score += 20;
      }
    }

    return score;
  }

  function parsePx(val, baseFontSize) {
    if (!val || val === 'auto' || val === 'normal') return null;
    var m = String(val).trim().match(/^(-?[\d.]+)(px|rem|em)?$/);
    if (!m) return null;
    var num = parseFloat(m[1]);
    var unit = m[2] || 'px';
    if (unit === 'rem') return num * (baseFontSize || 16);
    if (unit === 'em') return num * (baseFontSize || 16);
    return num;
  }

  function parseWeight(val) {
    if (val === undefined || val === null || val === '') return 400;
    var v = String(val).trim().toLowerCase();
    if (v === 'normal') return 400;
    if (v === 'bold') return 700;
    if (v === 'lighter') return 300;
    if (v === 'bolder') return 700;
    var n = parseInt(v, 10);
    return isNaN(n) ? 400 : n;
  }

  function parseLineHeight(styles, baseFontSize) {
    var lh = styles && styles.lineHeight;
    var fs = parsePx(styles && styles.fontSize, baseFontSize);
    if (!lh || lh === 'normal') return { px: null, ratio: null };
    var px = parsePx(lh, fs || baseFontSize);
    if (px !== null) return { px: px, ratio: fs ? px / fs : null };
    var ratio = parseFloat(lh);
    if (!isNaN(ratio)) return { px: fs ? fs * ratio : null, ratio: ratio };
    return { px: null, ratio: null };
  }

  function inferTypographyRole(context) {
    if (!context) return 'body';
    var tag = context.tag || '';
    if (tag === 'button') return 'button';
    if (context.headingLevel >= 1 && context.headingLevel <= 6) {
      if (context.headingLevel === 1 && context.classAtoms) {
        var hasPageTitle = context.classAtoms.some(function (a) {
          return a.indexOf('page-title') !== -1 || a.indexOf('pagetitle') !== -1;
        });
        if (hasPageTitle) return 'page-title';
      }
      return 'heading-' + context.headingLevel;
    }
    if (tag === 'a') return 'link';
    if (context.hints && context.hints.link) return 'link';
    if (context.classAtoms && context.classAtoms.indexOf('link') !== -1) return 'link';
    if (context.hints && context.hints.caption) return 'caption';
    var size = parsePx(context.fontSize);
    if (size !== null && size <= 12) return 'caption';
    if (context.hints && context.hints.heading) return 'headline';
    if (context.classAtoms && context.classAtoms.some(function (a) {
      return a.indexOf('numeral') !== -1 || a.indexOf('number') !== -1;
    })) return 'numeral';
    return 'body';
  }

  function typographyRoleAffinity(tokenName, role, context) {
    var index = _activeTokens ? getIndex(_activeTokens) : null;
    if (index) {
      var smart = index.scoreRoleAffinity(tokenName, role, context || {});
      if (smart !== 0) return smart;
    }
    var n = String(tokenName || '').toLowerCase();
    var score = 0;
    var weight = context && context.fontWeight ? parseWeight(context.fontWeight) : 400;
    var wanted = global.DSAuditorTokenSynthesizer
      ? global.DSAuditorTokenSynthesizer.roleToWantedTags(role)
      : [];
    wanted.forEach(function (tag) {
      if (n.indexOf(tag) !== -1) score += 18;
    });
    if (role === 'button' && /button|btn|cta/.test(n)) score += 40;
    if (role === 'link' && /link|anchor/.test(n)) score += 36;
    if (role.indexOf('heading-') === 0) {
      var lvl = role.split('-')[1];
      if (n.indexOf('title-' + lvl) !== -1 || n.indexOf('h' + lvl) !== -1) score += 42;
    }
    if (role === 'body' && /body|copy|text/.test(n)) score += 28;
    if (role === 'caption' && /caption|small|helper/.test(n)) score += 36;
    if (weight >= 500 && /medium|semibold|bold/.test(n)) score += 12;
    if (weight < 500 && /regular|normal|light|thin/.test(n)) score += 8;
    if (context && context.hints && P && P.hintBoost) {
      score += Math.min(P.hintBoost(tokenName, context.hints), 18);
    }
    return score;
  }

  function measureTypographyMatch(styles, baseName, tokens) {
    var baseFs = parsePx(styles.fontSize);
    var weight = parseWeight(styles.fontWeight);
    var family = normalizeFontStack(styles.fontFamily);
    var lhInfo = parseLineHeight(styles, baseFs);

    var sizeTok = siblingTypographyToken(tokens, baseName, '-font-size');
    var weightTok = siblingTypographyToken(tokens, baseName, '-font-weight');
    var familyTok = siblingTypographyToken(tokens, baseName, '-font-family');
    var lhTok = siblingTypographyToken(tokens, baseName, '-line-height');

    var points = 0;
    var maxPoints = 0;

    maxPoints += 40;
    if (sizeTok && baseFs !== null) {
      var ts = parsePx(sizeTok.resolvedValue || sizeTok.value, baseFs);
      if (ts !== null) {
        var diff = Math.abs(ts - baseFs);
        if (diff < 0.5) points += 40;
        else if (diff <= 1) points += 32;
        else if (diff <= 2) points += 22;
        else if (diff <= 4) points += 10;
      }
    }

    maxPoints += 25;
    if (weightTok) {
      var tw = parseWeight(weightTok.resolvedValue || weightTok.value);
      var wDiff = Math.abs(tw - weight);
      if (wDiff === 0) points += 25;
      else if (wDiff <= 100) points += 12;
      else if (wDiff <= 200) points += 4;
    }

    maxPoints += 25;
    if (familyTok && family) {
      var tf = normalizeFontStack(familyTok.resolvedValue || familyTok.value);
      if (tf && tf === family) points += 25;
      else if (tf && (tf.indexOf(family) !== -1 || family.indexOf(tf) !== -1)) points += 20;
      else if (isSameFontRole(family, tf)) points += 14;
      else if (_activeTokens) {
        var idx = getIndex(_activeTokens);
        if (idx && idx.isSameFontRole(family, tf)) points += 14;
      }
    }

    maxPoints += 10;
    if (lhTok) {
      var tokFs = sizeTok ? parsePx(sizeTok.resolvedValue || sizeTok.value, baseFs) : baseFs;
      var tokLh = parseLineHeight({
        lineHeight: lhTok.resolvedValue || lhTok.value,
        fontSize: tokFs != null ? tokFs + 'px' : styles.fontSize,
      }, tokFs || baseFs);
      if (lhInfo.ratio !== null && tokLh.ratio !== null) {
        if (Math.abs(lhInfo.ratio - tokLh.ratio) < 0.06) points += 10;
        else if (Math.abs(lhInfo.ratio - tokLh.ratio) < 0.12) points += 5;
      } else if (lhInfo.px !== null && tokLh.px !== null) {
        if (Math.abs(lhInfo.px - tokLh.px) <= 1) points += 10;
        else if (Math.abs(lhInfo.px - tokLh.px) <= 3) points += 5;
      }
    }

    return {
      score: points,
      maxScore: maxPoints,
      ratio: maxPoints ? points / maxPoints : 0,
    };
  }

  function findMatchingTypography(styles, tokens, propKey, context) {
    propKey = propKey || 'fontSize';
    var Pat = getPattern();
    var typoTokens = tokens.filter(function (t) { return t.category === 'typography'; });
    if (!typoTokens.length) return [];

    var semantic = [];
    var base = [];
    var suffix = typographyPropSuffix(propKey);

    typoTokens.forEach(function (token) {
      if (isCompositeTypography(token.name)) return;
      var n = token.name.toLowerCase();
      var suffixMatch = suffix && n.endsWith(suffix);

      var patternScore = Pat
        ? Pat.scoreTypographyPattern(token, propKey, styles, context || {}, tierScore, suffixMatch)
        : scoreTypographyToken(token, propKey, styles, typoTokens);

      if (patternScore < 28) return;

      var fix = buildFix(token, token.resolvedValue || token.value, patternScore, tokenTier(token), {
        matchRole: 'Typography',
        patternScore: Math.round(patternScore),
        confidence: Pat ? Pat.confidenceFromScore(patternScore, 90) : undefined,
      });
      fix.typeStyleBase = typeStyleBaseFromToken(token.name);
      if (isBaseTier(token)) base.push(fix);
      else semantic.push(fix);
    });

    return pickFixes(semantic, base, 3);
  }

  function scoreCompositeTypography(composite, styles, tokens, context) {
    var base = composite.name;
    var match = measureTypographyMatch(styles, base, tokens);
    var role = inferTypographyRole(context || {});
    var roleScore = typographyRoleAffinity(base, role, context || {});

    if (match.score < 30) return 0;
    if (match.score < 52 && roleScore < 18) return 0;

    var tierBonus = Math.min(tierScore(composite), 18);
    return match.score + roleScore + tierBonus;
  }

  function findMatchingCompositeTypography(styles, tokens, context) {
    _activeTokens = tokens;
    if (!tokens || !tokens.length) return [];
    var index = getIndex(tokens);
    var Pat = getPattern();
    var semantic = [];
    var base = [];
    var role = inferTypographyRole(context || {});
    var seen = Object.create(null);

    function pushCandidate(name, token) {
      if (seen[name]) return;
      seen[name] = true;
      token = token || (index && index.byName[name]) || {
        name: name,
        category: 'typography',
        tier: 'semantic',
        inferredTier: 'semantic',
      };
      if (!isCompositeTypography(name, tokens) && !(index && index.isComposite(name))) return;

      var valueMatch = measureTypographyMatch(styles, name, tokens);
      var roleAffinity = typographyRoleAffinity(name, role, context || {});
      var patternScore = scoreCompositeTypography(token, styles, tokens, context || {});
      if (patternScore < 55) return;

      var label = compositeTypeDisplayName(name, tokens);
      var shorthand = resolveCompositeFontValue(name, tokens);
      var fix = buildFix(token, label, patternScore, tokenTier(token), {
        matchRole: 'Type style',
        typeStyleLabel: label,
        compositeTokenName: name,
        patternScore: Math.round(patternScore),
        valueMatchScore: valueMatch.score,
        roleAffinity: roleAffinity,
        confidence: Pat ? Pat.confidenceFromScore(patternScore, 130) : undefined,
      });
      fix.resolvedCssValue = shorthand;
      fix.fix = 'var(' + name + ')';
      if (isBaseTier(token)) base.push(fix);
      else semantic.push(fix);
    }

    if (index) {
      Object.keys(index.composites).forEach(function (key) {
        var comp = index.composites[key];
        if (!comp || comp.name !== key) return;
        pushCandidate(comp.name, index.byName[comp.name]);
      });
    }

    tokens.forEach(function (token) {
      pushCandidate(token.name, token);
    });

    var ranked = pickFixes(semantic, base, 5);
    ranked.sort(function (a, b) {
      var vs = (b.valueMatchScore || 0) - (a.valueMatchScore || 0);
      if (Math.abs(vs) >= 8) return vs;
      var rs = (b.roleAffinity || 0) - (a.roleAffinity || 0);
      if (rs !== 0) return rs;
      return (b.score || 0) - (a.score || 0);
    });
    var seenNames = Object.create(null);
    var out = [];
    ranked.forEach(function (fix) {
      if (seenNames[fix.tokenName]) return;
      seenNames[fix.tokenName] = true;
      out.push(fix);
    });
    return out.slice(0, 3);
  }

  function getCompositeTypeToken(propertyTokenName, tokens) {
    var base = typeStyleBaseFromToken(propertyTokenName);
    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i].name === base && isCompositeTypography(tokens[i].name, tokens)) {
        return tokens[i];
      }
    }
    var index = getIndex(tokens);
    if (index && index.composites[base]) {
      return index.byName[base] || { name: base, category: 'typography', tier: 'semantic' };
    }
    return null;
  }

  function cssPropertyFromKey(propKey) {
    if (propKey === 'fontSize') return 'font-size';
    if (propKey === 'fontFamily') return 'font-family';
    if (propKey === 'fontWeight') return 'font-weight';
    if (propKey === 'lineHeight') return 'line-height';
    if (propKey === 'letterSpacing') return 'letter-spacing';
    if (propKey === 'font') return 'font';
    return propKey;
  }

  function normalizeShadow(shadow) {
    if (!shadow || shadow === 'none') return '';
    return shadow.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function findMatchingShadow(shadowValue, tokens) {
    var norm = normalizeShadow(shadowValue);
    if (!norm) return [];

    var semantic = [];
    var base = [];
    var semanticApprox = [];

    tokens.forEach(function (token) {
      if (token.category !== 'shadow') return;
      var resolved = token.resolvedValue || token.value;
      var tv = normalizeShadow(resolved);
      var score = tierScore(token) + (/-shadow-/.test(token.name) ? 30 : 0);
      if (/-elevation-/.test(token.name)) score += 10;

      if (tv === norm) {
        var fix = buildFix(token, token.name.split('-').slice(-2).join('-'), score, tokenTier(token), {
          matchRole: 'Elevation / shadow',
        });
        if (isBaseTier(token)) base.push(fix);
        else semantic.push(fix);
      }
    });

    if (semantic.length) return pickFixes(semantic, base, 3);

    tokens.forEach(function (token) {
      if (token.category !== 'shadow') return;
      var n = token.name.toLowerCase();
      if (!/-shadow-/.test(n)) return;
      var fix = buildFix(token, token.resolvedValue || token.value, tierScore(token) + 20, tokenTier(token), {
        matchRole: 'Elevation / shadow',
      });
      if (isBaseTier(token)) base.push(fix);
      else semanticApprox.push(fix);
    });

    return pickFixes(semanticApprox.slice(0, 2), base, 2);
  }

  function resolveCompositeFontValue(baseName, tokens) {
    if (!baseName) return null;
    var weight = null;
    var size = null;
    var lh = null;
    var family = null;
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (t.name === baseName + '-font-weight') weight = t.resolvedValue || t.value;
      if (t.name === baseName + '-font-size') size = t.resolvedValue || t.value;
      if (t.name === baseName + '-line-height') lh = t.resolvedValue || t.value;
      if (t.name === baseName + '-font-family') family = t.resolvedValue || t.value;
    }
    if (!size && !family) return null;
    return (weight || '400') + ' ' + (size || 'inherit') + '/' + (lh || 'normal') + ' ' + (family || 'inherit');
  }

  function tokenResolvedValue(tokens, name) {
    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i].name === name) return tokens[i].resolvedValue || tokens[i].value;
    }
    return null;
  }

  function resolveTypographyFix(property, propertyTokenName, tokens) {
    tokens = tokens || [];
    var composite = getCompositeTypeToken(propertyTokenName, tokens);
    var base = composite ? composite.name : typeStyleBaseFromToken(propertyTokenName);
    var shorthand = resolveCompositeFontValue(base, tokens);

    if (composite && shorthand) {
      return {
        cssProperty: 'font',
        cssValue: 'var(' + composite.name + ')',
        resolvedCssValue: shorthand,
        compositeTokenName: composite.name,
        propertyTokenName: propertyTokenName,
      };
    }

    return {
      cssProperty: cssPropertyFromKey(property),
      cssValue: 'var(' + propertyTokenName + ')',
      resolvedCssValue: tokenResolvedValue(tokens, propertyTokenName),
      compositeTokenName: null,
      propertyTokenName: propertyTokenName,
    };
  }

  function enrichFixWithCssValue(fix, property, issueType, tokens) {
    var out = Object.assign({}, fix);
    if (issueType === 'typography') {
      if (property === 'font' && fix.compositeTokenName) {
        out.resolvedCssValue = resolveCompositeFontValue(fix.compositeTokenName, tokens) || fix.resolvedCssValue;
        out.compositeTokenName = fix.compositeTokenName;
        return out;
      }
      var typo = resolveTypographyFix(property, fix.tokenName, tokens);
      out.resolvedCssValue = typo.resolvedCssValue;
      out.compositeTokenName = typo.compositeTokenName;
      return out;
    }
    if (issueType === 'color' || issueType === 'spacing' || issueType === 'radius' || issueType === 'size') {
      out.resolvedCssValue = fix.displayValue;
      return out;
    }
    if (issueType === 'effect') {
      out.resolvedCssValue = tokenResolvedValue(tokens, fix.tokenName) || fix.displayValue;
      return out;
    }
    out.resolvedCssValue = fix.displayValue;
    return out;
  }

  function enrichIssueFixes(issues, tokens) {
    (issues || []).forEach(function (issue) {
      if (!issue.fixes || !issue.fixes.length) return;
      issue.fixes = issue.fixes.map(function (fix) {
        return enrichFixWithCssValue(fix, issue.property, issue.type, tokens);
      });
    });
    return issues;
  }

  function inferColorUsageRole(el, propKey) {
    if (propKey === 'backgroundColor') return 'background';
    if (propKey === 'borderColor' || propKey === 'outlineColor' || propKey === 'stroke') return 'stroke';
    if (propKey === 'fill') return 'icon';

    var tag = el && el.tagName;
    if (tag && ['SVG', 'PATH', 'CIRCLE', 'RECT', 'G', 'LINE', 'POLYGON', 'USE', 'ELLIPSE'].indexOf(tag) !== -1) {
      return 'icon';
    }
    if (el && el.closest && el.closest('svg')) return 'icon';

    var cls = (el && el.className && String(el.className)) || '';
    var id = (el && el.id) || '';
    if (/\b(icon|glyph|symbol|svg)\b/i.test(cls) || /\b(icon|glyph)\b/i.test(id)) return 'icon';

    if (el && ['BUTTON', 'A'].indexOf(el.tagName) !== -1) {
      var text = (el.textContent || '').trim();
      if (!text.length && el.querySelector && el.querySelector('svg, [class*="icon"], [class*="glyph"]')) {
        return 'icon';
      }
    }

    if (el && el.getAttribute && el.getAttribute('role') === 'img') return 'icon';

    return 'text';
  }

  function colorRoleLabel(usageRole) {
    return COLOR_ROLE_LABELS[usageRole] || 'Color';
  }

  function colorRoleMessage(usageRole) {
    if (usageRole === 'background') return 'Hardcoded background — use a background color token.';
    if (usageRole === 'stroke') return 'Hardcoded stroke / border — use a border color token.';
    if (usageRole === 'icon') return 'Hardcoded icon color — use an icon color token.';
    return 'Hardcoded text color — use a text color token.';
  }

  global.DSAuditorTokenEngine = {
    findMatchingColors: findMatchingColors,
    findMatchingSpacing: findMatchingSpacing,
    findMatchingSize: findMatchingSize,
    findMatchingTypography: findMatchingTypography,
    findMatchingCompositeTypography: findMatchingCompositeTypography,
    findMatchingShadow: findMatchingShadow,
    getCompositeTypeToken: getCompositeTypeToken,
    resolveTypographyFix: resolveTypographyFix,
    enrichFixWithCssValue: enrichFixWithCssValue,
    enrichIssueFixes: enrichIssueFixes,
    buildElementContext: buildElementContext,
    inferColorUsageRole: inferColorUsageRole,
    inferSpacingUsage: inferSpacingUsage,
    colorRoleLabel: colorRoleLabel,
    colorRoleMessage: colorRoleMessage,
    classifyColorRole: classifyColorRole,
    typeStyleBaseFromToken: typeStyleBaseFromToken,
    isCompositeTypography: isCompositeTypography,
    compositeTypeDisplayName: compositeTypeDisplayName,
    formatTypographyFound: formatTypographyFound,
    shouldFlagTypography: shouldFlagTypography,
    isTypographyCandidate: isTypographyCandidate,
    typographyIsInheritedFromParent: typographyIsInheritedFromParent,
    parsePx: parsePx,
    normalizeFontStack: normalizeFontStack,
    tokenTier: tokenTier,
  };
})(typeof window !== 'undefined' ? window : self);
