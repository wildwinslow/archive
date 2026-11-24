const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if(!m) { console.error('FAIL: no script block'); process.exit(1); }
fs.writeFileSync(path.join(__dirname, '_core.js'), m[1]);
const app = require(path.join(__dirname, '_core.js'));

let passed = 0, failed = 0;
function ok(cond, label){ if(cond){passed++;} else {failed++; console.error('FAIL: ' + label);} }

// upsert + stats
let st = { items: [], cats: ['Coins'] };
app.upsertItem(st, { name: '1944 jeep first-aid kit', cat: 'World War II', qty: 1, value: '45.50', notes: 'from a seller who said "museum quality"' });
app.upsertItem(st, { name: 'Mercury dime', cat: 'Coins', qty: 3, value: '12' });
ok(st.items.length === 2, 'two items after upsert');
ok(st.cats.includes('World War II'), 'new category auto-added');
const s = app.stats(st);
ok(s.entries === 2 && s.pieces === 4, 'stats entries/pieces');
ok(Math.abs(s.total - 57.5) < 1e-9, 'stats total = 57.5, got ' + s.total);

// update via same id
const id0 = st.items.find(x => x.name === '1944 jeep first-aid kit').id;
app.upsertItem(st, { id: id0, name: 'Jeep med kit', cat: 'World War II', qty: 2, value: 50 });
ok(st.items.length === 2, 'upsert by id does not duplicate');
ok(st.items.find(x => x.id === id0).qty === 2, 'upsert updates qty');
ok(app.stats(st).total === 62, 'total recalculated after update, got ' + app.stats(st).total);

// remove
app.removeItem(st, id0);
ok(st.items.length === 1, 'remove works');

// filtering
const items = [
  { name: 'Wheat penny', cat: 'Coins', cond: '', notes: '', qty:1, value:0, created: 3 },
  { name: 'Waffen SS cap badge', cat: 'World War II', cond: 'Fair', notes: 'reproduction?', qty:1, value:0, created: 2 },
  { name: 'Confederate button', cat: 'Civil War', cond: '', notes: '', qty:1, value:0, created: 1 },
];
ok(app.filterItems(items, 'penny', 'All', 'new').length === 1, 'search by name');
ok(app.filterItems(items, '', 'Coins', 'new').length === 1, 'category filter');
ok(app.filterItems(items, 'reproduction', 'All', 'new')[0].name === 'Waffen SS cap badge', 'search hits notes');
const byName = app.filterItems(items, '', 'All', 'name');
ok(byName[0].name === 'Confederate button' && byName[2].name === 'Wheat penny', 'sort A-Z order, got ' + byName.map(x=>x.name).join(' | '));
const byNew = app.filterItems(items, '', 'All', 'new');
ok(byNew[0].name === 'Wheat penny', 'sort newest first');
const byOld = app.filterItems(items, '', 'All', 'old');
ok(byOld[0].name === 'Confederate button', 'sort oldest first');
ok(app.filterItems(items, 'zzz', 'All', 'new').length === 0, 'no matches -> empty');

// normalizeItem safety
const n = app.normalizeItem({ name: 'x'.repeat(500), qty: -5, value: '-3', photo: 'javascript:alert(1)', notes: 'ok' });
ok(n.name.length === 140, 'name clamped to 140');
ok(n.qty === 1, 'qty min 1, got ' + n.qty);
ok(n.value === 0, 'value clamped to 0, got ' + n.value);
ok(n.photo === null, 'non-data:image photo rejected');
ok(n.cat === 'Other', 'missing cat defaults to Other');

// esc
ok(app.esc('<img src=x onerror=alert(1)>') === '&lt;img src=x onerror=alert(1)&gt;', 'esc escapes tags');
ok(app.esc("Bob's") === 'Bob&#39;s', 'esc escapes quotes');

// ---- live melt ----
const spot = { silver: 46.95, gold: 3860.30, ts: 1 };
const dime = app.normalizeItem({ name: 'Mercury dime', cat: 'Coins', metal: 'silver', fineWt: 0.07234, qty: 1 });
const meltDime = app.meltValue(dime, spot);
ok(Math.abs(meltDime - 0.07234 * 46.95) < 1e-9, 'dime melt = fineWt x spot, got ' + meltDime);
const bag = app.normalizeItem({ name: 'dime bag', cat: 'Coins', metal: 'silver', fineWt: 0.07234, qty: 10 });
ok(Math.abs(app.meltValue(bag, spot) - 10 * 0.07234 * 46.95) < 1e-9, 'qty multiplies melt');
const goldBar = app.normalizeItem({ name: 'gold coin', metal: 'gold', fineWt: 1, qty: 1 });
ok(Math.abs(app.meltValue(goldBar, spot) - 3860.30) < 1e-9, 'gold uses gold spot');
ok(app.meltValue(dime, null) === 0, 'no spot -> no melt');
ok(app.meltValue(app.normalizeItem({ name: 'pin', metal: '' }), spot) === 0, 'no metal -> no melt');
ok(app.meltValue(app.normalizeItem({ name: 'x', metal: 'silver', fineWt: 0 }), spot) === 0, 'zero weight -> no melt');

// metal normalization: junk rejected, numbers clamped
const weird = app.normalizeItem({ name: 'x', metal: 'platinum', fineWt: -5 });
ok(weird.metal === '' && weird.fineWt === 0, 'bad metal rejected, negative weight clamped');

// ---- worth: max(appraised, melt) ----
const appraised = app.normalizeItem({ name: 'rare dime', value: 50, metal: 'silver', fineWt: 0.07234, qty: 1 });
ok(app.worth(appraised, spot) === 50, 'appraised value wins when higher');
const bullion = app.normalizeItem({ name: 'bulk dime', value: 0, metal: 'silver', fineWt: 0.07234, qty: 1 });
ok(Math.abs(app.worth(bullion, spot) - meltDime) < 1e-9, 'melt used when no appraised value');

// stats with spot: melt + portfolio fields
const st2 = { items: [appraised, bullion], cats: ['Coins'], history: [] };
const s2 = app.stats(st2, spot);
ok(s2.meltItems === 2, 'meltItems counts metal items');
ok(Math.abs(s2.melt - (meltDime + meltDime)) < 1e-9, 'melt sums across items');
ok(Math.abs(s2.portfolio - (50 + meltDime)) < 1e-9, 'portfolio = sum of worth, got ' + s2.portfolio);
ok(app.stats(st2).melt === 0, 'stats without spot: melt 0 (offline safe)');

// ---- history: daily upsert + cap ----
const hstate = { items: [], cats: [], history: [] };
app.recordHistory(hstate, '2026-11-14', 100);
app.recordHistory(hstate, '2026-11-15', 120);
app.recordHistory(hstate, '2026-11-15', 125);   // same day overwrites
ok(hstate.history.length === 2, 'same-day snapshot overwrites, got ' + hstate.history.length);
ok(hstate.history[1].v === 125, 'latest same-day value wins');
app.recordHistory(hstate, '2026-11-16', 130);
ok(hstate.history.length === 3, 'new day appends');
ok(hstate.history[0].d === '2026-11-14', 'chronological order kept');
const big = { items: [], cats: [], history: [] };
for(let i = 0; i < 500; i++) app.recordHistory(big, 'day' + i, i);
ok(big.history.length === 400 && big.history[0].d === 'day100', 'history capped at 400, oldest dropped');

// ---- sparkline path ----
ok(app.sparkPath([], 300, 56) === '', 'spark: empty history -> empty path');
ok(app.sparkPath([{d:'a',v:1}], 300, 56) === '', 'spark: single point -> empty path');
const p2 = app.sparkPath([{d:'a',v:10},{d:'b',v:20}], 300, 56);
ok(p2.startsWith('M') && p2.includes('L'), 'spark: two points -> M/L path, got ' + p2);
const flat = app.sparkPath([{d:'a',v:5},{d:'b',v:5},{d:'c',v:5}], 300, 56);
ok(!flat.includes('NaN'), 'spark: flat values do not NaN');
const up = app.sparkPath([{d:'a',v:1},{d:'b',v:100}], 300, 56);
// path tokens: "M0.0 54.0 L300.0 2.0" -> y1 = tok[1], y2 = tok[3]
const tok = up.split(/\s+/);
const y1 = parseFloat(tok[1]), y2 = parseFloat(tok[3]);
ok(!isNaN(y1) && !isNaN(y2) && y1 > y2, 'spark: rising values go up (y decreases), ' + y1 + ' -> ' + y2);

// presets are sane published weights
const d90 = app.SILVER_PRESETS.find(p => p.id === 'dime90');
ok(d90 && Math.abs(d90.oz - 0.07234) < 1e-6, 'dime preset is published fine weight');

// ---- merge (Rook entry files) ----
const loc = [
  app.normalizeItem({ id: 'aaa', name: 'existing coin', cat: 'Coins', created: 1000, updated: 5000 }),
  app.normalizeItem({ id: 'bbb', name: 'jeep kit', cat: 'World War II', created: 2000, updated: 6000 })
];
// incoming: one brand-new, one older than local (must be skipped), one newer than local (must update)
const inc = [
  { id: 'ccc', name: 'new dime', cat: 'Coins', created: 7000, updated: 7000 },
  { id: 'bbb', name: 'stale appraisal', cat: 'World War II', created: 2000, updated: 1000 },
  { id: 'aaa', name: 'reappraised coin', cat: 'Coins', created: 1000, updated: 9000 }
];
const mg = app.mergeItems(loc, inc);
ok(mg.added === 1 && mg.updated === 1 && mg.skipped === 1,
   'merge counts: ' + JSON.stringify(mg));
ok(loc.length === 3, 'merge adds new id, got ' + loc.length);
ok(loc.find(x => x.id === 'aaa').name === 'reappraised coin', 'newer incoming replaces local');
ok(loc.find(x => x.id === 'bbb').name === 'jeep kit', 'older incoming does not clobber local');
ok(loc.find(x => x.id === 'ccc').name === 'new dime', 'new entry appended');
// re-merging the same file = idempotent (everything skipped)
const m2 = app.mergeItems(loc, inc);
ok(m2.added === 0 && m2.updated === 0 && m2.skipped === 3, 're-merge is idempotent, got ' + JSON.stringify(m2));
// items without updated fall back to created for comparison
const m3 = app.mergeItems([], [{ id: 'x', name: 'legacy entry', created: 42 }]);
ok(loc.length === 3 && m3.added === 1, 'id-less timestamps still merge safely');

// ---- year parsing / labels ----
const py = app.parseYearRange;
ok(py('1920').from === 1920 && py('1920').to === 1920, 'single year parses');
ok(py('1915-1925').from === 1915 && py('1915-1925').to === 1925, 'range parses');
ok(py('1925-1915').from === 1915 && py('1925-1915').to === 1925, 'reversed range swaps');
ok(py('1915 \u2013 1925').from === 1915 && py('1915 \u2013 1925').to === 1925, 'en-dash range parses');
ok(py('c. 1920').from === 0, 'garbage rejected');
ok(py('999').from === 0, 'pre-1000 rejected');
ok(py('').from === 0 && py(null).from === 0, 'empty/null rejected');
const yn = app.normalizeItem({ name: 'x', yearFrom: 1920, yearTo: 1920 });
ok(yn.yearFrom === 1920 && yn.yearTo === 1920, 'normalize keeps years');
const yr2 = app.normalizeItem({ name: 'x', yearFrom: 1925, yearTo: 1915 });
ok(yr2.yearFrom === 1925 && yr2.yearTo === 1925, 'reversed stored range fixed');
const yg = app.normalizeItem({ name: 'x', yearTo: 1920 });
ok(yg.yearFrom === 0 && yg.yearTo === 0, 'orphan yearTo zeroed');
const ynone = app.normalizeItem({ name: 'x' });
ok(ynone.yearFrom === 0 && ynone.yearTo === 0, 'missing years default 0');
const yi1 = app.normalizeItem({ name: 'a', yearFrom: 1920, yearTo: 1920 });
const yi2 = app.normalizeItem({ name: 'b', yearFrom: 1915, yearTo: 1925 });
const yi3 = app.normalizeItem({ name: 'c' });
ok(app.yearLabel(yi1) === '1920', 'label single: ' + app.yearLabel(yi1));
ok(app.yearLabel(yi2) === '1915\u20131925', 'label range: ' + app.yearLabel(yi2));
ok(app.yearLabel(yi3) === '', 'label none');

// ---- year search ----
const yitems = [yi1, yi2, yi3, app.normalizeItem({ name: 'NES toaster', yearFrom: 1985, yearTo: 1985 })];
ok(app.filterItems(yitems, '1920', 'All', 'new').length === 2, 'search 1920 -> covers 1920 and 1915-1925');
ok(app.filterItems(yitems, '1900-1916', 'All', 'new').length === 1, 'range search overlap only');
ok(app.filterItems(yitems, '1926', 'All', 'new').length === 0, 'no overlap -> empty');
ok(app.filterItems(yitems, 'toaster', 'All', 'new').length === 1, 'text search unaffected');
ok(app.filterItems(yitems, 'NES', 'All', 'new').length === 1, 'text still hits names');

// ---- year sort ----
const asc = app.filterItems(yitems, '', 'All', 'year-asc');
ok(asc[0].name === 'b' && asc[asc.length-1].name === 'c', 'year-asc: 1915 first, no-year last, got ' + asc.map(x=>x.name).join(','));
const desc = app.filterItems(yitems, '', 'All', 'year-desc');
ok(desc[0].name === 'NES toaster' && desc[desc.length-1].name === 'c', 'year-desc: 1985 first, no-year last, got ' + desc.map(x=>x.name).join(','));

// ---- wishlist isolation ----
const ws = { items: [], wishlist: [], cats: ['Coins'], history: [] };
app.upsertItem(ws, { name: 'Glitched 2017 GoFest Lugia', cat: 'Pokémon', value: 0 }, 'wishlist');
ok(ws.wishlist.length === 1 && ws.items.length === 0, 'upsert wishlist leaves items alone');
ok(app.stats(ws).entries === 0, 'stats ignore wishlist (entries=' + app.stats(ws).entries + ')');
app.upsertItem(ws, { name: 'Mercury dime', cat: 'Coins' }, 'items');
ok(ws.items.length === 1 && ws.wishlist.length === 1, 'both lists coexist');
app.removeItem(ws, ws.wishlist[0].id, 'wishlist');
ok(ws.wishlist.length === 0 && ws.items.length === 1, 'remove targets correct list');

// ---- country / mint ----
const cn = app.normalizeItem({ name: 'x', country: 'Poland', mint: 'Aachen' });
ok(cn.country === 'Poland' && cn.mint === 'Aachen', 'country+mint pass through');
const cl = app.normalizeItem({ name: 'x', country: 'C'.repeat(90), mint: 'M'.repeat(90) });
ok(cl.country.length === 40 && cl.mint.length === 40, 'country+mint clamped to 40');
const cnone = app.normalizeItem({ name: 'x' });
ok(cnone.country === '' && cnone.mint === '', 'country+mint default empty');

// search hits country and mint via haystack
const cs = [
  app.normalizeItem({ name: 'notgeld token', cat: 'Coins', country: 'Poland', mint: 'Aachen' }),
  app.normalizeItem({ name: 'NES front-loader', cat: 'Games & Consoles', country: 'Japan' }),
  app.normalizeItem({ name: 'mystery button', cat: 'Weird Objects' })
];
ok(app.filterItems(cs, 'poland', 'All', 'new').length === 1, 'search by country (case-insensitive)');
ok(app.filterItems(cs, 'Aachen', 'All', 'new').length === 1, 'search by mint');
ok(app.filterItems(cs, 'japan', 'All', 'new').length === 1, 'search country on non-coin');
ok(app.filterItems(cs, 'atlantis', 'All', 'new').length === 0, 'unknown country -> no false hit');

// flags: display-only, case-insensitive, graceful fallback
ok(app.flagFor('Poland') === '\ud83c\uddf5\ud83c\uddf7', 'Poland flag');
ok(app.flagFor('  poland ') === '\ud83c\uddf5\ud83c\uddf7', 'flag lookup trims+lowers');
ok(app.flagFor('Atlantis') === '', 'unknown country -> no flag');
ok(app.flagFor('') === '', 'empty country -> no flag');

// ---- denomination ----
const dn = app.normalizeItem({ name: 'x', denom: '10 fenigów' });
ok(dn.denom === '10 fenigów', 'denom passes through (unicode intact): ' + dn.denom);
const dl2 = app.normalizeItem({ name: 'x', denom: 'D'.repeat(90) });
ok(dl2.denom.length === 40, 'denom clamped to 40');
ok(app.normalizeItem({ name: 'x' }).denom === '', 'denom defaults empty');
const ds = [
  app.normalizeItem({ name: 'notgeld token', cat: 'Coins', denom: '10 fenigów' }),
  app.normalizeItem({ name: 'wheat penny', cat: 'Coins', denom: '1 cent' }),
  app.normalizeItem({ name: 'NES', cat: 'Games & Consoles' })
];
ok(app.filterItems(ds, 'fenigów', 'All', 'new').length === 1, 'search by denomination');
ok(app.filterItems(ds, '1 cent', 'All', 'new').length === 1, 'search denom with space');
ok(app.filterItems(ds, 'quarter', 'All', 'new').length === 0, 'no false denom hit');

// ---- sets ----
const setA = app.normalizeSet({ name: 'Mercury dimes 1916-1945', entries: [
  { label: '1916-D', year: 1916, owned: true },
  { label: '1921', year: 1921, owned: false },
  { label: '1926-S', year: 1926, owned: true }
]});
ok(setA.entries.length === 3, 'set entries normalized');
ok(setA.entries[0].year === 1916, 'entry year parses');
const sp = app.setProgress(setA);
ok(sp.owned === 2 && sp.total === 3 && sp.pct === 67, 'set progress 2/3 = 67%, got ' + JSON.stringify(sp));
ok(app.setProgress({ entries: [] }).pct === 0, 'empty set progress 0');
const se2 = app.normalizeSetEntry({ label: 'x'.repeat(200), year: 'nope' });
ok(se2.label.length === 80 && se2.year === 0, 'entry clamped + bad year zeroed');

// ---- origins map ----
const mItems = [
  app.normalizeItem({ name: 'a', country: 'Poland', qty: 2, value: 10 }),
  app.normalizeItem({ name: 'b', country: 'Poland', qty: 1 }),
  app.normalizeItem({ name: 'c', country: 'Atlantis', qty: 1 }),
  app.normalizeItem({ name: 'd', cat: 'x' })
];
const om = app.originMap(mItems, null);
ok(om.length === 2, 'map groups by named country');
const pl = om.find(e => e.country === 'Poland');
ok(pl.count === 3, 'qty summed per country');
ok(pl.lat === 52.1 && pl.lng === 19.4, 'Poland coords resolved');
const at = om.find(e => e.country === 'Atlantis');
ok(at.lat === null, 'unknown country marked unmapped');
const xy = app.mapXY(0, 0, 600, 300);
ok(xy[0] === 300 && xy[1] === 150, 'projection centers on 0,0');

// ---- roulette ----
ok(app.rollItem([]) === null, 'roulette empty -> null');
const picks = new Set();
for(let i = 0; i < 50; i++) picks.add(app.rollItem([1, 2, 3]));
ok(picks.size >= 2, 'roulette actually random');

// ---- paid / verified ----
const pv = app.normalizeItem({ name: 'x', paid: '25.5', verified: 'rook' });
ok(pv.paid === 25.5 && pv.verified === 'rook', 'paid+verified pass through');
ok(app.normalizeItem({ name: 'x', verified: 'hacker' }).verified === '', 'bad verified value rejected');
ok(app.normalizeItem({ name: 'x', paid: -5 }).paid === 0, 'negative paid clamped');

// ---- graded verification tier ----
const gr = app.normalizeItem({ name: 'x', verified: 'graded', grade: 'PCGS MS65 · cert 39284712' });
ok(gr.verified === 'graded' && gr.grade.includes('PCGS MS65'), 'graded tier + details pass through');
ok(app.normalizeItem({ name: 'x', verified: 'graded', grade: 'G'.repeat(200) }).grade.length === 60, 'grade text clamped');
ok(app.normalizeItem({ name: 'x', verified: 'slabbed' }).verified === '', 'unknown tier still rejected');
const gs = [app.normalizeItem({ name: 'slab coin', cat: 'Coins', verified: 'graded', grade: 'NGC MS64' })];
ok(app.filterItems(gs, 'ngc', 'All', 'new').length === 1, 'search by grading service');
ok(app.filterItems(gs, 'MS64', 'All', 'new').length === 1, 'search by grade');

// ---- portfolio time machine ----
const hh = [
  { d: '2026-01-01', v: 50 }, { d: '2026-01-02', v: 80 },
  { d: '2026-01-03', v: 65 }, { d: '2026-01-10', v: 120 }
];
ok(app.historyWindow(hh, '2026-01-02', '2026-01-03').length === 2, 'range window filters');
ok(app.historyWindow(hh, '2026-01-03', '').length === 2, 'from-only window');
ok(app.historyWindow(hh, '', '2026-01-02').length === 2, 'to-only window');
ok(app.historyWindow(hh, '', '').length === 4, 'no window = everything');
ok(app.historyWindow(hh, '2026-02-01', '2026-02-28').length === 0, 'empty window');
const pt = app.historyPoint(hh, '2026-01-02');
ok(pt && pt.v === 80, 'exact-day lookup finds the snapshot');
ok(app.historyPoint(hh, '2026-01-05') === null, 'missing day returns null');
const wst = app.windowStats(app.historyWindow(hh, '2026-01-01', '2026-01-10'));
ok(wst.first === 50 && wst.last === 120, 'window first/last values');
ok(wst.delta === 70, 'window delta, got ' + wst.delta);
ok(wst.min === 50 && wst.max === 120, 'window min/max');

// ---- cert verification links ----
const c1 = app.certLink('PCGS MS65 · cert 39284712');
ok(c1 && c1.grader === 'pcgs' && c1.cert === '39284712', 'PCGS grader+cert parsed: ' + JSON.stringify(c1 && c1.cert));
ok(c1 && c1.deep && c1.url === 'https://www.pcgs.com/cert/39284712', 'PCGS deep-link built');
const c2 = app.certLink('ngc ms62 #1234567-001');
ok(c2 && c2.grader === 'ngc' && c2.cert === '1234567-001', 'NGC dash cert parsed, case-insensitive');
ok(c2 && c2.url === 'https://www.ngccoin.com/certlookup/1234567-001', 'NGC deep-link built');
const c3 = app.certLink('ANACS EF45 cert 4123456');
ok(c3 && c3.grader === 'anacs' && !c3.deep, 'ANACS parsed but lands on verify page');
ok(c3 && c3.url === 'https://anacs.com/verify/', 'ANACS verify page url');
const c4 = app.certLink('ICG MS60 serial 555123');
ok(c4 && c4.grader === 'icg' && c4.cert === '555123' && !c4.deep, 'ICG parsed, form-only lookup');
ok(app.certLink('PCGS MS65') === null, 'grader without cert number -> no link');
ok(app.certLink('MS65 slab') === null, 'grade alone is not a cert number');
ok(app.certLink('') === null, 'empty grade -> no link');
ok(app.certLink('some vague grading') === null, 'unknown grader -> no link');
const c5 = app.certLink('PCGS MS65 cert 39 284 712');
ok(c5 && c5.cert === '39284712', 'spaced cert digits normalize');

// ---- crypto (async tail) ----
(async () => {
  const file = await app.encryptSnapshot({ items: [{ name: 'secret coin' }], cats: [], wishlist: [], sets: [], history: [] }, 'test1234');
  ok(file && file.v === 1 && file.data && file.salt && file.iv, 'snapshot encrypts to structured file');
  ok(!JSON.stringify(file).includes('secret coin'), 'plaintext absent from ciphertext file');
  const back = await app.decryptSnapshot(file, 'test1234');
  ok(back.items[0].name === 'secret coin', 'snapshot decrypt roundtrip');
  let threw = false;
  try{ await app.decryptSnapshot(file, 'wrongpass'); }catch(e){ threw = true; }
  ok(threw, 'wrong passcode cannot decrypt');

  console.log(failed === 0 ? ('ALL PASS: ' + passed + ' assertions') : (failed + ' FAILED, ' + passed + ' passed'));
  process.exit(failed === 0 ? 0 : 1);
})();
