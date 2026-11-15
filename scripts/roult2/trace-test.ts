/**
 * trace-test.ts — replicates generateDeep with per-token state tracing to
 * hunt the top-level "if" bug.
 */
import * as fs from "fs";
import * as path from "path";
import { parseWeights, RoultBrain, CodeMask, VOCAB, T_END, T_CODE } from "../../src/game/roult/brain";

const ROOT = path.resolve(__dirname, "..", "..");
// @ts-expect-error private member access
const privateAccess = <T, K extends keyof T>(o: T, k: K): T[K] => o[k];

async function main() {
  const buf = fs.readFileSync(path.join(ROOT, "public", "models", "roult.bin"));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const W = parseWeights(ab);
  const intent = "tiap buka toko dapat reroll gratis dan ngintip kena pajak";

  for (let attempt = 0; attempt < 30; attempt++) {
    const brain = new RoultBrain(W, 100 + attempt);
    brain.startIntent(intent);
    const opts = { temperature: 0.8, topK: 24 };
    // plan phase via real API (stop condition)
    for (let i = 0; i < 200; i++) {
      // @ts-expect-error private
      if (!brain.pendingLogits) break;
      // @ts-expect-error private
      const t = brain.sample(opts, null);
      // @ts-expect-error private
      brain.ctx.push(t);
      // @ts-expect-error private
      brain.recent.push(t);
      const s0 = VOCAB.itos[t];
      const isSpecial = [0, 1, 2, 3, 4, 5, 6].indexOf(t) >= 0;
      if (isSpecial) {
        // @ts-expect-error private
        brain.pendingLogits = brain.step(t, true);
        if (t === 4 || t === 5 || t === 3) break;
        continue;
      }
      // @ts-expect-error private
      brain.pendingLogits = brain.step(t, true);
    }
    // deep phase with tracing
    let inCode = false;
    let mask = new CodeMask();
    let out = "";
    let bad = false;
    for (let i = 0; i < 700; i++) {
      // @ts-expect-error private
      if (!brain.pendingLogits) break;
      const masked = inCode ? mask.allowed() : null;
      if (masked && masked.size === 0) {
        console.log(`ATTEMPT ${attempt}: EMPTY MASK state=${JSON.stringify(mask.state)} usedHooks=${JSON.stringify([...mask.usedHooks])} parens=${JSON.stringify(mask.parens)} blocks=${mask.blocks.length}`);
        break;
      }
      // @ts-expect-error private
      const t = brain.sample(opts, masked);
      const s0 = VOCAB.itos[t];
      // @ts-expect-error private
      brain.ctx.push(t);
      // @ts-expect-error private
      brain.recent.push(t);
      // @ts-expect-error private
      if (brain.recent.length > 24) brain.recent.shift();
      if (t === T_END) break;
      if (t === T_CODE) {
        // @ts-expect-error private
        brain.pendingLogits = brain.step(t, true);
        inCode = true;
        mask = new CodeMask();
        continue;
      }
      // @ts-expect-error private
      brain.pendingLogits = brain.step(t, true);
      if (inCode) {
        const stBefore = mask.state;
        const allowedSet = mask.allowed();
        if (!allowedSet.has(t)) {
          console.log(`ATTEMPT ${attempt}: OFF-MASK '${s0}' sampled! state was ${stBefore}`);
          console.log("recent:", JSON.stringify(out.slice(-160)));
          bad = true;
          break;
        }
        mask.step(s0);
        out += s0 === "IND" ? "    " : s0;
        if (stBefore === "top" && (s0 === "if" || s0 === "while")) {
          console.log(`ATTEMPT ${attempt}: TOP-LEVEL '${s0}' — mask allowed it?!`);
          console.log("recent:", JSON.stringify(out.slice(-160)));
          bad = true;
          break;
        }
      }
    }
    if (bad) break;
    console.log(`attempt ${attempt}: clean (${out.length} chars)`);
  }
}
main();
