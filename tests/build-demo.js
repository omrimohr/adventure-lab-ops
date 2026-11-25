// node tests/build-demo.js → /home/claude/demo/index.html (override with DEMO_OUT): docs/index.html as ONE self-contained file
// with a stubbed fetch (tests/demo-stub.js) answering every API fn from in-memory demo data. No network.
const fs = require('fs'), path = require('path');
const out = process.env.DEMO_OUT || '/home/claude/demo/index.html';
const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
const stub = fs.readFileSync(path.join(__dirname, 'demo-stub.js'), 'utf8');
const marker = '<script>\n(()=>{\n// ===== Estado.';
if (html.indexOf(marker) < 0) throw new Error('main <script> marker not found in docs/index.html');
const built = html.replace(marker, '<script>\n' + stub + '\n</script>\n' + marker).replace('<title>Adventure Lab Ops</title>', '<title>Adventure Lab Ops · Demo</title>');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, built);
// PWA files next to the demo so the <link>s resolve (no console errors)
for (const f of ['manifest.webmanifest', 'icon-192.png', 'apple-touch-icon.png']) fs.copyFileSync(path.join(__dirname, '..', 'docs', f), path.join(path.dirname(out), f));
console.log('demo written:', out, (built.length / 1024).toFixed(0) + ' KB');
