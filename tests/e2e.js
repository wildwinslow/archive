/* End-to-end test: drives the Collection Archive in real Chromium. */
const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIR = path.resolve(__dirname, '..') + '/';
const PORT = 8931;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json'
};

function serve(){
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      let file = path.join(DIR, urlPath === '/' ? 'index.html' : urlPath);
      if(!file.startsWith(DIR)){ rsp.writeHead(403); return rsp.end(); }
      fs.readFile(file, (err, data) => {
        if(err){ rsp.writeHead(404); return rsp.end('404'); }
        rsp.writeHead(200, {'Content-Type': MIME[path.extname(file)] || 'application/octet-stream'});
        rsp.end(data);
      });
    });
    srv.listen(PORT, '127.0.0.1', () => res(srv));
  });
}

let passed = 0, failed = 0;
function ok(cond, label){
  if(cond){ passed++; console.log('  ok  ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}

(async () => {
  const srv = await serve();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } }); // phone-ish
  // The repo root may contain a published share.json (owner snapshot). A fresh
  // context then hits the viewer gate — correct app behavior, wrong for these
  // tests. Seed an empty OWNER key (only if absent) to test the owner experience.
  await ctx.addInitScript(() => {
    if(localStorage.getItem('winslow.collections.v1') === null){
      localStorage.setItem('winslow.collections.v1',
        JSON.stringify({ items: [], wishlist: [], sets: [], cats: [], history: [] }));
    }
  });
  const page = await ctx.newPage();

  const consoleErrors = [];
  page.on('console', m => { if(m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

  // deterministic spot prices regardless of network (predicate > glob)
  await page.route(
    url => url.hostname === 'api.gold-api.com',
    route => {
      const price = route.request().url().includes('XAG') ? 46.95 : 3860.30;
      route.fulfill({ contentType: 'application/json',
        body: JSON.stringify({ price, updatedAt: new Date().toISOString() }) });
    });

  console.log('== load & shell ==');
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'networkidle' });
  ok((await page.title()).includes('Collection Archive'), 'page title');
  ok(await page.isVisible('#fab'), 'FAB visible');
  ok((await page.locator('.empty').count()) === 1, 'empty state shown');
  ok((await page.locator('link[rel=manifest]').count()) === 1, 'manifest linked');
  const mf = await page.evaluate(async () => {
    const r = await fetch('manifest.webmanifest');
    return { status: r.status, body: await r.json() };
  });
  ok(mf.status === 200 && mf.body.display === 'standalone' && mf.body.icons.length === 3, 'manifest served + valid shape');
  const iconOk = await page.evaluate(async () =>
    (await fetch('icon-512.png')).status === 200 && (await fetch('icon-maskable-512.png')).status === 200);
  ok(iconOk, 'icons served');
  await page.waitForFunction(() =>
    /Silver \$[\d,]+\.\d{2}\/oz/.test((document.getElementById('spotline') || {}).textContent || ''),
    null, { timeout: 8000 }).catch(() => {});
  const spotText0 = await page.locator('#spotline').innerText();
  ok(/Silver \$[\d,]+\.\d{2}\/oz/.test(spotText0) && /Gold \$[\d,]+(\.\d+)?/.test(spotText0),
     'spot line live: ' + spotText0.replace(/\n/g, ' '));
  ok(await page.isVisible('#portfolio'), 'portfolio panel visible');

  console.log('== add item via UI ==');
  await page.click('#fab');
  ok(await page.isVisible('#modal'), 'modal opens');
  await page.fill('#f-name', '1944 jeep first-aid kit');
  await page.fill('#f-cat', 'World War II');
  await page.fill('#f-cond', 'Good');
  await page.fill('#f-value', '45.50');
  await page.fill('#f-notes', 'seller said "museum quality" (suspicious)');
  await page.click('button.save');
  await page.waitForTimeout(150);
  ok((await page.locator('.card').count()) === 1, 'card appears after save');
  const cardText = await page.locator('.card').innerText();
  ok(cardText.includes('1944 jeep first-aid kit'), 'card shows name');
  ok(cardText.includes('$45.5'), 'card shows value');
  ok(cardText.includes('World War II'), 'card shows category');
  const statsText = await page.locator('#stats').innerText();
  ok(statsText.includes('1') && statsText.includes('45.5'), 'stats updated: ' + statsText.replace(/\n/g, ' '));

  console.log('== second item + search + filter ==');
  await page.click('#fab');
  await page.fill('#f-name', 'Mercury dime');
  await page.fill('#f-cat', 'Coins');
  await page.fill('#f-qty', '3');
  await page.click('button.save');
  await page.waitForTimeout(150);
  ok((await page.locator('.card').count()) === 2, 'two cards');
  await page.fill('#search', 'mercury');
  await page.waitForTimeout(100);
  ok((await page.locator('.card').count()) === 1, 'search filters to 1');
  await page.fill('#search', '');
  await page.waitForTimeout(100);
  const coinChip = page.locator('.chip', { hasText: 'Coins' });
  await coinChip.click();
  await page.waitForTimeout(100);
  ok((await page.locator('.card').count()) === 1, 'category chip filters');
  await page.locator('.chip[data-cat="All"]').click();
  await page.waitForTimeout(100);

  console.log('== edit item ==');
  const jeepCard = page.locator('.card', { hasText: 'jeep first-aid kit' });
  await jeepCard.locator('[data-edit]').click();
  await page.waitForTimeout(150);
  ok((await page.inputValue('#f-name')).includes('jeep'), 'edit form prefilled with jeep item');
  await page.fill('#f-value', '60');
  await page.click('button.save');
  await page.waitForTimeout(150);
  ok((await page.locator('.card').count()) === 2, 'edit does not duplicate');
  const stats2 = await page.locator('#stats').innerText();
  ok(stats2.includes('$60'), 'total recalculated to 60, got: ' + stats2.replace(/\n/g, ' '));

  console.log('== persistence across reload ==');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(200);
  ok((await page.locator('.card').count()) === 2, 'items survive reload (localStorage)');

  console.log('== export ==');
  const dl = page.waitForEvent('download');
  await page.click('#exportBtn');
  const download = await dl;
  const dlPath = await download.path();
  const backup = JSON.parse(fs.readFileSync(dlPath, 'utf8'));
  ok(Array.isArray(backup.items) && backup.items.length === 2, 'export JSON has 2 items');
  ok(backup.cats.includes('World War II'), 'export carries categories');

  console.log('== delete ==');
  page.on('dialog', d => d.accept());
  await page.locator('[data-del]').first().click();
  await page.waitForTimeout(250);
  ok((await page.locator('.card').count()) === 1, 'delete removes card');

  console.log('== live melt flow ==');
  await page.click('#fab');
  await page.selectOption('#f-metal', 'silver');
  await page.selectOption('#f-preset', 'dime90');
  const wt = await page.inputValue('#f-weight');
  ok(wt === '0.07234', 'preset fills fine weight, got ' + wt);
  await page.fill('#f-name', 'Mercury dime');
  await page.fill('#f-cat', 'Coins');
  await page.click('button.save');
  await page.waitForTimeout(250);
  const meltTags = await page.locator('.tag.melt').allInnerTexts();
  const spotNow = await page.locator('#spotline').innerText();
  const pm = spotNow.match(/\$([\d,]+\.\d{2})\/oz/);
  const silverNow = pm ? parseFloat(pm[1].replace(',', '')) : NaN;
  const expectedMelt = (0.07234 * silverNow).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  ok(!isNaN(silverNow), 'spotline exposes silver price for cross-check: ' + spotNow.replace(/\n/g, ' '));
  ok(meltTags.some(t => t.includes('melt $' + expectedMelt)),
     'melt tag = 0.07234oz x displayed spot -> $' + expectedMelt + ', got: ' + JSON.stringify(meltTags));
  const pfText = await page.locator('#portfolio').innerText();
  ok(pfText.toLowerCase().includes('portfolio'), 'portfolio panel shows value: ' + pfText.replace(/\n/g, ' '));
  // edit flow keeps metal fields
  const dimeCard = page.locator('.card', { hasText: 'Mercury dime' });
  await dimeCard.locator('[data-edit]').click();
  await page.waitForTimeout(150);
  ok((await page.inputValue('#f-metal')) === 'silver', 'edit form restores metal field');
  ok((await page.inputValue('#f-weight')) === '0.07234', 'edit form restores fine weight');
  await page.click('#cancelBtn');

  console.log('== merge file ==');
  const cardsBeforeMerge = await page.locator('.card').count();
  await page.setInputFiles('#mergeFile', path.join(__dirname, 'merge-fixture.json'));
  await page.waitForTimeout(250);
  const mergeStatus = await page.locator('#mergeStatus').innerText();
  ok(mergeStatus.includes('1 added') && mergeStatus.includes('0 updated'),
     'merge status reports counts: ' + mergeStatus);
  ok((await page.locator('.card').count()) === cardsBeforeMerge + 1,
     'merge adds exactly one card, existing untouched');
  ok(await page.locator('.card', { hasText: 'Rook test Mercury dime' }).count() === 1,
     'merged entry renders with name');
  // idempotency through the UI: same file again -> nothing added
  await page.setInputFiles('#mergeFile', path.join(__dirname, 'merge-fixture.json'));
  await page.waitForTimeout(250);
  const mergeStatus2 = await page.locator('#mergeStatus').innerText();
  ok(mergeStatus2.includes('0 added') && mergeStatus2.includes('1 kept yours'),
     're-merge keeps local copy, status: ' + mergeStatus2);
  ok((await page.locator('.card').count()) === cardsBeforeMerge + 1,
     'no duplicate cards after re-merge');

  console.log('== year field + year sort + year search ==');
  await page.click('#fab');
  await page.fill('#f-name', 'NES front-loader');
  await page.fill('#f-cat', 'Games & Consoles');
  await page.fill('#f-year', '1985');
  await page.click('button.save');
  await page.waitForTimeout(200);
  ok(await page.locator('.card', { hasText: 'NES front-loader' }).locator('.tag.year', { hasText: '1985' }).count() === 1,
     'single-year tag renders on card');
  await page.click('#fab');
  await page.fill('#f-name', 'Pocket watch');
  await page.fill('#f-cat', 'Weird Objects');
  await page.fill('#f-year', '1915-1925');
  await page.click('button.save');
  await page.waitForTimeout(200);
  const watchTag = await page.locator('.card', { hasText: 'Pocket watch' }).locator('.tag.year').innerText();
  ok(watchTag.includes('1915') && watchTag.includes('1925'), 'range year tag renders: ' + watchTag);
  await page.selectOption('#sort', 'year-asc');
  await page.waitForTimeout(150);
  const firstName = await page.locator('.card .name').first().innerText();
  ok(firstName === 'Pocket watch', 'year-asc puts 1915 first, got ' + firstName);
  const names = await page.locator('.card .name').allInnerTexts();
  ok(names.indexOf('NES front-loader') < names.indexOf('1944 jeep first-aid kit'),
     'yeared items rank above unyeared, order: ' + names.join(' | '));
  await page.selectOption('#sort', 'year-desc');
  await page.waitForTimeout(150);
  const firstNameD = await page.locator('.card .name').first().innerText();
  ok(firstNameD === 'NES front-loader', 'year-desc puts 1985 first, got ' + firstNameD);
  await page.selectOption('#sort', 'new');
  await page.fill('#search', '1900-1920');
  await page.waitForTimeout(150);
  const rangeHits = await page.locator('.card .name').allInnerTexts();
  ok(rangeHits.length === 1 && rangeHits[0] === 'Pocket watch',
     'range search 1900-1920 hits only the watch, got: ' + JSON.stringify(rangeHits));
  await page.fill('#search', '1926');
  await page.waitForTimeout(150);
  ok((await page.locator('.card').count()) === 0, 'year with no overlap -> empty state');
  await page.fill('#search', '');
  await page.waitForTimeout(100);

  console.log('== wishlist view ==');
  await page.click('#viewWishlist');
  await page.waitForTimeout(150);
  ok((await page.locator('.empty b').innerText()) === 'WISHLIST EMPTY', 'wishlist empty state');
  await page.click('#fab');
  // textContent, not innerText: CSS text-transform:uppercase makes innerText shout back
  ok((await page.locator('#modalTitle').textContent()) === 'Add to wishlist', 'modal opens in wishlist mode');
  ok(await page.evaluate(() => document.getElementById('qtyWrap').hidden === true), 'qty hidden for wants');
  ok(await page.evaluate(() => document.getElementById('meltWrap').hidden === true), 'melt block hidden for wants');
  ok((await page.locator('#valueLabel').textContent()) === 'Target price ($)', 'value label becomes target price');
  await page.fill('#f-name', 'Glitched 2017 GoFest Lugia');
  await page.fill('#f-cat', 'Pokémon');
  await page.fill('#f-year', '2017');
  await page.fill('#f-value', '500');
  await page.click('button.save');
  await page.waitForTimeout(200);
  const wantCard = page.locator('.card', { hasText: 'GoFest Lugia' });
  ok(await wantCard.count() === 1, 'want card renders');
  const wantText = await wantCard.innerText();
  ok(wantText.includes('target $500.00'), 'target wording on card, got: ' + wantText.replace(/\n/g, ' '));
  ok(wantText.includes('2017'), 'year tag on want');
  ok((await page.locator('#viewWishlist').innerText()).includes('(1)'), 'viewbar count shows 1');
  const stWish = await page.locator('#stats').innerText();
  ok(stWish.includes('5'), 'stats still 5 collection entries (wishlist excluded), got: ' + stWish.replace(/\n/g, ' '));
  await page.click('#viewCollection');
  await page.waitForTimeout(150);
  ok((await page.locator('.card').count()) === 5, 'collection intact after wishlist add, got ' + await page.locator('.card').count());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  ok((await page.locator('.card').count()) === 5, 'collection persists after reload');
  await page.click('#viewWishlist');
  await page.waitForTimeout(150);
  ok((await page.locator('.card').count()) === 1, 'wishlist persists after reload');

  console.log('== wishlist merge file ==');
  await page.setInputFiles('#mergeFile', path.join(__dirname, 'wish-fixture.json'));
  await page.waitForTimeout(250);
  const wishMerge = await page.locator('#mergeStatus').innerText();
  ok(wishMerge.includes('1 added') && wishMerge.includes('wishlist'), 'wishlist merge status: ' + wishMerge);
  ok((await page.locator('.card').count()) === 2, 'want landed in wishlist view');
  await page.setInputFiles('#mergeFile', path.join(__dirname, 'wish-fixture.json'));
  await page.waitForTimeout(250);
  ok((await page.locator('#mergeStatus').innerText()).includes('0 added'), 'wishlist re-merge idempotent');
  await page.click('#viewCollection');
  await page.waitForTimeout(150);

  console.log('== country + mint ==');
  await page.click('#fab');
  ok(await page.evaluate(() => document.getElementById('mintWrap').hidden === false),
     'mint field visible when category empty');
  await page.fill('#f-cat', 'Games & Consoles');
  ok(await page.evaluate(() => document.getElementById('mintWrap').hidden === true),
     'mint field hides for non-coin category');
  ok(await page.evaluate(() => document.getElementById('denomWrap').hidden === true),
     'denomination field hides for non-coin category');
  await page.fill('#f-cat', 'Coins');
  ok(await page.evaluate(() => document.getElementById('mintWrap').hidden === false),
     'mint field returns for Coins');
  ok(await page.evaluate(() => document.getElementById('denomWrap').hidden === false),
     'denomination field follows the coin gate');
  await page.fill('#f-name', 'Notgeld test piece');
  await page.fill('#f-country', 'Poland');
  await page.fill('#f-mint', 'Aachen');
  await page.fill('#f-denom', '10 fenigów');
  await page.click('button.save');
  await page.waitForTimeout(200);
  const coinCard = page.locator('.card', { hasText: 'Notgeld test piece' });
  ok(await coinCard.count() === 1, 'coin card renders');
  const coinText = await coinCard.innerText();
  ok(coinText.includes('Poland'), 'country tag renders, got: ' + coinText.replace(/\n/g, ' '));
  ok(coinText.includes('mint: Aachen'), 'mint tag renders, got: ' + coinText.replace(/\n/g, ' '));
  ok(coinText.includes('10 fenigów'), 'denomination tag renders, got: ' + coinText.replace(/\n/g, ' '));
  await page.fill('#search', 'Aachen');
  await page.waitForTimeout(150);
  ok((await page.locator('.card').count()) === 1, 'search by mint hits only the coin');
  await page.fill('#search', 'poland');
  await page.waitForTimeout(150);
  ok((await page.locator('.card').count()) === 1, 'search by country hits only the coin (case-insensitive)');
  await page.fill('#search', 'fenigów');
  await page.waitForTimeout(150);
  ok((await page.locator('.card').count()) === 1, 'search by denomination hits the coin');
  await page.fill('#search', '');
  await page.waitForTimeout(100);
  // edit roundtrip keeps country/mint/denom
  await coinCard.locator('[data-edit]').click();
  await page.waitForTimeout(150);
  ok((await page.inputValue('#f-country')) === 'Poland', 'edit restores country');
  ok((await page.inputValue('#f-mint')) === 'Aachen', 'edit restores mint');
  ok((await page.inputValue('#f-denom')) === '10 fenigów', 'edit restores denomination');
  await page.click('#cancelBtn');

  console.log('== cost basis + verification ==');
  await page.click('#fab');
  await page.fill('#f-name', 'Cost test pin');
  await page.fill('#f-cat', 'Militaria');
  await page.fill('#f-paid', '20');
  await page.selectOption('#f-verified', 'user');
  await page.fill('#f-value', '35');
  await page.click('button.save');
  await page.waitForTimeout(250);
  const pinCard = page.locator('.card', { hasText: 'Cost test pin' });
  const pinText = await pinCard.innerText();
  ok(pinText.includes('paid $20.00'), 'paid tag renders: ' + pinText.replace(/\n/g, ' '));
  ok(pinText.includes('yours'), 'verification badge renders');
  const statsPL = await page.locator('#stats').innerText();
  ok(/gain vs paid|underwater vs paid/.test(statsPL), 'P/L stat renders: ' + statsPL.replace(/\n/g, ' '));

  console.log('== graded tier ==');
  await page.click('#fab');
  ok(await page.evaluate(() => document.getElementById('gradeWrap').hidden === true), 'grade field hidden by default');
  await page.selectOption('#f-verified', 'graded');
  ok(await page.evaluate(() => document.getElementById('gradeWrap').hidden === false), 'grade field appears for graded');
  await page.fill('#f-grade', 'PCGS MS65 · cert 39284712');
  await page.selectOption('#f-verified', 'user');
  ok(await page.evaluate(() => document.getElementById('gradeWrap').hidden === true), 'grade field hides again for other tiers');
  await page.selectOption('#f-verified', 'graded');
  await page.fill('#f-name', 'Graded test coin');
  await page.fill('#f-cat', 'Coins');
  await page.click('button.save');
  await page.waitForTimeout(250);
  const gradedCard = page.locator('.card', { hasText: 'Graded test coin' });
  const gradedText = await gradedCard.innerText();
  ok(gradedText.includes('graded'), 'graded badge renders');
  ok(gradedText.includes('PCGS MS65'), 'grade details render on card: ' + gradedText.replace(/\n/g, ' '));
  const certHref = await gradedCard.locator('a.tag.verify').getAttribute('href');
  ok(certHref === 'https://www.pcgs.com/cert/39284712', 'badge links to PCGS cert page, got: ' + certHref);
  await page.fill('#search', 'cert 39284712');
  await page.waitForTimeout(150);
  ok((await page.locator('.card').count()) === 1, 'search by cert number finds the coin');
  await page.fill('#search', '');
  await page.waitForTimeout(100);
  await gradedCard.locator('[data-edit]').click();
  await page.waitForTimeout(150);
  ok((await page.inputValue('#f-grade')) === 'PCGS MS65 · cert 39284712', 'edit restores grade details');
  ok((await page.inputValue('#f-verified')) === 'graded', 'edit restores graded tier');
  await page.click('#cancelBtn');

  console.log('== reset portfolio trend ==');
  // a sparkline needs 2 different days (same-day snapshots upsert), so fabricate
  // two past days in storage before testing the reset
  await page.evaluate(() => {
    const k = 'winslow.collections.v1';
    const st = JSON.parse(localStorage.getItem(k) || '{}');
    st.history = [{ d: '2026-01-01', v: 50 }, { d: '2026-01-02', v: 80 }];
    localStorage.setItem(k, JSON.stringify(st));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(350);
  ok((await page.locator('svg.spark').count()) === 1, 'sparkline exists before reset');
  ok(await page.isVisible('#resetHist'), 'reset trend button visible');
  await page.click('#resetHist');   // suite's existing dialog handler accepts the confirm
  await page.waitForTimeout(300);
  ok((await page.locator('svg.spark').count()) === 0, 'sparkline cleared after reset');
  ok((await page.locator('#portfolio').innerText()).includes('trend line builds'), 'panel back to fresh-start hint');
  const histAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('winslow.collections.v1')).history.length);
  ok(histAfter === 1, 'history holds only today after reset, got ' + histAfter);

  console.log('== portfolio time machine ==');
  await page.evaluate(() => {
    const k = 'winslow.collections.v1';
    const st = JSON.parse(localStorage.getItem(k) || '{}');
    st.history = [{ d: '2026-01-01', v: 50 }, { d: '2026-01-02', v: 80 }, { d: '2026-01-03', v: 65 }];
    localStorage.setItem(k, JSON.stringify(st));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(350);
  await page.fill('#histFrom', '2026-01-02');
  await page.waitForTimeout(250);
  const dayText = await page.locator('#portfolio').innerText();
  ok(dayText.includes('$80.00'), 'single-day view shows that day value: ' + dayText.replace(/\n/g, ' '));
  ok(dayText.includes('vs 2026-01-01'), 'day view shows vs-previous-day delta');
  await page.fill('#histTo', '2026-01-03');
  await page.waitForTimeout(250);
  const rangeText = await page.locator('#portfolio').innerText();
  ok(rangeText.includes('2026-01-02') && rangeText.includes('2026-01-03'), 'range header shows both dates');
  ok((await page.locator('#portfolio svg.spark').count()) === 1, 'range sparkline redraws for the window');
  ok(rangeText.includes('$65.00'), 'range shows end value');
  ok(rangeText.includes('high'), 'range shows low/high');
  await page.fill('#histTo', '');   // clear to FIRST: setting from while to<from triggers the auto-swap
  await page.fill('#histFrom', '2026-01-10');
  await page.waitForTimeout(250);
  ok((await page.locator('#portfolio').innerText()).includes('no snapshot on 2026-01-10'), 'missing day honestly reported');
  await page.click('#histClear');
  await page.waitForTimeout(250);
  ok((await page.locator('#portfolio svg.spark').count()) === 1, 'clear returns to all-time sparkline');

  console.log('== roulette ==');
  await page.click('#rollBtn');
  ok(await page.isVisible('#rollOverlay'), 'roulette overlay opens');
  ok((await page.locator('#rollBody').innerText()).length > 0, 'roulette shows an item');
  await page.click('#rollAgain');
  await page.waitForTimeout(120);
  await page.click('#rollClose');

  console.log('== sets ==');
  await page.click('#viewSets');
  await page.waitForTimeout(150);
  ok((await page.locator('.empty b').innerText()) === 'NO SETS YET', 'sets empty state');
  await page.click('#setAddBtn');
  await page.fill('#s-name', 'Test date set');
  await page.fill('#s-desc', 'three entries');
  await page.fill('#s-entries', ['1916-D | 1916', '1921 | 1921', '1926-S | 1926'].join(String.fromCharCode(10)));
  await page.click('#setForm button[type=submit]');
  await page.waitForTimeout(250);
  const setCard = page.locator('.setcard', { hasText: 'Test date set' });
  ok(await setCard.count() === 1, 'set card renders');
  ok((await setCard.innerText()).includes('0/3'), 'set starts 0/3');
  await setCard.locator('.setentry').first().click();
  await page.waitForTimeout(150);
  ok((await page.locator('.setcard').innerText()).includes('1/3'), 'entry toggle updates progress');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(350);
  await page.click('#viewSets');
  await page.waitForTimeout(150);
  ok((await page.locator('.setcard').count()) === 1, 'set persists after reload');
  ok((await page.locator('.setcard').innerText()).includes('1/3'), 'owned state persists after reload');

  console.log('== map ==');
  await page.click('#viewMap');
  await page.waitForTimeout(150);
  const mapHtml = await page.locator('#grid').innerHTML();
  ok(mapHtml.includes('<svg'), 'map renders svg');
  ok(mapHtml.includes('Poland') || mapHtml.includes('poland') || mapHtml.includes('🇵🇱'), 'map shows the Poland pin');
  ok(mapHtml.includes('Militaria') || mapHtml.includes('x1'), 'map legend shows item counts');

  console.log('== lock / unlock ==');
  await page.click('#viewCollection');
  await page.waitForTimeout(120);
  await page.click('#lockBtn');
  ok(await page.isVisible('#passOverlay'), 'create-passcode overlay opens on first lock');
  await page.fill('#passInput', 'test1234');
  await page.fill('#passConfirm', 'test1234');
  await page.click('#passSubmit');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => document.body.classList.contains('locked')), 'locked class applied');
  ok(await page.evaluate(() => getComputedStyle(document.getElementById('fab')).display === 'none'), 'FAB hidden while locked');
  await page.click('#lockBtn');
  await page.fill('#passInput', 'wrongpass');
  await page.click('#passSubmit');
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => document.body.classList.contains('locked')), 'wrong passcode stays locked');
  await page.fill('#passInput', 'test1234');
  await page.click('#passSubmit');
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => !document.body.classList.contains('locked')), 'correct passcode unlocks');

  console.log('== share snapshot publish ==');
  const dlPromise = page.waitForEvent('download');
  await page.click('#shareBtn');
  await page.fill('#passInput', 'test1234');
  await page.click('#passSubmit');
  const dl2 = await dlPromise;
  const sharePath = await dl2.path();
  const shareRaw = fs.readFileSync(sharePath, 'utf8');
  const shareFile = JSON.parse(shareRaw);
  ok(shareFile.v === 1 && shareFile.salt && shareFile.iv && shareFile.data, 'snapshot file is encrypted');
  ok(!shareRaw.includes('Cost test pin'), 'plaintext item names absent from snapshot');

  console.log('== remote viewer ==');
  const SHARE = path.join(__dirname, '..', 'share.json');
  const SHARE_BACKUP = fs.existsSync(SHARE) ? fs.readFileSync(SHARE) : null; // preserve the published snapshot
  fs.copyFileSync(sharePath, SHARE);
  const viewerCtx = await browser.newContext();
  const vpage = await viewerCtx.newPage();
  await vpage.goto('http://127.0.0.1:8931/index.html', { waitUntil: 'networkidle' });
  await vpage.waitForTimeout(500);
  ok(await vpage.isVisible('#passOverlay'), 'viewer gate appears on fresh device');
  ok((await vpage.locator('.viewerbanner').count()) === 1, 'viewer banner shown');
  await vpage.fill('#passInput', 'wrongpass');
  await vpage.click('#passSubmit');
  await vpage.waitForTimeout(300);
  ok((await vpage.locator('.card').count()) === 0, 'wrong passcode sees nothing');
  await vpage.fill('#passInput', 'test1234');
  await vpage.click('#passSubmit');
  await vpage.waitForTimeout(400);
  ok((await vpage.locator('.card').count()) > 0, 'correct passcode shows the collection');
  ok(await vpage.evaluate(() => document.body.classList.contains('locked')), 'viewer is read-only locked');
  ok(await vpage.evaluate(() => getComputedStyle(document.getElementById('fab')).display === 'none'), 'viewer cannot add items');
  ok(await vpage.evaluate(() => localStorage.getItem('winslow.collections.v1') === null), 'viewer leaves owner data key untouched');
  const ownerCards = await page.locator('.card').count();
  ok(ownerCards > 0, 'owner session intact after viewer test');
  await viewerCtx.close();
  if(SHARE_BACKUP) fs.writeFileSync(SHARE, SHARE_BACKUP); else fs.unlinkSync(SHARE);

  console.log('== service worker ==');
  const swState = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    await new Promise(r => setTimeout(r, 400));
    const keys = await caches.keys();
    const cached = keys.length ? (await (await caches.open(keys[0])).keys()).length : 0;
    return { scope: reg.scope, keys, cached };
  });
  ok(swState.keys.some(k => k.startsWith('archive-v')), 'SW cache present, keys: ' + swState.keys.join(','));
  ok(swState.cached >= 5, 'shell precached (' + swState.cached + ' entries)');

  console.log('== offline reload ==');
  const cardsBeforeOffline = await page.locator('.card').count();
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const offlineCards = await page.locator('.card').count();
  const offlineTitle = await page.title();
  ok(offlineTitle.includes('Collection Archive'), 'offline: page serves from cache');
  ok(offlineCards === cardsBeforeOffline,
     'offline: all ' + cardsBeforeOffline + ' cards render from cache, got ' + offlineCards);
  await ctx.setOffline(false);

  console.log('== XSS guard ==');
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('#fab');
  await page.fill('#f-name', '<img src=x onerror=alert(1)>');
  await page.click('button.save');
  await page.waitForTimeout(150);
  const injected = await page.evaluate(() => document.querySelectorAll('.card img').length);
  ok(injected === 0, 'HTML in name is escaped, not executed');
  let xssFired = false;
  page.on('dialog', () => { xssFired = true; });
  await page.waitForTimeout(200);
  ok(!xssFired, 'no alert() from injected markup');

  console.log('== screenshots ==');
  await page.screenshot({ path: DIR + 'shot-list.png', fullPage: false });
  await page.click('#fab');
  await page.waitForTimeout(150);
  await page.screenshot({ path: DIR + 'shot-form.png', fullPage: false });

  const jsErrors = consoleErrors.filter(e => !e.includes('Failed to load resource'));
  const resourceNoise = consoleErrors.filter(e => e.includes('Failed to load resource'));
  ok(jsErrors.length === 0, 'zero JS errors' + (jsErrors.length ? ': ' + jsErrors.join(' | ') : ''));
  if(resourceNoise.length) console.log('  note  expected resource noise (offline phase): ' + resourceNoise.length + ' fetch failure(s)');

  await browser.close();
  srv.close();
  console.log('\n' + (failed === 0 ? 'ALL PASS: ' + passed + ' checks' : failed + ' FAILED, ' + passed + ' passed'));
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
