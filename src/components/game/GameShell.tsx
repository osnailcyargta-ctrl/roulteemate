"use client";

/**
 * GameShell — React layer for ROULETTE-MATE.
 * Mounts the engine (Three.js) plus all doodle overlays: the animated
 * main menu (title top-left, 3 buttons bottom-left), settings, HP,
 * shell counter, skill bar, toasts, banner, rules, win/lose screens,
 * and the low-HP blood vignette.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GameEngine, type HudEvent, type HudSnapshot } from "@/game/engine";
import {
  SKILL_META,
  dataURL,
  texBulletPip,
  texDiffIcon,
  texHeart,
  texSkillIcon,
  texSplat,
  texVoodooMask,
  type SkillId,
} from "@/game/doodle";
import type { ShellType } from "@/game/logic";
import { gameAudio } from "@/game/audio";

type Toast = { id: number; text: string; tone: string; leaving?: boolean };
type Pop = { id: number; side: string; text: string; tone: string };
type Splat = { id: number; url: string; left: number; top: number; size: number; rot: number };
type Stamp = { id: number; idSkill: SkillId };
type MenuPanel = "play" | "settings" | null;

type Quality = "low" | "medium" | "high";

/** All toggles the SETTINGS screen owns (persisted in localStorage). */
type Settings = {
  muted: boolean;
  quality: Quality;
  /** the live/blank counter board at the top */
  showShellStat: boolean;
  /** TIME expands into these two */
  showRoundTime: boolean;
  showTotalTime: boolean;
  /** frame-per-second meter right above the YOU indicator */
  showFps: boolean;
};

const SETTINGS_KEY = "roulette-mate-settings";
const DEFAULT_SETTINGS: Settings = {
  muted: false,
  quality: "high",
  showShellStat: true,
  showRoundTime: true,
  showTotalTime: true,
  showFps: false,
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* corrupted storage — fall back to defaults */
  }
  return DEFAULT_SETTINGS;
}

const DIFFS: { id: "easy" | "normal" | "insane"; label: string; desc: string }[] = [
  { id: "easy", label: "EASY", desc: "Your 6 HP vs his 5. The Dealer has 1 skill." },
  { id: "normal", label: "NORMAL", desc: "5 vs 5 HP. The Dealer has 2 skills." },
  { id: "insane", label: "INSANE", desc: "Your 4 HP vs his 5. 3 skills + shop legends." },
];

const fmtTime = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export default function GameShell() {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const evId = useRef(0);
  const [ready, setReady] = useState(false);
  const [snap, setSnap] = useState<HudSnapshot | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pops, setPops] = useState<Pop[]>([]);
  const [splats, setSplats] = useState<Splat[]>([]);
  const [stamps, setStamps] = useState<Stamp[]>([]);
  const [banner, setBanner] = useState<{ title: string; sub?: string } | null>(null);
  const [reveal, setReveal] = useState<{ shell: "live" | "blank" } | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [diff, setDiff] = useState<"easy" | "normal" | "insane">("normal");
  const [reloadPips, setReloadPips] = useState(0);
  const [flashRed, setFlashRed] = useState(false);
  const [revealQueue, setRevealQueue] = useState<(ShellType | null)[] | null>(null);
  const [times, setTimes] = useState<{ roundMs: number; totalMs: number }>({ roundMs: 0, totalMs: 0 });
  const [shopTip, setShopTip] = useState<{ id: SkillId | "bell"; xPct: number; yPct: number } | null>(null);

  /* ---------- MAIN MENU screens ---------- */
  const [menuPanel, setMenuPanel] = useState<MenuPanel>(null);
  /* ---------- SETTINGS (persisted) ---------- */
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [timeOpen, setTimeOpen] = useState(false);
  /* ---------- FPS meter ---------- */
  const [fps, setFps] = useState(0);

  /* load persisted settings once */
  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        /* private mode — settings just won't persist */
      }
      return next;
    });
  }, []);

  /* apply sound + graphics settings */
  useEffect(() => {
    gameAudio.setMuted(settings.muted);
  }, [settings.muted]);

  useEffect(() => {
    if (ready) engineRef.current?.setSceneQuality(settings.quality);
  }, [settings.quality, ready]);

  /* FPS meter (only measured while visible) */
  useEffect(() => {
    if (!settings.showFps) return;
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    const tick = () => {
      frames++;
      const now = performance.now();
      if (now - last >= 500) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [settings.showFps]);

  /* ---------- HUD asset dataURLs (after mount, client-only) ---------- */
  const assets = useMemo(() => {
    if (!ready) return null;
    return {
      heartFull: dataURL("heart-full", texHeart("full")),
      heartEmpty: dataURL("heart-empty", texHeart("empty")),
      pipLive: dataURL("pip-live", texBulletPip("live")),
      pipBlank: dataURL("pip-blank", texBulletPip("blank")),
      voodoo: dataURL("voodoo-mask", texVoodooMask()),
      splat0: dataURL("splat-hud-0", texSplat(333)),
      splat1: dataURL("splat-hud-1", texSplat(444)),
      diffEasy: dataURL("diff-easy", texDiffIcon("easy")),
      diffNormal: dataURL("diff-normal", texDiffIcon("normal")),
      diffInsane: dataURL("diff-insane", texDiffIcon("insane")),
    };
  }, [ready]);

  const assetsRef = useRef(assets);
  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  const handleEvent = useCallback((e: HudEvent) => {
    const id = ++evId.current;
    switch (e.type) {
      case "toast": {
        setToasts((t) => [...t.slice(-4), { id, text: e.text, tone: e.tone ?? "info" }]);
        // graceful exit: slide-fade out before removal
        setTimeout(() => setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x))), 2700);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
        break;
      }
      case "banner":
        setBanner({ title: e.title, sub: e.sub });
        setTimeout(() => setBanner(null), e.long ? 2600 : 1700);
        break;
      case "skillGet":
        setStamps((s) => [...s, { id, idSkill: e.id }]);
        setTimeout(() => setStamps((s) => s.filter((x) => x.id !== id)), 1500);
        break;
      case "shellReveal":
        if (e.shell) {
          setReveal({ shell: e.shell });
          setTimeout(() => setReveal(null), 1900);
        }
        break;
      case "shellRevealQueue":
        setRevealQueue(e.shells);
        setTimeout(() => setRevealQueue(null), 2800);
        break;
      case "dmgPop":
        setPops((p) => [...p.slice(-5), { id, side: e.side, text: e.text, tone: e.tone ?? "hit" }]);
        setTimeout(() => setPops((p) => p.filter((x) => x.id !== id)), 1500);
        break;
      case "screenSplat": {
        const url = evId.current % 2 === 0 ? "splat-hud-0" : "splat-hud-1";
        const a = assetsRef.current;
        if (!a) break;
        setSplats((s) => [
          ...s.slice(-3),
          {
            id,
            url: a[url],
            left: 15 + Math.random() * 55,
            top: 8 + Math.random() * 50,
            size: 130 + Math.random() * 160,
            rot: Math.random() * 360,
          },
        ]);
        setFlashRed(true);
        setTimeout(() => setFlashRed(false), 180);
        setTimeout(() => setSplats((s) => s.filter((x) => x.id !== id)), 2600);
        break;
      }
      case "skillFlash":
        break;
      case "reloadStep":
        setReloadPips(e.loaded);
        setTimeout(() => setReloadPips(0), 2400);
        break;
      case "shopTip":
        setShopTip(e.id ? { id: e.id, xPct: e.xPct, yPct: e.yPct } : null);
        break;
    }
  }, []);

  /* ---------- mount engine ---------- */
  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        await document.fonts.ready;
      } catch {
        /* noop */
      }
      if (disposed || !mountRef.current) return;
      const engine = new GameEngine();
      engineRef.current = engine;
      (window as unknown as { __eng?: GameEngine }).__eng = engine;
      engine.onHud = (s) => setSnap(s);
      engine.onEvent = (e) => handleEvent(e);
      engine.mount(mountRef.current);
      setReady(true);
    })();
    return () => {
      disposed = true;
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  const toggleMute = useCallback(() => {
    updateSettings({ muted: !settings.muted });
  }, [settings.muted, updateSettings]);

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const eng = engineRef.current;
      const k = ev.key.toLowerCase();
      if (k === "escape") {
        setMenuPanel(null);
        setShowHelp(false);
        return;
      }
      if (!eng || !snap) return;
      if (k === "q") void eng.playerShoot("player");
      else if (k === "e") void eng.playerShoot("enemy");
      else if (k === "h") setShowHelp((v) => !v);
      else if (k === "m") toggleMute();
      else if (/^[1-4]$/.test(k)) {
        const owned = snap.skills.filter((s) => s.owned && s.ghostTurns <= 0);
        const target = owned[parseInt(k) - 1];
        if (target) void eng.playerUseSkill(target.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [snap, toggleMute]);

  /* ---------- playtime ticker (round + total) ---------- */
  const phaseKey = snap?.phase ?? "menu";
  useEffect(() => {
    if (phaseKey === "menu") return;
    const tick = () => setTimes(engineRef.current?.getTimes() ?? { roundMs: 0, totalMs: 0 });
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [phaseKey]);

  const isPlayerTurn = snap?.phase === "playerTurn" && snap.turn === "player" && !snap.busy;
  const phase = snap?.phase ?? "menu";
  const inGame = phase !== "menu";
  const lowHp = inGame && snap ? snap.hpPlayer : 0;

  /* ---------- render ---------- */
  return (
    <div className="fixed inset-0 overflow-hidden bg-[#0b0a08] select-none">
      {/* 3D world */}
      <div ref={mountRef} className="absolute inset-0" />

      {/* cinematic overlays */}
      <div className="pointer-events-none absolute inset-0 vignette-overlay z-10" />
      <div className="pointer-events-none absolute inset-0 grain-overlay z-10" />
      {flashRed && <div className="pointer-events-none absolute inset-0 z-10 bg-[rgba(199,62,46,0.35)]" />}

      {/* LOW-HP BLOOD VIGNETTE: starts at 2 HP, thickest at 1 HP */}
      {snap && lowHp === 2 && (
        <div className="pointer-events-none absolute inset-0 z-10 blood-vignette" />
      )}
      {snap && lowHp === 1 && (
        <>
          <div className="pointer-events-none absolute inset-0 z-10 blood-vignette heavy" />
          <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
            <span className="blood-drip drip-1" />
            <span className="blood-drip drip-2" />
            <span className="blood-drip drip-3" />
            <span className="blood-drip drip-4" />
          </div>
          <div className="pointer-events-none absolute inset-0 z-10 pulse-danger" />
        </>
      )}

      {snap && snap.voodooPlayer > 0 && phase !== "menu" && (
        <div
          className="pointer-events-none absolute inset-0 z-10"
          style={{ boxShadow: "inset 0 0 120px rgba(94,156,91,0.45)" }}
        />
      )}

      {/* blood on screen */}
      <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
        {assets &&
          splats.map((s) => (
            <img
              key={s.id}
              src={s.url}
              alt=""
              className="absolute pop-in"
              style={{
                left: `${s.left}%`,
                top: `${s.top}%`,
                width: s.size,
                transform: `rotate(${s.rot}deg)`,
                transition: "opacity 1.2s ease 1s",
                opacity: 0.92,
              }}
            />
          ))}
      </div>

      {/* damage pops */}
      <div className="pointer-events-none absolute inset-0 z-30">
        {pops.map((p) => (
          <div
            key={p.id}
            className={`absolute rise-fade font-marker text-3xl drop-shadow-[3px_3px_0_rgba(0,0,0,0.7)] ${
              p.tone === "reflect" ? "text-[#8fdc8a]" : p.tone === "blank" ? "text-[#cfd8e3]" : "text-[#ff6b57]"
            }`}
            style={p.side === "enemy" ? { left: "58%", top: "28%" } : { left: "42%", top: "62%" }}
          >
            {p.text}
          </div>
        ))}
      </div>

      {/* ================= IN-GAME HUD ================= */}
      {inGame && assets && snap && (
        <>
          {/* shell counter board — the honest numbers fade turn by turn,
              their opacity really stepping down until it hits zero.
              Can be switched off entirely in SETTINGS > UI & QOL. */}
          {snap.round > 0 && settings.showShellStat && (
          <div className="absolute left-1/2 top-3 z-30 -translate-x-1/2">
            <div className="relative">
              <div
                className="doodle-box flex items-center gap-3 px-4 py-1.5 transition-opacity duration-[1100ms] ease-in-out"
                style={{ opacity: snap.countsPublic ? Math.min(1, snap.countdown / 3) : 0 }}
              >
                <div className="flex items-center gap-1">
                  <img src={assets.pipLive} alt="live" className="h-7 w-7" />
                  <span className="font-marker text-xl text-[#8f2418]">x{snap.live}</span>
                </div>
                <div className="h-6 w-0.5 bg-[#221a12]/30" />
                <div className="flex items-center gap-1">
                  <img src={assets.pipBlank} alt="blank" className="h-7 w-7" />
                  <span className="font-marker text-xl text-[#57697c]">x{snap.blank}</span>
                </div>
              </div>
              {!snap.countsPublic && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="doodle-box doodle-dark board-dark-box pop-in-delayed flex items-center gap-2 whitespace-nowrap px-4 py-1.5">
                    <span className="font-marker text-xl tracking-widest text-[#8b8577]">? ? ?</span>
                    <span className="rotate-[-2deg] font-hand-sc text-xs text-[#d9a441]">memorize!</span>
                  </div>
                </div>
              )}
            </div>
            {snap.known && (
              <div className="mt-1 flex justify-center">
                <div
                  className={`pop-in font-hand-sc px-2 py-0.5 border-2 border-[#221a12] bg-[#f3ecd7] text-sm rotate-[-2deg] ${
                    snap.known === "live" ? "text-[#8f2418]" : "text-[#57697c]"
                  }`}
                >
                  CHAMBER: {snap.known.toUpperCase()}
                </div>
              </div>
            )}
          </div>
          )}
          {snap.round > 0 && !settings.showShellStat && snap.known && (
            <div className="absolute left-1/2 top-3 z-30 -translate-x-1/2">
              <div
                className={`pop-in font-hand-sc px-2 py-0.5 border-2 border-[#221a12] bg-[#f3ecd7] text-sm rotate-[-2deg] ${
                  snap.known === "live" ? "text-[#8f2418]" : "text-[#57697c]"
                }`}
              >
                CHAMBER: {snap.known.toUpperCase()}
              </div>
            </div>
          )}

          {/* top left: round + cash + optional timers (toggles in SETTINGS) */}
          <div className="absolute left-2 top-2 z-30 flex flex-col gap-1.5 sm:left-3 sm:top-3 sm:gap-2">
            <div className="doodle-box doodle-dark px-2 py-0.5 font-marker text-xs rotate-[-1.5deg] sm:px-3 sm:py-1 sm:text-sm">
              ROUND {Math.max(1, snap.round)}
            </div>
            <div
              className="doodle-box w-fit px-2 py-0.5 font-marker text-xs text-[#8a6d1d] rotate-[1deg] sm:text-sm"
              title="Cash — land bullets ($100), voodoo reflections ($150), survive rounds ($75). Between rounds 3 random items appear on the table."
            >
              $ {snap.money}
            </div>
            {(settings.showRoundTime || settings.showTotalTime) && (
              <div className="flex gap-1.5">
                {settings.showRoundTime && (
                  <div className="doodle-box doodle-dark px-2 py-0.5 font-hand-sc text-[10px] sm:text-xs" title="Playtime in this round">
                    RND {fmtTime(times.roundMs)}
                  </div>
                )}
                {settings.showTotalTime && (
                  <div className="doodle-box doodle-dark px-2 py-0.5 font-hand-sc text-[10px] sm:text-xs" title="Playtime across all rounds">
                    SUM {fmtTime(times.totalMs)}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* top right: THE DEALER */}
          <div className="absolute right-3 top-3 z-30 flex flex-col items-end gap-1">
            <div className="doodle-box px-3 py-1 rotate-[1.5deg]">
              <span className="font-marker text-lg text-[#8f2418]">THE DEALER</span>
              {snap.voodooEnemy > 0 && (
                <img src={assets.voodoo} alt="voodoo" className="ml-2 inline h-6 w-6 wiggle align-middle" />
              )}
              {snap.enemyCuffed && (
                <span className="ml-2 font-hand-sc text-sm text-[#9b8ec4] underline">cuffed</span>
              )}
            </div>
            {snap.enemySkills.length > 0 && (
              <div className="doodle-box flex items-center gap-1 px-2 py-0.5 rotate-[1deg]">
                <span className="font-hand-sc text-[10px] text-[#4a4036]">SKILLS</span>
                {snap.enemySkills.map((s) => (
                  <img
                    key={s.id}
                    src={s.icon}
                    alt={s.id}
                    title={SKILL_META[s.id].name}
                    className="h-6 w-6"
                  />
                ))}
              </div>
            )}
            <div className="flex gap-1">
              {Array.from({ length: snap.maxHpEnemy }).map((_, i) => (
                <img key={i} src={i < snap.hpEnemy ? assets.heartFull : assets.heartEmpty} alt="hp" className="h-8 w-8" />
              ))}
            </div>
          </div>

          {/* player: top-left on mobile, bottom-left on desktop.
              The optional FPS meter sits right ABOVE the YOU indicator (60% opacity). */}
          <div className="absolute left-2 top-[88px] z-30 flex flex-col gap-1 sm:left-3 sm:top-auto sm:bottom-3">
            {settings.showFps && (
              <div className="doodle-box doodle-dark w-fit px-2 py-0.5 font-hand-sc text-[10px] opacity-60 sm:text-xs">
                FPS {fps}
              </div>
            )}
            <div className="doodle-box w-fit px-2 py-0.5 rotate-[-1.5deg] sm:px-3 sm:py-1">
              <span className="font-marker text-sm sm:text-lg">YOU</span>
              {snap.voodooPlayer > 0 && (
                <span className="ml-2 font-hand-sc text-sm text-[#5e9c5b]">voodoo {snap.voodooPlayer}</span>
              )}
              {snap.playerCuffed && (
                <span className="ml-2 font-hand-sc text-sm text-[#9b8ec4] underline">cuffed</span>
              )}
            </div>
            <div className="flex gap-0.5 sm:gap-1">
              {Array.from({ length: snap.maxHpPlayer }).map((_, i) => (
                <img key={i} src={i < snap.hpPlayer ? assets.heartFull : assets.heartEmpty} alt="hp" className="h-7 w-7 sm:h-9 sm:w-9" />
              ))}
            </div>
          </div>

          {/* turn indicator */}
          <div className="pointer-events-none absolute left-1/2 top-[74px] z-20 -translate-x-1/2 sm:top-16">
            {snap.turn === "player" && (
              <div className="doodle-box px-4 py-0.5 font-marker text-[#8f2418] rotate-[-2deg] float-y">
                YOUR TURN
              </div>
            )}
            {snap.turn === "enemy" && (
              <div className="doodle-box doodle-dark px-4 py-0.5 font-marker rotate-[2deg] float-y">
                THE DEALER&apos;S TURN...
              </div>
            )}
          </div>

          {/* must shoot */}
          {snap.mustShoot && snap.turn === "player" && (
            <div className="pointer-events-none absolute left-1/2 top-28 z-30 -translate-x-1/2">
              <div className="doodle-box doodle-red px-4 py-1 font-marker text-xl blink-soft rotate-[-3deg]">
                YOU MUST SHOOT!
              </div>
            </div>
          )}

          {/* reload pips */}
          {reloadPips > 0 && (
            <div className="pointer-events-none absolute left-1/2 top-[62%] z-30 flex -translate-x-1/2 gap-1.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className={`h-4 w-4 rounded-full border-[3px] border-[#f3ecd7] ${
                    i < reloadPips ? "bg-[#c73e2e]" : "bg-transparent"
                  }`}
                />
              ))}
            </div>
          )}

          {/* skill bar (dice skills + shop trials; spent trials dissolve away) */}
          <div className="absolute bottom-[104px] left-1/2 z-30 flex -translate-x-1/2 items-end gap-1.5 sm:bottom-3 sm:gap-2">
            {snap.skills
              .filter((s) => s.owned)
              .map((s, idx) => {
                const ghost = s.ghostTurns > 0;
                return (
                  <button
                    key={s.id}
                    className={`doodle-btn relative flex h-16 w-16 flex-col items-center justify-center gap-0.5 sm:h-[74px] sm:w-[74px] ${
                      ghost ? "ghost-skill" : s.usable ? "" : "opacity-60"
                    }`}
                    style={
                      ghost
                        ? {
                            opacity: 0.1 + s.ghostTurns * 0.24,
                            filter: `grayscale(${0.55 + (2 - s.ghostTurns) * 0.22}) blur(${(2 - s.ghostTurns) * 0.8}px)`,
                            transition: "opacity 1.1s ease, filter 1.1s ease",
                          }
                        : undefined
                    }
                    disabled={!s.usable || ghost}
                    onClick={() => void engineRef.current?.playerUseSkill(s.id)}
                    title={SKILL_META[s.id].desc}
                  >
                    <img src={s.icon} alt={s.id} className="h-8 w-8 sm:h-9 sm:w-9" />
                    <span className="font-hand-sc text-[11px] leading-none">{SKILL_META[s.id].name}</span>
                    {!ghost && (
                      <span className="absolute -top-2 -left-1.5 font-marker text-[11px] text-[#8f2418]">{idx + 1}</span>
                    )}
                    {ghost ? null : s.id === "phoenix" ? (
                      <span className="trial-ribbon font-hand-sc" style={{ background: "#e08b3a" }}>
                        PASSIVE
                      </span>
                    ) : (
                      s.trial && <span className="trial-ribbon font-hand-sc">TRIAL</span>
                    )}
                    {!ghost && s.charges >= 0 && (
                      <span className="absolute -bottom-1 right-1 flex gap-0.5">
                        {Array.from({ length: Math.max(s.charges, 0) }).map((_, c) => (
                          <span key={c} className="h-2 w-2 rounded-full bg-[#5e9c5b] border border-[#221a12]" />
                        ))}
                      </span>
                    )}
                    {!ghost && s.cooldown > 0 && (
                      <span className="absolute inset-0 flex items-center justify-center rounded-[inherit] bg-black/55 font-marker text-2xl text-[#f3ecd7]">
                        {s.cooldown}
                      </span>
                    )}
                  </button>
                );
              })}
          </div>

          {/* shoot buttons */}
          <div className="absolute bottom-3 right-2 z-30 flex flex-row gap-2 sm:right-3 sm:flex-col">
            <button
              className={`doodle-btn doodle-red px-3 py-2.5 font-marker text-sm sm:px-5 sm:text-lg ${isPlayerTurn ? "" : "opacity-50"}`}
              disabled={!isPlayerTurn}
              onClick={() => void engineRef.current?.playerShoot("enemy")}
            >
              SHOOT DEALER [E]
            </button>
            <button
              className={`doodle-btn px-3 py-2.5 font-marker text-sm sm:px-5 sm:text-lg ${isPlayerTurn ? "" : "opacity-50"}`}
              disabled={!isPlayerTurn}
              onClick={() => void engineRef.current?.playerShoot("player")}
            >
              SHOOT SELF [Q]
            </button>
          </div>

          {/* toasts left (slide in, slide out) */}
          <div className="pointer-events-none absolute left-3 top-28 z-30 flex w-64 flex-col gap-1.5">
            {toasts.map((t) => (
              <div
                key={t.id}
                className={`doodle-box ${t.leaving ? "toast-out" : "toast-in"} px-3 py-1.5 font-hand text-[15px] leading-tight ${
                  t.tone === "good"
                    ? "border-[#3f6b3d]"
                    : t.tone === "bad"
                      ? "border-[#8f2418] text-[#8f2418]"
                      : t.tone === "voodoo"
                        ? "border-[#5e9c5b] text-[#3f6b3d] bg-[#e9f0e2]"
                        : ""
                }`}
              >
                {t.text}
              </div>
            ))}
          </div>
        </>
      )}

      {/* skill-get stamp */}
      <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
        {assets &&
          stamps.map((s) => (
            <div key={s.id} className="stamp-in absolute flex flex-col items-center">
              <div className="doodle-box flex items-center gap-3 px-8 py-4 rotate-[-3deg]">
                <img src={snap?.skills.find((x) => x.id === s.idSkill)?.icon} alt={s.idSkill} className="h-16 w-16" />
                <div>
                  <div className="font-marker text-3xl text-[#8f2418]">{SKILL_META[s.idSkill].name}!</div>
                  <div className="font-hand text-lg">{SKILL_META[s.idSkill].tag}</div>
                </div>
              </div>
            </div>
          ))}
      </div>

      {/* shell reveal (peek) */}
      <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
        {assets && reveal && (
          <div className="pop-in flex flex-col items-center gap-2">
            <img
              src={reveal.shell === "live" ? assets.pipLive : assets.pipBlank}
              alt={reveal.shell}
              className="h-40 w-40 float-y"
              style={{ imageRendering: "auto", transform: "scale(1.6)" }}
            />
            <div
              className={`doodle-box px-5 py-1 font-marker text-2xl rotate-[-2deg] ${
                reveal.shell === "live" ? "text-[#8f2418]" : "text-[#57697c]"
              }`}
            >
              {reveal.shell!.toUpperCase()}!
            </div>
          </div>
        )}
      </div>

      {/* third eye: the next shells in firing order */}
      <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
        {assets && revealQueue && (
          <div className="pop-in doodle-box px-6 py-4 rotate-[-1.5deg]">
            <div className="mb-2 text-center font-marker text-xl text-[#5aa7a0]">THIRD EYE</div>
            <div className="flex items-center gap-3">
              {revealQueue.map((sh, i) =>
                sh ? (
                  <img key={i} src={sh === "live" ? assets.pipLive : assets.pipBlank} alt={sh} className="h-20 w-20" />
                ) : (
                  <div
                    key={i}
                    className="flex h-20 w-20 items-center justify-center border-4 border-dashed border-[#221a12]/40 font-marker text-3xl text-[#57697c]"
                  >
                    ?
                  </div>
                ),
              )}
            </div>
            <div className="mt-2 text-center font-hand-sc text-sm text-[#4a4036]">in firing order</div>
          </div>
        )}
      </div>

      {/* center banner */}
      <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
        {banner && (
          <div className="stamp-in flex flex-col items-center gap-2">
            <div className="doodle-box px-10 py-4 rotate-[-2deg]">
              <div className="font-marker text-5xl text-[#221a12]">{banner.title}</div>
              {banner.sub && <div className="mt-1 text-center font-hand text-xl text-[#8f2418]">{banner.sub}</div>}
            </div>
          </div>
        )}
      </div>

      {/* ================= SHOP BREAK (physical, on the table) ================= */}
      {phase === "shop" && shopTip && snap && (
        <div
          className={`shop-tip ${shopTip.id !== "bell" && snap.shopOffers.find((o) => o.id === shopTip.id)?.legendary ? "shop-tip-gold" : ""}`}
          style={{ left: `${Math.min(86, Math.max(14, shopTip.xPct))}%`, top: `${Math.max(18, shopTip.yPct)}%` }}
        >
          {shopTip.id === "bell" ? (
            <>
              <div className="font-marker text-lg text-[#8a6d1d]">THE BELL</div>
              <div className="font-hand text-[13px] leading-snug text-[#221a12]">
                Ring it to end the break — reload the gun and fight the next round.
              </div>
            </>
          ) : (() => {
            const o = snap.shopOffers.find((x) => x.id === shopTip.id);
            if (!o) return null;
            const m = SKILL_META[o.id];
            return (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div className="font-marker text-lg leading-tight" style={{ color: m.color }}>
                    {m.name}
                  </div>
                  <div className="font-marker text-xl text-[#8a6d1d]">$ {o.price}</div>
                </div>
                <div className="font-hand text-[13px] leading-snug text-[#221a12]">{m.desc}</div>
                <div className="mt-1 font-hand-sc text-[11px] leading-none">
                  <span className="text-[#8a6d1d]">TRIAL · 1 USE</span>
                  {o.legendary && <span className="ml-2 text-[#8f2418]">INSANE ONLY</span>}
                  {o.sold && <span className="ml-2 text-[#57697c]">SOLD</span>}
                  {!o.sold && o.reason && <span className="ml-2 text-[#8f2418]">{o.reason}</span>}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ================= MAIN MENU ================= */}
      {/* the "background video": the living 3D table + THE DEALER idling,
          dimmed to 30%, no in-game UI anywhere */}
      {phase === "menu" && (
        <div className={`absolute inset-0 z-50 ${menuPanel ? "bg-black/45" : "bg-black/30"}`}>
          {/* animated game title — top left, just below the corner */}
          <div className="menu-title absolute left-5 top-6 z-10 sm:left-8 sm:top-9">
            <div className="font-marker text-[2.6rem] leading-none tracking-wide text-[#f3ecd7] sm:text-6xl">
              ROULETTE<span className="menu-title-mate">-MATE</span>
            </div>
            <div className="menu-tagline mt-1 rotate-[-1.5deg] font-hand text-lg text-[#d9a441] sm:text-xl">
              one revolver &middot; six chambers &middot; no mercy
            </div>
          </div>

          {/* the three doors of this establishment — bottom left, top to bottom */}
          <div className="absolute bottom-6 left-5 z-10 flex flex-col items-start gap-3 sm:bottom-9 sm:left-8">
            <button
              className="doodle-btn doodle-red menu-btn px-8 py-3 font-marker text-2xl sm:px-10"
              style={{ animationDelay: "0.05s" }}
              onClick={() => {
                gameAudio.ensure();
                gameAudio.click();
                setMenuPanel("play");
              }}
            >
              PICK A TABLE
            </button>
            <button
              className="doodle-btn menu-btn px-6 py-2 font-marker text-xl sm:px-8"
              style={{ animationDelay: "0.18s" }}
              onClick={() => {
                gameAudio.ensure();
                gameAudio.click();
                setMenuPanel("settings");
              }}
            >
              SETTINGS
            </button>
            <button
              className="doodle-btn menu-btn px-6 py-2 font-marker text-xl sm:px-8"
              style={{ animationDelay: "0.31s" }}
              onClick={() => {
                gameAudio.ensure();
                gameAudio.click();
                setShowHelp(true);
              }}
            >
              HELP / HOW TO PLAY
            </button>
          </div>

          {/* ------- PICK A TABLE (the old menu UI, cleaned) ------- */}
          {menuPanel === "play" && (
            <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
              <div className="pop-in doodle-box w-[min(92vw,540px)] px-7 py-6 rotate-[-0.5deg]">
                <div className="flex items-center justify-between">
                  <div className="font-marker text-3xl text-[#8f2418]">PICK A TABLE</div>
                  <button className="doodle-btn px-3 py-1 font-marker" onClick={() => setMenuPanel(null)}>
                    X
                  </button>
                </div>
                <div className="mt-4 flex flex-col gap-2">
                  {DIFFS.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => {
                        setDiff(d.id);
                        gameAudio.click();
                      }}
                      className={`doodle-btn flex items-center gap-3 px-3 py-2 ${
                        diff === d.id ? "bg-[#221a12] text-[#f3ecd7]" : ""
                      }`}
                    >
                      <img
                        src={d.id === "easy" ? assets?.diffEasy : d.id === "normal" ? assets?.diffNormal : assets?.diffInsane}
                        alt={d.id}
                        className="h-12 w-12 shrink-0"
                      />
                      <span className="font-marker text-xl">{d.label}</span>
                      <span className="font-hand text-sm opacity-80 sm:text-base">{d.desc}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-5 flex justify-center">
                  <button
                    className="doodle-btn doodle-red px-10 py-3 font-marker text-2xl menu-btn"
                    onClick={() => {
                      gameAudio.ensure();
                      setMenuPanel(null);
                      void engineRef.current?.startGame(diff);
                    }}
                  >
                    SIT AT THE TABLE
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ------- SETTINGS ------- */}
          {menuPanel === "settings" && (
            <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
              <div className="pop-in doodle-box w-[min(92vw,520px)] px-7 py-6 rotate-[0.4deg]">
                <div className="flex items-center justify-between">
                  <div className="font-marker text-3xl text-[#8f2418]">SETTINGS</div>
                  <button className="doodle-btn px-3 py-1 font-marker" onClick={() => setMenuPanel(null)}>
                    X
                  </button>
                </div>

                <div className="mt-4 flex flex-col gap-2.5 font-hand text-lg">
                  {/* SOUND */}
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-marker text-lg">SOUND</span>
                    <button
                      className={`doodle-btn px-4 py-1 font-hand-sc text-base ${settings.muted ? "opacity-70" : ""}`}
                      onClick={() => updateSettings({ muted: !settings.muted })}
                    >
                      {settings.muted ? "SOUND OFF" : "SOUND ON"}
                    </button>
                  </div>

                  {/* GRAPHICS */}
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-marker text-lg">GRAPHICS</span>
                    <div className="flex gap-1.5">
                      {(["low", "medium", "high"] as Quality[]).map((q) => (
                        <button
                          key={q}
                          className={`doodle-btn px-3 py-1 font-hand-sc text-base ${
                            settings.quality === q ? "bg-[#221a12] text-[#f3ecd7]" : ""
                          }`}
                          onClick={() => updateSettings({ quality: q })}
                        >
                          {q === "low" ? "LOW" : q === "medium" ? "MED" : "HIGH"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-1 border-t-2 border-dashed border-[#221a12]/30 pt-2 font-marker text-lg text-[#8a6d1d]">
                    UI &amp; QOL
                  </div>

                  {/* live/blank stat */}
                  <button
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-0.5 text-left hover:bg-[#221a12]/5"
                    onClick={() => updateSettings({ showShellStat: !settings.showShellStat })}
                  >
                    <span className="font-hand text-lg">Live / blank stat on the board</span>
                    <span className={`doodle-btn px-3 py-0.5 font-hand-sc text-sm ${settings.showShellStat ? "" : "opacity-70"}`}>
                      {settings.showShellStat ? "ON" : "OFF"}
                    </span>
                  </button>

                  {/* TIME — expands into round/total */}
                  <div>
                    <button
                      className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-0.5 text-left hover:bg-[#221a12]/5"
                      onClick={() => setTimeOpen((v) => !v)}
                    >
                      <span className="font-hand text-lg">
                        Time <span className="font-hand-sc text-sm text-[#4a4036]">(round &amp; total)</span>
                      </span>
                      <span className={`font-marker text-xl transition-transform duration-200 ${timeOpen ? "rotate-180" : ""}`}>
                        v
                      </span>
                    </button>
                    {timeOpen && (
                      <div className="expand-in mt-1 ml-4 flex flex-col gap-1.5 border-l-2 border-dashed border-[#221a12]/30 pl-3">
                        <button
                          className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-0.5 text-left hover:bg-[#221a12]/5"
                          onClick={() => updateSettings({ showRoundTime: !settings.showRoundTime })}
                        >
                          <span className="font-hand text-base">Show round time</span>
                          <span className={`doodle-btn px-3 py-0.5 font-hand-sc text-sm ${settings.showRoundTime ? "" : "opacity-70"}`}>
                            {settings.showRoundTime ? "ON" : "OFF"}
                          </span>
                        </button>
                        <button
                          className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-0.5 text-left hover:bg-[#221a12]/5"
                          onClick={() => updateSettings({ showTotalTime: !settings.showTotalTime })}
                        >
                          <span className="font-hand text-base">Show total time</span>
                          <span className={`doodle-btn px-3 py-0.5 font-hand-sc text-sm ${settings.showTotalTime ? "" : "opacity-70"}`}>
                            {settings.showTotalTime ? "ON" : "OFF"}
                          </span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* show FPS */}
                  <button
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-0.5 text-left hover:bg-[#221a12]/5"
                    onClick={() => updateSettings({ showFps: !settings.showFps })}
                  >
                    <span className="font-hand text-lg">
                      Show FPS <span className="font-hand-sc text-sm text-[#4a4036]">(above the YOU tag)</span>
                    </span>
                    <span className={`doodle-btn px-3 py-0.5 font-hand-sc text-sm ${settings.showFps ? "" : "opacity-70"}`}>
                      {settings.showFps ? "ON" : "OFF"}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================= GAME OVER / VICTORY ================= */}
      {(phase === "gameover" || phase === "victory") && snap && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
          <div className={`pop-in doodle-box w-[min(92vw,520px)] px-8 py-7 ${phase === "victory" ? "rotate-[0.5deg]" : "rotate-[-0.7deg]"}`}>
            <div className="text-center">
              {phase === "victory" ? (
                <>
                  <div className="font-marker text-5xl text-[#3f6b3d] rotate-[1deg]">YOU SURVIVED!</div>
                  <div className="mt-2 font-hand text-xl">
                    The Dealer fell in round {snap.round}. This room is officially yours.
                  </div>
                </>
              ) : (
                <>
                  <div className="font-marker text-6xl text-[#8f2418] rotate-[-1.5deg]">GAME OVER</div>
                  <div className="mt-2 font-hand text-xl">
                    That bullet was for you. You lasted until round {snap.round}.
                  </div>
                </>
              )}
              <div className="mt-3 font-hand text-lg text-[#4a4036]">
                Final HP: you {snap.hpPlayer}/{snap.maxHpPlayer} &middot; Dealer {snap.hpEnemy}/{snap.maxHpEnemy}
              </div>
              <div className="mt-1 font-hand text-base text-[#4a4036]">
                Cash left: ${snap.money} &middot; Match time {fmtTime(times.totalMs)}
              </div>
            </div>
            <div className="mt-5 flex justify-center gap-3">
              <button
                className="doodle-btn doodle-red px-8 py-2.5 font-marker text-xl"
                onClick={() => void engineRef.current?.startGame(snap.difficulty)}
              >
                PLAY AGAIN
              </button>
              <button className="doodle-btn px-6 py-2.5 font-marker text-xl" onClick={() => engineRef.current?.backToMenu()}>
                MENU
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= HELP ================= */}
      {showHelp && (
        <div
          className="absolute inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="pop-in doodle-box doodle-scroll max-h-[88vh] w-[min(94vw,680px)] overflow-y-auto px-7 py-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div className="font-marker text-3xl text-[#8f2418]">HOW TO PLAY</div>
              <button className="doodle-btn px-3 py-1 font-marker" onClick={() => setShowHelp(false)}>
                X
              </button>
            </div>
            <div className="mt-3 space-y-2 font-hand text-lg leading-snug">
              <p>
                On the table sits a 6-chamber revolver. Each round it is loaded with a mix of{" "}
                <b className="text-[#8f2418]">LIVE</b> (red, hurts) and <b className="text-[#57697c]">BLANK</b>{" "}
                (blue, empty) shells. The counts are honest on the board up top — but only for the first{" "}
                <b>3 turns</b> of a round. Then the board <b className="text-[#8f2418]">fades away turn by turn</b>,
                its opacity sinking until nothing is left, and both of you run on pure memory. The Dealer has a
                real memory too: he tracks every shell he sees — and on EASY/NORMAL he sometimes loses count.
              </p>
              <p>
                On your turn use a skill first if you want (free, doesn&apos;t pass the turn), then choose:{" "}
                <b>SHOOT SELF</b> — if it&apos;s a blank you automatically fire ONE free shot at the Dealer;
                if it&apos;s live, you take the hit and the turn passes. <b>SHOOT DEALER</b> — if it&apos;s live
                he takes the hit and the turn passes. Out of HP = over.
              </p>
              <p>
                The opening dice grants you <b>2 skills</b>. Between rounds the gun runs dry and a{" "}
                <b>SHOP BREAK</b> begins: <b>3 random items</b> appear right on the table. <b>Hover</b> one to
                read its price and effect, <b>click</b> to buy it as a 1-use <b className="text-[#8a6d1d]">TRIAL</b>,
                and hold up to <b>4 skills</b> at once. A spent trial dissolves over 2 turns. When you&apos;re
                done, <b>ring the golden bell</b> — every card leaps into the Dealer&apos;s hands and the next
                round loads. Voodoo is not for sale — a reflection like that earns its keep, it doesn&apos;t buy it.
              </p>
              <p>
                <b>Cash:</b> every bullet you land pays <b>$100</b>, a voodoo reflection pays <b>$150</b>,
                surviving a round pays <b>$75</b>, and you start with <b>$200</b>. On INSANE the table can also
                stock two legends: <b className="text-[#e08b3a]">PHOENIX</b> (refuse to die once) and{" "}
                <b className="text-[#5aa7a0]">THIRD EYE</b> (see the next 3 shells in order).
              </p>
              <p className="text-[#8f2418]">
                HP: your 6 against his 5 on EASY, 5 vs 5 on NORMAL — and on INSANE you get only 4 while the
                Dealer keeps 5. At 2 HP a blood vignette creeps in and your heartbeat returns. Below 3 HP,
                shooting yourself takes a long, cruel 0.7 seconds to pull — and the bullet leaves the barrel
                0.2 seconds late.
              </p>
              <p className="font-hand-sc text-base text-[#4a4036]">
                Keyboard: Q = shoot self &middot; E = shoot the Dealer &middot; 1-4 = skills &middot; M = mute &middot; H = help
              </p>
            </div>
            <div className="mt-4 font-marker text-2xl">8 SKILLS</div>
            <div className="mt-2 space-y-2">
              {(Object.keys(SKILL_META) as SkillId[]).map((id) => (
                <div key={id} className="flex gap-3 border-2 border-[#221a12]/20 rounded-[14px_4px_16px_6px] bg-[#efe7d2] p-2.5">
                  <img src={dataURL(`icon-${id}`, texSkillIcon(id))} alt={id} className="h-12 w-12 shrink-0" />
                  <div>
                    <div className="font-marker text-lg" style={{ color: SKILL_META[id].color }}>
                      {SKILL_META[id].name} <span className="font-hand text-sm text-[#4a4036]">— {SKILL_META[id].tag}</span>
                    </div>
                    <div className="font-hand text-[15px] leading-tight">{SKILL_META[id].desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 font-hand text-base text-[#4a4036]">
              Tip: PEEK before you decide. Reroll when the chamber feels too dangerous. Voodoo is at its
              meanest when the Dealer looks brave — every live bullet he fires at you crawls back into him.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
