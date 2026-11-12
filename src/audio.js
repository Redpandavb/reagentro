'use strict';
// All sound is synthesized with Web Audio: original, offline, no files needed.
// Optional: .mp3/.ogg files in music/ listed in data/game.json "musicFiles" play instead of the synth.
window.Sound = (() => {
  let ctx, master, musicBus, sfxBus, noiseBuf, timer, started = false;
  let vol = { music: 0.5, sfx: 0.7, mute: false };

  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    apply();
  }
  function apply() {
    if (!ctx) return;
    master.gain.value = vol.mute ? 0 : 1;
    musicBus.gain.value = vol.music * 0.5;
    sfxBus.gain.value = vol.sfx;
    if (musicEl) musicEl.volume = vol.mute ? 0 : vol.music;
  }

  function tone(freq, t, dur, { type = 'square', gain = 0.15, bus = sfxBus, slide = 0, attack = 0.005, filter = 0 } = {}) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out = g;
    if (filter) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; g.connect(f); out = f; }
    o.connect(g); out.connect(bus);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(t, dur, { gain = 0.2, type = 'bandpass', freq = 2000, q = 1, bus = sfxBus } = {}) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; s.loop = true;
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(bus);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  const SFX = {
    pick: t => tone(660, t, 0.06, { gain: 0.08 }),
    drop: t => tone(440, t, 0.08, { gain: 0.08, slide: -200 }),
    flip: t => { noise(t, 0.12, { gain: 0.25, freq: 3000, q: 0.7 }); tone(300, t, 0.12, { type: 'triangle', slide: 400, gain: 0.1 }); },
    correct: t => [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.05, 0.12, { gain: 0.1 })),
    wrong: t => { tone(220, t, 0.25, { type: 'sawtooth', slide: -120, gain: 0.12, filter: 1200 }); },
    coin: t => { tone(988, t, 0.07, { gain: 0.09 }); tone(1319, t + 0.07, 0.16, { gain: 0.09 }); },
    heart: t => { tone(392, t, 0.12, { type: 'triangle', gain: 0.2 }); tone(262, t + 0.12, 0.3, { type: 'triangle', gain: 0.2, slide: -100 }); },
    shield: t => { tone(800, t, 0.3, { type: 'sine', slide: 800, gain: 0.12 }); noise(t, 0.2, { gain: 0.1, freq: 6000 }); },
    bosshit: t => { noise(t, 0.25, { gain: 0.5, type: 'lowpass', freq: 900 }); tone(110, t, 0.3, { type: 'sine', slide: -60, gain: 0.4 }); },
    power: t => [0, 1, 2, 3, 4].forEach(i => tone(600 + i * 180, t + i * 0.03, 0.15, { type: 'triangle', gain: 0.07 })),
    win: t => [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, t + i * 0.09, 0.2, { gain: 0.09 })),
    lose: t => [392, 330, 262, 196].forEach((f, i) => tone(f, t + i * 0.15, 0.25, { type: 'triangle', gain: 0.15 })),
    click: t => tone(1200, t, 0.03, { gain: 0.05 })
  };

  // ---------- Lo-fi music generator ----------
  // ii–V–I–vi in C with 7ths/9ths, ~72 BPM, swung hats, soft kick/snare, vinyl crackle.
  const CHORDS = [
    { root: 38, notes: [50, 53, 57, 60, 64] }, // Dm9
    { root: 43, notes: [50, 53, 55, 59, 64] }, // G13-ish
    { root: 36, notes: [48, 52, 55, 59, 62] }, // Cmaj9
    { root: 45, notes: [48, 52, 55, 57, 60] }  // Am7
  ];
  const PENTA = [69, 72, 74, 76, 79, 81];
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  const BPM = 72, STEP = 60 / BPM / 4; // sixteenth notes
  let step = 0, nextTime = 0, crackle;

  function scheduleStep(t) {
    const bar = Math.floor(step / 16) % CHORDS.length, s = step % 16, ch = CHORDS[bar];
    const swing = (s % 2) ? STEP * 0.18 : 0;
    t += swing;
    if (s === 0) ch.notes.forEach(n => tone(mtof(n), t, STEP * 16, { type: 'triangle', gain: 0.035, bus: musicBus, attack: 0.4, filter: 1400 }));
    if (s === 0 || s === 10) tone(mtof(ch.root), t, STEP * 6, { type: 'sine', gain: 0.22, bus: musicBus, attack: 0.02 });
    if (s === 0 || s === 7 || s === 10) { tone(120, t, 0.25, { type: 'sine', slide: -75, gain: 0.35, bus: musicBus }); }
    if (s === 4 || s === 12) noise(t, 0.18, { gain: 0.12, freq: 1800, q: 0.8, bus: musicBus });
    if (s % 2 === 0) noise(t, 0.04, { gain: s % 4 ? 0.025 : 0.045, type: 'highpass', freq: 7000, bus: musicBus });
    if (s % 4 === 2 && Math.random() < 0.35) tone(mtof(PENTA[Math.floor(Math.random() * PENTA.length)]), t, STEP * 3, { type: 'sine', gain: 0.05, bus: musicBus, attack: 0.02, filter: 2500 });
    if (Math.random() < 0.08) noise(t, 0.01, { gain: 0.06, type: 'highpass', freq: 3000, bus: musicBus });
    step++;
  }
  let musicEl;
  function startMusic(files) {
    if (started || !ctx) return;
    started = true;
    if (files && files.length) { // user-supplied tracks in music/ replace the synth
      let i = 0;
      musicEl = new Audio('music/' + files[0]);
      musicEl.onended = () => { i = (i + 1) % files.length; musicEl.src = 'music/' + files[i]; musicEl.play(); };
      apply(); musicEl.play().catch(() => {});
      return;
    }
    crackle = ctx.createBufferSource(); crackle.buffer = noiseBuf; crackle.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 5000; f.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.value = 0.012;
    crackle.connect(f); f.connect(g); g.connect(musicBus); crackle.start();
    nextTime = ctx.currentTime + 0.1;
    timer = setInterval(() => { while (nextTime < ctx.currentTime + 0.3) { scheduleStep(nextTime); nextTime += STEP; } }, 80);
  }

  return {
    unlock(files) { init(); if (ctx.state === 'suspended') ctx.resume(); startMusic(files); },
    setVolumes(v) { vol = { ...vol, ...v }; apply(); },
    sfx(name) { if (!ctx || !SFX[name]) return; SFX[name](ctx.currentTime + 0.01); },
    speak(text, on) {
      if (!('speechSynthesis' in window)) return;
      speechSynthesis.cancel();
      if (!on || !text) return;
      const u = new SpeechSynthesisUtterance(String(text).replace(/[★☆♥]/g, ''));
      u.rate = 1.0; speechSynthesis.speak(u);
    }
  };
})();
