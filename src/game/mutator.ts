/**
 * mutator.ts — the MUTATORS configuration: every knob the custom-table
 * popup exposes. Built in the UI, applied by the engine at startGame.
 */

import type { Difficulty, Mode } from "./logic";
import type { SkillId } from "./doodle";

export interface MutConfig {
  /** Which cards may appear at all (dice + shop), before rarity gates. */
  pool: SkillId[];
  /** LEGEND cards allowed — still requires INSANE or ENDLESS to actually spawn. */
  allowLegend: boolean;
  /** The DEALER's brain, independent of the table difficulty. */
  ai: Difficulty;
  /** Custom HP for both sides. */
  hpPlayer: number;
  hpEnemy: number;
  /** How many skills the opening dice hands out. */
  skillsPlayer: number;
  skillsEnemy: number;
  /** Already-owned skills may be granted again — each copy joins the
   *  inventory as its OWN slot with its own charges & cooldown. */
  allowDup: boolean;
  /** Custom effect program — ENGINE C source, compiled to WebAssembly. */
  rules: string;
}

export const MUT_DEFAULTS: Omit<MutConfig, "pool" | "ai" | "hpPlayer" | "hpEnemy" | "skillsEnemy"> = {
  allowLegend: false,
  skillsPlayer: 2,
  allowDup: false,
  rules: "",
};

/** Sensible starting points per table (before the player tweaks anything). */
export function mutDefaultsFor(diff: Difficulty, mode: Mode, pool: SkillId[]): MutConfig {
  const base: Record<Difficulty, { hpPlayer: number; hpEnemy: number; skillsPlayer: number; skillsEnemy: number }> = {
    easy: { hpPlayer: 6, hpEnemy: 5, skillsPlayer: 2, skillsEnemy: 1 },
    normal: { hpPlayer: 5, hpEnemy: 5, skillsPlayer: 2, skillsEnemy: 2 },
    insane: { hpPlayer: 4, hpEnemy: 5, skillsPlayer: 2, skillsEnemy: 3 },
  };
  const b = mode === "endless" ? { hpPlayer: 5, hpEnemy: 5, skillsPlayer: 2, skillsEnemy: 3 } : base[diff];
  return {
    pool: [...pool],
    allowLegend: false,
    ai: diff,
    hpPlayer: b.hpPlayer,
    hpEnemy: b.hpEnemy,
    skillsPlayer: b.skillsPlayer,
    skillsEnemy: b.skillsEnemy,
    allowDup: false,
    rules: "",
  };
}
