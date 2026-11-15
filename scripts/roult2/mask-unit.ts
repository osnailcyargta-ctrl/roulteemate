/** masker unit test: replay tokens, print allowed sets at key points */
import { CodeMask, VOCAB } from "../../src/game/roult/brain";

const m = new CodeMask();
const feed = (s: string) => {
  for (const tok of s.split(" ")) {
    if (!tok) continue;
    m.step(tok);
  }
  console.log(`state=${m.state} skillFilled=${m.skillStrFilled}`);
};
feed('every ( coin ) { run_skill ( "');
const allowed = m.allowed();
const names = [...allowed].map((id) => String(VOCAB.itos[id]));
console.log("allowed inside string:", names.filter((n) => n.length > 1 || /[a-z]/.test(n)).join(" "));
