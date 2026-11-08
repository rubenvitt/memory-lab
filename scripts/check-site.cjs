// Serves site/ under /memory-lab/ like GitHub Pages, checks the static page and takes screenshots.
// Playwright is no dependency of this project: NODE_PATH=<dir with node_modules> node scripts/check-site.cjs
// CHROMIUM_PATH optionally names a browser binary, SHOTS the screenshot folder (default .tmp/site-check),
// BLOG a folder for the two blog images (kopien.png, raten.png).
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const SITE = process.env.SITE ?? path.join(__dirname, '../site');
const SHOTS = process.env.SHOTS ?? path.join(__dirname, '../.tmp/site-check');
const BLOG = process.env.BLOG;
fs.mkdirSync(SHOTS, { recursive: true });
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (!url.startsWith('/memory-lab/')) { res.writeHead(404); return res.end('outside base'); }
  const file = path.join(SITE, url.slice('/memory-lab/'.length) || 'index.html');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
const BASE = 'http://localhost:4174/memory-lab/';
const problems = [];
const check = (ok, label) => { console.log(ok ? 'ok  ' : 'FAIL', label); if (!ok) problems.push(label); };

const page = JSON.parse(fs.readFileSync(path.join(SITE, 'data/page.json'), 'utf8'));

async function visit(browser, { name, viewport, colorScheme, shot }) {
  const context = await browser.newContext({ viewport, colorScheme, hasTouch: viewport.width < 500 });
  const p = await context.newPage();
  const consoleLines = [], requests = [];
  p.on('pageerror', (e) => consoleLines.push({ type: 'pageerror', text: e.message }));
  p.on('console', (m) => consoleLines.push({ type: m.type(), text: `${m.text()} ${m.location().url}` }));
  p.on('request', (r) => requests.push(r));
  const label = (t) => `[${name}] ${t}`;
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.waitForSelector('#cases tbody tr');
  check(requests.filter((r) => r.url().startsWith('http://localhost')).every((r) => new URL(r.url()).pathname.startsWith('/memory-lab/')), label('all same-origin requests stay under /memory-lab/'));
  check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), label('no horizontal page scroll'));
  check((await p.locator('button, select, input, details').count()) === 0, label('static: no controls'));
  check((await p.locator('.copy').count()) === 4 && (await p.locator('.copy.reached').count()) === 1, label('four copies, only the chat is reached'));
  check((await p.textContent('.copy-list')).includes(page.query) && (await p.textContent('.copy-list')).includes(page.memory.slice(0, 30)), label('copies show the real query and memory entry'));
  check((await p.locator('#grid .cell').count()) === 4, label('2×2 with four cells'));
  // The full table equals the computed cells.
  const cells = await p.locator('#cases tbody tr').evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll('td')].map((c) => c.textContent)));
  const want = page.cases.map((c) => page.variants.map((v) => page.cells.find((x) => x.case === c.id && x.variant === v.id).text));
  check(JSON.stringify(cells) === JSON.stringify(want), label('case table shows the computed results'));
  // Bars: width matches k/n, numbers match the data.
  const bars = await p.locator('.bar').evaluateAll((list) => list.map((b) => ({ num: b.querySelector('.num').textContent, w: b.querySelector('.fill').getBoundingClientRect().width / b.querySelector('.track').getBoundingClientRect().width })));
  const expected = [page.e3b.mem0.nebenbei, page.e3b.v1.nebenbei, page.e3b.mem0.ausdruecklich, page.e3b.v1.ausdruecklich, page.e3c.plain.nebenbei, page.e3c.plain.ausdruecklich];
  check(bars.length === 6 && bars.every((b, i) => b.num === `${expected[i].k} von ${expected[i].n}` && Math.abs(b.w - expected[i].k / expected[i].n) < 0.02), label(`bars match the rates ${bars.map((b) => b.num).join(', ')}`));
  // Contrast of bar fills against their track, and of marked text.
  const contrast = await p.evaluate(() => {
    const rgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const bg = (sel) => getComputedStyle(document.querySelector(sel)).backgroundColor;
    const mark = document.querySelector('mark');
    return { fill: ratio(bg('.bar .fill'), bg('.bar .track')), leak: ratio(bg('.bar.leak .fill'), bg('.bar .track')), mark: ratio(getComputedStyle(mark).color, getComputedStyle(mark).backgroundColor) };
  });
  check(contrast.fill >= 3 && contrast.leak >= 3 && contrast.mark >= 4.5, label(`contrast ok ${JSON.stringify(contrast)}`));
  if (shot) await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  const relevant = consoleLines.filter((l) => ['error', 'warning', 'pageerror'].includes(l.type) && !/fonts\.g/.test(l.text));
  check(relevant.length === 0, label(`console clean ${relevant.map((l) => `${l.type}: ${l.text}`).join(' | ')}`));
  await context.close();
}

// The blog images: light, the 920 px content column scaled to 1600 px, cut with a margin.
async function blogShots(browser) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1600 / 920, colorScheme: 'light' });
  const p = await context.newPage();
  const shotOf = async (selector, file) => {
    await p.goto(BASE, { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(300);
    const scroll = await p.evaluate(() => scrollY);
    const boxes = await p.locator(selector).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
    const top = Math.min(...boxes.map((b) => b.top)) + scroll, bottom = Math.max(...boxes.map((b) => b.bottom)) + scroll;
    const left = Math.min(...boxes.map((b) => b.left)), right = Math.max(...boxes.map((b) => b.right));
    const pad = 24;
    await p.screenshot({ path: path.join(BLOG, file), fullPage: true, clip: { x: left - pad, y: top - pad, width: right - left + 2 * pad, height: bottom - top + 2 * pad } });
  };
  await shotOf('.head, .copies, #grid-title, .intro, .grid, .grid + .note', 'kopien.png');
  await shotOf('.rates', 'raten.png');
  console.log(`blog: kopien.png, raten.png -> ${BLOG}`);
  await context.close();
}

(async () => {
  await new Promise((r) => server.listen(4174, r));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  await visit(browser, { name: 'desktop-light', viewport: { width: 1280, height: 800 }, colorScheme: 'light', shot: true });
  await visit(browser, { name: 'desktop-dark', viewport: { width: 1280, height: 800 }, colorScheme: 'dark', shot: true });
  await visit(browser, { name: 'mobile-light', viewport: { width: 375, height: 812 }, colorScheme: 'light', shot: true });
  await visit(browser, { name: 'mobile-dark', viewport: { width: 375, height: 812 }, colorScheme: 'dark' });
  if (BLOG) await blogShots(browser);
  await browser.close();
  server.close();
  console.log(problems.length ? `\n${problems.length} PROBLEME` : '\nalles ok');
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
