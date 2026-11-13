/**
 * seed.ts — the DAILY SEED system.
 *
 * The seed is an ALGORITHM over today's date (day, month, year — UTC, so
 * every player on Earth gets the identical run), never hardcoded. From the
 * seed we derive independent counter-based random STREAMS, one per purpose:
 *
 *   rngStream("shells", round, i)  → shell loads for that round
 *   rngStream("shop", round, k)    → the shop items offered that break
 *   rngStream("skill", side, k)    → the skills the dice hands out
 *
 * Streams are pure functions of (seed, tag, counters) — the order in which
 * the game queries them cannot desync two players on the same date.
 *
 * When the daily seed is OFF, every stream simply falls back to Math.random.
 */

/* ---------------- 32-bit mixing (splitmix-style finalizer) ---------------- */

function mix32(a: number): number {
  a |= 0;
  a = Math.imul(a ^ (a >>> 16), 0x21f0aaad);
  a = Math.imul(a ^ (a >>> 15), 0x735a2d97);
  return (a ^ (a >>> 15)) >>> 0;
}

/** FNV-1a — turns a stream tag ("shells", "shop"...) into a number. */
function tagHash(s: string): number {
  let h = 2166136261 | 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

/* ---------------- seed from the date ---------------- */

export interface DailySeedInfo {
  /** unix-ish 32-bit seed mixed from the date string */
  seed: number;
  /** UTC date the seed was derived from, "YYYY-MM-DD" */
  date: string;
  /** short human code shown in the UI, e.g. "K3X9Q2" */
  code: string;
}

/** The date algorithm: YYYY-MM-DD → hash avalanche → 32-bit seed. */
export function seedFromDate(d: Date): DailySeedInfo {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const date = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  // two avalanche rounds over the FNV hash of the date string (plus a tag
  // salt so the seed is not just "hash of a small number")
  let h = tagHash(`roulteemate/${date}`);
  h = mix32(h ^ 0x52554c54); // "RULT"
  h = mix32(h);
  const seed = h | 0;
  const code = (seed >>> 0).toString(36).toUpperCase().padStart(7, "0").slice(-6);
  return { seed, date, code };
}

/** Today's seed info, computed fresh (never stored, never hardcoded). */
export function getDailyInfo(): DailySeedInfo {
  return seedFromDate(new Date());
}

/* ---------------- global stream state ---------------- */

let active = false;
let baseSeed = 0;

/** Activate the daily streams with a concrete seed (engine calls this at
 *  startGame when the DAILY toggle is on). */
export function setDailySeed(seed: number) {
  baseSeed = seed | 0;
  active = true;
}

/** Back to plain Math.random. */
export function setDailyOff() {
  active = false;
}

export function isDailyOn(): boolean {
  return active;
}

/* ---------------- the streams ---------------- */

/**
 * One deterministic random draw from a named stream, in [0, 1).
 * `tag` selects the stream ("shells", "shop", "skill"...), the rest are
 * counters (round number, pick index...). Same inputs → same output,
 * on every machine, forever.
 */
export function rngStream(tag: string, ...idx: number[]): number {
  if (!active) return Math.random();
  let h = (baseSeed ^ tagHash(tag)) | 0;
  for (let i = 0; i < idx.length; i++) {
    h = mix32(h ^ Math.imul((idx[i] | 0) + 0x9e3779b9, 0x85ebca6b));
  }
  return mix32(h) / 4294967296;
}

/**
 * Deterministic pick: draws from `pool` via the stream until `taken(x)`
 * is false (ownership / availability checks), bounded retries. The caller
 * applies effects between picks so `taken` sees the updated world.
 */
export function streamPick<T>(pool: T[], taken: (x: T) => boolean, tag: string, k: number): T | null {
  if (!pool.length) return null;
  for (let i = 0; i < 32; i++) {
    const x = pool[Math.floor(rngStream(tag, k, i) * pool.length)];
    if (!taken(x)) return x;
  }
  return null;
}
