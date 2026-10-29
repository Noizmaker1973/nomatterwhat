#!/usr/bin/env node
// Bundles the app into one self-contained HTML file for hosting as a single
// page (e.g. a claude.ai Artifact). Usage: node scripts/build-artifact.js [out.html]
// The hosted build sets RM_EMBED so exports open a copy panel instead of downloading.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('index.html');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('  <script src='));
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => {
  const js = read(m[1]);
  if (/<\/script/i.test(js)) throw new Error(`${m[1]} contains </script>`);
  return `<script>\n${js}\n</script>`;
});
const fonts = [...html.matchAll(/<link rel="(?:preconnect|stylesheet)" href="https:\/\/fonts[^>]+>/g)].map((m) => m[0]).join('\n');

const out = `<title>MA Rental Matcher</title>
<meta name="claude:viewport-fit-sides" content="cover">
${fonts}
<style>
${read('css/styles.css')}
</style>
${body.trim()}
<script>window.RM_EMBED = true;</script>
${scripts.join('\n')}
`;
const dest = process.argv[2] || path.join(root, 'dist', 'rental-matcher.html');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out);
console.log(`Wrote ${dest} (${(out.length / 1024).toFixed(1)} KB)`);
