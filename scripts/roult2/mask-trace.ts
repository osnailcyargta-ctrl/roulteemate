/** patch CodeMask.prototype globally to catch every mask instance */
import * as fs from "fs";
import { parseWeights, RoultSession, VOCAB, CodeMask } from "../../src/game/roult/brain";
import { compileScript } from "../../src/game/script";

const log: string[] = [];
const proto = CodeMask.prototype as unknown as { step: (t: string) => void };
const orig = proto.step;
let capture = false;
proto.step = function (t: string) {
  const before = this.state;
  orig.call(this, t);
  if (capture) log.push(`${before === "top" ? "TOP" : before}  "${t === "IND" ? "\\t" : t}"  -> ${this.state}  used=${this.usedHooks.size}`);
};

async function main() {
  const buf = fs.readFileSync(process.argv[2] ?? "/tmp/roult-mid.bin");
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const W = parseWeights(ab);
  const session = new RoultSession(W, 0.8);
  await session.start("damage to me starts at 1 and climbs 1 each round, brutal", { onPlanLine: () => {} });
  log.length = 0;
  capture = true;
  const code = await session.generateCode({ onThinkLine: () => {}, onCodeChunk: () => {} });
  capture = false;
  const res = compileScript(code.trim());
  console.log("compile:", res.ok ? `OK ${res.bytes?.length}B` : res.errors.slice(0, 3).join(" | "));
  // show only the tail where the NL storm lives
  const stormIdx = log.findIndex((l) => l.includes("wantHook  \"\\n\"") || l.includes("wantHook  \"\n\""));
  console.log("storm at:", stormIdx);
  console.log(log.slice(Math.max(0, log.length - 40)).join("\n"));
}
main().catch((e) => { console.error(e); process.exit(1); });
