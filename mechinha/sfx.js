// Efeitos sonoros 100% sintetizados (WebAudio) — sem assets, sem licença.
const SFX = (() => {
  let ctx = null;

  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  // desbloqueia o áudio no primeiro toque (exigência dos browsers mobile)
  document.addEventListener('pointerdown', () => { try { ac(); } catch { /* sem áudio */ } }, { once: true });

  function beep(freq, dur = 0.12, type = 'sine', vol = 0.18, when = 0, slideTo = 0) {
    try {
      const c = ac();
      const t = c.currentTime + when;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(c.destination);
      o.start(t);
      o.stop(t + dur + 0.03);
    } catch { /* sem áudio */ }
  }

  return {
    tap: () => beep(620, 0.05, 'square', 0.07),
    pick: () => beep(660, 0.09, 'sine', 0.16, 0, 990),          // conta-gotas: "plic"
    fill: () => beep(340, 0.22, 'sine', 0.16, 0, 170),          // balde: "splash" grave
    done: () => { beep(523, 0.1, 'triangle'); beep(784, 0.14, 'triangle', 0.18, 0.1); },
    horn: () => { beep(392, 0.16, 'sawtooth', 0.13); beep(523, 0.24, 'sawtooth', 0.13, 0.16); }, // caça liberada
    found: () => { beep(700, 0.09, 'square', 0.13); beep(480, 0.14, 'square', 0.13, 0.09); },
    gotOne: () => { [620, 830, 1040].forEach((f, i) => beep(f, 0.09, 'triangle', 0.18, i * 0.08)); },
    caughtMe: () => { beep(420, 0.2, 'sawtooth', 0.18, 0, 210); beep(210, 0.3, 'sawtooth', 0.16, 0.2, 110); },
    miss: () => beep(160, 0.14, 'square', 0.14, 0, 110),
    tick: () => beep(1050, 0.05, 'sine', 0.11),
    fanfare: () => { [523, 659, 784, 1046].forEach((f, i) => beep(f, 0.15, 'triangle', 0.17, i * 0.12)); },
  };
})();
