'use strict';
// Règles WSSA : prêt = 2 mains sur les pads (~0,5 s) ; départ = on lève une ou deux mains ; arrêt = les deux mains reviennent sur les pads.
const READY_MS = 500;
const KEY = 'speedstack.v1';
const $ = id => document.getElementById(id);
const fmt = ms => (ms / 1000).toFixed(3);

let db = { solves: [], event: '3-3-3' };
try { Object.assign(db, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} };

// --- état du chrono ---
let state = 'idle'; // idle | holding | ready | running | done
const down = new Set();
let readyTimer = 0, t0 = 0, raf = 0, wake = null;

function setLight(c) { $('light').className = c; }
function setHint(t) { $('hint').textContent = t; }

function update() {
  const both = down.size === 2;
  $('padL').classList.toggle('down', down.has('padL'));
  $('padR').classList.toggle('down', down.has('padR'));
  if (state === 'running') { if (both) stop(); return; }
  if (state === 'done') { if (!both) { state = 'idle'; } else return; }
  clearTimeout(readyTimer);
  if (both) {
    state = 'holding'; setLight('red'); setHint('Maintiens…');
    readyTimer = setTimeout(() => { state = 'ready'; setLight('grn'); setHint('Prêt — lève les mains !'); buzz(30); }, READY_MS);
  } else if (state === 'ready') {
    start();
  } else {
    state = 'idle'; setLight('off'); setHint('Pose les deux mains sur les pads');
  }
}

function start() {
  state = 'running'; t0 = performance.now(); setLight('off'); setHint(''); $('time').classList.add('run');
  requestWake();
  const tick = () => { $('time').textContent = fmt(performance.now() - t0); raf = requestAnimationFrame(tick); };
  tick();
}

function stop() {
  const ms = Math.round(performance.now() - t0);
  cancelAnimationFrame(raf); state = 'done';
  $('time').classList.remove('run'); $('time').textContent = fmt(ms);
  const prevBest = best(db.event);
  db.solves.push({ ev: db.event, ms, at: Date.now() });
  save(); buzz([60, 40, 60]);
  const pb = prevBest === null || ms < prevBest;
  setLight('off'); setHint(pb ? '🏆 Nouveau record !' : 'Lève les mains pour recommencer');
  renderRound(); releaseWake();
}

const buzz = p => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };
async function requestWake() { try { wake = await navigator.wakeLock.request('screen'); } catch (e) {} }
function releaseWake() { try { wake && wake.release(); wake = null; } catch (e) {} }

// --- stats ---
const times = ev => db.solves.filter(s => s.ev === ev).map(s => s.ms);
const best = ev => { const t = times(ev); return t.length ? Math.min(...t) : null; };
// Moyenne de n derniers sans meilleur ni pire (n>=5), sinon moyenne simple
function avg(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function trimmed(arr) { const s = [...arr].sort((a, b) => a - b); return avg(s.slice(1, -1)); }
function bestOfRound(ev) { // "meilleur de 3" comme en compétition : on regarde les 3 derniers
  const t = times(ev).slice(-3); return t.length ? Math.min(...t) : null;
}
function renderRound() {
  const t = times(db.event).slice(-3);
  $('round').textContent = t.length ? 'Derniers : ' + t.map(fmt).join(' · ') + '  |  Meilleur : ' + fmt(Math.min(...t)) : 'Aucun temps pour cette épreuve';
}

function renderStats() {
  const evs = ['3-3-3', '3-6-3', 'Cycle'];
  $('records').innerHTML = evs.map(ev => {
    const t = times(ev), b = best(ev);
    const a5 = t.length >= 5 ? fmt(trimmed(t.slice(-5))) : '—';
    const a12 = t.length >= 12 ? fmt(trimmed(t.slice(-12))) : '—';
    return `<div class="rec"><b>${ev}</b><span class="v">${b === null ? '—' : fmt(b)}</span>
      <small>${t.length} essai(s) · moy. 5 : ${a5} · moy. 12 : ${a12}</small><small></small></div>`;
  }).join('');
  $('hist-event').textContent = db.event;
  const list = db.solves.map((s, i) => ({ ...s, i })).filter(s => s.ev === db.event).reverse();
  const b = best(db.event);
  $('history').innerHTML = list.length ? list.map(s =>
    `<li><span class="${s.ms === b ? 'pb' : ''}">${fmt(s.ms)}${s.ms === b ? ' 🏆' : ''}</span>
     <span>${new Date(s.at).toLocaleDateString('fr-CA')}<span class="del" data-i="${s.i}">✕</span></span></li>`).join('')
    : '<li>Aucun temps</li>';
}

// --- UI ---
function tab(name) {
  $('view-timer').hidden = name !== 'timer'; $('view-stats').hidden = name !== 'stats';
  $('tab-timer').classList.toggle('on', name === 'timer'); $('tab-stats').classList.toggle('on', name === 'stats');
  if (name === 'stats') renderStats();
}
$('tab-timer').onclick = () => tab('timer');
$('tab-stats').onclick = () => tab('stats');
$('event').value = db.event;
$('event').onchange = e => { db.event = e.target.value; save(); renderRound(); $('time').textContent = '0.000'; if (!$('view-stats').hidden) renderStats(); };
$('history').onclick = e => {
  const i = e.target.dataset && e.target.dataset.i;
  if (i !== undefined && confirm('Supprimer ce temps ?')) { db.solves.splice(+i, 1); save(); renderStats(); }
};
$('clear').onclick = () => { if (confirm('Effacer tous les temps ?')) { db.solves = []; save(); renderStats(); renderRound(); } };
$('export').onclick = () => {
  const csv = 'epreuve,temps_s,date\n' + db.solves.map(s => `${s.ev},${fmt(s.ms)},${new Date(s.at).toISOString()}`).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'speedstack.csv'; a.click();
};

// Chaque pad suit son propre pointeur (multi-touch)
for (const id of ['padL', 'padR']) {
  const el = $(id);
  el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture(e.pointerId); down.add(id); update(); });
  const up = e => { if (down.delete(id)) update(); };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}
document.addEventListener('contextmenu', e => e.preventDefault());
renderRound(); setLight('off');
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
