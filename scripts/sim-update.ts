/**
 * sim-update.ts — smoke test for the new systems:
 * REWIND / GAMBLE skills, ENDLESS score mode, rarity pools (EPIC = shop
 * only, NORMAL+), the slot-based player inventory (duplicates = separate
 * slots with separate cooldowns) and the ENGINE C custom effects
 * (compiled to real WebAssembly).
 * Run: npx tsx scripts/sim-update.ts
 */

import { RouletteLogic, EnemyAI } from "../src/game/logic";
import { RARITY, ALL_SKILL_IDS } from "../src/game/doodle";
import { compileScript, ScriptRuntime, type ScriptHost } from "../src/game/script";
import type { Side } from "../src/game/logic";

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
  L.grantSkill("player", "rewind");
  const slot = L.playerSlot("rewind")!;
  const hpEnemyBefore = L.state.hp.enemy;
  const lenBefore = L.state.cylinder.length;
  const out = L.shoot("player", "enemy");
  check("shot resolved", out.shell === "live" || out.shell === "blank");
  check("lastShot recorded", L.state.lastShot !== null && L.state.lastShot.shell === out.shell);
  const oc = L.useSkill("player", slot.uid);
  check("rewind ok", oc.ok);
  check("shell back in chamber", L.state.cylinder.length === lenBefore && L.state.cylinder[0] === out.shell);
  check("lastShot cleared", L.state.lastShot === null);
  if (out.damageTo === "enemy") {
    check("enemy HP restored", L.state.hp.enemy === hpEnemyBefore);
  }
  check("player knows the shell", L.playerKnown === out.shell);
  check("cooldown 2", slot.cooldown === 2);
  check("charges 2 left", slot.charges === 2);
  // rewind must be refused with no history
  const oc2 = L.useSkill("player", slot.uid);
  check("no double rewind", !oc2.ok);
}

/* ---------- 2. GAMBLE (with preset flips) ---------- */
console.log("GAMBLE:");
{
  const L = new RouletteLogic("normal");
  L.loadCylinder();
  L.setPhase("playerTurn");
  L.grantSkill("player", "gamble");
  const slot = L.playerSlot("gamble")!;
  const hp = L.state.hp.player;
  const ocWin = L.useSkill("player", slot.uid, { win: true });
  check("preset win heals", ocWin.ok && ocWin.gambleWin === true && L.state.hp.player === Math.min(L.state.maxHp.player, hp + 1));
  slot.charges = 3;
  slot.cooldown = 0;
  const hp2 = L.state.hp.player;
  const ocLose = L.useSkill("player", slot.uid, { win: false });
  check("preset lose hurts", ocLose.ok && ocLose.gambleWin === false && L.state.hp.player === hp2 - 1);
}
{
  // aggregate sanity: both outcomes happen over many flips
  let wins = 0;
  const L = new RouletteLogic("normal");
  L.loadCylinder();
  L.setPhase("playerTurn");
  L.grantSkill("player", "gamble");
  const slot = L.playerSlot("gamble")!;
  for (let i = 0; i < 400; i++) {
    L.state.hp.player = 3;
    slot.cooldown = 0;
    slot.charges = 3;
    const oc = L.useSkill("player", slot.uid, {});
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

/* ---------- 4. RARITY POOLS: EPIC = SHOP ONLY, NORMAL+ ---------- */
console.log("RARITY:");
check("rewind is epic", RARITY.rewind === "epic");
check("gamble is epic", RARITY.gamble === "epic");
check("legends are legend", RARITY.phoenix === "legend" && RARITY.thirdEye === "legend");
check("all 10 ids known", ALL_SKILL_IDS.length === 10);

/* ---------- 5. SLOT INVENTORY (allow duplicate) ---------- */
console.log("SLOTS:");
{
  const L = new RouletteLogic("normal");
  L.loadCylinder();
  L.setPhase("playerTurn");
  // two separate peek slots — each with its own cooldown
  L.grantSkill("player", "peek");
  L.grantSkill("player", "peek");
  const [a, b] = L.state.skills;
  check("duplicate = 2 separate slots", L.state.skills.length === 2 && a.id === "peek" && b.id === "peek");
  check("slots have unique uids", a.uid !== b.uid);
  check("both usable at start", L.canUseSkill("player", a.uid) && L.canUseSkill("player", b.uid));
  L.useSkill("player", a.uid);
  check("slot A cooling, slot B free", a.cooldown === 3 && b.cooldown === 0);
  check("slot B still usable", L.canUseSkill("player", b.uid));
  check("slot A blocked", !L.canUseSkill("player", a.uid));
  // the enemy record still stacks (no slots for the dealer)
  L.grantSkill("enemy", "coffee");
  L.grantSkill("enemy", "coffee");
  check("enemy coffee stacked to 2 charges", L.state.enemySkills.coffee.charges === 2);
}

/* ---------- 6. ENGINE C (WebAssembly custom effects) ---------- */
async function makeRt(src: string, host: ScriptHost, onFatal?: (m: string) => void) {
  const res = compileScript(src);
  if (!res.ok || !res.bytes) return { res, rt: null as ScriptRuntime | null };
  const rt = await ScriptRuntime.instantiate(res.bytes, host, onFatal);
  return { res, rt };
}

async function main() {
console.log("ENGINE C:");
{
  const src = `
int shots = 0;
every (dealer_take_damage) {
  shots += 1;
  if (shots == 5) {
    heal(PLAYER, 2);
    print("two hits... five");
  }
}
every (hit) {
  if (hp(PLAYER) <= 1) {
    run_skill("cuffs", DEALER);
  }
}
every (setup) {
  repeat (3) {
    shots += 1;
  }
}
`;
  const log: string[] = [];
  const applied: string[] = [];
  const host: ScriptHost = {
    runSkill: (id, target) => applied.push(`${id}->${target}`),
    heal: (side: Side, n) => log.push(`heal ${side} ${n}`),
    damage: (side: Side, n) => log.push(`damage ${side} ${n}`),
    say: (s) => log.push(`say: ${s}`),
    stateRef: () => ({ hp: { player: 1, enemy: 5 } as Record<Side, number>, score: 0, round: 1 }),
  };
  const { res, rt } = await makeRt(src, host);
  check("compiles clean", res.ok, res.errors.join(" | "));
  check("hooks detected", res.hooks.join(",") === "setup,hit,dealer_take_damage", res.hooks.join(","));
  if (rt) {
    rt.fire("setup"); // the setup adds 3 via repeat
    rt.fire("dealer_take_damage");
    rt.fire("dealer_take_damage");
    rt.fire("hit");
    check("heal fired at shots==5 (3 setup + 2 damage)", log.some((s) => s === "heal player 2"), log.join(" | "));
    check("print fired", log.some((s) => s === "say: two hits... five"));
    check("cuffs forced on dealer (hp player <= 1)", applied.includes("cuffs->enemy"));
  }
}
{
  // broken script must produce readable errors, not throw
  const res = compileScript("every (hit) { if (hp(DEALER) == { nonsense( }");
  check("errors reported", !res.ok && res.errors.length > 0, res.errors.join(" | "));
  check("errors carry line numbers", res.errors.every((e) => /^line \d+/.test(e)));
}
{
  // infinite repeat without break gets stopped by the fuel guard
  const log: string[] = [];
  let fatal = "";
  const { res, rt } = await makeRt(
    "every (setup) { repeat (-1) { heal(PLAYER, 1); } }",
    {
      runSkill: () => {},
      heal: () => log.push("heal"),
      damage: () => {},
      say: () => {},
      stateRef: () => ({ hp: { player: 3, enemy: 5 } as Record<Side, number>, score: 0, round: 1 }),
    },
    (m) => (fatal = m),
  );
  check("infinite loop compiles", res.ok, res.errors.join(" | "));
  if (rt) rt.fire("setup");
  check("runaway loop stopped by fuel guard", log.length > 1000 && fatal.includes("fuel"), `heals=${log.length} fatal="${fatal}"`);
  check("game survived the trap", true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
}

void main();
