/**
 * roult2/node-test.ts — runs REAL generation through the REAL session API
 * (the exact path the browser uses) and compiles every output with the REAL
 * ENGINE C compiler. Bilingual battery: ID + EN prompts must both produce
 * compilable scripts AND answer in the matching language.
 * Usage: npx tsx scripts/roult2/node-test.ts [nTests]
 */
import * as fs from "fs";
import * as path from "path";
import { compileScript } from "../../src/game/script";
import { parseWeights, RoultSession } from "../../src/game/roult/brain";

const ROOT = path.resolve(__dirname, "..", "..");

const PROMPTS: { text: string; lang: "id" | "en" }[] = [
  { text: "vampire mode: kalo gw kena tembak dealer malah heal 2", lang: "id" },
  { text: "vampire mode: when i get shot the dealer heals 2 instead", lang: "en" },
  { text: "damage ke gw mulai 1 naik 1 tiap ronde, brutal", lang: "id" },
  { text: "damage to me starts at 1 and climbs 1 each round, brutal", lang: "en" },
  { text: "kasih regen 2 tiap 3 ronde buat player + dealer ikut ngoceh", lang: "id" },
  { text: "give the player a regen of 2 every 3 rounds and let the dealer ramble", lang: "en" },
  { text: "peluru diacak tiap giliran, chance 40 persen", lang: "id" },
  { text: "the shells get scrambled every turn, 40 percent chance", lang: "en" },
  { text: "koin miring ke kita 60 persen pas gamble, lebih brutal", lang: "id" },
  { text: "the coin leans toward us 60 percent on gamble, more brutal", lang: "en" },
  { text: "kalo darah dealer tinggal dikit dia ngamuk: damage 3 balik", lang: "id" },
  { text: "when the dealer is almost dead he rages back with 3 damage", lang: "en" },
];

/** crude language check: ID plan markers vs EN plan markers */
function planLooksLang(planTitle: string, bullets: string[], lang: "id" | "en"): boolean {
  const joined = (planTitle + " " + bullets.join(" ")).toLowerCase();
  if (lang === "en") {
    return /\b(the|every|player|dealer|round|hook|each|turn|heals|damage)\b/.test(joined) && !/\b(tiap|ronde|ke |yang|dengan|kena|pajak|gratis)\b/.test(joined);
  }
  return /\b(tiap|ronde|kena|peluru|dealer|player|pajak|gratis|dapat)\b/.test(joined) || /[a-z]+in\b/.test(joined);
}

async function main() {
  const nTests = Number(process.argv[2] ?? 6);
  const binArg = process.argv[3];
  const binPath = binArg ?? path.join(ROOT, "public", "models", "roult.bin");
  const buf = fs.readFileSync(binPath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const t0 = Date.now();
  const W = parseWeights(ab);
  const probe = new RoultSession(W, 0.8);
  const info = probe.brain.info();
  console.log(
    `weights: ${(buf.length / 1e6).toFixed(1)} MB loaded in ${Date.now() - t0}ms  V=${W.header.V} D=${W.header.D} L=${W.header.L} MAXT=${W.header.MAXT} params=${info.params.toLocaleString("en-US")}`,
  );

  let okCount = 0;
  let langCount = 0;
  for (let i = 0; i < nTests; i++) {
    const p = PROMPTS[i % PROMPTS.length];
    const intent = p.text;
    const session = new RoultSession(W, Number(process.argv[4] ?? 0.8));
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
    const langOk = planLooksLang(plan.title, plan.bullets, p.lang);
    if (langOk) langCount++;
    console.log(`\n=== TEST ${i + 1} [${p.lang.toUpperCase()}] (expect ${p.lang}): "${intent}"`);
    console.log(`  plan: "${plan.title}" | ${plan.tagline}  -> language ${langOk ? "MATCH" : "MISMATCH"}`);
    for (const b of plan.bullets) console.log(`   - ${b}`);
    for (const l of thinkLines.slice(0, 2)) console.log(`   think: ${l}`);
    console.log(
      res.ok
        ? `  COMPILED OK (${res.bytes?.length} bytes) hooks=[${res.hooks.join(", ")}]`
        : `  COMPILE FAIL: ${res.errors.slice(0, 2).join(" | ")}`,
    );
    console.log("  " + trimmed.split("\n").join("\n  "));
  }
  console.log(`\nRESULT: ${okCount}/${nTests} scripts compiled OK · ${langCount}/${nTests} plans matched the prompt language`);
  if (okCount < Math.ceil(nTests * 0.7)) {
    console.log("QUALITY GATE FAILED — keep training");
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
