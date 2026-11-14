"use client";

/**
 * Cutscenes — the LEGEND skill cinematics (2D VFX layers over the 3D room).
 *
 * <PhoenixCut/>   — the resurrection: golden flash, a burning wing flare,
 *                   an ember storm rising across the screen and a shock
 *                   ring. Replaces the old big-text banner entirely.
 * <ThirdEyeCut/>  — the forbidden sight: the screen sinks into violet,
 *                   a slit-pupil eye opens in the dark, ripples ring out
 *                   and violet motes drift upward while the chamber opens.
 *
 * Both are pointer-transparent, self-timed (CSS + canvas particles) and
 * simply unmount when the parent clears their flag.
 */

import { useEffect, useRef } from "react";

/* ---------------- shared canvas particle helper ---------------- */

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

/* ================= PHOENIX ================= */

const EMBER_COLORS = ["#ffd98a", "#ffb347", "#ff8a3d", "#e8542a", "#fff3c4"];

export function PhoenixCut() {
  const cvRef = useRef<HTMLCanvasElement>(null);
  useParticles(cvRef, {
    duration: 2650,
    spawnUntil: 1750,
    make: (w, h) => {
      const big = Math.random() < 0.14;
      const ttl = 1.1 + Math.random() * 1.5;
      const swayAmp = 14 + Math.random() * 34;
      const freq = 1.6 + Math.random() * 3.2;
      const ph = Math.random() * Math.PI * 2;
      const baseY = h * (0.86 + Math.random() * 0.2);
      return {
        x: w * (0.02 + Math.random() * 0.96),
        y: baseY,
        t: 0,
        ttl,
        size: big ? 5 + Math.random() * 5 : 1.4 + Math.random() * 3.4,
        alpha: big ? 0.55 : 0.9,
        color: EMBER_COLORS[(Math.random() * EMBER_COLORS.length) | 0],
        update: (p, dt) => {
          const k = p.t / p.ttl;
          p.y -= (60 + k * 150) * dt * (big ? 0.6 : 1);
          p.x += Math.sin(p.t * freq + ph) * swayAmp * dt + 6 * dt;
          if (p.t < 0.1) p.y = baseY;
        },
      };
    },
  });

  return (
    <div className="pointer-events-none absolute inset-0 z-[46] overflow-hidden">
      {/* the room sinks into darkness with a burning rim */}
      <div className="absolute inset-0 phoenix-dark" />
      {/* the flash of the charm igniting */}
      <div className="absolute inset-0 phoenix-flash" />
      {/* ember storm */}
      <canvas ref={cvRef} className="absolute inset-0 h-full w-full" />
      {/* the burning wings unfurl behind you */}
      <svg className="phoenix-wings" viewBox="0 0 220 130" aria-hidden>
        <defs>
          <linearGradient id="ph-wing" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#e8542a" stopOpacity="0.85" />
            <stop offset="0.55" stopColor="#ff8a3d" stopOpacity="0.8" />
            <stop offset="1" stopColor="#ffd98a" stopOpacity="0.55" />
          </linearGradient>
        </defs>
        {/* left wing */}
        <g className="ph-wing-l">
          <path d="M108 122 C64 116 30 96 8 54 C34 72 62 80 92 82 C64 68 44 50 30 24 C58 44 84 54 104 56 C86 40 76 26 72 10 C92 28 104 44 110 58 Z" fill="url(#ph-wing)" opacity="0.9" />
          <path d="M108 122 C66 114 34 92 14 56" fill="none" stroke="#ffe9b0" strokeWidth="2.4" opacity="0.9" />
          <path d="M106 96 C78 88 56 72 40 46" fill="none" stroke="#ffd27a" strokeWidth="1.8" opacity="0.7" />
        </g>
        {/* right wing (mirror) */}
        <g transform="translate(220,0) scale(-1,1)">
          <path d="M108 122 C64 116 30 96 8 54 C34 72 62 80 92 82 C64 68 44 50 30 24 C58 44 84 54 104 56 C86 40 76 26 72 10 C92 28 104 44 110 58 Z" fill="url(#ph-wing)" opacity="0.9" />
          <path d="M108 122 C66 114 34 92 14 56" fill="none" stroke="#ffe9b0" strokeWidth="2.4" opacity="0.9" />
          <path d="M106 96 C78 88 56 72 40 46" fill="none" stroke="#ffd27a" strokeWidth="1.8" opacity="0.7" />
        </g>
        {/* the heart of the flame */}
        <circle cx="110" cy="108" r="14" fill="#fff3c4" opacity="0.95" />
        <circle cx="110" cy="108" r="24" fill="#ffb347" opacity="0.4" />
      </svg>
      {/* shock ring */}
      <div className="phoenix-ring" />
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
      </div>
    </div>
  );
}
