/**
 * engine.ts — orchestrator ULTIMATE ROULETTE.
 * Menghubungkan logic (aturan), scene (Three.js), audio, dan HUD (React).
 * Berisi: intro dadu, reload antar-ronde, alur giliran pemain/AI,
 * dan seluruh timeline VFX (guncangan, darah, flash, slow-mo, dll).
 */

import * as THREE from "three";
import { RouletteScene } from "./scene";
import { RouletteLogic, EnemyAI, type Difficulty, type ShotOutcome, type Side, type SkillOutcome, type ShellType } from "./logic";
import { SKILL_IDS, SKILL_META, texDieFace, texSkillIcon, dataURL, type SkillId } from "./doodle";
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
}

export interface HudSnapshot {
  phase: "menu" | "dice" | "reloading" | "playerTurn" | "enemyTurn" | "gameover" | "victory";
  round: number;
  hpPlayer: number;
  hpEnemy: number;
  maxHp: number;
  live: number;
  blank: number;
  turn: Side | null;
  skills: HudSkillSlot[];
  known: ShellType | null;
  voodooPlayer: number;
  voodooEnemy: number;
  mustShoot: boolean;
  enemyCuffed: boolean;
  playerCuffed: boolean;
  busy: boolean;
  difficulty: Difficulty;
  hasGame: boolean;
}

export type HudEvent =
  | { type: "toast"; text: string; tone?: "info" | "good" | "bad" | "voodoo" }
  | { type: "banner"; title: string; sub?: string }
  | { type: "skillGet"; id: SkillId }
  | { type: "shellReveal"; shell: ShellType | null }
  | { type: "dmgPop"; side: Side; text: string; tone?: "hit" | "blank" | "reflect" }
  | { type: "screenSplat" }
  | { type: "skillFlash"; id: SkillId }
  | { type: "reloadStep"; loaded: number; total: number };

const SMART: Record<Difficulty, number> = { gampang: 0.55, normal: 0.8, gila: 0.95 };

export class GameEngine {
  scene = new RouletteScene();
  logic: RouletteLogic = new RouletteLogic("normal");
  ai = new EnemyAI(this.logic, 0.8);
  onHud: (s: HudSnapshot) => void = () => {};
  onEvent: (e: HudEvent) => void = () => {};
  busy = false;
  private running = false;
  private container: HTMLElement | null = null;
  private lowHpTaunted = false;

  mount(container: HTMLElement) {
    this.container = container;
    this.scene.init(container);
    container.addEventListener("mousemove", (e) => {
      const r = container.getBoundingClientRect();
      this.scene.setLook(((e.clientX - r.left) / r.width - 0.5) * 2, ((e.clientY - r.top) / r.height - 0.5) * 2);
    });
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
      maxHp: st.maxHp,
      live: this.logic.liveRemaining,
      blank: this.logic.blankRemaining,
      turn: st.phase === "playerTurn" ? "player" : st.phase === "enemyTurn" ? "enemy" : null,
      skills: SKILL_IDS.map((id) => {
        const sk = st.skills[id];
        return {
          id,
          owned: sk.owned,
          charges: sk.charges,
          cooldown: sk.cooldown,
          usable: this.logic.canUseSkill("player", id) && !this.busy,
          icon: dataURL(`icon-${id}`, texSkillIcon(id)),
        };
      }),
      known: this.logic.playerKnown,
      voodooPlayer: st.voodooTurns.player,
      voodooEnemy: st.voodooTurns.enemy,
      mustShoot: st.mustShoot,
      enemyCuffed: st.enemySkipTurns > 0,
      playerCuffed: st.playerSkipTurns > 0,
      busy: this.busy,
      difficulty: st.difficulty,
      hasGame: st.round > 0 || st.phase !== "menu",
    };
  }

  notify() {
    this.onHud(this.snapshot());
  }

  private toast(text: string, tone: "info" | "good" | "bad" | "voodoo" = "info") {
    this.onEvent({ type: "toast", text, tone });
  }

  private checkHealthFx() {
    const hp = this.logic.state.hp.player;
    if (hp === 1) {
      gameAudio.startHeartbeat(true);
      this.scene.setRedPulse(0.32);
      if (!this.lowHpTaunted && this.logic.state.hp.enemy > 0) {
        this.lowHpTaunted = true;
        this.toast("JANTUNG BERDEBAR... 1 HP!", "bad");
      }
    } else if (hp >= 2) {
      gameAudio.stopHeartbeat();
      this.scene.setRedPulse(0);
      this.lowHpTaunted = false;
    }
  }

  /* ---------------- alur utama ---------------- */

  async startGame(diff: Difficulty) {
    gameAudio.ensure();
    gameAudio.startAmbient();
    this.lowHpTaunted = false;
    this.logic = new RouletteLogic(diff);
    this.ai = new EnemyAI(this.logic, SMART[diff]);
    this.notify();

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
    this.logic = new RouletteLogic(this.logic.state.difficulty);
    this.logic.setPhase("menu");
    this.busy = false;
    this.notify();
  }

  /** Intro dadu: 3 lemparan, tiap lemparan memberi 1 skill pasti beda. */
  private async diceIntro() {
    this.logic.setPhase("dice");
    this.notify();
    await sleep(400);
    this.scene.enemySetMood("grin");
    this.scene.enemySay(["Dadu dulu. Nasibmu", "ditentukan di sini."], 2.8);
    gameAudio.gasp();

    const pool = [...SKILL_IDS];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const granted = pool.slice(0, 3);

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

    // musuh diam-diam dapat 3 skill
    const epool = [...SKILL_IDS];
    for (let i = epool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [epool[i], epool[j]] = [epool[j], epool[i]];
    }
    for (const id of epool.slice(0, 3)) this.logic.grantSkill("enemy", id);

    this.scene.enemySetMood("laugh");
    gameAudio.laugh();
    this.scene.enemySay([pick("gameStart")], 2.4);
    await sleep(1200);
  }

  /** Satu lemparan dadu (dipakai intro & tiap reload). */
  private async diceRollOnce(): Promise<SkillId> {
    const id = SKILL_IDS[Math.floor(Math.random() * SKILL_IDS.length)];
    this.scene.diceVisible(true);
    gameAudio.diceShake();
    await sleep(420);
    await this.diceTumble(id);
    this.logic.grantSkill("player", id);
    gameAudio.stamp();
    this.onEvent({ type: "skillGet", id });
    this.notify();
    await sleep(950);
    this.scene.diceVisible(false);
    // musuh juga dapat
    this.logic.grantSkill("enemy", SKILL_IDS[Math.floor(Math.random() * SKILL_IDS.length)]);
    return id;
  }

  /** Animasi tumbling dadu di depan kamera. */
  private diceTumble(finalId: SkillId): Promise<void> {
    const { main, ghosts } = this.scene.diceMeshes();
    let lastSwitch = 0;
    let cycle = Math.floor(Math.random() * SKILL_IDS.length);
    const setFace = (id: SkillId) => this.scene.diceSetFace(id, texDieFace(id));
    const dur = 1400;
    const start = performance.now();
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

  /** Reload antar-ronde: gun terbuka, shell masuk, dadu bonus. */
  private async reloadSequence() {
    this.logic.state.round += 1;
    this.logic.loadCylinder();
    this.logic.setPhase("reloading");
    this.notify();
    this.busy = true;

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

    await this.diceRollOnce();

    const live = this.logic.liveRemaining;
    const blank = this.logic.blankRemaining;
    this.onEvent({
      type: "banner",
      title: `RONDE ${this.logic.state.round}`,
      sub: `LIVE ${live} — BLANK ${blank}`,
    });
    gameAudio.hammerCock();
    await sleep(1400);
    this.busy = false;
  }

  /* ---------------- giliran pemain ---------------- */

  private async playerTurnStart() {
    if (this.logic.state.hp.enemy <= 0 || this.logic.state.hp.player <= 0) return;
    this.logic.setPhase("playerTurn");
    this.logic.startTurnTick();
    this.busy = false;
    this.notify();
  }

  async playerShoot(target: Side) {
    const st = this.logic.state;
    if (this.busy || st.phase !== "playerTurn" || st.turn !== "player") return;
    if (st.cylinder.length === 0) return;
    this.busy = true;
    this.notify();

    this.scene.gunAim(target === "player" ? "self" : "enemy");
    gameAudio.hammerCock();
    gameAudio.riser(0.55);
    await sleep(800);

    const out = this.logic.shoot("player", target);
    const res = await this.resolveShot(out);
    this.scene.gunAim(null);
    await this.afterShot("player", out, res);
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
    this.onEvent({ type: "skillFlash", id });
    await this.playSkillFx("player", id, oc);
    this.notify();
    this.checkHealthFx();
    await sleep(450);
    this.busy = false;
    this.notify();
  }

  /* ---------------- giliran musuh ---------------- */

  private async enemyTurnStart() {
    const st = this.logic.state;
    if (st.hp.enemy <= 0 || st.hp.player <= 0) return;
    st.phase = "enemyTurn";
    this.logic.startTurnTick();
    this.busy = true;
    this.notify();

    this.scene.enemySetMood("idle2");
    this.scene.enemySay([pick("enemyTurn")], 2.2);
    await sleep(rnd(1000, 1700));

    let skillsUsed = 0;
    let guard = 0;
    // AI loop: skill / tembak
    for (;;) {
      if (st.hp.enemy <= 0 || st.hp.player <= 0) return;
      if (this.logic.isEmpty || guard++ > 24) break;
      const d = this.ai.decide();
      if (d.kind === "skill" && d.skill && skillsUsed < 3) {
        const oc = this.logic.useSkill("enemy", d.skill);
        if (!oc.ok) break;
        skillsUsed++;
        await this.playSkillFx("enemy", d.skill, oc);
        this.notify();
        await sleep(rnd(500, 850));
        continue;
      }
      if (d.kind === "shoot" && d.target) {
        const target: Side = d.target;
        this.scene.enemySetMood("aim");
        gameAudio.riser(1.0);
        await sleep(rnd(850, 1400));
        const out = this.logic.shoot("enemy", target);
        const res = await this.resolveShot(out);
        this.scene.enemySetMood("idle1");
        if (res === "dead") {
          await this.endGame(out.death!);
          return;
        }
        if (res === "continue") {
          this.notify();
          await sleep(rnd(600, 1000));
          continue;
        }
        break;
      }
      break;
    }

    if (this.logic.isEmpty) {
      await this.reloadSequence();
    }
    const next = this.logic.endTurnAndPass();
    this.notify();
    if (next === "player") {
      await this.playerTurnStart();
    } else {
      // pemain diborgol musuh
      this.toast("Kamu diborgol! Giliran PAKDE lagi.", "bad");
      await sleep(800);
      await this.enemyTurnStart();
    }
  }

  /* ---------------- resolusi tembakan ---------------- */

  /** Animasi + efek untuk SATU resolusi tembakan (kedua belah pihak). */
  private async resolveShot(out: ShotOutcome): Promise<"continue" | "pass" | "dead"> {
    const shooterIsPlayer = out.shooter === "player";

    if (out.voodooReroll) {
      // KUTUKAN VOODOO: blank di-reroll, wajib nembak diri lagi
      gameAudio.blankClick();
      this.toast("VOODOO: blank di-REROLL! Wajib nembak 1x lagi!", "voodoo");
      await sleep(700);
      gameAudio.spinCylinder();
      this.scene.addTrauma(0.25);
      await sleep(900);
      this.notify();
      const forced = this.logic.shoot(out.shooter, out.shooter, true);
      const r = await this.resolveShot(forced);
      if (forced.voodooCancelled) {
        this.toast("VOODOO BATAL! Kamu kena hasil reroll.", "bad");
      }
      return r;
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
      await sleep(140);

      if (out.reflected) {
        // voodoo memantulkan ke penembak
        gameAudio.voodooReflect();
        this.scene.flash(0.55);
        this.onEvent({ type: "dmgPop", side: out.damageTo!, text: "DIPANTULKAN!", tone: "reflect" });
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
          this.scene.enemySetMood(out.voodooCancelled ? "grin" : "laugh");
          this.scene.enemySay([pick("playerHitSelf")], 2.4);
          this.onEvent({ type: "dmgPop", side: "player", text: "-1 HP", tone: "hit" });
        }
      } else if (out.damageTo === "enemy") {
        gameAudio.hitEnemy();
        this.scene.addTrauma(0.4);
        this.scene.bloodBurst("enemy", !!out.death);
        this.scene.enemySetMood("hit");
        this.onEvent({ type: "dmgPop", side: "enemy", text: out.reflected ? "DIPANTULKAN!" : "-1 HP", tone: out.reflected ? "reflect" : "hit" });
        await sleep(650);
        if (out.death !== "enemy") {
          this.scene.enemySetMood("grin");
          this.scene.enemySay([pick("playerHitsEnemy")], 2.2);
        }
      }
      if (out.voodooCancelled && out.damageTo !== "player") {
        this.toast("VOODOO BATAL!", "bad");
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
      const who = shooterIsPlayer ? (out.target === "player" ? pick("playerBlankSelf") : pick("playerShootsBlank")) : out.target === "enemy" ? pick("enemyBlankSelf") : pick("playerShootsBlank");
      this.onEvent({ type: "dmgPop", side: out.target, text: "KLIK! kosong", tone: "blank" });
      if (!shooterIsPlayer) {
        this.scene.enemySay([who], 2);
      }
      await sleep(500);
    }

    if (out.death) return "dead";
    this.notify();
    this.checkHealthFx();
    return this.logic.shouldKeepTurn(out) ? "continue" : "pass";
  }

  /** Setelah tembakan selesai: cek mati / reload / lanjut giliran. */
  private async afterShot(shooter: Side, out: ShotOutcome, res: "continue" | "pass" | "dead") {
    if (res === "dead") {
      await this.endGame(out.death!);
      return;
    }
    if (this.logic.isEmpty) {
      await this.reloadSequence();
    }
    if (res === "continue" && shooter === "player") {
      this.busy = false;
      this.notify();
      return;
    }
    if (res === "continue" && shooter === "enemy") {
      // enemy loop handles
      return;
    }
    const next = this.logic.endTurnAndPass();
    this.notify();
    if (next === "player") {
      if (shooter === "player") {
        this.toast("PAKDE DIBORGOL! Giliranmu lagi.", "good");
        await sleep(700);
      }
      await this.playerTurnStart();
    } else {
      await this.enemyTurnStart();
    }
  }

  /* ---------------- efek skill ---------------- */

  private async playSkillFx(side: Side, id: SkillId, oc: SkillOutcome) {
    const isPlayer = side === "player";
    const meta = SKILL_META[id];
    this.onEvent({ type: "skillFlash", id });
    switch (id) {
      case "reroll": {
        gameAudio.rerollTick();
        gameAudio.spinCylinder();
        this.scene.addTrauma(0.2);
        if (isPlayer) this.toast("Chamber di-REROLL! Sekarang WAJIB TEMBAK.", "info");
        else this.scene.enemySay([pick("useReroll")], 2);
        await sleep(900);
        break;
      }
      case "intuisi": {
        gameAudio.scanDing();
        if (isPlayer) {
          this.onEvent({ type: "shellReveal", shell: oc.revealed ?? null });
          this.toast(oc.revealed ? `INTUISI: shell ini ${oc.revealed.toUpperCase()}!` : "INTUISI: chamber kosong?", "info");
        } else {
          this.scene.enemySay([pick("scan")], 2);
        }
        await sleep(1300);
        break;
      }
      case "buang": {
        gameAudio.ejectShell();
        const from = isPlayer ? this.scene.muzzleWorldPos() : this.scene.enemyWorldPos().add(new THREE.Vector3(0, 0.3, 0));
        const to = isPlayer
          ? this.scene.muzzleWorldPos().add(new THREE.Vector3(0.7, -0.4, 0.2))
          : this.scene.enemyWorldPos().add(new THREE.Vector3(0.8, -0.6, 0.4));
        this.scene.flyShell("blank", from, to, 0.55);
        if (isPlayer) this.toast("Shell dibuang tanpa dibakar.", "info");
        else this.scene.enemySay([pick("useBuang")], 2);
        await sleep(600);
        break;
      }
      case "kopi": {
        gameAudio.heal();
        if (isPlayer) this.toast("Sruput... +1 HP. Segerrr.", "good");
        else this.scene.enemySay([pick("useKopi")], 2);
        await sleep(800);
        break;
      }
      case "borgol": {
        gameAudio.cuffs();
        if (isPlayer) {
          this.scene.enemySetMood("scared");
          this.scene.enemySay([pick("cuffed")], 2.2);
          this.toast("PAKDE DIBORGOL! Dia skip giliran berikutnya.", "good");
        } else {
          this.toast("PAKDE memborgol kamu!", "bad");
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
          this.toast("VOODOO AKTIF 2 GILIRAN: tembakan live musuh dipantulkan!", "voodoo");
          this.scene.enemySetMood("scared");
          this.scene.enemySay([pick("playerVoodooCast")], 2.4);
        } else {
          this.toast("PAKDE memasang VOODOO! Hati-hati menembak dia.", "bad");
          this.scene.enemySay([pick("voodoo")], 2.2);
        }
        await sleep(1100);
        break;
      }
    }
    this.notify();
  }

  /* ---------------- akhir game ---------------- */

  private async endGame(deadSide: Side) {
    const st = this.logic.state;
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
      this.onEvent({ type: "banner", title: "KAMU HIDUP", sub: "PAKDE tumbang. Ruangan ini milikmu." });
    } else {
      st.phase = "gameover";
      this.scene.setTimeScale(0.22, true);
      this.scene.addTrauma(1);
      this.scene.bloodBurst("player", true);
      this.onEvent({ type: "screenSplat" });
      this.scene.setDesat(0.5);
      gameAudio.lose();
      this.scene.enemySetMood("laugh");
      this.scene.enemySay(["Sudah kubilang...", "jangan mainmain."], 4);
      this.notify();
      await sleep(1800);
      this.scene.setTimeScale(1);
      this.scene.setDesat(0);
    }
    gameAudio.stopAmbient();
    this.notify();
  }

  /* ---------------- util dipakai scene event ---------------- */

  skillIconOf(id: SkillId) {
    return dataURL(`icon-${id}`, texSkillIcon(id));
  }
}
