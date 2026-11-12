'use strict';
// All sound is synthesized with Web Audio: original, offline, no files needed.
// Optional: .mp3/.ogg files in music/ listed in data/game.json "musicFiles" play instead of the synth.
window.Sound = (() => {
  let ctx, master, musicBus, sfxBus, noiseBuf, timer, talkGain, started = false;
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
  // A song: chords ([root, ...voicing], one per bar) plus a style. Every style field is optional:
  //   steps  16 = 4/4, 12 = 3/4 waltz (sixteenth-note steps per bar)
  //   keys   { style: pad | stabs | arp, type: triangle | sine | sawtooth | bell, hits, rate, oct, gain, under }
  //   bass   { style: root | walk | pulse | sub, hits }
  //   kick, snare: step lists; snareLen; brush: true (soft brushed snare); hat: { every, gain } or null
  //   lead   { chance, type } random notes from scale, or melody: "0..2.1." (scale index per step, . = rest)
  //   rain   gain of a rain bed with drips
  // Lobby songs live here; chapter songs come from each chapter's JSON "music", the boss song from game.json.
  const SONGS = [
    { name: 'Tower Study', note: 'Classic boom-bap lo-fi: soft pad, swung hats.', bpm: 72, // ii–V–I–vi in C
      chords: [[38, 50, 53, 57, 60, 64], [43, 50, 53, 55, 59, 64], [36, 48, 52, 55, 59, 62], [45, 48, 52, 55, 57, 60]],
      scale: [69, 72, 74, 76, 79, 81] },
    { name: 'Rainy Window', note: 'Ambient: rain, slow bell arpeggio, deep sub, barely any drums.', bpm: 64, swing: 0,
      keys: { style: 'arp', type: 'bell', rate: 2, oct: 12, gain: 0.028, under: 0.02 }, bass: { style: 'sub' },
      kick: [0], snare: [], hat: null, lead: { chance: 0.1 }, rain: 0.05, // Fmaj9–Em7–Dm9–Cmaj7
      chords: [[41, 53, 57, 60, 64, 67], [40, 52, 55, 59, 62], [38, 50, 53, 57, 60, 64], [36, 48, 52, 55, 59]],
      scale: [72, 74, 76, 79, 81, 84] },
    { name: 'Lantern Walk', note: 'Jazz-hop: walking bass, offbeat chord stabs, heavy shuffle.', bpm: 88, swing: 0.3,
      keys: { style: 'stabs', type: 'triangle', hits: [2, 7, 10, 14], gain: 0.04 }, bass: { style: 'walk' },
      kick: [0, 8], snare: [4, 12], hat: { every: 2, gain: 0.05 }, lead: { chance: 0.35, type: 'triangle' }, // Ebmaj9–Cm9–Abmaj7–Bb9sus
      chords: [[39, 51, 55, 58, 62, 65], [36, 48, 51, 55, 58, 62], [44, 56, 60, 63, 67], [46, 56, 60, 63, 65]],
      scale: [75, 77, 79, 82, 84, 87] },
    { name: 'Midnight Lab', note: 'Trip-hop: half-time beat, long snare tails, fast glassy bell arpeggio.', bpm: 60, swing: 0.1,
      keys: { style: 'arp', type: 'bell', rate: 1, oct: 12, gain: 0.018, under: 0.03 }, bass: { style: 'sub', hits: [0, 3, 10] },
      kick: [0, 3, 10], snare: [12], snareLen: 0.45, hat: { every: 4, gain: 0.03 }, lead: { chance: 0.15 }, // Am9–Fmaj7–Dm9–E7sus
      chords: [[45, 55, 60, 64, 67, 71], [41, 52, 57, 60, 64], [38, 50, 53, 57, 60, 64], [40, 52, 57, 59, 62]],
      scale: [69, 72, 74, 76, 79, 81] }
  ];
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  let song = SONGS[0], cycle = true, step = 0, nextTime = 0, crackle, rainGain;
  const STEP = () => 60 / song.bpm / 4; // sixteenth notes
  const BARS_PER_LOBBY_SONG = 16;

  function voice(type, midi, t, dur, gain, filter = 2500) {
    const f = mtof(midi);
    if (type === 'bell') { // music-box/glass: pure tone plus a quiet, fast-fading overtone
      tone(f, t, dur, { type: 'sine', gain, bus: musicBus, attack: 0.003 });
      tone(f * 3, t, dur * 0.3, { type: 'sine', gain: gain * 0.3, bus: musicBus, attack: 0.003 });
    } else tone(f, t, dur, { type: type || 'triangle', gain, bus: musicBus, attack: 0.01, filter });
  }

  function scheduleStep(t) {
    // The lobby moves to the next lobby song after a while; a held song (chapter, boss, or player pick) loops.
    const N0 = song.steps || 16;
    if (cycle && step && step % (BARS_PER_LOBBY_SONG * N0) === 0) setTrack(SONGS[(SONGS.indexOf(song) + 1) % SONGS.length]);
    const sg = song, st = STEP(), N = sg.steps || 16;
    const barN = Math.floor(step / N), bar = barN % sg.chords.length, s = step % N;
    const [root, ...notes] = sg.chords[bar], nextRoot = sg.chords[(bar + 1) % sg.chords.length][0];
    t += (s % 2) ? st * (sg.swing ?? 0.18) : 0; // swing

    const k = sg.keys || { style: 'pad' };
    if (k.style === 'pad' && s === 0) notes.forEach(n => tone(mtof(n), t, st * N, { type: k.type || 'triangle', gain: k.gain ?? 0.035, bus: musicBus, attack: 0.4, filter: 1400 }));
    if (k.style === 'stabs' && k.hits.includes(s)) notes.forEach(n => voice(k.type, n, t, st * 1.6, k.gain ?? 0.04, 1800));
    if (k.style === 'arp' && s % (k.rate || 2) === 0) {
      const seq = [...notes, ...notes.slice(1, -1).reverse()]; // up and back down
      voice(k.type, seq[(s / (k.rate || 2)) % seq.length] + (k.oct || 0), t, st * 4, k.gain ?? 0.03);
    }
    if (k.under && s === 0) notes.forEach(n => tone(mtof(n), t, st * N, { type: 'sine', gain: k.under, bus: musicBus, attack: 0.8, filter: 900 }));

    const b = sg.bass || { style: 'root' }, bh = b.hits || [0, 10];
    if (b.style === 'root' && bh.includes(s)) tone(mtof(root), t, st * 6, { type: 'sine', gain: 0.22, bus: musicBus, attack: 0.02 });
    if (b.style === 'sub' && (s === 0 || (b.hits && bh.includes(s)))) tone(mtof(root - 12), t, s === 0 ? st * N : st * 3, { type: 'sine', gain: 0.3, bus: musicBus, attack: 0.05 });
    if (b.style === 'walk' && s % 4 === 0) { // quarter notes: root, fifth, octave, then a half step into the next chord
      const walk = [root, root + 7, root + 12, nextRoot + (nextRoot > root ? -1 : 1)];
      tone(mtof(walk[s / 4]), t, st * 3.5, { type: 'triangle', gain: 0.26, bus: musicBus, attack: 0.01, filter: 900 });
    }
    if (b.style === 'pulse' && s % 2 === 0) tone(mtof(root + (s % 4 ? 12 : 0)), t, st * 1.6, { type: 'sawtooth', gain: 0.1, bus: musicBus, attack: 0.005, filter: 500 });

    const kick = sg.kick || [0, 7, 10], snare = sg.snare || [4, 12];
    if (kick.includes(s)) tone(120, t, 0.25, { type: 'sine', slide: -75, gain: sg.kickGain ?? 0.35, bus: musicBus });
    if (snare.includes(s)) sg.brush ? noise(t, 0.14, { gain: 0.05, freq: 4500, q: 0.5, bus: musicBus })
      : noise(t, sg.snareLen || 0.18, { gain: 0.12, freq: 1800, q: 0.8, bus: musicBus });
    const hat = sg.hat === undefined ? { every: 2, gain: 0.045 } : sg.hat;
    if (hat && s % hat.every === 0) noise(t, 0.04, { gain: s % 4 ? hat.gain * 0.55 : hat.gain, type: 'highpass', freq: 7000, bus: musicBus });

    const lead = sg.lead || { chance: 0.35 };
    if (sg.melody) { const m = sg.melody.replace(/[^0-9.]/g, ''), c = m[step % m.length]; if (c !== '.') voice(lead.type || 'sine', sg.scale[+c], t, st * 3, lead.gain ?? 0.045); }
    else if (s % 4 === 2 && Math.random() < lead.chance) voice(lead.type || 'sine', sg.scale[Math.floor(Math.random() * sg.scale.length)], t, st * 3, lead.type && lead.type !== 'sine' ? 0.035 : 0.05);

    if (sg.rain && Math.random() < 0.06) tone(1800 + Math.random() * 1600, t, 0.05, { type: 'sine', gain: 0.015, bus: musicBus, slide: -600 }); // drips
    if (Math.random() < 0.08) noise(t, 0.01, { gain: 0.06, type: 'highpass', freq: 3000, bus: musicBus });
    step++;
  }
  function setTrack(sg) {
    song = sg; step = 0;
    if (rainGain) rainGain.gain.setTargetAtTime(sg.rain || 0, ctx.currentTime, 1);
  }
  // sg = a song object to hold, or null to cycle the lobby songs.
  function setSong(sg) {
    if (!sg) { if (!cycle && !SONGS.includes(song)) setTrack(SONGS[0]); cycle = true; return; }
    cycle = false; if (song !== sg) setTrack(sg);
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
    const rain = ctx.createBufferSource(); rain.buffer = noiseBuf; rain.loop = true;
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 1100;
    rainGain = ctx.createGain(); rainGain.gain.value = song.rain || 0;
    rain.connect(rf); rf.connect(rainGain); rainGain.connect(musicBus); rain.start();
    nextTime = ctx.currentTime + 0.1;
    timer = setInterval(() => { while (nextTime < ctx.currentTime + 0.3) { scheduleStep(nextTime); nextTime += STEP(); } }, 80);
  }

  return {
    unlock(files) { init(); if (ctx.state === 'suspended') ctx.resume(); startMusic(files); },
    setSong, LOBBY: SONGS,
    // Character "voice": short random-pitch blips with word gaps. Returns seconds played (0 if audio isn't running yet).
    talk(secs = 3, pitch = 1, wave = 'square') {
      if (!ctx) return 0;
      this.hush();
      const g = ctx.createGain(); g.connect(sfxBus); talkGain = g;
      const t0 = ctx.currentTime + 0.02;
      for (let t = 0; t < secs; t += 0.07 + Math.random() * 0.04) {
        if (Math.random() < 0.15) { t += 0.12; continue; } // pause between "words"
        tone(240 * pitch * (0.85 + Math.random() * 0.45), t0 + t, 0.055, { type: wave, gain: 0.05, bus: g, filter: 2400 });
      }
      return secs;
    },
    hush() { if (talkGain) { talkGain.gain.setTargetAtTime(0, ctx.currentTime, 0.02); talkGain = null; } },
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
