// Serves site/ under /memory-lab/ like GitHub Pages, steps through every scenario and run and takes screenshots.
// Playwright is no dependency of this project: NODE_PATH=<dir with node_modules> node scripts/check-site.cjs
// CHROMIUM_PATH optionally names a browser binary, SHOTS the screenshot folder (default .tmp/site-check),
// BLOG a folder for the three blog images (store-inspektor.png, chat-loeschen.png, matrix.png).
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const SITE = process.env.SITE ?? path.join(__dirname, '../site');
const SHOTS = process.env.SHOTS ?? path.join(__dirname, '../.tmp/site-check');
const BLOG = process.env.BLOG;
fs.mkdirSync(SHOTS, { recursive: true });
const demo = JSON.parse(fs.readFileSync(path.join(SITE, 'data/demo.json'), 'utf8'));
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

const E1 = demo.experiments.find((e) => e.id === 'e1');
const E2 = demo.experiments.find((e) => e.id === 'e2');
const QUESTIONS = { 'erasure-late': { x: E2, a: 'A-mem0' }, implicit: { x: E1, a: 'A' } };
const run = (scenario, variant, rep) => QUESTIONS[scenario].x.runs.find((r) => r.scenario === scenario && r.variant === variant && r.rep === rep);
const reps = [1, 2, 3, 4, 5];
const stepsOf = (r) => r.points.filter((p) => p.kind === 'after' || p.kind === 'event').length;
const diag = /makula|macula/i;
const logHit = (rep) => run('erasure-late', 'B', rep).points.find((p) => p.kind === 'event').stores.audit.some((a) => diag.test(JSON.stringify(a)));
const aSaid = (rep) => diag.test(run('erasure-late', 'A-mem0', rep).points.find((p) => p.kind === 'session' && p.session === 2).turns.at(-1).answer ?? '');
// Blog images, fixed rule: the deletion step of the first run where B's log keeps the diagnosis (else run 1);
// implicit after its last session in the first run where A passes and B fails (else run 1).
const lateRep = reps.find(logHit) ?? 1;
const implicitRep = reps.find((r) => run('implicit', 'A', r).pass && !run('implicit', 'B', r).pass) ?? 1;

async function visit(browser, { name, viewport, colorScheme, shot }) {
  const context = await browser.newContext({ viewport, colorScheme, hasTouch: viewport.width < 500 });
  const page = await context.newPage();
  const consoleLines = [], requests = [];
  page.on('pageerror', (e) => consoleLines.push({ type: 'pageerror', text: e.message }));
  page.on('console', (m) => consoleLines.push({ type: m.type(), text: `${m.text()} ${m.location().url}` }));
  page.on('request', (r) => requests.push(r));
  const label = (t) => `[${name}] ${t}`;
  const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const stepText = () => page.textContent('#step');

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('#runs button');
  await page.keyboard.press('Tab');
  check(await page.evaluate(() => document.activeElement.classList.contains('skip')), label('first Tab reaches the skip link'));
  check(requests.filter((r) => r.url().startsWith('http://localhost')).every((r) => new URL(r.url()).pathname.startsWith('/memory-lab/')), label('all same-origin requests stay under /memory-lab/'));
  check(await noHScroll(), label('no horizontal page scroll at start'));
  check((await page.locator('#questions button').count()) === 2, label('two questions'));
  check((await page.locator('select, table, details').count()) === 0, label('no pickers, no matrix, no details'));
  const body = await page.textContent('body');
  check(!/Canary|Extraktor|Store|\d\/5/.test(body), label('no jargon and no bare fractions'));
  check((await page.locator('#runs button').count()) === 5, label('five runs as sentences'));

  // erasure-late: one sentence per run, the log of B named exactly in the runs where it holds the diagnosis.
  const lines = await page.locator('#runs .run-text').allTextContents();
  reps.forEach((r, i) => {
    check(lines[i].includes('Protokoll') === logHit(r), label(`erasure-late run ${r}: log sentence matches the recording`));
    check(lines[i].startsWith(aSaid(r) ? 'A erwähnt die Diagnose' : 'A hat die Diagnose'), label(`erasure-late run ${r}: A sentence matches the recording`));
  });

  // Every run of both questions, every step via Weiter, no errors.
  let views = 0, expected = 0;
  for (const [qi, id] of Object.keys(QUESTIONS).entries()) {
    await page.locator('#questions button').nth(qi).click();
    check((await page.textContent('#question')).length > 10, label(`${id}: question shown`));
    for (const r of reps) {
      await page.locator('#runs button').nth(r - 1).click();
      check(await page.evaluate(() => document.activeElement.id === 'story'), label(`${id} run ${r}: focus moves to the run`));
      const n = stepsOf(run(id, QUESTIONS[id].a, r));
      expected += n;
      views++;
      for (let i = 1; i < n; i++) { await page.click('#next'); views++; }
      check((await stepText()).startsWith(`Schritt ${n} von ${n}`) && await page.isDisabled('#next'), label(`${id} run ${r}: last step reached`));
    }
  }
  check(views === expected, label(`every step renders: ${views} of ${expected}`));
  check(!consoleLines.some((l) => l.type === 'pageerror'), label('no page error while stepping through'));
  check(await noHScroll(), label('no horizontal scroll after every step'));

  // The deletion step: A keeps the marked diagnosis, the deleted chat is struck through, B shows the log only with a match.
  await page.goto(`${BASE}#erasure-late/${lateRep}/2`);
  await page.waitForFunction(() => document.getElementById('step').textContent.startsWith('Schritt 2'));
  check((await page.textContent('#chat')).includes('gelöscht'), label('deletion step says the chat is gone'));
  check((await page.locator('#store-a .item.hit:not(.gone)').count()) > 0 && (await page.locator('#store-a .item.gone').count()) > 0, label('A keeps the diagnosis, the chat is struck through'));
  check((await page.locator('#store-b h5:text-matches("^Protokoll")').count() > 0) === logHit(lateRep), label('B: log shown exactly when it holds the diagnosis'));
  if (shot) await page.screenshot({ path: `${SHOTS}/${name}-erasure.png`, fullPage: true });

  // Keyboard: Weiter and Zurück.
  await page.locator('#prev').focus();
  await page.keyboard.press('Enter');
  check((await stepText()).startsWith('Schritt 1'), label('Zurück by keyboard'));
  await page.goto(`${BASE}#implicit/${implicitRep}/4`);
  await page.waitForFunction(() => document.getElementById('step').textContent.startsWith('Schritt 4'));
  check((await page.textContent('#chat')).includes('Vorher: sucht im Katalog'), label('lookups shown in plain words'));
  if (shot) await page.screenshot({ path: `${SHOTS}/${name}-implicit.png`, fullPage: true });

  const relevant = consoleLines.filter((l) => ['error', 'warning', 'pageerror'].includes(l.type) && !/fonts\.g/.test(l.text));
  check(relevant.length === 0, label(`console clean ${relevant.map((l) => `${l.type}: ${l.text}`).join(' | ')}`));
  await context.close();
}

// The three images for the blog post: light, the 920 px content column scaled to 1600 px, cut with a margin.
async function blogShots(browser) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1600 / 920, colorScheme: 'light' });
  const page = await context.newPage();
  const shotOf = async (hash, selector, file) => {
    await page.goto(`${BASE}#${hash}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const scroll = await page.evaluate(() => scrollY);
    const boxes = await page.locator(selector).evaluateAll((els) => els.filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().toJSON()));
    const top = Math.min(...boxes.map((b) => b.top)) + scroll, bottom = Math.max(...boxes.map((b) => b.bottom)) + scroll;
    const left = Math.min(...boxes.map((b) => b.left)), right = Math.max(...boxes.map((b) => b.right));
    const pad = 24; // less than the 32 px above the run title, so the divider stays out
    await page.screenshot({ path: path.join(BLOG, file), fullPage: true, clip: { x: left - pad, y: top - pad, width: right - left + 2 * pad, height: bottom - top + 2 * pad } });
  };
  const story = '.story-title, .stepper, .legend, .chat, .minds';
  await shotOf(`erasure-late/${lateRep}/2`, story, 'chat-loeschen.png');
  await shotOf(`implicit/${implicitRep}/4`, story, 'store-inspektor.png');
  await shotOf('erasure-late/1/1', '.question, .summary, .run-list', 'matrix.png');
  console.log(`blog: erasure-late run ${lateRep} step 2; implicit run ${implicitRep} step 4 -> ${BLOG}`);
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
