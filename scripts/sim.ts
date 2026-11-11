/**
 * sim.ts — headless invariant tests for the 2.0 update (pure logic only).
 * Run: bun scripts/sim.ts
 */
import { RouletteLogic, EnemyAI, type Difficulty } from "../src/game/logic";
import type { SkillId } from "../src/game/doodle";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures++;
    console.error("FAIL:", msg);
  }
}

function maxHpOf(diff: Difficulty) {
  const L = new RouletteLogic(diff);
  return { p: L.state.maxHp.player, e: L.state.maxHp.enemy };
}

// 1) HP tables
{
  const e = maxHpOf("easy");
  const n = maxHpOf("normal");
  const i = maxHpOf("insane");
  assert(e.p === 6 && e.e === 6, `EASY should be 6/6, got ${e.p}/${e.e}`);
  assert(n.p === 5 && n.e === 6, `NORMAL should be 5/6, got ${n.p}/${n.e}`);
  assert(i.p === 4 && i.e === 7, `INSANE should be 4/7, got ${i.p}/${i.e}`);
  console.log("HP tables: easy", e, "normal", n, "insane", i);
}

// 2) Third-eye queue persistence
{
  const L = new RouletteLogic("normal");
  L.state.round = 1;
  L.loadCylinder();
  L.grantTrial("player", "thirdEye");
  L.setPhase("playerTurn");
  L.state.turn = "player";
  const oc = L.useSkill("player", "thirdEye");
  assert(oc.ok && (oc.queue?.length ?? 0) === 3, "thirdEye should reveal 3 shells");
  const first = oc.queue![0];
  assert(L.playerKnown === first, "playerKnown should equal queue[0]");
  L.shoot("player", "player"); // fire one
  assert(L.playerKnownQueue.length === 2, "queue should shift after a shot");
  assert(L.playerKnown === L.playerKnownQueue[0], "playerKnown tracks queue after shot");
  // reroll muddies slot 0 only
  if (L.playerKnownQueue.length) {
    const rest = L.playerKnownQueue.slice(1);
    L.state.skills.reroll.owned = true;
    L.state.skills.reroll.charges = -1;
    L.state.skills.reroll.cooldown = 0;
    L.useSkill("player", "reroll");
    assert(L.playerKnownQueue[0] === null, "reroll makes current shell unknown");
    assert(
      L.playerKnownQueue.slice(1).every((v, i) => v === rest[i]),
      "reroll keeps deeper queue knowledge",
    );
  }
  console.log("thirdEye queue OK");
}

// 3) Phoenix saves the player exactly once at lethal damage
{
  const L = new RouletteLogic("normal");
  L.state.round = 1;
  L.loadCylinder();
  L.grantTrial("player", "phoenix");
  L.state.hp.player = 1;
  L.setPhase("playerTurn");
  let guard = 0;
  let saved = 0;
  while (guard++ < 6) {
    if (L.state.cylinder[0] === "live") {
      const out = L.shoot("enemy", "player");
      if (out.phoenixSaved) {
        saved++;
        assert(L.state.hp.player === 1, "phoenix leaves player at 1 HP");
        assert(L.state.skills.phoenix.charges === 0, "phoenix charge burned");
        assert(out.death === null, "no death when phoenix saves");
      }
      break;
    } else {
      L.state.cylinder.shift();
    }
  }
  assert(saved === 1, `phoenix should have saved once, got ${saved}`);
  // second lethal blow must kill
  L.state.cylinder.unshift("live");
  const out2 = L.shoot("enemy", "player");
  assert(out2.death === "player" && L.state.hp.player === 0, "second lethal blow kills");
  console.log("phoenix OK");
}

// 4) Fog of war + real AI memory over full random games
{
  const diffs: Difficulty[] = ["easy", "normal", "insane"];
  let games = 0;
  let phoenixSaves = 0;
  let thirdEyeUses = 0;
  for (const diff of diffs) {
    for (let g = 0; g < 60; g++) {
      const L = new RouletteLogic(diff);
      L.state.round = 1;
      L.loadCylinder();
      L.setPhase("playerTurn");
      if (g % 3 === 0) L.grantTrial("player", "phoenix");
      if (g % 3 === 1) L.grantTrial("player", "thirdEye");
      const ai = new EnemyAI(L, diff === "insane" ? 0.95 : diff === "normal" ? 0.8 : 0.55);
      let guard = 0;
      while (L.state.hp.player > 0 && L.state.hp.enemy > 0 && guard++ < 400) {
        const side = L.state.turn;
        if (L.isEmpty) L.loadCylinder();
        L.startTurnTick();

        // memory invariants
        const mem = L.aiMem;
        assert(mem.total >= 0 && mem.total <= 6, `aiMem.total out of range: ${mem.total}`);
        assert(mem.live >= 0 && mem.live <= mem.total, `aiMem.live out of range: ${mem.live}/${mem.total}`);
        if (L.countsPublic) {
          assert(
            mem.total === L.totalRemaining && mem.live === L.liveRemaining,
            "while the board is public the AI memory must be exact",
          );
        }

        // sometimes use a skill
        if (Math.random() < 0.35) {
          const pool: SkillId[] = ["peek", "eject", "reroll", "coffee", "cuffs", "voodoo", "thirdEye"];
          const id = pool[Math.floor(Math.random() * pool.length)];
          if (L.canUseSkill(side, id)) {
            const oc = L.useSkill(side, id);
            assert(oc.ok, "canUseSkill passed but useSkill failed");
            if (id === "thirdEye") thirdEyeUses++;
          }
        }

        // AI decision (only meaningful for the enemy side, but call it anyway)
        if (side === "enemy") {
          const d = ai.decide();
          assert(d.kind === "skill" || d.kind === "shoot", "AI decision shape");
        }

        const target = Math.random() < 0.5 ? side : side === "player" ? "enemy" : "player";
        const out = L.shoot(side, target);
        if (out.phoenixSaved) phoenixSaves++;

        // chained shots that the engine would force (voodoo curse)
        if (out.voodooReroll) {
          L.shoot(side, side === "player" ? "enemy" : "player", true);
        }

        // turn bookkeeping
        L.endTurnAndPass();
      }
      assert(guard < 400, "game loop guard tripped (possible infinite game)");
      games++;
    }
  }
  console.log(`fog/memory sim: ${games} games OK, phoenix saves: ${phoenixSaves}, thirdEye uses: ${thirdEyeUses}`);
  assert(phoenixSaves > 0, "phoenix should trigger across 180 games");
}

// 5) Trial charges burn on every successful use
{
  const L = new RouletteLogic("normal");
  L.state.round = 1;
  L.loadCylinder();
  L.grantTrial("player", "peek");
  L.setPhase("playerTurn");
  L.state.turn = "player";
  const oc = L.useSkill("player", "peek");
  assert(oc.ok && L.state.skills.peek.charges === 0, "trial peek burns its charge");
  assert(!L.canUseSkill("player", "peek"), "spent trial is unusable");
  // permanent skills keep working as before
  L.grantSkill("player", "coffee");
  L.state.skills.coffee.charges = 2;
  L.state.hp.player = 2;
  const oc2 = L.useSkill("player", "coffee");
  assert(oc2.ok && L.state.skills.coffee.charges === 1, "permanent coffee still decrements");
  console.log("trial charge burn OK");
}

// 6) AI strength: the smarter brains should beat a random player more often,
//    and they should ACTUALLY use their skills along the way.
{
  function playGame(diff: Difficulty, aiPlaysWell: boolean) {
    const L = new RouletteLogic(diff);
    L.state.round = 1;
    L.loadCylinder();
    L.setPhase("playerTurn");
    // both sides get a couple of random skills so skills actually matter
    for (const id of ["peek", "coffee", "voodoo", "eject", "reroll", "cuffs"] as SkillId[]) {
      if (Math.random() < 0.5) L.grantSkill("enemy", id);
      if (Math.random() < 0.5) L.grantSkill("player", id);
    }
    const ai = new EnemyAI(L, diff === "insane" ? 0.95 : diff === "normal" ? 0.8 : 0.55);
    let aiSkillUses = 0;
    let guard = 0;
    while (L.state.hp.player > 0 && L.state.hp.enemy > 0 && guard++ < 500) {
      if (L.isEmpty) L.loadCylinder();
      L.startTurnTick();
      const side = L.state.turn;
      if (side === "enemy") {
        // mirror the engine loop: up to 3 skills, then shoot
        let used = 0;
        for (;;) {
          if (L.isEmpty || used >= 3) break;
          const d = ai.decide();
          if (d.kind === "skill" && d.skill && L.canUseSkill("enemy", d.skill)) {
            if (L.useSkill("enemy", d.skill).ok) {
              used++;
              aiSkillUses++;
              continue;
            }
          }
          if (d.kind === "shoot" && d.target) {
            const out = L.shoot("enemy", d.target);
            if (out.voodooReroll) L.shoot("enemy", "player", true);
            else if (out.bonusShot && !L.isEmpty) L.shoot("enemy", "player");
            break;
          }
        }
      } else {
        // random player: sometimes skill, coin-flip the target
        const target = Math.random() < 0.5 ? "player" : "enemy";
        const out = L.shoot("player", target as Side);
        if (out.voodooReroll) L.shoot("player", "enemy", true);
        else if (out.bonusShot && !L.isEmpty) L.shoot("player", "enemy");
      }
      L.endTurnAndPass();
    }
    return { enemyWon: L.state.hp.player <= 0, aiSkillUses };
  }

  for (const diff of ["easy", "normal", "insane"] as Difficulty[]) {
    let wins = 0;
    let skillUses = 0;
    const N = 300;
    for (let g = 0; g < N; g++) {
      const r = playGame(diff, true);
      if (r.enemyWon) wins++;
      skillUses += r.aiSkillUses;
    }
    const rate = (wins / N) * 100;
    const perGame = skillUses / N;
    console.log(`AI strength ${diff}: dealer wins ${rate.toFixed(0)}% vs random player, skills/game ${perGame.toFixed(1)}`);
    assert(perGame > 0.4, `${diff} AI should actually use its skills (got ${perGame.toFixed(2)}/game)`);
    if (diff === "insane") assert(rate > 55, `insane dealer should crush a random player (got ${rate.toFixed(0)}%)`);
    if (diff === "normal") assert(rate > 45, `normal dealer should beat a random player (got ${rate.toFixed(0)}%)`);
  }
}

if (failures === 0) {
  console.log("ALL SIM TESTS PASSED");
} else {
  console.error(`${failures} FAILURES`);
  process.exit(1);
}
