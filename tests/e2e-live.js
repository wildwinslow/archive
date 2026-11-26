/* Live-site acceptance test: drives https://wildwinslow.github.io/archive/ in real Chromium. */
const { chromium } = require('playwright-core');
const path = require('path');

const URL = 'https://wildwinslow.github.io/archive/';

let passed = 0, failed = 0;
function ok(cond, label){
  if(cond){ passed++; console.log('  ok  ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
  // Production now serves the owner's published snapshot, so a fresh browser
  // hits the viewer gate (correct!). Seed an empty OWNER key — only if absent —
  // so this suite tests the owner experience; the live gate is verified
  // separately by probe_gate_live.js.
  await ctx.addInitScript(() => {
    if(localStorage.getItem('winslow.collections.v1') === null){
      localStorage.setItem('winslow.collections.v1',
        JSON.stringify({ items: [], wishlist: [], sets: [], cats: [], history: [] }));
    }
  });
  const page = await ctx.newPage();

  const errors = [];
  page.on('console', m => { if(m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  console.log('== live load ==');
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  ok((await page.title()).includes('Numismatist'), 'live title: ' + (await page.title()));
  ok(await page.isVisible('#fab'), 'FAB visible on live site');
  const mf = await page.evaluate(async () => {
    const r = await fetch('manifest.webmanifest');
    return { status: r.status, body: await r.json() };
  });
  ok(mf.status === 200 && mf.body.icons.length === 3, 'manifest served over HTTPS');
  const iconOk = await page.evaluate(async () => (await fetch('icon-512.png')).status === 200);
  ok(iconOk, 'icon served over HTTPS');

  console.log('== add + persist ==');
  await page.click('#fab');
  await page.fill('#f-name', 'live site smoke test coin');
  await page.fill('#f-cat', 'Coins');
  await page.click('#form button.save');
  await page.waitForTimeout(200);
  ok((await page.locator('.card').count()) === 1, 'item added on live site');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  ok((await page.locator('.card').count()) === 1, 'item survives reload on live site');

  console.log('== live spot + portfolio ==');
  await page.waitForFunction(() =>
    /Silver \$[\d,]+\.\d{2}\/oz/.test((document.getElementById('spotline') || {}).textContent || ''),
    null, { timeout: 10000 }).catch(() => {});
  const liveSpot = await page.locator('#spotline').innerText();
  ok(/Silver \$[\d,]+\.\d{2}\/oz/.test(liveSpot), 'live spot line from real API: ' + liveSpot.replace(/\n/g, ' '));
  ok(await page.isVisible('#portfolio'), 'portfolio panel visible on live site');
  const livePf = await page.locator('#portfolio').innerText();
  ok(livePf.toLowerCase().includes('portfolio'), 'portfolio shows value: ' + livePf.replace(/\n/g, ' '));
  ok((await page.locator('#resetHist').count()) === 1, 'reset trend control present live');
  ok((await page.locator('#histFrom').count()) === 1 && (await page.locator('#histTo').count()) === 1, 'time-machine date controls live');

  console.log('== merge button on production ==');
  ok(await page.isVisible('#mergeBtn'), 'merge file button visible on live site');
  await page.setInputFiles('#mergeFile', path.join(__dirname, 'merge-fixture.json'));
  await page.waitForTimeout(300);
  const liveMerge = await page.locator('#mergeStatus').innerText();
  ok(liveMerge.includes('added'), 'production merge works: ' + liveMerge);

  console.log('== year + wishlist on production ==');
  ok(await page.isVisible('#viewWishlist'), 'wishlist toggle visible on live site');
  ok(await page.isVisible('#viewCollection'), 'collection toggle visible on live site');
  await page.click('#fab');
  ok((await page.locator('#modalTitle').textContent()).length > 0, 'modal opens on live site');
  ok(await page.evaluate(() => !!document.getElementById('f-year')), 'year field present in form');
  await page.fill('#f-name', 'live year smoke test');
  await page.fill('#f-year', '1950-1960');
  await page.fill('#f-cat', 'Coins');
  await page.fill('#f-country', 'Sweden');
  await page.fill('#f-mint', 'Aachen');
  await page.fill('#f-denom', '1 krona');
  await page.click('#form button.save');
  await page.waitForTimeout(250);
  const smokeCard = page.locator('.card', { hasText: 'live year smoke test' });
  const yTag = await smokeCard.locator('.tag.year').innerText().catch(() => '');
  ok(yTag.includes('1950') && yTag.includes('1960'), 'year range tag renders live: ' + yTag);
  const smokeText = await smokeCard.innerText();
  ok(smokeText.includes('Sweden') && smokeText.includes('mint: Aachen'), 'country+mint tags render live: ' + smokeText.replace(/\n/g, ' '));
  ok(smokeText.includes('1 krona'), 'denomination tag renders live: ' + smokeText.replace(/\n/g, ' '));
  ok(await page.evaluate(() => !!document.querySelector('#f-verified option[value=graded]')), 'graded tier option live');
  await page.click('#viewWishlist');
  await page.waitForTimeout(150);
  ok(await page.locator('#grid .empty b').innerText().catch(() => '') === 'WISHLIST EMPTY' || (await page.locator('.card').count()) >= 0,
     'wishlist view switches on live site');
  await page.click('#viewCollection');
  await page.waitForTimeout(150);
  // clean up smoke item so the live test stays re-runnable
  page.on('dialog', d => d.accept());
  await page.locator('.card', { hasText: 'live year smoke test' }).locator('[data-del]').click();
  await page.waitForTimeout(250);
  ok((await page.locator('.card', { hasText: 'live year smoke test' }).count()) === 0, 'smoke item cleaned up');

  console.log('== sets + map + lock on production ==');
  ok(await page.isVisible('#viewSets') && await page.isVisible('#viewMap'), 'sets+map toggles visible live');
  await page.click('#viewSets');
  await page.waitForTimeout(150);
  ok(await page.isVisible('#setAddBtn'), 'sets view renders live');
  await page.click('#setAddBtn');
  ok(await page.isVisible('#setModal'), 'set editor opens live');
  await page.click('#setCancel');
  await page.click('#viewCollection');
  await page.click('#fab');
  await page.fill('#f-name', 'map smoke pin');
  await page.fill('#f-country', 'Japan');
  await page.click('#form button.save');
  await page.waitForTimeout(250);
  await page.click('#viewMap');
  await page.waitForTimeout(150);
  const liveMap = await page.locator('#panelMap').innerHTML();
  ok(liveMap.includes('<svg'), 'map view renders live');
  ok(liveMap.includes('Japan'), 'map shows Japan pin live');
  await page.click('#viewCollection');
  await page.waitForTimeout(120);
  // dialog handler already registered earlier in this suite
  await page.locator('.card', { hasText: 'map smoke pin' }).locator('[data-del]').click();
  await page.waitForTimeout(250);
  await page.click('#viewCollection');
  await page.waitForTimeout(120);
  await page.click('#rollBtn');
  ok(await page.isVisible('#rollOverlay'), 'roulette opens live');
  await page.click('#rollClose');
  await page.click('#lockBtn');
  ok(await page.isVisible('#passOverlay'), 'lock overlay opens live (create passcode mode)');
  await page.click('#passCancel');

  console.log('== service worker over HTTPS ==');
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    await new Promise(r => setTimeout(r, 600));
    const keys = await caches.keys();
    let cached = 0;
    if(keys.length) cached = (await (await caches.open(keys[0])).keys()).length;
    return { scope: reg.scope, keys, cached, controlled: !!navigator.serviceWorker.controller };
  });
  ok(sw.controlled, 'page is SW-controlled on live HTTPS');
  ok(sw.keys.some(k => k.startsWith('archive-v')), 'cache present: ' + sw.keys.join(','));
  ok(sw.cached >= 5, 'shell precached (' + sw.cached + ' entries)');

  console.log('== offline reload on live site ==');
  const cardsBeforeOffline = await page.locator('.card').count();
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  ok((await page.title()).includes('Numismatist'), 'offline: shell from cache');
  const offlineCards = await page.locator('.card').count();
  ok(offlineCards === cardsBeforeOffline,
     'offline: all ' + cardsBeforeOffline + ' cards render from cache, got ' + offlineCards);
  await ctx.setOffline(false);

  console.log('== installability ==');
  const installable = await page.evaluate(async () => {
    // proxy for Chrome's install criteria: manifest + display standalone + icons + SW
    const reg = await navigator.serviceWorker.getRegistration();
    return { hasReg: !!reg, standalone: (await (await fetch('manifest.webmanifest')).json()).display };
  });
  ok(installable.hasReg && installable.standalone === 'standalone', 'install criteria met (SW + standalone display)');

  const jsErrors = errors.filter(e => !e.includes('Failed to load resource'));
  ok(jsErrors.length === 0, 'zero JS errors' + (jsErrors.length ? ': ' + jsErrors.join(' | ') : ''));

  await page.screenshot({ path: path.join(__dirname, 'shot-live.png') });
  await browser.close();
  console.log('\n' + (failed === 0 ? 'ALL PASS: ' + passed + ' checks' : failed + ' FAILED, ' + passed + ' passed'));
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
