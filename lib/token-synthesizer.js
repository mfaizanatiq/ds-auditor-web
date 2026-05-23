/**
 * Universal token synthesizer — analyzes any design-system library,
 * infers semantic layers, typography composites, color roles, and tiers.
 */
(function (global) {
  'use strict';

  var P = global.DSAuditorTokenParser;

  var TYPO_SUFFIXES = [
    { key: 'fontSize', patterns: ['-font-size', '-fontsize', '-font-size', '/font-size', '/size'] },
    { key: 'fontWeight', patterns: ['-font-weight', '-fontweight', '/font-weight', '/weight'] },
    { key: 'fontFamily', patterns: ['-font-family', '-fontfamily', '/font-family', '/family'] },
    { key: 'lineHeight', patterns: ['-line-height', '-lineheight', '/line-height', '/line-height'] },
    { key: 'letterSpacing', patterns: ['-letter-spacing', '-letterspacing', '/letter-spacing'] },
  ];

  var SEMANTIC_TAG_LEXICON = {
    button: ['button', 'btn', 'cta', 'action'],
    link: ['link', 'anchor', 'href'],
    body: ['body', 'copy', 'paragraph', 'text', 'content'],
    headline: ['headline', 'head', 'lead'],
    heading: ['heading', 'title', 'hero', 'display'],
    caption: ['caption', 'helper', 'footnote', 'fineprint', 'overline', 'label', 'small'],
    subheading: ['subheading', 'subtitle', 'subhead', 'eyebrow'],
    numerals: ['numeral', 'number', 'stat', 'metric'],
    page: ['page', 'screen'],
    primary: ['primary', 'brand', 'default'],
    secondary: ['secondary', 'muted', 'subtle'],
    error: ['error', 'danger', 'invalid'],
    success: ['success', 'positive'],
    warning: ['warning', 'caution'],
    disabled: ['disabled', 'inactive'],
    icon: ['icon', 'glyph', 'symbol'],
    input: ['input', 'field', 'form'],
    nav: ['nav', 'navigation', 'menu', 'tab'],
  };

  var TIER_BASE = ['base', 'global', 'primitive', 'core', 'raw', 'palette', 'foundation', 'scale'];
  var TIER_SEMANTIC = ['semantic', 'alias', 'theme', 'brand', 'intent', 'role', 'purpose', 'system'];
  var TIER_COMPONENT = ['component', 'comp', 'button', 'input', 'card', 'modal', 'chip', 'badge', 'nav', 'header', 'footer'];

  var COLOR_FG = ['text', 'foreground', 'fg', 'content', 'copy', 'ink', 'label', 'heading', 'link'];
  var COLOR_BG = ['background', 'bg', 'surface', 'fill', 'layer', 'container', 'panel', 'overlay', 'canvas'];
  var COLOR_STROKE = ['border', 'stroke', 'outline', 'divider', 'separator', 'ring'];
  var COLOR_ICON = ['icon', 'glyph', 'symbol'];

  function atomise(name) {
    return P && P.atomise ? P.atomise(name) : String(name || '').toLowerCase().split(/[\/\-_.\s]+/).filter(Boolean);
  }

  function extractVarRef(value) {
    if (!value) return null;
    var m = String(value).match(/var\s*\(\s*([^,)]+)/);
    return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : null;
  }

  function isLiteralValue(val) {
    if (!val) return false;
    var s = String(val).trim();
    if (s.startsWith('var(')) return false;
    if (/^#|^rgb|^hsl|^linear-gradient|^[\d.]+(px|rem|em|%)?$/.test(s)) return true;
    if (/^[\d.]+$/.test(s)) return true;
    if (/^["']?[a-z0-9 ]/i.test(s) && !s.startsWith('var(')) return true;
    return false;
  }

  function refDepth(name, byName, seen) {
    seen = seen || new Set();
    if (seen.has(name)) return 99;
    seen.add(name);
    var t = byName[name];
    if (!t) return 99;
    var ref = extractVarRef(t.value);
    if (!ref) {
      return isLiteralValue(t.resolvedValue || t.value) ? 0 : 1;
    }
    var normalized = ref.indexOf('--') === 0 ? ref : ref;
    if (!byName[normalized] && !byName['--' + normalized.replace(/^--/, '')]) {
      return isLiteralValue(t.resolvedValue) ? 1 : 2;
    }
    var target = byName[normalized] ? normalized : ('--' + normalized.replace(/^--/, ''));
    return 1 + refDepth(target, byName, seen);
  }

  function inferSemanticTags(name) {
    var atoms = atomise(name);
    var tags = Object.create(null);
    Object.keys(SEMANTIC_TAG_LEXICON).forEach(function (tag) {
      SEMANTIC_TAG_LEXICON[tag].forEach(function (kw) {
        if (atoms.indexOf(kw) !== -1 || String(name).toLowerCase().indexOf(kw) !== -1) {
          tags[tag] = true;
        }
      });
    });
    atoms.forEach(function (a) {
      if (/^h[1-6]$/.test(a) || /^title\d$/.test(a)) tags.heading = true;
      if (/^title-\d$/.test(a)) tags.heading = true;
    });
    var hm = String(name).toLowerCase().match(/title-(\d)/);
    if (hm) tags['heading-' + hm[1]] = true;
    return Object.keys(tags);
  }

  function inferColorRole(name, category) {
    if (category !== 'color') return 'unknown';
    var n = String(name || '').toLowerCase();
    var atoms = atomise(name);
    function has(list) {
      return list.some(function (kw) {
        return n.indexOf(kw) !== -1 || atoms.indexOf(kw) !== -1;
      });
    }
    if (has(COLOR_ICON) && !has(COLOR_BG)) return 'icon';
    if (has(COLOR_STROKE) && !has(COLOR_FG)) return 'stroke';
    if (has(COLOR_BG) && !has(COLOR_FG)) return 'bg';
    if (has(COLOR_FG) && !has(COLOR_BG)) return 'fg';
    if (has(COLOR_BG)) return 'bg';
    if (has(COLOR_FG)) return 'fg';
    return 'unknown';
  }

  function inferTier(token, byName, refCounts) {
    var n = String(token.name || '').toLowerCase();
    var atoms = atomise(token.name);
    var depth = refDepth(token.name, byName, new Set());
    var refs = refCounts[token.name] || 0;

    if (TIER_COMPONENT.some(function (k) { return n.indexOf(k) !== -1 || atoms.indexOf(k) !== -1; })) {
      if (depth <= 2) return 'component';
    }
    if (TIER_SEMANTIC.some(function (k) { return n.indexOf(k) !== -1 || atoms.indexOf(k) !== -1; })) {
      return 'semantic';
    }
    if (TIER_BASE.some(function (k) { return n.indexOf(k) !== -1 || atoms.indexOf(k) !== -1; })) {
      if (depth <= 1) return 'base';
    }
    if (depth === 0 && looksLikeFlatSemanticToken(token, atoms)) {
      return 'semantic';
    }
    if (depth === 0) return 'base';
    if (depth === 1 && refs >= 1) return 'semantic';
    if (depth >= 2 && refs >= 2) return 'semantic';
    if (refs >= 4) return 'semantic';
    if (depth >= 3) return 'component';
    if (P && P.getTokenTier) {
      var legacy = P.getTokenTier(token.name);
      if (legacy !== 'unknown') return legacy;
    }
    return depth <= 1 ? 'base' : 'semantic';
  }

  function looksLikeFlatSemanticToken(token, atoms) {
    if (TIER_BASE.some(function (k) { return atoms.indexOf(k) !== -1; })) return false;
    if (atoms.indexOf('palette') !== -1 || atoms.indexOf('primitive') !== -1 || atoms.indexOf('raw') !== -1) {
      return false;
    }
    var cat = token.category;
    if (cat === 'color') {
      return hasAnyAtom(atoms, ['text', 'background', 'surface', 'border', 'brand', 'primary', 'secondary', 'muted', 'default', 'foreground', 'stroke', 'fill', 'icon', 'error', 'success', 'warning']);
    }
    if (cat === 'spacing' || cat === 'radius') {
      return hasAnyAtom(atoms, ['space', 'spacing', 'gap', 'padding', 'margin', 'radius', 'corner']);
    }
    if (cat === 'typography') {
      return hasAnyAtom(atoms, ['body', 'heading', 'title', 'caption', 'label', 'button', 'link', 'display', 'headline', 'small', 'medium', 'large']);
    }
    if (cat === 'shadow') return true;
    return hasAnyAtom(atoms, ['semantic', 'theme', 'alias', 'brand', 'intent', 'role']);
  }

  function hasAnyAtom(atoms, keywords) {
    for (var i = 0; i < keywords.length; i++) {
      if (atoms.indexOf(keywords[i]) !== -1) return true;
    }
    return false;
  }

  function findCommonPrefix(names) {
    if (!names.length) return '';
    var split = names.map(function (n) { return atomise(n); });
    var prefix = [];
    for (var i = 0; i < split[0].length; i++) {
      var atom = split[0][i];
      if (split.every(function (parts) { return parts[i] === atom; })) prefix.push(atom);
      else break;
    }
    return prefix.join('-');
  }

  function stripPrefix(name, prefixAtoms) {
    if (!prefixAtoms) return name;
    var atoms = atomise(name);
    var pref = atomise(prefixAtoms);
    if (pref.length && atoms.slice(0, pref.length).join('-') === pref.join('-')) {
      return atoms.slice(pref.length).join('-') || name;
    }
    var n = String(name);
    n = n.replace(/^--/, '');
    if (prefixAtoms && n.indexOf(prefixAtoms) === 0) {
      return n.slice(prefixAtoms.length).replace(/^-+/, '') || name;
    }
    return n.replace(/^--[^-]+-/, '').replace(/^--/, '');
  }

  function detectTypoSuffix(name) {
    var n = String(name);
    var inlineSize = n.match(/font-size[-/](.+)$/);
    if (inlineSize) {
      return { key: 'fontSize', suffix: '-font-size', base: n, slug: inlineSize[1] };
    }
    var inlineWeight = n.match(/font-weight[-/](.+)$/);
    if (inlineWeight) {
      return { key: 'fontWeight', suffix: '-font-weight', base: n, slug: inlineWeight[1] };
    }
    var inlineFamily = n.match(/font-family[-/](.+)$/);
    if (inlineFamily) {
      return { key: 'fontFamily', suffix: '-font-family', base: n, slug: inlineFamily[1] };
    }
    var inlineLh = n.match(/line-height[-/](.+)$/);
    if (inlineLh) {
      return { key: 'lineHeight', suffix: '-line-height', base: n, slug: inlineLh[1] };
    }
    for (var i = 0; i < TYPO_SUFFIXES.length; i++) {
      var spec = TYPO_SUFFIXES[i];
      for (var j = 0; j < spec.patterns.length; j++) {
        var p = spec.patterns[j];
        if (n.endsWith(p)) {
          return { key: spec.key, suffix: p, base: n.slice(0, n.length - p.length) };
        }
      }
    }
    return null;
  }

  function isFontShorthandValue(val) {
    if (!val) return false;
    var s = String(val).trim();
    if (!s.startsWith('var(')) {
      return /\d+(px|rem|em)\/?[\d.]*/.test(s) && /var\(|,|sans|serif|mono/i.test(s);
    }
    var refs = s.match(/var\s*\([^)]+\)/g);
    return refs && refs.length >= 2;
  }

  function discoverTypographyGroups(tokens, byName) {
    var groups = Object.create(null);
    var composites = Object.create(null);

    tokens.forEach(function (token) {
      if (token.category !== 'typography') return;
      var detected = detectTypoSuffix(token.name);
      if (detected) {
        if (!groups[detected.base]) {
          groups[detected.base] = { base: detected.base, props: Object.create(null), tags: inferSemanticTags(token.name) };
        }
        groups[detected.base].props[detected.key] = token.name;
        inferSemanticTags(token.name).forEach(function (t) {
          groups[detected.base].tags = groups[detected.base].tags || [];
          if (groups[detected.base].tags.indexOf(t) === -1) groups[detected.base].tags.push(t);
        });
        return;
      }

      if (isFontShorthandValue(token.value) || isFontShorthandValue(token.resolvedValue)) {
        var dn = slugFromToken(token.name);
        var compMatch = String(token.name).match(/^--f-([a-z0-9-]+)-type$/);
        if (compMatch) dn = compMatch[1] + '-type';
        composites[token.name] = {
          name: token.name,
          displayName: dn,
          props: Object.create(null),
          tags: inferSemanticTags(token.name),
          explicit: true,
        };
      }
    });

    Object.keys(groups).forEach(function (base) {
      var g = groups[base];
      var propCount = Object.keys(g.props).length;
      if (propCount < 2) return;
      var compMatch = String(base).match(/^--f-([a-z0-9-]+)-type$/);
      var displayName = compMatch ? compMatch[1] + '-type' : slugFromToken(base);
      if (!composites[base]) {
        composites[base] = {
          name: base,
          displayName: displayName,
          props: g.props,
          tags: g.tags || inferSemanticTags(base),
          explicit: !!byName[base] && byName[base].category === 'typography',
          synthesized: true,
        };
      } else if (composites[base].explicit) {
        Object.assign(composites[base].props, g.props);
      } else {
        Object.assign(composites[base].props, g.props);
        composites[base].displayName = displayName;
        composites[base].tags = g.tags || composites[base].tags;
      }
    });

    return { groups: groups, composites: composites };
  }

  function slugFromToken(name) {
    var atoms = atomise(name);
    var skip = ['font', 'size', 'weight', 'family', 'line', 'height', 'letter', 'spacing', 'type', 'typography', 'base', 'brand', 'semantic'];
    var meaningful = atoms.filter(function (a) { return skip.indexOf(a) === -1; });
    return meaningful.slice(-2).join('-') || meaningful.join('-') || atoms.slice(-1)[0] || name;
  }

  function discoverSlugTypographyComposites(tokens) {
    var bySlug = Object.create(null);
    tokens.forEach(function (token) {
      if (token.category !== 'typography') return;
      var n = token.name.toLowerCase();
      var slug = null;
      var prop = null;
      if (/font-size|fontsize/.test(n)) { prop = 'fontSize'; slug = slugFromToken(token.name); }
      else if (/font-weight|fontweight|weight/.test(n) && !/line-height/.test(n)) { prop = 'fontWeight'; slug = slugFromToken(token.name); }
      else if (/font-family|fontfamily|family/.test(n)) { prop = 'fontFamily'; slug = slugFromToken(token.name); }
      else if (/line-height|lineheight/.test(n)) { prop = 'lineHeight'; slug = slugFromToken(token.name); }
      if (!slug || !prop) return;
      if (!bySlug[slug]) bySlug[slug] = { slug: slug, props: Object.create(null), tokens: [] };
      bySlug[slug].props[prop] = token.name;
      bySlug[slug].tokens.push(token.name);
    });

    var composites = Object.create(null);
    Object.keys(bySlug).forEach(function (slug) {
      var entry = bySlug[slug];
      if (Object.keys(entry.props).length < 2) return;
      var name = entry.props.fontSize || entry.tokens[0];
      var base = typeStyleBaseFromSuffix(name);
      composites[base] = {
        name: base,
        displayName: slug,
        props: entry.props,
        tags: inferSemanticTags(slug),
        synthesized: true,
      };
    });

    tokens.forEach(function (token) {
      if (token.category !== 'typography') return;
      var detected = detectTypoSuffix(token.name);
      if (!detected || detected.key !== 'fontSize') return;
      var base = token.name;
      if (composites[base]) return;
      composites[base] = {
        name: base,
        displayName: detected.slug || slugFromToken(token.name),
        props: { fontSize: token.name },
        tags: inferSemanticTags(detected.slug || token.name),
        synthesized: true,
        partial: true,
      };
    });

    return composites;
  }

  function typeStyleBaseFromSuffix(name) {
    var d = detectTypoSuffix(name);
    if (d) return d.base;
    return String(name)
      .replace(/-font-size$/i, '')
      .replace(/-font-weight$/i, '')
      .replace(/-font-family$/i, '')
      .replace(/-line-height$/i, '')
      .replace(/\/size$/i, '')
      .replace(/\/weight$/i, '')
      .replace(/\/family$/i, '');
  }

  function discoverFontFamilies(tokens) {
    var families = Object.create(null);
    tokens.forEach(function (token) {
      if (token.category !== 'typography') return;
      var n = token.name.toLowerCase();
      if (!/family|fontstack|font-stack/.test(n)) return;
      var val = token.resolvedValue || token.value;
      if (!val) return;
      var primary = String(val).split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
      if (!primary) return;
      families[primary] = (families[primary] || 0) + 1;
      var tags = inferSemanticTags(token.name);
      if (tags.indexOf('primary') !== -1 || /primary|display|heading|title/.test(n)) {
        families[primary + '::primary'] = (families[primary + '::primary'] || 0) + 3;
      }
      if (tags.indexOf('secondary') !== -1 || /secondary|body|copy|text|ui/.test(n)) {
        families[primary + '::secondary'] = (families[primary + '::secondary'] || 0) + 3;
      }
    });
    var sorted = Object.keys(families)
      .filter(function (k) { return k.indexOf('::') === -1; })
      .sort(function (a, b) { return (families[b] || 0) - (families[a] || 0); });
    var primary = sorted.find(function (f) { return families[f + '::primary']; }) || sorted[0] || '';
    var secondary = sorted.find(function (f) { return f !== primary && families[f + '::secondary']; }) ||
      sorted.find(function (f) { return f !== primary; }) || '';
    return { all: sorted, primary: primary, secondary: secondary };
  }

  function buildRefCounts(tokens) {
    var counts = Object.create(null);
    tokens.forEach(function (token) {
      var ref = extractVarRef(token.value);
      if (ref) {
        var key = ref.indexOf('--') === 0 ? ref : '--' + ref.replace(/^--/, '');
        counts[key] = (counts[key] || 0) + 1;
      }
    });
    return counts;
  }

  function roleToWantedTags(role) {
    if (role === 'button') return ['button', 'cta', 'action', 'primary'];
    if (role === 'link') return ['link', 'anchor'];
    if (role === 'caption') return ['caption', 'helper', 'small', 'label'];
    if (role === 'headline') return ['headline', 'head', 'lead'];
    if (role === 'page-title') return ['page', 'title', 'heading', 'display'];
    if (role === 'numeral') return ['numeral', 'number', 'stat'];
    if (role === 'body') return ['body', 'copy', 'text', 'content'];
    if (role && role.indexOf('heading-') === 0) {
      var lvl = role.split('-')[1];
      return ['heading', 'title', 'headline', 'heading-' + lvl, 'title-' + lvl, 'h' + lvl];
    }
    return ['body', 'text'];
  }

  function tagAffinity(tokenTags, role, context) {
    var wanted = roleToWantedTags(role);
    var score = 0;
    tokenTags.forEach(function (t) {
      if (wanted.indexOf(t) !== -1) score += 22;
      if (role === t) score += 30;
      if (role.indexOf('heading-') === 0 && t === role) score += 40;
    });
    if (context && context.hints) {
      Object.keys(context.hints).forEach(function (hint) {
        if (tokenTags.indexOf(hint) !== -1) score += 8 * context.hints[hint];
      });
    }
    if (role === 'button') {
      if (tokenTags.indexOf('button') !== -1) score += 55;
      if (tokenTags.indexOf('link') !== -1 && tokenTags.indexOf('button') === -1) score -= 35;
    }
    if (context && context.tag === 'button' && tokenTags.indexOf('link') !== -1 && tokenTags.indexOf('button') === -1) {
      score -= 35;
    }
    return score;
  }

  function mergeTypographyComposites(primary, secondary) {
    var out = Object.assign({}, secondary);
    Object.keys(primary).forEach(function (key) {
      var a = primary[key];
      var b = out[key];
      if (!b) {
        out[key] = a;
        return;
      }
      var preferredDisplay;
      if (a.explicit && !b.explicit) preferredDisplay = a.displayName;
      else if (b.explicit && !a.explicit) preferredDisplay = b.displayName;
      else if (a.explicit && b.explicit) preferredDisplay = a.displayName;
      else preferredDisplay = a.displayName || b.displayName;
      out[key] = Object.assign({}, b, a, {
        displayName: preferredDisplay,
        props: Object.assign({}, b.props, a.props),
        tags: (a.tags && a.tags.length ? a.tags : b.tags) || [],
      });
    });
    return out;
  }

  function buildTokenIndex(tokens) {
    tokens = tokens || [];
    var byName = Object.create(null);
    tokens.forEach(function (t) { byName[t.name] = t; });

    var refCounts = buildRefCounts(tokens);
    var semanticTags = Object.create(null);
    var colorRole = Object.create(null);
    var tiers = Object.create(null);

    tokens.forEach(function (token) {
      semanticTags[token.name] = inferSemanticTags(token.name);
      colorRole[token.name] = inferColorRole(token.name, token.category);
      tiers[token.name] = inferTier(token, byName, refCounts);
      token.inferredTier = tiers[token.name];
      token.semanticTags = semanticTags[token.name];
      token.colorRole = colorRole[token.name];
      if (token.inferredTier && token.inferredTier !== 'unknown') {
        token.tier = token.inferredTier;
      }
    });

    var typoStruct = discoverTypographyGroups(tokens, byName);
    var slugComposites = discoverSlugTypographyComposites(tokens);
    var composites = mergeTypographyComposites(typoStruct.composites, slugComposites);

    var compositeSet = Object.create(null);
    Object.keys(composites).forEach(function (k) {
      compositeSet[k] = composites[k];
      compositeSet[composites[k].name] = composites[k];
    });

    var names = tokens.map(function (t) { return t.name; });
    var namePrefix = findCommonPrefix(names.slice(0, Math.min(40, names.length)));

    var families = discoverFontFamilies(tokens);

    var suggestionTokens = tokens.filter(function (t) {
      var tier = tiers[t.name];
      return tier === 'semantic' || tier === 'brand' || tier === 'component';
    });

    return {
      tokens: tokens,
      byName: byName,
      composites: compositeSet,
      typographyGroups: typoStruct.groups,
      semanticTags: semanticTags,
      colorRole: colorRole,
      tiers: tiers,
      namePrefix: namePrefix,
      fontFamilies: families,
      suggestionTokens: suggestionTokens,
      stats: {
        total: tokens.length,
        composites: Object.keys(composites).length,
        semantic: suggestionTokens.length,
      },
      isComposite: function (name) {
        if (compositeSet[name]) return true;
        if (detectTypoSuffix(name) && detectTypoSuffix(name).key === 'fontSize') return true;
        if (detectTypoSuffix(name)) return false;
        var n = String(name).toLowerCase();
        if (/font|weight|family|size|line-height|letter-spacing|scale|type-family|type-weight|type-scale/.test(n) &&
            !/type-style|typography\//.test(n)) {
          if (/-type-[a-z0-9-]+$/.test(n) || /\/typography\//.test(n) || /\/type\//.test(n)) return true;
          if (/^--[a-z0-9-]+-type$/.test(n)) return true;
        }
        return false;
      },
      getDisplayName: function (name) {
        if (compositeSet[name] && compositeSet[name].displayName && compositeSet[name].displayName !== '-') {
          return compositeSet[name].displayName;
        }
        var n = String(name).replace(/^--/, '');
        var component = n.match(/^f-([a-z0-9-]+)-type$/);
        if (component) return component[1] + '-type';
        var brand = n.match(/^f-brand-type-(.+)$/);
        if (brand) return brand[1];
        var detected = detectTypoSuffix(name);
        if (detected) return slugFromToken(name);
        return stripPrefix(name, namePrefix).replace(/^-+/, '') || n;
      },
      getTypoProp: function (baseName, propKey) {
        var comp = compositeSet[baseName];
        if (comp && comp.props && comp.props[propKey]) {
          return byName[comp.props[propKey]];
        }
        var suffixMap = {
          fontSize: '-font-size',
          fontWeight: '-font-weight',
          fontFamily: '-font-family',
          lineHeight: '-line-height',
          letterSpacing: '-letter-spacing',
        };
        var suffix = suffixMap[propKey];
        if (suffix && byName[baseName + suffix]) return byName[baseName + suffix];
        return null;
      },
      getCompositeTags: function (name) {
        if (compositeSet[name] && compositeSet[name].tags) return compositeSet[name].tags;
        return semanticTags[name] || [];
      },
      scoreRoleAffinity: function (tokenName, role, context) {
        var tags = compositeSet[tokenName] ? (compositeSet[tokenName].tags || []) : (semanticTags[tokenName] || []);
        return tagAffinity(tags.length ? tags : inferSemanticTags(tokenName), role, context);
      },
      isSameFontRole: function (a, b) {
        if (!a || !b) return false;
        if (a === b) return true;
        var fa = families;
        if (fa.primary && (a.indexOf(fa.primary) !== -1 || b.indexOf(fa.primary) !== -1)) {
          return a.indexOf(fa.primary) !== -1 && b.indexOf(fa.primary) !== -1;
        }
        if (fa.secondary && (a.indexOf(fa.secondary) !== -1 || b.indexOf(fa.secondary) !== -1)) {
          return a.indexOf(fa.secondary) !== -1 && b.indexOf(fa.secondary) !== -1;
        }
        return false;
      },
      tierScore: function (token) {
        var tier = tiers[token.name] || token.tier || 'unknown';
        var map = { brand: 60, semantic: 65, component: 58, unknown: 22, base: 0 };
        return map[tier] !== undefined ? map[tier] : 20;
      },
    };
  }

  var _cache = Object.create(null);

  function getTokenIndex(tokens) {
    if (!tokens || !tokens.length) return buildTokenIndex([]);
    if (tokens.__tokenIndex) return tokens.__tokenIndex;
    var key = tokens.length + ':' + tokens[0].name + ':' + tokens[tokens.length - 1].name;
    if (!_cache[key]) _cache[key] = buildTokenIndex(tokens);
    tokens.__tokenIndex = _cache[key];
    return _cache[key];
  }

  global.DSAuditorTokenSynthesizer = {
    buildTokenIndex: buildTokenIndex,
    getTokenIndex: getTokenIndex,
    inferSemanticTags: inferSemanticTags,
    inferColorRole: inferColorRole,
    inferTier: inferTier,
    tagAffinity: tagAffinity,
    roleToWantedTags: roleToWantedTags,
  };
})(typeof window !== 'undefined' ? window : self);
