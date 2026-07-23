// Inline dist/ into one self-contained HTML (artifact sandbox blocks all fetches).
import { readFileSync, writeFileSync, readdirSync } from 'fs';

const dist = 'dist';
let html = readFileSync(`${dist}/index.html`, 'utf8');
const assets = readdirSync(`${dist}/assets`);
const js = assets.find((f) => f.endsWith('.js'));
const css = assets.find((f) => f.endsWith('.css'));

let jsSrc = readFileSync(`${dist}/assets/${js}`, 'utf8').replaceAll('</script', '<\\/script');
const cssSrc = readFileSync(`${dist}/assets/${css}`, 'utf8');

html = html.replace(/<script[^>]*type="module"[^>]*><\/script>/, () => `<script type="module">${jsSrc}</script>`);
html = html.replace(/<link[^>]*rel="stylesheet"[^>]*>/, () => `<style>${cssSrc}</style>`);
html = html.replace(/<link[^>]*rel="(manifest|icon|apple-touch-icon)"[^>]*>/g, '');
html = html.replace(/<script[^>]*id="vite-plugin-pwa:register-sw"[^>]*><\/script>/g, '');

const out = process.argv[2];
writeFileSync(out, html);
console.log('packed', out, (html.length / 1048576).toFixed(2) + ' MB');
