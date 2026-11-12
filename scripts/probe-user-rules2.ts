import { compileScript, ScriptRuntime } from "../src/game/script";

async function run(label: string, src: string, rounds: number) {
  const c = compileScript(src);
  console.log(`=== ${label} ===`);
  if (!c.ok) { c.errors.forEach((e) => console.log("ERR:", e)); return; }
  const calls: string[] = [];
  const rt = await ScriptRuntime.instantiate(c.bytes!, {
    runSkill: () => {},
    heal: (side, n) => calls.push(`heal(${side},${n})`),
    damage: (side, n) => calls.push(`damage(${side},${n})`),
    say: (m) => calls.push(`say("${m}")`),
    stateRef: () => ({ hp: () => 10, score: () => 0, round: () => 0 }),
  });
  for (let i = 0; i < rounds; i++) rt.fire("round", {});
  console.log("calls:", calls.join("  ") || "(kosong)");
}

const user = `int dmg = 1;

every(round){
    dmg + 1;
}

every(round){
    damage(PLAYER, dmg);
}`;

const fixed = `int dmg = 1;

every(round){
    dmg += 1;
    damage(PLAYER, dmg);
}`;

(async () => {
  await run("kode lu (3 round)", user, 3);
  await run("fix += (3 round)", fixed, 3);
})();
