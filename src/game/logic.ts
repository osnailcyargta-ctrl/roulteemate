/**
 * logic.ts — aturan inti ULTIMATE ROULETTE (pure logic, tanpa render).
 *
 * Konsep: revolver 6-chamber diisi shell LIVE/BLANK. Jumlah masing-masing
 * diketahui kedua pihak, urutannya acak. Setiap tembakan menggeser chamber.
 * - Nembak diri sendiri + BLANK  -> giliran lanjut (gratis).
 * - Nembak diri sendiri + LIVE   -> kena damage, giliran pindah.
 * - Nembak musuh + LIVE          -> musuh kena damage, giliran pindah.
 * - Nembak musuh + BLANK         -> giliran pindah.
 *
 * SKILL:
 * - REROLL   : acak ulang shell di chamber sekali, lalu WAJIB nembak. CD 2 giliran.
 * - VOODOO   : 1x per game, aktif 2 giliran. Tembakan LIVE musuh ke kamu
 *              DIPANTULKAN ke musuh. Nembak diri sendiri saat aktif:
 *              BLANK -> shell di-reroll & wajib nembak diri 1x lagi;
 *              hasil reroll LIVE -> voodoo batal & kamu kena;
 *              LIVE langsung -> voodoo batal & kamu kena.
 * - INTUISI  : lihat isi chamber sekarang. CD 3 giliran.
 * - BUANG    : eject shell sekarang tanpa nembak (gratis). CD 3 giliran.
 * - KOPI     : +1 HP (maks 4). 2 charge per game.
 * - BORGOL   : musuh skip giliran berikutnya. 1 charge per game.
 */

import type { SkillId } from "./doodle";

export type ShellType = "live" | "blank";
export type Side = "player" | "enemy";
export type Difficulty = "gampang" | "normal" | "gila";

export interface SkillState {
  owned: boolean;
  charges: number; // untuk skill berbasis charge; -1 = berbasis cooldown
  cooldown: number; // sisa giliran sebelum bisa dipakai lagi
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
  cylinder: ShellType[]; // index 0 = shell berikutnya
  turn: Side;
  skills: Record<SkillId, SkillState>; // pemain
  enemySkills: Record<SkillId, SkillState>; // musuh
  voodooTurns: Record<Side, number>; // sisa durasi voodoo (0 = off)
  enemySkipTurns: number;
  playerSkipTurns: number;
  mustShoot: boolean; // true setelah reroll
  usedRerollThisTurn: boolean;
}

export interface ShotOutcome {
  shooter: Side;
  target: Side; // sasaran bidikan
  shell: ShellType; // shell yang keluar
  damageTo: Side | null;
  reflected: boolean; // damage dipantulkan voodoo
  shooterContinues: boolean; // self-shot blank -> tetap giliran dia
  voodooReroll: boolean; // self-shot blank saat voodoo -> fate diacak, wajib nembak lagi
  voodooCancelled: boolean;
  death: Side | null;
  forcedSelfShot: boolean; // tembakan ini dipaksa (dari reroll voodoo)
}

export interface SkillOutcome {
  ok: boolean;
  reason?: string;
  revealed?: ShellType | null; // intuisi / buang
  healed?: boolean;
  rerolled?: boolean;
  cuffsApplied?: boolean;
  ejected?: ShellType | null;
}

const CHAMBER_SIZE = 6;

function emptySkills(): Record<SkillId, SkillState> {
  return {
    reroll: { owned: false, charges: -1, cooldown: 0, maxCharges: -1 },
    voodoo: { owned: false, charges: 0, cooldown: 0, maxCharges: 2 },
    intuisi: { owned: false, charges: -1, cooldown: 0, maxCharges: -1 },
    buang: { owned: false, charges: -1, cooldown: 0, maxCharges: -1 },
    kopi: { owned: false, charges: 0, cooldown: 0, maxCharges: 2 },
    borgol: { owned: false, charges: 0, cooldown: 0, maxCharges: 2 },
  };
}

export const SKILL_CD: Record<SkillId, number> = {
  reroll: 2,
  voodoo: 0,
  intuisi: 3,
  buang: 3,
  kopi: 0,
  borgol: 0,
};

export class RouletteLogic {
  state: GameState;
  /** pengetahuan khusus AI tentang shell saat ini (dari intuisi-nya) */
  aiKnown: ShellType | null = null;
  /** pengetahuan pemain tentang shell saat ini (dari intuisi-nya) */
  playerKnown: ShellType | null = null;

  constructor(difficulty: Difficulty = "normal") {
    this.state = this.freshState(difficulty);
  }

  freshState(difficulty: Difficulty): GameState {
    const maxHp = difficulty === "gampang" ? 5 : 4;
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

  /* ---------------- skill grants (dadu) ---------------- */

  /** Dadu memberi skill. Kalau sudah dimiliki: charge-skills +1 charge
   *  (sampai cap), cooldown-skills direset cooldownnya. */
  grantRandomSkill(side: Side): SkillId {
    const pool = SKILL_POOL.filter(() => true);
    const id = pool[Math.floor(Math.random() * pool.length)];
    this.grantSkill(side, id);
    return id;
  }

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
    if (side === "player" && st.mustShoot && id !== "kopi") return false;
    if (st.phase !== "playerTurn" && st.phase !== "enemyTurn") return false;
    if (side !== st.turn) return false;
    if (id === "kopi" && st.hp[side] >= st.maxHp) return false;
    if (id === "borgol" && (side === "player" ? st.enemySkipTurns : st.playerSkipTurns) > 0)
      return false;
    if (id === "voodoo" && st.voodooTurns[side] > 0) return false;
    if (id === "buang" && st.cylinder.length === 0) return false;
    if (id === "reroll" && (st.usedRerollThisTurn || st.cylinder.length === 0)) return false;
    return true;
  }

  useSkill(side: Side, id: SkillId): SkillOutcome {
    if (!this.canUseSkill(side, id)) return { ok: false, reason: "tidak bisa dipakai" };
    const st = this.state;
    const sk = side === "player" ? st.skills[id] : st.enemySkills[id];
    switch (id) {
      case "reroll": {
        // reroll murni: hasil acak, bisa saja sama (nama skill nya aja reroll)
        const next: ShellType = Math.random() < 0.5 ? "live" : "blank";
        st.cylinder[0] = next;
        sk.cooldown = SKILL_CD.reroll;
        st.mustShoot = true;
        st.usedRerollThisTurn = true;
        this.playerKnown = null;
        this.aiKnown = null;
        return { ok: true, rerolled: true };
      }
      case "intuisi": {
        const cur = st.cylinder[0] ?? null;
        sk.cooldown = SKILL_CD.intuisi;
        if (side === "player") this.playerKnown = cur;
        else this.aiKnown = cur;
        return { ok: true, revealed: cur };
      }
      case "buang": {
        const cur = st.cylinder.shift() ?? null;
        sk.cooldown = SKILL_CD.buang;
        this.playerKnown = null;
        this.aiKnown = null;
        return { ok: true, ejected: cur };
      }
      case "kopi": {
        st.hp[side] = Math.min(st.maxHp, st.hp[side] + 1);
        sk.charges -= 1;
        return { ok: true, healed: true };
      }
      case "borgol": {
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

  /** Resolusi SATU tembakan. `forced` = tembakan paksa hasil reroll voodoo. */
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
      shooterContinues: false,
      voodooReroll: false,
      voodooCancelled: false,
      death: null,
      forcedSelfShot: forced,
    };

    const shooterVoodoo = st.voodooTurns[shooter] > 0;
    const targetIsSelf = target === shooter;
    const targetVoodoo = st.voodooTurns[target] > 0;

    if (targetIsSelf) {
      if (shell === "live") {
        // live ke diri sendiri
        if (shooterVoodoo && !forced) {
          // voodoo batal, damage tetap ditanggung penembak
          st.voodooTurns[shooter] = 0;
          out.voodooCancelled = true;
        }
        out.damageTo = shooter;
      } else {
        // blank ke diri sendiri
        if (shooterVoodoo && !forced) {
          // KUTUKAN VOODOO: blank di-reroll, wajib nembak diri lagi.
          // shell blank sudah terbuang (shift). masukkan shell acak baru.
          const fresh: ShellType = Math.random() < 0.5 ? "live" : "blank";
          st.cylinder.unshift(fresh);
          out.voodooReroll = true;
          out.shooterContinues = true; // tetap gilirannya untuk tembakan paksa
          return out;
        }
        out.shooterContinues = true;
      }
    } else {
      // menembak lawan
      if (shell === "live") {
        if (targetVoodoo) {
          // DIPANTULKAN oleh voodoo target
          out.reflected = true;
          out.damageTo = shooter;
        } else {
          out.damageTo = target;
        }
      }
      // blank ke lawan: tidak ada damage
    }

    // hasil reroll voodoo yang live: voodoo batal & penembak tanggung sendiri
    if (forced && shooterVoodoo && targetIsSelf && shell === "live") {
      st.voodooTurns[shooter] = 0;
      out.voodooCancelled = true;
    }

    if (out.damageTo) {
      st.hp[out.damageTo] = Math.max(0, st.hp[out.damageTo] - 1);
      if (st.hp[out.damageTo] <= 0) {
        out.death = out.damageTo;
      }
    }

    // giliran lanjut atau pindah ditentukan engine via shouldKeepTurn()
    return out;
  }

  /** Apakah penembak boleh lanjut menembak (self-shot blank, tanpa reroll voodoo). */
  shouldKeepTurn(out: ShotOutcome): boolean {
    if (out.death) return false;
    if (out.voodooReroll) return true; // wajib tembakan paksa
    return out.target === out.shooter && out.shell === "blank" && !out.damageTo;
  }

  /* ---------------- alur giliran ---------------- */

  /** Akhiri giliran side saat ini: voodoo berkurang, pindah ke lawan,
   *  proses skip (borgol) & cooldown dipanggil saat MULAI giliran. */
  endTurnAndPass(): Side {
    const st = this.state;
    // voodoo side aktif menurun 1 di akhir gilirannya sendiri
    if (st.voodooTurns[st.turn] > 0) st.voodooTurns[st.turn] -= 1;
    st.mustShoot = false;
    st.usedRerollThisTurn = false;

    let next: Side = st.turn === "player" ? "enemy" : "player";
    // skip oleh borgol
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

  /** Dipanggil saat giliran baru dimulai: turunkan cooldown skill pemilik giliran. */
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
  "intuisi",
  "buang",
  "kopi",
  "borgol",
];

/* ---------------- AI ---------------- */

export interface AIDecision {
  kind: "skill" | "shoot";
  skill?: SkillId;
  target?: Side;
}

/** Kecerdasan musuh. `smart` 0..1 dari difficulty. */
export class EnemyAI {
  constructor(private logic: RouletteLogic, public smart: number) {}

  /** Satu langkah AI: pakai 1 skill ATAU menembak. */
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

    // 1. Kopi saat sekarat
    if (sk.kopi.owned && sk.kopi.charges > 0 && hp <= 2 && this.logic.canUseSkill("enemy", "kopi")) {
      if (rng < 0.85) return { kind: "skill", skill: "kopi" };
    }

    // 2. Voodoo saat terdesak / peluru banyak
    if (
      sk.voodoo.owned &&
      sk.voodoo.charges > 0 &&
      st.voodooTurns.enemy === 0 &&
      (hp <= 2 || (pLive >= 0.5 && rng < 0.5)) &&
      this.logic.canUseSkill("enemy", "voodoo")
    ) {
      return { kind: "skill", skill: "voodoo" };
    }

    // 3. Intuisi saat ragu
    if (
      known === null &&
      sk.intuisi.owned &&
      sk.intuisi.cooldown === 0 &&
      total > 1 &&
      this.logic.canUseSkill("enemy", "intuisi") &&
      rng < 0.4 + this.smart * 0.5 &&
      (pLive > 0.25 && pLive < 0.85)
    ) {
      return { kind: "skill", skill: "intuisi" };
    }

    const pLiveEff = known !== null ? (known === "live" ? 1 : 0) : pLive;

    // 4. Buang shell live kalau mau memancing blank (known live & mau self-fish)
    if (
      known === "live" &&
      sk.buang.owned &&
      sk.buang.cooldown === 0 &&
      total > 2 &&
      this.logic.canUseSkill("enemy", "buang") &&
      rng < 0.35 + this.smart * 0.5
    ) {
      return { kind: "skill", skill: "buang" };
    }

    // 5. Reroll: kalau yakin shell sekarang buruk buat rencananya
    if (
      sk.reroll.owned &&
      sk.reroll.cooldown === 0 &&
      !st.usedRerollThisTurn &&
      total > 1 &&
      this.logic.canUseSkill("enemy", "reroll") &&
      ((known === "blank" && rng < 0.4) || (pLiveEff >= 0.8 && rng < 0.45))
    ) {
      return { kind: "skill", skill: "reroll" };
    }

    // 6. Borgol untuk menahan pemain kuat
    if (
      sk.borgol.owned &&
      sk.borgol.charges > 0 &&
      this.logic.canUseSkill("enemy", "borgol") &&
      ((playerHp <= 2 && hp <= 2 && rng < 0.6) || (hp === 1 && rng < 0.8))
    ) {
      return { kind: "skill", skill: "borgol" };
    }

    // 7. Keputusan menembak
    if (playerVoodoo && pLiveEff > 0) {
      // menembak pemain berisiko dipantulkan; memancing blank lebih aman
      return { kind: "shoot", target: "enemy" }; // nembak diri sendiri (fishing)
    }
    if (pLiveEff >= 0.6) {
      // banyak live: tembak pemain; kalau pemain pakai voodoo, tetap menembak (nekat)
      return { kind: "shoot", target: "player" };
    }
    if (pLiveEff <= 0.34) {
      return { kind: "shoot", target: "enemy" }; // self-fish
    }
    // zona abu-abu: kecenderungan by smart
    if (rng < 0.35 + this.smart * 0.3) return { kind: "shoot", target: "player" };
    return { kind: "shoot", target: "enemy" };
  }
}
