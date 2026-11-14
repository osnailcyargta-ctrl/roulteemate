/**
 * roult2-compile-probe.ts — compiles the <code> sections of N corpus
 * examples with the REAL ENGINE C compiler. Zero failures allowed before
 * training starts.
 */
import * as fs from "fs";
import { compileScript } from "../../src/game/script";

const root = "/home/z/my-project";
const N = Number(process.argv[2] ?? 120);

const lines = fs.readFileSync(`${root}/data/roult2/corpus.jsonl`, "utf-8").trim().split("\n");
// vocab jsonl holds token id arrays; decode via vocab.json
const vocab = JSON.parse(fs.readFileSync(`${root}/scripts/roult2/vocab.json`, "utf-8")) as {
  itos: string[];
};

function decode(ids: number[]): string {
  let out = "";
  for (const id of ids) {
    const t = vocab.itos[id];
    out += t === "IND" ? "    " : t;
  }
  return out;
}

let ok = 0;
let fail = 0;
let hooksSeen = new Set<string>();
const fails: string[] = [];
for (let i = 0; i < Math.min(N, lines.length); i++) {
  const ids = JSON.parse(lines[i]) as number[];
  const text = decode(ids);
  const code = text.split("<code>\n")[1]?.split("<end>")[0] ?? "";
  const res = compileScript(code);
  for (const h of res.hooks) hooksSeen.add(h);
  if (res.ok) {
    ok++;
  } else {
    fail++;
    if (fails.length < 5) fails.push(`--- ex ${i} ---\n${code}\n${res.errors.join("\n")}`);
  }
}
console.log(`compiled ok=${ok} fail=${fail}`);
console.log(`hooks used: ${[...hooksSeen].join(", ")}`);
for (const f of fails) console.log(f);
process.exit(fail === 0 ? 0 : 1);
