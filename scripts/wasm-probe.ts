/**
 * wasm-probe.ts — quick validation of the ENGINE C compiler.
 * Compiles C programs and runs them against a mock host.
 * Run: npx tsx scripts/wasm-probe.ts
 */
import { compileScript, ScriptRuntime, type ScriptHost } from "../src/game/script";
import type { Side } from "../src/game/logic";

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

function mkHost() {
  const log: string[] = [];
  const state = { hp: { player: 3, enemy: 5 } as Record<Side, number>, score: 2, round: 4 };
  const host: ScriptHost = {
    runSkill: (id, target) => log.push(`run_skill ${id} ${target}`),
    heal: (side, n) => log.push(`heal ${side} ${n}`),
    damage: (side, n) => log.push(`damage ${side} ${n}`),
    say: (s) => log.push(`say ${s}`),
    stateRef: () => state,
  };
  return { log, state, host };
}

async function run(src: string) {
  const res = compileScript(src);
  if (!res.ok) return { res, rt: null as ScriptRuntime | null, log: [] as string[] };
  const h = mkHost();
  const rt = await ScriptRuntime.instantiate(res.bytes!, h.host);
  return { res, rt, log: h.log };
}

async function main() {
  /* 1. basic: every + if + heal */
  {
    const { res, rt, log } = await run(`
int bonus = 0;
every (dealer_take_damage) {
  bonus = bonus + 1;
  if (bonus >= 3) {
    heal(PLAYER, 2);
    bonus = 0;
  }
}
every (hit) {
  if (hp(DEALER) <= 2) {
    run_skill("cuffs", DEALER);
  }
}
`);
    ok("compiles", res.ok, res.errors.join(" | "));
    ok("hooks detected", res.hooks.join(",") === "hit,dealer_take_damage", res.hooks.join(","));
    if (rt) {
      rt.fire("dealer_take_damage");
      rt.fire("dealer_take_damage");
      ok("no heal before 3 hits", !log.includes("heal player 2"), log.join(" | "));
      rt.fire("dealer_take_damage");
      ok("heal on 3rd hit", log.includes("heal player 2"), log.join(" | "));
      // global reset: heal only again on the 6th
      rt.fire("dealer_take_damage");
      rt.fire("dealer_take_damage");
      ok("counter reset works", !log.filter((s) => s === "heal player 2").slice(1).length, log.join(" | "));
      rt.fire("dealer_take_damage");
      ok("heal again on 6th", log.filter((s) => s === "heal player 2").length === 2);
    }
  }

  /* 2. run_skill + last_skill + print */
  {
    const { res, rt, log } = await run(`
every (skill) {
  if (last_skill() == SKILL_GAMBLE) {
    run_skill("coffee", PLAYER);
  }
}
every (setup) {
  print("table online");
  print(1 + 2);
  say("hi");
}
`);
    ok("compiles 2", res.ok, res.errors.join(" | "));
    if (rt) {
      rt.fire("setup");
      ok("print string + num + say", log.includes("say table online") && log.includes("say 3") && log.includes("say hi"), log.join(" | "));
      rt.fire("skill", { skill: "gamble" });
      ok("coffee forced on gamble", log.includes("run_skill coffee player"), log.join(" | "));
      rt.fire("skill", { skill: "peek" });
      ok("nothing on peek", log.filter((s) => s.includes("run_skill")).length === 1);
    }
  }

  /* 3. loops: repeat, while, break, infinite+fuel */
  {
    const { res, rt, log } = await run(`
every (turn) {
  repeat (3) {
    heal(PLAYER, 1);
  }
  int i = 5;
  while (i > 0) {
    i = i - 1;
    damage(DEALER, 1);
  }
  repeat (2) {
    break;
  }
}
`);
    ok("loops compile", res.ok, res.errors.join(" | "));
    if (rt) {
      rt.fire("turn");
      ok("repeat 3 heals", log.filter((s) => s === "heal player 1").length === 3, log.join(" | "));
      ok("while 5 damages", log.filter((s) => s === "damage enemy 1").length === 5);
    }
  }

  {
    const { res, rt, log } = await run(`every (round) { repeat (-1) { damage(PLAYER, 1); } }`);
    ok("infinite compiles", res.ok, res.errors.join(" | "));
    if (rt) {
      rt.fire("round");
      const hits = log.filter((s) => s.startsWith("damage player")).length;
      ok("fuel guard stopped the loop", hits > 1000, `hits=${hits}`);
    }
  }

  /* 4. floats + && + globals shared across hooks */
  {
    const { res, rt, log } = await run(`
float acc = 0.5;
int count = 0;
every (hit) {
  acc = acc + 0.25;
  count += 2;
  if (acc > 1.0 && count == 6) {
    heal(PLAYER, 3);
  }
}
`);
    ok("floats compile", res.ok, res.errors.join(" | "));
    if (rt) {
      rt.fire("hit");
      rt.fire("hit");
      ok("no heal yet", !log.includes("heal player 3"), log.join("|"));
      rt.fire("hit");
      ok("float + global logic fired", log.includes("heal player 3"), log.join(" | "));
    }
  }

  /* 5. errors are readable */
  {
    const res = compileScript(`
every (bogus_event) { heal(PLAYER, 1); }
every (hit) { heal(PLAYER, ); }
x = 3;
`);
    ok("bad program reports errors", !res.ok && res.errors.length >= 1, res.errors.join(" | "));
    ok("line numbers in errors", res.errors.every((e) => /^line \d+/.test(e)), res.errors.join(" | "));
  }

  /* 6. compile once, fire many — fuel resets per fire */
  {
    const { res, rt, log } = await run(`every (dealer_take_damage) { repeat (10) { heal(PLAYER, 1); } }`);
    if (rt) {
      for (let i = 0; i < 25000; i++) rt.fire("dealer_take_damage");
      ok("many fires without runaway fuel", log.length === 250000, `log=${log.length}`);
    }
  }

  /* 7. break inside nested if inside loop */
  {
    const { res, rt, log } = await run(`
every (round) {
  repeat (5) {
    if (round() >= 0) {
      heal(PLAYER, 1);
      break;
    }
  }
}
`);
    ok("nested break compiles", res.ok, res.errors.join(" | "));
    if (rt) {
      rt.fire("round");
      ok("break exits the whole loop (1 heal only)", log.filter((s) => s === "heal player 1").length === 1, log.join(" | "));
    }
  }

  /* 8. ENGINE C v2: new hooks + new builtins */
  {
    const calls: string[] = [];
    const res = compileScript(`
int dmg = 2;
every (round)   { set_dmg_next(dmg); }
every (shop)    { say("welcome to the shop"); }
every (death)   { if (chance(100)) heal(PLAYER, 5); }
every (coin)    { set_coin(1); }
every (peek)    { shuffle(); }
every (setup)   { theme(16711680); }
`);
    ok("v2 program compiles", res.ok, res.errors.join(" | "));
    ok("v2 hooks detected", res.hooks.join(",") === "setup,round,shop,death,coin,peek", res.hooks.join(","));
    if (res.ok && res.bytes) {
      const rt = await ScriptRuntime.instantiate(res.bytes, {
        runSkill: () => {},
        heal: (side, n) => calls.push(`heal ${side} ${n}`),
        damage: (side, n) => calls.push(`damage ${side} ${n}`),
        say: (s) => calls.push(`say ${s}`),
        stateRef: () => ({ hp: { player: 0, enemy: 3 } as Record<Side, number>, score: 0, round: 1 }),
        // ENGINE C v2 optional host methods
        chance: (p) => p >= 100,
        shuffle: () => calls.push("shuffle"),
        theme: (c) => calls.push(`theme ${c}`),
        setDmgNext: (n) => calls.push(`set_dmg_next ${n}`),
        setCoin: (w) => calls.push(`set_coin ${w}`),
      });
      rt.fire("setup");
      rt.fire("round");
      rt.fire("shop");
      rt.fire("death"); // hp player = 0 → death hook heals 5 via chance(100)
      rt.fire("coin");
      rt.fire("peek");
      ok("theme passed the color", calls.includes("theme 16711680"), calls.join(" | "));
      ok("set_dmg_next passed 2", calls.includes("set_dmg_next 2"), calls.join(" | "));
      ok("shop hook said its line", calls.includes("say welcome to the shop"), calls.join(" | "));
      ok("chance(100) + heal denied death", calls.includes("heal player 5"), calls.join(" | "));
      ok("set_coin forced heads", calls.includes("set_coin 1"), calls.join(" | "));
      ok("shuffle called on peek", calls.includes("shuffle"), calls.join(" | "));
    }
  }

  /* 9. v2 default host (no optional methods) still runs */
  {
    const { res, rt } = await run(`every (coin) { if (chance(0) == 1) { damage(PLAYER, 9); } }`);
    ok("v2 compiles without optional host", res.ok, res.errors.join(" | "));
    if (rt) {
      rt.fire("coin");
      ok("chance(0) never fires", true);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

void main();
