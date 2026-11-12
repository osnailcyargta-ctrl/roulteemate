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
  type ShotOutcome,
  type Side,
  type SkillOutcome,
  type ShellType,
} from "./logic";
import { SKILL_IDS, SKILL_META, ALL_SKILL_IDS, texDieFace, texSkillIcon, dataURL, type SkillId } from "./doodle";
import { gameAudio } from "./audio";
import { pick } from "./taunts";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export interface HudSkillSlot {
  id: SkillId;
  owned: boolean;
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
  | { type: "shopTip"; id: SkillId | "bell" | null; xPct: number; yPct: number };

const SMART: Record<Difficulty, number> = { easy: 0.55, normal: 0.8, insane: 0.95 };

/* ---------------- SHOP ---------------- */

/** One physical item lying on the table during a shop break. */
export interface ShopOffer {
  id: SkillId;
  price: number;
  legendary: boolean; // INSANE-only legends
  sold: boolean;
}

export interface ShopOfferView extends ShopOffer {
  disabled: boolean;
  reason: string | null;
}

/** Trial prices. Voodoo is NOT for sale — a reflection is too easy to buy.
 *  The two legends are only stocked on INSANE. */
const SHOP_PRICES: Partial<Record<SkillId, number>> = {
  peek: 120,
  eject: 150,
  coffee: 130,
  reroll: 160,
  cuffs: 220,
  phoenix: 650,
  thirdEye: 550,
};
const LEGENDARY: SkillId[] = ["phoenix", "thirdEye"];
const START_MONEY = 200;
export const MAX_SKILLS = 4;

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class GameEngine {
  scene = new RouletteScene();
  logic: RouletteLogic = new RouletteLogic("normal");
  ai = new EnemyAI(this.logic, 0.8);
  onHud: (s: HudSnapshot) => void = () => {};
  onEvent: (e: HudEvent) => void = () => {};
  busy = false;
  /** The player's cash for the current match. */
  money = 0;
  /** The 3 random items currently lying on the table (shop breaks only). */
  private shopOffers: ShopOffer[] = [];
  private hoverId: SkillId | "bell" | null = null;
  /** Trial skills that were spent and are now fading away (2 turns). */
  private ghosts: { id: SkillId; turns: number }[] = [];
  private shopResolve: (() => void) | null = null;
  private tStart = 0;
  private tRoundStart = 0;
  private tEnd = 0;
  private running = false;
  private container: HTMLElement | null = null;
  private lowHpTaunted = false;

  mount(container: HTMLElement) {
    this.container = container;
    this.scene.init(container);
    container.addEventListener("mousemove", (e) => {
      const r = container.getBoundingClientRect();
      this.scene.setLook(((e.clientX - r.left) / r.width - 0.5) * 2, ((e.clientY - r.top) / r.height - 0.5) * 2);
      this.onShopPointerMove(e);
    });
    container.addEventListener("click", (e) => this.onShopClick(e));
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
      skills: ALL_SKILL_IDS.map((id) => {
        const sk = st.skills[id];
        return {
          id,
          owned: sk.owned,
          charges: sk.charges,
          cooldown: sk.cooldown,
          usable: this.logic.canUseSkill("player", id) && !this.busy,
          icon: dataURL(`icon-${id}`, texSkillIcon(id)),
          trial: !!sk.trial,
          ghostTurns: this.ghosts.find((g) => g.id === id)?.turns ?? 0,
        };
      }),
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

  /** Playtime in the current round and in the whole match (ms). */
  getTimes() {
    const now = this.tEnd || (this.tStart > 0 ? performance.now() : 0);
    return {
      roundMs: Math.max(0, now - this.tRoundStart),
      totalMs: Math.max(0, now - this.tStart),
    };
  }

  async startGame(diff: Difficulty) {
    gameAudio.ensure();
    gameAudio.startAmbient();
    this.lowHpTaunted = false;
    this.money = START_MONEY;
    this.ghosts = [];
    this.shopResolve = null;
    this.tStart = performance.now();
    this.tRoundStart = this.tStart;
    this.tEnd = 0;
    this.logic = new RouletteLogic(diff);
    this.ai = new EnemyAI(this.logic, SMART[diff]);
    this.scene.clearSpentShells();
    this.notify();
    this.toast(`Starting cash: $${START_MONEY} — the table stocks goods between rounds.`, "info");

    await sleep(300);
    await this.diceIntro();
    await this.reloadSequence();
    await this.playerTurnStart();
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
    this.logic = new RouletteLogic(this.logic.state.difficulty);
    this.logic.setPhase("menu");
    this.busy = false;
    this.money = 0;
    this.ghosts = [];
    this.shopOffers = [];
    this.setShopHover(null);
    this.shopResolve = null;
    this.tStart = 0;
    this.tEnd = 0;
    this.notify();
  }

  /** Dice intro: 2 rolls for the player (their only skills for the match),
   *  then the enemy silently receives 1/2/3 skills depending on difficulty. */
  private async diceIntro() {
    const diff = this.logic.state.difficulty;
    this.logic.setPhase("dice");
    this.notify();
    await sleep(400);
    this.scene.enemySetMood("grin");
    this.scene.enemySay(["Dice first.", "Your fate is decided here."], 2.8);
    gameAudio.gasp();

    const granted = shuffled(SKILL_IDS).slice(0, 2);

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

    // the enemy quietly takes its skills
    const n = enemySkillCount(diff);
    for (const id of shuffled(SKILL_IDS).slice(0, n)) this.logic.grantSkill("enemy", id);

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
      this.onEvent({ type: "reloadStep", loaded: i + 1, total });
      await sleep(190);
    }
    gameAudio.spinCylinder();
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
    this.busy = false;
  }

  /* ---------------- player turn ---------------- */

  private async playerTurnStart() {
    if (this.logic.state.hp.enemy <= 0 || this.logic.state.hp.player <= 0) return;
    const wasPublic = this.logic.state.countdown > 0;
    this.logic.setPhase("playerTurn");
    this.logic.startTurnTick();
    if (wasPublic && this.logic.state.countdown <= 0 && this.logic.state.cylinder.length > 0) {
      this.toast("THE BOARD FADED — memorize your shells!", "bad");
      gameAudio.ghostFade();
    }
    this.busy = false;
    this.notify();
  }

  async playerShoot(target: Side) {
    const st = this.logic.state;
    if (this.busy || st.phase !== "playerTurn" || st.turn !== "player") return;
    if (st.cylinder.length === 0) return;
    this.busy = true;
    this.notify();

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

  async playerUseSkill(id: SkillId) {
    const st = this.logic.state;
    if (this.busy || st.phase !== "playerTurn" || st.turn !== "player") return;
    if (!this.logic.canUseSkill("player", id)) return;
    this.busy = true;
    this.notify();

    const oc = this.logic.useSkill("player", id);
    if (!oc.ok) {
      this.busy = false;
      this.notify();
      return;
    }
    // a spent TRIAL starts its 2-turn fade away
    const sk = st.skills[id];
    if (sk.trial && sk.charges <= 0) this.registerGhost(id);
    this.onEvent({ type: "skillFlash", id });
    await this.playSkillFx("player", id, oc);
    this.notify();
    this.checkHealthFx();
    await sleep(450);
    this.busy = false;
    this.notify();
  }

  /* ---------------- enemy turn ---------------- */

  private async enemyTurnStart() {
    const st = this.logic.state;
    if (st.hp.enemy <= 0 || st.hp.player <= 0) return;
    st.phase = "enemyTurn";
    const wasPublic = st.countdown > 0;
    this.logic.startTurnTick();
    if (wasPublic && st.countdown <= 0 && st.cylinder.length > 0) {
      this.toast("THE BOARD FADED — memorize your shells!", "bad");
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
      this.toast("You're cuffed! The DEALER goes again.", "bad");
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
    const res = await this.resolveShot(out, tensionSelf);
    if (res === "dead") return "dead";

    const opp: Side = shooter === "player" ? "enemy" : "player";

    if (out.voodooReroll) {
      // VOODOO CURSE: blank was rerolled — the shooter MUST fire once more,
      // and the gun swings toward the opponent.
      this.notify();
      await sleep(300);
      const out2 = this.logic.shoot(shooter, opp, true);
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
      this.toast("VOODOO: blank rerolled — a FRESH shell enters the chamber! Now FIRE at the enemy!", "voodoo");
      await sleep(700);
      gameAudio.spinCylinder();
      this.scene.addTrauma(0.25);
      await sleep(900);
      this.notify();
      return "pass";
    }

    // CASH: every hit you land on the DEALER pays (reflections pay extra).
    if (out.damageTo === "enemy") {
      const gain = out.reflected ? 150 : 100;
      this.money += gain;
      this.toast(`+$${gain}${out.reflected ? " (reflected!)" : ""}`, "good");
    }

    if (out.phoenixSaved) {
      // the killing blow burned the charm instead
      gameAudio.phoenix();
      this.scene.flash(0.65);
      this.scene.setDesat(0.2);
      setTimeout(() => this.scene.setDesat(0), 700);
      this.registerGhost("phoenix");
      this.scene.enemySetMood("scared");
      this.scene.enemySay([pick("phoenix")], 2.6);
      this.onEvent({ type: "banner", title: "PHOENIX!", sub: "You refuse to die — the charm burns for you." });
      await sleep(1200);
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
        if (!shooterIsPlayer) {
          this.scene.enemySetMood("laugh");
          this.onEvent({ type: "dmgPop", side: "player", text: "-1 HP", tone: "hit" });
        } else {
          this.scene.enemySetMood("laugh");
          this.scene.enemySay([pick("playerHitSelf")], 2.4);
          this.onEvent({ type: "dmgPop", side: "player", text: "-1 HP", tone: "hit" });
        }
      } else if (out.damageTo === "enemy") {
        gameAudio.hitEnemy();
        this.scene.addTrauma(0.4);
        this.scene.bloodBurst("enemy", !!out.death);
        this.scene.enemySetMood("hit");
        this.onEvent({ type: "dmgPop", side: "enemy", text: "-1 HP", tone: "hit" });
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

    if (out.death) return "dead";
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
      this.toast("THE DEALER IS CUFFED! Your turn again.", "good");
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
          this.toast("Chamber REROLLED — the live/blank count may have shifted! Now you MUST shoot.", "info");
        } else {
          this.toast("THE DEALER REROLLS the chamber — the live/blank count may have shifted!", "bad");
          this.scene.enemySay([pick("useReroll")], 2);
        }
        await sleep(900);
        break;
      }
      case "peek": {
        gameAudio.scanDing();
        if (isPlayer) {
          this.onEvent({ type: "shellReveal", shell: oc.revealed ?? null });
          this.toast(oc.revealed ? `PEEK: this shell is ${oc.revealed.toUpperCase()}!` : "PEEK: chamber empty?", "info");
        } else {
          this.scene.enemySay([pick("scan")], 2);
        }
        await sleep(1300);
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
        if (isPlayer) this.toast("Sip... +1 HP. That hits the spot.", "good");
        else this.scene.enemySay([pick("useCoffee")], 2);
        await sleep(800);
        break;
      }
      case "cuffs": {
        gameAudio.cuffs();
        if (isPlayer) {
          this.scene.enemySetMood("scared");
          this.scene.enemySay([pick("cuffed")], 2.2);
          this.toast("THE DEALER IS CUFFED! He skips his next turn.", "good");
        } else {
          this.toast("The DEALER cuffs you!", "bad");
        }
        await sleep(900);
        break;
      }
      case "voodoo": {
        gameAudio.voodooCast();
        this.scene.flash(0.3);
        this.scene.setDesat(0.15);
        setTimeout(() => this.scene.setDesat(0), 600);
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
        gameAudio.scanDing();
        this.scene.flash(0.25);
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
        await sleep(1800);
        break;
      }
    }
    this.notify();
  }

  /* ---------------- game over ---------------- */

  private async endGame() {
    const st = this.logic.state;
    const deadSide: Side = st.hp.enemy <= 0 ? "enemy" : "player";
    this.tEnd = performance.now();
    gameAudio.stopHeartbeat();
    this.scene.setRedPulse(0);

    if (deadSide === "enemy") {
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
      st.phase = "gameover";
      this.scene.setTimeScale(0.22, true);
      this.scene.addTrauma(1);
      this.scene.bloodBurst("player", true);
      this.onEvent({ type: "screenSplat" });
      this.scene.setDesat(0.5);
      gameAudio.lose();
      this.scene.enemySetMood("laugh");
      this.scene.enemySay(["I told you...", "don't play with death."], 4);
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

  /* ---------------- ghosts (spent trials fading away) ---------------- */

  /** A spent trial charm starts its 2-turn fade. */
  private registerGhost(id: SkillId) {
    const g = this.ghosts.find((x) => x.id === id);
    if (g) g.turns = 2;
    else this.ghosts.push({ id, turns: 2 });
    gameAudio.ghostFade();
  }

  /** Every passed turn dissolves the ghosts a little more. */
  private tickGhosts() {
    if (!this.ghosts.length) return;
    for (const g of this.ghosts) g.turns -= 1;
    const done = this.ghosts.filter((g) => g.turns <= 0).map((g) => g.id);
    for (const id of done) {
      const sk = this.logic.state.skills[id];
      sk.owned = false;
      sk.trial = false;
      this.toast(`${SKILL_META[id].name} faded away.`, "info");
    }
    this.ghosts = this.ghosts.filter((g) => g.turns > 0);
  }

  /** endTurnAndPass + ghost fade bookkeeping. */
  private passTurn(): Side {
    const next = this.logic.endTurnAndPass();
    this.tickGhosts();
    return next;
  }

  /* ---------------- shop ---------------- */

  /** How many skill slots are in active use (ghosts don't count). */
  activeSkillCount() {
    const st = this.logic.state;
    return ALL_SKILL_IDS.filter((id) => {
      const sk = st.skills[id];
      return sk.owned && !(sk.trial && sk.charges <= 0);
    }).length;
  }

  /** Roll the 3 random items lying on the table this visit.
   *  Legends only on INSANE, voodoo is never sold, owned skills restocked out. */
  private rollOffers(): ShopOffer[] {
    const st = this.logic.state;
    const pool = (Object.keys(SHOP_PRICES) as SkillId[]).filter((id) => {
      if (LEGENDARY.includes(id) && st.difficulty !== "insane") return false;
      return !st.skills[id].owned;
    });
    return shuffled(pool)
      .slice(0, 3)
      .map((id) => ({ id, price: SHOP_PRICES[id]!, legendary: LEGENDARY.includes(id), sold: false }));
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
      title: "SHOP BREAK",
      sub: "Hover the items to buy. Ring the golden bell on the LEFT to start the next round.",
      long: true,
    });
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
    this.scene.ringBellAnim();
    this.scene.enemySay([pick("bellRing")], 2);
    await sleep(750);
    this.closeShop();
  }

  /* ---------------- shop pointer (hover + click on the 3D table) ---------------- */

  private shopNdc(e: MouseEvent): THREE.Vector2 | null {
    const c = this.container;
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private onShopPointerMove(e: MouseEvent) {
    if (this.logic.state.phase !== "shop") {
      if (this.hoverId !== null) this.setShopHover(null);
      if (this.container) this.container.style.cursor = "default";
      return;
    }
    const ndc = this.shopNdc(e);
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
    const ndc = this.shopNdc(e);
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
