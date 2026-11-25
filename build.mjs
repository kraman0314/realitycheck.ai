import { readFile, writeFile } from 'node:fs/promises';
const base = new URL('./public/', import.meta.url);
let html = await readFile(new URL('index.template.html', base), 'utf8');
const [css, js] = await Promise.all([
  readFile(new URL('styles.css', base), 'utf8'),
  readFile(new URL('app.js', base), 'utf8')
]);
html = html.replace(/<link rel="preconnect"[^>]*>\s*/g, '');
html = html.replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>\s*/g, '');
html = html.replace('<link rel="stylesheet" href="/styles.css">', () => `<style>\n${css}\n</style>`);
html = html.replace('<script src="/app.js" defer></script>', () => `<script>\n${js}\n</script>`);
if (html.includes('href="/styles.css"') || html.includes('src="/app.js"')) throw new Error('Could not inline app assets');
await writeFile(new URL('index.html', base), html);
console.log('Built public/index.html with inline CSS and JS for the sandbox preview.');
