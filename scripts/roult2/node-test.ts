/**
 * roult2/node-test.ts — runs REAL generation through the REAL session API
 * (the exact path the browser uses) and compiles every output with the REAL
 * ENGINE C compiler. Usage: npx tsx scripts/roult2/node-test.ts [nTests]
 */
import * as fs from "fs";
import * as path from "path";
import { compileScript } from "../../src/game/script";
import { parseWeights, RoultSession } from "../../src/game/roult/brain";

const ROOT = path.resolve(__dirname, "..", "..");

const PROMPTS = [
  "vampire mode: kalo gw kena tembak dealer malah heal 2",
  "damage ke gw mulai 1 naik 1 tiap ronde, brutal",
  "kasih regen 2 tiap 3 ronde buat player + dealer ikut ngoceh",
  "peluru diacak tiap giliran, chance 40 persen",
  "tiap buka toko dapat reroll gratis dan ngintip kena pajak",
  "koin miring ke kita 60 persen pas gamble, lebih brutal",
  "gw heal tiap berhasil nembak dealer, lifesteal tipis aja",
  "pas darah dealer mepet dia ngamuk: damage 3 balik",
  "mode vampir bang, dealer nyedot tiap peluru yang ngena gw",
  "eskalanon damage: ronde makin tua peluru makin kenceng",
];

async function main() {
  const nTests = Number(process.argv[2] ?? 6);
  const binPath = path.join(ROOT, "public", "models", "roult.bin");
  const buf = fs.readFileSync(binPath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const t0 = Date.now();
  const W = parseWeights(ab);
  console.log(
    `weights: ${(buf.length / 1e6).toFixed(1)} MB loaded in ${Date.now() - t0}ms  V=${W.header.V} D=${W.header.D} L=${W.header.L} MAXT=${W.header.MAXT}`,
  );

  let okCount = 0;
  for (let i = 0; i < nTests; i++) {
    const intent = PROMPTS[i % PROMPTS.length];
    const session = new RoultSession(W, 0.8);
    const planLines: string[] = [];
    const thinkLines: string[] = [];
    const plan = await session.start(intent, { onPlanLine: (l) => planLines.push(l) });
    const code = await session.generateCode({
      onThinkLine: (l) => thinkLines.push(l),
      onCodeChunk: () => {},
    });
    const trimmed = code.trim();
    const res = compileScript(trimmed);
    if (res.ok) okCount++;
    console.log(`\n=== TEST ${i + 1}: "${intent}"`);
    console.log(`  plan: "${plan.title}" | ${plan.tagline}`);
    for (const b of plan.bullets) console.log(`   - ${b}`);
    for (const l of thinkLines.slice(0, 3)) console.log(`   think: ${l}`);
    console.log(
      res.ok
        ? `  COMPILED OK (${res.bytes?.length} bytes) hooks=[${res.hooks.join(", ")}]`
        : `  COMPILE FAIL: ${res.errors.slice(0, 2).join(" | ")}`,
    );
    console.log("  " + trimmed.split("\n").join("\n  "));
  }
  console.log(`\nRESULT: ${okCount}/${nTests} scripts compiled OK`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
