/** run N generations, dump the full trace of the first failing one */
import * as fs from "fs";
import { parseWeights, RoultSession, CodeMask } from "../../src/game/roult/brain";
import { compileScript } from "../../src/game/script";

const PROMPTS = [
  "damage to me starts at 1 and climbs 1 each round, brutal",
  "vampire mode: when i get shot the dealer heals 2 instead",
  "give the player a regen of 2 every 3 rounds and let the dealer ramble",
];

const log: string[] = [];
const proto = CodeMask.prototype as unknown as { step: (t: string) => void };
const orig = proto.step;
let capture = false;
proto.step = function (t: string) {
  const before = this.state;
  orig.call(this, t);
  if (capture) log.push(`${before === "top" ? "TOP" : before}  "${t === "IND" ? "\\t" : t}"  -> ${this.state}`);
};

async function main() {
  const buf = fs.readFileSync(process.argv[2] ?? "/tmp/roult-mid.bin");
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const W = parseWeights(ab);
  for (let i = 0; i < 6; i++) {
    const session = new RoultSession(W, 0.8);
    const p = PROMPTS[i % PROMPTS.length];
    await session.start(p, { onPlanLine: () => {} });
    log.length = 0;
    capture = true;
    const code = await session.generateCode({ onThinkLine: () => {}, onCodeChunk: () => {} });
    capture = false;
    const res = compileScript(code.trim());
    console.log(`[${i}] ${res.ok ? "OK" : "FAIL " + res.errors.slice(0, 2).join(" | ")}`);
    if (!res.ok) {
      console.log(code);
      console.log("=== trace tail ===");
      console.log(log.slice(-50).join("\n"));
      return;
    }
  }
  console.log("all 6 compiled");
}
main().catch((e) => { console.error(e); process.exit(1); });
