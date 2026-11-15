/** mid-training probe: 3 generations against a candidate bin */
import * as fs from "fs";
import { compileScript } from "../../src/game/script";
import { parseWeights, RoultSession } from "../../src/game/roult/brain";

const PROMPTS = [
  "vampire mode: when i get shot the dealer heals 2 instead",
  "damage to me starts at 1 and climbs 1 each round, brutal",
  "vampire mode: kalo gw kena tembak dealer malah heal 2",
];

async function main() {
  const buf = fs.readFileSync(process.argv[2] ?? "/tmp/roult-mid.bin");
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const W = parseWeights(ab);
  let ok = 0;
  for (let i = 0; i < PROMPTS.length; i++) {
    const s = new RoultSession(W, 0.8);
    const plan = await s.start(PROMPTS[i], { onPlanLine: () => {} });
    const code = (await s.generateCode({ onThinkLine: () => {}, onCodeChunk: () => {} })).trim();
    const res = compileScript(code);
    if (res.ok) ok++;
    console.log(`--- [${i + 1}] "${PROMPTS[i]}"`);
    console.log(`    plan: ${plan.title} | ${plan.tagline} | room: ${plan.theme}`);
    console.log(`    ${res.ok ? `OK ${res.bytes?.length}B hooks=[${res.hooks}]` : `FAIL ${res.errors.slice(0, 2).join(" | ")}`}`);
    console.log("    " + code.split("\n").join("\n    "));
  }
  console.log(`PROBE: ${ok}/${PROMPTS.length} compiled`);
}
main().catch((e) => { console.error(e); process.exit(1); });
