'use strict';
// Règles WSSA : prêt = 2 mains sur les pads (~0,5 s) ; départ = on lève une ou deux mains ; arrêt = les deux mains reviennent sur les pads.
const READY_MS = 500;
const KEY = 'speedstack.v1';
const $ = id => document.getElementById(id);
const fmt = ms => (ms / 1000).toFixed(3);

let db = { solves: [], event: '3-3-3', mode: 'phone', comp: false, sound: true, vol: 0.7, theme: 'arcade', round: { ev: '3-3-3', times: [] } };
const need = () => db.mode === 'tablet2' ? 2 : 1;
const hintIdle = () => need() === 2 ? 'Pose les deux mains sur les pads' : 'Pose un doigt sur le pad';
try { Object.assign(db, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} };

// --- état du chrono ---
let state = 'idle'; // idle | holding | ready | running | done
const down = new Set();
let readyTimer = 0, t0 = 0, raf = 0, wake = null;

function setLight(c) { $('pads').className = c; }
function setHint(t) { $('hint').textContent = t; }

function update() {
  const both = down.size >= need();
  $('padL').classList.toggle('down', down.has('padL'));
  $('padR').classList.toggle('down', down.has('padR'));
  if (state === 'running') { if (both) stop(); return; }
  if (state === 'done') { if (!both) { state = 'idle'; } else return; }
  clearTimeout(readyTimer);
  if (both) {
    state = 'holding'; setLight('red'); setHint('Maintiens…');
    readyTimer = setTimeout(() => { state = 'ready'; setLight('grn'); setHint('Prêt — lève la main !'); buzz(30); sfx.ready(); }, READY_MS);
  } else if (state === 'ready') {
    start();
  } else {
    state = 'idle'; setLight('off'); setHint(hintIdle());
  }
}

function start() {
  if (db.comp && (db.round.ev !== db.event || db.round.times.length >= 3)) db.round = { ev: db.event, times: [] };
  state = 'running'; t0 = performance.now(); setLight('run'); setHint(''); $('time').classList.add('run');
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
  const pb = prevBest === null || ms < prevBest;
  let msg = pb ? '🏆 Nouveau record !' : 'Lève la main pour recommencer', roundDone = false;
  if (db.comp) {
    db.solves[db.solves.length - 1].comp = true;
    db.round.times.push(ms);
    roundDone = db.round.times.length >= 3;
    if (roundDone) msg = '🏁 Manche terminée — meilleur ' + fmt(Math.min(...db.round.times)) + (pb ? ' 🏆' : '');
    else msg = (pb ? '🏆 Record ! ' : '') + 'Essai ' + db.round.times.length + '/3 — lève la main pour le suivant';
  }
  save(); buzz([60, 40, 60]);
  setLight(pb ? 'pb' : 'done'); setHint(msg);
  if (pb) sfx.record(); else if (roundDone) sfx.round(); else sfx.stop();
  if (pb && roundDone) setTimeout(sfx.round, 700);
  renderRound(); releaseWake();
}

// --- sons (Web Audio, aucun fichier) ---
let actx = null;
function tone(freq, dur = 0.12, type = 'sine', gain = 0.25, delay = 0) {
  if (!db.sound || db.vol <= 0) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const t = actx.currentTime + delay, o = actx.createOscillator(), g = actx.createGain(), v = gain * db.vol * db.vol * 1.6;
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(v, 0.0002), t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
  } catch (e) {}
}
const bell = (f, dur, gain, delay = 0) => { tone(f, dur, 'sine', gain, delay); tone(f * 2.76, dur * 0.5, 'sine', gain * 0.4, delay); };
const seq = (notes, step, fn) => notes.forEach((f, i) => fn(f, i * step));
const THEMES = {
  arcade: {
    ready() { tone(880, 0.15, 'square', 0.15); },
    stop() { tone(330, 0.18, 'triangle', 0.35); },
    record() { seq([523, 659, 784, 1047], 0.09, (f, d) => tone(f, 0.12, 'square', 0.14, d)); },
    round() { seq([392, 523, 659, 784, 1047], 0.1, (f, d) => tone(f, 0.16, 'square', 0.14, d)); },
  },
  doux: {
    ready() { tone(660, 0.2, 'sine', 0.3); },
    stop() { tone(330, 0.25, 'sine', 0.4); },
    record() { seq([523, 659, 784, 1047], 0.11, (f, d) => tone(f, 0.22, 'triangle', 0.3, d)); },
    round() { seq([392, 523, 659, 784, 1047], 0.12, (f, d) => tone(f, 0.26, 'sine', 0.3, d)); },
  },
  cloche: {
    ready() { bell(988, 0.5, 0.3); },
    stop() { bell(523, 0.7, 0.35); },
    record() { seq([659, 880, 1175], 0.16, (f, d) => bell(f, 0.8, 0.3, d)); },
    round() { seq([523, 659, 784, 1047], 0.18, (f, d) => bell(f, 0.9, 0.3, d)); },
  },
  chrono: { // bips secs façon chronomètre de sport
    ready() { tone(2000, 0.09, 'square', 0.12); },
    stop() { tone(1500, 0.25, 'square', 0.12); },
    record() { [0, 0.14, 0.28].forEach(d => tone(2000, 0.09, 'square', 0.12, d)); },
    round() { [0, 0.14, 0.28, 0.42].forEach((d, i) => tone(i === 3 ? 2600 : 2000, i === 3 ? 0.3 : 0.09, 'square', 0.12, d)); },
  },
};
const sfx = {
  ready: () => THEMES[db.theme].ready(), stop: () => THEMES[db.theme].stop(),
  record: () => THEMES[db.theme].record(), round: () => THEMES[db.theme].round(),
};
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
  if (db.comp) {
    const r = db.round.ev === db.event ? db.round.times : [];
    const n = r.length >= 3 ? 3 : r.length + 1;
    const slots = [0, 1, 2].map(i => r[i] !== undefined ? fmt(r[i]) : '—').join(' · ');
    $('round').textContent = (r.length >= 3 ? 'Manche terminée' : 'Essai ' + n + '/3') + '  |  ' + slots + (r.length ? '  |  Meilleur : ' + fmt(Math.min(...r)) : '');
    return;
  }
  const t = times(db.event).slice(-3);
  $('round').textContent = t.length ? 'Derniers : ' + t.map(fmt).join(' · ') + '  |  Meilleur : ' + fmt(Math.min(...t)) : 'Aucun temps pour cette épreuve';
}

function renderStats() {
  const evs = ['3-3-3', '3-6-3', 'Cycle'];
  $('records').innerHTML = evs.map(ev => {
    const t = times(ev), b = best(ev);
    const a5 = t.length >= 5 ? fmt(trimmed(t.slice(-5))) : '—';
    const a12 = t.length >= 12 ? fmt(trimmed(t.slice(-12))) : '—';
    return `<div class="rec" data-ev="${ev}"><b>${ev}</b><span class="v">${b === null ? '—' : fmt(b)}</span>
      <small>${t.length} essai(s) · moy. 5 : ${a5} · moy. 12 : ${a12}</small><small></small></div>`;
  }).join('');
  $('hist-event').textContent = db.event;
  const list = db.solves.map((s, i) => ({ ...s, i })).filter(s => s.ev === db.event).reverse();
  const b = best(db.event);
  $('history').innerHTML = list.length ? list.map(s =>
    `<li><span class="${s.ms === b ? 'pb' : ''}">${fmt(s.ms)}${s.ms === b ? ' 🏆' : ''}${s.comp ? ' 🏁' : ''}</span>
     <span>${new Date(s.at).toLocaleDateString('fr-CA')}<span class="del" data-i="${s.i}">✕</span></span></li>`).join('')
    : '<li>Aucun temps</li>';
}

// --- UI ---
function tab(name) {
  for (const n of ['timer', 'stats', 'opts']) { $('view-' + n).hidden = name !== n; $('tab-' + n).classList.toggle('on', name === n); }
  if (name === 'stats') renderStats();
}
$('tab-timer').onclick = () => tab('timer');
$('tab-stats').onclick = () => tab('stats');
$('tab-opts').onclick = () => tab('opts');
$('event').value = db.event;
$('event').onchange = e => { db.event = e.target.value; db.round = { ev: db.event, times: [] }; save(); renderRound(); $('time').textContent = '0.000'; if (!$('view-stats').hidden) renderStats(); };
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
function applyToggles() {
  $('comp').classList.toggle('on', db.comp); $('comp').setAttribute('aria-pressed', db.comp);
  $('o-sound').checked = db.sound; $('o-vol').value = Math.round(db.vol * 100); $('o-vol-v').textContent = Math.round(db.vol * 100);
  $('o-theme').value = db.theme; $('o-vol').disabled = $('o-theme').disabled = $('o-test').disabled = !db.sound;
}
$('comp').onclick = () => { db.comp = !db.comp; db.round = { ev: db.event, times: [] }; save(); applyToggles(); renderRound(); };
$('o-sound').onchange = e => { db.sound = e.target.checked; save(); applyToggles(); sfx.ready(); };
$('o-vol').oninput = e => { db.vol = e.target.value / 100; $('o-vol-v').textContent = e.target.value; };
$('o-vol').onchange = () => { save(); sfx.ready(); };
$('o-theme').onchange = e => { db.theme = e.target.value; save(); sfx.ready(); };
$('o-test').onclick = () => { sfx.ready(); setTimeout(sfx.stop, 600); setTimeout(sfx.record, 1200); setTimeout(sfx.round, 2400); };
function applyMode() {
  $('mode').value = db.mode;
  $('padR').hidden = need() === 1;
  down.clear(); clearTimeout(readyTimer); state = 'idle';
  $('padL').classList.remove('down'); $('padR').classList.remove('down');
  setLight('off'); setHint(hintIdle());
}
$('mode').onchange = e => { db.mode = e.target.value; save(); applyMode(); };
applyMode(); applyToggles(); renderRound();
try { screen.orientation.lock('landscape').catch(() => {}); } catch (e) {}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
