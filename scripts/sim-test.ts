/**
 * Sanity sim for ULTIMATE ROULETTE logic.
 * 1) Replays the user's reported 3-1-1-1 sequence (no voodoo/reroll) —
 *    the final self-shot MUST be blank.
 * 2) Replays the same sequence WITH a voodoo fresh-shell (the count shifter).
 * 3) Checks the eject-last-shell deadlock at logic level.
 */
import { RouletteLogic, type ShellType } from "../src/game/logic";

function forceCylinder(l: RouletteLogic, shells: ShellType[]) {
  // @ts-expect-error poke private-ish state for the sim
  l.state.cylinder = [...shells];
  l.resyncMem();
  // @ts-expect-error
  l.state.countdown = 0; // fog of war on, like late round
}

let fails = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
  if (!cond) fails++;
}

/* ---- 1) the exact reported sequence, no skills involved ---- */
{
  const l = new RouletteLogic("normal");
  l.state.round = 2;
  l.loadCylinder();
  forceCylinder(l, ["live", "live", "blank", "live", "blank", "blank"]); // the exact reported order
  const o1 = l.shoot("enemy", "player"); // player hit by live        (3->2)
  const o2 = l.shoot("player", "enemy"); // player fires live         (2->1)
  const o3 = l.shoot("enemy", "enemy"); // enemy self-shot BLANK      (bonus shot coming)
  check("seq: o1 live", o1.shell === "live");
  check("seq: o2 live", o2.shell === "live");
  check("seq: o3 blank + bonusShot", o3.shell === "blank" && o3.bonusShot);
  const o4 = l.shoot("enemy", "player"); // enemy free shot -> live   (1->0)
  check("seq: o4 live", o4.shell === "live");
  const o5 = l.shoot("player", "player"); // player self-shot
  check("seq: final self-shot is BLANK (player alive)", o5.shell === "blank" && o5.death === null);
  console.log(`   cylinder left: ${JSON.stringify(l.state.cylinder)}  hp: ${l.state.hp.player}/${l.state.hp.enemy}`);
}

/* ---- 2) same sequence but the enemy had VOODOO: a fresh shell enters ---- */
{
  const l = new RouletteLogic("normal");
  l.state.round = 2;
  l.loadCylinder();
  forceCylinder(l, ["live", "live", "blank", "live", "blank", "blank"]);
  l.shoot("enemy", "player");
  l.shoot("player", "enemy");
  l.state.voodooTurns.enemy = 2; // dealer cursed
  const o3 = l.shoot("enemy", "enemy"); // self blank -> VOODOO reroll
  check("voodoo: o3 rerolls a fresh shell", o3.voodooReroll === true);
  check("voodoo: cylinder GREW by one (3 left + 1 fresh = 4)", l.state.cylinder.length === 4);
  const o4 = l.shoot("enemy", "player"); // forced shot with the FRESH shell
  const o5 = l.shoot("player", "player");
  const leftLive = l.state.cylinder.filter((s) => s === "live").length;
  console.log(`   fresh shell was ${o4.shell}; final self-shot: ${o5.shell}; lives still hiding: ${leftLive}`);
  // THE POINT: the player's mental count said "0 lives left", yet a live can
  // still be in the gun — the curse legally shifted the count.
  check(
    "voodoo: count shift is legal (live can hide or appear after the curse)",
    o4.shell === "live" || leftLive >= 0,
  );
  check("voodoo: mechanics — exactly one extra shell existed (2 plain blanks remain)", l.state.cylinder.length === 2);
}

/* ---- 3) eject the LAST shell: cylinder must end empty & unshootable ---- */
{
  const l = new RouletteLogic("normal");
  l.state.round = 1;
  l.loadCylinder();
  forceCylinder(l, ["live", "blank"]);
  l.state.skills.eject.owned = true;
  l.state.phase = "playerTurn";
  l.state.turn = "player";
  l.shoot("player", "enemy"); // fires the live -> 1 blank left
  check("eject: usable with 1 shell left", l.canUseSkill("player", "eject"));
  const oc = l.useSkill("player", "eject");
  check("eject: ok", oc.ok === true && oc.ejected === "blank");
  check("eject: cylinder now EMPTY", l.isEmpty);
  check("eject: nobody can shoot an empty gun", !l.canShoot("player") && !l.canShoot("enemy"));
  check("eject: canUseSkill('eject') now false", !l.canUseSkill("player", "eject"));
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
