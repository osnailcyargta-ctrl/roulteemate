"use client";

/**
 * GameShell — lapisan React untuk HUD ULTIMATE ROULETTE.
 * Mount engine (Three.js) + seluruh overlay doodle: menu, HP, shell counter,
 * skill bar, toast, banner, rules, dan layar menang/kalah.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GameEngine, type HudEvent, type HudSnapshot } from "@/game/engine";
import { SKILL_META, dataURL, texBulletPip, texHeart, texSkillIcon, texSplat, texVoodooMask, type SkillId } from "@/game/doodle";
import { gameAudio } from "@/game/audio";

type Toast = { id: number; text: string; tone: string };
type Pop = { id: number; side: string; text: string; tone: string };
type Splat = { id: number; url: string; left: number; top: number; size: number; rot: number };
type Stamp = { id: number; idSkill: SkillId };

const DIFFS: { id: "gampang" | "normal" | "gila"; label: string; desc: string }[] = [
  { id: "gampang", label: "GAMPANG", desc: "HP kamu 5. PAKDE agak lemot." },
  { id: "normal", label: "NORMAL", desc: "HP 4 vs 4. Adil dan menakutkan." },
  { id: "gila", label: "GILA", desc: "PAKDE tajam. Persiapan mati." },
];

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
  const [muted, setMuted] = useState(false);
  const [diff, setDiff] = useState<"gampang" | "normal" | "gila">("normal");
  const [reloadPips, setReloadPips] = useState(0);
  const [flashRed, setFlashRed] = useState(false);

  /* ---------- dataURL aset HUD (setelah mount, client-only) ---------- */
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
    };
  }, [ready]);

  const assetsRef = useRef(assets);
  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  const handleEvent = useCallback((e: HudEvent) => {
    const id = ++evId.current;
    switch (e.type) {
      case "toast":
        setToasts((t) => [...t.slice(-4), { id, text: e.text, tone: e.tone ?? "info" }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
        break;
      case "banner":
        setBanner({ title: e.title, sub: e.sub });
        setTimeout(() => setBanner(null), 1700);
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
    setMuted((prev) => {
      const m = !prev;
      gameAudio.setMuted(m);
      return m;
    });
  }, []);

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const eng = engineRef.current;
      if (!eng || !snap) return;
      const k = ev.key.toLowerCase();
      if (k === "q") void eng.playerShoot("player");
      else if (k === "e") void eng.playerShoot("enemy");
      else if (k === "h") setShowHelp((v) => !v);
      else if (k === "m") toggleMute();
      else if (/^[1-6]$/.test(k)) {
        const owned = snap.skills.filter((s) => s.owned);
        const target = owned[parseInt(k) - 1];
        if (target) void eng.playerUseSkill(target.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
     
  }, [snap]);

  const eng = engineRef.current;
  const isPlayerTurn = snap?.phase === "playerTurn" && snap.turn === "player" && !snap.busy;
  const phase = snap?.phase ?? "menu";
  const inGame = phase !== "menu";

  /* ---------- render ---------- */
  return (
    <div className="fixed inset-0 overflow-hidden bg-[#0b0a08] select-none">
      {/* dunia 3D */}
      <div ref={mountRef} className="absolute inset-0" />

      {/* overlay filmis */}
      <div className="pointer-events-none absolute inset-0 vignette-overlay z-10" />
      <div className="pointer-events-none absolute inset-0 grain-overlay z-10" />
      {flashRed && <div className="pointer-events-none absolute inset-0 z-10 bg-[rgba(199,62,46,0.35)]" />}
      {snap && snap.hpPlayer === 1 && phase !== "menu" && (
        <div className="pointer-events-none absolute inset-0 z-10 pulse-danger" />
      )}
      {snap && snap.voodooPlayer > 0 && (
        <div
          className="pointer-events-none absolute inset-0 z-10"
          style={{ boxShadow: "inset 0 0 120px rgba(94,156,91,0.45)" }}
        />
      )}

      {/* darah di layar */}
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

      {/* ================= HUD IN-GAME ================= */}
      {inGame && assets && snap && (
        <>
          {/* papan shell counter */}
          <div className="absolute left-1/2 top-3 z-30 -translate-x-1/2">
            <div className="doodle-box px-4 py-1.5 flex items-center gap-3">
              <div className="flex items-center gap-1">
                { }
                <img src={assets.pipLive} alt="live" className="h-7 w-7" />
                <span className="font-marker text-xl text-[#8f2418]">x{snap.live}</span>
              </div>
              <div className="h-6 w-0.5 bg-[#221a12]/30" />
              <div className="flex items-center gap-1">
                { }
                <img src={assets.pipBlank} alt="blank" className="h-7 w-7" />
                <span className="font-marker text-xl text-[#57697c]">x{snap.blank}</span>
              </div>
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

          {/* kiri atas: ronde + tombol */}
          <div className="absolute left-2 top-2 z-30 flex flex-col gap-1.5 sm:left-3 sm:top-3 sm:gap-2">
            <div className="doodle-box doodle-dark px-2 py-0.5 font-marker text-xs rotate-[-1.5deg] sm:px-3 sm:py-1 sm:text-sm">
              RONDE {snap.round}
            </div>
            <div className="flex gap-1.5 sm:gap-2">
              <button
                className="doodle-btn px-2 py-0.5 font-hand-sc text-xs sm:px-2.5 sm:py-1 sm:text-sm"
                onClick={() => setShowHelp(true)}
                aria-label="Cara main"
              >
                ? CARA
              </button>
              <button className="doodle-btn px-2 py-0.5 font-hand-sc text-xs sm:px-2.5 sm:py-1 sm:text-sm" onClick={toggleMute} aria-label="Suara">
                {muted ? "SUARA OFF" : "SUARA ON"}
              </button>
            </div>
          </div>

          {/* kanan atas: PAKDE */}
          <div className="absolute right-3 top-3 z-30 flex flex-col items-end gap-1">
            <div className="doodle-box px-3 py-1 rotate-[1.5deg]">
              <span className="font-marker text-lg text-[#8f2418]">PAKDE</span>
              {snap.voodooEnemy > 0 && (
                 
                <img src={assets.voodoo} alt="voodoo" className="ml-2 inline h-6 w-6 wiggle align-middle" />
              )}
              {snap.enemyCuffed && (
                <span className="ml-2 font-hand-sc text-sm text-[#9b8ec4] underline">diborgol</span>
              )}
            </div>
            <div className="flex gap-1">
              {Array.from({ length: snap.maxHp }).map((_, i) => (
                 
                <img key={i} src={i < snap.hpEnemy ? assets.heartFull : assets.heartEmpty} alt="hp" className="h-8 w-8" />
              ))}
            </div>
          </div>

          {/* pemain: kiri atas di mobile, kiri bawah di desktop */}
          <div className="absolute left-2 top-[88px] z-30 flex flex-col gap-1 sm:left-3 sm:top-auto sm:bottom-3">
            <div className="doodle-box w-fit px-2 py-0.5 rotate-[-1.5deg] sm:px-3 sm:py-1">
              <span className="font-marker text-sm sm:text-lg">KAMU</span>
              {snap.voodooPlayer > 0 && (
                <span className="ml-2 font-hand-sc text-sm text-[#5e9c5b]">voodoo {snap.voodooPlayer}</span>
              )}
              {snap.playerCuffed && (
                <span className="ml-2 font-hand-sc text-sm text-[#9b8ec4] underline">diborgol</span>
              )}
            </div>
            <div className="flex gap-0.5 sm:gap-1">
              {Array.from({ length: snap.maxHp }).map((_, i) => (
                <img key={i} src={i < snap.hpPlayer ? assets.heartFull : assets.heartEmpty} alt="hp" className="h-7 w-7 sm:h-9 sm:w-9" />
              ))}
            </div>
          </div>

          {/* indikator giliran */}
          <div className="pointer-events-none absolute left-1/2 top-[74px] z-20 -translate-x-1/2 sm:top-16">
            {snap.turn === "player" && (
              <div className="doodle-box px-4 py-0.5 font-marker text-[#8f2418] rotate-[-2deg] float-y">
                GILIRANMU
              </div>
            )}
            {snap.turn === "enemy" && (
              <div className="doodle-box doodle-dark px-4 py-0.5 font-marker rotate-[2deg] float-y">
                GILIRAN PAKDE...
              </div>
            )}
          </div>

          {/* must shoot */}
          {snap.mustShoot && snap.turn === "player" && (
            <div className="pointer-events-none absolute left-1/2 top-28 z-30 -translate-x-1/2">
              <div className="doodle-box doodle-red px-4 py-1 font-marker text-xl blink-soft rotate-[-3deg]">
                WAJIB TEMBAK!
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

          {/* skill bar */}
          <div className="absolute bottom-[104px] left-1/2 z-30 flex -translate-x-1/2 items-end gap-1.5 sm:bottom-3 sm:gap-2">
            {snap.skills
              .filter((s) => s.owned)
              .map((s, idx) => (
                <button
                  key={s.id}
                  className={`doodle-btn relative flex h-16 w-16 flex-col items-center justify-center gap-0.5 sm:h-[74px] sm:w-[74px] ${
                    s.usable ? "" : "opacity-60"
                  }`}
                  disabled={!s.usable}
                  onClick={() => void eng?.playerUseSkill(s.id)}
                  title={SKILL_META[s.id].desc}
                >
                  <img src={s.icon} alt={s.id} className="h-8 w-8 sm:h-9 sm:w-9" />
                  <span className="font-hand-sc text-[11px] leading-none">{SKILL_META[s.id].name}</span>
                  <span className="absolute -top-2 -left-1.5 font-marker text-[11px] text-[#8f2418]">
                    {idx + 1}
                  </span>
                  {s.charges >= 0 && (
                    <span className="absolute -bottom-1 right-1 flex gap-0.5">
                      {Array.from({ length: Math.max(s.charges, 0) }).map((_, c) => (
                        <span key={c} className="h-2 w-2 rounded-full bg-[#5e9c5b] border border-[#221a12]" />
                      ))}
                    </span>
                  )}
                  {s.cooldown > 0 && (
                    <span className="absolute inset-0 flex items-center justify-center rounded-[inherit] bg-black/55 font-marker text-2xl text-[#f3ecd7]">
                      {s.cooldown}
                    </span>
                  )}
                </button>
              ))}
          </div>

          {/* tombol tembak */}
          <div className="absolute bottom-3 right-2 z-30 flex flex-row gap-2 sm:right-3 sm:flex-col">
            <button
              className={`doodle-btn doodle-red px-3 py-2.5 font-marker text-sm sm:px-5 sm:text-lg ${isPlayerTurn ? "" : "opacity-50"}`}
              disabled={!isPlayerTurn}
              onClick={() => void eng?.playerShoot("enemy")}
            >
              TEMBAK PAKDE [E]
            </button>
            <button
              className={`doodle-btn px-3 py-2.5 font-marker text-sm sm:px-5 sm:text-lg ${isPlayerTurn ? "" : "opacity-50"}`}
              disabled={!isPlayerTurn}
              onClick={() => void eng?.playerShoot("player")}
            >
              TEMBAK DIRI [Q]
            </button>
          </div>

          {/* toast kiri */}
          <div className="pointer-events-none absolute left-3 top-28 z-30 flex w-64 flex-col gap-1.5">
            {toasts.map((t) => (
              <div
                key={t.id}
                className={`doodle-box pop-in px-3 py-1.5 font-hand text-[15px] leading-tight ${
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

      {/* stamp skill didapat */}
      <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
        {assets &&
          stamps.map((s) => (
            <div key={s.id} className="stamp-in absolute flex flex-col items-center">
              <div className="doodle-box flex items-center gap-3 px-8 py-4 rotate-[-3deg]">
                { }
                <img src={snap?.skills.find((x) => x.id === s.idSkill)?.icon} alt={s.idSkill} className="h-16 w-16" />
                <div>
                  <div className="font-marker text-3xl text-[#8f2418]">{SKILL_META[s.idSkill].name}!</div>
                  <div className="font-hand text-lg">{SKILL_META[s.idSkill].tag}</div>
                </div>
              </div>
            </div>
          ))}
      </div>

      {/* reveal shell (intuisi) */}
      <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
        {assets && reveal && (
          <div className="pop-in flex flex-col items-center gap-2">
            { }
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

      {/* banner tengah */}
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

      {/* ================= MENU ================= */}
      {phase === "menu" && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[2px]">
          <div className="doodle-box w-[min(92vw,560px)] px-8 py-7 rotate-[-0.5deg]">
            <div className="text-center">
              <div className="font-marker text-5xl leading-none text-[#8f2418] rotate-[-1.5deg] drop-shadow-[3px_3px_0_rgba(0,0,0,0.15)]">
                ULTIMATE
              </div>
              <div className="font-marker text-6xl leading-tight rotate-[1deg]">ROULETTE</div>
              <div className="mt-1 font-hand text-xl text-[#4a4036]">
                Russian roulette 2.5D. Satu revolver. Enam chamber. Dadu penentu nasib.
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-2">
              {DIFFS.map((d) => (
                <button
                  key={d.id}
                  onClick={() => {
                    setDiff(d.id);
                    gameAudio.ensure();
                    gameAudio.click();
                  }}
                  className={`doodle-btn flex items-center justify-between px-4 py-2 ${
                    diff === d.id ? "bg-[#221a12] text-[#f3ecd7]" : ""
                  }`}
                >
                  <span className="font-marker text-xl">{d.label}</span>
                  <span className="font-hand text-base opacity-80">{d.desc}</span>
                </button>
              ))}
            </div>

            <div className="mt-5 flex items-center justify-center gap-3">
              <button
                className="doodle-btn doodle-red px-10 py-3 font-marker text-2xl"
                onClick={() => {
                  gameAudio.ensure();
                  void eng?.startGame(diff);
                }}
              >
                MAJU KE MEJA
              </button>
              <button className="doodle-btn px-4 py-3 font-hand-sc text-lg" onClick={() => setShowHelp(true)}>
                CARA MAIN
              </button>
            </div>
            <div className="mt-3 text-center font-hand text-sm text-[#4a4036]">
              Q = tembak diri &middot; E = tembak PAKDE &middot; 1-6 = skill &middot; M = mute
            </div>
          </div>
        </div>
      )}

      {/* ================= GAME OVER / VICTORY ================= */}
      {(phase === "gameover" || phase === "victory") && snap && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
          <div className={`doodle-box w-[min(92vw,520px)] px-8 py-7 ${phase === "victory" ? "rotate-[0.5deg]" : "rotate-[-0.7deg]"}`}>
            <div className="text-center">
              {phase === "victory" ? (
                <>
                  <div className="font-marker text-5xl text-[#3f6b3d] rotate-[1deg]">KAMU HIDUP!</div>
                  <div className="mt-2 font-hand text-xl">
                    PAKDE tumbang di ronde {snap.round}. Ruangan ini resmi milikmu.
                  </div>
                </>
              ) : (
                <>
                  <div className="font-marker text-6xl text-[#8f2418] rotate-[-1.5deg]">GAME OVER</div>
                  <div className="mt-2 font-hand text-xl">
                    Peluru itu buat kamu. Bertahan sampai ronde {snap.round}.
                  </div>
                </>
              )}
              <div className="mt-3 font-hand text-lg text-[#4a4036]">
                HP akhir: kamu {snap.hpPlayer}/{snap.maxHp} &middot; PAKDE {snap.hpEnemy}/{snap.maxHp}
              </div>
            </div>
            <div className="mt-5 flex justify-center gap-3">
              <button
                className="doodle-btn doodle-red px-8 py-2.5 font-marker text-xl"
                onClick={() => void eng?.startGame(snap.difficulty)}
              >
                MAIN LAGI
              </button>
              <button className="doodle-btn px-6 py-2.5 font-marker text-xl" onClick={() => eng?.backToMenu()}>
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
            className="doodle-box doodle-scroll max-h-[88vh] w-[min(94vw,680px)] overflow-y-auto px-7 py-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div className="font-marker text-3xl text-[#8f2418]">CARA MAIN</div>
              <button className="doodle-btn px-3 py-1 font-marker" onClick={() => setShowHelp(false)}>
                X
              </button>
            </div>
            <div className="mt-3 space-y-2 font-hand text-lg leading-snug">
              <p>
                Di meja ada revolver 6-chamber. Tiap ronde diisi campuran shell{" "}
                <b className="text-[#8f2418]">LIVE</b> (merah, sakit) dan <b className="text-[#57697c]">BLANK</b>{" "}
                (biru, kosong). Jumlahnya jujur di papan atas, tapi urutannya acak.
              </p>
              <p>
                Di giliranmu, pakai skill dulu kalau mau (gratis, gak pindah giliran), lalu pilih:{" "}
                <b>TEMBAK DIRI</b> — kalau blank, kamu tetap lanjut menembak; kalau live, kamu kena dan giliran
                pindah. <b>TEMBAK PAKDE</b> — kalau live dia kena, giliran pindah. HP habis = tamat.
              </p>
              <p>
                Chamber habis? Reload + dadu bonus memberi skill baru. PAKDE juga punya skill dan dadunya
                sendiri. Jangan remehkan dia.
              </p>
            </div>
            <div className="mt-4 font-marker text-2xl">6 SKILL</div>
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
              Tips: INTUISI dulu sebelum memutuskan. Reroll kalau chamber terasa terlalu berbahaya. Voodoo paling
              kejam dipasang saat PAKDE sedang berani.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
