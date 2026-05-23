#!/usr/bin/env node
/**
 * Regenerate bundled FDS token library from source CSS.
 * Usage: node scripts/bundle-preload.js [path-to-variables-light.css]
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const defaultCss = path.join(
  root,
  'data/fds-variables-light.css'
);
const cssPath = process.argv[2] || defaultCss;
const outJson = path.join(root, 'data/fds-variables-light.tokens.json');

global.window = global;
require(path.join(root, 'lib/color-utils.js'));
require(path.join(root, 'lib/token-parser.js'));

const css = fs.readFileSync(cssPath, 'utf8');
const tokens = global.DSAuditorTokenParser.parseCSS(css, 'FDS Light');

const lib = {
  id: 'fds-variables-light',
  name: 'FDS — Light (bundled)',
  tokens,
  tokenCount: tokens.length,
  uploadedAt: new Date().toISOString(),
  bundled: true,
  sourceFile: path.basename(cssPath),
};

fs.writeFileSync(outJson, JSON.stringify(lib));
console.log('Wrote', outJson, '—', tokens.length, 'tokens');
