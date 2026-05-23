/**
 * Color parsing and comparison utilities for DS Auditor Web.
 */
(function (global) {
  'use strict';

  function parseColor(str) {
    if (!str || str === 'transparent' || str === 'none') return null;
    str = str.trim().toLowerCase();

    if (str.startsWith('var(')) return { type: 'var', raw: str };

    var m = str.match(/^#([0-9a-f]{3,8})$/i);
    if (m) {
      var hex = m[1];
      if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
      if (hex.length === 6) hex += 'ff';
      return {
        type: 'hex',
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: parseInt(hex.slice(6, 8), 16) / 255,
        raw: str,
      };
    }

    m = str.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/);
    if (m) {
      return {
        type: 'rgb',
        r: Math.round(parseFloat(m[1])),
        g: Math.round(parseFloat(m[2])),
        b: Math.round(parseFloat(m[3])),
        a: m[4] !== undefined ? parseFloat(m[4]) : 1,
        raw: str,
      };
    }

    m = str.match(/^hsla?\(/);
    if (m) {
      // Approximate hsl → rgb for comparison (simplified)
      var hsl = str.match(/([\d.]+)/g);
      if (hsl && hsl.length >= 3) {
        var h = parseFloat(hsl[0]) / 360;
        var s = parseFloat(hsl[1]) / 100;
        var l = parseFloat(hsl[2]) / 100;
        var a = hsl[3] !== undefined ? parseFloat(hsl[3]) : 1;
        var rgb = hslToRgb(h, s, l);
        return { type: 'hsl', r: rgb[0], g: rgb[1], b: rgb[2], a: a, raw: str };
      }
    }

    return null;
  }

  function hslToRgb(h, s, l) {
    var r, g, b;
    if (s === 0) {
      r = g = b = Math.round(l * 255);
    } else {
      var hue2rgb = function (p, q, t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
      g = Math.round(hue2rgb(p, q, h) * 255);
      b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);
    }
    return [r, g, b];
  }

  function colorKey(c) {
    if (!c || c.type === 'var') return null;
    return c.r + ',' + c.g + ',' + c.b + ',' + Math.round((c.a !== undefined ? c.a : 1) * 100);
  }

  function colorDistance(c1, c2) {
    if (!c1 || !c2) return Infinity;
    var dr = c1.r - c2.r;
    var dg = c1.g - c2.g;
    var db = c1.b - c2.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  function colorToHex(c) {
    if (!c) return '';
    var r = ('0' + c.r.toString(16)).slice(-2);
    var g = ('0' + c.g.toString(16)).slice(-2);
    var b = ('0' + c.b.toString(16)).slice(-2);
    return '#' + r + g + b;
  }

  function isTokenized(value) {
    if (!value) return false;
    return /var\s*\(/.test(value);
  }

  function extractVarName(value) {
    var m = value && value.match(/var\s*\(\s*([^,)]+)/);
    return m ? m[1].trim() : null;
  }

  global.DSAuditorColor = {
    parseColor: parseColor,
    colorKey: colorKey,
    colorDistance: colorDistance,
    colorToHex: colorToHex,
    isTokenized: isTokenized,
    extractVarName: extractVarName,
    COLOR_DISTANCE_THRESHOLD: 18,
  };
})(typeof window !== 'undefined' ? window : self);
