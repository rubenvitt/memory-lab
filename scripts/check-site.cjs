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
const run = (scenario, variant, rep, x = E1) => x.runs.find((r) => r.scenario === scenario && r.variant === variant && r.rep === rep);
const reps = [1, 2, 3, 4, 5];
const re = (scenario, x = E1) => new RegExp(x.scenarios.find((s) => s.id === scenario).marker.pattern, 'i');
const markerIn = (stores, scenario, names, x = E1) => names.some((n) => JSON.stringify(stores[n] ?? '').match(re(scenario, x)));
// Blog runs, chosen by a fixed rule and printed. injection (E1): first run where A stored the status, else the first run
// where both agents actually read the poisoned page in session 1. erasure (E1): first run where A kept the canary,
// else the first run where B's cascade removed a preference. erasure-late (E2): first A-mem0 run with the diagnosis
// left in a store after the deletion, else the same for A-v1, else run 1 of A-mem0.
const readPage = (r) => r.points[0].turns.some((t) => t.steps.some((s) => JSON.stringify(s.result ?? '').includes('Hinweis an Assistenten')));
const injectionRep = reps.find((r) => markerIn(run('injection', 'A', r).points[1].stores, 'injection', ['memory']))
  ?? reps.find((r) => readPage(run('injection', 'A', r)) && readPage(run('injection', 'B', r))) ?? 1;
const erasureRep = reps.find((r) => !run('erasure', 'A', r).pass)
  ?? reps.find((r) => run('erasure', 'B', r).points.some((p) => p.stores.audit.some((a) => a.type === 'delete-session' && a.removed.preferences > 0))) ?? 1;
const erasurePoint = run('erasure', 'A', 1).points.findIndex((p) => p.kind === 'event') + 1;
const lateLeft = (v, r) => { const x = run('erasure-late', v, r, E2); return markerIn(x.points.find((p) => p.kind === 'event').stores, 'erasure-late', ['memory'], E2); };
const stepsOf = (r) => r.points.filter((p) => p.kind === 'after' || p.kind === 'event').length;
const SCENARIOS = { 'erasure-late': 'e2', injection: 'e1', stale: 'e1', proxy: 'e1', implicit: 'e1', explicit: 'e1' };
const late = E2 && ([['A-mem0'], ['A-v1']].map(([v]) => ({ v, r: reps.find((r) => lateLeft(v, r)) })).find((x) => x.r) ?? { v: 'A-mem0', r: 1 });
const latePoint = E2 && run('erasure-late', 'A-mem0', 1, E2).points.findIndex((p) => p.kind === 'event') + 1;

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
  await page.waitForSelector('#matrices tbody tr');
  await page.keyboard.press('Tab');
  check(await page.evaluate(() => document.activeElement.classList.contains('skip')), label('first Tab reaches the skip link'));
  check(requests.filter((r) => r.url().startsWith('http://localhost')).every((r) => new URL(r.url()).pathname.startsWith('/memory-lab/')), label('all same-origin requests stay under /memory-lab/'));
  check(await noHScroll(), label('no horizontal page scroll at start'));
  check((await page.locator('#questions button').count()) === 5, label('five questions, the control sits under Details'));
  check((await page.getAttribute('#questions li:first-child button', 'aria-pressed')) === 'true', label('erasure-late comes first'));
  check((await stepText()).startsWith('Schritt 1 von 3'), label(`start at step 1: ${await stepText()}`));
  check(await page.locator('#details').evaluate((d) => !d.open), label('details closed by default'));
  check(await page.isHidden('#result'), label('no result before the last step'));

  // Every question by click, every step by Weiter, the result on the last one.
  for (let q = 0; q < 5; q++) {
    await page.locator('#questions button').nth(q).click();
    const total = Number((await stepText()).match(/von (\d+)/)[1]);
    for (let i = 1; i < total; i++) await page.click('#next');
    check((await stepText()).startsWith(`Schritt ${total} von ${total}`) && await page.isDisabled('#next'), label(`question ${q + 1}: last step reached`));
    check(/Bestanden: A in \d von 5 Läufen, B in \d von 5\./.test(await page.textContent('#result')), label(`question ${q + 1}: result with counts`));
  }

  // Every recorded run and step through the hash, as Details would set it.
  let views = 0, expected = 0;
  for (const x of demo.experiments) {
    const variants = x.id === 'e1' ? ['A'] : ['A-mem0', 'A-v1'];
    for (const sc of x.scenarios.filter((s) => SCENARIOS[s.id])) {
      for (const v of variants) {
        for (const rep of reps) {
          const n = stepsOf(run(sc.id, v, rep, x));
          expected += n;
          for (let i = 1; i <= n; i++) {
            await page.goto(`${BASE}#${sc.id}/${i}/${x.id}/${rep}/${v === 'A' ? 'A-mem0' : v}`);
            await page.waitForFunction((t) => document.getElementById('step').textContent.startsWith(t), `Schritt ${i} von ${n}`, { timeout: 3000 }).then(() => views++, () => {});
          }
        }
      }
    }
  }
  check(views === expected, label(`every step of every run renders: ${views} of ${expected}`));
  check(!consoleLines.some((l) => l.type === 'pageerror'), label('no page error while stepping through'));
  check(await noHScroll(), label('no horizontal scroll after every step'));

  // The deletion step of erasure-late: what A kept is marked, B shows the matching log entry only if there is one.
  await page.goto(`${BASE}#erasure-late/2/e2/${late.r}/${late.v}`);
  await page.waitForFunction(() => document.getElementById('step').textContent.startsWith('Schritt 2'));
  check((await page.textContent('#chat')).includes('gelöscht'), label('deletion step says the chat is gone'));
  check((await page.locator('#store-a .item.hit').count() > 0) === lateLeft(late.v, late.r), label('A: marked entries match the recording'));
  const bLog = run('erasure-late', 'B', late.r, E2).points.find((p) => p.kind === 'event').stores.audit.some((a) => re('erasure-late', E2).test(JSON.stringify(a)));
  check((await page.locator('#store-b h4:text-is("Protokoll")').count() > 0) === bLog, label('B: log shown exactly when it holds a match'));
  check((await page.locator('#store-a .item.gone').count()) > 0, label('the deleted chat stays visible once, struck through'));
  if (shot) await page.screenshot({ path: `${SHOTS}/${name}-erasure.png`, fullPage: true });

  // Matrices equal the recorded results.
  for (const x of demo.experiments) {
    const cells = await page.locator(`#table-${x.id} tbody tr`).evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll('td')].map((c) => c.textContent)));
    const want = x.matrix.map((m) => x.variants.map((v) => `${m.cells[v.id].pass}/${m.cells[v.id].runs}`));
    check(JSON.stringify(cells) === JSON.stringify(want), label(`${x.id} matrix shows the recorded results`));
  }

  // Details and the control scenario, by keyboard.
  await page.goto(`${BASE}#injection/1/e1/2/A-mem0`);
  await page.waitForFunction(() => document.getElementById('step').textContent.startsWith('Schritt 1'));
  await page.locator('#details summary').focus();
  await page.keyboard.press('Enter');
  check(await page.isHidden('#variant-field'), label('no variant picker in E1'));
  await page.selectOption('#exp', 'e2');
  check(await page.isVisible('#variant-field') && (await page.textContent('#exp-note')).includes('nach den Ergebnissen von E1'), label('E2 is marked as added after E1'));
  await page.selectOption('#exp', 'e1');
  await page.locator('#control').focus();
  await page.keyboard.press('Enter');
  check((await page.textContent('#question')).includes('SMS'), label('control scenario reachable from Details'));
  await page.locator('#next').focus();
  await page.keyboard.press('Enter');
  check((await stepText()).startsWith('Schritt 2'), label('Weiter by keyboard'));
  if (shot) await page.screenshot({ path: `${SHOTS}/${name}-control.png`, fullPage: true });

  const relevant = consoleLines.filter((l) => ['error', 'warning', 'pageerror'].includes(l.type) && !/fonts\.g/.test(l.text));
  check(relevant.length === 0, label(`console clean ${relevant.map((l) => `${l.type}: ${l.text}`).join(' | ')}`));
  await context.close();
}

// The three images for the blog post: light, element shots of the 936 px wide content column scaled to 1600 px.
async function blogShots(browser) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1600 / 936, colorScheme: 'light' });
  const page = await context.newPage();
  const shotOf = async (hash, selector, file) => {
    await page.goto(`${BASE}#${hash}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    // From the first to the last selected element, with a margin, so the image stands without the page around it.
    const boxes = await page.locator(selector).evaluateAll((els) => els.filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().toJSON()));
    const top = Math.min(...boxes.map((b) => b.top)) + await page.evaluate(() => scrollY);
    const bottom = Math.max(...boxes.map((b) => b.bottom)) + await page.evaluate(() => scrollY);
    const left = Math.min(...boxes.map((b) => b.left)), right = Math.max(...boxes.map((b) => b.right));
    const pad = 32;
    await page.screenshot({ path: path.join(BLOG, file), fullPage: true, clip: { x: left - pad, y: top - pad, width: right - left + 2 * pad, height: bottom - top + 2 * pad } });
  };
  const story = '.question, .stepper, .legend, .chat, .minds, .result';
  await shotOf(`erasure-late/2/e2/${late.r}/${late.v}`, story, 'chat-loeschen.png');
  await shotOf(`injection/1/e1/${injectionRep}/A-mem0`, story, 'store-inspektor.png');
  await shotOf('erasure-late/1/e2/1/A-mem0', '.matrix', 'matrix.png');
  console.log(`blog: erasure-late E2 ${late.v} run ${late.r} step 2; injection E1 run ${injectionRep} step 1 -> ${BLOG}`);
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
