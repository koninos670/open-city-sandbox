/* All sound is synthesised at runtime with the Web Audio API — no audio assets needed. */
(function (G) {
  'use strict';
  var A = G.audio = { ready: false, muted: false };
  var ctx, master, noiseBuf;

  A.init = function () {
    if (A.ready) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);

    // one second of white noise, reused by every noise-based sound
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    A.ready = true;
    A.startEngine();
    A.startSiren();
  };

  A.resume = function () { if (ctx && ctx.state === 'suspended') ctx.resume(); };
  A.setVolume = function (v) { if (master) master.gain.value = v; };

  function now() { return ctx ? ctx.currentTime : 0; }
  function noise(dur, gain, filterType, freq, q) {
    // the audio context only exists after the first user gesture, so every sound has to
    // tolerate being asked for before that
    if (!A.ready || A.muted) return null;
    var src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    var f = ctx.createBiquadFilter(); f.type = filterType || 'lowpass'; f.frequency.value = freq || 1200;
    if (q) f.Q.value = q;
    var g = ctx.createGain();
    g.gain.setValueAtTime(gain, now());
    g.gain.exponentialRampToValueAtTime(0.0001, now() + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(); src.stop(now() + dur + 0.02);
    return { g: g, f: f };
  }

  // weapon report: low thump + bright crack, tuned per weapon
  A.shot = function (kind) {
    if (!A.ready || A.muted) return;
    var p = kind === 'shotgun' ? { d: 0.42, hp: 0.5, lp: 1800, lp2: 260, lvl: 0.9 }
      : kind === 'rifle' ? { d: 0.22, hp: 0.42, lp: 3200, lp2: 300, lvl: 0.8 }
        : kind === 'smg' ? { d: 0.14, hp: 0.32, lp: 2600, lp2: 320, lvl: 0.7 }
          : { d: 0.18, hp: 0.36, lp: 2400, lp2: 260, lvl: 0.75 };
    noise(p.d, p.hp, 'bandpass', p.lp, 0.7);
    noise(p.d * 1.4, p.lp2 * 0.0009 + 0.1, 'lowpass', p.lp2);
    var o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(kind === 'shotgun' ? 150 : 190, now());
    o.frequency.exponentialRampToValueAtTime(50, now() + p.d);
    var g = ctx.createGain();
    g.gain.setValueAtTime(p.lvl * 0.5, now());
    g.gain.exponentialRampToValueAtTime(0.0001, now() + p.d);
    o.connect(g); g.connect(master); o.start(); o.stop(now() + p.d + 0.02);
  };

  A.explosion = function () {
    if (!A.ready || A.muted) return;
    noise(1.2, 0.75, 'lowpass', 420);
    noise(0.35, 0.5, 'highpass', 900);
    var o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(70, now()); o.frequency.exponentialRampToValueAtTime(28, now() + 0.9);
    var g = ctx.createGain(); g.gain.setValueAtTime(0.7, now());
    g.gain.exponentialRampToValueAtTime(0.0001, now() + 1.0);
    o.connect(g); g.connect(master); o.start(); o.stop(now() + 1.05);
  };

  A.impact = function (hard) { noise(hard ? 0.22 : 0.09, hard ? 0.35 : 0.16, 'bandpass', hard ? 900 : 2200, 1.2); };
  A.hitFlesh = function () { noise(0.12, 0.3, 'lowpass', 700); };
  A.step = function () { noise(0.06, 0.09, 'bandpass', 1400, 1.5); };
  A.horn = function () {
    if (!A.ready || A.muted) return;
    [380, 470].forEach(function (f, i) {
      var o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      var g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now());
      g.gain.linearRampToValueAtTime(0.16, now() + 0.03);
      g.gain.setValueAtTime(0.16, now() + 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, now() + 0.45);
      o.connect(g); g.connect(master); o.start(); o.stop(now() + 0.5);
    });
  };
  A.pickup = function () {
    if (!A.ready || A.muted) return;
    [660, 990].forEach(function (f, i) {
      var o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
      var g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now() + i * 0.07);
      g.gain.linearRampToValueAtTime(0.1, now() + i * 0.07 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now() + i * 0.07 + 0.14);
      o.connect(g); g.connect(master); o.start(now() + i * 0.07); o.stop(now() + i * 0.07 + 0.16);
    });
  };
  A.ui = function () {
    if (!A.ready || A.muted) return;
    var o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 520;
    var g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now());
    g.gain.linearRampToValueAtTime(0.12, now() + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now() + 0.12);
    o.connect(g); g.connect(master); o.start(); o.stop(now() + 0.14);
  };

  // ---- persistent loops: engine + police siren ----
  var eng = null, sire = null;
  A.startEngine = function () {
    if (!A.ready) return;
    var o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 60;
    var o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 90;
    var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
    var g = ctx.createGain(); g.gain.value = 0;
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(master);
    o1.start(); o2.start();
    eng = { o1: o1, o2: o2, g: g, f: f };
  };
  A.engine = function (rpm01, load, loud) {
    if (!eng) return;
    var base = 48 + rpm01 * 150;
    eng.o1.frequency.setTargetAtTime(base, now(), 0.05);
    eng.o2.frequency.setTargetAtTime(base * 1.51, now(), 0.05);
    eng.f.frequency.setTargetAtTime(400 + rpm01 * 2200, now(), 0.06);
    eng.g.gain.setTargetAtTime(A.muted ? 0 : load * (loud === undefined ? 0.06 : loud), now(), 0.08);
  };
  A.startSiren = function () {
    if (!A.ready) return;
    var o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 700;
    var lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 3.6;
    var lg = ctx.createGain(); lg.gain.value = 220;
    var g = ctx.createGain(); g.gain.value = 0;
    lfo.connect(lg); lg.connect(o.frequency);
    o.connect(g); g.connect(master);
    o.start(); lfo.start();
    sire = { g: g, o: o };
  };
  A.siren = function (volume) {
    if (!sire) return;
    sire.g.gain.setTargetAtTime(A.muted ? 0 : volume * 0.05, now(), 0.15);
  };
  A.setMute = function (m) {
    A.muted = m;
    if (master) master.gain.value = m ? 0 : 0.55;
  };

})(window.G);
