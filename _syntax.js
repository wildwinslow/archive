
'use strict';

/* ---------- pure core (node-testable) ---------- */

const KEY = 'winslow.collections.v1';
const DEFAULT_CATS = ['Coins','World War II','Civil War','Pokémon','Games & Consoles','Weird Objects','Other'];
const SPOT_KEY = 'winslow.spot.v1';

// Fine silver content in troy oz per coin (published melt weights, approx)
const SILVER_PRESETS = [
  { id:'dime90',   label:'90% silver dime (pre-1965)',        oz:0.07234 },
  { id:'qtr90',    label:'90% silver quarter',                oz:0.18084 },
  { id:'half90',   label:'90% silver half dollar',            oz:0.36169 },
  { id:'dollar90', label:'90% silver dollar (Morgan/Peace)',  oz:0.77344 },
  { id:'warNi',    label:'War nickel 1942-45 (35%)',          oz:0.05626 },
  { id:'half40',   label:'40% half dollar 1965-70',           oz:0.14790 }
];

function fmt(n){
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function uid(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2,8);
}

function loadState(){
  try{
    const raw = localStorage.getItem(KEY);
    if(raw){
      const d = JSON.parse(raw);
      return {
        items: Array.isArray(d.items) ? d.items : [],
        wishlist: Array.isArray(d.wishlist) ? d.wishlist : [],
        sets: Array.isArray(d.sets) ? d.sets.map(normalizeSet) : [],
        cats:  Array.isArray(d.cats) && d.cats.length ? d.cats : DEFAULT_CATS.slice(),
        history: Array.isArray(d.history) ? d.history.filter(p => p && typeof p.d === 'string' && typeof p.v === 'number') : []
      };
    }
  }catch(e){ /* corrupted or unavailable storage → start clean */ }
  return { items: [], wishlist: [], sets: [], cats: DEFAULT_CATS.slice(), history: [] };
}

// Merge incoming entries into local list by id.
// New id -> add. Same id -> newer 'updated' wins; older/equal -> local kept.
function mergeItems(local, incoming){
  let added = 0, updated = 0, skipped = 0;
  const byId = new Map(local.map(x => [x.id, x]));
  for(const raw of (incoming || [])){
    const norm = normalizeItem(raw);
    const cur = byId.get(norm.id);
    if(!cur){
      local.push(norm);
      byId.set(norm.id, norm);
      added++;
      continue;
    }
    const curT = cur.updated || cur.created || 0;
    const newT = norm.updated || norm.created || 0;
    if(newT > curT){
      const i = local.indexOf(cur);
      local[i] = norm;
      updated++;
    }else{
      skipped++;
    }
  }
  return { added, updated, skipped };
}

// Year handling: a single year ("1920") or a range ("1915-1925") for when the
// exact date isn't pinned down. 0 = unknown.
function normYear(v){
  const n = parseInt(v, 10);
  return (n >= 1000 && n <= 2100) ? n : 0;
}
function fixYearTo(to, from){
  const f = normYear(from);
  if(!f) return 0;
  const t = normYear(to);
  return (t && t >= f) ? t : f;
}
function parseYearRange(str){
  const m = String(str || '').trim().match(/^(\d{3,4})(?:\s*[-\u2013\u2014]\s*(\d{3,4}))?$/);
  if(!m) return { from: 0, to: 0 };
  let a = parseInt(m[1], 10), b = m[2] ? parseInt(m[2], 10) : a;
  if(a > b){ const t = a; a = b; b = t; }
  if(a < 1000 || b > 2100) return { from: 0, to: 0 };
  return { from: a, to: b };
}
function yearLabel(x){
  if(!x || !x.yearFrom) return '';
  return (x.yearTo && x.yearTo !== x.yearFrom) ? (x.yearFrom + '\u2013' + x.yearTo) : String(x.yearFrom);
}

// Display-only flag prefix; stored value stays plain text.
const COUNTRY_FLAGS = {
  'poland':'\ud83c\uddf5\ud83c\uddf7', 'germany':'\ud83c\udde9\ud83c\uddea',
  'japan':'\ud83c\uddef\ud83c\uddf5', 'sweden':'\ud83c\uddf8\ud83c\uddea',
  'italy':'\ud83c\uddee\ud83c\uddf9', 'france':'\ud83c\uddeb\ud83c\uddf7',
  'united states':'\ud83c\uddfa\ud83c\uddf8', 'united kingdom':'\ud83c\uddec\ud83c\udde7',
  'austria':'\ud83c\udde6\ud83c\uddf9', 'canada':'\ud83c\udde8\ud83c\udde6',
  'netherlands':'\ud83c\uddf3\ud83c\uddf1', 'russia':'\ud83c\uddf7\ud83c\uddfa',
  'spain':'\ud83c\uddea\ud83c\uddf8', 'switzerland':'\ud83c\udde8\ud83c\udded',
  'china':'\ud83c\udde8\ud83c\uddf3', 'mexico':'\ud83c\uddf2\ud83c\uddfd',
  'czechia':'\ud83c\udde8\ud83c\uddef', 'czech republic':'\ud83c\udde8\ud83c\uddef',
  'belgium':'\ud83c\udde7\ud83c\uddea', 'denmark':'\ud83c\udde9\ud83c\uddf0'
};
function flagFor(country){
  return COUNTRY_FLAGS[String(country || '').trim().toLowerCase()] || '';
}

// Parse grader + cert number out of the grade text and build the grader's
// verification link. PCGS/NGC deep-link to the cert (community-documented
// URL shapes; their worst case still lands on the correct verify page).
// ANACS/ICG use form-only lookups, so they land on the verify page.
const CERT_URLS = {
  pcgs: 'https://www.pcgs.com/cert/',
  ngc: 'https://www.ngccoin.com/certlookup/',
  anacs: 'https://anacs.com/verify/',
  icg: 'https://www.icgcoin.com/verification/'
};
function certLink(gradeText){
  const s = String(gradeText || '');
  const low = s.toLowerCase();
  let grader = null;
  if(low.includes('pcgs')) grader = 'pcgs';
  else if(low.includes('ngc')) grader = 'ngc';
  else if(low.includes('anacs')) grader = 'anacs';
  else if(low.includes('icg')) grader = 'icg';
  if(!grader) return null;
  const m = s.match(/\d[\d\s-]{4,}/);
  if(!m) return null;
  const cert = m[0].trim().replace(/\s+/g, '');
  const deep = (grader === 'pcgs' || grader === 'ngc');
  return { grader, cert, deep, url: deep ? CERT_URLS[grader] + cert : CERT_URLS[grader] };
}

/* ---- sets (set-completion tracking) ---- */
function normalizeSetEntry(e){
  return {
    id: e.id || uid(),
    label: String(e.label || '').slice(0, 80),
    year: normYear(e.year),
    owned: !!e.owned
  };
}
function normalizeSet(s){
  return {
    id: s.id || uid(),
    name: String(s.name || 'Untitled set').slice(0, 80),
    desc: String(s.desc || '').slice(0, 200),
    created: s.created || Date.now(),
    entries: Array.isArray(s.entries) ? s.entries.map(normalizeSetEntry) : []
  };
}
function setProgress(set){
  const entries = (set && set.entries) || [];
  const total = entries.length;
  const owned = entries.filter(e => e.owned).length;
  return { owned, total, pct: total ? Math.round(owned / total * 100) : 0 };
}

/* ---- origins map (constellation style, equirectangular) ---- */
const COUNTRY_COORDS = {
  'united states':[39.8,-98.6], 'poland':[52.1,19.4], 'germany':[51.2,10.4],
  'japan':[36.2,138.3], 'sweden':[62.2,15.3], 'italy':[42.8,12.6],
  'france':[46.6,2.4], 'united kingdom':[54.0,-2.5], 'austria':[47.6,14.2],
  'canada':[56.1,-106.3], 'netherlands':[52.2,5.5], 'russia':[61.5,90.0],
  'spain':[40.2,-3.7], 'switzerland':[46.8,8.2], 'china':[35.9,104.2],
  'mexico':[23.6,-102.5], 'czechia':[49.8,15.5], 'czech republic':[49.8,15.5],
  'belgium':[50.6,4.6], 'denmark':[56.0,9.5]
};
function originMap(items, spot){
  const by = {};
  (items || []).forEach(x => {
    const k = String(x.country || '').trim();
    if(!k) return;
    const e = by[k] || (by[k] = { country: k, count: 0, value: 0, lat: null, lng: null });
    e.count += qtyOf(x);
    e.value += worth(x, spot);
    const c = COUNTRY_COORDS[k.toLowerCase()];
    if(c){ e.lat = c[0]; e.lng = c[1]; }
  });
  return Object.values(by).sort((a, b) => b.count - a.count);
}
function mapXY(lat, lng, w, h){
  return [ ((lng + 180) / 360) * w, ((90 - lat) / 180) * h ];
}

/* ---- collection roulette ---- */
function rollItem(list){
  if(!Array.isArray(list) || !list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

/* ---- passcode + encrypted share snapshot (WebCrypto) ---- */
function b64enc(buf){
  const bytes = new Uint8Array(buf);
  let s = '';
  for(let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64dec(str){
  const s = atob(str);
  const bytes = new Uint8Array(s.length);
  for(let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}
async function sha256Hex(text){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function deriveKey(pass, saltBytes){
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: 150000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}
// Full archive state -> passcode-locked snapshot file (the key never leaves the passcode).
async function encryptSnapshot(stateObj, pass){
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt);
  const plain = new TextEncoder().encode(JSON.stringify(stateObj));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  return { v: 1, kdf: 'PBKDF2-150k-SHA256', salt: b64enc(salt), iv: b64enc(iv), data: b64enc(data) };
}
async function decryptSnapshot(file, pass){
  const key = await deriveKey(pass, b64dec(file.salt));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64dec(file.iv) }, key, b64dec(file.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

function normalizeItem(it){
  return {
    id: it.id || uid(),
    name: String(it.name || '').slice(0,140),
    cat: String(it.cat || 'Other').slice(0,40),
    qty: Math.max(1, parseInt(it.qty,10) || 1),
    cond: String(it.cond || '').slice(0,30),
    date: String(it.date || ''),
    value: Math.max(0, parseFloat(it.value) || 0),
    notes: String(it.notes || '').slice(0,2000),
    photo: typeof it.photo === 'string' && it.photo.startsWith('data:image') ? it.photo : null,
    metal: it.metal === 'silver' || it.metal === 'gold' ? it.metal : '',
    fineWt: Math.max(0, Math.min(100000, parseFloat(it.fineWt) || 0)),
    yearFrom: normYear(it.yearFrom),
    yearTo: fixYearTo(it.yearTo, it.yearFrom),
    country: String(it.country || '').trim().slice(0, 40),
    mint: String(it.mint || '').trim().slice(0, 40),
    denom: String(it.denom || '').trim().slice(0, 40),
    paid: Math.max(0, parseFloat(it.paid) || 0),
    verified: it.verified === 'rook' || it.verified === 'user' || it.verified === 'graded' ? it.verified : '',
    grade: String(it.grade || '').trim().slice(0, 60),
    created: it.created || Date.now(),
    updated: Number(it.updated) || Number(it.created) || Date.now()
  };
}

function upsertItem(state, item, list){
  const key = list === 'wishlist' ? 'wishlist' : 'items';
  if(!Array.isArray(state[key])) state[key] = [];
  const norm = normalizeItem(item);
  const i = state[key].findIndex(x => x.id === norm.id);
  if(i >= 0) state[key][i] = norm;
  else state[key].unshift(norm);
  if(norm.cat && !state.cats.includes(norm.cat)) state.cats.push(norm.cat);
  return state;
}

function removeItem(state, id, list){
  const key = list === 'wishlist' ? 'wishlist' : 'items';
  state[key] = (state[key] || []).filter(x => x.id !== id);
  return state;
}

function filterItems(items, query, cat, sort){
  let out = items.slice();
  if(cat && cat !== 'All'){
    out = out.filter(x => x.cat === cat);
  }
  const q = (query || '').trim().toLowerCase();
  if(q){
    // "1920" or "1900-1950" also match by year overlap; everything else is text.
    const ym = q.match(/^(\d{3,4})(?:\s*-\s*(\d{3,4}))?$/);
    out = out.filter(x => {
      const hay = (x.name + ' ' + x.cat + ' ' + x.cond + ' ' + x.notes + ' ' +
                   yearLabel(x) + ' ' + (x.country || '') + ' ' + (x.mint || '') + ' ' +
                   (x.denom || '') + ' ' + (x.grade || '')).toLowerCase();
      if(hay.includes(q)) return true;
      if(ym && x.yearFrom){
        const qa = parseInt(ym[1], 10), qb = ym[2] ? parseInt(ym[2], 10) : qa;
        const ia = x.yearFrom, ib = x.yearTo || x.yearFrom;
        if(ia <= qb && ib >= qa) return true;
      }
      return false;
    });
  }
  if(sort === 'name') out.sort((a,b) => a.name.localeCompare(b.name));
  else if(sort === 'value') out.sort((a,b) => b.value - a.value);
  else if(sort === 'year-asc') out.sort(cmpYearAsc);
  else if(sort === 'year-desc') out.sort(cmpYearDesc);
  else if(sort === 'old') out.sort((a,b) => a.created - b.created);
  else out.sort((a,b) => b.created - a.created);
  return out;
}

// Items without a year always sink to the bottom, both directions.
function cmpYearAsc(a, b){
  if(!a.yearFrom !== !b.yearFrom) return a.yearFrom ? -1 : 1;
  if(a.yearFrom && a.yearFrom !== b.yearFrom) return a.yearFrom - b.yearFrom;
  return a.name.localeCompare(b.name);
}
function cmpYearDesc(a, b){
  if(!a.yearFrom !== !b.yearFrom) return a.yearFrom ? -1 : 1;
  if(a.yearFrom && a.yearFrom !== b.yearFrom) return b.yearFrom - a.yearFrom;
  return a.name.localeCompare(b.name);
}

// Live melt: fine weight (troy oz) x qty x spot price for the metal.
function meltValue(item, spot){
  if(!item || !item.metal || !item.fineWt || !spot) return 0;
  const price = item.metal === 'gold' ? spot.gold : spot.silver;
  if(!price) return 0;
  return (item.qty || 1) * item.fineWt * price;
}

// What this item is worth right now: appraised value or live melt, whichever is higher.
function worth(item, spot){
  return Math.max(item.value || 0, meltValue(item, spot));
}

function stats(state, spot){
  const pieces = state.items.reduce((n,x) => n + qtyOf(x), 0);
  const valued = state.items.filter(x => x.value > 0);
  const total = valued.reduce((s,x) => s + x.value, 0);
  const meltItems = state.items.filter(x => x.metal && x.fineWt > 0);
  const melt = meltItems.reduce((s,x) => s + meltValue(x, spot), 0);
  const portfolio = state.items.reduce((s,x) => s + worth(x, spot), 0);
  const paid = state.items.reduce((s,x) => s + (x.paid || 0), 0);
  return {
    entries: state.items.length, pieces, total, valued: valued.length,
    melt, meltItems: meltItems.length, portfolio, paid
  };
}

function qtyOf(x){ return Math.max(1, parseInt(x.qty,10) || 1); }

// One snapshot per calendar day; same day overwrites (latest wins). Capped.
function recordHistory(state, day, value){
  if(!Array.isArray(state.history)) state.history = [];
  const v = Math.round(value * 100) / 100;
  const last = state.history[state.history.length - 1];
  if(last && last.d === day) last.v = v;
  else state.history.push({ d: day, v });
  while(state.history.length > 400) state.history.shift();
  return state.history;
}

// SVG polyline points for the sparkline, scaled into w x h. '' when <2 points.
function sparkPath(history, w, h){
  if(!Array.isArray(history) || history.length < 2) return '';
  const vs = history.map(p => p.v);
  const min = Math.min.apply(null, vs);
  const max = Math.max.apply(null, vs);
  const range = (max - min) || 1;   // flat line still renders
  return history.map((p, i) => {
    const x = (i / (history.length - 1)) * w;
    const y = h - ((p.v - min) / range) * (h - 4) - 2;   // 2px breathing room
    return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
  }).join(' ');
}

/* ---- portfolio time machine (day + range inspection) ---- */
function historyWindow(history, from, to){
  return (history || []).filter(p =>
    (!from || p.d >= from) && (!to || p.d <= to));
}
function historyPoint(history, day){
  return (history || []).find(p => p.d === day) || null;
}
function windowStats(sel){
  const vals = sel.map(p => p.v);
  const first = vals[0], last = vals[vals.length - 1];
  return {
    first, last,
    delta: Math.round((last - first) * 100) / 100,
    min: Math.min.apply(null, vals),
    max: Math.max.apply(null, vals)
  };
}

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
  ));
}

/* ---------- browser layer ---------- */

let state = loadState();
// Captured at boot, before init()/render() write anything: an empty first
// load must still count as a fresh device for the shared-viewer gate.
let bootEmpty = true;
try{ bootEmpty = !localStorage.getItem(KEY); }catch(e){ bootEmpty = false; }
let editingId = null;
let editingList = 'items'; // which array the open modal edits: 'items' | 'wishlist'
let pendingPhoto = null;   // dataURL staged in the form
let activeCat = 'All';
let spot = null;           // { silver, gold, ts } from live fetch or cache
let view = 'collection';   // 'collection' | 'wishlist' | 'sets' | 'map'
let histFrom = '';         // portfolio window: '' = all time
let histTo = '';

function activeList(){
  if(view === 'wishlist'){
    if(!Array.isArray(state.wishlist)) state.wishlist = [];
    return state.wishlist;
  }
  return state.items;
}

function setView(v){
  if(view === v) return;
  view = v;
  activeCat = 'All';
  render();
}

const $ = id => document.getElementById(id);

function persist(){
  if(viewerMode) return true;
  try{
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  }catch(e){
    alert("Storage is full — export a backup and delete some item photos, then import it back.");
    return false;
  }
}

function renderStats(){
  const s = stats(state, spot);
  $('stats').innerHTML =
    '<div><b>' + s.entries + '</b><span>entries</span></div>' +
    '<div><b>' + s.pieces + '</b><span>total pieces</span></div>' +
    '<div><b>$' + fmt(s.total) + '</b><span>est. value (' + s.valued + ' valued)</span></div>' +
    (s.meltItems
      ? '<div><b>$' + fmt(s.melt) + '</b><span>live melt (' + s.meltItems + ' metal)</span></div>'
      : '') +
    (s.paid > 0
      ? '<div><b style="color:' + (s.portfolio - s.paid >= 0 ? '#8fbf6a' : '#d9553f') + '">$' +
        fmt(Math.abs(s.portfolio - s.paid)) + '</b><span>' +
        (s.portfolio - s.paid >= 0 ? 'gain vs paid' : 'underwater vs paid') + '</span></div>'
      : '') +
    '<div><b>' + state.cats.length + '</b><span>categories</span></div>';
}

function renderSpot(){
  const el = $('spotline');
  if(!spot){
    el.innerHTML = 'spot prices unavailable — will retry when online';
    return;
  }
  const t = new Date(spot.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  el.innerHTML =
    '<b>Silver</b> $' + spot.silver.toFixed(2) + '/oz · <b>Gold</b> $' +
    spot.gold.toLocaleString(undefined,{maximumFractionDigits:2}) + '/oz · updated ' + t;
}

function renderPortfolio(){
  const el = $('portfolio');
  const s = stats(state, spot);
  const h = state.history || [];
  const from = histFrom, to = histTo;
  const spark = sel => '<svg class="spark" viewBox="0 0 300 56" preserveAspectRatio="none" aria-hidden="true">' +
    '<path d="' + sparkPath(sel, 300, 56) + '" fill="none" stroke="#e8a33d" stroke-width="2" vector-effect="non-scaling-stroke"/>' +
    '</svg>';
  const bar =
    '<div class="histbar">' +
      '<input id="histFrom" type="date" value="' + esc(from) + '" aria-label="from date">' +
      '<input id="histTo" type="date" value="' + esc(to) + '" aria-label="to date">' +
      '<button class="chip" id="histClear">all time</button>' +
      '<button class="chip" id="resetHist">reset trend</button>' +
    '</div>';
  // single-day inspection
  if(from && (!to || to === from)){
    const p = historyPoint(h, from);
    if(!p){
      el.innerHTML =
        '<div class="pf-head"><span>snapshot</span><b>—</b></div>' + bar +
        '<div class="pf-hint">no snapshot on ' + esc(from) + '</div>';
      return;
    }
    const idx = h.indexOf(p);
    const prev = idx > 0 ? h[idx - 1] : null;
    const dd = prev ? Math.round((p.v - prev.v) * 100) / 100 : 0;
    el.innerHTML =
      '<div class="pf-head"><span>snapshot · ' + esc(from) + '</span><b>$' + fmt(p.v) + '</b></div>' + bar +
      (prev
        ? '<div class="pf-hint">vs ' + esc(prev.d) + ': ' +
          (dd > 0 ? '▲' : dd < 0 ? '▼' : '·') + ' $' + fmt(Math.abs(dd)) + '</div>'
        : '<div class="pf-hint">first recorded day</div>');
    return;
  }
  // range inspection
  if(from && to){
    const sel = historyWindow(h, from, to);
    if(!sel.length){
      el.innerHTML =
        '<div class="pf-head"><span>' + esc(from) + ' → ' + esc(to) + '</span><b>—</b></div>' + bar +
        '<div class="pf-hint">no snapshots in that window</div>';
      return;
    }
    const w = windowStats(sel);
    const cls = w.delta > 0 ? 'up' : w.delta < 0 ? 'down' : '';
    const arrow = w.delta > 0 ? '▲' : w.delta < 0 ? '▼' : '·';
    el.innerHTML =
      '<div class="pf-head"><span>' + esc(from) + ' → ' + esc(to) +
        ' <span class="pf-delta ' + cls + '">' + arrow + ' $' + fmt(Math.abs(w.delta)) + '</span></span>' +
        '<b>$' + fmt(w.last) + '</b></div>' + bar +
      (sel.length >= 2 ? spark(sel)
        : '<div class="pf-hint">one snapshot in this window: $' + fmt(w.first) + ' on ' + esc(sel[0].d) + '</div>') +
      '<div class="pf-hint">start $' + fmt(w.first) + ' · low $' + fmt(w.min) + ' · high $' + fmt(w.max) +
      ' · ' + sel.length + ' snapshot' + (sel.length === 1 ? '' : 's') + '</div>';
    return;
  }
  // all-time (default)
  if(h.length < 2){
    el.innerHTML =
      '<div class="pf-head"><span>portfolio</span><b>$' + fmt(s.portfolio) + '</b></div>' + bar +
      '<div class="pf-hint">the trend line builds one point per day you open the archive</div>';
    return;
  }
  const first = h[0], last = h[h.length - 1];
  const delta = Math.round((last.v - first.v) * 100) / 100;
  const cls = delta > 0 ? 'up' : delta < 0 ? 'down' : '';
  const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '·';
  const d1 = first.d.slice(5).replace('-', '/');
  el.innerHTML =
    '<div class="pf-head">' +
      '<span>portfolio · since ' + d1 + ' <span class="pf-delta ' + cls + '">' +
        arrow + ' $' + fmt(Math.abs(delta)) + '</span></span>' +
      '<b>$' + fmt(last.v) + '</b>' +
    '</div>' + bar +
    spark(h);
}

// Daily snapshot: record today's portfolio value, persist only if it changed.
function snapshotToday(){
  if(!(state.items || []).length && !(state.wishlist || []).length) return;
  const s = stats(state, spot);
  const day = new Date().toISOString().slice(0, 10);
  const before = JSON.stringify(state.history || []);
  recordHistory(state, day, s.portfolio);
  if(JSON.stringify(state.history) !== before) persist();
}

function renderChips(){
  const list = activeList();
  const counts = {};
  list.forEach(x => { counts[x.cat] = (counts[x.cat]||0) + 1; });
  const cats = ['All'].concat(state.cats.filter(c => counts[c]));
  $('chips').innerHTML = cats.map(c => {
    const n = c === 'All' ? list.length : counts[c];
    return '<div class="chip' + (c === activeCat ? ' on' : '') + '" data-cat="' + esc(c) + '">' +
      esc(c) + '<i>' + n + '</i></div>';
  }).join('');
}

function renderGrid(){
  const list = activeList();
  const rows = filterItems(list, $('search').value, activeCat, $('sort').value);
  const grid = $('grid');
  if(!rows.length){
    const wish = view === 'wishlist';
    grid.innerHTML = '<div class="empty"><b>' +
      (wish ? 'WISHLIST EMPTY' : 'NOTHING LOGGED YET') + '</b>' +
      (list.length
        ? 'No items match that filter. The hoard hides from search.'
        : (wish
          ? 'Nothing wanted yet. The white whales are getting impatient — hit the + button.'
          : 'Hit the + button and start recording the hoard. Coins, pins, questionable purchases — all of it.')) +
      '</div>';
    return;
  }
  grid.innerHTML = rows.map(x => {
    const thumb = x.photo
      ? '<img class="thumb" src="' + x.photo + '" alt="">'
      : '<div class="thumb">' + esc((x.cat || '?').charAt(0).toUpperCase()) + '</div>';
    const tags = [];
    if(x.cat) tags.push('<span class="tag cat">' + esc(x.cat) + '</span>');
    if(x.denom) tags.push('<span class="tag">' + esc(x.denom) + '</span>');
    if(x.yearFrom) tags.push('<span class="tag year">' + esc(yearLabel(x)) + '</span>');
    if(x.country) tags.push('<span class="tag">' + esc((flagFor(x.country) ? flagFor(x.country) + ' ' : '') + x.country) + '</span>');
    if(x.mint) tags.push('<span class="tag">mint: ' + esc(x.mint) + '</span>');
    if(x.paid > 0) tags.push('<span class="tag">paid $' + fmt(x.paid) + '</span>');
    if(x.verified){
      const cl = x.verified === 'graded' ? certLink(x.grade) : null;
      const inner = (x.verified === 'rook' ? '✓ rook' : x.verified === 'user' ? '✓ yours' : '✓ graded') +
        (x.verified === 'graded' && x.grade ? ' · ' + esc(x.grade) : '') + (cl ? ' ↗' : '');
      tags.push(cl
        ? '<a class="tag verify" href="' + esc(cl.url) + '" target="_blank" rel="noopener noreferrer">' + inner + '</a>'
        : '<span class="tag verify">' + inner + '</span>');
    }
    if(x.qty > 1) tags.push('<span class="tag">×' + x.qty + '</span>');
    if(x.cond) tags.push('<span class="tag">' + esc(x.cond) + '</span>');
    if(x.value > 0) tags.push('<span class="tag val">' +
      (view === 'wishlist' ? 'target $' : '$') + fmt(x.value) + '</span>');
    const mv = meltValue(x, spot);
    if(mv > 0) tags.push('<span class="tag melt" title="live melt at spot">melt $' + fmt(mv) + '</span>');
    if(x.date) tags.push('<span class="tag">' + esc(x.date) + '</span>');
    return '<div class="card">' + thumb +
      '<div class="body"><div class="name">' + esc(x.name) + '</div>' +
      '<div class="meta">' + tags.join('') + '</div>' +
      (x.notes ? '<div class="notes">' + esc(x.notes) + '</div>' : '') +
      '</div>' +
      '<div class="acts">' +
        '<button data-edit="' + x.id + '" title="edit">✎</button>' +
        '<button class="del" data-del="' + x.id+'" title="delete">✕</button>' +
      '</div></div>';
  }).join('');
}

/* ---- origins map view ---- */
function renderMapView(grid){
  const rows = originMap(state.items, spot);
  if(!rows.length){
    grid.innerHTML = '<div class="empty"><b>NO ORIGINS YET</b>Give items a country of origin and the world fills in.</div>';
    return;
  }
  const w = 600, h = 300;
  let svg = '<svg viewBox="0 0 600 300" aria-hidden="true">';
  for(let lng = -120; lng <= 120; lng += 60){
    const x = ((lng + 180) / 360) * w;
    svg += '<line x1="' + x + '" y1="0" x2="' + x + '" y2="' + h + '" stroke="#33332a"/>';
  }
  for(let lat = -60; lat <= 60; lat += 30){
    const y = ((90 - lat) / 180) * h;
    svg += '<line x1="0" y1="' + y + '" x2="' + w + '" y2="' + y + '" stroke="#33332a"/>';
  }
  svg += '<line x1="0" y1="150" x2="600" y2="150" stroke="#45443a"/>';
  svg += '<line x1="300" y1="0" x2="300" y2="300" stroke="#45443a"/>';
  rows.forEach(e => {
    if(e.lat === null) return;
    const xy = mapXY(e.lat, e.lng, w, h);
    const r = 5 + Math.min(18, Math.sqrt(e.count) * 5);
    svg += '<circle cx="' + xy[0].toFixed(1) + '" cy="' + xy[1].toFixed(1) + '" r="' + r.toFixed(1) +
      '" fill="#e8a33d" fill-opacity="0.7" stroke="#b87d24"/>';
    svg += '<text x="' + (xy[0] + r + 4).toFixed(1) + '" y="' + (xy[1] + 4).toFixed(1) +
      '" fill="#e8e4d8" font-size="11">' + esc(flagFor(e.country) + ' ' + e.country) + '</text>';
  });
  svg += '</svg>';
  const legend = rows.map(e => '<span class="tag">' +
    esc((flagFor(e.country) ? flagFor(e.country) + ' ' : '') + e.country + ' x' + e.count) + '</span>').join('');
  const mapped = rows.filter(e => e.lat !== null).length;
  grid.innerHTML = '<div class="mapwrap"><div class="pf-head"><span>origins</span><b>' +
    mapped + ' countries mapped</b></div>' + svg + '<div class="maplegend">' + legend + '</div></div>';
}

/* ---- sets view ---- */
function renderSetsView(grid){
  const sets = state.sets || [];
  const addBtn = '<button id="setAddBtn" class="big save" style="width:100%; margin-bottom:12px">+ new set</button>';
  if(!sets.length){
    grid.innerHTML = addBtn + '<div class="empty"><b>NO SETS YET</b>Define a set, list its entries, and the archive starts tracking the gaps.</div>';
    return;
  }
  grid.innerHTML = addBtn + sets.map(s => {
    const p = setProgress(s);
    return '<div class="setcard"><div class="pf-head"><span>' + esc(s.name) + '</span><b>' +
      p.owned + '/' + p.total + ' · ' + p.pct + '%</b></div>' +
      (s.desc ? '<div class="pf-hint">' + esc(s.desc) + '</div>' : '') +
      '<div class="bar"><i style="width:' + p.pct + '%"></i></div>' +
      s.entries.map(e => '<div class="setentry' + (e.owned ? ' done' : '') + '" data-setcheck="' + s.id + '|' + e.id + '">' +
        (e.owned ? '☑ ' : '☐ ') + esc(e.label) + (e.year ? ' · ' + e.year : '') + '</div>').join('') +
      '<div style="margin-top:10px"><button class="chip" data-setedit="' + s.id + '">edit</button> ' +
      '<button class="chip" data-setdel="' + s.id + '">delete</button></div></div>';
  }).join('');
}

/* ---- sets modal ---- */
let editingSetId = null;
function openSetModal(set){
  editingSetId = set ? set.id : null;
  $('setModalTitle').textContent = set ? 'Edit set' : 'New set';
  $('s-name').value = set ? set.name : '';
  $('s-desc').value = set ? (set.desc || '') : '';
  const NL = String.fromCharCode(10);
  $('s-entries').value = set ? set.entries.map(e => e.label + (e.year ? ' | ' + e.year : '')).join(NL) : '';
  $('setDelete').hidden = !set;
  $('setModal').hidden = false;
}
function closeSetModal(){ $('setModal').hidden = true; editingSetId = null; }
function onSetSubmit(e){
  e.preventDefault();
  const name = $('s-name').value.trim();
  if(!name) return;
  const NL = String.fromCharCode(10);
  const lines = $('s-entries').value.split(NL).map(l => l.trim()).filter(Boolean);
  const existing = editingSetId ? (state.sets || []).find(x => x.id === editingSetId) : null;
  const oldOwned = {};
  if(existing) existing.entries.forEach(en => { oldOwned[en.label] = en.owned; });
  const entries = lines.map(line => {
    const parts = line.split('|').map(p => p.trim());
    return normalizeSetEntry({ label: parts[0], year: parts[1] || 0, owned: !!oldOwned[parts[0]] });
  });
  const set = normalizeSet({
    id: editingSetId || uid(), name, desc: $('s-desc').value.trim(),
    created: existing ? existing.created : Date.now(), entries
  });
  if(!Array.isArray(state.sets)) state.sets = [];
  if(existing) state.sets[state.sets.indexOf(existing)] = set;
  else state.sets.unshift(set);
  persist(); render(); closeSetModal();
}
function onSetDelete(){
  if(!editingSetId) return;
  const set = (state.sets || []).find(x => x.id === editingSetId);
  if(set && confirm('Delete the set ' + set.name + '?')){
    state.sets = state.sets.filter(x => x.id !== editingSetId);
    persist(); render(); closeSetModal();
  }
}

/* ---- roulette ---- */
function openRoll(){
  const it = rollItem(activeList());
  const body = $('rollBody');
  if(!it){
    body.innerHTML = '<div class="pf-hint">Nothing to roll in this view yet.</div>';
    $('rollOverlay').hidden = false;
    return;
  }
  const tags = [];
  if(it.cat) tags.push('<span class="tag cat">' + esc(it.cat) + '</span>');
  if(it.denom) tags.push('<span class="tag">' + esc(it.denom) + '</span>');
  if(it.yearFrom) tags.push('<span class="tag year">' + esc(yearLabel(it)) + '</span>');
  if(it.country) tags.push('<span class="tag">' + esc((flagFor(it.country) ? flagFor(it.country) + ' ' : '') + it.country) + '</span>');
  if(it.mint) tags.push('<span class="tag">mint: ' + esc(it.mint) + '</span>');
  if(it.value > 0) tags.push('<span class="tag val">$' + fmt(it.value) + '</span>');
  if(it.verified === 'graded'){
    const rcl = certLink(it.grade);
    const rinner = '✓ graded' + (it.grade ? ' · ' + esc(it.grade) : '') + (rcl ? ' ↗' : '');
    tags.push(rcl
      ? '<a class="tag verify" href="' + esc(rcl.url) + '" target="_blank" rel="noopener noreferrer">' + rinner + '</a>'
      : '<span class="tag verify">' + rinner + '</span>');
  } else if(it.verified){
    tags.push('<span class="tag verify">' + (it.verified === 'rook' ? '✓ rook' : '✓ yours') + '</span>');
  }
  body.innerHTML = (it.photo ? '<img class="rollphoto" src="' + it.photo + '" alt="">' : '') +
    '<div class="name" style="font-size:18px">' + esc(it.name) + '</div>' +
    '<div class="meta">' + tags.join('') + '</div>' +
    (it.notes ? '<div class="notes" style="margin-top:8px">' + esc(it.notes) + '</div>' : '');
  $('rollOverlay').hidden = false;
}

/* ---- passcode lock / share snapshot ---- */
const PASS_KEY = 'winslow.pass.v1';
let locked = false;
let viewerMode = false;
let passMode = null;
let viewerFile = null;

async function getPassRec(){
  try{ return JSON.parse(localStorage.getItem(PASS_KEY) || 'null'); }catch(e){ return null; }
}
function openPass(mode){
  passMode = mode;
  $('passTitle').textContent = mode === 'create' ? 'Create a passcode'
    : mode === 'share' ? 'Encrypt a share snapshot'
    : mode === 'shareview' ? 'Shared archive'
    : 'Enter passcode';
  $('passHint').textContent = mode === 'create'
    ? 'Locks the app into view-only mode. It is also the encryption key for shared snapshots — friends who view the archive enter this same code.'
    : mode === 'share'
    ? 'Your archive is encrypted with this passcode and downloaded as a file. Send the file to Rook to publish; viewers enter this code to decrypt it in their browser.'
    : mode === 'shareview'
    ? 'This collection is encrypted. Enter the passcode Winslow gave you.'
    : 'Enter the passcode to return to edit mode.';
  $('passConfirmRow').hidden = mode !== 'create';
  $('passInput').value = '';
  $('passConfirm').value = '';
  $('passSubmit').textContent = mode === 'share' ? 'Encrypt' : mode === 'create' ? 'Create and lock' : mode === 'shareview' ? 'View' : 'Unlock';
  $('passCancel').hidden = (mode === 'shareview');
  $('passOverlay').hidden = false;
}
function setLocked(v){
  locked = v;
  document.body.classList.toggle('locked', v);
  $('lockBtn').textContent = v ? '🔓 unlock' : '🔒 lock';
  render();
}
async function onPassSubmit(){
  const pass = $('passInput').value;
  if(!pass){ $('passHint').textContent = 'Type something first.'; return; }
  const rec = await getPassRec();
  if(passMode === 'create'){
    if(pass.length < 4){ $('passHint').textContent = 'Use at least 4 characters.'; return; }
    if(pass !== $('passConfirm').value){ $('passHint').textContent = 'The two entries do not match.'; return; }
    const salt = Array.from(crypto.getRandomValues(new Uint8Array(8))).map(b => b.toString(16).padStart(2, '0')).join('');
    const hash = await sha256Hex(salt + pass);
    try{ localStorage.setItem(PASS_KEY, JSON.stringify({ salt, hash })); }catch(e){}
    $('passOverlay').hidden = true;
    setLocked(true);
  } else if(passMode === 'unlock'){
    if(!rec){ $('passOverlay').hidden = true; setLocked(false); return; }
    const hash = await sha256Hex(rec.salt + pass);
    if(hash === rec.hash){ $('passOverlay').hidden = true; setLocked(false); }
    else { $('passHint').textContent = 'Wrong passcode.'; }
  } else if(passMode === 'share'){
    const snap = await encryptSnapshot({
      items: state.items, wishlist: state.wishlist || [], sets: state.sets || [],
      cats: state.cats, history: state.history || []
    }, pass);
    const blob = new Blob([JSON.stringify(snap)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'archive-share.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    $('passOverlay').hidden = true;
    $('mergeStatus').textContent = 'snapshot encrypted + downloaded — send it to Rook to publish';
  } else if(passMode === 'shareview'){
    try{
      const d = await decryptSnapshot(viewerFile, pass);
      state = {
        items: (d.items || []).map(normalizeItem),
        wishlist: (d.wishlist || []).map(normalizeItem),
        sets: (d.sets || []).map(normalizeSet),
        cats: Array.isArray(d.cats) && d.cats.length ? d.cats : DEFAULT_CATS.slice(),
        history: Array.isArray(d.history) ? d.history : []
      };
      viewerMode = true;
      $('passOverlay').hidden = true;
      document.body.classList.add('locked');
      $('lockBtn').style.display = 'none';
      $('shareBtn').style.display = 'none';
      render();
    }catch(e){ $('passHint').textContent = 'Wrong passcode.'; }
  }
}
async function onLockBtn(){
  if(viewerMode) return;
  if(locked){ openPass('unlock'); return; }
  const rec = await getPassRec();
  if(rec) setLocked(true);
  else openPass('create');
}
// Remote viewer bootstrap: no local data + a published share.json = passcode gate.
async function trySharedViewer(){
  if(!bootEmpty) return;
  try{
    const r = await fetch('share.json?ts=' + Date.now());
    if(!r.ok) return;
    viewerFile = await r.json();
    if(!viewerFile || !viewerFile.data) return;
    const banner = document.createElement('div');
    banner.className = 'viewerbanner';
    banner.textContent = '👀 shared archive — read-only';
    document.body.insertBefore(banner, document.body.firstChild);
    openPass('shareview');
  }catch(e){ /* no share file published — plain empty app */ }
}

function renderViewbar(){
  $('viewCollection').classList.toggle('on', view === 'collection');
  $('viewWishlist').classList.toggle('on', view === 'wishlist');
  $('viewSets').classList.toggle('on', view === 'sets');
  $('viewMap').classList.toggle('on', view === 'map');
  $('viewWishlist').textContent = '🎯 wants (' + ((state.wishlist || []).length) + ')';
  $('viewSets').textContent = '📚 sets (' + ((state.sets || []).length) + ')';
}

function render(){
  document.body.dataset.view = view;
  renderViewbar();
  renderStats();
  renderSpot();
  renderPortfolio();
  renderChips();
  renderGrid();
  renderMapView($('panelMap'));
  renderSetsView($('panelSets'));
  $('catList').innerHTML = state.cats.map(c => '<option value="' + esc(c) + '">').join('');
  snapshotToday();
}

/* ---------- metal / melt UI ---------- */

// Mint field only matters for coins: show it when category is empty (might be a
// coin) or mentions coin. One input listener, no surprises on save.
function updateVerifiedUI(){
  $('gradeWrap').hidden = $('f-verified').value !== 'graded';
}

function updateMintUI(){
  const cat = ($('f-cat').value || '').trim();
  const isCoin = (cat === '' || /coin/i.test(cat));
  $('mintWrap').hidden = !isCoin;
  $('denomWrap').hidden = !isCoin;
}

function updateMetalUI(){
  const m = $('f-metal').value;
  $('f-presetWrap').hidden = m !== 'silver';
  $('f-wtWrap').hidden = !m;
  if(!m){
    $('f-weight').value = '';
    $('f-preset').value = '';
  }
}

/* ---------- spot prices ---------- */

async function loadSpot(){
  // instant paint from cache while the network fetch runs
  try{
    const cached = JSON.parse(localStorage.getItem(SPOT_KEY) || 'null');
    if(cached && cached.silver && cached.gold){
      spot = cached;
      renderSpot();
      renderPortfolio();
      renderStats();
      renderGrid();
    }
  }catch(e){ /* no usable cache */ }
  try{
    const [ag, au] = await Promise.all([
      fetch('https://api.gold-api.com/price/XAG').then(r => { if(!r.ok) throw new Error('ag'); return r.json(); }),
      fetch('https://api.gold-api.com/price/XAU').then(r => { if(!r.ok) throw new Error('au'); return r.json(); })
    ]);
    if(!ag.price || !au.price) throw new Error('bad price');
    spot = { silver: ag.price, gold: au.price, ts: Date.now() };
    try{ localStorage.setItem(SPOT_KEY, JSON.stringify(spot)); }catch(e){ /* quota — spot still works this session */ }
    render();
  }catch(e){
    // offline / API down: cached spot (or none) already rendered — nothing to do
  }
}

/* ---------- photo handling ---------- */

function readPhoto(file){
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 900;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => rej(new Error('bad image'));
      img.src = r.result;
    };
    r.onerror = () => rej(new Error('read failed'));
    r.readAsDataURL(file);
  });
}

/* ---------- modal ---------- */

function openModal(item, mode){
  editingList = (mode || view) === 'wishlist' ? 'wishlist' : 'items';
  const wish = editingList === 'wishlist';
  editingId = item ? item.id : null;
  pendingPhoto = item ? item.photo : null;
  $('modalTitle').textContent = wish ? (item ? 'Edit want' : 'Add to wishlist')
                                    : (item ? 'Edit item' : 'Log an item');
  $('valueLabel').textContent = wish ? 'Target price ($)' : 'Est. value ($)';
  $('qtyWrap').hidden = wish;
  $('condDateRow').hidden = wish;
  $('meltWrap').hidden = wish;
  $('paidWrap').hidden = wish;
  $('f-year').value = item ? yearLabel(item) : '';
  $('f-country').value = item ? (item.country || '') : '';
  $('f-mint').value = item ? (item.mint || '') : '';
  $('f-denom').value = item ? (item.denom || '') : '';
  $('f-paid').value = item && item.paid ? item.paid : '';
  $('f-verified').value = item ? (item.verified || '') : '';
  $('f-grade').value = item ? (item.grade || '') : '';
  updateVerifiedUI();
  updateMintUI();
  $('f-name').value = item ? item.name : '';
  $('f-cat').value = item ? item.cat : '';
  $('f-qty').value = item ? item.qty : 1;
  $('f-cond').value = item ? item.cond : '';
  $('f-date').value = item ? item.date : '';
  $('f-value').value = item && item.value ? item.value : '';
  $('f-metal').value = item ? (item.metal || '') : '';
  $('f-weight').value = item && item.fineWt ? item.fineWt : '';
  const match = item && item.metal === 'silver'
    ? SILVER_PRESETS.find(p => Math.abs(p.oz - (item.fineWt || 0)) < 1e-6)
    : null;
  $('f-preset').value = match ? match.id : '';
  updateMetalUI();
  $('f-notes').value = item ? item.notes : '';
  $('f-photo').value = '';
  updatePhotoPreview();
  $('deleteBtn').hidden = !item;
  $('modal').hidden = false;
  setTimeout(() => $('f-name').focus(), 50);
}

function closeModal(){
  $('modal').hidden = true;
  editingId = null;
  pendingPhoto = null;
}

function updatePhotoPreview(){
  const img = $('photoPreview');
  if(pendingPhoto){
    img.src = pendingPhoto;
    img.style.display = 'block';
    $('photoState').textContent = 'Photo attached. Choose a new file to replace it.';
  }else{
    img.style.display = 'none';
    $('photoState').textContent = '';
  }
}

/* ---------- export / import ---------- */

function exportJson(){
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  const d = new Date().toISOString().slice(0,10);
  a.href = URL.createObjectURL(blob);
  a.download = 'collection-backup-' + d + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function importJson(file){
  const r = new FileReader();
  r.onload = () => {
    try{
      const d = JSON.parse(r.result);
      if(!d || !Array.isArray(d.items)) throw new Error('not a backup');
      if(!confirm('Import ' + d.items.length + ' entries? This replaces the current list.')) return;
      state = {
        items: d.items.map(normalizeItem),
        wishlist: Array.isArray(d.wishlist) ? d.wishlist.map(normalizeItem) : [],
        cats: Array.isArray(d.cats) && d.cats.length ? d.cats : DEFAULT_CATS.slice(),
        history: Array.isArray(d.history)
          ? d.history.filter(p => p && typeof p.d === 'string' && typeof p.v === 'number')
          : []
      };
      state.items.forEach(x => { if(x.cat && !state.cats.includes(x.cat)) state.cats.push(x.cat); });
      activeCat = 'All';
      persist();
      render();
    }catch(e){
      alert("That file isn't a valid backup.");
    }
  };
  r.readAsText(file);
}

// Merge a Rook-generated entry file: adds new ids, updates newer ones, keeps local otherwise.
function mergeJson(file){
  const r = new FileReader();
  r.onload = () => {
    try{
      const d = JSON.parse(r.result);
      if(!d || (!Array.isArray(d.items) && !Array.isArray(d.wishlist))) throw new Error('not an entry file');
      const res = mergeItems(state.items, Array.isArray(d.items) ? d.items : []);
      if(!Array.isArray(state.wishlist)) state.wishlist = [];
      const rw = mergeItems(state.wishlist, Array.isArray(d.wishlist) ? d.wishlist : []);
      if(Array.isArray(d.cats)){
        d.cats.forEach(c => { if(c && !state.cats.includes(c)) state.cats.push(c); });
      }
      persist();
      render();
      $('mergeStatus').textContent =
        'merged: ' + (res.added + rw.added) + ' added · ' +
        (res.updated + rw.updated) + ' updated · ' +
        (res.skipped + rw.skipped) + ' kept yours' +
        ((rw.added || rw.updated) ? ' · ' + (rw.added + rw.updated) + ' → wishlist' : '');
    }catch(e){
      $('mergeStatus').textContent = "that file isn't a valid entry file";
    }
  };
  r.readAsText(file);
}

/* ---------- wiring ---------- */

function init(){
  $('fab').addEventListener('click', () => openModal(null, view));
  $('viewCollection').addEventListener('click', () => setView('collection'));
  $('viewWishlist').addEventListener('click', () => setView('wishlist'));
  $('viewSets').addEventListener('click', () => setView('sets'));
  $('viewMap').addEventListener('click', () => setView('map'));
  $('portfolio').addEventListener('click', e => {
    if(e.target.id === 'histClear'){
      histFrom = ''; histTo = '';
      renderPortfolio();
      return;
    }
    if(e.target.id !== 'resetHist') return;
    if(locked || viewerMode) return;
    if(confirm('Wipe the trend line and start fresh?')){
      state.history = [];
      persist();
      render();
    }
  });
  $('portfolio').addEventListener('change', e => {
    if(e.target.id === 'histFrom') histFrom = e.target.value;
    else if(e.target.id === 'histTo') histTo = e.target.value;
    else return;
    if(histFrom && histTo && histFrom > histTo){
      const t = histFrom; histFrom = histTo; histTo = t;
    }
    renderPortfolio();
  });
  $('rollBtn').addEventListener('click', openRoll);
  $('rollClose').addEventListener('click', () => { $('rollOverlay').hidden = true; });
  $('rollAgain').addEventListener('click', openRoll);
  $('rollOverlay').addEventListener('click', e => { if(e.target === $('rollOverlay')) $('rollOverlay').hidden = true; });
  $('lockBtn').addEventListener('click', onLockBtn);
  $('shareBtn').addEventListener('click', () => { if(!viewerMode) openPass('share'); });
  $('passCancel').addEventListener('click', () => { $('passOverlay').hidden = true; });
  $('passSubmit').addEventListener('click', onPassSubmit);
  $('setCancel').addEventListener('click', closeSetModal);
  $('setDelete').addEventListener('click', onSetDelete);
  $('setForm').addEventListener('submit', onSetSubmit);
  $('setModal').addEventListener('click', e => { if(e.target === $('setModal')) closeSetModal(); });
  $('cancelBtn').addEventListener('click', closeModal);
  $('modal').addEventListener('click', e => { if(e.target === $('modal')) closeModal(); });

  $('search').addEventListener('input', renderGrid);
  $('sort').addEventListener('change', renderGrid);

  $('chips').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if(!chip) return;
    activeCat = chip.dataset.cat;
    renderChips();
    renderGrid();
  });

  document.addEventListener('click', e => {
    const sc = e.target.closest('[data-setcheck]');
    if(sc && !locked && !viewerMode){
      const ids = sc.dataset.setcheck.split('|');
      const set = (state.sets || []).find(x => x.id === ids[0]);
      const entry = set && set.entries.find(x => x.id === ids[1]);
      if(entry){ entry.owned = !entry.owned; persist(); render(); }
      return;
    }
    const se = e.target.closest('[data-setedit]');
    if(se && !locked && !viewerMode){
      const set = (state.sets || []).find(x => x.id === se.dataset.setedit);
      if(set) openSetModal(set);
      return;
    }
    const sd = e.target.closest('[data-setdel]');
    if(sd && !locked && !viewerMode){
      const set = (state.sets || []).find(x => x.id === sd.dataset.setdel);
      if(set && confirm('Delete the set ' + set.name + '?')){
        state.sets = state.sets.filter(x => x.id !== sd.dataset.setdel);
        persist(); render();
      }
      return;
    }
    if(e.target.id === 'setAddBtn'){ openSetModal(null); return; }
    const ed = e.target.closest('[data-edit]');
    if(ed){
      const it = activeList().find(x => x.id === ed.dataset.edit);
      if(it) openModal(it, view);
      return;
    }
    const dl = e.target.closest('[data-del]');
    if(dl){
      const it = activeList().find(x => x.id === dl.dataset.del);
      if(it && confirm('Delete "' + it.name + '"? This cannot be undone.')){
        removeItem(state, dl.dataset.del, view);
        persist();
        render();
      }
    }
  });

  $('f-photo').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0];
    if(!f) return;
    try{
      pendingPhoto = await readPhoto(f);
      updatePhotoPreview();
    }catch(err){
      alert("Couldn't read that image — try a different file.");
    }
  });

  $('form').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('f-name').value.trim();
    if(!name) return;
    const cat = $('f-cat').value.trim() || 'Other';
    const yr = parseYearRange($('f-year').value);
    const list = editingList;
    if(!Array.isArray(state[list])) state[list] = [];
    upsertItem(state, {
      id: editingId || uid(),
      name,
      cat,
      qty: $('f-qty').value,
      cond: $('f-cond').value.trim(),
      date: $('f-date').value,
      value: $('f-value').value,
      metal: $('f-metal').value,
      fineWt: $('f-weight').value,
      yearFrom: yr.from,
      yearTo: yr.to,
      country: $('f-country').value,
      mint: $('f-mint').value,
      denom: $('f-denom').value,
      paid: $('f-paid').value,
      verified: $('f-verified').value,
      grade: $('f-grade').value,
      notes: $('f-notes').value,
      photo: pendingPhoto,
      created: editingId
        ? (state[list].find(x => x.id === editingId) || {}).created || Date.now()
        : Date.now(),
      updated: Date.now()
    }, list);
    persist();
    render();
    closeModal();
  });

  $('deleteBtn').addEventListener('click', () => {
    if(!editingId) return;
    const list = editingList;
    const it = (state[list] || []).find(x => x.id === editingId);
    if(it && confirm('Delete "' + it.name + '"? This cannot be undone.')){
      removeItem(state, editingId, list);
      persist();
      render();
      closeModal();
    }
  });

  $('exportBtn').addEventListener('click', exportJson);
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('mergeBtn').addEventListener('click', () => $('mergeFile').click());
  $('mergeFile').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if(f) mergeJson(f);
    e.target.value = '';
  });
  $('importFile').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if(f) importJson(f);
    e.target.value = '';
  });

  // metal/melt controls
  $('f-preset').innerHTML = '<option value="">coin preset…</option>' +
    SILVER_PRESETS.map(p => '<option value="' + p.id + '">' + esc(p.label) + ' · ' + p.oz + ' oz</option>').join('');
  $('f-metal').addEventListener('change', updateMetalUI);
  $('f-cat').addEventListener('input', updateMintUI);
  $('f-verified').addEventListener('change', updateVerifiedUI);
  $('f-preset').addEventListener('change', () => {
    const p = SILVER_PRESETS.find(x => x.id === $('f-preset').value);
    if(p) $('f-weight').value = p.oz;
  });
  $('f-weight').addEventListener('input', () => { $('f-preset').value = ''; });  // manual edit overrides preset

  render();
  loadSpot();   // async: repaints with live silver/gold when it lands
  trySharedViewer(); // remote viewer gate if a published snapshot exists

  // PWA: register service worker (https or localhost only)
  if('serviceWorker' in navigator &&
     (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')){
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline shell unavailable — app still works */ });
  }
}

if(typeof document !== 'undefined' && typeof window !== 'undefined'){
  document.addEventListener('DOMContentLoaded', init);
}

if(typeof module !== 'undefined' && module.exports){
  module.exports = {
    uid, normalizeItem, upsertItem, removeItem, filterItems, stats, esc, DEFAULT_CATS,
    meltValue, worth, recordHistory, sparkPath, SILVER_PRESETS, fmt, qtyOf, mergeItems,
    parseYearRange, yearLabel, normYear, cmpYearAsc, cmpYearDesc, flagFor,
    normalizeSet, normalizeSetEntry, setProgress, originMap, mapXY, rollItem,
    historyWindow, historyPoint, windowStats, certLink,
    encryptSnapshot, decryptSnapshot, sha256Hex
  };
}
