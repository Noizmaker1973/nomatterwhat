/**
 * Builds the standalone page: AdConverterUI.html with AdEngine.gs inlined, so
 * it runs in any browser with no Apps Script, no server and no sign-in.
 *
 *   standalone/lead-ads.html     full HTML document: open it from disk or host it anywhere (committed)
 *   dist/lead-ads.fragment.html  same page without <html>/<head> wrappers (for hosts that add their own)
 */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const ui = fs.readFileSync(path.join(root, 'apps-script/AdConverterUI.html'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'apps-script/AdEngine.gs'), 'utf8');

if (!ui.includes('<!--ENGINE-->')) throw new Error('AdConverterUI.html is missing the <!--ENGINE--> marker.');
if (/<\/script/i.test(engine)) throw new Error('AdEngine.gs must not contain a closing script tag.');

// Function replacer: the engine source contains "$'", which a string replacement would expand.
const fragment = ui.replace('<!--ENGINE-->', () => '<script>\n' + engine + '\n</script>');
const full = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n</head>\n<body>\n' + fragment + '\n</body>\n</html>\n';

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.mkdirSync(path.join(root, 'standalone'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/lead-ads.fragment.html'), fragment);
fs.writeFileSync(path.join(root, 'standalone/lead-ads.html'), full);
console.log('Built standalone/lead-ads.html (' + Math.round(full.length / 1024) + ' KB)');
