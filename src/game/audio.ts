/**
 * audio.ts — mesin SFX prosedural (WebAudio API).
 * Tidak ada file audio eksternal; semua suara disintesis:
 * tembakan, klik blank, dadu, voodoo, detak jantung, ambient drone, dll.
 */

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private ambientNodes: AudioNode[] = [];
  private ambientTimer: number | null = null;
  private heartTimer: number | null = null;
  private muted = false;

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC: typeof AudioContext =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.85;
    this.master.connect(this.ctx.destination);
    // noise buffer 2 detik
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
    }
  }

  get isMuted() {
    return this.muted;
  }

  private now() {
    return this.ctx!.currentTime;
  }

  private noise(dur: number, when = 0): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noiseBuf!;
    src.loop = true;
    src.start(this.now() + when);
    src.stop(this.now() + when + dur + 0.05);
    return src;
  }

  private env(gain: GainNode, t0: number, peak: number, attack: number, decay: number) {
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  private tone(
    type: OscillatorType,
    freq: number,
    dur: number,
    peak: number,
    when = 0,
    slideTo?: number,
  ): OscillatorNode {
    const t0 = this.now() + when;
    const osc = this.ctx!.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(slideTo, 1), t0 + dur);
    const g = this.ctx!.createGain();
    this.env(g, t0, peak, 0.008, dur);
    osc.connect(g).connect(this.master!);
    osc.start(t0);
    osc.stop(t0 + dur + 0.1);
    return osc;
  }

  /* ---------------- UI ---------------- */

  click() {
    if (!this.ctx) return;
    this.tone("triangle", 1400, 0.05, 0.12);
    this.tone("triangle", 900, 0.06, 0.08, 0.02);
  }

  hover() {
    if (!this.ctx) return;
    this.tone("sine", 800, 0.04, 0.04);
  }

  type() {
    if (!this.ctx) return;
    this.tone("square", 1800 + Math.random() * 600, 0.02, 0.03);
  }

  /* ---------------- senjata ---------------- */

  gunshot() {
    if (!this.ctx) return;
    const t0 = this.now();
    // ledakan noise
    const src = this.noise(0.5);
    const bp = this.ctx.createBiquadFilter();
    bp.type = "lowpass";
    bp.frequency.setValueAtTime(9000, t0);
    bp.frequency.exponentialRampToValueAtTime(200, t0 + 0.35);
    const g = this.ctx.createGain();
    this.env(g, t0, 1.0, 0.004, 0.45);
    src.connect(bp).connect(g).connect(this.master!);
    // sub thump
    this.tone("sine", 110, 0.25, 0.9, 0, 40);
    // crack transient
    this.tone("square", 2600, 0.03, 0.35);
    // echo peluru di ruangan
    const echo = this.noise(0.3, 0.12);
    const eg = this.ctx.createGain();
    this.env(eg, t0 + 0.12, 0.18, 0.01, 0.3);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    echo.connect(lp).connect(eg).connect(this.master!);
  }

  blankClick() {
    if (!this.ctx) return;
    const t0 = this.now();
    const src = this.noise(0.05);
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2500;
    const g = this.ctx.createGain();
    this.env(g, t0, 0.5, 0.002, 0.05);
    src.connect(hp).connect(g).connect(this.master!);
    this.tone("triangle", 2100, 0.08, 0.2);
    this.tone("triangle", 640, 0.05, 0.12, 0.03);
  }

  dryFire() {
    if (!this.ctx) return;
    this.tone("triangle", 1200, 0.04, 0.15);
    this.tone("triangle", 500, 0.05, 0.1, 0.03);
  }

  hammerCock() {
    if (!this.ctx) return;
    this.tone("triangle", 900, 0.03, 0.12);
    this.tone("triangle", 1500, 0.03, 0.1, 0.05);
  }

  /* ---------------- reload & shell ---------------- */

  ejectShell() {
    if (!this.ctx) return;
    const t0 = this.now();
    const src = this.noise(0.12);
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(1600, t0);
    bp.frequency.exponentialRampToValueAtTime(500, t0 + 0.12);
    bp.Q.value = 2;
    const g = this.ctx.createGain();
    this.env(g, t0, 0.4, 0.005, 0.12);
    src.connect(bp).connect(g).connect(this.master!);
    this.tone("triangle", 1800, 0.06, 0.15, 0.1);
  }

  reloadOpen() {
    if (!this.ctx) return;
    this.tone("triangle", 500, 0.06, 0.25);
    this.tone("triangle", 240, 0.09, 0.2, 0.05);
  }

  reloadLoad(i: number) {
    if (!this.ctx) return;
    this.tone("triangle", 700 + i * 60, 0.04, 0.2);
    this.tone("square", 2400, 0.015, 0.06, 0.01);
  }

  reloadClose() {
    if (!this.ctx) return;
    this.tone("triangle", 300, 0.05, 0.35);
    this.tone("square", 2000, 0.02, 0.12, 0.04);
    this.tone("triangle", 180, 0.12, 0.3, 0.05);
  }

  spinCylinder() {
    if (!this.ctx) return;
    // derakan deretan klik cepat
    for (let i = 0; i < 14; i++) {
      this.tone("triangle", 1100 + Math.random() * 700, 0.02, 0.08, i * 0.028);
    }
  }

  /* ---------------- skill ---------------- */

  rerollTick() {
    if (!this.ctx) return;
    for (let i = 0; i < 8; i++) {
      this.tone("square", 1300 + i * 90, 0.02, 0.08, i * 0.045);
    }
    this.tone("triangle", 2100, 0.12, 0.2, 0.4);
  }

  scanDing() {
    if (!this.ctx) return;
    this.tone("sine", 1500, 0.3, 0.2);
    this.tone("sine", 2250, 0.4, 0.12, 0.06);
  }

  heal() {
    if (!this.ctx) return;
    const notes = [520, 660, 780];
    notes.forEach((f, i) => this.tone("sine", f, 0.18, 0.18, i * 0.09));
    this.tone("sine", 1040, 0.25, 0.1, 0.3);
  }

  cuffs() {
    if (!this.ctx) return;
    for (let i = 0; i < 5; i++) {
      this.tone("triangle", 2600 + Math.random() * 1400, 0.05, 0.12, i * 0.06);
    }
    this.tone("square", 300, 0.08, 0.15, 0.32);
  }

  voodooCast() {
    if (!this.ctx) return;
    const t0 = this.now();
    for (const f of [98, 104, 147]) {
      const osc = this.ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(f, t0);
      osc.frequency.linearRampToValueAtTime(f * 0.82, t0 + 1.2);
      const g = this.ctx.createGain();
      this.env(g, t0, 0.1, 0.15, 1.1);
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 700;
      osc.connect(lp).connect(g).connect(this.master!);
      osc.start(t0);
      osc.stop(t0 + 1.4);
    }
    // bisikan
    const src = this.noise(0.9);
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 3000;
    bp.Q.value = 6;
    const g2 = this.ctx.createGain();
    this.env(g2, t0 + 0.1, 0.1, 0.2, 0.7);
    src.connect(bp).connect(g2).connect(this.master!);
  }

  voodooReflect() {
    if (!this.ctx) return;
    this.tone("sawtooth", 220, 0.35, 0.25, 0, 1600);
    this.tone("sine", 880, 0.4, 0.2, 0.05, 1760);
    for (let i = 0; i < 6; i++) {
      this.tone("sine", 1400 + i * 300, 0.08, 0.1, 0.1 + i * 0.05);
    }
  }

  /* ---------------- dadu ---------------- */

  diceShake() {
    if (!this.ctx) return;
    for (let i = 0; i < 6; i++) {
      const t0 = this.now() + i * 0.07;
      const src = this.noise(0.04);
      const hp = this.ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 1800;
      const g = this.ctx.createGain();
      this.env(g, t0, 0.2, 0.003, 0.05);
      src.connect(hp).connect(g).connect(this.master!);
    }
  }

  diceRoll() {
    if (!this.ctx) return;
    // rattle memanjang makin jarang
    let t = 0;
    for (let i = 0; i < 16; i++) {
      const t0 = this.now() + t;
      const src = this.noise(0.03);
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1200 + Math.random() * 2000;
      bp.Q.value = 3;
      const g = this.ctx.createGain();
      this.env(g, t0, 0.16, 0.003, 0.04);
      src.connect(bp).connect(g).connect(this.master!);
      t += 0.05 + i * 0.014;
    }
  }

  diceLand() {
    if (!this.ctx) return;
    this.tone("triangle", 260, 0.1, 0.4);
    this.tone("triangle", 520, 0.06, 0.2, 0.03);
    this.tone("square", 3000, 0.02, 0.06, 0.04);
  }

  stamp() {
    if (!this.ctx) return;
    this.tone("sine", 140, 0.12, 0.5);
    const t0 = this.now();
    const src = this.noise(0.08);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1200;
    const g = this.ctx.createGain();
    this.env(g, t0, 0.3, 0.003, 0.09);
    src.connect(lp).connect(g).connect(this.master!);
  }

  /* ---------------- hit & emosi ---------------- */

  hitPlayer() {
    if (!this.ctx) return;
    this.tone("sine", 90, 0.3, 0.8, 0, 45);
    const t0 = this.now();
    const src = this.noise(0.2);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 500;
    const g = this.ctx.createGain();
    this.env(g, t0, 0.5, 0.005, 0.2);
    src.connect(lp).connect(g).connect(this.master!);
  }

  hitEnemy() {
    if (!this.ctx) return;
    this.tone("sine", 140, 0.25, 0.6, 0, 60);
    const t0 = this.now();
    const src = this.noise(0.15);
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900;
    const g = this.ctx.createGain();
    this.env(g, t0, 0.4, 0.005, 0.16);
    src.connect(bp).connect(g).connect(this.master!);
  }

  laugh() {
    if (!this.ctx) return;
    // "he he he" — formant pendek turun
    for (let i = 0; i < 4; i++) {
      this.tone("sawtooth", 320 - i * 24, 0.09, 0.12, i * 0.14, 240 - i * 20);
    }
  }

  gasp() {
    if (!this.ctx) return;
    const t0 = this.now();
    const src = this.noise(0.3);
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(600, t0);
    bp.frequency.exponentialRampToValueAtTime(2400, t0 + 0.25);
    bp.Q.value = 2;
    const g = this.ctx.createGain();
    this.env(g, t0, 0.15, 0.1, 0.25);
    src.connect(bp).connect(g).connect(this.master!);
  }

  /* ---------------- heartbeat ---------------- */

  startHeartbeat(fast = false) {
    this.stopHeartbeat();
    if (!this.ctx) return;
    const beat = () => {
      if (!this.ctx) return;
      const t0 = this.now();
      for (const [dt, f, p] of [
        [0, 58, 0.5],
        [0.16, 48, 0.35],
      ] as [number, number, number][]) {
        const osc = this.ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(f, t0 + dt);
        osc.frequency.exponentialRampToValueAtTime(f * 0.6, t0 + dt + 0.12);
        const g = this.ctx.createGain();
        this.env(g, t0 + dt, p, 0.01, 0.14);
        osc.connect(g).connect(this.master!);
        osc.start(t0 + dt);
        osc.stop(t0 + dt + 0.3);
      }
      this.heartTimer = window.setTimeout(beat, fast ? 480 : 850);
    };
    beat();
  }

  stopHeartbeat() {
    if (this.heartTimer !== null) {
      clearTimeout(this.heartTimer);
      this.heartTimer = null;
    }
  }

  /* ---------------- ambience ---------------- */

  startAmbient() {
    if (!this.ctx || this.ambientTimer !== null) return;
    const t0 = this.now();
    // drone rendah dua osilator detune
    const g = this.ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.setTargetAtTime(0.055, t0, 2);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 240;
    for (const f of [52, 55.5, 104]) {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f;
      const og = this.ctx.createGain();
      og.gain.value = f > 100 ? 0.35 : 1;
      osc.connect(og).connect(lp);
      osc.start(t0);
      this.ambientNodes.push(osc);
    }
    // LFO pelan ke gain (napas ruangan)
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 0.02;
    lfo.connect(lfoG).connect(g.gain);
    lfo.start(t0);
    this.ambientNodes.push(lfo, g, lp);
    lp.connect(g).connect(this.master!);
    // sesekali derik kayu
    const creak = () => {
      if (!this.ctx) return;
      const t1 = this.now();
      const osc = this.ctx.createOscillator();
      osc.type = "sawtooth";
      const f0 = 90 + Math.random() * 120;
      osc.frequency.setValueAtTime(f0, t1);
      osc.frequency.linearRampToValueAtTime(f0 * (0.7 + Math.random() * 0.5), t1 + 0.5);
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = f0 * 4;
      bp.Q.value = 8;
      const cg = this.ctx.createGain();
      this.env(cg, t1, 0.03, 0.1, 0.5);
      osc.connect(bp).connect(cg).connect(this.master!);
      osc.start(t1);
      osc.stop(t1 + 0.8);
      this.ambientTimer = window.setTimeout(creak, 6000 + Math.random() * 9000);
    };
    this.ambientTimer = window.setTimeout(creak, 4000);
  }

  stopAmbient() {
    if (this.ambientTimer !== null) {
      clearTimeout(this.ambientTimer);
      this.ambientTimer = null;
    }
    for (const n of this.ambientNodes) {
      try {
        (n as OscillatorNode).stop?.();
      } catch {
        /* noop */
      }
      try {
        n.disconnect();
      } catch {
        /* noop */
      }
    }
    this.ambientNodes = [];
  }

  /* ---------------- sting menang/kalah ---------------- */

  win() {
    if (!this.ctx) return;
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => this.tone("triangle", f, 0.35, 0.22, i * 0.14));
    this.tone("triangle", 1568, 0.6, 0.15, 0.6);
  }

  lose() {
    if (!this.ctx) return;
    const notes = [392, 311, 233, 155];
    notes.forEach((f, i) => this.tone("sawtooth", f, 0.5, 0.16, i * 0.22));
    this.tone("sine", 40, 1.6, 0.4, 0.6, 30);
  }

  /* ---------------- tension ---------------- */

  riser(dur = 1.2) {
    if (!this.ctx) return;
    const t0 = this.now();
    const src = this.noise(dur);
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(300, t0);
    bp.frequency.exponentialRampToValueAtTime(4200, t0 + dur);
    bp.Q.value = 4;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.22, t0 + dur * 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.15);
    src.connect(bp).connect(g).connect(this.master!);
  }
}

export const gameAudio = new GameAudio();
