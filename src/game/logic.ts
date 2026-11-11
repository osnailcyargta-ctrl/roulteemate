/**
 * logic.ts — core rules of ULTIMATE ROULETTE (pure logic, no rendering).
 *
 * Concept: a 6-chamber revolver loaded with LIVE/BLANK shells. Both sides
 * know the counts, never the order. Every shot advances the cylinder.
 * - Shoot SELF + BLANK  -> you automatically fire ONE free shot at the enemy.
 * - Shoot SELF + LIVE   -> you take the damage, turn passes.
 * - Shoot ENEMY + LIVE  -> enemy takes the damage, turn passes.
 * - Shoot ENEMY + BLANK -> turn passes.
 *
 * SKILLS (player owns exactly 2, granted by the opening dice; the enemy owns
 * 1 on EASY, 2 on NORMAL and 3 on INSANE):
 * - REROLL   : rerandomize the current shell once, then you MUST shoot. CD 2 turns.
 * - VOODOO   : 1x per game, active for 2 turns. While cursed, ANY live hit the
 *              owner would take is REFLECTED to the opponent — even a live
 *              round fired at yourself. Bonus curse: shooting yourself with a
 *              BLANK rerolls the shell and forces one shot at the opponent.
 * - PEEK     : look at the current shell. CD 3 turns.
 * - EJECT    : eject the current shell without firing (free action). CD 3 turns.
 * - COFFEE   : +1 HP (up to max). 2 charges per game.
 * - CUFFS    : the enemy skips their next turn. 1 charge per game.
 */

import type { SkillId } from "./doodle";

export type ShellType = "live" | "blank";
export type Side = "player" | "enemy";
export type Difficulty = "easy" | "normal" | "insane";

export interface SkillState {
  owned: boolean;
  charges: number; // for charge-based skills; -1 = cooldown-based
  cooldown: number; // turns left before usable again
  maxCharges: number;
}

export type Phase =
  | "menu"
  | "dice"
  | "reloading"
  | "playerTurn"
  | "enemyTurn"
  | "gameover"
  | "victory";

export interface GameState {
  phase: Phase;
  round: number;
  difficulty: Difficulty;
  maxHp: number;
  hp: Record<Side, number>;
  cylinder: ShellType[]; // index 0 = next shell
  turn: Side;
  skills: Record<SkillId, SkillState>; // player
  enemySkills: Record<SkillId, SkillState>; // enemy
  voodooTurns: Record<Side, number>; // remaining voodoo duration (0 = off)
  enemySkipTurns: number;
  playerSkipTurns: number;
  mustShoot: boolean; // true after reroll
  usedRerollThisTurn: boolean;
}

export interface ShotOutcome {
  shooter: Side;
  target: Side; // aim target
  shell: ShellType; // shell that came out
  damageTo: Side | null;
  reflected: boolean; // damage reflected by voodoo
  bonusShot: boolean; // self-shot blank -> shooter auto-fires once at the opponent
  voodooReroll: boolean; // self-shot blank while cursed -> fresh shell + forced shot
  death: Side | null;
  forced: boolean; // this shot was forced (from the voodoo curse)
}

export interface SkillOutcome {
  ok: boolean;
  reason?: string;
  revealed?: ShellType | null; // peek / eject
  healed?: boolean;
  rerolled?: boolean;
  cuffsApplied?: boolean;
  ejected?: ShellType | null;
}

const CHAMBER_SIZE = 6;

export function opponentOf(side: Side): Side {
  return side === "player" ? "enemy" : "player";
}

function emptySkills(): Record<SkillId, SkillState> {
  return {
    reroll: { owned: false, charges: -1, cooldown: 0, maxCharges: -1 },
    voodoo: { owned: false, charges: 0, cooldown: 0, maxCharges: 1 },
    peek: { owned: false, charges: -1, cooldown: 0, maxCharges: -1 },
    eject: { owned: false, charges: -1, cooldown: 0, maxCharges: -1 },
    coffee: { owned: false, charges: 0, cooldown: 0, maxCharges: 2 },
    cuffs: { owned: false, charges: 0, cooldown: 0, maxCharges: 1 },
  };
}

export const SKILL_CD: Record<SkillId, number> = {
  reroll: 2,
  voodoo: 0,
  peek: 3,
  eject: 3,
  coffee: 0,
  cuffs: 0,
};

/** How many skills the ENEMY gets per difficulty. */
export function enemySkillCount(diff: Difficulty): number {
  return diff === "easy" ? 1 : diff === "normal" ? 2 : 3;
}

export class RouletteLogic {
  state: GameState;
  /** AI-only knowledge of the current shell (from its own peek). */
  aiKnown: ShellType | null = null;
  /** Player knowledge of the current shell (from peek). */
  playerKnown: ShellType | null = null;

  constructor(difficulty: Difficulty = "normal") {
    this.state = this.freshState(difficulty);
  }

  freshState(difficulty: Difficulty): GameState {
    const maxHp = difficulty === "easy" ? 5 : 4;
    return {
      phase: "dice",
      round: 0,
      difficulty,
      maxHp,
      hp: { player: maxHp, enemy: maxHp },
      cylinder: [],
      turn: "player",
      skills: emptySkills(),
      enemySkills: emptySkills(),
      voodooTurns: { player: 0, enemy: 0 },
      enemySkipTurns: 0,
      playerSkipTurns: 0,
      mustShoot: false,
      usedRerollThisTurn: false,
    };
  }

  /* ---------------- cylinder ---------------- */

  loadCylinder() {
    const r = this.state.round;
    let liveCount: number;
    if (r <= 1) liveCount = 2 + (Math.random() < 0.5 ? 1 : 0);
    else if (r === 2) liveCount = 3 + (Math.random() < 0.5 ? 1 : 0);
    else liveCount = 4 + (Math.random() < 0.4 ? 1 : 0);
    liveCount = Math.min(5, Math.max(2, liveCount));
    const shells: ShellType[] = [];
    for (let i = 0; i < liveCount; i++) shells.push("live");
    while (shells.length < CHAMBER_SIZE) shells.push("blank");
    // Fisher-Yates shuffle
    for (let i = shells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shells[i], shells[j]] = [shells[j], shells[i]];
    }
    this.state.cylinder = shells;
    this.playerKnown = null;
    this.aiKnown = null;
  }

  get totalRemaining() {
    return this.state.cylinder.length;
  }

  get liveRemaining() {
    return this.state.cylinder.filter((s) => s === "live").length;
  }

  get blankRemaining() {
    return this.state.cylinder.filter((s) => s === "blank").length;
  }

  get isEmpty() {
    return this.state.cylinder.length === 0;
  }

  /* ---------------- skill grants (dice) ---------------- */

  /** The dice grants a skill. If already owned: charge skills +1 charge
   *  (up to cap), cooldown skills get their cooldown reset. */
  grantSkill(side: Side, id: SkillId) {
    const sk = side === "player" ? this.state.skills[id] : this.state.enemySkills[id];
    sk.owned = true;
    if (sk.charges >= 0) {
      sk.charges = Math.min(sk.maxCharges, sk.charges + 1);
    } else {
      sk.cooldown = 0;
    }
  }

  /* ---------------- skills ---------------- */

  canUseSkill(side: Side, id: SkillId): boolean {
    const st = this.state;
    const sk = side === "player" ? st.skills[id] : st.enemySkills[id];
    if (!sk.owned) return false;
    if (sk.cooldown > 0) return false;
    if (sk.charges === 0) return false;
    if (side === "player" && st.mustShoot && id !== "coffee") return false;
    if (st.phase !== "playerTurn" && st.phase !== "enemyTurn") return false;
    if (side !== st.turn) return false;
    if (id === "coffee" && st.hp[side] >= st.maxHp) return false;
    if (id === "cuffs" && (side === "player" ? st.enemySkipTurns : st.playerSkipTurns) > 0)
      return false;
    if (id === "voodoo" && st.voodooTurns[side] > 0) return false;
    if (id === "eject" && st.cylinder.length === 0) return false;
    if (id === "reroll" && (st.usedRerollThisTurn || st.cylinder.length === 0)) return false;
    return true;
  }

  useSkill(side: Side, id: SkillId): SkillOutcome {
    if (!this.canUseSkill(side, id)) return { ok: false, reason: "not usable" };
    const st = this.state;
    const sk = side === "player" ? st.skills[id] : st.enemySkills[id];
    switch (id) {
      case "reroll": {
        // pure reroll: random result, may repeat itself
        const next: ShellType = Math.random() < 0.5 ? "live" : "blank";
        st.cylinder[0] = next;
        sk.cooldown = SKILL_CD.reroll;
        st.mustShoot = true;
        st.usedRerollThisTurn = true;
        this.playerKnown = null;
        this.aiKnown = null;
        return { ok: true, rerolled: true };
      }
      case "peek": {
        const cur = st.cylinder[0] ?? null;
        sk.cooldown = SKILL_CD.peek;
        if (side === "player") this.playerKnown = cur;
        else this.aiKnown = cur;
        return { ok: true, revealed: cur };
      }
      case "eject": {
        const cur = st.cylinder.shift() ?? null;
        sk.cooldown = SKILL_CD.eject;
        this.playerKnown = null;
        this.aiKnown = null;
        return { ok: true, ejected: cur };
      }
      case "coffee": {
        st.hp[side] = Math.min(st.maxHp, st.hp[side] + 1);
        sk.charges -= 1;
        return { ok: true, healed: true };
      }
      case "cuffs": {
        sk.charges -= 1;
        if (side === "player") st.enemySkipTurns += 1;
        else st.playerSkipTurns += 1;
        return { ok: true, cuffsApplied: true };
      }
      case "voodoo": {
        sk.charges -= 1;
        st.voodooTurns[side] = 2;
        return { ok: true };
      }
    }
  }

  /* ---------------- shooting ---------------- */

  canShoot(side: Side): boolean {
    const st = this.state;
    return st.turn === side && st.cylinder.length > 0;
  }

  /** Resolve ONE trigger pull. `forced` = the mandatory shot from the voodoo curse. */
  shoot(shooter: Side, target: Side, forced = false): ShotOutcome {
    const st = this.state;
    const shell = st.cylinder.shift()!;
    this.playerKnown = null;
    this.aiKnown = null;

    const out: ShotOutcome = {
      shooter,
      target,
      shell,
      damageTo: null,
      reflected: false,
      bonusShot: false,
      voodooReroll: false,
      death: null,
      forced,
    };

    const shooterVoodoo = st.voodooTurns[shooter] > 0;
    const targetIsSelf = target === shooter;
    const targetVoodoo = st.voodooTurns[target] > 0;

    if (targetIsSelf) {
      if (shell === "live") {
        // live to your own head
        if (shooterVoodoo) {
          // VOODOO REFLECTION: even your own bullet cannot touch you —
          // the pain crawls into the opponent instead.
          out.reflected = true;
          out.damageTo = opponentOf(shooter);
        } else {
          out.damageTo = shooter;
        }
      } else {
        // blank to your own head
        if (shooterVoodoo && !forced) {
          // VOODOO CURSE: the blank shell is rerolled and you MUST fire once
          // more — aimed at the opponent. The fresh shell is pushed on top.
          const fresh: ShellType = Math.random() < 0.5 ? "live" : "blank";
          st.cylinder.unshift(fresh);
          out.voodooReroll = true;
          return out;
        }
        // GLOBAL RULE: self-shot blank -> one automatic free shot at the enemy.
        out.bonusShot = !forced;
      }
    } else {
      // shooting the opponent
      if (shell === "live") {
        if (targetVoodoo) {
          // REFLECTED by the target's voodoo
          out.reflected = true;
          out.damageTo = shooter;
        } else {
          out.damageTo = target;
        }
      }
      // blank at the opponent: no damage
    }

    if (out.damageTo) {
      st.hp[out.damageTo] = Math.max(0, st.hp[out.damageTo] - 1);
      if (st.hp[out.damageTo] <= 0) {
        out.death = out.damageTo;
      }
    }

    return out;
  }

  /* ---------------- turn flow ---------------- */

  /** End the current side's turn: tick voodoo down, pass to the opponent.
   *  Skips (cuffs) & cooldowns are processed when a turn STARTS. */
  endTurnAndPass(): Side {
    const st = this.state;
    // the active side's voodoo ticks down at the end of its own turn
    if (st.voodooTurns[st.turn] > 0) st.voodooTurns[st.turn] -= 1;
    st.mustShoot = false;
    st.usedRerollThisTurn = false;

    let next: Side = opponentOf(st.turn);
    // skips from cuffs
    if (next === "enemy" && st.enemySkipTurns > 0) {
      st.enemySkipTurns -= 1;
      next = "player";
    } else if (next === "player" && st.playerSkipTurns > 0) {
      st.playerSkipTurns -= 1;
      next = "enemy";
    }
    st.turn = next;
    return next;
  }

  /** Called when a new turn starts: tick the owner's skill cooldowns down. */
  startTurnTick() {
    const st = this.state;
    const sks = st.turn === "player" ? st.skills : st.enemySkills;
    for (const id of Object.keys(sks) as SkillId[]) {
      if (sks[id].cooldown > 0) sks[id].cooldown -= 1;
    }
  }

  setPhase(p: Phase) {
    this.state.phase = p;
  }
}

export const SKILL_POOL: SkillId[] = [
  "reroll",
  "voodoo",
  "peek",
  "eject",
  "coffee",
  "cuffs",
];

/* ---------------- AI ---------------- */

export interface AIDecision {
  kind: "skill" | "shoot";
  skill?: SkillId;
  target?: Side;
}

/** The enemy brain. `smart` 0..1 scales with difficulty. */
export class EnemyAI {
  constructor(private logic: RouletteLogic, public smart: number) {}

  /** One AI step: use 1 skill OR shoot. */
  decide(): AIDecision {
    const st = this.logic.state;
    const total = this.logic.totalRemaining;
    const live = this.logic.liveRemaining;
    const pLive = total > 0 ? live / total : 0;
    const known = this.logic.aiKnown;
    const sk = st.enemySkills;
    const hp = st.hp.enemy;
    const playerHp = st.hp.player;
    const playerVoodoo = st.voodooTurns.player > 0;
    const rng = Math.random();

    // 1. Coffee when dying
    if (sk.coffee.owned && sk.coffee.charges > 0 && hp <= 2 && this.logic.canUseSkill("enemy", "coffee")) {
      if (rng < 0.85) return { kind: "skill", skill: "coffee" };
    }

    // 2. Voodoo when cornered / many live shells
    if (
      sk.voodoo.owned &&
      sk.voodoo.charges > 0 &&
      st.voodooTurns.enemy === 0 &&
      (hp <= 2 || (pLive >= 0.5 && rng < 0.5)) &&
      this.logic.canUseSkill("enemy", "voodoo")
    ) {
      return { kind: "skill", skill: "voodoo" };
    }

    // 3. Peek when unsure (more eager while the player's voodoo is up)
    if (
      known === null &&
      sk.peek.owned &&
      sk.peek.cooldown === 0 &&
      total > 1 &&
      this.logic.canUseSkill("enemy", "peek") &&
      rng < (playerVoodoo ? 0.75 : 0.4) + this.smart * 0.5 &&
      (pLive > 0.25 && pLive < 0.85)
    ) {
      return { kind: "skill", skill: "peek" };
    }

    const pLiveEff = known !== null ? (known === "live" ? 1 : 0) : pLive;

    // 4. Eject a known live shell. While the player's voodoo is active,
    //    firing that shell anywhere = pain for the enemy, so eject it ASAP.
    if (
      known === "live" &&
      sk.eject.owned &&
      sk.eject.cooldown === 0 &&
      total > 1 &&
      this.logic.canUseSkill("enemy", "eject") &&
      rng < (playerVoodoo ? 0.95 : 0.35 + this.smart * 0.5)
    ) {
      return { kind: "skill", skill: "eject" };
    }

    // 5. Reroll: when the current shell is known to be bad for the plan
    if (
      sk.reroll.owned &&
      sk.reroll.cooldown === 0 &&
      !st.usedRerollThisTurn &&
      total > 1 &&
      this.logic.canUseSkill("enemy", "reroll") &&
      ((known === "blank" && rng < 0.4) || (pLiveEff >= 0.8 && playerVoodoo && rng < 0.5))
    ) {
      return { kind: "skill", skill: "reroll" };
    }

    // 6. Cuffs to hold down a strong player
    if (
      sk.cuffs.owned &&
      sk.cuffs.charges > 0 &&
      this.logic.canUseSkill("enemy", "cuffs") &&
      ((playerHp <= 2 && hp <= 2 && rng < 0.6) || (hp === 1 && rng < 0.8))
    ) {
      return { kind: "skill", skill: "cuffs" };
    }

    // 7. Shooting decision
    if (playerVoodoo && pLiveEff > 0) {
      // shooting the player = reflected pain; fish for a blank instead
      // (a self-blank still grants the free shot, and a live hurts only itself)
      if (known === "live" && total <= 1) return { kind: "shoot", target: "player" }; // forced, nothing better
      return { kind: "shoot", target: "enemy" }; // self-fish
    }
    if (pLiveEff >= 0.6) {
      return { kind: "shoot", target: "player" };
    }
    if (pLiveEff <= 0.34) {
      return { kind: "shoot", target: "enemy" }; // self-fish (blank -> free shot)
    }
    // grey zone: lean by smart
    if (rng < 0.35 + this.smart * 0.3) return { kind: "shoot", target: "player" };
    return { kind: "shoot", target: "enemy" };
  }
}
