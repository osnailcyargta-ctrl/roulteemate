import { compileScript } from "../src/game/script";

const bad = `DMG = 1

every(round){
    damage(PLAYER, dmg);
}`;

const good = `int DMG = 1;

every(round){
    damage(PLAYER, DMG);
}`;

const r1 = compileScript(bad);
console.log("=== kode lu ===");
if (r1.ok) console.log("OK");
else r1.errors.forEach((e) => console.log("ERR:", e));
console.log("hooks:", r1.hooks);

const r2 = compileScript(good);
console.log("\n=== versi bener ===");
console.log("ok:", r2.ok, "hooks:", r2.hooks, "bytes:", r2.bytes?.length);
if (!r2.ok) r2.errors.forEach((e) => console.log("ERR:", e));
