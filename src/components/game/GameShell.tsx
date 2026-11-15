"use client";

/**
 * GameShell — React layer for ROULTEEMATE.
 * Mounts the engine (Three.js) plus all doodle overlays: the animated
 * main menu (title top-left, 3 buttons bottom-left), settings (incl.
 * language & mutators), the CUSTOM TABLE popup (ENGINE C code editor),
 * HP, shell counter, skill bar (separate slots per duplicate), toasts,
 * banner, rules, win/lose screens, the REWIND 2D overlay and the low-HP
 * blood vignette. The GAMBLE coin is fully 3D inside the scene.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GameEngine, type HudEvent, type HudSnapshot } from "@/game/engine";
import {
  ALL_SKILL_IDS,
  RARITY,
  RARITY_COLOR,
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
import { setLang, t, type Lang } from "@/game/i18n";
import { mutDefaultsFor, type MutConfig } from "@/game/mutator";
import { compileScript } from "@/game/script";
import { getDailyInfo } from "@/game/seed";
import type { Difficulty } from "@/game/logic";
import type { ShellType } from "@/game/logic";
import { gameAudio } from "@/game/audio";
import TutorialSpot from "./TutorialSpot";
import { PhoenixCut, ThirdEyeCut } from "./Cutscenes";
import RoultChat from "./RoultChat";

type Toast = { id: number; text: string; tone: string; leaving?: boolean };
type Pop = { id: number; side: string; text: string; tone: string };
type Splat = { id: number; url: string; left: number; top: number; size: number; rot: number };
type Stamp = { id: number; idSkill: SkillId };
type MenuPanel = "play" | "settings" | null;
type TableId = "easy" | "normal" | "insane" | "endless";

type Quality = "low" | "medium" | "high";

/** All toggles the SETTINGS screen owns (persisted in localStorage). */
type Settings = {
  muted: boolean;
  quality: Quality;
  /** EN (default) or ID */
  lang: Lang;
  /** MUTATORS: clicking play opens the CUSTOM TABLE popup */
  mutators: boolean;
  /** the live/blank counter board at the top */
  showShellStat: boolean;
  /** percentage chip under the shell board (more likely side wins the label) */
  showProb: boolean;
  /** DAILY SEED: everyone playing today gets the same shells/shop/skills */
  daily: boolean;
  /** INTERACTIVE tutorial — spotlight walkthrough; the whole feature (and
   *  the replay button) can be turned OFF, and it defaults to OFF */
  tutorial: boolean;
  /** TIME expands into these two */
  showRoundTime: boolean;
  showTotalTime: boolean;
  /** frame-per-second meter right above the YOU indicator */
  showFps: boolean;
};

const SETTINGS_KEY = "roulteemate-settings";
const LEGACY_SETTINGS_KEY = "roulette-mate-settings";
const DEFAULT_SETTINGS: Settings = {
  muted: false,
  quality: "high",
  lang: "en",
  mutators: false,
  showShellStat: true,
  showProb: true,
  daily: true,
  tutorial: false,
  showRoundTime: true,
  showTotalTime: true,
  showFps: false,
};

/* ---------- interactive SPOTLIGHT tutorial (settings toggle, default OFF) ---------- */

const TUT_KEY = "roulteemate-tutorial";
type TutState = { done: boolean };
const loadTut = (): TutState => {
  try {
    const raw = localStorage.getItem(TUT_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { done?: boolean; seen?: string[] };
      // legacy format also tracked a seen[] list
      return { done: !!p.done || (Array.isArray(p.seen) && p.seen.length > 0) };
    }
  } catch {
    /* corrupted storage — start fresh */
  }
  return { done: false };
};

type TutAction = "shoot" | "skill" | "buy" | "bell" | "shopOpen";

/** The spotlight walkthrough, in order. ACTION steps complete when the REAL
 *  action happens on the live table (the overlay stays click-through);
 *  `when` steps wait for their moment (shop break, board fade...). */
const TUT_SPOT_STEPS: {
  id: string;
  key: Parameters<typeof t>[0];
  target: string | null; // data-tut attribute; null = center card
  blocking: boolean; // info steps block clicks, action steps stay click-through
  action?: TutAction;
  when?: (s: HudSnapshot) => boolean;
}[] = [
  { id: "welcome", key: "tutStepWelcome", target: null, blocking: true },
  { id: "dealer", key: "tutStepDealer", target: "dealer", blocking: true },
  { id: "you", key: "tutStepYou", target: "you", blocking: true },
  { id: "board", key: "tutStepBoard", target: "board", blocking: true },
  { id: "skills", key: "tutStepSkills", target: "skills", blocking: false, action: "skill" },
  { id: "fire", key: "tutStepFire", target: "fire", blocking: false, action: "shoot" },
  { id: "cash", key: "tutStepCash", target: "cash", blocking: true },
  { id: "shop", key: "tutStepShop", target: null, blocking: true, when: (s) => s.phase === "shop" },
  {
    id: "fade",
    key: "tutStepFade",
    target: null,
    blocking: true,
    when: (s) => s.phase === "playerTurn" && !s.countsPublic,
  },
  { id: "end", key: "tutStepEnd", target: null, blocking: true },
];

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY) ?? localStorage.getItem(LEGACY_SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* corrupted storage — fall back to defaults */
  }
  return DEFAULT_SETTINGS;
}

const DIFFS: { id: TableId; labelKey: Parameters<typeof t>[0]; descKey: Parameters<typeof t>[0] }[] = [
  { id: "easy", labelKey: "diffEasy", descKey: "diffEasyDesc" },
  { id: "normal", labelKey: "diffNormal", descKey: "diffNormalDesc" },
  { id: "insane", labelKey: "diffInsane", descKey: "diffInsaneDesc" },
  { id: "endless", labelKey: "diffEndless", descKey: "diffEndlessDesc" },
];

const baseDiffOf = (d: TableId): Difficulty => (d === "endless" ? "insane" : d);
const modeOf = (d: TableId) => (d === "endless" ? "endless" : "standard");

const fmtTime = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

const SYNTAX_HELP = `ENGINE C — your script is COMPILED TO WEBASSEMBLY
and executed natively by the browser. Not a JS interpreter.

// globals (int / float) — shared by every hook
int bonus = 0;
float scale = 1.5;

// event hooks
every (setup)               { ... }  // once, at table start
every (turn)                { ... }  // any turn starts
every (round)               { ... }  // new round after a reload
every (hit)                 { ... }  // any trigger pull
every (player_take_damage)  { ... }
every (dealer_take_damage)  { ... }
every (skill)               { ... }  // any skill used

// statements
if (hp(DEALER) <= 2) { run_skill("cuffs", DEALER); }
else { heal(PLAYER, 1); }
while (hp(PLAYER) < 5) { heal(PLAYER, 1); break; }
repeat (3) { damage(DEALER, 1); }      // repeat (0) or (-2) = infinite
bonus += 1;   bonus -= 1;   bonus = bonus * 2 + 1;

// builtins
heal(PLAYER | DEALER, n)      damage(PLAYER | DEALER, n)
run_skill("cuffs", PLAYER | DEALER)   // any skill id works
hp(PLAYER | DEALER)   score()   round()   rand(n)   last_skill()
chance(p)                     // 1 with p% probability, else 0
shuffle()                     // scramble the remaining shell order
theme(color)                  // tint the room light (0 = default)
set_dmg_next(n)               // next trigger pull deals n damage
set_coin(1)  set_coin(0)      // force the next gamble flip (heads/tails)
print(x)   print("text")   say("text")

// hooks (v2)
every (shop)   { ... }  // the table stocks its goods
every (death)  { ... }  // somebody hit 0 HP — heal inside to DENY death
every (coin)   { ... }  // fires before a gamble flip — set_coin() works here
every (peek)   { ... }  // a magnifying-glass reveal just happened

// constants: PLAYER = 0, DEALER = 1,
// SKILL_REROLL SKILL_VOODOO SKILL_PEEK SKILL_EJECT SKILL_COFFEE
// SKILL_CUFFS SKILL_PHOENIX SKILL_THIRDEYE SKILL_REWIND SKILL_GAMBLE
// last_skill() == SKILL_GAMBLE fires inside every (skill) { ... }`;

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
  const [diff, setDiff] = useState<TableId>("normal");
  const [reloadPips, setReloadPips] = useState(0);
  const [flashRed, setFlashRed] = useState(false);
  const [revealQueue, setRevealQueue] = useState<(ShellType | null)[] | null>(null);
  const [times, setTimes] = useState<{ roundMs: number; totalMs: number }>({ roundMs: 0, totalMs: 0 });
  const [shopTip, setShopTip] = useState<{ id: SkillId | "bell"; xPct: number; yPct: number } | null>(null);
  /* 2D overlay: REWIND un-shot — the pip shown is the REAL shell that crawls back */
  const [rewinding, setRewinding] = useState<{ shell: ShellType } | null>(null);
  /* 2D cutscenes: PHOENIX resurrection + THIRD EYE sight (legend skills) */
  const [phoenixCut, setPhoenixCut] = useState(false);
  const [thirdEyeCut, setThirdEyeCut] = useState(false);
  /* ROULT — the local AI gamemode designer (revealed under PICK A TABLE) */
  const [roultOpen, setRoultOpen] = useState(false);
  const [roultRevealed, setRoultRevealed] = useState(false);

  /* ---------- MAIN MENU screens ---------- */
  const [menuPanel, setMenuPanel] = useState<MenuPanel>(null);
  /* ---------- SETTINGS (persisted) ---------- */
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [timeOpen, setTimeOpen] = useState(false);
  /* ---------- MUTATOR popup ---------- */
  const [mutOpen, setMutOpen] = useState(false);
  const [mutCfg, setMutCfg] = useState<MutConfig | null>(null);
  const [showSyntax, setShowSyntax] = useState(false);
  /** live ENGINE C compile of the code in the editor */
  const compiled = useMemo(
    () => compileScript(mutCfg?.rules ?? ""),
    [mutCfg?.rules],
  );
  /* ---------- FPS meter ---------- */
  const [fps, setFps] = useState(0);
  /* ---------- interactive tutorial (spotlight, default OFF) ---------- */
  const [tut, setTut] = useState<TutState>({ done: false });
  const [tutStep, setTutStep] = useState(0);
  const [tutRun, setTutRun] = useState(false);
  const tutReplayRef = useRef(false);
  /* ---------- end-of-run best tracking ---------- */
  const [bestInfo, setBestInfo] = useState<{ isNew: boolean; rounds: number; score: number; endless: boolean; hasBest: boolean } | null>(null);

  /* load persisted settings once */
  useEffect(() => {
    const s = loadSettings();
    setSettings(s);
    setLang(s.lang);
    setTut(loadTut());
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      if (patch.lang) setLang(patch.lang);
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
      diffEndless: dataURL("diff-endless", texDiffIcon("endless")),
    };
  }, [ready]);

  const assetsRef = useRef(assets);
  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  const handleEvent = useCallback(
    (e: HudEvent) => {
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
      case "rewindFx":
        setRewinding({ shell: e.shell });
        setTimeout(() => setRewinding(null), 1500);
        break;
      case "phoenixCut":
        setPhoenixCut(true);
        setTimeout(() => setPhoenixCut(false), 3500);
        break;
      case "thirdEyeCut":
        setThirdEyeCut(true);
        setTimeout(() => setThirdEyeCut(false), 2600);
        break;
      case "tutAction":
        // the interactive tutorial advances its ACTION steps on real play
        setTutStep((i) => (TUT_SPOT_STEPS[i]?.action === e.action ? i + 1 : i));
        break;
    }
    },
    [],
  );

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

  /* ---------- PICK A TABLE: hold 1s (or right-click) reveals ROULT ----------
   * a quick click still opens the table popup; a full 1s hold (the golden
   * bar fills) makes the panel rise smoothly and uncover the local AI; a
   * right-click is the instant version and never opens the popup. */
  const HOLD_MS = 1000;
  const [holdP, setHoldP] = useState(0);
  const [holding, setHolding] = useState(false);
  const holdRaf = useRef(0);
  const holdT0 = useRef(0);
  const holdingRef = useRef(false);

  const revealRoult = useCallback(() => {
    if (!roultRevealed) gameAudio.click();
    setRoultRevealed(true);
  }, [roultRevealed]);

  const stopHold = useCallback(() => {
    holdingRef.current = false;
    setHolding(false);
    setHoldP(0);
    cancelAnimationFrame(holdRaf.current);
  }, []);

  const onPlayDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return; // right-click goes through onContextMenu
      holdingRef.current = true;
      setHolding(true);
      holdT0.current = performance.now();
      const tick = () => {
        if (!holdingRef.current) return;
        const p = Math.min(1, (performance.now() - holdT0.current) / HOLD_MS);
        setHoldP(p);
        if (p < 1) holdRaf.current = requestAnimationFrame(tick);
      };
      holdRaf.current = requestAnimationFrame(tick);
    },
    [],
  );

  const onPlayUp = useCallback(() => {
    if (!holdingRef.current) return;
    const full = performance.now() - holdT0.current >= HOLD_MS;
    stopHold();
    if (full) {
      revealRoult(); // held the full second — ROULT rises, popup stays shut
    } else {
      gameAudio.ensure();
      gameAudio.click();
      setMenuPanel("play"); // ordinary click — open the table picker
    }
  }, [revealRoult, stopHold]);

  const onPlayLeave = useCallback(() => {
    if (holdingRef.current) stopHold(); // dragged away: cancel silently
  }, [stopHold]);

  const onPlayCtx = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      stopHold();
      revealRoult(); // right-click — instant reveal, never opens the popup
    },
    [revealRoult, stopHold],
  );

  /* ---------- keyboard (Q/E shoot, 1-4 skills, ESC closes) ---------- */
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const eng = engineRef.current;
      const k = ev.key.toLowerCase();
      if (k === "escape") {
        setMenuPanel(null);
        setShowHelp(false);
        setMutOpen(false);
        setRoultOpen(false);
        return;
      }
      if (!eng || !snap) return;
      if (k === "q") void eng.playerShoot("player");
      else if (k === "e") void eng.playerShoot("enemy");
      else if (/^[1-4]$/.test(k)) {
        const owned = snap.skills.filter((s) => s.ghostTurns <= 0);
        const target = owned[parseInt(k) - 1];
        if (target) void eng.playerUseSkill(target.uid);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [snap]);

  /* ---------- playtime ticker (round + total) ---------- */
  const phaseKey = snap?.phase ?? "menu";
  useEffect(() => {
    if (phaseKey === "menu") return;
    const tick = () => setTimes(engineRef.current?.getTimes() ?? { roundMs: 0, totalMs: 0 });
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [phaseKey]);

  /* ---------- interactive tutorial driver ---------- */
  const tutRef = useRef(tut);
  useEffect(() => {
    tutRef.current = tut;
  }, [tut]);

  const saveTut = useCallback((next: TutState) => {
    setTut(next);
    try {
      localStorage.setItem(TUT_KEY, JSON.stringify(next));
    } catch {
      /* private mode — tutorial just replays next session */
    }
  }, []);

  /* arm once per run: the spotlight plays when the feature is ON and the
   * player hasn't finished it yet (or asked for a replay) */
  const tutArmedRef = useRef(false);
  useEffect(() => {
    if (phaseKey === "menu") {
      tutArmedRef.current = false;
      setTutRun(false);
      return;
    }
    if (phaseKey === "gameover" || phaseKey === "victory") return;
    if (tutArmedRef.current) return;
    tutArmedRef.current = true;
    if (settings.tutorial && (!tutRef.current.done || tutReplayRef.current)) {
      tutReplayRef.current = false;
      setTutStep(0);
      setTutRun(true);
    }
  }, [phaseKey, settings.tutorial]);

  /* the last step closes the walkthrough and remembers it */
  const tutDone = tutRun && tutStep >= TUT_SPOT_STEPS.length;
  useEffect(() => {
    if (!tutDone) return;
    setTutRun(false);
    saveTut({ done: true });
  }, [tutDone, saveTut]);

  const advanceTut = useCallback(() => setTutStep((i) => i + 1), []);
  const skipTut = useCallback(() => {
    setTutRun(false);
    saveTut({ done: true });
  }, [saveTut]);

  /* ---------- personal best (written once per finished run) ---------- */
  const bestPhaseRef = useRef<string>("");
  useEffect(() => {
    if (phaseKey !== "gameover" && phaseKey !== "victory") {
      bestPhaseRef.current = phaseKey;
      return;
    }
    if (bestPhaseRef.current === phaseKey) return; // only once per phase entry
    bestPhaseRef.current = phaseKey;
    const eng = engineRef.current;
    const s = snap;
    if (!eng || !s) return;
    const st = eng.getStats();
    const endless = s.mode === "endless";
    const key = `roulteemate-best-${s.difficulty}-${s.mode}`;
    let prev: { rounds: number; score: number } | null = null;
    try {
      const raw = localStorage.getItem(key);
      if (raw) prev = JSON.parse(raw);
    } catch {
      /* ignore corrupted best */
    }
    const better = endless
      ? !prev || st.score > prev.score
      : st.won && (!prev || st.rounds < prev.rounds);
    if (better) {
      try {
        localStorage.setItem(key, JSON.stringify({ rounds: st.rounds, score: st.score }));
      } catch {
        /* private mode */
      }
    }
    // what the panel should DISPLAY: this run when it set the record,
    // otherwise the stored record (or nothing at all on a first loss)
    const shown = better ? { rounds: st.rounds, score: st.score } : prev;
    setBestInfo({
      isNew: better,
      rounds: shown?.rounds ?? 0,
      score: shown?.score ?? 0,
      endless,
      hasBest: !!shown,
    });
  }, [phaseKey, snap]);
  /* ---------- mutator helpers ---------- */
  const openMutator = useCallback(() => {
    // keep whatever the player already configured (rules survive reopening);
    // first open starts from the table's defaults
    setMutCfg((prev) => prev ?? mutDefaultsFor(baseDiffOf(diff), modeOf(diff) as "standard" | "endless", ALL_SKILL_IDS));
    setMutOpen(true);
  }, [diff]);

  const togglePoolCard = (id: SkillId) => {
    setMutCfg((c) => {
      if (!c) return c;
      const has = c.pool.includes(id);
      const pool = has ? c.pool.filter((x) => x !== id) : [...c.pool, id];
      return { ...c, pool };
    });
  };

  const startFromMenu = () => {
    gameAudio.ensure();
    if (settings.mutators) {
      openMutator();
    } else {
      setMenuPanel(null);
      void engineRef.current?.startGame(diff, undefined, settings.daily);
    }
  };

  /** REPLAY TUTORIAL: a real practice table (EASY) with the spotlight
   *  walkthrough forced on from step one. Only reachable while the
   *  tutorial feature itself is switched on. */
  const startTutorialRun = () => {
    gameAudio.ensure();
    gameAudio.click();
    tutReplayRef.current = true;
    saveTut({ done: false });
    setMenuPanel(null);
    void engineRef.current?.startGame("easy", undefined, settings.daily);
  };

  const launchCustomTable = () => {
    if (!mutCfg) return;
    if (!compiled.ok) return; // never sit down with a broken script
    gameAudio.ensure();
    gameAudio.click();
    setMutOpen(false);
    setMenuPanel(null);
    void engineRef.current?.startGame(diff, mutCfg, settings.daily);
  };

  const isPlayerTurn = snap?.phase === "playerTurn" && snap.turn === "player" && !snap.busy;
  /* roult can push a finished ENGINE C script straight into the CUSTOM
   * TABLE editor (opens the popup so the player sees it compile). */
  useEffect(() => {
    const onRoultApply = (e: Event) => {
      const code = (e as CustomEvent<string>).detail ?? "";
      if (!code) return;
      setMutCfg((prev) => {
        const base =
          prev ?? mutDefaultsFor(baseDiffOf(diff), modeOf(diff) as "standard" | "endless", ALL_SKILL_IDS);
        return { ...base, rules: code };
      });
      setMutOpen(true);
      gameAudio.buy();
    };
    window.addEventListener("roult:apply", onRoultApply);
    return () => window.removeEventListener("roult:apply", onRoultApply);
  }, [diff]);
  const phase = snap?.phase ?? "menu";
  const inGame = phase !== "menu";
  const lowHp = inGame && snap ? snap.hpPlayer : 0;
  const endless = snap?.mode === "endless";
  /** live/blank odds for the percentage chip — the more likely side labels it */
  const probLive =
    snap && snap.live + snap.blank > 0 ? Math.round((snap.live / (snap.live + snap.blank)) * 100) : null;
  const dailyToday = getDailyInfo();
  /* interactive spotlight tutorial (only while the feature is ON) */
  const tutActive =
    tutRun && settings.tutorial && inGame && phase !== "gameover" && phase !== "victory";
  const curTutStep = tutActive ? TUT_SPOT_STEPS[tutStep] : null;
  const tutStepVisible = !!curTutStep && (!curTutStep.when || (snap ? curTutStep.when(snap) : false));

  /* ---------- render ---------- */
  return (
    <div className="fixed inset-0 overflow-hidden bg-[#0b0a08] select-none">
      {/* 3D world */}
      <div ref={mountRef} className="absolute inset-0" />

      {/* cinematic overlays */}
      <div className="pointer-events-none absolute inset-0 vignette-overlay z-10" />
      <div className="pointer-events-none absolute inset-0 grain-overlay z-10" />
      {flashRed && <div className="pointer-events-none absolute inset-0 z-10 bg-[rgba(199,62,46,0.35)]" />}
      {rewinding && <div className="pointer-events-none absolute inset-0 z-10 bg-[rgba(94,60,145,0.18)]" />}

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
              Can be switched off entirely in SETTINGS > UI & QOL.
              Beneath it: the optional LIVE/BLANK percentage chip. */}
          {snap.round > 0 && (snap.live + snap.blank > 0) && (
          <div data-tut="board" className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 flex-col items-center">
            {settings.showShellStat && (
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
            )}
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
            {settings.showProb && probLive !== null && (
              <div
                className="mt-1 flex justify-center transition-opacity duration-[1100ms] ease-in-out"
                style={{ opacity: snap.countsPublic ? Math.min(1, snap.countdown / 3) : 0 }}
                title="Chance the next shell is live / blank — whichever is more likely"
              >
                <div
                  className={`doodle-box px-2 py-0.5 font-hand-sc text-xs rotate-[1.5deg] ${
                    probLive >= 50 ? "text-[#8f2418]" : "text-[#57697c]"
                  }`}
                >
                  {probLive >= 50 ? `LIVE ${probLive}%` : `BLANK ${100 - probLive}%`}
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

          {/* top left: round + cash + daily seed + optional timers */}
          <div className="absolute left-2 top-2 z-30 flex flex-col gap-1.5 sm:left-3 sm:top-3 sm:gap-2">
            <div className="flex items-center gap-1.5">
              <div className="doodle-box doodle-dark px-2 py-0.5 font-marker text-xs rotate-[-1.5deg] sm:px-3 sm:py-1 sm:text-sm">
                {t("round")} {Math.max(1, snap.round)}
              </div>
              {snap.daily && snap.seedCode && (
                <div
                  className="doodle-box px-2 py-0.5 font-hand-sc text-[10px] text-[#8a6d1d] rotate-[1.5deg] sm:text-xs"
                  title={`DAILY SEED ${snap.seedCode} — ${snap.seedDate}. Same shells, same shop, same skills for everyone today.`}
                >
                  DAILY {snap.seedCode}
                </div>
              )}
            </div>
            <div
              data-tut="cash"
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

          {/* top right: THE DEALER — hearts in standard play, the SCORE
              counter in ENDLESS (his HP literally becomes a scoreboard) */}
          <div data-tut="dealer" className="absolute right-3 top-3 z-30 flex flex-col items-end gap-1">
            <div className="doodle-box px-3 py-1 rotate-[1.5deg]">
              <span className="font-marker text-lg text-[#8f2418]">{t("theDealer")}</span>
              {snap.voodooEnemy > 0 && (
                <img src={assets.voodoo} alt="voodoo" className="ml-2 inline h-6 w-6 wiggle align-middle" />
              )}
              {snap.enemyCuffed && (
                <span className="ml-2 font-hand-sc text-sm text-[#9b8ec4] underline">{t("cuffed")}</span>
              )}
            </div>
            {snap.enemySkills.length > 0 && (
              <div className="doodle-box flex items-center gap-1 px-2 py-0.5 rotate-[1deg]">
                <span className="font-hand-sc text-[10px] text-[#4a4036]">{t("skills")}</span>
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
            {endless ? (
              <div className="doodle-box score-box flex items-center gap-2 px-3 py-1 rotate-[1deg]">
                <span className="font-hand-sc text-sm text-[#4a4036]">{t("score")}</span>
                <span className={`font-marker text-2xl ${snap.score < 0 ? "text-[#57697c]" : "text-[#8a6d1d]"}`}>
                  {snap.score}
                </span>
              </div>
            ) : (
              <div className="flex gap-1">
                {Array.from({ length: snap.maxHpEnemy }).map((_, i) => (
                  <img key={i} src={i < snap.hpEnemy ? assets.heartFull : assets.heartEmpty} alt="hp" className="h-8 w-8" />
                ))}
              </div>
            )}
          </div>

          {/* player: top-left on mobile, bottom-left on desktop.
              The optional FPS meter sits right ABOVE the YOU indicator (60% opacity). */}
          <div data-tut="you" className="absolute left-2 top-[88px] z-30 flex flex-col gap-1 sm:left-3 sm:top-auto sm:bottom-3">
            {settings.showFps && (
              <div className="doodle-box doodle-dark w-fit px-2 py-0.5 font-hand-sc text-[10px] opacity-60 sm:text-xs">
                FPS {fps}
              </div>
            )}
            <div className="doodle-box w-fit px-2 py-0.5 rotate-[-1.5deg] sm:px-3 sm:py-1">
              <span className="font-marker text-sm sm:text-lg">{t("you")}</span>
              {snap.voodooPlayer > 0 && (
                <span className="ml-2 font-hand-sc text-sm text-[#5e9c5b]">
                  {t("voodooTag")} {snap.voodooPlayer}
                </span>
              )}
              {snap.playerCuffed && (
                <span className="ml-2 font-hand-sc text-sm text-[#9b8ec4] underline">{t("cuffed")}</span>
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
                {t("yourTurn")}
              </div>
            )}
            {snap.turn === "enemy" && (
              <div className="doodle-box doodle-dark px-4 py-0.5 font-marker rotate-[2deg] float-y">
                {t("dealerTurn")}
              </div>
            )}
          </div>

          {/* must shoot */}
          {snap.mustShoot && snap.turn === "player" && (
            <div className="pointer-events-none absolute left-1/2 top-28 z-30 -translate-x-1/2">
              <div className="doodle-box doodle-red px-4 py-1 font-marker text-xl blink-soft rotate-[-3deg]">
                {t("mustShoot")}
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

          {/* skill bar — each slot is its OWN entry: duplicates appear twice,
              each with its own charges & cooldown counter */}
          <div data-tut="skills" className="absolute bottom-[104px] left-1/2 z-30 flex -translate-x-1/2 items-end gap-1.5 sm:bottom-3 sm:gap-2">
            {snap.skills
              .filter((s) => s.ghostTurns > 0 || s.charges !== 0 || s.cooldown > 0 || !s.trial)
              .map((s, idx) => {
                const ghost = s.ghostTurns > 0;
                return (
                  <button
                    key={s.uid}
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
                    onClick={() => void engineRef.current?.playerUseSkill(s.uid)}
                    title={SKILL_META[s.id].desc}
                  >
                    <img src={s.icon} alt={s.id} className="h-8 w-8 sm:h-9 sm:w-9" />
                    <span className="line-clamp-2 text-center font-hand-sc text-[9px] leading-[1.05] sm:text-[11px]">
                      {SKILL_META[s.id].name}
                    </span>
                    {!ghost && (
                      <span className="absolute -top-2 -left-1.5 font-marker text-[11px] text-[#8f2418]">{idx + 1}</span>
                    )}
                    {ghost ? null : s.id === "phoenix" ? (
                      <span className="trial-ribbon font-hand-sc" style={{ background: "#e08b3a" }}>
                        {t("passives")}
                      </span>
                    ) : (
                      s.trial && <span className="trial-ribbon font-hand-sc">{t("trial")}</span>
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
          <div data-tut="fire" className="absolute bottom-3 right-2 z-30 flex flex-row gap-2 sm:right-3 sm:flex-col">
            <button
              className={`doodle-btn doodle-red px-3 py-2.5 font-marker text-sm sm:px-5 sm:text-lg ${isPlayerTurn ? "" : "opacity-50"}`}
              disabled={!isPlayerTurn}
              onClick={() => void engineRef.current?.playerShoot("enemy")}
            >
              {t("shootDealer")}
            </button>
            <button
              className={`doodle-btn px-3 py-2.5 font-marker text-sm sm:px-5 sm:text-lg ${isPlayerTurn ? "" : "opacity-50"}`}
              disabled={!isPlayerTurn}
              onClick={() => void engineRef.current?.playerShoot("player")}
            >
              {t("shootSelf")}
            </button>
          </div>

          {/* toasts left (slide in, slide out) */}
          <div className="pointer-events-none absolute left-3 top-28 z-30 flex w-64 flex-col gap-1.5">
            {toasts.map((tt) => (
              <div
                key={tt.id}
                className={`doodle-box ${tt.leaving ? "toast-out" : "toast-in"} px-3 py-1.5 font-hand text-[15px] leading-tight ${
                  tt.tone === "good"
                    ? "border-[#3f6b3d]"
                    : tt.tone === "bad"
                      ? "border-[#8f2418] text-[#8f2418]"
                      : tt.tone === "voodoo"
                        ? "border-[#5e9c5b] text-[#3f6b3d] bg-[#e9f0e2]"
                        : ""
                }`}
              >
                {tt.text}
              </div>
            ))}
          </div>

          {/* interactive SPOTLIGHT tutorial — golden outlines point at the
              real HUD; action steps stay click-through and complete when the
              player actually does the thing. Enabled in SETTINGS, default OFF. */}
          {tutActive && curTutStep && tutStepVisible && (
            <TutorialSpot
              key={curTutStep.id}
              target={curTutStep.target}
              title={t("tutSpot")}
              text={t(curTutStep.key)}
              step={tutStep + 1}
              total={TUT_SPOT_STEPS.length}
              blocking={curTutStep.blocking}
              actionMode={!!curTutStep.action}
              nextLabel={t("tutNext")}
              skipLabel={t("tutSkip")}
              waitingLabel={t("tutWaiting")}
              clickLabel={t("tutClick")}
              onNext={advanceTut}
              onSkip={skipTut}
            />
          )}
          {/* while a `when` step waits for its moment, a small escape chip
              stays on screen so the walkthrough can always be skipped */}
          {tutActive && curTutStep && !tutStepVisible && (
            <button
              className="tut-skip-chip doodle-btn absolute bottom-3 left-1/2 z-[58] -translate-x-1/2 px-3 py-1 font-hand-sc text-xs opacity-80"
              onClick={skipTut}
            >
              {t("tutSpot")} — {t("tutSkip")}
            </button>
          )}
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

      {/* shell reveal (magnifying glass) */}
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

      {/* GAMBLE: the coin is now a REAL semi-3D object inside the scene —
          no 2D overlay anymore. The result is shown via toasts + HP pops. */}

      {/* REWIND: the 2D un-shot (tape arrows + shell crawling back) */}
      <div className="pointer-events-none absolute inset-0 z-40 overflow-hidden">
        {rewinding && (
          <>
            <div className="rewind-arrows">
              <svg viewBox="0 0 120 60" className="h-16 w-32">
                <polygon points="10,8 52,30 10,52" fill="#8f5bd4" opacity="0.92" />
                <polygon points="58,8 100,30 58,52" fill="#8f5bd4" opacity="0.92" />
              </svg>
              <div className="font-marker text-2xl tracking-[0.3em] text-[#c9b3ec] drop-shadow-[2px_2px_0_rgba(0,0,0,0.6)]">
                REWIND
              </div>
            </div>
            {assets && (
              <img
                src={rewinding.shell === "live" ? assets.pipLive : assets.pipBlank}
                alt=""
                className="rewind-shell"
              />
            )}
          </>
        )}
      </div>

      {/* LEGEND cutscenes: the phoenix resurrection + the third eye sight */}
      {phoenixCut && <PhoenixCut />}
      {thirdEyeCut && <ThirdEyeCut />}

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
              <div className="font-marker text-lg text-[#8a6d1d]">{t("bellName")}</div>
              <div className="font-hand text-[13px] leading-snug text-[#221a12]">{t("bellDesc")}</div>
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
                  <span style={{ color: RARITY_COLOR[o.rarity] }}>
                    {o.rarity === "legend" ? t("tagLegend") : o.rarity === "epic" ? t("tagEpic") : t("tagTrial")}
                  </span>
                  {o.sold && <span className="ml-2 text-[#57697c]">{t("tagSold")}</span>}
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
        <div className={`absolute inset-0 z-50 ${menuPanel || mutOpen ? "bg-black/45" : "bg-black/30"}`}>
          {/* animated game title — top left, just below the corner */}
          <div className="menu-title absolute left-5 top-6 z-10 sm:left-8 sm:top-9">
            <div className="font-marker text-[2.6rem] leading-none tracking-wide text-[#f3ecd7] sm:text-6xl">
              ROULTEE<span className="menu-title-mate">MATE</span>
            </div>
            <div className="menu-tagline mt-1 rotate-[-1.5deg] font-hand text-lg text-[#d9a441] sm:text-xl">
              {t("tagline")}
            </div>
          </div>

          {/* the doors of this establishment — bottom left, top to bottom.
              PICK A TABLE hides ROULT: hold it a full second (the golden bar
              fills under the label) or right-click it — the panel rises and
              uncovers the local AI button beneath. */}
          <div className="absolute bottom-6 left-5 z-10 flex flex-col items-start gap-3 sm:bottom-9 sm:left-8">
            <button
              className="doodle-btn doodle-red menu-btn relative px-8 py-3 font-marker text-2xl sm:px-10"
              style={{ animationDelay: "0.05s", paddingRight: "2.6rem" }}
              onPointerDown={onPlayDown}
              onPointerUp={onPlayUp}
              onPointerLeave={onPlayLeave}
              onPointerCancel={onPlayLeave}
              onContextMenu={onPlayCtx}
              title={t("roultHoldHint")}
            >
              {t("btnPlay")}
              {/* the V indicator — flips upside down while held / after right-click */}
              <span className={`play-v font-marker ${holding || roultRevealed ? "play-v-flip" : ""}`}>
                v
              </span>
              {/* the 1-second hold bar under the label */}
              <span
                className="play-holdbar"
                style={{ width: `${holdP * 80}%`, opacity: holding ? 1 : 0 }}
              />
            </button>
            {/* ROULT — rises out from under PICK A TABLE */}
            <div className={`roult-reveal ${roultRevealed ? "roult-reveal-open" : ""}`}>
              <button
                className="doodle-btn menu-btn roult-menu-btn px-6 py-2 font-marker text-xl sm:px-8"
                style={{ animationDelay: "0.12s" }}
                onClick={() => {
                  gameAudio.ensure();
                  gameAudio.click();
                  setRoultOpen(true);
                }}
                title={t("roultBadge")}
              >
                {t("roultBtn")}
                <span className="ml-2 font-hand-sc text-xs opacity-70">{t("roultLocalTag")}</span>
              </button>
            </div>
            <button
              className="doodle-btn menu-btn px-6 py-2 font-marker text-xl sm:px-8"
              style={{ animationDelay: "0.18s" }}
              onClick={() => {
                gameAudio.ensure();
                gameAudio.click();
                setMenuPanel("settings");
              }}
            >
              {t("btnSettings")}
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
              {t("btnHelp")}
            </button>
          </div>

          {/* ------- PICK A TABLE (the old menu UI, cleaned) ------- */}
          {menuPanel === "play" && (
            <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
              <div className="pop-in doodle-box w-[min(92vw,560px)] px-7 py-6 rotate-[-0.5deg]">
                <div className="flex items-center justify-between">
                  <div className="font-marker text-3xl text-[#8f2418]">{t("pickTable")}</div>
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
                        src={
                          d.id === "easy"
                            ? assets?.diffEasy
                            : d.id === "normal"
                              ? assets?.diffNormal
                              : d.id === "insane"
                                ? assets?.diffInsane
                                : assets?.diffEndless
                        }
                        alt={d.id}
                        className="h-12 w-12 shrink-0"
                      />
                      <span className="font-marker text-xl">{t(d.labelKey)}</span>
                      <span className="font-hand text-sm opacity-80 sm:text-base">{t(d.descKey)}</span>
                    </button>
                  ))}
                </div>
                {settings.daily && (
                  <div
                    className="mt-3 flex items-center justify-center gap-2 font-hand-sc text-sm text-[#8a6d1d]"
                    title="The seed is an algorithm over today's date — everyone plays the same shells, shop and skills."
                  >
                    <span className="rotate-[-1deg]">DAILY SEED {dailyToday.code} — {dailyToday.date}</span>
                    <span className="font-hand text-xs opacity-70">everyone plays the same run</span>
                  </div>
                )}
                {settings.mutators && (
                  <div className="mt-3 font-hand-sc text-sm text-[#8f5bd4]">
                    MUTATORS ON — sitting down opens the CUSTOM TABLE sheet.
                  </div>
                )}
                <div className="mt-5 flex justify-center">
                  <button
                    className="doodle-btn doodle-red px-10 py-3 font-marker text-2xl menu-btn"
                    onClick={startFromMenu}
                  >
                    {t("sitBtn")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ------- SETTINGS ------- */}
          {menuPanel === "settings" && (
            <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
              <div className="pop-in doodle-box max-h-[88vh] w-[min(92vw,520px)] overflow-y-auto doodle-scroll px-7 py-6 rotate-[0.4deg]">
                <div className="flex items-center justify-between">
                  <div className="font-marker text-3xl text-[#8f2418]">{t("settings")}</div>
                  <button className="doodle-btn px-3 py-1 font-marker" onClick={() => setMenuPanel(null)}>
                    X
                  </button>
                </div>

                <div className="mt-4 flex flex-col gap-2.5 font-hand text-lg">
                  {/* LANGUAGE */}
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-marker text-lg">{t("optLanguage")}</span>
                    <div className="flex gap-1.5">
                      {(["en", "id"] as Lang[]).map((l) => (
                        <button
                          key={l}
                          className={`doodle-btn px-3 py-1 font-hand-sc text-base ${
                            settings.lang === l ? "bg-[#221a12] text-[#f3ecd7]" : ""
                          }`}
                          onClick={() => updateSettings({ lang: l })}
                        >
                          {l === "en" ? "ENGLISH" : "INDONESIA"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* SOUND */}
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-marker text-lg">{t("sound")}</span>
                    <button
                      className={`doodle-btn px-4 py-1 font-hand-sc text-base ${settings.muted ? "opacity-70" : ""}`}
                      onClick={() => updateSettings({ muted: !settings.muted })}
                    >
                      {settings.muted ? t("soundOff") : t("soundOn")}
                    </button>
                  </div>

                  {/* GRAPHICS */}
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-marker text-lg">{t("graphics")}</span>
                    <div className="flex gap-1.5">
                      {(["low", "medium", "high"] as Quality[]).map((q) => (
                        <button
                          key={q}
                          className={`doodle-btn px-3 py-1 font-hand-sc text-base ${
                            settings.quality === q ? "bg-[#221a12] text-[#f3ecd7]" : ""
                          }`}
                          onClick={() => updateSettings({ quality: q })}
                        >
                          {q === "low" ? t("qLow") : q === "medium" ? t("qMed") : t("qHigh")}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-1 border-t-2 border-dashed border-[#221a12]/30 pt-2 font-marker text-lg text-[#8a6d1d]">
                    {t("uiQol")}
                  </div>

                  {/* MUTATORS */}
                  <button
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-0.5 text-left hover:bg-[#221a12]/5"
                    onClick={() => updateSettings({ mutators: !settings.mutators })}
                  >
                    <span className="font-hand text-lg text-[#8f5bd4]">{t("optMutators")}</span>
                    <span className={`doodle-btn px-3 py-0.5 font-hand-sc text-sm ${settings.mutators ? "" : "opacity-70"}`}>
                      {settings.mutators ? t("on") : t("off")}
                    </span>
                  </button>

                  {/* live/blank stat */}
                  <button
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-0.5 text-left hover:bg-[#221a12]/5"
                    onClick={() => updateSettings({ showShellStat: !settings.showShellStat })}
                  >
                    <span className="font-hand text-lg">{t("optShellStat")}</span>
                    <span className={`doodle-btn px-3 py-0.5 font-hand-sc text-sm ${settings.showShellStat ? "" : "opacity-70"}`}>
                      {settings.showShellStat ? t("on") : t("off")}
                    </span>
                  </button>

                  {/* live/blank percentage */}
                  <button
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-0.5 text-left hover:bg-[#221a12]/5"
                    onClick={() => updateSettings({ showProb: !settings.showProb })}
                  >
                    <span className="font-hand text-lg">
                      {t("optProb")} <span className="font-hand-sc text-sm text-[#4a4036]">{t("optProbHint")}</span>
                    </span>
                    <span className={`doodle-btn px-3 py-0.5 font-hand-sc text-sm ${settings.showProb ? "" : "opacity-70"}`}>
                      {settings.showProb ? t("on") : t("off")}
                    </span>
                  </button>

                  {/* DAILY SEED */}
                  <button
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-0.5 text-left hover:bg-[#221a12]/5"
                    onClick={() => updateSettings({ daily: !settings.daily })}
                  >
                    <span className="font-hand text-lg">
                      {t("optDaily")} <span className="font-hand-sc text-sm text-[#4a4036]">{t("optDailyHint")}</span>
                    </span>
                    <span className={`doodle-btn px-3 py-0.5 font-hand-sc text-sm ${settings.daily ? "" : "opacity-70"}`}>
                      {settings.daily ? t("on") : t("off")}
                    </span>
                  </button>

                  {/* INTERACTIVE tutorial — the whole feature (and its replay
                      button below) can be turned OFF; default is OFF */}
                  <button
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-0.5 text-left hover:bg-[#221a12]/5"
                    onClick={() => updateSettings({ tutorial: !settings.tutorial })}
                  >
                    <span className="font-hand text-lg">
                      {t("optTutorial")}{" "}
                      <span className="font-hand-sc text-sm text-[#4a4036]">{t("optTutorialHint")}</span>
                    </span>
                    <span className={`doodle-btn px-3 py-0.5 font-hand-sc text-sm ${settings.tutorial ? "" : "opacity-70"}`}>
                      {settings.tutorial ? t("on") : t("off")}
                    </span>
                  </button>

                  {/* replay the tutorial — a real practice table; only exists
                      while the tutorial feature itself is switched on */}
                  {settings.tutorial && (
                    <button
                      className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-0.5 text-left hover:bg-[#221a12]/5"
                      onClick={startTutorialRun}
                    >
                      <span className="font-hand text-lg">
                        {t("optTutReplay")}{" "}
                        <span className="font-hand-sc text-sm text-[#4a4036]">{t("optTutReplayHint")}</span>
                      </span>
                      <span className="doodle-btn doodle-red px-3 py-0.5 font-hand-sc text-sm">{t("tutStart")}</span>
                    </button>
                  )}

                  {/* TIME — expands into round/total */}
                  <div>
                    <button
                      className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-0.5 text-left hover:bg-[#221a12]/5"
                      onClick={() => setTimeOpen((v) => !v)}
                    >
                      <span className="font-hand text-lg">
                        {t("optTime")} <span className="font-hand-sc text-sm text-[#4a4036]">{t("optTimeHint")}</span>
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
                          <span className="font-hand text-base">{t("optRoundTime")}</span>
                          <span className={`doodle-btn px-3 py-0.5 font-hand-sc text-sm ${settings.showRoundTime ? "" : "opacity-70"}`}>
                            {settings.showRoundTime ? t("on") : t("off")}
                          </span>
                        </button>
                        <button
                          className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-0.5 text-left hover:bg-[#221a12]/5"
                          onClick={() => updateSettings({ showTotalTime: !settings.showTotalTime })}
                        >
                          <span className="font-hand text-base">{t("optTotalTime")}</span>
                          <span className={`doodle-btn px-3 py-0.5 font-hand-sc text-sm ${settings.showTotalTime ? "" : "opacity-70"}`}>
                            {settings.showTotalTime ? t("on") : t("off")}
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
                      {t("optFps")} <span className="font-hand-sc text-sm text-[#4a4036]">{t("optFpsHint")}</span>
                    </span>
                    <span className={`doodle-btn px-3 py-0.5 font-hand-sc text-sm ${settings.showFps ? "" : "opacity-70"}`}>
                      {settings.showFps ? t("on") : t("off")}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ------- CUSTOM TABLE (mutators popup) ------- */}
          {mutOpen && mutCfg && (
            <div className="absolute inset-0 z-[55] flex items-center justify-center bg-black/50 p-4">
              <div className="pop-in doodle-box doodle-scroll max-h-[92vh] w-[min(94vw,640px)] overflow-y-auto px-7 py-6 rotate-[0.3deg]">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-marker text-3xl text-[#8f5bd4]">{t("mutTitle")}</div>
                    <div className="font-hand-sc text-sm text-[#4a4036]">{t("mutSub")}</div>
                  </div>
                  <button className="doodle-btn px-3 py-1 font-marker" onClick={() => setMutOpen(false)}>
                    X
                  </button>
                </div>

                {/* card pool */}
                <div className="mt-4">
                  <div className="font-marker text-lg">{t("mutCardPool")}</div>
                  <div className="font-hand-sc text-xs text-[#4a4036]">{t("mutCardPoolHint")}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {ALL_SKILL_IDS.map((id) => {
                      const picked = mutCfg.pool.includes(id);
                      const r = RARITY[id];
                      const legendBlocked = r === "legend" && !mutCfg.allowLegend && baseDiffOf(diff) !== "insane" && diff !== "endless";
                      const epicBlocked = r === "epic" && diff === "easy";
                      return (
                        <button
                          key={id}
                          onClick={() => togglePoolCard(id)}
                          className={`doodle-btn flex items-center gap-1.5 px-2 py-1 text-[13px] ${
                            picked ? "" : "opacity-40 line-through"
                          }`}
                          style={{ borderColor: picked ? RARITY_COLOR[r] : undefined }}
                          title={`${SKILL_META[id].name}${legendBlocked ? ` — ${t("mutLegendNote")}` : ""}${epicBlocked ? " — EPIC needs NORMAL+" : ""}`}
                        >
                          <span className="h-2 w-2 rounded-full" style={{ background: RARITY_COLOR[r] }} />
                          <span className="font-hand-sc">{SKILL_META[id].name}</span>
                          {(legendBlocked || epicBlocked) && <span className="font-hand-sc text-[10px] text-[#8f2418]">!</span>}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-1.5 flex gap-2">
                    <button className="doodle-btn px-2 py-0.5 font-hand-sc text-xs" onClick={() => setMutCfg({ ...mutCfg, pool: [...ALL_SKILL_IDS] })}>
                      {t("mutPoolAll")}
                    </button>
                    <button className="doodle-btn px-2 py-0.5 font-hand-sc text-xs" onClick={() => setMutCfg({ ...mutCfg, pool: [] })}>
                      {t("mutPoolNone")}
                    </button>
                  </div>
                </div>

                {/* allow legend */}
                <button
                  className="mt-3 flex w-full items-center justify-between gap-3 rounded-lg px-1 py-0.5 text-left hover:bg-[#221a12]/5"
                  onClick={() => setMutCfg({ ...mutCfg, allowLegend: !mutCfg.allowLegend })}
                >
                  <span className="font-hand text-base text-[#d9a441]">
                    {t("mutAllowLegend")} <span className="font-hand-sc text-xs text-[#4a4036]">— {t("mutLegendNote")}</span>
                  </span>
                  <span className={`doodle-btn px-3 py-0.5 font-hand-sc text-sm ${mutCfg.allowLegend ? "" : "opacity-70"}`}>
                    {mutCfg.allowLegend ? t("on") : t("off")}
                  </span>
                </button>

                {/* dealer AI + HP + skill counts */}
                <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-hand text-base">{t("mutAi")}</span>
                    <div className="flex gap-1">
                      {(["easy", "normal", "insane"] as Difficulty[]).map((d) => (
                        <button
                          key={d}
                          className={`doodle-btn px-2 py-0.5 font-hand-sc text-xs ${
                            mutCfg.ai === d ? "bg-[#221a12] text-[#f3ecd7]" : ""
                          }`}
                          onClick={() => setMutCfg({ ...mutCfg, ai: d })}
                        >
                          {d.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="flex items-center justify-between gap-2">
                    <span className="font-hand text-base">{t("mutHpPlayer")}</span>
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={mutCfg.hpPlayer}
                      onChange={(e) => setMutCfg({ ...mutCfg, hpPlayer: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })}
                      className="doodle-box w-16 px-2 py-0.5 text-center font-marker text-lg"
                    />
                  </label>
                  <label className={`flex items-center justify-between gap-2 ${diff === "endless" ? "opacity-40" : ""}`} title={diff === "endless" ? "ENDLESS: the dealer's HP is a score counter" : ""}>
                    <span className="font-hand text-base">{t("mutHpDealer")}</span>
                    <input
                      type="number"
                      min={1}
                      max={12}
                      disabled={diff === "endless"}
                      value={mutCfg.hpEnemy}
                      onChange={(e) => setMutCfg({ ...mutCfg, hpEnemy: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })}
                      className="doodle-box w-16 px-2 py-0.5 text-center font-marker text-lg"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2">
                    <span className="font-hand text-base">{t("mutSkillsPlayer")}</span>
                    <input
                      type="number"
                      min={0}
                      max={6}
                      value={mutCfg.skillsPlayer}
                      onChange={(e) => setMutCfg({ ...mutCfg, skillsPlayer: Math.max(0, Math.min(6, Number(e.target.value) || 0)) })}
                      className="doodle-box w-16 px-2 py-0.5 text-center font-marker text-lg"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2">
                    <span className="font-hand text-base">{t("mutSkillsDealer")}</span>
                    <input
                      type="number"
                      min={0}
                      max={6}
                      value={mutCfg.skillsEnemy}
                      onChange={(e) => setMutCfg({ ...mutCfg, skillsEnemy: Math.max(0, Math.min(6, Number(e.target.value) || 0)) })}
                      className="doodle-box w-16 px-2 py-0.5 text-center font-marker text-lg"
                    />
                  </label>
                  <button
                    className="flex items-center justify-between gap-2"
                    onClick={() => setMutCfg({ ...mutCfg, allowDup: !mutCfg.allowDup })}
                  >
                    <span className="font-hand text-base">{t("mutAllowDup")}</span>
                    <span className={`doodle-btn px-3 py-0.5 font-hand-sc text-sm ${mutCfg.allowDup ? "" : "opacity-70"}`}>
                      {mutCfg.allowDup ? t("on") : t("off")}
                    </span>
                  </button>
                </div>

                {/* custom rules — one ENGINE C program, compiled live */}
                <div className="mt-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-marker text-lg">{t("mutRules")}</div>
                      <div className="font-hand-sc text-[11px] text-[#4a4036]">{t("mutEngineCSub")}</div>
                    </div>
                    <button className="doodle-btn px-2 py-0.5 font-hand-sc text-xs" onClick={() => setShowSyntax((v) => !v)}>
                      {t("mutSyntaxTitle")} {showSyntax ? "▲" : "▼"}
                    </button>
                  </div>
                  {showSyntax && (
                    <pre className="expand-in mt-1 max-h-52 overflow-auto rounded-lg border-2 border-[#221a12]/30 bg-[#efe7d2] p-2 font-mono text-[11px] leading-tight text-[#221a12]">
                      {SYNTAX_HELP}
                    </pre>
                  )}
                  <textarea
                    value={mutCfg.rules}
                    onChange={(e) => setMutCfg({ ...mutCfg, rules: e.target.value })}
                    placeholder={t("mutRulePh")}
                    spellCheck={false}
                    className="doodle-box mt-2 h-56 w-full resize-y bg-[#efe7d2] p-2 font-mono text-[12px] leading-snug"
                  />
                  {/* live compile status */}
                  {compiled.ok ? (
                    <div className="mt-1.5 font-hand-sc text-xs text-[#3f6b3d]">
                      {compiled.hooks.length
                        ? t("mutCompileOk", { a: compiled.hooks.join(", ") })
                        : t("mutHookNone")}
                    </div>
                  ) : (
                    <div className="mt-1.5 font-hand-sc text-xs text-[#8f2418]">
                      {compiled.errors.slice(0, 5).map((e, i) => (
                        <div key={i}>{e}</div>
                      ))}
                    </div>
                  )}
                  {mutCfg.rules.trim() && compiled.ok && (
                    <button
                      className="doodle-btn mt-1.5 px-3 py-0.5 font-hand-sc text-xs"
                      onClick={() => {
                        setMutCfg({ ...mutCfg, rules: "" });
                        gameAudio.click();
                      }}
                    >
                      {t("mutClearAll")}
                    </button>
                  )}
                </div>

                <div className="mt-5 flex flex-col items-center gap-1.5">
                  <button
                    className={`doodle-btn doodle-red px-10 py-3 font-marker text-2xl menu-btn ${compiled.ok ? "" : "opacity-50"}`}
                    disabled={!compiled.ok}
                    title={compiled.ok ? undefined : t("mutParseErr")}
                    onClick={launchCustomTable}
                  >
                    {t("mutStartBtn")}
                  </button>
                  {!compiled.ok && <div className="font-hand-sc text-xs text-[#8f2418]">{t("mutParseErr")}</div>}
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
                  <div className="font-marker text-5xl text-[#3f6b3d] rotate-[1deg]">{t("winTitle")}</div>
                  <div className="mt-2 font-hand text-xl">{t("winBody", { r: snap.round })}</div>
                </>
              ) : (
                <>
                  <div className="font-marker text-6xl text-[#8f2418] rotate-[-1.5deg]">{t("loseTitle")}</div>
                  <div className="mt-2 font-hand text-xl">
                    {endless ? t("loseEndlessBody", { r: snap.round, s: snap.score }) : t("loseBody", { r: snap.round })}
                  </div>
                </>
              )}
              <div className="mt-3 font-hand text-lg text-[#4a4036]">
                {endless
                  ? t("finalStatsEndless", { s: snap.score, a: snap.hpPlayer, b: snap.maxHpPlayer })
                  : t("finalStats", { a: snap.hpPlayer, b: snap.maxHpPlayer, c: snap.hpEnemy, d: snap.maxHpEnemy })}
              </div>
              <div className="mt-1 font-hand text-base text-[#4a4036]">{t("cashLeft", { m: snap.money, t: fmtTime(times.totalMs) })}</div>
              {(() => {
                const eng = engineRef.current;
                if (!eng) return null;
                const st = eng.getStats();
                const acc = st.shots > 0 ? Math.round((st.hits / st.shots) * 100) : 0;
                const rows: [string, string][] = [
                  [t("stShots"), String(st.shots)],
                  [t("stHits"), String(st.hits)],
                  [t("stAcc"), `${acc}%`],
                  [t("stPeeks"), `${st.peeks} (${st.peekLive})`],
                  [t("stDmgDealt"), String(st.dmgDealt)],
                  [t("stDmgTaken"), String(st.dmgTaken)],
                  [t("stSkills"), String(st.skillsUsed)],
                ];
                const bestLabel = bestInfo?.hasBest
                  ? bestInfo.endless
                    ? t("bestEndless", { s: bestInfo.score, r: bestInfo.rounds })
                    : t("bestStd", { r: bestInfo.rounds })
                  : t("bestNone");
                return (
                  <div className="mt-3 border-2 border-dashed border-[#221a12]/30 px-4 py-2.5">
                    <div className="flex items-center justify-between">
                      <div className="font-marker text-lg text-[#8a6d1d]">{t("statsTitle")}</div>
                      {bestInfo?.isNew && (
                        <div className="stamp-in doodle-box px-2 py-0.5 font-marker text-sm text-[#3f6b3d] rotate-[2deg]">
                          {t("newBest")}
                        </div>
                      )}
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5">
                      {rows.map(([k, v]) => (
                        <div key={k} className="flex items-baseline justify-between font-hand text-[15px]">
                          <span className="text-[#4a4036]">{k}</span>
                          <span className="font-hand-sc">{v}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-1.5 font-hand-sc text-sm text-[#8a6d1d]">{bestLabel}</div>
                  </div>
                );
              })()}
            </div>
            <div className="mt-5 flex justify-center gap-3">
              <button
                className="doodle-btn doodle-red px-8 py-2.5 font-marker text-xl"
                onClick={() => engineRef.current?.restart()}
              >
                {t("playAgain")}
              </button>
              <button className="doodle-btn px-6 py-2.5 font-marker text-xl" onClick={() => engineRef.current?.backToMenu()}>
                {t("menu")}
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
              <div className="font-marker text-3xl text-[#8f2418]">{t("helpTitle")}</div>
              <button className="doodle-btn px-3 py-1 font-marker" onClick={() => setShowHelp(false)}>
                {t("helpClose")}
              </button>
            </div>
            {settings.lang === "id" ? (
              <div className="mt-3 space-y-2 font-hand text-lg leading-snug">
                <p>
                  Di atas meja ada revolver 6-chamber. Tiap ronde diisi campuran{" "}
                  <b className="text-[#8f2418]">LIVE</b> (merah, sakit) dan <b className="text-[#57697c]">BLANK</b>{" "}
                  (biru, kosong). Jumlahnya jujur di papan atas — tapi cuma <b>3 giliran</b> pertama. Setelah itu papan{" "}
                  <b className="text-[#8f2418]">memudar giliran demi giliran</b>, dan kalian berdua jalan hanya dengan ingatan.
                  Dealer juga punya ingatan beneran: dia ngitung setiap peluru yang dia lihat — di MUDAH/NORMAL dia kadang
                  kehilangan hitungan.
                </p>
                <p>
                  Di giliranmu pakai skill dulu kalau mau (gratis, tidak melewatkan giliran), lalu pilih:{" "}
                  <b>TEMBAK DIRI</b> — kalau kosong kamu otomatis dapat SATU tembakan gratis ke Dealer; kalau hidup, kamu
                  kena dan giliran pindah. <b>TEMBAK DEALER</b> — kalau hidup, dia kena dan giliran pindah. HP habis = tamat.
                </p>
                <p>
                  Dadu pembuka memberi <b>2 skill</b>. Di sela ronde, saat senjata habis, <b>ISTIRAHAT TOKO</b> dimulai:{" "}
                  <b>3 barang acak</b> muncul di atas meja. <b>Arahkan kursor</b> buat lihat harga & efek,{" "}
                  <b>klik</b> buat beli sebagai <b className="text-[#8a6d1d]">COBA</b> 1 pakai, maksimal <b>4 skill</b> satu
                  waktu. Coba yang terpakai menguap dalam 2 giliran. Kalau selesai, <b>bunyikan lonceng emas</b> — semua kartu
                  melompat ke tangan Dealer dan ronde berikutnya diisi. Voodoo tidak dijual — pantulan seperti itu harus
                  diperjuangkan, bukan dibeli.
                </p>
                <p>
                  <b>Rarity:</b> kartu <span className="font-marker" style={{ color: RARITY_COLOR.base }}>dasar</span> muncul
                  di semua meja. Kartu <span className="font-marker" style={{ color: RARITY_COLOR.epic }}>EPIC</span> (REWIND,
                  GAMBLE) cuma muncul di NORMAL ke atas. Kartu{" "}
                  <span className="font-marker" style={{ color: RARITY_COLOR.legend }}>LEGEND</span> (PHOENIX, THIRD EYE) cuma
                  di GILA & TANPA BATAS.
                </p>
                <p>
                  <b>Uang:</b> peluru yang mengenai bayar <b>$100</b>, pantulan voodoo <b>$150</b>, selamat satu ronde{" "}
                  <b>$75</b>, modal awal <b>$200</b>. <b>TANPA BATAS:</b> Dealer tidak pernah mati — HP-nya jadi{" "}
                  <b className="text-[#8a6d1d]">SKOR</b>: +1 tiap dia kena, -1 tiap dia sembuh, boleh minus. Bertahanlah
                  selama mungkin. Di PENGATURAN ada juga <b className="text-[#8f5bd4]">MUTATOR</b>: meja kustom dengan HP,
                  skill, kartu, dan efek script buatanmu sendiri.
                </p>
                <p className="text-[#8f2418]">
                  HP: 6 lawan 5 di MUDAH, 5 vs 5 di NORMAL — di GILA kamu cuma dapat 4 sementara Dealer tetap 5. Di 2 HP
                  vignette darah merayap dan jantungmu kembali. Di bawah 3 HP, menembak diri sendiri butuh 0.7 detik penuh
                  keputusan — dan pelurunya keluar 0.2 detik terlambat.
                </p>
                <p className="font-hand-sc text-base text-[#4a4036]">
                  Keyboard: Q = tembak diri · E = tembak Dealer · 1-4 = skill
                </p>
              </div>
            ) : (
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
                  <b>Rarity:</b> <span className="font-marker" style={{ color: RARITY_COLOR.base }}>base</span> cards appear
                  everywhere. <span className="font-marker" style={{ color: RARITY_COLOR.epic }}>EPIC</span> cards (REWIND,
                  GAMBLE) only spawn on NORMAL and above.{" "}
                  <span className="font-marker" style={{ color: RARITY_COLOR.legend }}>LEGEND</span> cards (PHOENIX, THIRD
                  EYE) only on INSANE & ENDLESS tables.
                </p>
                <p>
                  <b>Cash:</b> every bullet you land pays <b>$100</b>, a voodoo reflection pays <b>$150</b>,
                  surviving a round pays <b>$75</b>, and you start with <b>$200</b>. <b>ENDLESS:</b> the Dealer never
                  dies — his HP becomes a <b className="text-[#8a6d1d]">SCORE</b> counter: +1 for every hit he takes,
                  -1 whenever he heals, and it can go negative. Survive as long as you can. SETTINGS also hides{" "}
                  <b className="text-[#8f5bd4]">MUTATORS</b>: custom tables with your own HP, skill counts, card pool and
                  scripted effects.
                </p>
                <p className="text-[#8f2418]">
                  HP: your 6 against his 5 on EASY, 5 vs 5 on NORMAL — and on INSANE you get only 4 while the
                  Dealer keeps 5. At 2 HP a blood vignette creeps in and your heartbeat returns. Below 3 HP,
                  shooting yourself takes a long, cruel 0.7 seconds to pull — and the bullet leaves the barrel
                  0.2 seconds late.
                </p>
                <p className="font-hand-sc text-base text-[#4a4036]">
                  Keyboard: Q = shoot self · E = shoot the Dealer · 1-4 = skills
                </p>
              </div>
            )}
            {/* ROULT — the local AI gamemode designer (no longer a secret) */}
            <div className="mt-4 rounded-[14px_4px_16px_6px] border-2 border-dashed border-[#8f5bd4]/55 bg-[#171226] p-3.5">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-[#7b4fd4] shadow-[0_0_8px_#7b4fd4]" />
                <div className="font-marker text-lg text-[#d9c9ff]">{t("helpRoultTitle")}</div>
              </div>
              <div className="mt-1.5 font-hand text-[15px] leading-snug text-[#c9b3ec]">{t("helpRoultBody")}</div>
              <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.25em] text-[#6d5a96]">
                {t("roultBadge")}
              </div>
            </div>
            <div className="mt-4 font-marker text-2xl">{t("skillsCount", { n: ALL_SKILL_IDS.length })}</div>
            <div className="mt-2 space-y-2">
              {(ALL_SKILL_IDS as SkillId[]).map((id) => (
                <div key={id} className="flex gap-3 border-2 border-[#221a12]/20 rounded-[14px_4px_16px_6px] bg-[#efe7d2] p-2.5">
                  <img src={dataURL(`icon-${id}`, texSkillIcon(id))} alt={id} className="h-12 w-12 shrink-0" />
                  <div>
                    <div className="font-marker text-lg" style={{ color: SKILL_META[id].color }}>
                      {SKILL_META[id].name}{" "}
                      <span
                        className="ml-1 font-hand-sc text-[11px] align-middle"
                        style={{ color: RARITY_COLOR[RARITY[id]] }}
                      >
                        {RARITY[id].toUpperCase()}
                      </span>
                      <span className="font-hand text-sm text-[#4a4036]"> — {SKILL_META[id].tag}</span>
                    </div>
                    <div className="font-hand text-[15px] leading-tight">{SKILL_META[id].desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 font-hand text-base text-[#4a4036]">{t("helpTip")}</div>
          </div>
        </div>
      )}

      {/* ================= ROULT — THE LOCAL AI GAMEMODE DESIGNER ================= */}
      {roultOpen && <RoultChat onClose={() => setRoultOpen(false)} />}
    </div>
  );
}
