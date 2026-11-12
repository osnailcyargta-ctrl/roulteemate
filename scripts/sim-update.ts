/**
 * sim-update.ts — smoke test for the new systems:
 * REWIND / GAMBLE skills, ENDLESS score mode, rarity pools and the
 * C-like custom effect scripts. Run: npx tsx scripts/sim-update.ts
 */

import { RouletteLogic, EnemyAI } from "../src/game/logic";
import { RARITY, ALL_SKILL_IDS } from "../src/game/doodle";
import { parseScript, ScriptRuntime } from "../src/game/script";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name} ${extra}`);
  }
}

/* ---------- 1. REWIND ---------- */
console.log("REWIND:");
{
  const L = new RouletteLogic("normal");
  L.loadCylinder();
  L.setPhase("playerTurn");
  L.state.skills.rewind = { owned: true, charges: 3, cooldown: 0, maxCharges: 3 };
  const hpEnemyBefore = L.state.hp.enemy;
  const lenBefore = L.state.cylinder.length;
  const out = L.shoot("player", "enemy");
  check("shot resolved", out.shell === "live" || out.shell === "blank");
  check("lastShot recorded", L.state.lastShot !== null && L.state.lastShot.shell === out.shell);
  const oc = L.useSkill("player", "rewind");
  check("rewind ok", oc.ok);
  check("shell back in chamber", L.state.cylinder.length === lenBefore && L.state.cylinder[0] === out.shell);
  check("lastShot cleared", L.state.lastShot === null);
  if (out.damageTo === "enemy") {
    check("enemy HP restored", L.state.hp.enemy === hpEnemyBefore);
  }
  check("player knows the shell", L.playerKnown === out.shell);
  check("cooldown 2", L.state.skills.rewind.cooldown === 2);
  check("charges 2 left", L.state.skills.rewind.charges === 2);
  // rewind must be refused with no history
  const oc2 = L.useSkill("player", "rewind");
  check("no double rewind", !oc2.ok);
}

/* ---------- 2. GAMBLE ---------- */
console.log("GAMBLE:");
for (let i = 0; i < 200; i++) {
  const L = new RouletteLogic("normal");
  L.loadCylinder();
  L.setPhase("playerTurn");
  L.state.skills.gamble = { owned: true, charges: 3, cooldown: 0, maxCharges: 3 };
  const hp = L.state.hp.player;
  const oc = L.useSkill("player", "gamble");
  if (!oc.ok) {
    check("gamble usable", false);
    break;
  }
  const nowHp = L.state.hp.player;
  if (oc.gambleWin) check(`win heals (${hp}->${nowHp})`, nowHp === Math.min(L.state.maxHp.player, hp + 1));
  else check(`lose hurts (${hp}->${nowHp})`, nowHp === hp - 1);
  if (i > 0) break; // one detailed pass is enough, then aggregate below
}
{
  // aggregate sanity: both outcomes happen over many flips
  let wins = 0;
  const L = new RouletteLogic("normal");
  L.loadCylinder();
  L.setPhase("playerTurn");
  for (let i = 0; i < 400; i++) {
    L.state.skills.gamble = { owned: true, charges: 3, cooldown: 0, maxCharges: 3 };
    L.state.hp.player = 3;
    L.state.skills.gamble.cooldown = 0;
    const oc = L.useSkill("player", "gamble");
    if (oc.ok && oc.gambleWin) wins++;
  }
  check(`coin is fairish (${wins}/400)`, wins > 140 && wins < 260);
}

/* ---------- 3. ENDLESS SCORE ---------- */
console.log("ENDLESS:");
{
  const L = new RouletteLogic("insane", "endless");
  L.loadCylinder();
  check("score starts 0", L.state.score === 0);
  let hits = 0;
  for (let i = 0; i < 60 && !L.isEmpty; i++) {
    const out = L.shoot("player", "enemy");
    if (out.damageTo === "enemy") hits++;
  }
  check(`dealer hits became score (${hits})`, L.state.score === hits);
  check("dealer hp untouched", L.state.hp.enemy === L.state.maxHp.enemy);
  // dealer heal drains the score, can go negative
  L.state.score = 0;
  L.healSide("enemy", 1);
  check("dealer heal = -1 score", L.state.score === -1);
  // player damage still normal
  const dead = L.damageSide("player", 5);
  check("player can still die", dead && L.state.hp.player === 0);
}

/* ---------- 4. RARITY POOLS ---------- */
console.log("RARITY:");
check("rewind is epic", RARITY.rewind === "epic");
check("gamble is epic", RARITY.gamble === "epic");
check("legends are legend", RARITY.phoenix === "legend" && RARITY.thirdEye === "legend");
check("all 10 ids known", ALL_SKILL_IDS.length === 10);

/* ---------- 5. SCRIPT DSL ---------- */
console.log("SCRIPT:");
{
  const src = `
shots = 0
every dealer take damage {
  add shots 1
  if shots == 5 {
    heal player 2
    print "two hits!"
  }
}
every hit {
  if hp player <= 1 {
    run skill cuffs to dealer
  }
}
repeat 3 {
  add shots 1
}
repeat -1 {
  break
}
`;
  const res = parseScript(src);
  check("parses clean", res.errors.length === 0, res.errors.join(" | "));
  check("has handlers", res.program.handlers.length === 2);
  const log: string[] = [];
  const applied: string[] = [];
  const rt = new ScriptRuntime(res.program, {
    runSkill: (id, target) => applied.push(`${id}->${target}`),
    heal: (side, n) => log.push(`heal ${side} ${n}`),
    damage: (side, n) => log.push(`damage ${side} ${n}`),
    say: (s) => log.push(`say: ${s}`),
  });
  rt.stateRef = () => ({ hp: { player: 1, enemy: 5 }, score: 0, round: 1 });
  rt.setup(); // setup: shots = 0 (+ the repeat -1/break runs harmlessly)
  rt.fire("damage:dealer", {});
  rt.fire("damage:dealer", {});
  rt.fire("hit", {});
  check("shots var counted", (rt as unknown as { vars: Map<string, number> }).vars.get("shots") === 5);
  check("heal fired at shots==5", log.some((s) => s === "heal player 2"));
  check("print fired", log.some((s) => s === "say: two hits!"));
  check("cuffs forced on dealer", applied.includes("cuffs->enemy"));
}
{
  // broken script must produce readable errors, not throw
  const res = parseScript("if hp dealer == {\n  nonsense(\n");
  check("errors reported", res.errors.length > 0);
}
{
  // infinite repeat without break gets stopped by the step guard
  const res = parseScript("repeat -1 { add x 1 }");
  const log: string[] = [];
  const rt = new ScriptRuntime(res.program, {
    runSkill: () => {},
    heal: () => {},
    damage: () => {},
    say: (s) => log.push(s),
  });
  rt.setup();
  check("runaway loop stopped", log.some((s) => s.includes("too long") || s.includes("too many steps")));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
