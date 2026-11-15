"use client";

/**
 * Cutscenes — the LEGEND skill cinematics (2D VFX layers over the 3D room).
 *
 * <PhoenixCut/>   — the resurrection, v2: a REAL multi-phase cinematic.
 *                   0.0s ignition flash · 0.3s the two wings catch fire
 *                   (particle flames crawling along wing arcs) · 1.0s the
 *                   fire bird itself rises through a dense flame trail ·
 *                   2.4s shockburst + spark explosion · 3.4s afterglow.
 *                   No text banner, no cheap SVG — a timed particle engine
 *                   with pre-rendered glow sprites and additive blending.
 * <ThirdEyeCut/>  — the forbidden sight: the screen sinks into violet,
 *                   a slit-pupil eye opens in the dark, a scan beam sweeps,
 *                   ripples ring out and violet motes drift upward while
 *                   the chamber opens.
 *
 * Both are pointer-transparent, self-timed and simply unmount when the
 * parent clears their flag.
 */

import { useEffect, useRef } from "react";

/* ---------------- shared canvas particle helper (third eye) ---------------- */

function useParticles(
  ref: React.RefObject<HTMLCanvasElement | null>,
  opts: {
    duration: number; // ms the canvas keeps animating
    spawnUntil: number; // ms window in which new particles are born
    make: (w: number, h: number, t: number) => Particle | null;
  },
) {
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth || window.innerWidth;
    const h = cv.clientHeight || window.innerHeight;
    cv.width = w * dpr;
    cv.height = h * dpr;
    ctx.scale(dpr, dpr);

    const parts: Particle[] = [];
    const t0 = performance.now();
    let raf = 0;
    let last = t0;
    const tick = (now: number) => {
      const el = now - t0;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      if (el < opts.spawnUntil) {
        for (let i = 0; i < 4; i++) {
          const p = opts.make(w, h, el);
          if (p) parts.push(p);
        }
      }
      ctx.globalAlpha = 1;
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.t += dt;
        p.update(p, dt, el);
        if (p.t >= p.ttl || p.y < -40) {
          parts.splice(i, 1);
          continue;
        }
        const life = p.t / p.ttl;
        const fadeIn = Math.min(1, p.t / 0.12);
        const alpha = p.alpha * fadeIn * (1 - life * life);
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      if (el < opts.duration) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ref, opts]);
}

interface Particle {
  x: number;
  y: number;
  t: number;
  ttl: number;
  size: number;
  alpha: number;
  color: string;
  update: (p: Particle, dt: number, el: number) => void;
}

/* ================= PHOENIX — the resurrection cinematic (v2) ================= */

/**
 * Flame color ramp by remaining life: white-hot core -> gold -> orange ->
 * deep red -> ember dark. `k` = 0 born, 1 dead.
 */
function flameColor(k: number): string {
  if (k < 0.18) return "#fff7dd";
  if (k < 0.38) return "#ffe9a8";
  if (k < 0.58) return "#ffc25e";
  if (k < 0.78) return "#ff8a3d";
  if (k < 0.92) return "#e8542a";
  return "#93301a";
}

interface Ember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  ttl: number;
  size: number;
  swayAmp: number;
  swayFreq: number;
  ph: number;
  kind: 0 | 1 | 2; // 0 = wing flame, 1 = body trail, 2 = spark
}

/** pre-rendered radial glow sprite — one drawImage instead of a gradient
 *  per particle keeps the storm at 60fps even on weak GPUs */
function makeGlowSprite(size = 64): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

function PhoenixCanvas() {
  const cvRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth || window.innerWidth;
    const h = cv.clientHeight || window.innerHeight;
    cv.width = w * dpr;
    cv.height = h * dpr;
    ctx.scale(dpr, dpr);

    const glow = makeGlowSprite();
    const embers: Ember[] = [];
    const DUR = 3500;
    const t0 = performance.now();
    let raf = 0;
    let last = t0;

    /** the two wing arcs the wing-flames crawl along (fractions of w/h) */
    const wingArc = (side: -1 | 1, s: number, rise: number): [number, number] => {
      // shoulder near the player's chest, wing sweeping up + outward
      const bx = 0.37 + side * 0.01;
      const by = 0.72 - rise * 0.1;
      const sx = bx + side * (0.02 + 0.26 * s);
      const sy = by - 0.34 * s * s - 0.05 * s + rise * 0.02;
      return [sx * w, sy * h];
    };

    const spawn = (el: number) => {
      const T = el / DUR;
      // --- wing flames: dense once the wings catch (0.22 -> 0.78) ---
      if (T > 0.08 && T < 0.82) {
        for (let i = 0; i < 5; i++) {
          const side: -1 | 1 = Math.random() < 0.5 ? -1 : 1;
          const s = Math.random();
          const rise = (el - 250) / 3200;
          const [px, py] = wingArc(side, s, rise);
          embers.push({
            x: px + (Math.random() - 0.5) * 26,
            y: py + (Math.random() - 0.5) * 26,
            vx: side * (6 + Math.random() * 14),
            vy: -(46 + Math.random() * 60),
            t: 0,
            ttl: 0.7 + Math.random() * 0.9,
            size: 5 + Math.random() * 13,
            swayAmp: 8 + Math.random() * 22,
            swayFreq: 1.6 + Math.random() * 3,
            ph: Math.random() * Math.PI * 2,
            kind: 0,
          });
        }
      }
      // --- the body: a rising column of dense flame (0.3 -> 0.8) ---
      if (T > 0.28 && T < 0.8) {
        const k = (el - 1000) / 1800; // 0..1 rise progress
        const ek = Math.min(1, Math.max(0, k));
        const ease = 1 - Math.pow(1 - ek, 2);
        const bx = (0.37 + 0.05 * Math.sin(ease * Math.PI * 1.4)) * w;
        const by = (0.8 - 0.5 * ease) * h;
        for (let i = 0; i < 7; i++) {
          embers.push({
            x: bx + (Math.random() - 0.5) * 30,
            y: by + (Math.random() - 0.5) * 20,
            vx: (Math.random() - 0.5) * 16,
            vy: -(70 + Math.random() * 90),
            t: 0,
            ttl: 0.65 + Math.random() * 0.75,
            size: 8 + Math.random() * 16,
            swayAmp: 10 + Math.random() * 24,
            swayFreq: 2 + Math.random() * 3.4,
            ph: Math.random() * Math.PI * 2,
            kind: 1,
          });
        }
        // the white-hot head that leads the rise
        if (Math.random() < 0.5) {
          embers.push({
            x: bx + (Math.random() - 0.5) * 10,
            y: by - 6,
            vx: 0,
            vy: -40,
            t: 0,
            ttl: 0.28,
            size: 16 + Math.random() * 10,
            swayAmp: 4,
            swayFreq: 2,
            ph: 0,
            kind: 1,
          });
        }
      }
      // --- ambient embers all over the room ---
      if (Math.random() < 0.6) {
        embers.push({
          x: w * (0.03 + Math.random() * 0.94),
          y: h * (0.9 + Math.random() * 0.14),
          vx: 6 * (Math.random() - 0.5),
          vy: -(40 + Math.random() * 70),
          t: 0,
          ttl: 1.2 + Math.random() * 1.4,
          size: 1.5 + Math.random() * 3.6,
          swayAmp: 14 + Math.random() * 30,
          swayFreq: 1.4 + Math.random() * 3,
          ph: Math.random() * Math.PI * 2,
          kind: 2,
        });
      }
      // --- the shockburst: one spark explosion (0.68) ---
      if (T > 0.68 && T < 0.74) {
        for (let i = 0; i < 6; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 180 + Math.random() * 340;
          embers.push({
            x: 0.37 * w,
            y: 0.7 * h,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp - 60,
            t: 0,
            ttl: 0.5 + Math.random() * 0.5,
            size: 2 + Math.random() * 4,
            swayAmp: 0,
            swayFreq: 0,
            ph: 0,
            kind: 2,
          });
        }
      }
    };

    const tick = (now: number) => {
      const el = now - t0;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      spawn(el);
      for (let i = embers.length - 1; i >= 0; i--) {
        const p = embers[i];
        p.t += dt;
        if (p.t >= p.ttl) {
          embers.splice(i, 1);
          continue;
        }
        p.x += (p.vx + Math.sin(p.t * p.swayFreq + p.ph) * p.swayAmp) * dt;
        p.y += p.vy * dt;
        if (p.kind === 2) p.vy += 190 * dt; // sparks fall, flames rise
        const k = p.t / p.ttl;
        const fadeIn = Math.min(1, p.t / 0.1);
        const alpha = (p.kind === 1 ? 0.85 : 0.8) * fadeIn * (1 - k * k);
        const size = p.size * (1 - k * 0.55);
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        // tinted glow sprite + a hot core dot
        ctx.globalCompositeOperation = "lighter";
        const tint = flameColor(k);
        ctx.save();
        ctx.globalAlpha = alpha * 0.9;
        ctx.translate(p.x, p.y);
        ctx.scale(size / 64, size / 64);
        ctx.drawImage(glow, -32, -32);
        ctx.restore();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = tint;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.6, size * 0.22), 0, Math.PI * 2);
        ctx.fill();
      }
      if (el < DUR) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={cvRef} className="absolute inset-0 h-full w-full" />;
}

export function PhoenixCut() {
  return (
    <div className="pointer-events-none absolute inset-0 z-[46] overflow-hidden">
      {/* camera push-in on the whole cinematic */}
      <div className="absolute inset-0 phc-camera">
        {/* the room sinks into darkness with a burning rim */}
        <div className="absolute inset-0 phc-veil" />
        {/* fire rays bursting upward */}
        <div className="absolute inset-0 phc-rays" />
        {/* the flash of the charm igniting */}
        <div className="absolute inset-0 phc-flash" />
        {/* the two burning wing glows */}
        <div className="phc-wingglow l" />
        <div className="phc-wingglow r" />
        {/* the particle storm: wing flames + rising body + sparks */}
        <PhoenixCanvas />
        {/* subtle heat shimmer */}
        <div className="absolute inset-0 phc-shimmer" />
        {/* the shock ring at the burst */}
        <div className="phc-ring" />
      </div>
    </div>
  );
}

/* ================= THIRD EYE ================= */

export function ThirdEyeCut() {
  const cvRef = useRef<HTMLCanvasElement>(null);
  useParticles(cvRef, {
    duration: 2100,
    spawnUntil: 1500,
    make: (w, h) => {
      const ttl = 1.6 + Math.random() * 1.4;
      const freq = 0.7 + Math.random() * 1.6;
      const ph = Math.random() * Math.PI * 2;
      const colors = ["#c9b3ec", "#8f6ad4", "#6a45b0", "#d9c9ff"];
      return {
        x: w * (0.05 + Math.random() * 0.9),
        y: h * (0.2 + Math.random() * 0.8),
        t: 0,
        ttl,
        size: 1 + Math.random() * 2.6,
        alpha: 0.5 + Math.random() * 0.4,
        color: colors[(Math.random() * colors.length) | 0],
        update: (p, dt) => {
          p.y -= (14 + Math.random() * 10) * dt;
          p.x += Math.sin(p.t * freq + ph) * 9 * dt;
        },
      };
    },
  });

  return (
    <div className="pointer-events-none absolute inset-0 z-[46] overflow-hidden">
      {/* violet séance tint */}
      <div className="absolute inset-0 eyecut-tint" />
      {/* the scan beam sweeping across the room */}
      <div className="te-beam" style={{ left: "8%" }} />
      <div className="te-beam" style={{ left: "58%", animationDelay: "0.5s" }} />
      {/* drifting violet motes */}
      <canvas ref={cvRef} className="absolute inset-0 h-full w-full" />
      {/* concentric ripples */}
      <div className="eyecut-rings">
        <span />
        <span />
        <span />
      </div>
      {/* the eye itself */}
      <div className="eyecut-eye">
        <svg viewBox="0 0 220 120" aria-hidden>
          {/* almond — solid dark sclera (doodle ink, no gradient tricks) */}
          <path d="M110 14 C158 14 196 42 206 60 C196 78 158 106 110 106 C62 106 24 78 14 60 C24 42 62 14 110 14 Z" fill="#120c20" stroke="#b89ae8" strokeWidth="2.6" />
          {/* sight rays */}
          <g stroke="#b89ae8" strokeWidth="2" opacity="0.85">
            <line className="te-ray te-ray-1" x1="110" y1="60" x2="30" y2="18" />
            <line className="te-ray te-ray-2" x1="110" y1="60" x2="14" y2="66" />
            <line className="te-ray te-ray-3" x1="110" y1="60" x2="34" y2="106" />
          </g>
          {/* iris — layered solid discs + slit pupil */}
          <circle cx="110" cy="60" r="32" fill="#2a174f" />
          <circle cx="110" cy="60" r="26" fill="#4a2b8f" />
          <circle cx="110" cy="60" r="19" fill="#7b4fd4" />
          <circle cx="106" cy="54" r="6" fill="#c9b3ec" opacity="0.85" />
          <ellipse cx="110" cy="60" rx="7.5" ry="24" fill="#0b0714" />
          <ellipse cx="110" cy="60" rx="7.5" ry="24" fill="none" stroke="#d9c9ff" strokeWidth="1.4" opacity="0.8" />
          <circle cx="110" cy="60" r="32" fill="none" stroke="#e2d5ff" strokeWidth="1.2" opacity="0.7" />
          {/* sketchy double stroke (doodle style) */}
          <path d="M110 18 C154 18 190 44 200 60 C190 76 154 102 110 102 C66 102 30 76 20 60 C30 44 66 18 110 18 Z" fill="none" stroke="#8f6ad4" strokeWidth="1.2" opacity="0.65" />
        </svg>
        {/* the glint that fires when the sight locks on */}
        <svg className="te-glint" style={{ left: "50%", top: "50%", width: 90, height: 90, marginLeft: -45, marginTop: -45 }} viewBox="0 0 90 90" aria-hidden>
          <path d="M45 4 L50 38 L86 45 L50 52 L45 86 L40 52 L4 45 L40 38 Z" fill="#e6dcff" />
        </svg>
      </div>
    </div>
  );
}
