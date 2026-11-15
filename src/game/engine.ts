/**
 * engine.ts — orchestrator of ULTIMATE ROULETTE.
 * Connects logic (rules), scene (Three.js), audio and the React HUD.
 * Contains: the opening dice intro (2 skills for the player, 1/2/3 for the
 * enemy by difficulty), between-round reloads, player/AI turn flow and the
 * full VFX timeline (shakes, blood, flash, slow-mo, low-HP dread...).
 */

import * as THREE from "three";
import { RouletteScene } from "./scene";
import {
  RouletteLogic,
  EnemyAI,
  enemySkillCount,
  type AIDecision,
  type Difficulty,
  type Mode,
  type ShotOutcome,
  type Side,
  type SkillOutcome,
  type SkillSlot,
  type ShellType,
} from "./logic";
import {
  SKILL_IDS,
  SKILL_META,
  ALL_SKILL_IDS,
  RARITY,
  texDieFace,
  texSkillIcon,
  dataURL,
  type Rarity,
  type SkillId,
} from "./doodle";
import { gameAudio } from "./audio";
import { pick } from "./taunts";
import { t } from "./i18n";
import { MUT_DEFAULTS, type MutConfig } from "./mutator";
import { compileScript, ScriptRuntime, type ScriptEventName, type ScriptHost } from "./script";
import { coinFlip, getDailyInfo, rngStream, scriptChance, setDailyOff, setDailySeed, streamPick } from "./seed";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export interface HudSkillSlot {
  uid: number; // one inventory slot — duplicates are SEPARATE slots
  id: SkillId;
  charges: number;
  cooldown: number;
  usable: boolean;
  icon: string;
  trial: boolean; // shop trial (1 use)
  ghostTurns: number; // > 0 = used, currently fading away
}

export interface HudSnapshot {
  phase: "menu" | "dice" | "reloading" | "shop" | "playerTurn" | "enemyTurn" | "gameover" | "victory";
  round: number;
  mode: Mode;
  score: number; // ENDLESS: the DEALER's score counter (replaces his HP)
  hpPlayer: number;
  hpEnemy: number;
  maxHpPlayer: number;
  maxHpEnemy: number;
  money: number;
  live: number;
  blank: number;
  countdown: number; // turns left before the live/blank board fades
  countsPublic: boolean;
  turn: Side | null;
  skills: HudSkillSlot[];
  enemySkills: { id: SkillId; icon: string }[];
  known: ShellType | null;
  voodooPlayer: number;
  voodooEnemy: number;
  mustShoot: boolean;
  enemyCuffed: boolean;
  playerCuffed: boolean;
  busy: boolean;
  difficulty: Difficulty;
  hasGame: boolean;
  /** DAILY SEED active — everyone playing today shares this run. */
  daily: boolean;
  /** The 6-char seed code shown in the HUD (e.g. "K3X9Q2"). */
  seedCode: string;
  /** The UTC date the seed was derived from ("YYYY-MM-DD"). */
  seedDate: string;
  /** The physical items on the table right now (shop phase). */
  shopOffers: ShopOfferView[];
}

export type HudEvent =
  | { type: "toast"; text: string; tone?: "info" | "good" | "bad" | "voodoo" }
  | { type: "banner"; title: string; sub?: string; long?: boolean }
  | { type: "skillGet"; id: SkillId }
  | { type: "shellReveal"; shell: ShellType | null }
  | { type: "shellRevealQueue"; shells: (ShellType | null)[] }
  | { type: "dmgPop"; side: Side; text: string; tone?: "hit" | "blank" | "reflect" }
  | { type: "screenSplat" }
  | { type: "skillFlash"; id: SkillId }
  | { type: "reloadStep"; loaded: number; total: number }
  | { type: "shopTip"; id: SkillId | "bell" | null; xPct: number; yPct: number }
  | { type: "rewindFx"; shell: ShellType }
  | { type: "tutAction"; action: "shoot" | "skill" | "buy" | "bell" | "shopOpen" }
  | { type: "phoenixCut" }
  | { type: "thirdEyeCut" };

const SMART: Record<Difficulty, number> = { easy: 0.55, normal: 0.8, insane: 0.95 };

/* ---------------- SHOP ---------------- */

/** One physical item lying on the table during a shop break. */
export interface ShopOffer {
  id: SkillId;
  price: number;
  rarity: Rarity; // base | epic | legend — drives the tag colors
  legendary: boolean; // kept for the gold shine (legend only)
  sold: boolean;
}

export interface ShopOfferView extends ShopOffer {
  disabled: boolean;
  reason: string | null;
}

/** Trial prices. Voodoo is NOT for sale — a reflection is too easy to buy.
 *  EPIC cards (REWIND, GAMBLE) sit in the middle tier, the two legends top it. */
const SHOP_PRICES: Partial<Record<SkillId, number>> = {
  peek: 120,
  eject: 150,
  coffee: 130,
  reroll: 160,
  cuffs: 220,
  rewind: 280,
  gamble: 240,
  phoenix: 650,
  thirdEye: 550,
};
const START_MONEY = 200;
export const MAX_SKILLS = 4;

/* ---------------- RUN STATS (the end-of-run screen) ---------------- */

export interface RunStats {
  shots: number; // trigger pulls by the PLAYER
  hits: number; // player shots that dealt damage to the DEALER
  peeks: number; // magnifying glass uses
  peekLive: number; // peeks that found a live shell
  dmgDealt: number; // damage points dealt to the DEALER (by any means)
  dmgTaken: number; // damage points taken by the PLAYER (by any means)
  skillsUsed: number; // player skill activations
  rounds: number;
  won: boolean;
  score: number; // ENDLESS score at the end
  money: number;
  ms: number; // total playtime
}

const freshStats = (): RunStats => ({
  shots: 0,
  hits: 0,
  peeks: 0,
  peekLive: 0,
  dmgDealt: 0,
  dmgTaken: 0,
  skillsUsed: 0,
  rounds: 0,
  won: false,
  score: 0,
  money: 0,
  ms: 0,
});

export class GameEngine {
  scene = new RouletteScene();
  logic: RouletteLogic = new RouletteLogic("normal");
  ai = new EnemyAI(this.logic, 0.8);
  onHud: (s: HudSnapshot) => void = () => {};
  onEvent: (e: HudEvent) => void = () => {};
  busy = false;
  /** The player's cash for the current match. */
  money = 0;
  /** The current game mode (standard rounds, or ENDLESS score hunting). */
  mode: Mode = "standard";
  /** The active MUTATORS config, when the player enabled them. */
  mut: MutConfig | null = null;
  /** The custom-effect runtime (C-like scripts), when rules were provided. */
  script: ScriptRuntime | null = null;
  /** DAILY SEED state (HUD display + rerun). */
  dailyOn = true;
  seedCode = "";
  seedDate = "";
  /** set_coin(1|0) from ENGINE C — forces the next gamble flip. */
  private coinOverride: boolean | null = null;
  /** The parameters of the last launch — PLAY AGAIN replays them. */
  private lastLaunch: { diff: Difficulty | "endless"; mut?: MutConfig; daily: boolean } | null = null;
  /** End-of-run statistics. */
  private stats: RunStats = freshStats();
  private statsDone = false;
  /** The 3 random items currently lying on the table (shop breaks only). */
  private shopOffers: ShopOffer[] = [];
  private hoverId: SkillId | "bell" | null = null;
  /** Trial skills that were spent and are now fading away (2 turns). */
  private ghosts: { uid: number; id: SkillId; turns: number }[] = [];
  private shopResolve: (() => void) | null = null;
  private tStart = 0;
  private tRoundStart = 0;
  private tEnd = 0;
  private running = false;
  private container: HTMLElement | null = null;
  private lowHpTaunted = false;
  /** window-level pointer/touch bindings (removed on dispose). */
  private unbindPointer: (() => void) | null = null;

  mount(container: HTMLElement) {
    this.container = container;
    this.scene.init(container);
    // one shared look/hover routine for mouse AND touch — on phones the
    // finger IS the cursor: dragging it pans the room (parallax) and
    // hovers whatever lies under it, shop items included. The listeners
    // sit on WINDOW, not on the canvas: the doodle menu overlays the 3D
    // view, and the parallax must stay alive behind it (mobile users
    // drag their finger over the wallpaper and expect the room to lean).
    const pointerAll = (x: number, y: number) => {
      const r = container.getBoundingClientRect();
      this.scene.setLook(((x - r.left) / r.width - 0.5) * 2, ((y - r.top) / r.height - 0.5) * 2);
      this.onShopPointerMove(x, y);
    };
    const onMouse = (e: MouseEvent) => pointerAll(e.clientX, e.clientY);
    const onTouch = (e: TouchEvent) => {
      const t0 = e.touches[0];
      if (!t0) return;
      pointerAll(t0.clientX, t0.clientY);
    };
    const onClick = (e: MouseEvent) => this.onShopClick(e);
    window.addEventListener("mousemove", onMouse, { passive: true });
    window.addEventListener("touchstart", onTouch, { passive: true });
    window.addEventListener("touchmove", onTouch, { passive: true });
    container.addEventListener("click", onClick);
    this.unbindPointer = () => {
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("touchstart", onTouch);
      window.removeEventListener("touchmove", onTouch);
      container.removeEventListener("click", onClick);
    };
    this.running = true;
    const loop = (now: number) => {
      if (!this.running) return;
      this.scene.render(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    this.logic.setPhase("menu");
    this.notify();
  }

  dispose() {
    this.running = false;
    if (this.unbindPointer) {
      this.unbindPointer();
      this.unbindPointer = null;
    }
    this.scene.dispose();
    gameAudio.stopAmbient();
    gameAudio.stopHeartbeat();
  }

  /* ---------------- HUD ---------------- */

  snapshot(): HudSnapshot {
    const st = this.logic.state;
    return {
      phase: st.phase,
      round: st.round,
      mode: st.mode,
      score: st.score,
      hpPlayer: st.hp.player,
      hpEnemy: st.hp.enemy,
      maxHpPlayer: st.maxHp.player,
      maxHpEnemy: st.maxHp.enemy,
      money: this.money,
      live: this.logic.liveRemaining,
      blank: this.logic.blankRemaining,
      countdown: st.countdown,
      countsPublic: this.logic.countsPublic,
      turn: st.phase === "playerTurn" ? "player" : st.phase === "enemyTurn" ? "enemy" : null,
      skills: st.skills.map((slot) => ({
        uid: slot.uid,
        id: slot.id,
        charges: slot.charges,
        cooldown: slot.cooldown,
        usable: this.logic.canUseSkill("player", slot.uid) && !this.busy,
        icon: dataURL(`icon-${slot.id}`, texSkillIcon(slot.id)),
        trial: !!slot.trial,
        ghostTurns: this.ghosts.find((g) => g.uid === slot.uid)?.turns ?? 0,
      })),
      enemySkills: SKILL_IDS.filter((id) => st.enemySkills[id].owned).map((id) => ({
        id,
        icon: dataURL(`icon-${id}`, texSkillIcon(id)),
      })),
      known: this.logic.playerKnown,
      voodooPlayer: st.voodooTurns.player,
      voodooEnemy: st.voodooTurns.enemy,
      mustShoot: st.mustShoot,
      enemyCuffed: st.enemySkipTurns > 0,
      playerCuffed: st.playerSkipTurns > 0,
      busy: this.busy,
      difficulty: st.difficulty,
      hasGame: st.round > 0 || st.phase !== "menu",
      daily: this.dailyOn,
      seedCode: this.seedCode,
      seedDate: this.seedDate,
      shopOffers: this.shopOffers.map((o) => this.offerView(o)),
    };
  }

  /** Live buyability of one offer (slots & cash can change any moment). */
  private offerView(o: ShopOffer): ShopOfferView {
    const st = this.logic.state;
    let disabled = false;
    let reason: string | null = null;
    if (o.sold) {
      reason = "SOLD";
    } else if (this.activeSkillCount() >= MAX_SKILLS) {
      disabled = true;
      reason = `SLOTS FULL (${MAX_SKILLS})`;
    } else if (this.money < o.price) {
      disabled = true;
      reason = "TOO POOR";
    }
    void st;
    return { ...o, disabled, reason };
  }

  notify() {
    this.onHud(this.snapshot());
  }

  private toast(text: string, tone: "info" | "good" | "bad" | "voodoo" = "info") {
    this.onEvent({ type: "toast", text, tone });
  }

  /** Low-HP tension: blood vignette hooks + heartbeat + red pulse. */
  private checkHealthFx() {
    const hp = this.logic.state.hp.player;
    if (hp === 1) {
      gameAudio.startHeartbeat(true);
      this.scene.setRedPulse(0.32);
      if (!this.lowHpTaunted && this.logic.state.hp.enemy > 0) {
        this.lowHpTaunted = true;
        this.toast("YOUR HEART POUNDS... 1 HP LEFT!", "bad");
      }
    } else if (hp === 2) {
      gameAudio.startHeartbeat(false);
      this.scene.setRedPulse(0.12);
      this.lowHpTaunted = false;
    } else {
      gameAudio.stopHeartbeat();
      this.scene.setRedPulse(0);
      this.lowHpTaunted = false;
    }
  }

  /* ---------------- main flow ---------------- */

  /** End-of-run statistics (read by the GAME OVER screen). */
  getStats(): RunStats {
    return { ...this.stats };
  }

  /** PLAY AGAIN: relaunch with the exact same table parameters. */
  restart() {
    if (!this.lastLaunch) return;
    void this.startGame(this.lastLaunch.diff, this.lastLaunch.mut, this.lastLaunch.daily);
  }

  /** The SHOP pool for this table. EPIC cards live here ONLY — and only on
   *  NORMAL and above. LEGEND needs INSANE / ENDLESS (+ the allow-legend
   *  switch). The mutator card pool gates everything further. */
  private poolFor(diff: Difficulty, mode: Mode): SkillId[] {
    const mut = this.mut;
    let pool = ALL_SKILL_IDS;
    if (mut) pool = pool.filter((id) => mut.pool.includes(id));
    const epicOk = diff !== "easy"; // EPIC: shop-only, NORMAL+
    const legendOk = (diff === "insane" || mode === "endless") && (mut ? mut.allowLegend : true);
    return pool.filter((id) => {
      const r = RARITY[id];
      if (r === "epic") return epicOk;
      if (r === "legend") return legendOk;
      return true;
    });
  }

  /** The DICE pool: strictly BASE cards. The dice NEVER hands out EPIC or
   *  LEGEND — epic cards are bought in the shop on NORMAL+ tables only. */
  private dicePool(): SkillId[] {
    return this.poolFor(
      this.logic.state.difficulty,
      this.logic.state.mode,
    ).filter((id) => RARITY[id] === "base");
  }

  /** Draw n skills for the DEALER. DETERMINISTIC UNDER THE DAILY SEED:
   *  each pick comes from the "skill" stream (enemy lane), skipping what
   *  he already owns unless the mutator allows duplicates. */
  private drawSkills(side: Side, pool: SkillId[], n: number) {
    const allowDup = this.mut?.allowDup ?? false;
    const st = this.logic.state;
    for (let k = 0; k < n; k++) {
      const id = streamPick(
        pool,
        (x) => (st.enemySkills[x].owned && !allowDup),
        "skill",
        k + 100, // the enemy lane of the stream (player dice uses 0..)
      );
      if (id) {
        this.logic.grantSkill(side, id);
      } else {
        // everything is owned and dupes are off — fall back to the whole
        // pool (still deterministic: fallback lane of the same stream)
        const id2 = pool[Math.floor(rngStream("skill", k + 200, 0) * pool.length)];
        if (id2) this.logic.grantSkill(side, id2);
      }
    }
  }

  async startGame(diff: Difficulty | "endless", mut?: MutConfig, daily = true) {
    gameAudio.ensure();
    gameAudio.startAmbient();
    this.lowHpTaunted = false;
    this.money = START_MONEY;
    this.ghosts = [];
    this.shopResolve = null;
    this.coinOverride = null;
    this.stats = freshStats();
    this.statsDone = false;
    this.lastLaunch = { diff, mut, daily };
    // DAILY SEED: one algorithm over today's date — same run for everyone,
    // computed fresh (never hardcoded). OFF = classic Math.random chaos.
    const seedInfo = getDailyInfo();
    if (daily) {
      setDailySeed(seedInfo.seed);
      this.seedCode = seedInfo.code;
      this.seedDate = seedInfo.date;
    } else {
      setDailyOff();
      this.seedCode = "";
      this.seedDate = "";
    }
    this.dailyOn = daily;
    this.tStart = performance.now();
    this.tRoundStart = this.tStart;
    this.tEnd = 0;
    // ENDLESS counts as INSANE: same sharp brain, legends allowed in the shop.
    const mode: Mode = diff === "endless" ? "endless" : "standard";
    const baseDiff: Difficulty = diff === "endless" ? "insane" : diff;
    this.mode = mode;
    this.mut = mut ?? null;
    if (mut) {
      const filled: MutConfig = { ...MUT_DEFAULTS, ...mut };
      this.mut = filled;
      this.logic = new RouletteLogic(baseDiff, mode, {
        hpPlayer: filled.hpPlayer,
        hpEnemy: filled.hpEnemy,
      });
    } else {
      this.logic = new RouletteLogic(baseDiff, mode);
    }
    this.ai = new EnemyAI(this.logic, SMART[this.mut?.ai ?? baseDiff]);
    this.scene.setThemeTint(0); // any previous theme(color) dies with the table
    await this.setupScripts();
    this.scene.clearSpentShells();
    this.scene.dealerCuffed(false);
    this.scene.dollyHome();
    this.scene.voodooEndFX("player");
    this.scene.voodooEndFX("enemy");
    this.notify();
    if (mode === "endless") {
      this.toast(t("endlessIntro"), "info");
    } else {
      this.toast(t("startCash", { m: START_MONEY }), "info");
    }

    await sleep(300);
    await this.diceIntro();
    await this.reloadSequence();
    await this.playerTurnStart();
  }

  /** Compile the mutator's ENGINE C program to WebAssembly and wire it up.
   *  The script runs NATIVELY in the browser's WASM engine — not in JS. */
  private async setupScripts() {
    const src = this.mut?.rules ?? "";
    this.script = null;
    if (!src.trim()) return;
    const compiled = compileScript(src);
    for (const e of compiled.errors.slice(0, 4)) this.toast(`[ENGINE C] ${e}`, "bad");
    if (!compiled.ok || !compiled.bytes) return;
    const host: ScriptHost = {
      runSkill: (id, target) => void this.forceSkillFx(id, target),
      heal: (side, n) => {
        const did = this.logic.healSide(side, n);
        if (did) this.onEvent({ type: "dmgPop", side, text: `+${n} HP`, tone: "reflect" });
      },
      damage: (side, n) => {
        const dead = this.logic.damageSide(side, n);
        if (side === "enemy") {
          this.scene.bloodBurst("enemy");
          if (this.logic.state.mode === "endless") this.onEvent({ type: "dmgPop", side, text: `SCORE +${n}`, tone: "hit" });
          else this.onEvent({ type: "dmgPop", side, text: `-${n} HP`, tone: "hit" });
        } else {
          this.onEvent({ type: "screenSplat" });
          this.scene.addTrauma(0.4);
          if (!dead) this.onEvent({ type: "dmgPop", side, text: `-${n} HP`, tone: "hit" });
        }
      },
      say: (text) => this.toast(text, "info"),
      stateRef: () => ({
        hp: this.logic.state.hp,
        score: this.logic.state.score,
        round: this.logic.state.round,
      }),
      // ENGINE C v2 builtins — chance() runs through the DAILY SEED script
      // lane so a seeded table stays reproducible for everyone
      chance: (p) => scriptChance(p),
      shuffle: () => this.logic.shuffleChamber(),
      theme: (c) => this.scene.setThemeTint(c),
      setDmgNext: (n) => {
        this.logic.dmgNext = Math.max(0, n | 0);
      },
      setCoin: (win) => {
        this.coinOverride = win !== 0;
      },
    };
    try {
      this.script = await ScriptRuntime.instantiate(compiled.bytes, host, (msg) => this.toast(msg, "bad"));
    } catch (e) {
      this.toast(`[ENGINE C] ${(e as Error).message}`, "bad");
      return;
    }
    this.script.fire("setup");
    if (this.logic.state.hp.player <= 0) {
      // a setup rule killed the player before the first round — mercy: undo it
      this.logic.state.hp.player = 1;
      this.toast("[custom rules] the setup killed you already... you start at 1 HP instead.", "bad");
    }
  }

  /** Fire a custom-rule event (best-effort; scripts may never crash the game). */
  private fireScript(event: ScriptEventName, ctx: { skill?: SkillId } = {}) {
    try {
      this.script?.fire(event, ctx);
    } catch {
      /* a broken rule must never break the game */
    }
  }

  /** A script FORCED a skill's effect — apply it with a matching mini-FX. */
  private async forceSkillFx(id: SkillId | "all", target: Side) {
    const real: SkillId =
      id === "all"
        ? (ALL_SKILL_IDS[Math.floor(Math.random() * ALL_SKILL_IDS.length)] as SkillId)
        : id;
    // gamble resolves its own flip INSIDE the case below (coin FX first)
    const oc: Partial<SkillOutcome> = real === "gamble" ? {} : this.logic.forceSkill(real, target);
    this.onEvent({ type: "skillFlash", id: real });
    const label = SKILL_META[real].name;
    switch (real) {
      case "cuffs":
        gameAudio.cuffs();
        if (target === "enemy") {
          this.scene.dealerCuffed(true);
          this.toast(`CUSTOM RULE: ${label} — the DEALER is cuffed!`, "good");
        } else {
          this.toast(`CUSTOM RULE: ${label} — YOUR wrists are locked!`, "bad");
        }
        break;
      case "coffee":
        gameAudio.heal();
        void this.scene.coffeeDrinkFX(target);
        this.toast(`CUSTOM RULE: ${label} — ${target === "player" ? "you" : "the DEALER"} take a sip.`, target === "player" ? "good" : "bad");
        break;
      case "reroll":
        gameAudio.spinCylinder();
        this.scene.addTrauma(0.2);
        this.toast(`CUSTOM RULE: ${label} — the chamber spins!`, "info");
        break;
      case "voodoo":
        gameAudio.voodooCast();
        this.scene.voodooCastFX(target);
        this.toast(`CUSTOM RULE: ${label} curse on ${target === "player" ? "YOU" : "the DEALER"}!`, "voodoo");
        break;
      case "peek":
        gameAudio.scanDing();
        this.toast(`CUSTOM RULE: ${label} — ${target === "player" ? "you" : "the DEALER"} inspect the chamber.`, "info");
        break;
      case "eject":
        gameAudio.ejectShell();
        this.toast(`CUSTOM RULE: ${label} — a shell is tossed!`, "info");
        break;
      case "gamble": {
        // the REAL semi-3D coin: tossed up from the table, lands on the face
        // the script rolled — then the effect applies.
        // ENGINE C: every (coin) fires first; set_coin(1|0) forces the face.
        // DAILY SEED: the unforced flip comes from the coin lane.
        let win = coinFlip();
        this.fireScript("coin", { skill: "gamble" });
        if (this.coinOverride !== null) {
          win = this.coinOverride;
          this.coinOverride = null;
        }
        this.toast(`CUSTOM RULE: ${label} — a coin flips!`, "info");
        await this.scene.coinTossFX(win);
        this.logic.forceSkill("gamble", target, { win });
        if (target === "player") {
          if (win) {
            gameAudio.heal();
            this.onEvent({ type: "dmgPop", side: "player", text: "+1 HP", tone: "reflect" });
          } else {
            gameAudio.hitPlayer();
            this.scene.addTrauma(0.5);
            this.onEvent({ type: "dmgPop", side: "player", text: "-1 HP", tone: "hit" });
          }
        }
        break;
      }
      case "thirdEye": {
        // scripts get the REAL cinematic too: the violet eye opens, THEN the
        // chamber swings out and the next shells are revealed in firing order
        gameAudio.riser(0.75);
        this.scene.setDesat(0.2);
        setTimeout(() => this.scene.setDesat(0), 1500);
        this.onEvent({ type: "thirdEyeCut" });
        await sleep(1250);
        gameAudio.scanDing();
        this.scene.flash(0.25);
        this.scene.gunPeek(true);
        const q = oc.queue ?? [];
        this.onEvent({ type: "shellRevealQueue", shells: q });
        this.scene.enemySetMood("scared");
        this.scene.enemySay([pick("thirdEye")], 2.4);
        this.toast(
          q.length
            ? `THIRD EYE: the next ${q.length} shell${q.length > 1 ? "s" : ""} lie bare!`
            : "THIRD EYE: chamber empty?",
          "voodoo",
        );
        await sleep(1900);
        this.scene.gunPeek(false);
        break;
      }
      case "rewind": {
        // TIME GOES BACKWARDS — same 2D un-shot as the real skill, showing
        // the ACTUAL shell that crawls back (live stays live, blank stays blank)
        gameAudio.ghostFade();
        gameAudio.spinCylinder();
        this.scene.setDesat(0.35);
        this.scene.addTrauma(0.12);
        this.onEvent({ type: "rewindFx", shell: oc.rewound?.shell ?? "live" });
        if (oc.rewound?.moneyGain) {
          this.money = Math.max(0, this.money - oc.rewound.moneyGain);
        }
        this.toast(
          oc.rewound
            ? `CUSTOM RULE: ${label} — the ${oc.rewound.shell.toUpperCase()} shell crawls back into the chamber!`
            : `CUSTOM RULE: ${label} — but there was nothing to undo.`,
          "voodoo",
        );
        await sleep(1400);
        this.scene.setDesat(0);
        break;
      }
      case "phoenix": {
        // a script (re)hangs the charm: golden flash + stamp, it stays passive
        gameAudio.phoenix();
        this.scene.flash(0.4);
        this.scene.sparkBurst(this.scene.muzzleWorldPos(), 12);
        this.onEvent({ type: "skillGet", id: "phoenix" });
        this.toast(`CUSTOM RULE: ${label} — the charm hangs at your neck. It refuses death ONCE.`, "good");
        break;
      }
      default:
        this.toast(`CUSTOM RULE: ${label} fires!`, "info");
    }
    this.notify();
  }

  /** Playtime in the current round and in the whole match (ms). */
  getTimes() {
    const now = this.tEnd || (this.tStart > 0 ? performance.now() : 0);
    return {
      roundMs: Math.max(0, now - this.tRoundStart),
      totalMs: Math.max(0, now - this.tStart),
    };
  }

  backToMenu() {
    gameAudio.stopHeartbeat();
    this.scene.setRedPulse(0);
    this.scene.setDesat(0);
    this.scene.setTimeScale(1);
    this.scene.gunAim(null);
    this.scene.enemySetMood("idle1");
    this.scene.hideShopItems();
    this.scene.clearSpentShells();
    this.scene.dealerCuffed(false);
    this.scene.dollyHome();
    this.scene.voodooEndFX("player");
    this.scene.voodooEndFX("enemy");
    this.scene.setThemeTint(0); // the table's theme dies with the run
    this.logic = new RouletteLogic(this.logic.state.difficulty, this.mode);
    this.logic.setPhase("menu");
    this.busy = false;
    this.money = 0;
    this.ghosts = [];
    this.shopOffers = [];
    this.mut = null;
    this.script = null;
    this.coinOverride = null;
    this.lastLaunch = null;
    this.stats = freshStats();
    this.statsDone = false;
    this.dailyOn = true;
    this.seedCode = "";
    this.seedDate = "";
    setDailyOff();
    this.setShopHover(null);
    this.shopResolve = null;
    this.tStart = 0;
    this.tEnd = 0;
    this.notify();
  }

  /** Dice intro: the dice hands out the player's skills (2 by default,
   *  mutators may change the count and the pool), then the enemy quietly
   *  receives its own (1/2/3 by difficulty, mutators may override). */
  private async diceIntro() {
    const diff = this.logic.state.difficulty;
    this.logic.setPhase("dice");
    this.notify();
    await sleep(400);
    this.scene.enemySetMood("grin");
    this.scene.enemySay(["Dice first.", "Your fate is decided here."], 2.8);
    gameAudio.gasp();

    const pool = this.dicePool();
    const nPlayer = Math.max(0, Math.min(6, this.mut?.skillsPlayer ?? 2));
    // duplicates are only handed out when the mutator allows them —
    // and every grant (even a duplicate) becomes its OWN slot.
    // DAILY SEED: the picks come from the deterministic "skill" stream,
    // lane 0 (the enemy lane starts at +100), so everyone gets the same
    // opening hand on the same date.
    const allowDup = this.mut?.allowDup ?? false;
    const granted: SkillId[] = [];
    for (let k = 0; granted.length < nPlayer && k < 32; k++) {
      const id = streamPick(pool, (x) => !allowDup && (granted.includes(x) || !!this.logic.playerSlot(x)), "skill", k);
      if (id) granted.push(id);
    }

    this.scene.diceVisible(true);
    for (const id of granted) {
      gameAudio.diceShake();
      await sleep(360);
      await this.diceTumble(id);
      this.logic.grantSkill("player", id);
      gameAudio.stamp();
      this.onEvent({ type: "skillGet", id });
      this.notify();
      await sleep(820);
    }
    this.scene.diceVisible(false);

    // the enemy quietly takes its skills (base + epic pool, never legends)
    const nEnemy = Math.max(0, Math.min(6, this.mut?.skillsEnemy ?? enemySkillCount(diff)));
    this.drawSkills("enemy", pool, nEnemy);

    this.scene.enemySetMood("laugh");
    gameAudio.laugh();
    this.scene.enemySay([pick("gameStart")], 2.4);
    await sleep(1200);
  }

  /** One dice tumble animation in front of the camera. */
  private diceTumble(finalId: SkillId): Promise<void> {
    const { main, ghosts } = this.scene.diceMeshes();
    let lastSwitch = 0;
    let cycle = Math.floor(Math.random() * SKILL_IDS.length);
    const setFace = (id: SkillId) => this.scene.diceSetFace(id, texDieFace(id));
    const dur = 1400;
    const start = performance.now();
    gameAudio.diceRoll(); // physical tumbling knocks while the die spins
    return new Promise<void>((resolve) => {
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / dur);
        main.rotation.z = Math.pow(1 - t, 1.4) * 10;
        const bounce = Math.abs(Math.sin(t * Math.PI * 3.4)) * (1 - t) * 0.3;
        main.position.y = -0.02 + bounce;
        main.scale.setScalar(0.7 + t * 0.3);
        if (t > 0.7) {
          if (main.userData.face !== finalId) {
            setFace(finalId);
            main.userData.face = finalId;
          }
        } else if (performance.now() - lastSwitch > 40 + t * t * 240) {
          lastSwitch = performance.now();
          cycle = (cycle + 1) % SKILL_IDS.length;
          setFace(SKILL_IDS[cycle]);
          main.userData.face = SKILL_IDS[cycle];
        }
        ghosts.forEach((g, i) => {
          g.rotation.z = main.rotation.z - 0.05 * (i + 1);
          g.position.y = main.position.y + 0.012 * (i + 1);
          g.material.opacity = (0.13 / (i + 1)) * (1 - t * 0.4);
          g.material.map = main.material.map;
        });
        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          gameAudio.diceLand();
          this.scene.flash(0.3);
          // squash & settle
          const s0 = performance.now();
          const squash = () => {
            const k = Math.min(1, (performance.now() - s0) / 220);
            main.scale.set(1 + Math.sin(k * Math.PI) * 0.12, 1 - Math.sin(k * Math.PI) * 0.18, 1);
            main.rotation.z = (1 - k) * 0.08;
            if (k < 1) requestAnimationFrame(squash);
            else resolve();
          };
          squash();
        }
      };
      step();
    });
  }

  /** Between-round reload: gun opens, shells drop in, cylinder spins. */
  private async reloadSequence() {
    this.logic.state.round += 1;
    this.logic.loadCylinder();
    this.tRoundStart = performance.now();
    this.logic.setPhase("reloading");
    this.notify();
    this.busy = true;

    // the Dealer sweeps the last round's casings off the table
    this.scene.clearSpentShells();
    this.scene.setLampBoost(0.4);
    await sleep(380);
    this.scene.gunAim("enemy", true);
    this.scene.gunOpenCylinder(true);
    gameAudio.reloadOpen();
    await sleep(620);

    const total = 6;
    for (let i = 0; i < total; i++) {
      gameAudio.reloadLoad(i);
      // TENSION JUICE: every shell the DEALER feeds in makes the hanging
      // lamp sputter and the camera shiver a little. At low HP it's worse.
      this.scene.lampDip(0.55 + i * 0.06);
      this.scene.addTrauma(0.05 + (this.logic.state.hp.player <= 2 ? 0.04 : 0));
      this.onEvent({ type: "reloadStep", loaded: i + 1, total });
      await sleep(190);
    }
    gameAudio.spinCylinder();
    this.scene.addTrauma(0.14);
    await sleep(560);
    this.scene.gunOpenCylinder(false);
    gameAudio.reloadClose();
    this.scene.setLampBoost(1);
    this.scene.flash(0.28);
    await sleep(420);
    this.scene.gunAim(null);

    const live = this.logic.liveRemaining;
    const blank = this.logic.blankRemaining;
    this.onEvent({
      type: "banner",
      title: `ROUND ${this.logic.state.round}`,
      sub: `LIVE ${live} — BLANK ${blank} — every fired shell lands on the table edge`,
      long: true,
    });
    gameAudio.hammerCock();
    await sleep(1400);
    this.fireScript("round");
    this.busy = false;
  }

  /** The hook that fires when somebody hits 0 HP. A script may heal the
   *  dying side inside every (death) — if HP is back above 0, death is
   *  DENIED and the fight goes on. Returns true when still dead. */
  private deathCheck(): boolean {
    const st = this.logic.state;
    if (st.hp.player > 0 && st.hp.enemy > 0) return false;
    this.fireScript("death");
    if (st.hp.player > 0 && st.hp.enemy > 0) {
      this.toast("CUSTOM RULES: DEATH DENIED — someone refused to die!", "voodoo");
      this.notify();
      return false;
    }
    return true;
  }

  /** deathCheck + endGame wrapper: fires the death hook, then either the
   *  fight goes on (a rule revived somebody) or the run ends here. */
  private async checkDeath(_why: string): Promise<boolean> {
    if (!this.deathCheck()) return false;
    await this.endGame();
    return true;
  }

  /* ---------------- player turn ---------------- */

  private async playerTurnStart() {
    // a custom rule may have finished somebody off between turns
    if (this.logic.state.hp.enemy <= 0 || this.logic.state.hp.player <= 0) {
      await this.endGame();
      return;
    }
    const wasPublic = this.logic.state.countdown > 0;
    this.logic.setPhase("playerTurn");
    this.logic.startTurnTick();
    this.fireScript("turn");
    if (wasPublic && this.logic.state.countdown <= 0 && this.logic.state.cylinder.length > 0) {
      this.toast(t("boardFaded"), "bad");
      gameAudio.ghostFade();
    }
    this.busy = false;
    this.scene.dealerCuffed(false); // his skipped turn is over — uncuff him
    this.notify();
  }

  async playerShoot(target: Side) {
    const st = this.logic.state;
    if (this.busy || st.phase !== "playerTurn" || st.turn !== "player") return;
    if (st.cylinder.length === 0) return;
    this.busy = true;
    this.notify();
    // interactive tutorial: the player really pulled the trigger
    this.onEvent({ type: "tutAction", action: "shoot" });

    // LOW-HP TENSION: below 3 HP a self-shot gets 0.7s of pure dread first.
    const tension = target === "player" && st.hp.player < 3;

    this.scene.gunAim(target === "player" ? "self" : "enemy");
    gameAudio.hammerCock();
    gameAudio.riser(tension ? 1.5 : 0.55);
    await sleep(800);
    if (tension) {
      // 0.7s: the trigger finger trembles... 240 + 240 + 220
      this.scene.addTrauma(0.14);
      await sleep(240);
      this.scene.addTrauma(0.18);
      await sleep(240);
      this.scene.addTrauma(0.22);
      await sleep(220);
    }

    const res = await this.shootSequence("player", target, tension);
    this.scene.gunAim(null);
    await this.afterShot("player", res);
  }

  async playerUseSkill(uid: number) {
    const st = this.logic.state;
    if (this.busy || st.phase !== "playerTurn" || st.turn !== "player") return;
    const slot = this.logic.playerSlot(uid);
    if (!slot) return;
    if (!this.logic.canUseSkill("player", uid)) return;
    this.busy = true;
    this.notify();

    let oc: SkillOutcome;
    if (slot.id === "gamble") {
      // THE COIN: the flip is decided first, the REAL semi-3D coin is thrown
      // from the table, and only when it lands does fate apply.
      // ENGINE C: every (coin) fires BEFORE the flip — set_coin(1|0) inside
      // it forces heads/tails for THIS flip (one-shot override).
      // DAILY SEED: the unforced flip comes from the coin lane.
      let win = coinFlip();
      this.fireScript("coin", { skill: "gamble" });
      if (this.coinOverride !== null) {
        win = this.coinOverride;
        this.coinOverride = null;
      }
      this.stats.skillsUsed++;
      this.onEvent({ type: "skillFlash", id: "gamble" });
      gameAudio.diceShake();
      await sleep(250);
      await this.scene.coinTossFX(win);
      oc = this.logic.useSkill("player", uid, { win });
      if (!oc.ok) {
        this.busy = false;
        this.notify();
        return;
      }
      if (win) {
        gameAudio.heal();
        this.onEvent({ type: "dmgPop", side: "player", text: "+1 HP", tone: "reflect" });
        this.toast(t("heads"), "good");
      } else {
        gameAudio.hitPlayer();
        this.scene.addTrauma(0.5);
        this.onEvent({ type: "dmgPop", side: "player", text: "-1 HP", tone: "hit" });
        this.toast(t("tails"), "bad");
      }
    } else {
      oc = this.logic.useSkill("player", uid);
      if (!oc.ok) {
        this.busy = false;
        this.notify();
        return;
      }
      this.stats.skillsUsed++;
      if (slot.id === "peek") {
        this.stats.peeks++;
        if (oc.revealed === "live") this.stats.peekLive++;
      }
      this.onEvent({ type: "skillFlash", id: slot.id });
      await this.playSkillFx("player", slot.id, oc);
    }
    // a spent TRIAL starts its 2-turn fade away
    const spent = this.logic.playerSlot(uid);
    if (spent?.trial && spent.charges <= 0) this.registerGhost(spent);
    // interactive tutorial: the player really used a skill
    this.onEvent({ type: "tutAction", action: "skill" });
    this.fireScript("skill", { skill: slot.id });
    this.notify();
    this.checkHealthFx();

    // GAMBLE tails at 1 HP: the coin can kill its own flipper
    if (oc.died || st.hp.player <= 0) {
      await sleep(600);
      if (await this.checkDeath("gamble")) return;
    }

    // EJECT on the LAST shell empties the cylinder — nothing left to fire,
    // so the round ends RIGHT HERE: shop break, reload, pass the turn.
    if (this.logic.isEmpty) {
      this.toast(t("chamberEmpty"), "info");
      await sleep(900);
      await this.maybeShopAndReload();
      const next = this.passTurn();
      this.notify();
      if (next === "player") {
        this.toast(t("dealerCuffedAgain"), "good");
        await sleep(700);
        await this.playerTurnStart();
      } else {
        await this.enemyTurnStart();
      }
      return;
    }

    await sleep(450);
    this.busy = false;
    this.notify();
  }

  /* ---------------- enemy turn ---------------- */

  private async enemyTurnStart() {
    const st = this.logic.state;
    if (st.hp.enemy <= 0 || st.hp.player <= 0) {
      await this.endGame();
      return;
    }
    st.phase = "enemyTurn";
    const wasPublic = st.countdown > 0;
    this.logic.startTurnTick();
    this.fireScript("turn");
    if (wasPublic && st.countdown <= 0 && st.cylinder.length > 0) {
      this.toast(t("boardFaded"), "bad");
      gameAudio.ghostFade();
    }
    if (this.logic.lastSlip) {
      // the Dealer lost count — and says so out loud
      this.scene.enemySay([pick("aiForget")], 2.2);
    }
    this.busy = true;
    this.notify();

    this.scene.enemySetMood("idle2");
    this.scene.enemySay([pick("enemyTurn")], 2.2);
    await sleep(rnd(1000, 1700));

    let skillsUsed = 0;
    let guard = 0;
    let decision: AIDecision | null = null;
    // AI loop: burn skills first, then shoot
    for (;;) {
      if (st.hp.enemy <= 0 || st.hp.player <= 0) return;
      if (this.logic.isEmpty || guard++ > 24) break;
      const d = this.ai.decide();
      if (d.kind === "skill" && d.skill && skillsUsed < 3) {
        const oc = this.logic.useSkill("enemy", d.skill);
        if (!oc.ok) continue;
        skillsUsed++;
        await this.playSkillFx("enemy", d.skill, oc);
        this.fireScript("skill", { skill: d.skill });
        this.notify();
        await sleep(rnd(500, 850));
        continue;
      }
      decision = d;
      break;
    }

    if (decision && decision.kind === "shoot" && decision.target && !this.logic.isEmpty) {
      this.scene.enemySetMood("aim");
      gameAudio.riser(1.0);
      await sleep(rnd(850, 1400));
      const res = await this.shootSequence("enemy", decision.target);
      this.scene.enemySetMood("idle1");
      if (res === "dead") {
        await this.endGame();
        return;
      }
    }

    if (this.logic.isEmpty) {
      await this.maybeShopAndReload();
    }
    const next = this.passTurn();
    this.notify();
    if (next === "player") {
      await this.playerTurnStart();
    } else {
      // the player is cuffed
      this.toast(t("youCuffed"), "bad");
      await sleep(800);
      await this.enemyTurnStart();
    }
  }

  /* ---------------- shot resolution ---------------- */

  /** Fire one shot and resolve EVERYTHING that follows it:
   *  the voodoo curse (fresh shell + forced shot) and the global
   *  self-blank rule (one automatic free shot at the opponent). */
  private async shootSequence(shooter: Side, target: Side, tensionSelf = false, forced = false): Promise<"pass" | "dead"> {
    const out = this.logic.shoot(shooter, target, forced);
    // STATS: EVERY real trigger pull by the player counts — including the
    // voodoo forced shot and the free shot after a blank self-shot. Without
    // this the accuracy math (hits / shots) quietly lies to the player.
    if (shooter === "player") this.stats.shots++;
    const res = await this.resolveShot(out, tensionSelf);
    if (res === "dead") return "dead";

    const opp: Side = shooter === "player" ? "enemy" : "player";

    if (out.voodooReroll) {
      // VOODOO CURSE: blank was rerolled — the shooter MUST fire once more,
      // and the gun swings toward the opponent.
      this.notify();
      await sleep(300);
      const out2 = this.logic.shoot(shooter, opp, true);
      if (shooter === "player") this.stats.shots++;
      const res2 = await this.resolveShot(out2, false);
      if (res2 === "dead") return "dead";
    } else if (out.bonusShot && !this.logic.isEmpty) {
      // GLOBAL RULE: shot yourself with a blank -> ONE automatic shot at the enemy.
      this.notify();
      if (shooter === "player") {
        this.toast("BLANK! Free shot at the DEALER!", "good");
        this.scene.gunAim("enemy");
        gameAudio.hammerCock();
        await sleep(750);
      } else {
        this.scene.enemySetMood("aim");
        this.toast("DEALER blanks himself — free shot at you!", "bad");
        await sleep(750);
      }
      const out2 = this.logic.shoot(shooter, opp);
      if (shooter === "player") this.stats.shots++;
      const res2 = await this.resolveShot(out2, false);
      if (res2 === "dead") return "dead";
    }
    return "pass";
  }

  /** Animation + effects for ONE trigger pull (both sides). */
  private async resolveShot(out: ShotOutcome, tensionSelf = false): Promise<"pass" | "dead"> {
    const shooterIsPlayer = out.shooter === "player";

    // PHYSICAL RECOUNT: the spent shell lands on the table's front edge,
    // in firing order — the round's history stays visible and checkable.
    this.scene.spawnSpentShell(
      out.shell,
      shooterIsPlayer
        ? this.scene.muzzleWorldPos()
        : this.scene.enemyWorldPos().add(new THREE.Vector3(0.35, 0.42, 0.3)),
    );

    if (out.voodooReroll) {
      gameAudio.blankClick();
      this.toast(
        shooterIsPlayer
          ? "VOODOO: blank rerolled — a FRESH shell enters the chamber! Now FIRE at the enemy!"
          : "VOODOO: the DEALER's blank rerolled — a FRESH shell enters! He must fire at YOU!",
        "voodoo",
      );
      await sleep(700);
      gameAudio.spinCylinder();
      this.scene.addTrauma(0.25);
      await sleep(900);
      this.notify();
      return "pass";
    }

    // CASH: every hit you land on the DEALER pays (reflections pay extra).
    // ENDLESS: hits also feed the SCORE counter (+1 each, -1 when he heals).
    if (out.damageTo === "enemy") {
      const gain = out.reflected ? 150 : 100;
      this.money += gain;
      if (this.logic.state.lastShot) this.logic.state.lastShot.moneyGain = gain;
      if (this.logic.state.mode === "endless") {
        this.onEvent({ type: "dmgPop", side: "enemy", text: out.reflected ? `SCORE +${out.amount}!` : `+${out.amount} SCORE`, tone: "reflect" });
        this.toast(`+$${gain} — SCORE ${this.logic.state.score}${out.reflected ? " (reflected!)" : ""}`, "good");
      } else {
        this.toast(`+$${gain}${out.reflected ? " (reflected!)" : ""}`, "good");
      }
    }

    // STATS: any damage dealt/taken feeds the end-of-run screen
    if (out.damageTo === "enemy") this.stats.dmgDealt += out.amount;
    if (out.damageTo === "player") this.stats.dmgTaken += out.amount;
    if (out.damageTo === "enemy" && shooterIsPlayer && !out.reflected) this.stats.hits++;

    // custom rules: every hit / every X take damage
    this.fireScript("hit", { skill: undefined });
    if (out.damageTo) {
      this.fireScript(out.damageTo === "player" ? "player_take_damage" : "dealer_take_damage");
    }
    if (this.logic.state.hp.player <= 0 || this.logic.state.hp.enemy <= 0) {
      await sleep(400);
      if (await this.checkDeath("shot")) return "dead";
    }

    if (out.phoenixSaved) {
      // the killing blow burned the charm instead — NO text banner anymore,
      // the resurrection is a real cinematic: 2D ember/fire/wing VFX layer
      gameAudio.phoenix();
      this.scene.flash(0.65);
      this.scene.setDesat(0.2);
      setTimeout(() => this.scene.setDesat(0), 700);
      // golden fire everywhere around you
      this.scene.sparkBurst(this.scene.muzzleWorldPos(), 16);
      this.scene.ringBurst(this.scene.muzzleWorldPos(), 1.1);
      // the burned charm slot fades away over the next 2 turns
      const burned = this.logic.state.skills.find((s) => s.id === "phoenix" && s.charges <= 0);
      if (burned) this.registerGhost(burned);
      this.scene.enemySetMood("scared");
      this.scene.enemySay([pick("phoenix")], 2.6);
      this.onEvent({ type: "phoenixCut" });
      await sleep(3300);
    }

    if (out.shell === "live") {
      gameAudio.gunshot();
      if (shooterIsPlayer) {
        this.scene.muzzleFlash();
        this.scene.gunKick();
      } else {
        this.scene.addTrauma(0.5);
        this.scene.flash(0.4);
      }
      // bullet-exit delay: at low HP a self-shot lingers 0.2s longer
      await sleep(tensionSelf ? 340 : 140);

      if (out.reflected) {
        // voodoo reflected the pain back to the shooter
        gameAudio.voodooReflect();
        this.scene.flash(0.55);
        this.onEvent({ type: "dmgPop", side: out.damageTo!, text: "REFLECTED!", tone: "reflect" });
        if (out.damageTo === "enemy") {
          this.scene.bloodBurst("enemy");
          this.scene.enemySetMood("hit");
          this.scene.enemySay([pick("reflect")], 2.2);
        } else {
          this.scene.bloodBurst("player");
          this.onEvent({ type: "screenSplat" });
        }
      } else if (out.damageTo === "player") {
        gameAudio.hitPlayer();
        this.scene.addTrauma(0.85);
        this.scene.setAberration(2.4);
        setTimeout(() => this.scene.setAberration(0), 380);
        this.onEvent({ type: "screenSplat" });
        this.scene.bloodBurst("player");
        const dmgTxt = out.amount > 0 ? `-${out.amount} HP` : "0 DMG";
        if (!shooterIsPlayer) {
          this.scene.enemySetMood("laugh");
          this.onEvent({ type: "dmgPop", side: "player", text: dmgTxt, tone: "hit" });
        } else {
          this.scene.enemySetMood("laugh");
          this.scene.enemySay([pick("playerHitSelf")], 2.4);
          this.onEvent({ type: "dmgPop", side: "player", text: dmgTxt, tone: "hit" });
        }
      } else if (out.damageTo === "enemy") {
        gameAudio.hitEnemy();
        this.scene.addTrauma(0.4);
        this.scene.bloodBurst("enemy", !!out.death);
        this.scene.enemySetMood("hit");
        this.onEvent({ type: "dmgPop", side: "enemy", text: out.amount > 0 ? `-${out.amount} HP` : "0 DMG", tone: "hit" });
        await sleep(650);
        if (out.death !== "enemy") {
          this.scene.enemySetMood("grin");
          this.scene.enemySay([pick("playerHitsEnemy")], 2.2);
        }
      }
      await sleep(520);
    } else {
      // blank
      gameAudio.blankClick();
      if (shooterIsPlayer) {
        this.scene.dustPuffAtCamera();
      } else {
        this.scene.enemySetMood("scared");
      }
      this.onEvent({ type: "dmgPop", side: out.target, text: "CLICK! blank", tone: "blank" });
      const who =
        !shooterIsPlayer && out.target === "enemy"
          ? pick("enemyBlankSelf")
          : shooterIsPlayer && out.target === "player"
            ? pick("playerBlankSelf")
            : pick("playerShootsBlank");
      if (!shooterIsPlayer) {
        this.scene.enemySay([who], 2);
      }
      await sleep(500);
    }

    if (out.death) {
      if (await this.checkDeath("shot")) return "dead";
      out.death = null; // a rule denied this death — the fight goes on
    }
    this.notify();
    this.checkHealthFx();
    return "pass";
  }

  /** After a shot sequence: check death / shop / reload / pass the turn. */
  private async afterShot(shooter: Side, res: "pass" | "dead") {
    if (res === "dead") {
      await this.endGame();
      return;
    }
    if (this.logic.isEmpty) {
      await this.maybeShopAndReload();
    }
    const next = this.passTurn();
    this.notify();
    if (next === "player" && shooter === "player") {
      // the enemy was cuffed, we go again
      this.toast(t("dealerCuffedAgain"), "good");
      await sleep(700);
      await this.playerTurnStart();
    } else if (next === "player") {
      await this.playerTurnStart();
    } else {
      await this.enemyTurnStart();
    }
  }

  /* ---------------- skill FX ---------------- */

  private async playSkillFx(side: Side, id: SkillId, oc: SkillOutcome) {
    const isPlayer = side === "player";
    this.onEvent({ type: "skillFlash", id });
    switch (id) {
      case "reroll": {
        gameAudio.rerollTick();
        gameAudio.spinCylinder();
        this.scene.addTrauma(0.2);
        if (isPlayer) {
          this.scene.gunSpinFX(); // the revolver leaps up and spins fate around
          this.toast("Chamber REROLLED — the live/blank count may have shifted! Now you MUST shoot.", "info");
        } else {
          this.toast("THE DEALER REROLLS the chamber — the live/blank count may have shifted!", "bad");
          this.scene.enemySay([pick("useReroll")], 2);
        }
        await sleep(900);
        if (isPlayer) this.scene.gunSpinEnd();
        break;
      }
      case "peek": {
        gameAudio.scanDing();
        if (isPlayer) {
          // THE MAGNIFYING GLASS ONLY — the old revolver peek animation is
          // gone. The glass rises to your eyes, studies the chamber, sinks.
          await this.scene.magnifierFX("player");
          this.onEvent({ type: "shellReveal", shell: oc.revealed ?? null });
          this.toast(
            oc.revealed
              ? `MAGNIFYING GLASS: this shell is ${oc.revealed.toUpperCase()}!`
              : "MAGNIFYING GLASS: chamber empty?",
            "info",
          );
          await sleep(1500);
        } else {
          // the DEALER raises his own little glass over the chamber
          await this.scene.magnifierFX("enemy");
          this.scene.enemySetMood("idle2");
          this.scene.enemySay([pick("scan")], 2);
          await sleep(1300);
        }
        break;
      }
      case "eject": {
        gameAudio.ejectShell();
        const from = isPlayer ? this.scene.muzzleWorldPos() : this.scene.enemyWorldPos().add(new THREE.Vector3(0, 0.3, 0));
        const to = isPlayer
          ? this.scene.muzzleWorldPos().add(new THREE.Vector3(0.7, -0.4, 0.2))
          : this.scene.enemyWorldPos().add(new THREE.Vector3(0.8, -0.6, 0.4));
        this.scene.flyShell(oc.ejected ?? "blank", from, to, 0.55);
        if (isPlayer) this.toast("Shell tossed out unfired.", "info");
        else this.scene.enemySay([pick("useEject")], 2);
        await sleep(600);
        break;
      }
      case "coffee": {
        gameAudio.heal();
        if (isPlayer) {
          this.toast("Sip... +1 HP. That hits the spot.", "good");
          await this.scene.coffeeDrinkFX("player"); // the real mug, lifted & drunk
        } else {
          this.scene.enemySay([pick("useCoffee")], 2);
          await this.scene.coffeeDrinkFX("enemy"); // the DEALER takes a sip too
        }
        break;
      }
      case "cuffs": {
        gameAudio.cuffs();
        if (isPlayer) {
          // 1) really GRAB the steel bracelet off the table first
          this.toast("You pick up the steel cuffs off the table...", "info");
          await this.scene.cuffPickupFX();
          await sleep(160);
          // 2) interrogation push-in: the camera marches right up to the DEALER
          this.scene.dollyToDealer();
          this.scene.enemySetMood("scared");
          this.scene.enemySay([pick("cuffed")], 2.2);
          await sleep(800);
          // 3) SNAP — the cuffs lock around his wrists
          this.scene.dealerCuffed(true); // sparks + ring + snap
          this.toast("THE DEALER IS CUFFED! He skips his next turn.", "good");
          await sleep(1000);
          this.scene.dollyHome();
          await sleep(450);
        } else {
          this.toast("The DEALER grabs the cuffs — and locks YOUR wrists!", "bad");
          await this.scene.cuffGrabFX(); // he scoops the bracelet off the table
          await this.scene.cuffsAtCameraFX(); // ...and flings it at YOUR hands
        }
        break;
      }
      case "voodoo": {
        gameAudio.voodooCast();
        this.scene.flash(0.3);
        this.scene.setDesat(0.15);
        setTimeout(() => this.scene.setDesat(0), 600);
        this.scene.voodooCastFX(side); // a real doll rises & dangles while cursed
        if (isPlayer) {
          this.toast("VOODOO ACTIVE (2 turns): every live hit on you is REFLECTED!", "voodoo");
          this.scene.enemySetMood("scared");
          this.scene.enemySay([pick("playerVoodooCast")], 2.4);
        } else {
          this.toast("The DEALER cast VOODOO! Think twice before shooting him.", "bad");
          this.scene.enemySay([pick("voodoo")], 2.2);
        }
        await sleep(1100);
        break;
      }
      case "thirdEye": {
        // a real cutscene first: the violet eye opens over the screen,
        // THEN the chamber swings open and the shells are revealed
        gameAudio.riser(0.75);
        this.scene.setDesat(0.2);
        setTimeout(() => this.scene.setDesat(0), 1500);
        this.onEvent({ type: "thirdEyeCut" });
        await sleep(1250);
        gameAudio.scanDing();
        this.scene.flash(0.25);
        this.scene.gunPeek(true); // the chamber swings open before your eyes
        const q = oc.queue ?? [];
        this.onEvent({ type: "shellRevealQueue", shells: q });
        this.scene.enemySetMood("scared");
        this.scene.enemySay([pick("thirdEye")], 2.4);
        this.toast(
          q.length
            ? `THIRD EYE: the next ${q.length} shell${q.length > 1 ? "s" : ""} lie bare!`
            : "THIRD EYE: chamber empty?",
          "voodoo",
        );
        await sleep(1900);
        this.scene.gunPeek(false);
        break;
      }
      case "rewind": {
        // TIME GOES BACKWARDS — the 2D overlay plays the un-shooting with
        // the REAL shell (a blank rewinds as a blank, never a fake live)
        gameAudio.ghostFade();
        gameAudio.spinCylinder();
        this.scene.setDesat(0.35);
        this.scene.addTrauma(0.12);
        this.onEvent({ type: "rewindFx", shell: oc.rewound?.shell ?? "live" });
        const rw = oc.rewound;
        if (rw?.moneyGain) {
          this.money = Math.max(0, this.money - rw.moneyGain); // the cash never happened either
        }
        if (isPlayer) {
          this.toast(
            rw?.damageTo
              ? `REWIND! The ${rw.shell.toUpperCase()} shell crawls back into the chamber — as if nothing happened. (-$${rw.moneyGain})`
              : "REWIND! The shell crawls back into the chamber — that shot never fired.",
            "voodoo",
          );
        } else {
          this.toast("The DEALER REWINDS time — his last shot never fired!", "bad");
          this.scene.enemySay([pick("rewind")], 2.2);
        }
        await sleep(1500);
        this.scene.setDesat(0);
        break;
      }
      case "gamble": {
        // (enemy path only — the player's flip runs through playerUseSkill)
        await this.scene.coinTossFX(!!oc.gambleWin);
        if (isPlayer) {
          if (oc.gambleWin) {
            gameAudio.heal();
            this.toast(t("heads"), "good");
          } else {
            gameAudio.hitPlayer();
            this.scene.addTrauma(0.5);
            this.toast(t("tails"), "bad");
          }
        } else {
          this.toast(oc.gambleWin ? "The DEALER flips HEADS — he gains 1 HP... wait, he has none?" : "The DEALER flips TAILS — bad luck for him!", oc.gambleWin ? "bad" : "good");
        }
        await sleep(400);
        break;
      }
    }
    // ENGINE C: every (peek) fires after any magnifying-glass reveal
    if (id === "peek") this.fireScript("peek");
    this.notify();
  }

  /* ---------------- game over ---------------- */

  private async endGame() {
    const st = this.logic.state;
    const endless = st.mode === "endless";
    const deadSide: Side = st.hp.enemy <= 0 ? "enemy" : "player";
    this.tEnd = performance.now();
    if (!this.statsDone) {
      this.statsDone = true;
      this.stats.rounds = st.round;
      this.stats.won = deadSide === "enemy" && !endless;
      this.stats.score = st.score;
      this.stats.money = this.money;
      this.stats.ms = Math.max(0, this.tEnd - this.tStart);
    }
    gameAudio.stopHeartbeat();
    this.scene.setRedPulse(0);

    if (deadSide === "enemy" && !endless) {
      st.phase = "victory";
      this.scene.setTimeScale(0.3, true);
      this.scene.addTrauma(0.7);
      this.scene.bloodBurst("enemy", true);
      this.scene.enemySetMood("dead");
      this.scene.setDesat(0.35);
      gameAudio.win();
      this.notify();
      await sleep(1600);
      this.scene.setTimeScale(1);
      this.scene.setDesat(0);
      this.onEvent({ type: "banner", title: "YOU SURVIVED", sub: "The DEALER falls. This room is yours now." });
    } else {
      // ENDLESS: only the player can end this — the show goes on until YOU fall
      st.phase = "gameover";
      this.scene.setTimeScale(0.22, true);
      this.scene.addTrauma(1);
      this.scene.bloodBurst("player", true);
      this.onEvent({ type: "screenSplat" });
      this.scene.setDesat(0.5);
      gameAudio.lose();
      this.scene.enemySetMood("laugh");
      this.scene.enemySay(
        endless ? ["The house always wins, kid.", `SCORE ${st.score}. Enjoy oblivion.`] : ["I told you...", "don't play with death."],
        4,
      );
      this.notify();
      await sleep(1800);
      this.scene.setTimeScale(1);
      this.scene.setDesat(0);
    }
    gameAudio.stopAmbient();
    this.notify();
  }

  /* ---------------- util used by scene events ---------------- */

  skillIconOf(id: SkillId) {
    return dataURL(`icon-${id}`, texSkillIcon(id));
  }

  /** SETTINGS: graphics preset passthrough. */
  setSceneQuality(q: "low" | "medium" | "high") {
    this.scene.setQuality(q);
  }

  /* ---------------- ghosts (spent trials fading away) ---------------- */

  /** A spent trial charm starts its 2-turn fade. */
  private registerGhost(slot: SkillSlot) {
    const g = this.ghosts.find((x) => x.uid === slot.uid);
    if (g) g.turns = 2;
    else this.ghosts.push({ uid: slot.uid, id: slot.id, turns: 2 });
    gameAudio.ghostFade();
  }

  /** Every passed turn dissolves the ghosts a little more. */
  private tickGhosts() {
    if (!this.ghosts.length) return;
    for (const g of this.ghosts) g.turns -= 1;
    const done = this.ghosts.filter((g) => g.turns <= 0);
    for (const g of done) {
      const st = this.logic.state;
      const idx = st.skills.findIndex((s) => s.uid === g.uid);
      if (idx >= 0) st.skills.splice(idx, 1);
      this.toast(`${SKILL_META[g.id].name} faded away.`, "info");
    }
    this.ghosts = this.ghosts.filter((g) => g.turns > 0);
  }

  /** endTurnAndPass + ghost fade + voodoo doll bookkeeping. */
  private passTurn(): Side {
    const next = this.logic.endTurnAndPass();
    this.tickGhosts();
    const st = this.logic.state;
    if (st.voodooTurns.player <= 0) this.scene.voodooEndFX("player");
    if (st.voodooTurns.enemy <= 0) this.scene.voodooEndFX("enemy");
    return next;
  }

  /* ---------------- shop ---------------- */

  /** How many skill slots are in active use (ghosts don't count). */
  activeSkillCount() {
    const st = this.logic.state;
    return st.skills.filter((s) => !(s.trial && s.charges <= 0)).length;
  }

  /** Roll the 3 random items lying on the table this visit.
   *  Rarity gates: EPIC needs NORMAL+ (SHOP ONLY — the dice never rolls it),
   *  LEGEND needs INSANE/ENDLESS (+ the allow-legend switch). Voodoo is
   *  never sold, and owned cards restock out unless the mutator allows
   *  duplicates (each copy = its own inventory slot).
   *  DAILY SEED: the selection comes from the deterministic "shop" stream
   *  keyed by the round — same day, same table, for everyone. */
  private rollOffers(): ShopOffer[] {
    const st = this.logic.state;
    const pool = this.poolFor(st.difficulty, st.mode).filter((id) => !!SHOP_PRICES[id]);
    const allowDup = this.mut?.allowDup ?? false;
    const picks: ShopOffer[] = [];
    for (let k = 0; picks.length < 3 && k < 24; k++) {
      const id = streamPick(pool, (x) => {
        const ownedActive = st.skills.some((s) => s.id === x && !(s.trial && s.charges <= 0));
        return ownedActive && !allowDup; // taken = skip this one
      }, "shop", k);
      if (!id || picks.some((o) => o.id === id)) continue;
      picks.push({
        id,
        price: SHOP_PRICES[id]!,
        rarity: RARITY[id],
        legendary: RARITY[id] === "legend",
        sold: false,
      });
    }
    return picks;
  }

  /** Open the shop between rounds and wait for the bell to be rung. */
  private async openShop() {
    const st = this.logic.state;
    this.money += 75; // survival bonus
    this.toast("ROUND SURVIVED: +$75", "good");
    this.shopOffers = this.rollOffers();
    st.phase = "shop";
    this.busy = true;
    gameAudio.shopOpen();
    this.scene.enemySay([pick("shop")], 2.6);
    this.scene.showShopItems(this.shopOffers.filter((o) => !o.sold));
    this.onEvent({
      type: "banner",
      title: t("shopTitle"),
      sub: t("shopSub"),
      long: true,
    });
    this.fireScript("shop"); // ENGINE C: the table stocks its goods
    this.onEvent({ type: "tutAction", action: "shopOpen" });
    this.notify();
    await new Promise<void>((res) => {
      this.shopResolve = res;
    });
    this.busy = false;
  }

  /** Between rounds: shop first (if the cylinder ran dry), then reload. */
  private async maybeShopAndReload() {
    if (this.logic.isEmpty) {
      await this.openShop();
    }
    await this.reloadSequence();
  }

  buyTrial(id: SkillId) {
    if (this.logic.state.phase !== "shop") return;
    const offer = this.shopOffers.find((o) => o.id === id);
    if (!offer || offer.sold) return;
    const view = this.offerView(offer);
    if (view.disabled) {
      gameAudio.dryFire();
      const poor = view.reason === "TOO POOR";
      this.toast(
        poor ? `Not enough cash — $${offer.price} needed.` : "Hands full — 4 skills max!",
        "bad",
      );
      this.scene.enemySay([pick(poor ? "shopPoor" : "shopFull")], 2.4);
      return;
    }
    this.money -= offer.price;
    offer.sold = true;
    this.logic.grantTrial("player", id);
    gameAudio.buy();
    this.scene.sellShopItem(id);
    this.setShopHover(null);
    this.onEvent({ type: "skillGet", id });
    this.toast(`TRIAL ${SKILL_META[id].name} bought — one use, then it fades!`, "good");
    this.scene.enemySay([pick("shopBuy")], 2.2);
    this.onEvent({ type: "tutAction", action: "buy" });
    this.notify();
  }

  closeShop() {
    if (this.logic.state.phase !== "shop") return;
    gameAudio.click();
    this.scene.hideShopItems();
    this.setShopHover(null);
    const r = this.shopResolve;
    this.shopResolve = null;
    r?.();
  }

  /** Ring the little bell: end the break, reload, fight. */
  private async ringBell() {
    if (this.logic.state.phase !== "shop") return;
    gameAudio.scanDing();
    this.onEvent({ type: "tutAction", action: "bell" });
    this.scene.ringBellAnim();
    this.scene.enemySay([pick("bellRing")], 2);
    await sleep(750);
    this.closeShop();
  }

  /* ---------------- shop pointer (hover + click on the 3D table) ---------------- */

  private shopNdc(x: number, y: number): THREE.Vector2 | null {
    const c = this.container;
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }

  private onShopPointerMove(x: number, y: number) {
    if (this.logic.state.phase !== "shop") {
      if (this.hoverId !== null) this.setShopHover(null);
      if (this.container) this.container.style.cursor = "default";
      return;
    }
    const ndc = this.shopNdc(x, y);
    if (!ndc) return;
    const hit = this.scene.pickShop(ndc);
    const id = hit ? (hit.type === "bell" ? "bell" : hit.id) : null;
    if (id !== this.hoverId) {
      this.setShopHover(id);
      if (id) gameAudio.hover();
    }
    if (this.container) this.container.style.cursor = id ? "pointer" : "default";
  }

  private onShopClick(e: MouseEvent) {
    if (this.logic.state.phase !== "shop") return;
    const ndc = this.shopNdc(e.clientX, e.clientY);
    if (!ndc) return;
    const hit = this.scene.pickShop(ndc);
    if (!hit) return;
    if (hit.type === "bell") void this.ringBell();
    else this.buyTrial(hit.id);
  }

  /** Hover changed: tip the 3D item and anchor the HTML tooltip above it. */
  setShopHover(id: SkillId | "bell" | null) {
    this.hoverId = id;
    this.scene.setShopHover(id);
    if (id === null) {
      this.onEvent({ type: "shopTip", id: null, xPct: 0, yPct: 0 });
      return;
    }
    const anchor = this.scene.shopAnchor(id);
    if (anchor) this.onEvent({ type: "shopTip", id, xPct: anchor.xPct, yPct: anchor.yPct });
  }
}
