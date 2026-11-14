/**
 * roult-test.ts — the 6-case roul AI exam.
 * Runs the FULL pipeline (understand -> plan -> revise-on-one-case ->
 * generate) on six free-form Indonesian prompts, then:
 *   - asserts the generated ENGINE C compiles (real compileScript)
 *   - instantiates the WASM runtime against a mock host and fires the
 *     hooks, asserting the expected host calls happen.
 * Run: npx tsx scripts/roult-test.ts
 */

import { compileScript, ScriptRuntime, type ScriptHost, type ScriptEventName } from "../src/game/script";
import type { Side } from "../src/game/logic";
import { makePlan, revisePlan, buildScript, traceThinking, estTokens, ROULT_CTX_LIMIT } from "../src/game/roult";

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name} ${extra}`);
  }
};

interface Case {
  id: string;
  prompt: string;
  mustHooks: ScriptEventName[];
  /** after firing these hooks in order (with state), expect these host calls */
  fire: { hook: ScriptEventName; state?: { round?: number; hp?: { player?: number; enemy?: number } } }[];
  expect: { atLeast?: [string, string, string][]; exact?: string[]; shuffle?: boolean; coin?: number; theme?: boolean }[];
}

const CASES: Case[] = [
  {
    id: "1 · vampire drain",
    prompt: "buat gamemode vampir, tiap aku nembak dealer aku sembuh dikit",
    mustHooks: ["setup", "dealer_take_damage"],
    fire: [{ hook: "dealer_take_damage" }],
    expect: [{ atLeast: [["heal", "player", "1"]] }],
  },
  {
    id: "2 · shuffle chaos",
    prompt: "mode chaos: tiap ronde pelurunya diacak ulang dan kadang-kadang aku kena damage dadakan",
    mustHooks: ["round"],
    fire: [{ hook: "round", state: { round: 3 } }],
    expect: [{ shuffle: true }],
  },
  {
    id: "3 · sudden death",
    prompt: "sudden death ronde 6, semua langsung kena 2 cepat tamat",
    mustHooks: ["round"],
    fire: [{ hook: "round", state: { round: 6 } }],
    expect: [{ atLeast: [["damage", "player", "2"], ["damage", "enemy", "2"]] }],
  },
  {
    id: "4 · tank regen",
    prompt: "aku mau jadi tank, tiap ronde baru aku sembuh 1, santai aja",
    mustHooks: ["round"],
    fire: [{ hook: "round", state: { round: 2 } }],
    expect: [{ atLeast: [["heal", "player", "1"]] }],
  },
  {
    id: "5 · blood tax on every turn",
    prompt: "dealer jahat banget, tiap giliran aku kepotong pajak darah 1",
    mustHooks: ["turn"],
    fire: [{ hook: "turn" }],
    expect: [{ atLeast: [["damage", "player", "1"]] }],
  },
  {
    id: "6 · rigged coin + violet room",
    prompt: "coin flip gak boleh bohong, gamble selalu menang, terus ruangannya ungu",
    mustHooks: ["coin", "setup"],
    fire: [{ hook: "coin" }, { hook: "setup" }],
    expect: [{ coin: 1, theme: true }],
  },
];

function mkHost() {
  const calls: string[] = [];
  let shuffled = 0;
  let coin: number | null = null;
  let themed = 0;
  const state = {
    hp: { player: 5, enemy: 5 } as Record<Side, number>,
    score: 0,
    round: 1,
  };
  const host: ScriptHost = {
    runSkill: (id, target) => calls.push(`skill ${id} ${target}`),
    heal: (side, n) => calls.push(`heal ${side} ${n}`),
    damage: (side, n) => calls.push(`damage ${side} ${n}`),
    say: (s) => calls.push(`say ${s}`),
    stateRef: () => state,
    shuffle: () => {
      shuffled++;
      calls.push("shuffle");
    },
    setCoin: (w) => {
      coin = w;
      calls.push(`coin ${w}`);
    },
    theme: () => {
      themed++;
      calls.push("theme");
    },
    setDmgNext: (n) => calls.push(`dmg_next ${n}`),
  };
  return { calls, state, host, get shuffled() { return shuffled; }, get coin() { return coin; }, get themed() { return themed; } };
}

async function main() {
  console.log("== roul AI exam: 6 prompts through the full pipeline ==\n");

  for (const c of CASES) {
    console.log(`CASE ${c.id}`);
    console.log(`  prompt : "${c.prompt}"`);

    const seed = (c.id.length * 7919) >>> 0;
    const plan = makePlan(c.prompt, seed);
    const trace = traceThinking(c.prompt, plan, false);
    ok(`${c.id}: plan has a title`, plan.title.length > 4, plan.title);
    ok(`${c.id}: thinking trace exists`, trace.length >= 3);

    const res = buildScript(plan, seed ^ 0x5bf03635);
    ok(`${c.id}: generated script COMPILES`, res.ok, res.errors.join(" | "));
    if (!res.ok) continue;
    ok(`${c.id}: hooks ${c.mustHooks.join("+")} present`, c.mustHooks.every((h) => res.hooks.includes(h)), res.hooks.join(","));

    const { code } = res;
    ok(`${c.id}: carries the mode title`, code.includes(plan.title));
    ok(`${c.id}: carries idea echo`, code.toLowerCase().includes(c.prompt.slice(0, 12).toLowerCase()));

    // run the REAL wasm
    const h = mkHost();
    const rt = await ScriptRuntime.instantiate(res.bytes!, h.host);
    for (const f of c.fire) {
      if (f.state) {
        if (f.state.round !== undefined) h.state.round = f.state.round;
        if (f.state.hp) {
          if (f.state.hp.player !== undefined) h.state.hp.player = f.state.hp.player;
          if (f.state.hp.enemy !== undefined) h.state.hp.enemy = f.state.hp.enemy;
        }
      }
      rt.fire(f.hook);
    }
    for (const [i, ex] of c.expect.entries()) {
      if (ex.atLeast) {
        for (const [verb, side, n] of ex.atLeast) {
          ok(`${c.id}: host saw ${verb}(${side}, ${n})`, h.calls.some((x) => x.startsWith(`${verb} ${side} ${n}`)), h.calls.join(" | "));
        }
      }
      if (ex.shuffle !== undefined) ok(`${c.id}: shuffle() hit the host`, h.shuffled > 0, h.calls.join(" | "));
      if (ex.coin !== undefined) ok(`${c.id}: set_coin(${ex.coin}) hit the host`, h.coin === ex.coin, `coin=${h.coin}`);
      if (ex.theme) ok(`${c.id}: theme() tint applied`, h.themed > 0, h.calls.join(" | "));
      void i;
    }
    console.log(`  plan   : ${plan.title} — ${plan.tagline}`);
    console.log(`  mechs  : ${plan.mechs.map((m) => m.id).join(", ")}`);
    console.log(`  wasm   : ${res.size} bytes · hooks ${res.hooks.join(", ")}`);
    console.log("");
  }

  /* revision round: mutate case 1's plan */
  console.log("REVISION check");
  const p1 = makePlan(CASES[0].prompt, 123);
  const { plan: p2, applied } = revisePlan(p1, "lebih brutal terus tambah regen tiap ronde", 99);
  ok("revision applied aspects", applied.length >= 2, applied.join(" | "));
  ok("revision kept severity <= 2", p2.severity <= 2 && p2.severity > p1.severity);
  const r2 = buildScript(p2, 555);
  ok("revised plan still compiles", r2.ok, r2.errors.join(" | "));

  /* context window math */
  ok("ctx meter under limit for a small chat", estTokens("a".repeat(200)) < 200);
  ok("ctx limit is 4096", ROULT_CTX_LIMIT === 4096);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
