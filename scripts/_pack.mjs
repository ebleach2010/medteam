// Inline dist/ into one self-contained HTML (artifact sandbox blocks all fetches).
import { readFileSync, writeFileSync, readdirSync } from 'fs';

const dist = 'dist';
let html = readFileSync(`${dist}/index.html`, 'utf8');

// inline the ENTRY script/stylesheet referenced by index.html (the build may
// emit extra chunks — trust the tags, not directory order)
const jsMatch = html.match(/<script[^>]*type="module"[^>]*src="\.?\/?(assets\/[^"]+\.js)"[^>]*><\/script>/);
const cssMatch = html.match(/<link[^>]*rel="stylesheet"[^>]*href="\.?\/?(assets\/[^"]+\.css)"[^>]*>/);
if (!jsMatch || !cssMatch) throw new Error('entry script/stylesheet not found in dist/index.html');

const jsSrc = readFileSync(`${dist}/${jsMatch[1]}`, 'utf8').replaceAll('</script', '<\\/script');
const cssSrc = readFileSync(`${dist}/${cssMatch[1]}`, 'utf8');

html = html.replace(jsMatch[0], () => `<script type="module">${jsSrc}</script>`);
html = html.replace(cssMatch[0], () => `<style>${cssSrc}</style>`);
html = html.replace(/<link[^>]*rel="modulepreload"[^>]*>/g, '');
html = html.replace(/<script[^>]*src="\.?\/?registerSW\.js"[^>]*><\/script>/g, ''); // no SW in a single file
if (/src="\.?\/?assets\//.test(html)) throw new Error('unresolved asset reference remains — add chunk inlining');
html = html.replace(/<link[^>]*rel="(manifest|icon|apple-touch-icon)"[^>]*>/g, '');
html = html.replace(/<script[^>]*id="vite-plugin-pwa:register-sw"[^>]*><\/script>/g, '');

const out = process.argv[2];
writeFileSync(out, html);
console.log('packed', out, (html.length / 1048576).toFixed(2) + ' MB');
