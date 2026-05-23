/**
 * Parse design tokens from CSS files and JSON token exports.
 */
(function (global) {
  'use strict';

  var C = global.DSAuditorColor;

  function atomise(name) {
    if (!name) return [];
    return String(name).toLowerCase().split(/[\/\-_.\s]+/).filter(Boolean);
  }

  function hasAtom(atoms, keywords) {
    for (var i = 0; i < keywords.length; i++) {
      if (atoms.indexOf(keywords[i]) !== -1) return true;
    }
    return false;
  }

  function classifyToken(name) {
    var atoms = atomise(name);
    var n = name.toLowerCase();

    // FDS / Flow Design System (--f-base-*, --f-brand-*, --f-*)
    if (n.indexOf('--f-') === 0) {
      if (/color|solid|gradient|burgundy|grey|gray|white|black|loyalty|tier/.test(n)) return 'color';
      if (/shadow/.test(n)) return 'shadow';
      if (hasAtom(atoms, ['radius', 'corner', 'round'])) return 'radius';
      if (/(?:^--f-(?:base|brand)-size-)|(?:\/size\/)/.test(n) && !/type-scale|font-size|line-height/.test(n)) return 'size';
      if (/space|spacing|gap|padding|margin|border-size/.test(n)) return 'spacing';
      if (/typography|brand-type|type-|font|line-height|lineheight|weight|family|scale|letter/.test(n)) return 'typography';
      if (/blur|breakpoint|duration|motion|opacity|easing|transform/.test(n)) return 'meta';
    }

    if (hasAtom(atoms, ['shadow', 'elevation']) || /shadow|elevation|box-shadow/.test(n)) return 'shadow';
    if (hasAtom(atoms, ['radius', 'corner', 'round'])) return 'radius';
    if (
      /^--color[-_]/.test(n) ||
      /^color[-_]/.test(n.replace(/^--/, '')) ||
      (hasAtom(atoms, ['color', 'colour']) && !hasAtom(atoms, ['font', 'fontsize', 'typography']))
    ) {
      return 'color';
    }
    if (
      hasAtom(atoms, ['font', 'typography', 'type', 'heading', 'body', 'label', 'caption']) ||
      /font-family|font-size|font-weight|line-height|letter-spacing|typography/.test(n)
    ) {
      return 'typography';
    }
    if (hasAtom(atoms, ['space', 'spacing', 'gap', 'margin', 'padding'])) return 'spacing';
    if (hasAtom(atoms, ['size', 'dimension', 'width', 'height'])) return 'size';
    if (
      hasAtom(atoms, ['bg', 'background', 'surface', 'fill', 'stroke', 'border', 'fg', 'foreground', 'text', 'ink']) ||
      /color|colour|fill|stroke|foreground/.test(n)
    ) {
      return 'color';
    }

    return 'unknown';
  }

  function parseCSSValue(value, category) {
    if (!value) return null;
    value = value.trim();
    if (value.startsWith('var(')) return { raw: value, isVar: true };

    if (category === 'color') {
      var c = C.parseColor(value);
      if (c && c.type !== 'var') return { color: c, raw: value };
      // Gradients / non-solid paints
      if (/gradient|linear-gradient|radial-gradient/.test(value)) return { raw: value, isGradient: true };
    }

    if (category === 'spacing' || category === 'size' || category === 'radius') {
      var px = parseFloat(value);
      if (!isNaN(px)) return { number: px, unit: value.replace(/[\d.]/g, '').trim() || 'px', raw: value };
    }

    if (category === 'typography') {
      return { raw: value };
    }

    if (category === 'shadow') {
      return { raw: value };
    }

    return { raw: value };
  }

  /** FDS & generic DS tier: base primitives vs brand/semantic aliases. */
  function getTokenTier(name) {
    var n = String(name || '').toLowerCase();
    if (/-brand-/.test(n) || n.indexOf('--f-brand-') === 0) return 'brand';
    if (/-semantic-/.test(n) || /-alias-/.test(n) || /-theme-/.test(n)) return 'semantic';
    if (/-component-/.test(n) || /-comp-/.test(n)) return 'component';
    if (/^--f-[a-z0-9-]+-type$/.test(n)) return 'component';
    if (/-base-/.test(n) || n.indexOf('--f-base-') === 0) return 'base';
    if (/brand|semantic|alias|theme/.test(n) && !/base/.test(n)) return 'brand';
    return 'unknown';
  }

  function extractVarRef(value) {
    if (!value) return null;
    var m = String(value).match(/var\s*\(\s*(--[^,)]+)/);
    return m ? m[1].trim() : null;
  }

  /** Resolve var() chains so brand tokens inherit base literal values. */
  function resolveTokenValues(tokens) {
    var map = Object.create(null);
    tokens.forEach(function (t) {
      if (map[t.name] === undefined) map[t.name] = t.value;
    });

    function resolveRaw(name, depth, seen) {
      if (!name || depth > 12 || seen.has(name)) return null;
      seen.add(name);
      var val = map[name];
      if (val === undefined || val === null) return null;
      val = String(val).trim();
      var ref = extractVarRef(val);
      if (ref) return resolveRaw(ref, depth + 1, seen);
      return val;
    }

    tokens.forEach(function (t) {
      var resolved = resolveRaw(t.name, 0, new Set());
      t.tier = getTokenTier(t.name);
      t.resolvedValue = resolved || t.value;
      if (resolved && resolved !== t.value) {
        t.parsedResolved = parseCSSValue(resolved, t.category);
      } else if (t.parsed && !t.parsed.isVar) {
        t.parsedResolved = t.parsed;
      }
    });
    return tokens;
  }

  function isSuggestionTier(tier) {
    return tier === 'brand' || tier === 'semantic' || tier === 'component';
  }

  /** Parse CSS text into token records */
  function parseCSS(cssText, libraryName) {
    var tokens = [];
    var varRegex = /--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;
    var match;

    while ((match = varRegex.exec(cssText)) !== null) {
      var name = '--' + match[1];
      var value = match[2].trim();
      if (tokens.some(function (t) { return t.name === name; })) continue;
      var category = classifyToken(name);
      var parsed = parseCSSValue(value, category);

      tokens.push({
        name: name,
        value: value,
        category: category,
        parsed: parsed,
        tier: getTokenTier(name),
        library: libraryName || 'CSS',
        source: 'css-var',
      });
    }

    return resolveTokenValues(tokens);
  }

  /** Flatten nested JSON tokens (Style Dictionary, Tokens Studio, etc.) */
  function flattenJSON(obj, prefix, libraryName, out) {
    prefix = prefix || '';
    out = out || [];
    if (!obj || typeof obj !== 'object') return out;

    for (var key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      var val = obj[key];
      var path = prefix ? prefix + '/' + key : key;

      if (val && typeof val === 'object' && ('$value' in val || 'value' in val)) {
        var tokenValue = val.$value !== undefined ? val.$value : val.value;
        var tokenType = val.$type || val.type || classifyToken(path);
        var cat = mapJSONType(tokenType, path);
        out.push({
          name: path,
          value: String(tokenValue),
          category: cat,
          parsed: parseCSSValue(String(tokenValue), cat),
          tier: getTokenTier(path),
          library: libraryName || 'JSON',
          source: 'json',
        });
      } else if (val && typeof val === 'object' && !Array.isArray(val)) {
        flattenJSON(val, path, libraryName, out);
      }
    }
    return out;
  }

  function mapJSONType(type, path) {
    var t = String(type || '').toLowerCase();
    if (t.includes('color')) return 'color';
    if (t.includes('dimension') || t.includes('spacing')) return 'spacing';
    if (t.includes('font') || t.includes('typography')) return 'typography';
    if (t.includes('shadow') || t.includes('boxshadow')) return 'shadow';
    if (t.includes('border') && t.includes('radius')) return 'radius';
    return classifyToken(path);
  }

  function parseJSON(jsonText, libraryName) {
    try {
      var data = JSON.parse(jsonText);
      return resolveTokenValues(flattenJSON(data, '', libraryName));
    } catch (e) {
      return [];
    }
  }

  function parseFile(content, filename) {
    var name = filename.replace(/\.[^.]+$/, '');
    if (filename.endsWith('.json')) return parseJSON(content, name);
    return parseCSS(content, name);
  }

  function mergeLibraries(libraries) {
    var all = [];
    libraries.forEach(function (lib) {
      (lib.tokens || []).forEach(function (t) {
        all.push(Object.assign({}, t, { library: lib.name || t.library }));
      });
    });
    return resolveTokenValues(all);
  }

  function mergeLibrariesWithIndex(libraries) {
    var all = mergeLibraries(libraries);
    if (global.DSAuditorTokenSynthesizer) {
      global.DSAuditorTokenSynthesizer.getTokenIndex(all);
    }
    return all;
  }

  global.DSAuditorTokenParser = {
    parseCSS: parseCSS,
    parseJSON: parseJSON,
    parseFile: parseFile,
    mergeLibraries: mergeLibraries,
    mergeLibrariesWithIndex: mergeLibrariesWithIndex,
    classifyToken: classifyToken,
    getTokenTier: getTokenTier,
    resolveTokenValues: resolveTokenValues,
    isSuggestionTier: isSuggestionTier,
    atomise: atomise,
  };
})(typeof window !== 'undefined' ? window : self);
