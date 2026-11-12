'use strict';
/* Reagentro engine. All chemistry lives in data/*.json; this file only knows cards, slots, and rules. */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isDesktop = !!window.desktop;

let G, S, R; // game data, save file, current run

/* ---------------- Save ---------------- */
const SAVE_KEY = 'reagentro-save-v1';
const DEFAULT_SAVE = () => ({
  started: false, difficulty: 'normal', coins: 0,
  powers: ['hint', 'eliminate'], upgrades: { maxHeart: 0, powerSlot: 0 },
  owned: ['back-classic', 'table-felt', 'finish-plain'], equipped: { back: 'back-classic', table: 'table-felt', finish: 'finish-plain' },
  levels: {}, bosses: {}, seen: {}, missed: {}, sectionMisses: {}, prologueSeen: {},
  settings: { music: 0.5, sfx: 0.7, mute: false, textSize: 1, reduceMotion: false, readAloud: false, fullscreen: true, song: 'auto' }
});
function loadSave() {
  const d = DEFAULT_SAVE();
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s) return { ...d, ...s, settings: { ...d.settings, ...s.settings }, upgrades: { ...d.upgrades, ...s.upgrades }, equipped: { ...d.equipped, ...s.equipped }, owned: [...new Set([...d.owned, ...(s.owned || [])])] };
  } catch { /* corrupt or blocked storage: start fresh */ }
  return d;
}
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch { toast('Could not save progress!', 'bad'); } }

/* ---------------- Helpers ---------------- */
const SPRITES = {
  heart: { rows: ['.rr.rr.', 'rrrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...'], pal: { r: '#ff4d6d' } },
  heartEmpty: { rows: ['.rr.rr.', 'r..r..r', 'r.....r', '.r...r.', '..r.r..', '...r...'], pal: { r: '#6b3a4a' } },
  coin: { rows: ['..yyy..', '.yyyyy.', 'yyyoyyy', 'yyyoyyy', 'yyyoyyy', '.yyyyy.', '..yyy..'], pal: { y: '#ffd23f', o: '#c79100' } },
  shield: { rows: ['sssssss', 'swwwwws', 'swwwwws', 'swwwwws', '.swwws.', '..sws..', '...s...'], pal: { s: '#7fd6ff', w: '#2a6f97' } }
};
function sprite(rows, pal, px = 4, cls = '') {
  const w = rows[0].length, hgt = rows.length;
  let r = '';
  rows.forEach((row, y) => [...row].forEach((c, x) => { if (pal[c]) r += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${pal[c]}"/>`; }));
  return `<svg class="sprite ${cls}" viewBox="0 0 ${w} ${hgt}" width="${w * px}" height="${hgt * px}" shape-rendering="crispEdges">${r}</svg>`;
}
const icon = (name, px = 4) => sprite(SPRITES[name].rows, SPRITES[name].pal, px);

const drawers = {};
function drawSmiles(el) {
  const w = Math.max(60, el.clientWidth || 120), h = Math.max(50, el.clientHeight || 90);
  const key = w + 'x' + h;
  drawers[key] = drawers[key] || new SmilesDrawer.SvgDrawer({ width: w, height: h, bondThickness: 1.4, padding: 8, compactDrawing: false, fontSizeLarge: 8, fontSizeSmall: 5 });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.innerHTML = ''; el.appendChild(svg);
  SmilesDrawer.parse(el.dataset.smiles, tree => drawers[key].draw(tree, svg, 'light'), () => { el.textContent = el.dataset.smiles; });
}
const drawAllSmiles = (root = document) => $$('[data-smiles]', root).forEach(drawSmiles);

function toast(text, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.innerHTML = text;
  $('#toasts').appendChild(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3100);
}
const speak = text => Sound.speak(text, S.settings.readAloud);
const sfx = name => Sound.sfx(name);
const sourceLine = (ch, sec) => sec ? `Source: ${sec} ${ch.sections[sec] || ''}` : '';
const stars = n => '★'.repeat(n) + '☆'.repeat(3 - n);
const levelKey = (ch, id) => `${ch.id}/${id}`;
const powerDef = id => G.powers[id] || G.chapters.map(c => c.boss.legendary).find(l => l.id === id);
const maxPowerSlots = () => G.basePowerSlots + S.upgrades.powerSlot;

function cardDef(ch, id) { return ch.cards[id] || { type: 'concept', name: id, art: '?', desc: '' }; }
function cardHTML(ch, id, { uid = '', cls = '', mystery = false } = {}) {
  let c = cardDef(ch, id);
  // A drawn structure's name would give away "which structure is X?" problems, so it stays hidden in the hand.
  if (mystery && c.smiles) { c = { ...c, name: 'Structure' }; cls += ' mystery'; }
  const art = c.smiles
    ? `<div class="art mol" data-smiles="${esc(c.smiles)}"></div>`
    : `<div class="art glyph" style="--len:${[...(c.art || c.name)].length}">${esc(c.art || c.name)}</div>`;
  return `<div class="card t-${c.type} ${cls}" data-uid="${uid}" data-id="${esc(id)}" data-ch="${ch.id}">
    <div class="card-name">${esc(c.name)}</div>${art}<div class="card-type">${esc(c.type)}</div></div>`;
}
function powerHTML(id, i) {
  const p = powerDef(id);
  return `<div class="power r-${p.rarity}" data-i="${i}" data-power="${id}"><div class="p-name">${esc(p.name)}</div><div class="p-rar">${p.rarity}</div></div>`;
}
function portrait(who, ch, px = 6) {
  if (who === 'boss') return sprite(ch.boss.portrait, ch.boss.palette, px, 'portrait');
  if (who === 'npc') return sprite(ch.npc.portrait, ch.npc.palette, px, 'portrait');
  return '';
}

/* ---------------- Tooltip ---------------- */
function bindTips(root) {
  $$('.card[data-id], .power[data-power]', root).forEach(el => {
    el.addEventListener('pointerenter', () => {
      if (el.classList.contains('dragging')) return;
      let title, sub, desc;
      if (el.dataset.power) { const p = powerDef(el.dataset.power); title = p.name; sub = p.rarity + ' power'; desc = p.desc; }
      else if (el.classList.contains('mystery')) { title = 'Mystery structure'; sub = 'structure card'; desc = 'Read the drawing: count the carbons (line ends and corners), the double and triple bonds, and any atoms that are written out.'; }
      else { const ch = G.chapters.find(c => c.id === el.dataset.ch); const c = cardDef(ch, el.dataset.id); title = c.name; sub = c.type + ' card'; desc = c.desc; }
      const tip = $('#tip');
      tip.innerHTML = `<b>${esc(title)}</b><i>${esc(sub)}</i><p>${esc(desc)}</p>`;
      tip.classList.remove('hidden');
      const r = el.getBoundingClientRect(), tr = tip.getBoundingClientRect();
      let top = r.top - tr.height - 12; if (top < 8) top = r.bottom + 12;
      tip.style.left = clamp(r.left + r.width / 2 - tr.width / 2, 8, innerWidth - tr.width - 8) + 'px';
      tip.style.top = top + 'px';
    });
    el.addEventListener('pointerleave', hideTip);
  });
}
const hideTip = () => $('#tip').classList.add('hidden');

/* ---------------- Settings / cosmetics ---------------- */
function applySettings() {
  const s = S.settings;
  document.documentElement.style.setProperty('--ts', s.textSize);
  document.body.classList.toggle('reduce-motion', s.reduceMotion);
  Sound.setVolumes({ music: s.music, sfx: s.sfx, mute: s.mute });
  $('#table').style.background = G.cosmetics[S.equipped.table].css;
  document.documentElement.style.setProperty('--card-back', G.cosmetics[S.equipped.back].css);
  document.body.dataset.finish = G.cosmetics[S.equipped.finish]?.fx || '';
  if (isDesktop) window.desktop.setFullscreen(s.fullscreen);
}
/* ---------------- Music ---------------- */
// Song ids: 'auto' (chapter theme on its floor, lobby cycle elsewhere), 'lobby:<i>', or a chapter id.
const unlockedSongs = () => [
  ...Sound.LOBBY.map((sg, i) => ['lobby:' + i, `Lobby: ${sg.name}`, sg]),
  ...G.chapters.filter((ch, i) => ch.music && chapterUnlocked(i)).map(ch => [ch.id, `Floor ${ch.number}: ${ch.music.name}`, ch.music]),
  ...(G.bossMusic && (S.unlockAll || Object.keys(S.bosses).length) ? [['boss', `Boss: ${G.bossMusic.name}`, G.bossMusic]] : [])
];
let musicCh = null, musicBoss = false;
function playMusic(ch, boss = false) {
  musicCh = ch; musicBoss = boss;
  const pick = unlockedSongs().find(([id]) => id === S.settings.song);
  Sound.setSong(pick ? pick[2] : boss ? ch.boss.music || G.bossMusic : ch?.music || null);
}

function showSettings() {
  const s = S.settings;
  const ov = $('#overlay');
  ov.innerHTML = `<div class="panel settings"><h2>Settings</h2>
    <label>Difficulty <select id="st-diff">${['study', 'normal', 'exam'].map(d => `<option value="${d}" ${S.difficulty === d ? 'selected' : ''}>${d[0].toUpperCase() + d.slice(1)}</option>`).join('')}</select></label>
    <label>Music <input id="st-music" type="range" min="0" max="1" step="0.05" value="${s.music}"></label>
    <label>Song <select id="st-song"><option value="auto">Auto: each floor's theme</option>${unlockedSongs().map(([id, n]) => `<option value="${id}" ${s.song === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
    <label>Sound FX <input id="st-sfx" type="range" min="0" max="1" step="0.05" value="${s.sfx}"></label>
    <label><input id="st-mute" type="checkbox" ${s.mute ? 'checked' : ''}> Mute everything</label>
    <label>Text size <select id="st-ts">${[[0.85, 'Small'], [1, 'Medium'], [1.2, 'Large'], [1.4, 'Extra large']].map(([v, n]) => `<option value="${v}" ${s.textSize == v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <label><input id="st-rm" type="checkbox" ${s.reduceMotion ? 'checked' : ''}> Reduce motion (no shake, wobble, or flicker)</label>
    <label><input id="st-ra" type="checkbox" ${s.readAloud ? 'checked' : ''}> Read dialogue and explanations aloud</label>
    ${isDesktop ? `<label><input id="st-fs" type="checkbox" ${s.fullscreen ? 'checked' : ''}> Fullscreen (F11)</label>` : ''}
    <p class="small">Difficulty changes apply from the next level. Study: unlimited hearts. Normal: 3 hearts. Exam: 2 hearts, no hints, explanations after the level.</p>
    <div class="row"><button id="st-close" class="btn">Close</button><button id="st-title" class="btn alt">Quit to Title</button>${isDesktop ? '<button id="st-quit" class="btn alt">Quit Game</button>' : ''}</div></div>`;
  ov.classList.add('show');
  const upd = () => {
    S.difficulty = $('#st-diff').value;
    Object.assign(s, { music: +$('#st-music').value, sfx: +$('#st-sfx').value, mute: $('#st-mute').checked, textSize: +$('#st-ts').value, reduceMotion: $('#st-rm').checked, readAloud: $('#st-ra').checked, song: $('#st-song').value });
    playMusic(musicCh, musicBoss);
    if ($('#st-fs')) s.fullscreen = $('#st-fs').checked;
    applySettings(); save();
  };
  $$('input,select', ov).forEach(i => i.addEventListener('change', upd));
  $('#st-music').addEventListener('input', upd); $('#st-sfx').addEventListener('input', upd);
  $('#st-close').onclick = closeOverlay;
  $('#st-title').onclick = () => { closeOverlay(); R = null; showTitle(); };
  if ($('#st-quit')) $('#st-quit').onclick = () => window.desktop.quit();
}
function closeOverlay() { const ov = $('#overlay'); ov.classList.remove('show'); ov.innerHTML = ''; }

/* ---------------- Screens ---------------- */
function screen(html, cls = '') {
  hideTip(); speak('');
  app().innerHTML = `<div class="screen ${cls}">${html}</div>`;
  drawAllSmiles(app());
  bindTips(app());
  return app().firstElementChild;
}
const app = () => $('#app');
const btn = (id, label, cls = '') => `<button class="btn ${cls}" id="${id}">${label}</button>`;
const coinBadge = () => `<span class="coins">${icon('coin', 3)} ${S.coins}</span>`;

function showTitle() {
  playMusic(null);
  screen(`<div class="title-wrap"><h1 class="logo">REAGENTRO</h1><p class="tag">Climb the Alchemist's Tower. Learn the WHY.</p>
    <div class="menu">${S.started ? btn('t-cont', 'Continue') : ''}${btn('t-new', 'New Game')}${btn('t-codex', 'Card Codex', 'alt')}${btn('t-review', 'Review & Stats', 'alt')}${btn('t-set', 'Settings', 'alt')}${btn('t-cred', 'Credits', 'alt')}${isDesktop ? btn('t-quit', 'Quit', 'alt') : ''}</div>
    <form class="code-box" id="t-code"><input id="t-code-in" placeholder="Code" maxlength="20" autocomplete="off" aria-label="Code"><button class="btn alt">Enter</button></form>
    <p class="foot">Chemistry content adapted from OpenStax <i>Organic Chemistry</i> · CC BY-NC-SA 4.0 · Free and non-commercial</p></div>`, 'title');
  $('#t-code').onsubmit = e => { e.preventDefault(); enterCode($('#t-code-in').value); };
  if ($('#t-cont')) $('#t-cont').onclick = showTower;
  $('#t-new').onclick = () => { if (S.started && !confirm('Start over? This erases all progress.')) return; const st = S.settings; S = DEFAULT_SAVE(); S.settings = st; save(); showDifficulty(); };
  $('#t-codex').onclick = () => showCodex();
  $('#t-review').onclick = showReview;
  $('#t-set').onclick = showSettings;
  $('#t-cred').onclick = showCredits;
  if ($('#t-quit')) $('#t-quit').onclick = () => window.desktop.quit();
}

// Tester cheat: unlocks every floor/level/song, all cosmetics, maxed upgrades, full powers, the whole codex, and lots of coins.
// Levels are unlocked (S.unlockAll), not marked cleared, so stars and stats stay real. New Game removes it.
function enterCode(code) {
  if (code.trim() !== 'Olaf') { sfx('wrong'); return toast('Nothing happens…', 'bad'); }
  S.unlockAll = true; S.started = true;
  S.coins = 999999;
  S.owned = Object.keys(G.cosmetics);
  for (const id in G.upgrades) S.upgrades[id] = G.upgrades[id].max;
  S.powers = [...G.chapters.map(c => c.boss.legendary.id), ...Object.keys(G.powers)].slice(0, maxPowerSlots());
  G.chapters.forEach(ch => Object.keys(ch.cards).forEach(id => { S.seen[`${ch.id}/${id}`] = true; }));
  save(); sfx('win'); toast('Code accepted: everything unlocked!', 'good'); showTitle();
}

function showDifficulty() {
  const modes = [
    ['study', 'Study', 'Unlimited hearts. Learn at your own pace.'],
    ['normal', 'Normal', '3 hearts per level. The way it\'s meant to be played.'],
    ['exam', 'Exam', '2 hearts, no hints, and explanations only after each level.']
  ];
  screen(`<h2 class="h">Choose a difficulty</h2><div class="modes">${modes.map(([id, n, d]) => `<button class="mode" data-m="${id}"><b>${n}</b><span>${d}</span></button>`).join('')}</div><p class="small center">No timers, ever. You can change this later in Settings.</p>`, 'diff');
  $$('.mode').forEach(b => b.onclick = () => { S.difficulty = b.dataset.m; S.started = true; save(); sfx('click'); showTower(); });
}

function chapterUnlocked(i) { return i === 0 || !!S.unlockAll || !!S.bosses[G.chapters[i - 1].id]; }
function showTower() {
  playMusic(null);
  const floors = G.chapters.map((ch, i) => {
    const ok = chapterUnlocked(i), done = S.bosses[ch.id];
    return `<button class="floor ${ok ? '' : 'locked'} ${done ? 'done' : ''}" data-i="${i}" ${ok ? '' : 'disabled'}><b>Floor ${ch.number}</b><span>${esc(ch.title)}</span><em>${done ? 'Cleared ✓' : ok ? esc(ch.npc.name) : 'Locked'}</em></button>`;
  });
  const planned = G.plannedFloors.slice(G.chapters.length - 1).map((t, i) => `<div class="floor locked future"><b>Floor ${G.chapters.length + i + 1}</b><span>${esc(t)}</span><em>Under construction</em></div>`);
  screen(`<div class="top"><button class="btn alt" id="back">◀ Title</button><h2>The Alchemist's Tower</h2>${coinBadge()}</div>
    <div class="tower">${[...floors, ...planned].reverse().join('')}<button class="floor shop-floor" id="tower-shop"><b>Shop</b><span>Powers, upgrades &amp; cosmetics</span><em>Open anytime</em></button></div>`, 'tower-screen');
  $('#tower-shop').onclick = () => { sfx('click'); showShop(showTower); };
  app().scrollTop = app().scrollHeight; // floor 1 is at the bottom
  $('#back').onclick = showTitle;
  $$('.floor[data-i]').forEach(b => b.onclick = () => {
    const ch = G.chapters[+b.dataset.i];
    if (ch.prologue && !S.prologueSeen[ch.id]) { S.prologueSeen[ch.id] = true; save(); showDialogue(ch, ch.prologue, () => showMap(ch)); }
    else showMap(ch);
  });
}

function nodeState(ch, node) {
  const key = levelKey(ch, node.id);
  const reqs = node.requires || [];
  const unlocked = !!S.unlockAll || reqs.every(r => S.levels[levelKey(ch, r)]?.cleared);
  return { unlocked, rec: node === ch.boss ? (S.bosses[ch.id] ? { cleared: true, stars: S.levels[key]?.stars || 0 } : null) : S.levels[key] };
}
function showMap(ch) {
  playMusic(ch);
  const node = (lv, extra = '') => {
    const { unlocked, rec } = nodeState(ch, lv);
    return `<button class="node ${extra} ${unlocked ? '' : 'locked'} ${rec?.cleared ? 'cleared' : ''}" data-id="${lv.id}" ${unlocked ? '' : 'disabled'}>
      <b>${esc(lv.title || lv.name)}</b><span class="st">${rec?.cleared ? stars(rec.stars || 0) : unlocked ? 'NEW' : '🔒'}</span></button>`;
  };
  const intro = ch.levels.find(l => l.path === 'intro');
  const paths = Object.entries(ch.paths).map(([k, name]) => `<div class="path"><h4>Path ${k}<br><small>${esc(name)}</small></h4>${ch.levels.filter(l => l.path === k).map(l => node(l)).join('<div class="link"></div>')}</div>`).join('');
  screen(`<div class="top"><button class="btn alt" id="back">◀ Tower</button><h2>${esc(ch.floorName)}</h2>${coinBadge()}</div>
    <div class="map"><div class="map-npc">${portrait('npc', ch, 5)}<div><b>${esc(ch.npc.name)}</b><small>${esc(ch.npc.title)}</small></div></div>
    ${node(intro, 'intro')}<div class="link"></div><div class="paths">${paths}</div><div class="link"></div>
    ${node({ ...ch.boss, title: '☠ ' + ch.boss.name }, 'boss')}
    <p class="small center">Clear every path to unlock the boss.</p></div>`, 'map-screen');
  $('#back').onclick = showTower;
  $$('.node[data-id]').forEach(b => b.onclick = () => {
    sfx('click');
    if (b.dataset.id === 'boss') showDialogue(ch, ch.boss.intro, () => startBoss(ch));
    else { const lv = ch.levels.find(l => l.id === b.dataset.id); showDialogue(ch, lv.lesson.map(p => ({ speaker: 'npc', ...p })), () => startLevel(ch, lv), lv.title); }
  });
}

/* ---------------- Dialogue (lessons, story) ---------------- */
function showDialogue(ch, pages, onDone, heading = '') {
  let i = 0;
  const render = () => {
    const p = pages[i];
    const who = p.speaker || 'npc';
    const name = who === 'boss' ? ch.boss.name : who === 'npc' ? ch.npc.name : '';
    const color = who === 'boss' ? '#b34cff' : who === 'npc' ? ch.npc.color : '#ccc';
    const vis = p.smiles ? `<div class="dlg-mol" data-smiles="${esc(p.smiles)}"></div>` : p.art ? `<div class="dlg-art">${esc(p.art)}</div>` : '';
    screen(`${heading ? `<h2 class="h">${esc(heading)}</h2>` : ''}<div class="dialogue ${who}">
      <div class="dlg-portrait">${portrait(who, ch, 9)}</div>
      <div class="dlg-box" style="--c:${color}">${name ? `<div class="dlg-name">${esc(name)}</div>` : ''}<p>${esc(p.text)}</p>${vis}
      <div class="dlg-foot"><span>${i + 1} / ${pages.length}</span><span><button class="btn alt" id="dlg-skip">Skip</button> <button class="btn alt" id="dlg-back" ${i ? '' : 'disabled'}>◀ Back</button> <button class="btn" id="dlg-next">${i === pages.length - 1 ? 'Let\'s go!' : 'Next ▶'}</button></span></div></div></div>`, 'dlg-screen');
    speak(p.text);
    // Babble + bob the portrait while "talking" (skipped when read-aloud is speaking the real words).
    if (who === 'npc' || who === 'boss') {
      const v = who === 'boss' ? { pitch: 0.55, wave: 'sawtooth' } : ch.npc.voice || {};
      const secs = S.settings.readAloud ? 0 : Sound.talk(Math.min(3, 0.5 + p.text.length * 0.03), v.pitch, v.wave);
      const el = $('.dlg-portrait');
      if (secs) { el.classList.add('talking'); setTimeout(() => el.classList.remove('talking'), secs * 1000); }
    }
    $('#dlg-next').onclick = () => { sfx('click'); if (++i >= pages.length) done(); else render(); };
    $('#dlg-back').onclick = () => { sfx('click'); i--; render(); };
    $('#dlg-skip').onclick = done;
  };
  const key = e => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); $('#dlg-next')?.click(); }
    if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); $('#dlg-back')?.click(); }
  };
  const done = () => { document.removeEventListener('keydown', key); speak(''); Sound.hush(); onDone(); };
  document.addEventListener('keydown', key);
  render();
}

/* ---------------- Runs ---------------- */
function startLevel(ch, lv) {
  const items = shuffle(lv.problems).slice(0, lv.pick).map(p => ({ ch, p }));
  beginRun({ mode: 'level', ch, node: lv, title: lv.title, items });
}
function startBoss(ch) {
  const b = ch.boss;
  const extra = b.drawFromLevels ? shuffle(ch.levels.flatMap(l => l.problems)).slice(0, Math.max(0, b.pick - b.problems.length)) : [];
  const items = shuffle([...b.problems.slice(0, b.pick), ...extra]).map(p => ({ ch, p }));
  beginRun({ mode: 'boss', ch, node: b, title: b.name, items });
}
function beginRun(cfg) {
  const study = S.difficulty === 'study';
  const maxHearts = study ? Infinity : G.baseHearts[S.difficulty] + S.upgrades.maxHeart;
  playMusic(cfg.mode === 'review' ? null : cfg.ch, cfg.mode === 'boss');
  R = { ...cfg, index: 0, hearts: maxHearts, maxHearts, shield: false, mistakes: 0, hints: 0, streak: 0, earned: 0, log: [], start: performance.now() };
  if (cfg.mode === 'boss') {
    const total = cfg.items.reduce((n, it) => n + it.p.slots.length, 0) * cfg.node.damagePerCard;
    R.boss = { hp: total, max: total };
  }
  setupProblem();
}
function setupProblem() {
  const { ch, p } = R.items[R.index];
  R.filled = p.slots.map(() => null);
  R.hand = shuffle(p.hand).map((id, uid) => ({ uid, id }));
  R.probMistakes = 0; R.busy = false;
  p.hand.forEach(id => { S.seen[`${ch.id}/${id}`] = true; });
  save();
  renderPlay();
}

const KIND = { single: 'Pick the right card', match: 'Match each pair', order: 'Put them in order', rank: 'Rank them', multi: 'Fill every blank' };
function heartsHTML() {
  if (R.hearts === Infinity) return `<span class="hearts">${icon('heart', 4)}<b>∞</b></span>`;
  let h = '';
  for (let i = 0; i < R.maxHearts; i++) h += icon(i < R.hearts ? 'heart' : 'heartEmpty', 4);
  return `<span class="hearts">${h}</span>`;
}
function renderPlay() {
  const { ch, p } = R.items[R.index];
  const who = R.mode === 'boss' ? 'boss' : 'npc';
  const slots = p.slots.map((s, i) => `<div class="slot ${R.filled[i] ? 'filled' : ''}" data-i="${i}">
      ${s.smiles ? `<div class="slot-mol" data-smiles="${esc(s.smiles)}"></div>` : ''}<div class="slot-label">${esc(s.label)}</div>
      ${R.filled[i] ? cardHTML(ch, R.filled[i], { cls: 'placed' + (R.justPlaced === i ? ' pop' : '') }) : '<div class="slot-hole">DROP HERE</div>'}</div>`).join('');
  const hand = R.hand.map((c, k) => cardHTML(ch, c.id, { uid: c.uid, cls: 'in-hand', mystery: true }).replace('class="card', `style="--k:${k};--n:${R.hand.length}" class="card`)).join('');
  const powers = S.powers.map((id, i) => powerHTML(id, i)).join('') || '<div class="small">No power cards</div>';
  const bossBar = R.boss ? `<div class="bossbar"><b>${esc(ch.boss.name)}</b><div class="hp"><div style="width:${100 * R.boss.hp / R.boss.max}%"></div></div><span>${R.boss.hp} / ${R.boss.max}</span></div>` : '';
  screen(`<div class="topbar"><div class="lvl"><b>${esc(R.title)}</b><span>Problem ${R.index + 1} / ${R.items.length}</span></div>${bossBar}
      <div class="stats">${heartsHTML()}${R.shield ? `<span class="shield-on" title="Shield active">${icon('shield', 4)}</span>` : ''}${coinBadge()}</div></div>
    <div class="prompt-row"><div class="npc-mini ${who}">${portrait(who, ch, 4)}</div>
      <div class="prompt"><div class="kind">${KIND[p.kind] || ''}</div><div class="ptext">${esc(p.prompt)}</div><div class="bubble" id="bubble"></div></div>
      ${p.smiles ? `<div class="mol-panel" data-smiles="${esc(p.smiles)}"></div>` : ''}</div>
    <div class="slots">${slots}</div>
    <div class="bottom"><div class="powers"><div class="pw-title">Powers ${S.powers.length}/${maxPowerSlots()}</div><div class="pw-list">${powers}</div></div>
      <div class="hand">${hand}</div></div>`, 'play ' + (R.mode === 'boss' ? 'boss-fight' : ''));
  R.justPlaced = null;
  $$('.card.in-hand').forEach(el => el.addEventListener('pointerdown', onCardDown));
  $$('.power').forEach(el => el.addEventListener('click', () => usePower(+el.dataset.i)));
}
function say(text, kind = '') {
  const b = $('#bubble'); if (!b) return;
  b.className = 'bubble show ' + kind; b.textContent = text;
  speak(text);
}

/* ---------------- Drag & drop ---------------- */
function slotAt(x, y) {
  return $$('.slot:not(.filled)').find(s => { const r = s.getBoundingClientRect(); return x >= r.left - 10 && x <= r.right + 10 && y >= r.top - 10 && y <= r.bottom + 10; });
}
function onCardDown(e) {
  if (R.busy || e.button > 0) return;
  e.preventDefault();
  const el = e.currentTarget, rect = el.getBoundingClientRect();
  const ph = document.createElement('div'); ph.className = 'card-ph'; ph.style.width = rect.width + 'px';
  el.after(ph);
  const d = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, lastX: e.clientX, tilt: 0 };
  el.setPointerCapture(e.pointerId);
  el.classList.add('dragging');
  Object.assign(el.style, { width: rect.width + 'px', height: rect.height + 'px', left: rect.left + 'px', top: rect.top + 'px' });
  hideTip(); sfx('pick');
  const move = ev => {
    el.style.left = ev.clientX - d.dx + 'px'; el.style.top = ev.clientY - d.dy + 'px';
    d.tilt = clamp(d.tilt * 0.7 + (ev.clientX - d.lastX) * 0.8, -18, 18); d.lastX = ev.clientX;
    el.style.transform = `rotate(${d.tilt}deg) scale(1.08)`;
    const s = slotAt(ev.clientX, ev.clientY);
    $$('.slot').forEach(x => x.classList.toggle('hot', x === s));
  };
  const up = ev => {
    el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
    const s = ev.type === 'pointerup' ? slotAt(ev.clientX, ev.clientY) : null;
    el.classList.remove('dragging'); el.removeAttribute('style'); ph.remove();
    $$('.slot').forEach(x => x.classList.remove('hot'));
    if (s) drop(+s.dataset.i, +el.dataset.uid, el); else sfx('drop');
  };
  el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}

async function drop(i, uid) {
  if (R.busy || R.filled[i]) return;
  const { p } = R.items[R.index];
  const inst = R.hand.find(c => c.uid === uid);
  if (!inst) return;
  if (inst.id === p.slots[i].answer) await correct(i, inst); else await wrong(inst);
}
function explainText(p, id) {
  const base = p.explain[id] || '';
  return (p.why && (p.kind === 'order' || p.kind === 'rank')) ? `${base} ${p.why}` : base;
}

async function correct(i, inst) {
  const { ch, p } = R.items[R.index];
  R.filled[i] = inst.id; R.hand = R.hand.filter(c => c !== inst); R.justPlaced = i;
  R.streak++;
  let gain = G.coins.perCorrect;
  if (R.streak % G.coins.streakEvery === 0) { gain += G.coins.streakBonus; toast(`🔥 ${R.streak} in a row! +${G.coins.streakBonus} bonus`, 'good'); }
  S.coins += gain; R.earned += gain; save();
  sfx('correct'); setTimeout(() => sfx('coin'), 150);
  if (R.boss) { R.boss.hp = Math.max(0, R.boss.hp - R.items[R.index].ch.boss.damagePerCard); setTimeout(() => sfx('bosshit'), 80); }
  renderPlay();
  if (R.boss) { $('.bossbar')?.classList.add('hit'); if (Math.random() < 0.4) say(pick(ch.boss.taunts.right), 'boss'); }
  if (S.difficulty !== 'exam') toast(`<b>+${gain}</b> ${esc(explainText(p, inst.id))}`, 'good why');
  else toast(`<b>+${gain}</b> Correct!`, 'good');
  if (R.filled.every(Boolean)) await problemDone();
}
const pick = a => a[Math.floor(Math.random() * a.length)];

async function wrong(inst) {
  const { ch, p } = R.items[R.index];
  R.mistakes++; R.probMistakes++; R.streak = 0;
  const key = `${ch.id}/${p.id}`;
  S.missed[key] = true;
  const sk = `${ch.id}|${p.section}`; S.sectionMisses[sk] = (S.sectionMisses[sk] || 0) + 1;
  let msg;
  if (R.shield) { R.shield = false; sfx('shield'); msg = 'Your Shield blocked the hit!'; }
  else if (R.hearts !== Infinity) { R.hearts--; sfx('heart'); msg = R.hearts > 0 ? 'Lost a heart.' : 'Out of hearts!'; }
  else { sfx('wrong'); msg = 'Study mode: no heart lost.'; }
  save();
  renderPlay();
  $('.hearts')?.classList.add('shake');
  if (R.boss) say(pick(ch.boss.taunts.wrong), 'boss');
  const text = explainText(p, inst.id);
  if (S.difficulty === 'exam') {
    R.log.push({ ch, id: inst.id, text, section: p.section, prompt: p.prompt });
    toast(`✗ Wrong. ${msg} (Explanation after the level.)`, 'bad');
  } else {
    await flipCard(ch, inst.id, text, p.section, `Not quite. ${msg}`);
  }
  if (R.hearts <= 0) return failRun();
}

function flipCard(ch, id, text, section, heading) {
  return new Promise(resolve => {
    R.busy = true; sfx('flip');
    const ov = $('#overlay');
    ov.innerHTML = `<div class="flip"><div class="flip-inner"><div class="flip-face front">${cardHTML(ch, id)}</div>
      <div class="flip-face back"><h3>${esc(heading)}</h3><p>${esc(text)}</p><p class="src">${esc(sourceLine(ch, section))}</p><button class="btn" id="flip-ok">Got it</button></div></div></div>`;
    ov.classList.add('show');
    drawAllSmiles(ov);
    requestAnimationFrame(() => setTimeout(() => $('.flip', ov)?.classList.add('flipped'), 60));
    speak(text);
    const close = () => { document.removeEventListener('keydown', key); closeOverlay(); speak(''); R.busy = false; resolve(); };
    const key = e => { if (e.key === 'Enter' || e.key === 'Escape') close(); };
    document.addEventListener('keydown', key);
    $('#flip-ok').onclick = close;
  });
}

async function problemDone() {
  R.busy = true;
  const { ch, p } = R.items[R.index];
  if (R.probMistakes === 0) {
    if (R.mode === 'review') delete S.missed[`${ch.id}/${p.id}`];
    if (Math.random() < G.powerDropChance) grantPower(randomPower());
  }
  save();
  const run = R;
  await sleep(900);
  if (R !== run) return; // player left this run during the pause
  R.index++;
  if (R.index < R.items.length) setupProblem(); else finishRun();
}
function randomPower() {
  const weights = { common: 50, uncommon: 30, rare: 13, epic: 7 };
  const pool = Object.entries(G.powers).flatMap(([id, p]) => Array(weights[p.rarity] || 1).fill(id));
  return pick(pool);
}
function grantPower(id, force = false) {
  if (!force && S.powers.length >= maxPowerSlots()) { S.coins += 10; toast(`Power slots full. ${powerDef(id).name} sold for 10 coins.`); }
  else { S.powers.push(id); sfx('power'); toast(`✦ New power card: <b>${esc(powerDef(id).name)}</b>`, 'good'); }
  save();
}

/* ---------------- Powers ---------------- */
async function usePower(i) {
  if (R.busy) return;
  const id = S.powers[i], p = powerDef(id), { ch, p: prob } = R.items[R.index];
  const consume = () => { S.powers.splice(i, 1); save(); sfx('power'); };
  const needed = () => { // multiset of answers still needed
    const m = {}; prob.slots.forEach((s, k) => { if (!R.filled[k]) m[s.answer] = (m[s.answer] || 0) + 1; }); return m;
  };
  switch (p.effect) {
    case 'hint':
      if (S.difficulty === 'exam') return toast('No hints in Exam mode.', 'bad');
      consume(); R.hints++; renderPlay(); say(`${ch.npc.name}: "${prob.hint}"`, 'hint'); return;
    case 'heal':
      if (R.hearts === Infinity) return toast('Study mode already has unlimited hearts.');
      if (R.hearts >= R.maxHearts) return toast('Your hearts are already full.');
      consume(); R.hearts++; renderPlay(); toast('♥ Healed one heart.', 'good'); return;
    case 'shield':
      if (R.shield) return toast('Shield already active.');
      consume(); R.shield = true; renderPlay(); toast('Shield up! Your next mistake is free.', 'good'); return;
    case 'eliminate': {
      const need = needed();
      const spare = R.hand.filter(c => { if (need[c.id]) { need[c.id]--; return false; } return true; });
      if (!spare.length) return toast('Every card left in your hand is needed somewhere!');
      consume();
      const victim = pick(spare);
      R.hand = R.hand.filter(c => c !== victim);
      renderPlay();
      const text = explainText(prob, victim.id);
      if (S.difficulty === 'exam') { R.log.push({ ch, id: victim.id, text, section: prob.section, prompt: prob.prompt }); toast(`Eliminated ${esc(cardDef(ch, victim.id).name)}. (Explanation after the level.)`); }
      else await flipCard(ch, victim.id, text, prob.section, 'Eliminated! Here\'s why it\'s wrong:');
      return;
    }
    case 'purge': {
      const need = needed();
      const spare = R.hand.filter(c => { if (need[c.id]) { need[c.id]--; return false; } return true; });
      if (!spare.length) return toast('Every card left in your hand is needed somewhere!');
      consume();
      R.hand = R.hand.filter(c => !spare.includes(c));
      renderPlay();
      for (const v of spare) {
        const text = explainText(prob, v.id);
        if (S.difficulty === 'exam') R.log.push({ ch, id: v.id, text, section: prob.section, prompt: prob.prompt });
        else await flipCard(ch, v.id, text, prob.section, `${p.name}: out of line!`);
      }
      return;
    }
    case 'autofill': {
      const k = R.filled.findIndex(f => !f);
      const inst = R.hand.find(c => c.id === prob.slots[k].answer);
      if (!inst) return;
      consume();
      R.filled[k] = inst.id; R.hand = R.hand.filter(c => c !== inst); R.justPlaced = k;
      if (R.boss) R.boss.hp = Math.max(0, R.boss.hp - ch.boss.damagePerCard);
      renderPlay();
      const text = explainText(prob, inst.id);
      if (S.difficulty === 'exam') R.log.push({ ch, id: inst.id, text, section: prob.section, prompt: prob.prompt });
      else await flipCard(ch, inst.id, text, prob.section, `${p.name} lights the way:`);
      if (R.filled.every(Boolean)) await problemDone();
    }
  }
}

/* ---------------- End of run ---------------- */
function reviewLogHTML() {
  if (!R.log.length) return '';
  return `<div class="exam-log"><h3>Exam review: your mistakes</h3>${R.log.map(l => `<div class="log-item"><b>${esc(cardDef(l.ch, l.id).name)}</b> <i>on "${esc(l.prompt)}"</i><p>${esc(l.text)}</p><p class="src">${esc(sourceLine(l.ch, l.section))}</p></div>`).join('')}</div>`;
}
function failRun() {
  sfx('lose');
  const cfg = { mode: R.mode, ch: R.ch, node: R.node, title: R.title, items: R.items };
  screen(`<div class="results fail"><h2>Out of hearts!</h2><p>Every mistake is a lesson. Reread the explanations and try again with a fresh hand.</p>${reviewLogHTML()}
    <div class="row">${btn('r-retry', 'Retry')}${btn('r-map', 'Back', 'alt')}</div></div>`);
  $('#r-retry').onclick = () => cfg.mode === 'boss' ? startBoss(cfg.ch) : cfg.mode === 'level' ? startLevel(cfg.ch, cfg.node) : beginRun(cfg);
  $('#r-map').onclick = () => cfg.mode === 'review' ? showReview() : showMap(cfg.ch);
}
function finishRun() {
  const secs = (performance.now() - R.start) / 1000;
  const par = G.parSecondsPerProblem * R.items.length;
  const noMistakes = R.mistakes === 0, fast = R.hints === 0 && secs <= par;
  const st = 1 + noMistakes + fast;
  const { ch, mode, node } = R;
  let rewards = '';
  if (mode !== 'review') {
    const key = levelKey(ch, node.id);
    const prev = S.levels[key];
    S.levels[key] = { cleared: true, stars: Math.max(st, prev?.stars || 0) };
  }
  if (mode === 'boss') {
    const first = !S.bosses[ch.id];
    S.bosses[ch.id] = true;
    S.coins += node.coinReward; R.earned += node.coinReward;
    rewards = `<p>Boss reward: <b>+${node.coinReward} coins</b></p>`;
    if (first) {
      grantPower(node.legendary.id, true);
      if (!S.owned.includes(node.cosmetic.id)) S.owned.push(node.cosmetic.id);
      rewards += `<div class="reward-row"><div class="power r-legendary big"><div class="p-name">${esc(node.legendary.name)}</div><div class="p-rar">legendary</div></div>
        <p><b>Legendary power: ${esc(node.legendary.name)}</b><br>${esc(node.legendary.desc)}<br><br>Cosmetic unlocked: <b>${esc(node.cosmetic.name)}</b> card back (equip it in the shop).</p></div>`;
    }
  }
  save();
  sfx('win');
  screen(`<div class="results"><h2>${mode === 'boss' ? `${esc(node.name)} defeated!` : mode === 'review' ? 'Practice complete!' : 'Level clear!'}</h2>
    ${mode !== 'review' ? `<div class="big-stars">${stars(st)}</div>` : ''}
    <ul class="criteria"><li class="${'ok'}">✓ Cleared</li><li class="${noMistakes ? 'ok' : ''}">${noMistakes ? '✓' : '✗'} No mistakes (${R.mistakes})</li><li class="${fast ? 'ok' : ''}">${fast ? '✓' : '✗'} No hints & under ${Math.round(par / 60)} min (${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')})</li></ul>
    <p>Coins earned: <b>${R.earned}</b></p>${rewards}${reviewLogHTML()}
    <div class="row">${btn('r-next', 'Continue')}${mode !== 'review' ? btn('r-again', 'Replay', 'alt') : ''}</div></div>`);
  const again = () => mode === 'boss' ? startBoss(ch) : startLevel(ch, node);
  if ($('#r-again')) $('#r-again').onclick = again;
  $('#r-next').onclick = () => {
    if (mode === 'review') return showReview();
    if (mode === 'boss') return showDialogue(ch, [...node.defeat, ...node.story], () => showShop(() => showTower()));
    showShop(() => showMap(ch));
  };
}

/* ---------------- Shop ---------------- */
function showShop(next) {
  const full = S.powers.length >= maxPowerSlots();
  const powers = Object.entries(G.powers).map(([id, p]) => `<div class="shop-item"><div class="power r-${p.rarity}" data-power="${id}"><div class="p-name">${p.name}</div><div class="p-rar">${p.rarity}</div></div>
    <button class="btn buy" data-kind="power" data-id="${id}" ${S.coins < p.price || full ? 'disabled' : ''}>${icon('coin', 2)} ${p.price}</button></div>`).join('');
  const ups = Object.entries(G.upgrades).map(([id, u]) => { const n = S.upgrades[id]; return `<div class="shop-item wide"><b>${u.name}</b><small>${u.desc} (${n}/${u.max})</small>
    <button class="btn buy" data-kind="upgrade" data-id="${id}" ${n >= u.max || S.coins < u.price ? 'disabled' : ''}>${n >= u.max ? 'Maxed' : `${icon('coin', 2)} ${u.price}`}</button></div>`; }).join('');
  const cos = Object.entries(G.cosmetics).map(([id, c]) => {
    const own = S.owned.includes(id), on = S.equipped[c.kind] === id;
    const action = on ? '<button class="btn" disabled>Equipped</button>' : own ? `<button class="btn alt buy" data-kind="equip" data-id="${id}">Equip</button>`
      : c.price == null ? '<button class="btn" disabled>Boss reward</button>' : `<button class="btn buy" data-kind="cosmetic" data-id="${id}" ${S.coins < c.price ? 'disabled' : ''}>${icon('coin', 2)} ${c.price}</button>`;
    const swatch = c.kind === 'finish' ? `<div class="swatch finish" data-fx="${c.fx}"></div>` : `<div class="swatch ${c.kind}" style="background:${esc(c.css)}"></div>`;
    return `<div class="shop-item">${swatch}<small>${esc(c.name)}<br><i>${{ back: 'card back', table: 'table', finish: 'card finish' }[c.kind]}</i></small>${action}</div>`;
  }).join('');
  screen(`<div class="top"><h2>The Tower Shop</h2>${coinBadge()}</div>
    <p class="small center">Your powers: ${S.powers.map(id => esc(powerDef(id).name)).join(', ') || 'none'} (${S.powers.length}/${maxPowerSlots()} slots)</p>
    <div class="shop"><section><h3>Power Cards</h3><div class="shop-grid">${powers}</div></section>
    <section><h3>Upgrades</h3><div class="shop-grid">${ups}</div></section>
    <section><h3>Mystery Pack</h3><div class="shop-grid"><div class="shop-item wide"><b>? Mystery Pack ?</b><small>${G.mysteryPack.desc}</small>
      <button class="btn buy" data-kind="mystery" ${S.coins < G.mysteryPack.price ? 'disabled' : ''}>${icon('coin', 2)} ${G.mysteryPack.price}</button></div></div></section>
    <section><h3>Cosmetics</h3><div class="shop-grid">${cos}</div></section></div>
    <div class="row center">${btn('shop-done', 'Continue ▶')}</div>`, 'shop-screen');
  $('#shop-done').onclick = () => { sfx('click'); next(); };
  $$('.buy').forEach(b => b.onclick = () => {
    const { kind, id } = b.dataset;
    if (kind === 'power') { S.coins -= G.powers[id].price; grantPower(id); }
    if (kind === 'upgrade') { S.coins -= G.upgrades[id].price; S.upgrades[id]++; toast(`Upgrade bought: ${G.upgrades[id].name}`, 'good'); }
    if (kind === 'cosmetic') { S.coins -= G.cosmetics[id].price; S.owned.push(id); S.equipped[G.cosmetics[id].kind] = id; }
    if (kind === 'equip') S.equipped[G.cosmetics[id].kind] = id;
    if (kind === 'mystery') {
      S.coins -= G.mysteryPack.price;
      const roll = Math.random();
      if (roll < 0.6) { const ids = Object.keys(G.powers).filter(k => ['common', 'uncommon'].includes(G.powers[k].rarity)); grantPower(pick(ids)); }
      else { const back = 20 + Math.floor(Math.random() * 21); S.coins += back; toast(`The pack held ${back} coins!`, 'good'); }
    }
    sfx('coin'); save(); applySettings(); showShop(next);
  });
}

/* ---------------- Codex ---------------- */
function showCodex(filter = 'all') {
  const types = ['all', 'concept', 'structure', 'product', 'reagent', 'power'];
  let body = '';
  if (filter === 'power') {
    const all = [...Object.keys(G.powers), ...G.chapters.map(c => c.boss.legendary.id)];
    body = `<div class="codex-grid">${all.map((id, i) => powerHTML(id, i)).join('')}</div>`;
  } else {
    body = G.chapters.map(ch => {
      const ids = Object.keys(ch.cards).filter(id => filter === 'all' || ch.cards[id].type === filter);
      const seen = ids.filter(id => S.seen[`${ch.id}/${id}`]).length;
      return `<h3>Floor ${ch.number}: ${esc(ch.title)} <small>(${seen}/${ids.length} found)</small></h3><div class="codex-grid">${ids.map(id => S.seen[`${ch.id}/${id}`] ? cardHTML(ch, id, { cls: 'codex' }) : '<div class="card locked-card"><div class="card-name">???</div></div>').join('')}</div>`;
    }).join('');
  }
  screen(`<div class="top"><button class="btn alt" id="back">◀ Back</button><h2>Card Codex</h2><span></span></div>
    <div class="tabs">${types.map(t => `<button class="tab ${t === filter ? 'on' : ''}" data-t="${t}">${t}</button>`).join('')}</div>
    <p class="small center">Every card you've been dealt, with its full description. Click one to study it.</p><div class="codex">${body}</div>`, 'codex-screen');
  $('#back').onclick = R ? showTower : showTitle;
  $$('.tab').forEach(t => t.onclick = () => showCodex(t.dataset.t));
  $$('.card.codex').forEach(el => el.onclick = () => {
    const ch = G.chapters.find(c => c.id === el.dataset.ch), c = cardDef(ch, el.dataset.id);
    const ov = $('#overlay');
    ov.innerHTML = `<div class="panel zoom">${cardHTML(ch, el.dataset.id, { cls: 'big' })}<div><h2>${esc(c.name)}</h2><i>${esc(c.type)} card</i><p>${esc(c.desc)}</p><button class="btn" id="z-close">Close</button></div></div>`;
    ov.classList.add('show'); drawAllSmiles(ov); speak(c.desc);
    $('#z-close').onclick = closeOverlay;
  });
}

/* ---------------- Review & stats ---------------- */
function findProblem(key) {
  const [cid, pid] = key.split('/');
  const ch = G.chapters.find(c => c.id === cid); if (!ch) return null;
  const p = [...ch.levels.flatMap(l => l.problems), ...ch.boss.problems].find(x => x.id === pid);
  return p ? { ch, p } : null;
}
function seededShuffle(arr, seed) {
  let s = seed; const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a;
}
function showReview() {
  const missed = Object.keys(S.missed).map(findProblem).filter(Boolean);
  const pool = G.chapters.flatMap(ch => ch.levels.filter(l => S.levels[levelKey(ch, l.id)]?.cleared).flatMap(l => l.problems.map(p => ({ ch, p }))));
  const today = new Date(); const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  const daily = seededShuffle(pool, seed).slice(0, 5);
  const weak = Object.entries(S.sectionMisses).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxMiss = weak[0]?.[1] || 1;
  const weakHTML = weak.length ? weak.map(([k, n]) => { const [cid, sec] = k.split('|'); const ch = G.chapters.find(c => c.id === cid); return `<div class="weak"><span>${esc(sec)} ${esc(ch?.sections[sec] || '')}</span><div class="bar"><div style="width:${100 * n / maxMiss}%"></div></div><b>${n}</b></div>`; }).join('') : '<p class="small">No mistakes recorded yet.</p>';
  const cleared = Object.values(S.levels).filter(l => l.cleared).length;
  const starSum = Object.values(S.levels).reduce((n, l) => n + (l.stars || 0), 0);
  screen(`<div class="top"><button class="btn alt" id="back">◀ Back</button><h2>Review & Stats</h2>${coinBadge()}</div>
    <div class="review"><section><h3>Your stats</h3><p>Levels cleared: <b>${cleared}</b> · Stars: <b>${starSum}</b> · Cards found: <b>${Object.keys(S.seen).length}</b></p></section>
    <section><h3>Weak topics</h3><p class="small">The textbook sections you miss most. Reread these!</p>${weakHTML}</section>
    <section><h3>Practice</h3><div class="row">
      <button class="btn" id="rv-miss" ${missed.length ? '' : 'disabled'}>Mistake Replay (${missed.length})</button>
      <button class="btn" id="rv-daily" ${daily.length ? '' : 'disabled'}>Daily Practice (${daily.length})</button></div>
      <p class="small">Mistake Replay deals the exact problems you missed with fresh hands; solve one cleanly to clear it. Daily Practice is 5 problems from levels you've cleared, new each day.</p></section></div>`, 'review-screen');
  $('#back').onclick = showTitle;
  $('#rv-miss').onclick = () => beginRun({ mode: 'review', ch: missed[0].ch, title: 'Mistake Replay', items: shuffle(missed).slice(0, 8) });
  $('#rv-daily').onclick = () => beginRun({ mode: 'review', ch: daily[0].ch, title: 'Daily Practice', items: daily });
}

/* ---------------- Credits ---------------- */
function showCredits() {
  screen(`<div class="top"><button class="btn alt" id="back">◀ Back</button><h2>Credits</h2><span></span></div>
    <div class="credits">
    <p><b>Reagentro</b> was made for Viggo and friends as a free, non-commercial study game.</p>
    <h3>Textbook</h3><p>The chemistry content, problems, and explanations are adapted from <i>Organic Chemistry</i> by John McMurry, published by <b>OpenStax</b> (Rice University). Access the book for free at openstax.org.
    The original is licensed under the Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License (CC BY-NC-SA 4.0). Changes: problems and examples were rewritten and adapted into card-game form, with new variations.
    Every explanation names the section of the book it comes from.</p>
    <h3>License</h3><p>This game's content is shared under the same license, <b>CC BY-NC-SA 4.0</b>. It must stay free and non-commercial.</p>
    <h3>Software & fonts</h3><p>SmilesDrawer by Daniel Probst (MIT) draws the structures. Fonts: Press Start 2P by CodeMan38 and VT323 by Peter Hull (SIL Open Font License). Built with Electron (MIT).
    Music and sound effects are synthesized live by the game.</p></div>`, 'credits-screen');
  $('#back').onclick = showTitle;
}

/* ---------------- Boot ---------------- */
async function boot() {
  try {
    G = await (await fetch('data/game.json')).json();
    G.chapters = await Promise.all(G.chapters.map(async f => (await fetch('data/' + f)).json()));
  } catch (e) {
    app().innerHTML = `<div class="screen"><h2>Could not load game data</h2><p>${esc(e.message)}</p></div>`;
    return;
  }
  S = loadSave();
  applySettings();
  document.addEventListener('pointerdown', () => Sound.unlock(G.musicFiles), { once: true });
  $('#gear').onclick = () => $('#overlay').classList.contains('show') ? closeOverlay() : showSettings();
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('.flip')) { if ($('#overlay').classList.contains('show')) closeOverlay(); else showSettings(); } });
  showTitle();
}
boot();
