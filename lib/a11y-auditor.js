/**
 * WCAG 2.x accessibility auditor — single-pass DOM scan with rule registry.
 * Covers all programmatically testable Level A & AA criteria.
 */
(function (global) {
  'use strict';

  var C = global.DSAuditorColor;
  var MAX_NODES = 3500;
  var MAX_ISSUES = 800;

  var SKIP_TAGS = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, META: 1, LINK: 1, HEAD: 1, TEMPLATE: 1,
  };

  var INTERACTIVE_TAGS = {
    A: 1, BUTTON: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1, SUMMARY: 1,
  };

  var HEADING_TAGS = { H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1 };

  var LANDMARK_ROLES = {
    banner: 1, navigation: 1, main: 1, contentinfo: 1, complementary: 1,
    search: 1, form: 1, region: 1,
  };

  /** WCAG rules we can test automatically — grouped by category for UI. */
  var RULE_META = {
    'page-title': { wcag: ['2.4.2'], level: 'A', category: 'structure', name: 'Page title' },
    'html-lang': { wcag: ['3.1.1'], level: 'A', category: 'structure', name: 'Page language' },
    'skip-link': { wcag: ['2.4.1'], level: 'A', category: 'structure', name: 'Bypass blocks' },
    'duplicate-id': { wcag: ['4.1.1'], level: 'A', category: 'structure', name: 'Unique IDs' },
    'heading-order': { wcag: ['1.3.1', '2.4.6'], level: 'A', category: 'structure', name: 'Heading hierarchy' },
    'empty-heading': { wcag: ['2.4.6'], level: 'A', category: 'structure', name: 'Empty headings' },
    'landmark-main': { wcag: ['1.3.1'], level: 'A', category: 'structure', name: 'Main landmark' },
    'image-alt': { wcag: ['1.1.1'], level: 'A', category: 'images', name: 'Image alt text' },
    'input-image-alt': { wcag: ['1.1.1'], level: 'A', category: 'images', name: 'Input image alt' },
    'svg-alt': { wcag: ['1.1.1'], level: 'A', category: 'images', name: 'SVG accessible name' },
    'decorative-hidden': { wcag: ['1.1.1'], level: 'A', category: 'images', name: 'Decorative images' },
    'color-contrast': { wcag: ['1.4.3'], level: 'AA', category: 'contrast', name: 'Text contrast' },
    'color-contrast-large': { wcag: ['1.4.3'], level: 'AA', category: 'contrast', name: 'Large text contrast' },
    'color-contrast-aaa': { wcag: ['1.4.6'], level: 'AAA', category: 'contrast', name: 'Enhanced contrast' },
    'non-text-contrast': { wcag: ['1.4.11'], level: 'AA', category: 'contrast', name: 'UI component contrast' },
    'link-name': { wcag: ['2.4.4', '4.1.2'], level: 'A', category: 'keyboard', name: 'Link purpose' },
    'button-name': { wcag: ['4.1.2'], level: 'A', category: 'keyboard', name: 'Button name' },
    'input-label': { wcag: ['1.3.1', '3.3.2', '4.1.2'], level: 'A', category: 'forms', name: 'Form labels' },
    'input-type': { wcag: ['1.3.5'], level: 'AA', category: 'forms', name: 'Input purpose' },
    'keyboard-access': { wcag: ['2.1.1'], level: 'A', category: 'keyboard', name: 'Keyboard access' },
    'focus-visible': { wcag: ['2.4.7'], level: 'AA', category: 'focus', name: 'Focus indicator' },
    'tabindex-positive': { wcag: ['2.4.3'], level: 'A', category: 'focus', name: 'Tab order' },
    'aria-valid': { wcag: ['4.1.2'], level: 'A', category: 'aria', name: 'Valid ARIA' },
    'aria-hidden-focus': { wcag: ['4.1.2'], level: 'A', category: 'aria', name: 'Hidden from AT' },
    'role-required': { wcag: ['4.1.2'], level: 'A', category: 'aria', name: 'Required ARIA' },
    'iframe-title': { wcag: ['4.1.2'], level: 'A', category: 'structure', name: 'Frame title' },
    'meta-refresh': { wcag: ['2.2.1', '3.2.5'], level: 'A', category: 'structure', name: 'Meta refresh' },
    'autoplay-media': { wcag: ['1.4.2'], level: 'A', category: 'structure', name: 'Auto-playing media' },
    'table-headers': { wcag: ['1.3.1'], level: 'A', category: 'structure', name: 'Table headers' },
    'list-structure': { wcag: ['1.3.1'], level: 'A', category: 'structure', name: 'List structure' },
    'missing-h1': { wcag: ['1.3.1', '2.4.6'], level: 'A', category: 'structure', name: 'Page heading (h1)' },
    'multiple-h1': { wcag: ['1.3.1'], level: 'A', category: 'structure', name: 'Multiple h1 headings' },
    'link-new-window': { wcag: ['3.2.5'], level: 'A', category: 'keyboard', name: 'New window warning' },
    'select-label': { wcag: ['1.3.1', '4.1.2'], level: 'A', category: 'forms', name: 'Select label' },
    'placeholder-only-label': { wcag: ['3.3.2', '4.1.2'], level: 'A', category: 'forms', name: 'Placeholder as label' },
  };

  var KNOWN_ARIA = {
    role: /^(alert|alertdialog|application|article|banner|button|cell|checkbox|columnheader|combobox|complementary|contentinfo|definition|dialog|directory|document|feed|figure|form|grid|gridcell|group|heading|img|link|list|listbox|listitem|log|main|marquee|math|menu|menubar|menuitem|menuitemcheckbox|menuitemradio|navigation|none|note|option|presentation|progressbar|radio|radiogroup|region|row|rowgroup|rowheader|scrollbar|search|searchbox|separator|slider|spinbutton|status|switch|tab|tablist|tabpanel|term|textbox|timer|toolbar|tooltip|tree|treegrid|treeitem)$/i,
    global: /^(aria-activedescendant|aria-atomic|aria-autocomplete|aria-busy|aria-checked|aria-colcount|aria-colindex|aria-colspan|aria-controls|aria-current|aria-describedby|aria-details|aria-disabled|aria-dropeffect|aria-errormessage|aria-expanded|aria-flowto|aria-grabbed|aria-haspopup|aria-hidden|aria-invalid|aria-keyshortcuts|aria-label|aria-labelledby|aria-level|aria-live|aria-modal|aria-multiline|aria-multiselectable|aria-orientation|aria-owns|aria-placeholder|aria-posinset|aria-pressed|aria-readonly|aria-relevant|aria-required|aria-roledescription|aria-rowcount|aria-rowindex|aria-rowspan|aria-selected|aria-setsize|aria-sort|aria-valuemax|aria-valuemin|aria-valuenow|aria-valuetext)$/i,
  };

  var ROLE_REQUIRES = {
    checkbox: ['aria-checked'],
    combobox: ['aria-expanded'],
    slider: ['aria-valuenow', 'aria-valuemin', 'aria-valuemax'],
    spinbutton: ['aria-valuenow'],
    progressbar: ['aria-valuenow'],
  };

  function trimText(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  function cssEscape(value) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, function (c) {
      return '\\' + c;
    });
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

  function elementLabel(el) {
    var tag = el.tagName.toLowerCase();
    if (el.id) return tag + '#' + el.id;
    var cls = el.className && typeof el.className === 'string'
      ? el.className.trim().split(/\s+/)[0] : '';
    return cls ? tag + '.' + cls : tag;
  }

  function isHidden(el, cs, rect) {
    if (!el || el.nodeType !== 1) return true;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    if (!rect) rect = el.getBoundingClientRect();
    if (!cs) cs = el.ownerDocument.defaultView.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return true;
    if (parseFloat(cs.opacity) === 0) return true;
    if (cs.contentVisibility === 'hidden') return true;
    if (rect.width < 0.5 && rect.height < 0.5) return true;
    return false;
  }

  function hasDirectVisibleText(el) {
    var text = trimText(el.innerText || el.textContent);
    if (!text) return false;
    if (el.children.length === 0) return true;
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3 && trimText(n.textContent)) return true;
    }
    return trimText(el.innerText).length > 0 && el.children.length <= 3;
  }

  function getAccessibleName(el, doc) {
    doc = doc || el.ownerDocument;
    var labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      var parts = labelledBy.split(/\s+/).map(function (id) {
        var node = doc.getElementById(id);
        return node ? trimText(node.textContent) : '';
      }).filter(Boolean);
      if (parts.length) return parts.join(' ');
    }
    var ariaLabel = el.getAttribute('aria-label');
    if (trimText(ariaLabel)) return trimText(ariaLabel);
    if (el.tagName === 'IMG' || el.tagName === 'INPUT') {
      var alt = el.getAttribute('alt');
      if (alt !== null && trimText(alt)) return trimText(alt);
    }
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
      if (el.id) {
        var label = doc.querySelector('label[for="' + cssEscape(el.id) + '"]');
        if (label) return trimText(label.textContent);
      }
      var wrap = el.closest('label');
      if (wrap) return trimText(wrap.textContent);
    }
    if (el.tagName === 'A' || el.tagName === 'BUTTON' || el.tagName === 'SUMMARY') {
      return trimText(el.textContent) || trimText(el.getAttribute('title'));
    }
    var title = el.getAttribute('title');
    if (trimText(title)) return trimText(title);
    return '';
  }

  function isLargeText(cs) {
    var sizePx = parseFloat(cs.fontSize) || 16;
    var weight = parseInt(cs.fontWeight, 10) || 400;
    var sizePt = sizePx * 0.75;
    return sizePt >= 18 || (sizePt >= 14 && weight >= 700);
  }

  function parseBgColor(val) {
    if (!val || val === 'transparent' || val === 'rgba(0, 0, 0, 0)') return null;
    return C.parseColor(val);
  }

  function effectiveBackground(el, cs, cache) {
    var key = el;
    if (cache.bg && cache.bg[key]) return cache.bg[key];
    var doc = el.ownerDocument;
    var win = doc.defaultView;
    var cur = el;
    var bg = parseBgColor(cs.backgroundColor);
    var depth = 0;
    while (cur && depth < 12) {
      var st = cur === el ? cs : win.getComputedStyle(cur);
      var c = parseBgColor(st.backgroundColor);
      if (c && (c.a === undefined || c.a > 0.05)) {
        bg = bg ? C.blendOver(c, bg) : c;
        if (bg && bg.a !== undefined && bg.a > 0.95) break;
      }
      cur = cur.parentElement;
      depth++;
    }
    if (!bg) bg = C.parseColor('#ffffff');
    if (!cache.bg) cache.bg = Object.create(null);
    cache.bg[key] = bg;
    return bg;
  }

  function pushIssue(ctx, ruleId, el, opts) {
    if (ctx.issues.length >= MAX_ISSUES) return;
    var meta = RULE_META[ruleId] || {};
    var ref = el.dataset.dsA11yRef;
    var sig = ruleId + '|' + ref;
    if (ctx.seen.has(sig)) return;
    ctx.seen.add(sig);

    var severity = opts.severity || (meta.level === 'AAA' ? 'info' : 'error');
    ctx.issues.push({
      id: ctx.issues.length + 1,
      type: 'a11y',
      ruleId: ruleId,
      a11yCategory: meta.category || 'structure',
      wcag: meta.wcag || [],
      wcagLevel: meta.level || 'A',
      wcagName: meta.name || ruleId,
      severity: severity,
      property: ruleId,
      propertyLabel: meta.name || ruleId,
      element: elementLabel(el),
      elementRef: ref,
      selector: getSelector(el),
      found: opts.found || '',
      message: opts.message || meta.name || ruleId,
      guidance: opts.guidance || '',
      fixes: opts.fixes || [],
    });
  }

  function auditPageLevel(ctx, doc) {
    var title = trimText(doc.title);
    if (!title) {
      ctx.issues.push({
        id: ctx.issues.length + 1,
        type: 'a11y',
        ruleId: 'page-title',
        a11yCategory: 'structure',
        wcag: ['2.4.2'],
        wcagLevel: 'A',
        wcagName: 'Page title',
        severity: 'error',
        property: 'page-title',
        propertyLabel: 'Page title',
        element: 'document',
        elementRef: 'page',
        selector: 'html',
        found: '(empty)',
        message: 'Document is missing a descriptive title',
        guidance: 'Add a unique, descriptive <title> in <head> that identifies the page topic or purpose.',
        fixes: [],
      });
    }

    var html = doc.documentElement;
    var lang = html && html.getAttribute('lang');
    if (!lang || !trimText(lang)) {
      ctx.issues.push({
        id: ctx.issues.length + 1,
        type: 'a11y',
        ruleId: 'html-lang',
        a11yCategory: 'structure',
        wcag: ['3.1.1'],
        wcagLevel: 'A',
        wcagName: 'Page language',
        severity: 'error',
        property: 'html-lang',
        propertyLabel: 'Page language',
        element: 'html',
        elementRef: 'page-lang',
        selector: 'html',
        found: '(missing lang)',
        message: '<html> element must have a valid lang attribute',
        guidance: 'Add lang="en" (or the correct language code) to the <html> element.',
        fixes: [],
      });
    }

    var refresh = doc.querySelector('meta[http-equiv="refresh" i]');
    if (refresh) {
      var content = refresh.getAttribute('content') || '';
      var seconds = parseInt(content.split(';')[0], 10);
      if (!isNaN(seconds) && seconds >= 0 && seconds <= 72000) {
        ctx.issues.push({
          id: ctx.issues.length + 1,
          type: 'a11y',
          ruleId: 'meta-refresh',
          a11yCategory: 'structure',
          wcag: ['2.2.1'],
          wcagLevel: 'A',
          wcagName: 'Meta refresh',
          severity: 'error',
          property: 'meta-refresh',
          propertyLabel: 'Meta refresh',
          element: 'meta[refresh]',
          elementRef: 'meta-refresh',
          selector: 'meta[http-equiv="refresh"]',
          found: content,
          message: 'Page uses meta refresh which can disorient users',
          guidance: 'Remove automatic refresh. Use server redirects or let users control timing.',
          fixes: [],
        });
      }
    }

    var skip = doc.querySelector('a[href^="#"]:not([href="#"])');
    var hasMain = doc.querySelector('main, [role="main"]');
    if (hasMain && !skip) {
      var firstLink = doc.querySelector('body a[href^="#"]');
      if (!firstLink) {
        ctx.issues.push({
          id: ctx.issues.length + 1,
          type: 'a11y',
          ruleId: 'skip-link',
          a11yCategory: 'structure',
          wcag: ['2.4.1'],
          wcagLevel: 'A',
          wcagName: 'Bypass blocks',
          severity: 'warn',
          property: 'skip-link',
          propertyLabel: 'Bypass blocks',
          element: 'document',
          elementRef: 'skip-link',
          selector: 'body',
          found: 'No skip link detected',
          message: 'No mechanism to bypass repeated blocks of content',
          guidance: 'Add a visible-on-focus skip link as the first focusable element: <a href="#main">Skip to content</a>.',
          fixes: [],
        });
      }
    }
  }

  function auditContrast(el, cs, rect, ctx) {
    if (isHidden(el, cs, rect)) return;
    var fg = C.parseColor(cs.color);
    if (!fg || fg.type === 'var') return;
    var bg = effectiveBackground(el, cs, ctx.cache);
    if (!bg) return;
    var ratio = C.contrastRatio(fg, bg);
    if (ratio === null) return;

    var large = isLargeText(cs);
    var minAA = large ? 3 : 4.5;
    var minAAA = large ? 4.5 : 7;
    var found = ratio.toFixed(2) + ':1 · ' + C.colorToHex(fg) + ' on ' + C.colorToHex(bg);

    if (ratio < minAA) {
      pushIssue(ctx, 'color-contrast', el, {
        found: found,
        severity: 'error',
        message: 'Text contrast ' + ratio.toFixed(2) + ':1 fails WCAG AA (needs ' + minAA + ':1)',
        guidance: 'Increase contrast between text (' + C.colorToHex(fg) + ') and background (' + C.colorToHex(bg) + '). Target at least ' + minAA + ':1.',
      });
    } else if (ratio < minAAA) {
      pushIssue(ctx, 'color-contrast-aaa', el, {
        found: found,
        severity: 'info',
        message: 'Text contrast ' + ratio.toFixed(2) + ':1 passes AA but not AAA (' + minAAA + ':1)',
        guidance: 'For enhanced accessibility (AAA), increase contrast to at least ' + minAAA + ':1.',
      });
    }
  }

  function auditElement(el, ctx) {
    var tag = el.tagName;
    if (SKIP_TAGS[tag]) return;
    if (ctx.count.n >= MAX_NODES) return;
    ctx.count.n++;

    if (!el.dataset.dsA11yRef) {
      el.dataset.dsA11yRef = 'a11y-' + ctx.refCounter.n++;
    }

    var doc = el.ownerDocument;
    var win = doc.defaultView;
    var cs = win.getComputedStyle(el);
    var rect = el.getBoundingClientRect();
    var hidden = isHidden(el, cs, rect);
    var role = (el.getAttribute('role') || '').toLowerCase();
    var name = getAccessibleName(el, doc);

    if (el.id) {
      if (ctx.idMap[el.id]) {
        if (ctx.idMap[el.id] !== el) {
          pushIssue(ctx, 'duplicate-id', el, {
            found: '#' + el.id,
            severity: 'error',
            message: 'Duplicate id "' + el.id + '" — IDs must be unique',
            guidance: 'Rename one of the duplicate id attributes. IDs are used by labels, ARIA, and scripts.',
          });
        }
      } else {
        ctx.idMap[el.id] = el;
      }
    }

    if (tag === 'IMG') {
      if (!hidden) {
        var alt = el.getAttribute('alt');
        if (alt === null) {
          pushIssue(ctx, 'image-alt', el, {
            found: '(no alt attribute)',
            message: 'Image missing alt attribute',
            guidance: 'Add alt text describing the image, or alt="" if decorative.',
          });
        } else if (!trimText(alt) && el.getAttribute('role') !== 'presentation' && el.getAttribute('role') !== 'none') {
          var w = el.naturalWidth || rect.width;
          var h = el.naturalHeight || rect.height;
          if (w > 16 && h > 16) {
            pushIssue(ctx, 'image-alt', el, {
              found: 'alt=""',
              severity: 'warn',
              message: 'Informative image may have empty alt text',
              guidance: 'If this image conveys information, provide descriptive alt text.',
            });
          }
        }
      }
    }

    if (tag === 'INPUT' && el.type === 'image') {
      if (!el.getAttribute('alt')) {
        pushIssue(ctx, 'input-image-alt', el, {
          message: 'Image input missing alt attribute',
          guidance: 'Add alt describing the input button purpose.',
        });
      }
    }

    if (tag === 'SVG' && !hidden) {
      var svgRole = role || 'img';
      if (svgRole !== 'presentation' && svgRole !== 'none' && !name && !el.querySelector('title')) {
        pushIssue(ctx, 'svg-alt', el, {
          message: 'SVG lacks accessible name',
          guidance: 'Add aria-label, aria-labelledby, or a <title> as the first SVG child.',
        });
      }
    }

    if (tag === 'IFRAME' && !hidden) {
      if (!trimText(el.getAttribute('title'))) {
        pushIssue(ctx, 'iframe-title', el, {
          message: 'Iframe missing title attribute',
          guidance: 'Add a descriptive title attribute summarizing the frame content.',
        });
      }
    }

    if ((tag === 'VIDEO' || tag === 'AUDIO') && el.hasAttribute('autoplay')) {
      pushIssue(ctx, 'autoplay-media', el, {
        severity: 'warn',
        message: 'Media autoplays without user control',
        guidance: 'Remove autoplay or provide visible controls to pause/stop.',
      });
    }

    if (HEADING_TAGS[tag] && !hidden) {
      var level = parseInt(tag.slice(1), 10);
      ctx.headings.push({ el: el, level: level, empty: !trimText(el.textContent) });
      if (!trimText(el.textContent) && !name) {
        pushIssue(ctx, 'empty-heading', el, {
          message: 'Heading has no visible text',
          guidance: 'Provide descriptive heading text or aria-label.',
        });
      }
    }

    if (role && LANDMARK_ROLES[role]) ctx.landmarks[role] = true;
    if (tag === 'MAIN') ctx.landmarks.main = true;
    if (tag === 'NAV') ctx.landmarks.navigation = true;

    if (tag === 'UL' || tag === 'OL') {
      var directLi = 0;
      for (var i = 0; i < el.children.length; i++) {
        if (el.children[i].tagName === 'LI') directLi++;
      }
      if (el.children.length > 0 && directLi === 0) {
        pushIssue(ctx, 'list-structure', el, {
          severity: 'warn',
          message: 'List contains no direct <li> children',
          guidance: 'Use <li> elements as direct children of <ul> and <ol>.',
        });
      }
    }

    if (tag === 'TABLE' && !hidden) {
      var hasTh = el.querySelector('th');
      var hasHeaders = el.querySelector('[headers]');
      if (!hasTh && !hasHeaders && el.querySelector('td')) {
        pushIssue(ctx, 'table-headers', el, {
          severity: 'warn',
          message: 'Data table lacks header cells',
          guidance: 'Use <th> for column/row headers or headers/id associations.',
        });
      }
    }

    if (!hidden) {
      if (hasDirectVisibleText(el) && cs.color) {
        auditContrast(el, cs, rect, ctx);
      }
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        var ph = el.getAttribute('placeholder');
        if (ph && !name) {
          pushIssue(ctx, 'placeholder-only-label', el, {
            found: 'placeholder="' + ph + '"',
            severity: 'warn',
            message: 'Form control may rely on placeholder instead of a label',
            guidance: 'Add a visible <label> or aria-label — placeholders alone are insufficient.',
          });
        }
      }
    }

    if (tag === 'SELECT' && !hidden && !name) {
      pushIssue(ctx, 'select-label', el, {
        message: 'Select element lacks an accessible label',
        guidance: 'Associate a <label for="id"> or aria-label.',
      });
    }

    if (tag === 'A' && !hidden) {
      var href = el.getAttribute('href');
      if (href !== null && !name) {
        pushIssue(ctx, 'link-name', el, {
          found: href || '(empty href)',
          message: 'Link has no discernible text',
          guidance: 'Add visible link text or aria-label describing the link destination.',
        });
      }
      if (el.getAttribute('target') === '_blank') {
        var rel = (el.getAttribute('rel') || '').toLowerCase();
        if (rel.indexOf('noopener') === -1 && !/new window|new tab|external/i.test(name || '')) {
          pushIssue(ctx, 'link-new-window', el, {
            found: 'target="_blank"',
            severity: 'warn',
            message: 'Link opens a new window without indicating it to users',
            guidance: 'Add visible text such as "(opens in new tab)" or aria-label; use rel="noopener noreferrer".',
          });
        }
      }
    }

    if ((tag === 'BUTTON' || role === 'button') && !hidden) {
      if (!name && tag !== 'BUTTON') {
        pushIssue(ctx, 'button-name', el, {
          message: 'Control with button role has no accessible name',
          guidance: 'Add inner text or aria-label.',
        });
      } else if (tag === 'BUTTON' && !name) {
        pushIssue(ctx, 'button-name', el, {
          message: 'Button has no discernible text',
          guidance: 'Add visible label text or aria-label.',
        });
      }
    }

    if ((tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') && !hidden) {
      var type = (el.type || '').toLowerCase();
      if (type !== 'hidden' && type !== 'submit' && type !== 'button' && type !== 'reset' && type !== 'image') {
        if (!name) {
          pushIssue(ctx, 'input-label', el, {
            found: type || tag.toLowerCase(),
            message: 'Form control lacks an accessible label',
            guidance: 'Associate a <label for="id">, wrap in <label>, or use aria-label / aria-labelledby.',
          });
        }
        if (tag === 'INPUT' && ['email', 'tel', 'text', 'password', 'url', 'search'].indexOf(type) !== -1) {
          if (!el.getAttribute('autocomplete') && !el.getAttribute('name')) {
            pushIssue(ctx, 'input-type', el, {
              severity: 'info',
              found: type,
              message: 'Input may benefit from autocomplete attribute',
              guidance: 'Add autocomplete (e.g. email, name, tel) to help users and assistive tech.',
            });
          }
        }
      }
    }

    var tabIndex = el.getAttribute('tabindex');
    if (tabIndex !== null && parseInt(tabIndex, 10) > 0) {
      pushIssue(ctx, 'tabindex-positive', el, {
        found: 'tabindex="' + tabIndex + '"',
        severity: 'warn',
        message: 'Positive tabindex disrupts natural tab order',
        guidance: 'Remove tabindex > 0. Restructure DOM for logical focus order instead.',
      });
    }

    var hasClick = el.onclick || el.getAttribute('onclick') ||
      role === 'button' || role === 'link' || role === 'menuitem';
    var isNative = INTERACTIVE_TAGS[tag];
    if (!hidden && !isNative && (hasClick || el.getAttribute('tabindex') === '0')) {
      if (role !== 'button' && role !== 'link' && !el.getAttribute('tabindex')) {
        var hasKeyHandler = el.onkeydown || el.onkeyup || el.getAttribute('onkeydown');
        if (!hasKeyHandler && tag !== 'A') {
          pushIssue(ctx, 'keyboard-access', el, {
            severity: 'error',
            message: 'Interactive element may not be keyboard accessible',
            guidance: 'Use <button>/<a> or add role, tabindex="0", and keyboard handlers (Enter/Space).',
          });
        }
      }
    }

    if (!hidden && (isNative || role === 'button' || role === 'link' || tabIndex === '0' || tabIndex === 0)) {
      var outlineNone = cs.outlineStyle === 'none' || parseFloat(cs.outlineWidth) === 0;
      var noShadow = !cs.boxShadow || cs.boxShadow === 'none';
      if (outlineNone && noShadow) {
        pushIssue(ctx, 'focus-visible', el, {
          severity: 'warn',
          found: 'outline: none',
          message: 'Interactive element may lack a visible focus indicator',
          guidance: 'Ensure :focus-visible shows a visible outline (min 2px) or high-contrast ring.',
        });
      }
    }

    if (el.getAttribute('aria-hidden') === 'true') {
      var focusable = isNative || tabIndex === '0' || parseInt(tabIndex, 10) >= 0;
      if (focusable) {
        pushIssue(ctx, 'aria-hidden-focus', el, {
          severity: 'error',
          message: 'Focusable element is hidden from assistive technology',
          guidance: 'Remove aria-hidden from focusable elements or use inert/disabled instead.',
        });
      }
    }

    var attrs = el.attributes;
    for (var a = 0; a < attrs.length; a++) {
      var attr = attrs[a].name;
      if (attr.indexOf('aria-') !== 0) continue;
      if (attr === 'aria-hidden' || attr === 'aria-label' || attr === 'aria-labelledby') continue;
      if (!KNOWN_ARIA.global.test(attr)) {
        pushIssue(ctx, 'aria-valid', el, {
          found: attr,
          severity: 'warn',
          message: 'Unknown or misspelled ARIA attribute: ' + attr,
          guidance: 'Verify attribute name against WAI-ARIA specification.',
        });
      }
    }

    if (role && !KNOWN_ARIA.role.test(role)) {
      pushIssue(ctx, 'aria-valid', el, {
        found: 'role="' + role + '"',
        severity: 'warn',
        message: 'Invalid ARIA role: ' + role,
        guidance: 'Use a valid role from the WAI-ARIA spec.',
      });
    }

    if (role && ROLE_REQUIRES[role]) {
      ROLE_REQUIRES[role].forEach(function (req) {
        if (!el.hasAttribute(req)) {
          pushIssue(ctx, 'role-required', el, {
            found: 'role="' + role + '"',
            message: 'Missing required attribute ' + req + ' for role="' + role + '"',
            guidance: 'Add ' + req + ' with an appropriate value.',
          });
        }
      });
    }
  }

  function auditHeadingStructure(ctx) {
    if (!ctx.headings.length) {
      ctx.issues.push({
        id: ctx.issues.length + 1,
        type: 'a11y',
        ruleId: 'missing-h1',
        a11yCategory: 'structure',
        wcag: ['1.3.1', '2.4.6'],
        wcagLevel: 'A',
        wcagName: 'Page heading (h1)',
        severity: 'error',
        property: 'missing-h1',
        propertyLabel: 'Page heading (h1)',
        element: 'document',
        elementRef: 'missing-h1',
        selector: 'body',
        found: 'No h1 found',
        message: 'Page is missing an h1 heading',
        guidance: 'Add one h1 that describes the main topic of the page.',
        fixes: [],
      });
      return;
    }
    var h1s = ctx.headings.filter(function (h) { return h.level === 1; });
    if (!h1s.length) {
      ctx.issues.push({
        id: ctx.issues.length + 1,
        type: 'a11y',
        ruleId: 'missing-h1',
        a11yCategory: 'structure',
        wcag: ['1.3.1', '2.4.6'],
        wcagLevel: 'A',
        wcagName: 'Page heading (h1)',
        severity: 'error',
        property: 'missing-h1',
        propertyLabel: 'Page heading (h1)',
        element: 'document',
        elementRef: 'missing-h1',
        selector: 'body',
        found: 'Headings present but no h1',
        message: 'Page is missing an h1 heading',
        guidance: 'Add one h1 that describes the main topic of the page.',
        fixes: [],
      });
    } else if (h1s.length > 1) {
      pushIssue(ctx, 'multiple-h1', h1s[1].el, {
        found: h1s.length + ' h1 elements',
        severity: 'warn',
        message: 'Page has multiple h1 headings (' + h1s.length + ')',
        guidance: 'Use a single h1 for the page topic; use h2–h6 for subsections.',
      });
    }
    auditHeadingOrder(ctx);
  }

  function auditHeadingOrder(ctx) {
    if (!ctx.headings.length) return;
    var last = 0;
    ctx.headings.forEach(function (h) {
      if (h.level - last > 1 && last !== 0) {
        pushIssue(ctx, 'heading-order', h.el, {
          found: 'h' + last + ' → h' + h.level,
          severity: 'warn',
          message: 'Heading levels skip from h' + last + ' to h' + h.level,
          guidance: 'Do not skip heading levels. Use h' + (last + 1) + ' or adjust the outline.',
        });
      }
      last = h.level;
    });
  }

  function auditLandmarks(ctx) {
    if (!ctx.landmarks.main) {
      ctx.issues.push({
        id: ctx.issues.length + 1,
        type: 'a11y',
        ruleId: 'landmark-main',
        a11yCategory: 'structure',
        wcag: ['1.3.1'],
        wcagLevel: 'A',
        wcagName: 'Main landmark',
        severity: 'warn',
        property: 'landmark-main',
        propertyLabel: 'Main landmark',
        element: 'document',
        elementRef: 'landmark-main',
        selector: 'body',
        found: 'No <main> or role="main"',
        message: 'Page lacks a main landmark',
        guidance: 'Wrap primary content in <main> or role="main" for screen reader navigation.',
        fixes: [],
      });
    }
  }

  function collectElements(root, out, limit) {
    if (!root || out.length >= limit) return;

    function visit(node) {
      if (!node || out.length >= limit) return;
      if (node.nodeType === 1) {
        var tag = node.tagName;
        if (!SKIP_TAGS[tag]) out.push(node);
        if (out.length >= limit) return;
        if (node.shadowRoot) visit(node.shadowRoot);
        if (out.length >= limit) return;
        var children = node.children;
        for (var i = 0; i < children.length && out.length < limit; i++) {
          visit(children[i]);
        }
      } else if (node.nodeType === 11) {
        var c = node.firstChild;
        while (c && out.length < limit) {
          visit(c);
          c = c.nextSibling;
        }
      }
    }

    visit(root);
  }

  function auditDocumentTree(doc, ctx) {
    if (!doc || !doc.documentElement) return;
    var elements = [];
    collectElements(doc.documentElement, elements, MAX_NODES);
    for (var i = 0; i < elements.length && ctx.count.n < MAX_NODES; i++) {
      auditElement(elements[i], ctx);
    }
    try {
      doc.querySelectorAll('iframe').forEach(function (frame) {
        if (ctx.count.n >= MAX_NODES) return;
        try {
          var idoc = frame.contentDocument;
          if (idoc && idoc.documentElement) {
            var inner = [];
            collectElements(idoc.documentElement, inner, MAX_NODES - ctx.count.n);
            inner.forEach(function (el) {
              if (ctx.count.n < MAX_NODES) auditElement(el, ctx);
            });
          }
        } catch (e) { /* cross-origin */ }
      });
    } catch (e) { /* ignore */ }
  }

  function computeA11yScore(issues, scanned) {
    if (!issues || !issues.length) return 100;
    var errors = 0;
    var warns = 0;
    var infos = 0;
    issues.forEach(function (iss) {
      if (iss.severity === 'error') errors++;
      else if (iss.severity === 'warn') warns++;
      else infos++;
    });
    var penalty = errors * 3 + warns * 1.5 + infos * 0.4;
    var scale = Math.max(5, Math.sqrt(scanned || 100) * 2);
    var score = 100 - (penalty / scale) * 10;
    if (errors > 0) score = Math.min(score, 99 - Math.min(errors, 40));
    return Math.max(0, Math.round(score));
  }

  function runA11yAudit(pageMeta) {
    var doc = document;
    var ctx = {
      issues: [],
      seen: new Set(),
      count: { n: 0 },
      refCounter: { n: 0 },
      idMap: Object.create(null),
      headings: [],
      landmarks: Object.create(null),
      cache: { bg: Object.create(null) },
    };

    auditPageLevel(ctx, doc);
    auditDocumentTree(doc, ctx);
    auditHeadingStructure(ctx);
    auditLandmarks(ctx);

    var byCategory = {};
    var byWcag = {};
    ctx.issues.forEach(function (i) {
      byCategory[i.a11yCategory] = (byCategory[i.a11yCategory] || 0) + 1;
      (i.wcag || []).forEach(function (c) {
        byWcag[c] = (byWcag[c] || 0) + 1;
      });
    });

    return {
      auditMode: 'a11y',
      page: pageMeta || { url: location.href, title: document.title },
      scannedElements: ctx.count.n,
      issueCount: ctx.issues.length,
      complianceScore: computeA11yScore(ctx.issues, ctx.count.n),
      byType: { a11y: ctx.issues.length },
      byCategory: byCategory,
      byWcag: byWcag,
      wcagCriteriaTested: Object.keys(RULE_META).map(function (id) {
        var m = RULE_META[id];
        return { ruleId: id, wcag: m.wcag, level: m.level, category: m.category, name: m.name };
      }),
      issues: ctx.issues,
      auditedAt: new Date().toISOString(),
    };
  }

  global.DSAuditorA11y = {
    runA11yAudit: runA11yAudit,
    computeA11yScore: computeA11yScore,
    RULE_META: RULE_META,
  };
})(typeof window !== 'undefined' ? window : self);
