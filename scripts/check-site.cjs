// Serves site/ under /memory-lab/ like GitHub Pages, plays through the demo and takes screenshots.
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

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('#matrices tbody tr');
  await page.keyboard.press('Tab');
  check(await page.evaluate(() => document.activeElement.classList.contains('skip')), label('first Tab reaches the skip link'));
  check(requests.filter((r) => r.url().startsWith('http://localhost')).every((r) => new URL(r.url()).pathname.startsWith('/memory-lab/')), label('all same-origin requests stay under /memory-lab/'));
  check(await page.evaluate(() => [...document.querySelectorAll('[data-prose]')].map((n) => n.textContent.trim().split(/\s+/).length).reduce((a, b) => a + b, 0) <= 60), label('prose stays short'));
  check((await page.locator('#scenarios button').count()) === 6, label('six scenarios'));
  check(await noHScroll(), label('no horizontal page scroll at start'));

  // Matrices equal the recorded runs.
  for (const x of demo.experiments) {
    const cells = await page.locator(`#table-${x.id} tbody tr`).evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll('.frac')].map((c) => c.textContent)));
    const want = x.matrix.map((m) => x.variants.map((v) => `${m.cells[v.id].pass}/${m.cells[v.id].runs}`));
    check(JSON.stringify(cells) === JSON.stringify(want), label(`${x.id} matrix shows the recorded results ${JSON.stringify(cells)}`));
  }
  const dots = await page.locator('#matrices .dot').count();
  const allRuns = demo.experiments.reduce((n, x) => n + x.runs.length, 0);
  check(dots === allRuns, label(`one dot per run: ${dots}`));

  // Every point of every run renders, A and B have the same timeline. E2 for both A variants.
  let points = 0, expected = 0;
  for (const x of demo.experiments) {
    await page.click(`#experiments button:text-is("${x.label}")`);
    check(await page.locator('#avariant-field').isHidden() === (x.id === 'e1'), label(`${x.id}: A variant picker only in E2`));
    const aVariants = x.variants.filter((v) => v.id !== 'B').map((v) => v.id);
    for (const s of x.scenarios) {
      await page.click(`#scenarios button:has(code:text-is("${s.id}"))`);
      for (const av of aVariants) {
        if (x.id !== 'e1') await page.selectOption('#avariant', av);
        for (const rep of reps) {
          await page.selectOption('#rep', String(rep));
          const n = await page.locator('#timeline button').count();
          check(n === run(s.id, av, rep, x).points.length && n === run(s.id, 'B', rep, x).points.length, label(`${x.id} ${s.id} ${av} ${rep}: timeline has ${n} points for A and B`));
          if (!(await page.textContent('#title-A')).startsWith(x.variants.find((v) => v.id === av).label)) check(false, label(`${x.id} ${av}: column title`));
          for (let i = 0; i < n; i++) {
            await page.locator('#timeline button').nth(i).click();
            points++;
          }
          expected += run(s.id, av, rep, x).points.length;
        }
      }
    }
  }
  check(points === expected, label(`every point renders: ${points}`));
  check(!consoleLines.some((l) => l.type === 'pageerror'), label('no page error while clicking through'));
  check(await noHScroll(), label('no horizontal scroll after every point'));

  // Deep link and the stored canary in erasure.
  await page.goto(`${BASE}#erasure/${erasureRep}/${erasurePoint}`, { waitUntil: 'networkidle' }); // old link format, means E1
  await page.waitForSelector('.store');
  check((await page.locator('#timeline button[aria-current="step"]').textContent()).includes('löscht'), label('deep link selects the deletion'));
  const aHits = await page.locator('.g-A .entry.hit').count();
  const recordedA = !run('erasure', 'A', erasureRep).pass;
  check((aHits > 0) === recordedA, label(`erasure A: canary marks match the check (${aHits} marks, failed: ${recordedA})`));
  const bHitsOutsideAudit = await page.locator('.g-B .store:not(:last-child) .entry.hit').count();
  check(bHitsOutsideAudit === 0 || !run('erasure', 'B', erasureRep).pass, label('erasure B: marks outside the audit match the check'));
  check((await page.locator('#log-A.deleted').count()) === 1 && (await page.locator('.chat .msg.hit').count()) === 0, label('deleted chat is marked as recording, without hit marks'));
  if (shot) await page.screenshot({ path: `${SHOTS}/${name}-erasure.png`, fullPage: true });

  // "Chat löschen" on the last point of explicit: A keeps the SMS wish, B drops it if it came from session 2.
  await page.goto(`${BASE}#e1/explicit/1/2`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.store');
  await page.click('#erase');
  check((await page.getAttribute('#erase', 'aria-pressed')) === 'true' && (await page.textContent('#status')).includes('gelöscht'), label('Chat löschen simulates and says so'));
  check((await page.textContent('#inspector-source')).includes('simuliert'), label('inspector marks the simulation'));
  check((await page.locator('.g-B .store:nth-child(1) .entry').count()) === 0, label('B session store empty after deletion'));
  await page.click('#erase');
  check((await page.textContent('#inspector-source')).includes('aufgezeichnet'), label('second click restores the recording'));

  // Keyboard: matrix row loads a scenario.
  await page.locator('#table-e1 tbody tr:nth-child(5) th button').focus();
  await page.keyboard.press('Enter');
  check((await page.getAttribute('#scenarios button:nth-child(5)', 'aria-pressed')) === 'true', label('matrix row by keyboard loads implicit'));
  check(await page.evaluate(() => document.activeElement.closest('#scenarios') !== null), label('focus moves to the scenario buttons'));
  if (E2) {
    await page.locator('#table-e2 tbody tr:nth-child(1) th button').click();
    check((await page.getAttribute('#experiments button:nth-child(2)', 'aria-pressed')) === 'true' && (await page.getAttribute('#scenarios button:nth-child(1)', 'aria-pressed')) === 'true', label('E2 matrix row switches experiment'));
    check(await page.isVisible('#exp-note'), label('E2 is marked as added after E1'));
    await page.goto(`${BASE}#e2/erasure-late/${late.r}/${latePoint}/${late.v}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.store');
    check((await page.inputValue('#avariant')) === late.v && (await page.locator('#log-A.deleted').count()) === 1, label('E2 deep link with A variant'));
    check((await page.locator('.g-A .entry.hit').count() > 0) === lateLeft(late.v, late.r), label('erasure-late: marks match the stores'));
  }
  if (shot) await page.screenshot({ path: `${SHOTS}/${name}-full.png`, fullPage: true });

  const relevant = consoleLines.filter((l) => ['error', 'warning', 'pageerror'].includes(l.type) && !/fonts\.g/.test(l.text));
  check(relevant.length === 0, label(`console clean ${relevant.map((l) => `${l.type}: ${l.text}`).join(' | ')}`));
  await context.close();
}

// The three images for the blog post: light, about 1600 px wide, element shots.
async function blogShots(browser) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 4 / 3, colorScheme: 'light' });
  const page = await context.newPage();
  const shotOf = async (hash, selector, file) => {
    await page.goto(`${BASE}#${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.store');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await page.locator(selector).screenshot({ path: path.join(BLOG, file) });
  };
  await shotOf(`e1/injection/${injectionRep}/2`, 'main', 'store-inspektor.png');
  if (E2) await shotOf(`e2/erasure-late/${late.r}/${latePoint}/${late.v}`, 'main', 'chat-loeschen.png');
  else await shotOf(`e1/erasure/${erasureRep}/${erasurePoint}`, 'main', 'chat-loeschen.png');
  await shotOf('e1/injection/1/1', '.matrix', 'matrix.png'); // a point without marks, so no highlight reaches into the shot
  console.log(`blog: injection E1 run ${injectionRep}; ${E2 ? `erasure-late E2 ${late.v} run ${late.r} point ${latePoint}` : `erasure E1 run ${erasureRep}`} -> ${BLOG}`);
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
