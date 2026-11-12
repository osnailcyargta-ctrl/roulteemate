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
 * FOG OF WAR: the honest LIVE/BLANK board only stays up for 3 turns per
 * reload, then it fades — from then on BOTH sides run on real memory.
 * The enemy never reads the cylinder; it tracks what it has observed and
 * (on lower difficulties) misremembers from time to time.
 *
 * HP: EASY you 6 vs 5 · NORMAL 5 vs 5 · INSANE you 4 vs his 5.
 *
 * SKILLS (player starts with exactly 2 from the opening dice and can buy
 * 1-use SHOP TRIALS up to 4 held skills; the enemy owns 1 on EASY, 2 on
 * NORMAL and 3 on INSANE):
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
export type Mode = "standard" | "endless";

/** What the last fired shell did — the REWIND skill needs this to undo it. */
export interface LastShot {
  shell: ShellType;
  damageTo: Side | null;
  reflected: boolean;
  /** Cash the engine paid out for this shot (refunded by rewind). */
  moneyGain: number;
}

export interface SkillState {
  owned: boolean;
  charges: number; // for charge-based skills; -1 = cooldown-based
  cooldown: number; // turns left before usable again
  maxCharges: number;
  trial?: boolean; // shop trial: one single use, then the slot fades away
}

/** The PLAYER's inventory is a LIST OF SLOTS: every grant (dice, shop trial,
 *  duplicate) becomes its own slot with its own charges and its own cooldown.
 *  The DEALER keeps the simple per-id record. */
export interface SkillSlot {
  uid: number; // unique per grant — the HUD targets a slot by uid
  id: SkillId;
  charges: number;
  cooldown: number;
  maxCharges: number;
  trial?: boolean;
}

export type Phase =
  | "menu"
  | "dice"
  | "reloading"
  | "shop"
  | "playerTurn"
  | "enemyTurn"
  | "gameover"
  | "victory";

export interface GameState {
  phase: Phase;
  round: number;
  difficulty: Difficulty;
  mode: Mode; // endless: the DEALER never dies — his HP becomes a SCORE counter
  score: number; // ENDLESS: +1 every damage the DEALER takes, -1 when he heals (can go negative)
  maxHp: Record<Side, number>;
  hp: Record<Side, number>;
  cylinder: ShellType[]; // index 0 = next shell
  lastShot: LastShot | null; // the most recent trigger pull (for REWIND)
  turn: Side;
  skills: SkillSlot[]; // player — separate slots, each with own charges/cooldown
  enemySkills: Record<SkillId, SkillState>; // enemy
  voodooTurns: Record<Side, number>; // remaining voodoo duration (0 = off)
  enemySkipTurns: number;
  playerSkipTurns: number;
  mustShoot: boolean; // true after reroll
  usedRerollThisTurn: boolean;
  countdown: number; // turns left before the LIVE/BLANK board fades out
}

export interface ShotOutcome {
  shooter: Side;
  target: Side; // aim target
  shell: ShellType; // shell that came out
  damageTo: Side | null;
  reflected: boolean; // damage reflected by voodoo
  bonusShot: boolean; // self-shot blank -> shooter auto-fires once at the opponent
  voodooReroll: boolean; // self-shot blank while cursed -> fresh shell + forced shot
  phoenixSaved: boolean; // the phoenix charm burned instead of the player
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
  queue?: (ShellType | null)[]; // third eye: the next shells in order
  rewound?: LastShot | null; // rewind: the shot that was undone
  gambleWin?: boolean; // gamble: true = heads (+1 HP), false = tails (-1 HP)
  died?: boolean; // gamble tails at 1 HP — the coin killed its own flipper
}

const CHAMBER_SIZE = 6;

/** Charges a fresh (non-trial) slot starts with; -1 = cooldown-based skill. */
const SKILL_MAX_CHARGES: Record<SkillId, number> = {
  reroll: -1,
  voodoo: 1,
  peek: -1,
  eject: -1,
  coffee: 2,
  cuffs: 1,
  phoenix: 1,
  thirdEye: 1,
  rewind: 3,
  gamble: 3,
};

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
    phoenix: { owned: false, charges: 0, cooldown: 0, maxCharges: 1 },
    thirdEye: { owned: false, charges: 0, cooldown: 0, maxCharges: 1 },
    rewind: { owned: false, charges: 0, cooldown: 0, maxCharges: 3 },
    gamble: { owned: false, charges: 0, cooldown: 0, maxCharges: 3 },
  };
}

export const SKILL_CD: Record<SkillId, number> = {
  reroll: 2,
  voodoo: 0,
  peek: 3,
  eject: 3,
  coffee: 0,
  cuffs: 0,
  phoenix: 0,
  thirdEye: 0,
  rewind: 2,
  gamble: 2,
};

/** How many skills the ENEMY gets per difficulty. */
export function enemySkillCount(diff: Difficulty): number {
  return diff === "easy" ? 1 : diff === "normal" ? 2 : 3;
}

export interface LogicOverrides {
  /** MUTATORS: custom HP for both sides. */
  hpPlayer?: number;
  hpEnemy?: number;
}

export class RouletteLogic {
  state: GameState;
  /** AI-only knowledge of the current shell (from its own peek). */
  aiKnown: ShellType | null = null;
  /** Player knowledge of the current shell (peek / third eye slot 0). */
  playerKnown: ShellType | null = null;
  /** Ordered knowledge of the NEXT shells (third eye). null = unknown slot. */
  playerKnownQueue: (ShellType | null)[] = [];
  /** The enemy's REAL memory of the remaining shells — it never cheats. */
  aiMem: { live: number; total: number } = { live: 0, total: 0 };
  /** True when the enemy misremembered at the start of its turn. */
  lastSlip = false;

  constructor(
    difficulty: Difficulty = "normal",
    mode: Mode = "standard",
    overrides: LogicOverrides = {},
  ) {
    this.state = this.freshState(difficulty, mode, overrides);
  }

  /** uid counter for player skill slots. */
  private nextUid = 1;

  freshState(difficulty: Difficulty, mode: Mode = "standard", overrides: LogicOverrides = {}): GameState {
    // The DEALER always sits at 5 HP in standard play (ENDLESS replaces it
    // with the SCORE counter) — mutators may override both sides.
    const base: Record<Side, number> =
      difficulty === "easy"
        ? { player: 6, enemy: 5 }
        : difficulty === "normal"
          ? { player: 5, enemy: 5 }
          : mode === "endless"
            ? { player: 5, enemy: 5 } // ENDLESS: you need staying power
            : { player: 4, enemy: 5 }; // INSANE: fewer hearts, same dealer
    const maxHp: Record<Side, number> = {
      player: overrides.hpPlayer ?? base.player,
      enemy: overrides.hpEnemy ?? base.enemy,
    };
    return {
      phase: "dice",
      round: 0,
      difficulty,
      mode,
      score: 0,
      maxHp,
      hp: { player: maxHp.player, enemy: maxHp.enemy },
      cylinder: [],
      lastShot: null,
      turn: "player",
      skills: [],
      enemySkills: emptySkills(),
      voodooTurns: { player: 0, enemy: 0 },
      enemySkipTurns: 0,
      playerSkipTurns: 0,
      mustShoot: false,
      usedRerollThisTurn: false,
      countdown: 0,
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
    this.playerKnownQueue = [];
    this.state.countdown = 4; // the honest board survives the first 3 turns
    this.state.lastShot = null; // a fresh magazine erases history (no rewind across reloads)
    this.aiMem = { live: liveCount, total: shells.length };
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

  /* ---------------- skill grants (dice / shop) ---------------- */

  /** Resolve a player slot: by uid, or (legacy id lookups) the LAST slot
   *  with that skill id. */
  playerSlot(ref: SkillId | number): SkillSlot | null {
    const list = this.state.skills;
    if (typeof ref === "number") return list.find((s) => s.uid === ref) ?? null;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].id === ref) return list[i];
    return null;
  }

  /** DICE grant. The PLAYER always receives a NEW SLOT (duplicates included
   *  when the mutator allows them) — separate cooldown, separate charges.
   *  The DEALER keeps the simple stacking behavior. */
  grantSkill(side: Side, id: SkillId) {
    if (side === "player") {
      const max = SKILL_MAX_CHARGES[id];
      this.state.skills.push({
        uid: this.nextUid++,
        id,
        charges: max,
        cooldown: 0,
        maxCharges: max,
      });
      return;
    }
    const sk = this.state.enemySkills[id];
    sk.owned = true;
    if (sk.charges >= 0) {
      sk.charges = Math.min(sk.maxCharges, sk.charges + 1);
    } else {
      sk.cooldown = 0;
    }
  }

  /** SHOP purchase: a TRIAL skill — one single use, then its slot fades. */
  grantTrial(side: Side, id: SkillId) {
    if (side === "player") {
      this.state.skills.push({
        uid: this.nextUid++,
        id,
        charges: 1,
        cooldown: 0,
        maxCharges: 1,
        trial: true,
      });
      return;
    }
    const sk = this.state.enemySkills[id];
    sk.owned = true;
    sk.trial = true;
    sk.maxCharges = 1;
    sk.charges = 1;
    sk.cooldown = 0;
  }

  /* ---------------- fog of war (real memory) ---------------- */

  get countsPublic() {
    return this.state.countdown > 0 && this.state.cylinder.length > 0;
  }

  private clampMem(v: number) {
    return Math.min(Math.max(0, v), Math.max(0, this.aiMem.total));
  }

  /** A shell left the cylinder in full view (fired or ejected). */
  observeShell(kind: ShellType) {
    if (this.countsPublic) {
      this.resyncMem();
      return;
    }
    this.aiMem.total = Math.max(0, this.aiMem.total - 1);
    this.aiMem.live =
      kind === "live"
        ? Math.max(0, this.aiMem.live - 1)
        : Math.min(this.aiMem.live, this.aiMem.total); // a blank proves past beliefs too generous
  }

  /** While the board is public both sides track it perfectly. */
  resyncMem() {
    this.aiMem = { live: this.liveRemaining, total: this.totalRemaining };
  }

  /** An unknown fresh shell entered the chamber (voodoo curse reroll). */
  noteFreshShell() {
    if (this.countsPublic) {
      this.resyncMem();
      return;
    }
    this.aiMem.total += 1;
    this.aiMem.live = this.clampMem(this.aiMem.live + 0.5);
  }

  /** The chamber was rerolled: the old shell leaves, a fresh 50/50 enters. */
  noteReroll(oldKnown: ShellType | null) {
    if (this.countsPublic) {
      this.resyncMem();
      return;
    }
    const oldP =
      oldKnown === "live" ? 1 : oldKnown === "blank" ? 0 : this.aiMem.total > 0 ? this.aiMem.live / this.aiMem.total : 0.5;
    this.aiMem.live = this.clampMem(this.aiMem.live - oldP + 0.5);
  }

  /* ---------------- endless scoring ---------------- */

  /** ENDLESS: the DEALER's HP is replaced by a SCORE counter.
   *  Every damage he takes = +1 score, every heal = -1 score.
   *  The score may go negative — nobody is stopping you from bullying him. */
  addScore(delta: number) {
    this.state.score += delta;
  }

  /** Apply damage to a side. In ENDLESS, hurting the DEALER feeds the
   *  score instead of his HP — he simply cannot die. */
  damageSide(side: Side, amount: number): boolean {
    const st = this.state;
    if (amount <= 0) return false;
    if (side === "enemy" && st.mode === "endless") {
      st.score += amount; // +1 score per point of damage (can pierce zero, go negative)
      return false; // never a death
    }
    st.hp[side] = Math.max(0, st.hp[side] - amount);
    return st.hp[side] <= 0;
  }

  /** Heal a side. In ENDLESS, a healing DEALER LOSES score (may go negative). */
  healSide(side: Side, amount: number): boolean {
    const st = this.state;
    if (amount <= 0) return false;
    if (side === "enemy" && st.mode === "endless") {
      st.score -= amount;
      return false;
    }
    const before = st.hp[side];
    st.hp[side] = Math.min(st.maxHp[side], st.hp[side] + amount);
    return st.hp[side] > before; // true when the heal actually did something
  }

  /* ---------------- skills ---------------- */

  canUseSkill(side: Side, ref: SkillId | number): boolean {
    const st = this.state;
    if (side === "player") {
      const slot = this.playerSlot(ref);
      if (!slot) return false;
      return this.slotUsable(slot);
    }
    const id = ref as SkillId;
    const sk = st.enemySkills[id];
    if (!sk.owned) return false;
    if (sk.cooldown > 0) return false;
    if (sk.charges === 0) return false;
    if (id === "phoenix") return false; // passive charm — it triggers itself
    if (st.phase !== "playerTurn" && st.phase !== "enemyTurn") return false;
    if (side !== st.turn) return false;
    if (id === "coffee" && st.hp[side] >= st.maxHp[side]) return false;
    if (id === "cuffs" && st.playerSkipTurns > 0) return false;
    if (id === "voodoo" && st.voodooTurns[side] > 0) return false;
    if (id === "eject" && st.cylinder.length === 0) return false;
    if (id === "reroll" && (st.usedRerollThisTurn || st.cylinder.length === 0)) return false;
    if (id === "rewind" && !st.lastShot) return false; // nothing to undo
    if (id === "gamble" && st.hp[side] <= 0) return false;
    return true;
  }

  /** All shared usability rules for one of the player's slots. */
  private slotUsable(slot: SkillSlot): boolean {
    const st = this.state;
    const id = slot.id;
    if (slot.cooldown > 0) return false;
    if (slot.charges === 0) return false;
    if (id === "phoenix") return false; // passive charm — it triggers itself
    if (st.mustShoot && id !== "coffee") return false;
    if (st.phase !== "playerTurn" && st.phase !== "enemyTurn") return false;
    if (st.turn !== "player") return false;
    if (id === "coffee" && st.hp.player >= st.maxHp.player) return false;
    if (id === "cuffs" && st.enemySkipTurns > 0) return false;
    if (id === "voodoo" && st.voodooTurns.player > 0) return false;
    if (id === "eject" && st.cylinder.length === 0) return false;
    if (id === "reroll" && (st.usedRerollThisTurn || st.cylinder.length === 0)) return false;
    if (id === "rewind" && !st.lastShot) return false; // nothing to undo
    if (id === "gamble" && st.hp.player <= 0) return false;
    return true;
  }

  useSkill(side: Side, ref: SkillId | number, preset: { win?: boolean } = {}): SkillOutcome {
    if (!this.canUseSkill(side, ref)) return { ok: false, reason: "not usable" };
    const st = this.state;
    let id: SkillId;
    let sk: SkillSlot | SkillState;
    if (side === "player") {
      const slot = this.playerSlot(ref)!;
      id = slot.id;
      sk = slot;
    } else {
      id = ref as SkillId;
      sk = st.enemySkills[id];
    }
    // TRIAL skills burn their single charge on any successful use
    if (sk.trial && sk.charges > 0) sk.charges -= 1;
    switch (id) {
      case "reroll": {
        // pure reroll: random result, may repeat itself
        this.noteReroll(this.aiKnown);
        const next: ShellType = Math.random() < 0.5 ? "live" : "blank";
        st.cylinder[0] = next;
        sk.cooldown = SKILL_CD.reroll;
        st.mustShoot = true;
        st.usedRerollThisTurn = true;
        this.playerKnownQueue = this.playerKnownQueue.length
          ? [null, ...this.playerKnownQueue.slice(1)]
          : [];
        this.playerKnown = this.playerKnownQueue[0] ?? null;
        this.aiKnown = null;
        return { ok: true, rerolled: true };
      }
      case "peek": {
        const cur = st.cylinder[0] ?? null;
        sk.cooldown = SKILL_CD.peek;
        if (side === "player") {
          if (this.playerKnownQueue.length) this.playerKnownQueue[0] = cur;
          else this.playerKnownQueue = [cur];
          this.playerKnown = cur;
        } else {
          this.aiKnown = cur;
        }
        return { ok: true, revealed: cur };
      }
      case "thirdEye": {
        // reveal the NEXT 3 shells in order; knowledge persists as they fire
        const q: (ShellType | null)[] = [];
        for (let i = 0; i < 3 && i < st.cylinder.length; i++) q.push(st.cylinder[i]);
        this.playerKnownQueue = q;
        this.playerKnown = q[0] ?? null;
        return { ok: true, revealed: q[0] ?? null, queue: q };
      }
      case "phoenix": {
        // passive charm — it can never be cast manually (canUseSkill blocks it)
        return { ok: false, reason: "passive" };
      }
      case "eject": {
        const cur = st.cylinder.shift() ?? null;
        sk.cooldown = SKILL_CD.eject;
        this.observeShell(cur ?? "blank"); // the ejected shell is shown to both
        this.playerKnownQueue = this.playerKnownQueue.slice(1);
        this.playerKnown = this.playerKnownQueue[0] ?? null;
        this.aiKnown = null;
        return { ok: true, ejected: cur };
      }
      case "coffee": {
        this.healSide(side, 1);
        if (!sk.trial) sk.charges -= 1;
        return { ok: true, healed: true };
      }
      case "cuffs": {
        if (!sk.trial) sk.charges -= 1;
        if (side === "player") st.enemySkipTurns += 1;
        else st.playerSkipTurns += 1;
        return { ok: true, cuffsApplied: true };
      }
      case "voodoo": {
        if (!sk.trial) sk.charges -= 1;
        st.voodooTurns[side] = 2;
        return { ok: true };
      }
      case "rewind": {
        // TIME FLOWS BACKWARDS: the last fired shell returns to the chamber
        // and its whole result is undone — HP damage healed, cash refunded,
        // the chamber exactly as it was before the trigger was pulled.
        const last = st.lastShot;
        if (!last) return { ok: false, reason: "nothing to rewind" };
        st.cylinder.unshift(last.shell);
        if (last.damageTo) {
          if (last.damageTo === "enemy" && st.mode === "endless") {
            st.score -= 1; // even the score forgets it happened
          } else {
            st.hp[last.damageTo] = Math.min(st.maxHp[last.damageTo], st.hp[last.damageTo] + 1);
          }
        }
        // the AI's memory gets its shell back too
        this.aiMem.total += 1;
        if (last.shell === "live") this.aiMem.live = Math.min(this.aiMem.live + 1, this.aiMem.total);
        else this.aiMem.live = this.clampMem(this.aiMem.live);
        // the player SAW that shell fire — the knowledge walks back in
        this.playerKnownQueue = [last.shell, ...this.playerKnownQueue];
        this.playerKnown = last.shell;
        this.aiKnown = null;
        st.lastShot = null;
        sk.cooldown = SKILL_CD.rewind;
        if (!sk.trial) sk.charges -= 1;
        return { ok: true, rewound: last };
      }
      case "gamble": {
        // THE COIN: heads +1 HP, tails -1 HP. It can absolutely kill you.
        // The engine may PRE-ROLL the flip so the 3D coin lands honestly.
        if (!sk.trial) sk.charges -= 1;
        sk.cooldown = SKILL_CD.gamble;
        const win = preset.win ?? Math.random() < 0.5;
        let died = false;
        if (win) {
          this.healSide(side, 1);
        } else {
          died = this.damageSide(side, 1);
        }
        return { ok: true, gambleWin: win, died: died || st.hp[side] <= 0 };
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
    this.observeShell(shell); // the shell leaving the gun is public knowledge
    this.playerKnownQueue = this.playerKnownQueue.slice(1);
    this.playerKnown = this.playerKnownQueue[0] ?? null;
    this.aiKnown = null;

    const out: ShotOutcome = {
      shooter,
      target,
      shell,
      damageTo: null,
      reflected: false,
      bonusShot: false,
      voodooReroll: false,
      phoenixSaved: false,
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
          this.noteFreshShell();
          this.playerKnownQueue = [null, ...this.playerKnownQueue];
          this.playerKnown = null;
          out.voodooReroll = true;
          st.lastShot = null; // a cursed shot tears the timeline — no rewind
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
      // PHOENIX charm: the blow that would kill the player burns the charm
      // instead and leaves them standing at 1 HP.
      const phoenixSlot = st.skills.find((s) => s.id === "phoenix" && s.charges > 0);
      if (
        out.damageTo === "player" &&
        st.hp.player - 1 <= 0 &&
        phoenixSlot
      ) {
        phoenixSlot.charges -= 1;
        st.hp.player = 1;
        out.phoenixSaved = true;
      } else {
        const dead = this.damageSide(out.damageTo, 1);
        // ENDLESS: hurting the DEALER only feeds the score — nobody dies
        if (dead) out.death = out.damageTo;
      }
    }

    // remember this trigger pull so REWIND can walk it backwards
    st.lastShot = {
      shell: out.shell,
      damageTo: out.damageTo,
      reflected: out.reflected,
      moneyGain: 0, // the engine fills in the cash payout it gave
    };

    return out;
  }

  /* ---------------- turn flow ---------------- */

  /** Script/mutator FORCED skill effect: applies the effect with no
   *  turn/cooldown checks (the custom rules are above the law). */
  forceSkill(id: SkillId, target: Side, preset: { win?: boolean } = {}): { win?: boolean; died?: boolean; revealed?: ShellType | null } {
    const st = this.state;
    const skTarget = target === "player" ? st.skills.find((s) => s.id === id) : st.enemySkills[id];
    switch (id) {
      case "cuffs":
        if (target === "player") st.playerSkipTurns += 1;
        else st.enemySkipTurns += 1;
        return {};
      case "coffee":
        this.healSide(target, 1);
        return {};
      case "reroll": {
        const next: ShellType = Math.random() < 0.5 ? "live" : "blank";
        if (st.cylinder.length) st.cylinder[0] = next;
        this.playerKnownQueue = this.playerKnownQueue.length ? [null, ...this.playerKnownQueue.slice(1)] : [];
        this.playerKnown = this.playerKnownQueue[0] ?? null;
        this.aiKnown = null;
        return {};
      }
      case "peek": {
        const cur = st.cylinder[0] ?? null;
        if (target === "player") {
          if (this.playerKnownQueue.length) this.playerKnownQueue[0] = cur;
          else this.playerKnownQueue = [cur];
          this.playerKnown = cur;
        } else {
          this.aiKnown = cur;
        }
        return { revealed: cur };
      }
      case "thirdEye": {
        const q: (ShellType | null)[] = [];
        for (let i = 0; i < 3 && i < st.cylinder.length; i++) q.push(st.cylinder[i]);
        if (target === "player") {
          this.playerKnownQueue = q;
          this.playerKnown = q[0] ?? null;
        }
        return { revealed: q[0] ?? null };
      }
      case "eject": {
        const cur = st.cylinder.shift() ?? null;
        this.observeShell(cur ?? "blank");
        this.playerKnownQueue = this.playerKnownQueue.slice(1);
        this.playerKnown = this.playerKnownQueue[0] ?? null;
        this.aiKnown = null;
        return { revealed: cur };
      }
      case "voodoo":
        st.voodooTurns[target] = 2;
        return {};
      case "phoenix": {
        if (target === "player") {
          const slot = st.skills.find((s) => s.id === "phoenix");
          if (slot) slot.charges = Math.max(1, slot.charges);
          else this.grantSkill("player", "phoenix");
        } else {
          const sk = st.enemySkills.phoenix;
          sk.owned = true;
          sk.charges = Math.max(1, sk.charges);
        }
        return {};
      }
      case "rewind": {
        const last = st.lastShot;
        if (!last) return {};
        st.cylinder.unshift(last.shell);
        if (last.damageTo) {
          if (last.damageTo === "enemy" && st.mode === "endless") st.score -= 1;
          else st.hp[last.damageTo] = Math.min(st.maxHp[last.damageTo], st.hp[last.damageTo] + 1);
        }
        this.aiMem.total += 1;
        if (last.shell === "live") this.aiMem.live = Math.min(this.aiMem.live + 1, this.aiMem.total);
        st.lastShot = null;
        return {};
      }
      case "gamble": {
        const win = preset.win ?? Math.random() < 0.5;
        let died = false;
        if (win) this.healSide(target, 1);
        else died = this.damageSide(target, 1);
        return { win, died: died || st.hp[target] <= 0 };
      }
      default:
        return {};
    }
  }

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

  /** Called when a new turn starts: tick the owner's skill cooldowns down,
   *  tick the fog-of-war countdown, and maybe make the enemy misremember. */
  startTurnTick() {
    const st = this.state;
    // player slots tick individually — each duplicate cools down on its own
    for (const slot of st.skills) {
      if (slot.cooldown > 0) slot.cooldown -= 1;
    }
    const esks = st.enemySkills;
    for (const id of Object.keys(esks) as SkillId[]) {
      if (esks[id].cooldown > 0) esks[id].cooldown -= 1;
    }
    if (st.countdown > 0) st.countdown -= 1;
    this.lastSlip = false;
    // FOG OF WAR: once the board has faded, the enemy runs on real memory —
    // and on lower difficulties it sometimes loses count.
    if (st.turn === "enemy" && st.countdown <= 0 && st.cylinder.length > 0) {
      const slip = st.difficulty === "easy" ? 0.25 : st.difficulty === "normal" ? 0.08 : 0;
      if (Math.random() < slip) {
        const dir = Math.random() < 0.5 ? -1 : 1;
        this.aiMem.live = Math.min(Math.max(0, this.aiMem.live + dir), Math.max(0, this.aiMem.total));
        this.lastSlip = true;
      }
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
  "phoenix",
  "thirdEye",
];

/* ---------------- AI ---------------- */

export interface AIDecision {
  kind: "skill" | "shoot";
  skill?: SkillId;
  target?: Side;
}

/** The enemy brain. `smart` 0..1 scales with difficulty.
 *  NORMAL (0.8) and INSANE (0.95) genuinely play their skills and reason
 *  about the odds; EASY (0.55) is sloppy and forgetful. */
export class EnemyAI {
  constructor(private logic: RouletteLogic, public smart: number) {}

  /** Probability the current shell is live, from the AI's REAL memory only. */
  private pLiveBelief(): number {
    const mem = this.logic.aiMem;
    return mem.total > 0 ? Math.min(1, Math.max(0, mem.live / mem.total)) : 0;
  }

  /** One AI step: use 1 skill OR shoot. */
  decide(): AIDecision {
    const st = this.logic.state;
    const sk = st.enemySkills;
    const hp = st.hp.enemy;
    const playerHp = st.hp.player;
    const known = this.logic.aiKnown;
    const total = this.logic.aiMem.total;
    const ownVoodoo = st.voodooTurns.enemy > 0;
    const playerVoodoo = st.voodooTurns.player > 0;
    const rng = Math.random();
    const smart = this.smart;
    const eager = smart >= 0.75; // NORMAL & INSANE actually play their cards

    // While its OWN voodoo is up, shooting yourself is pure profit:
    // a live shell reflects into the player, a blank pays a free shot.
    if (ownVoodoo && total > 0) return { kind: "shoot", target: "enemy" };

    // 1. Coffee when dying
    if (sk.coffee.owned && sk.coffee.charges > 0 && hp <= 2 && rng < 0.6 + smart * 0.4 && this.logic.canUseSkill("enemy", "coffee")) {
      return { kind: "skill", skill: "coffee" };
    }

    // 2. Voodoo — cast it EARLY, before the violence starts: while cursed the
    //    enemy can self-fish risk-free and every hit on it crawls back.
    if (
      sk.voodoo.owned &&
      sk.voodoo.charges > 0 &&
      st.voodooTurns.enemy === 0 &&
      (hp <= 2 || (total >= 2 && playerHp >= 2 && rng < 0.25 + smart * 0.45)) &&
      this.logic.canUseSkill("enemy", "voodoo")
    ) {
      return { kind: "skill", skill: "voodoo" };
    }

    // 3. Peek when unsure — the eager brain inspects almost every chance it gets.
    if (
      known === null &&
      sk.peek.owned &&
      sk.peek.cooldown === 0 &&
      total >= 2 &&
      this.logic.canUseSkill("enemy", "peek") &&
      rng < (eager ? 0.92 : 0.35) &&
      ((this.pLiveBelief() > 0.15 && this.pLiveBelief() < 0.92) || playerVoodoo)
    ) {
      return { kind: "skill", skill: "peek" };
    }

    // 4. A known live shell is only a liability when firing it feeds the
    //    player's curse: eject it (an empty cylinder forces a fresh reload).
    if (
      known === "live" &&
      playerVoodoo &&
      !ownVoodoo &&
      sk.eject.owned &&
      sk.eject.cooldown === 0 &&
      this.logic.canUseSkill("enemy", "eject") &&
      rng < 0.55 + smart * 0.45
    ) {
      return { kind: "skill", skill: "eject" };
    }

    // 5. Reroll a known BLANK when the magazine is live-heavy — spin for blood.
    if (
      known === "blank" &&
      sk.reroll.owned &&
      sk.reroll.cooldown === 0 &&
      !st.usedRerollThisTurn &&
      total >= 2 &&
      this.pLiveBelief() >= 0.4 &&
      this.logic.canUseSkill("enemy", "reroll") &&
      rng < 0.25 + smart * 0.55
    ) {
      return { kind: "skill", skill: "reroll" };
    }

    // 5b. Same when the shell is live but the player's curse blocks firing it
    //     and no eject is available.
    if (
      known === "live" &&
      playerVoodoo &&
      !ownVoodoo &&
      !sk.eject.owned &&
      sk.reroll.owned &&
      sk.reroll.cooldown === 0 &&
      !st.usedRerollThisTurn &&
      this.logic.canUseSkill("enemy", "reroll") &&
      rng < 0.5 + smart * 0.5
    ) {
      return { kind: "skill", skill: "reroll" };
    }

    // 6. Cuffs to hold down a strong player
    if (
      sk.cuffs.owned &&
      sk.cuffs.charges > 0 &&
      this.logic.canUseSkill("enemy", "cuffs") &&
      ((playerHp <= 2 && rng < 0.5 + smart * 0.4) ||
        (hp === 1 && rng < 0.85) ||
        (eager && playerHp <= 3 && hp <= 3 && this.pLiveBelief() >= 0.5 && rng < 0.3))
    ) {
      return { kind: "skill", skill: "cuffs" };
    }

    // 7. Shooting decision
    const pRaw = known !== null ? (known === "live" ? 1 : 0) : this.pLiveBelief();
    // the weaker brain misjudges the odds more
    const p = Math.min(1, Math.max(0, pRaw + (Math.random() - 0.5) * 2 * (1 - smart) * 0.25));

    if (known === "live") {
      // the player's curse makes any shot at them self-harm — bite the bullet
      return { kind: "shoot", target: playerVoodoo && !ownVoodoo ? "enemy" : "player" };
    }
    if (known === "blank") {
      // self-shot blank = one free shot at the player (when shells remain)
      return total >= 2 ? { kind: "shoot", target: "enemy" } : { kind: "shoot", target: "player" };
    }

    // unknown shell: a healthy Dealer gambles on the free-shot fish; a hurt
    // one plays it straight. hp >= 4 relative to the player's = brave.
    const brave = hp - playerHp >= 1 || hp >= 4;
    if (p >= 0.5) return { kind: "shoot", target: "player" };
    if (p <= (brave ? 0.45 : 0.3) && total >= 2 && hp >= 2) return { kind: "shoot", target: "enemy" };
    return { kind: "shoot", target: "player" };
  }
}
