/**
 * roult/brain.ts — the ROULT v2 inference engine. A real ~20M parameter
 * pre-LN transformer (trained FROM SCRATCH, see scripts/roult2/) that runs
 * 100% locally. No API keys, no network. Bilingual: EN intents get EN
 * plans/thinks, ID intents get ID plans/thinks — the language follows the
 * user automatically.
 *
 * Stream (all autoregressive, one model):
 *   <intent> user text <plan> ...plan... [<revise> text <plan> ...]*
 *   <think> ...reasoning... <code> ...roulteematescript... <end>
 *
 * Inside <code> a token-level grammar masker (state machine mirroring the
 * ENGINE C parser in src/game/script.ts) guarantees the output compiles
 * with the REAL compiler — declared vars, valid hooks, exact builtin
 * argument counts, constant global initializers, valid skill ids.
 */

import vocabJson from "./vocab.json";

export const ROULT_BIN = "/models/roult.bin";

const SPECIALS = ["<pad>", "<intent>", "<plan>", "<revise>", "<think>", "<code>", "<end>"];
export const T_PAD = 0;
export const T_INTENT = 1;
export const T_PLAN = 2;
export const T_REVISE = 3;
export const T_THINK = 4;
export const T_CODE = 5;
export const T_END = 6;

export interface Vocab {
  itos: string[];
  tags: Record<string, string>;
  stoi: Map<string, number>;
}

function buildVocab(): Vocab {
  const raw = vocabJson as unknown as { itos: string[]; tags: Record<string, string> };
  const stoi = new Map<string, number>();
  raw.itos.forEach((t, i) => stoi.set(t, i));
  return { itos: raw.itos, tags: raw.tags, stoi };
}

export const VOCAB: Vocab = buildVocab();

/* ------------------------------------------------------------------ */
/* tokenizer — byte-identical with scripts/roult2/spec.py             */
/* ------------------------------------------------------------------ */

const REGEX_STR =
  "(<intent>|<plan>|<revise>|<think>|<code>|<end>)" +
  "|(//[^\\n]*)" +
  "|(#[^\\n]*)" +
  '|("[^"\\n]*")' +
  "|([0-9]+(?:\\.[0-9]+)?)" +
  "|([A-Za-z_][A-Za-z0-9_]*)" +
  "|(==|!=|<=|>=|\\+=|-=|&&|\\|\\|)" +
  "|([(){};,+\\-*/%<>!=.:?|])" +
  "|(\\n[ ]*)" +
  "|( +)";
const RE = new RegExp(REGEX_STR, "g");

const CODE_TAGS = new Set(["keyword", "builtin", "hook", "const", "ident"]);

function isCodeWord(w0: string): boolean {
  return CODE_TAGS.has(VOCAB.tags[w0] ?? "");
}

function tok(s: string): number | null {
  return VOCAB.stoi.get(s) ?? null;
}

function pushWordOrChars(out: number[], word: string) {
  const id = VOCAB.stoi.get(word);
  if (id !== undefined) {
    out.push(id);
    return;
  }
  for (const ch of word) {
    const c = VOCAB.stoi.get(ch);
    out.push(c !== undefined ? c : VOCAB.stoi.get("<unk>")!);
  }
}

interface Match {
  kind: "special" | "comment" | "str" | "num" | "word" | "punct" | "nl" | "sp";
  value: string;
}

function pretokenize(text: string): Match[] {
  const out: Match[] = [];
  RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(text)) !== null) {
    const [full, special, c1, c2, str, num, word, p2, p1, nl, sp] = m;
    if (special !== undefined) out.push({ kind: "special", value: special });
    else if (c1 !== undefined || c2 !== undefined) out.push({ kind: "comment", value: c1 ?? c2 ?? "" });
    else if (str !== undefined) out.push({ kind: "str", value: str });
    else if (num !== undefined) out.push({ kind: "num", value: num });
    else if (word !== undefined) out.push({ kind: "word", value: word });
    else if (p2 !== undefined) out.push({ kind: "punct", value: p2 });
    else if (p1 !== undefined) out.push({ kind: "punct", value: p1 });
    else if (nl !== undefined) out.push({ kind: "nl", value: nl });
    else if (sp !== undefined) out.push({ kind: "sp", value: sp });
    else if (full.length === 0) RE.lastIndex++;
  }
  return out;
}

function pushProse(out: number[], inner: string) {
  for (const mt of pretokenize(inner)) {
    if (mt.kind === "word") pushWordOrChars(out, mt.value.toLowerCase());
    else if (mt.kind === "num") {
      for (const ch of mt.value) {
        if (ch >= "0" && ch <= "9") out.push(VOCAB.stoi.get(ch)!);
        else out.push(VOCAB.stoi.get(".")!);
      }
    } else if (mt.kind === "sp") out.push(VOCAB.stoi.get(" ")!);
    else if (mt.kind === "punct") out.push(VOCAB.stoi.get(mt.value)!);
  }
}

export function encodeText(text: string): number[] {
  const out: number[] = [];
  for (const mt of pretokenize(text)) {
    if (mt.kind === "special") {
      out.push(VOCAB.stoi.get(mt.value)!);
    } else if (mt.kind === "comment") {
      const marker = mt.value.startsWith("//") ? "//" : "#";
      out.push(VOCAB.stoi.get(marker)!);
      out.push(VOCAB.stoi.get(" ")!);
      pushProse(out, mt.value.slice(marker.length));
      out.push(VOCAB.stoi.get("\n")!);
    } else if (mt.kind === "str") {
      out.push(VOCAB.stoi.get('"')!);
      pushProse(out, mt.value.slice(1, -1));
      out.push(VOCAB.stoi.get('"')!);
    } else if (mt.kind === "num") {
      for (const ch of mt.value) {
        if (ch >= "0" && ch <= "9") out.push(VOCAB.stoi.get(ch)!);
        else out.push(VOCAB.stoi.get(".")!);
      }
    } else if (mt.kind === "word") {
      pushWordOrChars(out, isCodeWord(mt.value) ? mt.value : mt.value.toLowerCase());
    } else if (mt.kind === "punct") {
      out.push(VOCAB.stoi.get(mt.value)!);
    } else if (mt.kind === "nl") {
      const lead = mt.value.length - 1;
      out.push(VOCAB.stoi.get("\n")!);
      const ti = VOCAB.stoi.get("IND")!;
      for (let i = 0; i < Math.floor(lead / 4); i++) out.push(ti);
    } else if (mt.kind === "sp") {
      out.push(VOCAB.stoi.get(" ")!);
    }
  }
  return out;
}

export function decodeTokens(ids: number[]): string {
  let out = "";
  for (const id of ids) {
    const s = VOCAB.itos[id] ?? "";
    out += s === "IND" ? "    " : s === "<unk>" ? "?" : s;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* weights                                                            */
/* ------------------------------------------------------------------ */

interface Tensor {
  name: string;
  fp32: Float32Array;
}

export interface ModelHeader {
  V: number;
  D: number;
  L: number;
  H: number;
  DFF: number;
  MAXT: number;
}

export interface RoultWeights {
  header: ModelHeader;
  tensors: Map<string, Tensor>;
}

export function parseWeights(buf: ArrayBuffer): RoultWeights {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== "RLT2") throw new Error("roult.bin: bad magic");
  let off = 4;
  const ver = dv.getUint32(off, true); off += 4;
  if (ver !== 1) throw new Error("roult.bin: bad version " + ver);
  const V = dv.getUint32(off, true); off += 4;
  const D = dv.getUint32(off, true); off += 4;
  const L = dv.getUint32(off, true); off += 4;
  const H = dv.getUint32(off, true); off += 4;
  const DFF = dv.getUint32(off, true); off += 4;
  const MAXT = dv.getUint32(off, true); off += 4;
  const nT = dv.getUint32(off, true); off += 4;
  const tensors = new Map<string, Tensor>();
  for (let i = 0; i < nT; i++) {
    const nameLen = u8[off]; off += 1;
    const name = new TextDecoder().decode(u8.subarray(off, off + nameLen)); off += nameLen;
    const kind = u8[off]; off += 1;
    const ndim = dv.getUint32(off, true); off += 4;
    const dims: number[] = [];
    let size = 1;
    for (let d = 0; d < ndim; d++) {
      const dd = dv.getUint32(off, true); off += 4;
      dims.push(dd);
      size *= dd;
    }
    if (kind === 0) {
      tensors.set(name, { name, fp32: new Float32Array(buf.slice(off, off + size * 4)) });
      off += size * 4;
    } else {
      const rows = dims[0];
      const cols = dims[1];
      const scales = new Float32Array(buf.slice(off, off + rows * 4));
      off += rows * 4;
      const q = new Int8Array(buf.slice(off, off + rows * cols));
      off += rows * cols;
      const fp32 = new Float32Array(rows * cols);
      for (let r = 0; r < rows; r++) {
        const s = scales[r];
        const base = r * cols;
        for (let c = 0; c < cols; c++) fp32[base + c] = q[base + c] * s;
      }
      tensors.set(name, { name, fp32 });
    }
  }
  return { header: { V, D, L, H, DFF, MAXT }, tensors };
}

let weightsSingleton: Promise<RoultWeights> | null = null;
let binBytes = 0;

/** size of roult.bin in MB — used by the UI to flex the local weights */
export function binMB(): number {
  return Math.round((binBytes / 1e6) * 10) / 10;
}

export function loadWeights(): Promise<RoultWeights> {
  if (!weightsSingleton) {
    weightsSingleton = (async () => {
      const base =
        typeof window !== "undefined" && window.location.pathname.startsWith("/roulteemate")
          ? "/roulteemate"
          : "";
      const res = await fetch(base + ROULT_BIN);
      if (!res.ok) throw new Error("roult.bin fetch failed: " + res.status);
      const buf = await res.arrayBuffer();
      binBytes = buf.byteLength;
      return parseWeights(buf);
    })();
  }
  return weightsSingleton;
}

/* ------------------------------------------------------------------ */
/* grammar facts (mirror script.ts)                                   */
/* ------------------------------------------------------------------ */

const VOID_CALLS = new Set(["heal", "damage", "run_skill", "say", "shuffle", "theme", "set_dmg_next", "set_coin"]);
const CALL_ARGS: Record<string, number> = {
  heal: 2, damage: 2, run_skill: 2, say: 1, hp: 1, score: 0, round: 0,
  rand: 1, last_skill: 0, chance: 1, shuffle: 0, theme: 1, set_dmg_next: 1, set_coin: 1,
};
const VALUE_CALLS = ["hp", "score", "round", "rand", "last_skill", "chance"];
const COMPARISONS = ["==", "!=", "<", "<=", ">", ">="];
const SKILL_WORDS = ["reroll", "voodoo", "peek", "eject", "coffee", "cuffs", "phoenix", "thirdEye"];

/* ------------------------------------------------------------------ */
/* grammar masker — token-level ENGINE C state machine                */
/* ------------------------------------------------------------------ */

type Frame =
  | { kind: "group" }
  | { kind: "ctrl"; kw: string }
  | { kind: "call"; name: string; arg: number };

export class CodeMask {
  state:
    | "top" | "wantIdent" | "wantEqOrSemi" | "stmt" | "stmtIdent"
    | "exprStart" | "exprCont" | "wantParen" | "wantHook" | "wantClose"
    | "postCtrlParen" | "stringOpen" | "comment" | "postVoid" = "top";
  blocks: { isLoop: boolean; isIf: boolean }[] = [];
  parens: Frame[] = [];
  globals = new Set<string>();
  locals = new Set<string>();
  seenEvery = false;
  lastIdent = "";
  stringMode: "say" | "skill" = "say";
  /** has the run_skill("...") string collected a skill id yet? */
  skillStrFilled = false;
  commentPrev: CodeMask["state"] = "top";
  inGlobalInit = false;
  localDecl = false;
  lastWasDigit = false;
  lastWasDot = false;
  lastWasSp = false;
  usedHooks = new Set<string>();
  stmtSeen = false;

  private addTag(S: Set<number>, tags: string[]) {
    for (const [w0, tag] of Object.entries(VOCAB.tags)) {
      if (tags.indexOf(tag) >= 0) {
        const id = VOCAB.stoi.get(w0);
        if (id !== undefined) S.add(id);
      }
    }
  }
  private addWord(S: Set<number>, w0: string) {
    const id = VOCAB.stoi.get(w0);
    if (id !== undefined) S.add(id);
  }

  /** SP is legal anywhere except right after another SP (loop guard) */
  private addSp(S: Set<number>) {
    if (!this.lastWasSp) S.add(VOCAB.stoi.get(" ")!);
  }

  allowed(): Set<number> {
    const S = new Set<number>();
    const NL = VOCAB.stoi.get("\n")!;
    const IND = VOCAB.stoi.get("IND")!;
    const st = this.state;

    if (st === "comment") {
      this.addTag(S, ["word", "char", "digit", "punct"]);
      S.add(VOCAB.stoi.get(" ")!);
      S.add(NL);
      return S;
    }
    if (st === "stringOpen") {
      if (this.stringMode === "skill") {
        // corpus-exact: a run_skill("...") string is exactly ONE skill word —
        // before it: only skill words; after it: ONLY the closing quote
        if (!this.skillStrFilled) {
          for (const s of SKILL_WORDS) this.addWord(S, s);
          return S;
        }
        S.add(VOCAB.stoi.get('"')!);
        return S;
      } else {
        this.addTag(S, ["word", "char"]);
        S.add(VOCAB.stoi.get(" ")!);
        for (const bad of ["\n", "IND", '"', "(", ")", "{", "}", ";", ",", "%", "+", "-", "*", "/", "<", ">", "=", "!", "."]) {
          const id = VOCAB.stoi.get(bad);
          if (id !== undefined) S.delete(id);
        }
        S.add(VOCAB.stoi.get('"')!);
      }
      return S;
    }

    this.addSp(S);
    if (st === "top") {
      this.addWord(S, "int");
      this.addWord(S, "float");
      this.addWord(S, "every");
      S.add(NL);
      this.addWord(S, "#");
      this.addWord(S, "//");
      if (this.seenEvery && this.parens.length === 0) S.add(T_END);
    } else if (st === "wantIdent") {
      for (const [w0, tag] of Object.entries(VOCAB.tags)) {
        if (tag === "ident" && !this.globals.has(w0) && !this.locals.has(w0)) this.addWord(S, w0);
      }
    } else if (st === "wantEqOrSemi") {
      this.addWord(S, "=");
      this.addWord(S, ";");
    } else if (st === "wantParen") {
      this.addWord(S, "(");
    } else if (st === "wantHook") {
      this.addTag(S, ["hook"]);
      if (this.usedHooks.size < 9) {
        for (const h of this.usedHooks) S.delete(VOCAB.stoi.get(h)!);
      }
    } else if (st === "wantClose") {
      this.addWord(S, ")");
    } else if (st === "postCtrlParen") {
      this.addWord(S, "{");
    } else if (st === "postVoid") {
      // a void call has no value: only ; ends the statement
      this.addWord(S, ";");
    } else if (st === "stmt") {
      this.addWord(S, "int");
      this.addWord(S, "float");
      this.addWord(S, "if");
      this.addWord(S, "while");
      this.addWord(S, "repeat");
      if (this.blocks.some((b) => b.isLoop)) this.addWord(S, "break");
      if (this.blocks.length > 0 && this.stmtSeen) this.addWord(S, "}");
      for (const w0 of this.globals) this.addWord(S, w0);
      for (const w0 of this.locals) this.addWord(S, w0);
      this.addTag(S, ["builtin"]);
      S.add(NL);
      S.add(IND);
      this.addWord(S, "#");
      this.addWord(S, "//");
    } else if (st === "stmtIdent") {
      this.addWord(S, "(");
      if (!VOID_CALLS.has(this.lastIdent)) {
        this.addWord(S, "=");
        this.addWord(S, "+=");
        this.addWord(S, "-=");
      }
    } else if (st === "exprStart" || st === "wantCallParen") {
      if (st === "wantCallParen") {
        // a builtin name must be followed by its call parens
        this.addWord(S, "(");
        return S;
      }
      if (this.inGlobalInit) {
        // corpus-exact: a global initializer is a plain numeric constant
        this.addTag(S, ["digit"]);
        S.add(VOCAB.stoi.get(".")!);
        this.addSp(S);
        return S;
      }
      const inner = this.parens[this.parens.length - 1];
      if (inner && inner.kind === "call") {
        // operand type dictated by the call signature (corpus-exact)
        const sideArgs: Record<string, number[]> = { heal: [0], damage: [0], hp: [0], run_skill: [1] };
        if (inner.name === "say" || (inner.name === "run_skill" && inner.arg === 0)) {
          S.add(VOCAB.stoi.get('"')!);
          return S;
        }
        if (sideArgs[inner.name] && sideArgs[inner.name].indexOf(inner.arg) >= 0) {
          this.addWord(S, "PLAYER");
          this.addWord(S, "DEALER");
          return S;
        }
        // numeric amount (constants may also be written as variables)
        this.addTag(S, ["digit"]);
        if (!this.inGlobalInit) {
          for (const w0 of this.globals) this.addWord(S, w0);
          for (const w0 of this.locals) this.addWord(S, w0);
        }
        return S;
      }
      this.addTag(S, ["digit"]);
      S.add(VOCAB.stoi.get(".")!);
      this.addTag(S, ["const"]);
      for (const w0 of this.globals) this.addWord(S, w0);
      for (const w0 of this.locals) this.addWord(S, w0);
      this.addTag(S, ["builtin"]);
    } else if (st === "exprCont") {
      const topHere = this.parens[this.parens.length - 1];
      const inCall = topHere !== undefined && topHere.kind === "call";
      // comparisons only exist in conditions — never inside call args
      if (!inCall) for (const op of COMPARISONS) this.addWord(S, op);
      if (this.lastWasDigit) {
        this.addTag(S, ["digit"]);
        S.add(VOCAB.stoi.get(".")!);
      }
      if (this.lastWasDot) this.addTag(S, ["digit"]);
      const top = this.parens[this.parens.length - 1];
      if (top && top.kind === "ctrl") {
        // condition context: comparisons then close
        S.add(VOCAB.stoi.get(")")!);
      } else if (top && top.kind === "call") {
        // inside call args: corpus never compares or nests — just , or )
        const need = CALL_ARGS[top.name];
        if (top.arg >= need - 1) S.add(VOCAB.stoi.get(")")!);
        else S.add(VOCAB.stoi.get(",")!);
      } else {
        // statement-level operand: only ; ends it
        S.add(VOCAB.stoi.get(";")!);
        for (const op of COMPARISONS) S.delete(VOCAB.stoi.get(op)!);
      }
      if (this.inGlobalInit) {
        // global initializer must stay a constant literal — hard minimal set
        // (a dot only continues a float literal, never "....")
        S.clear();
        this.addTag(S, ["digit"]);
        if (!this.lastWasDot) S.add(VOCAB.stoi.get(".")!);
        S.add(VOCAB.stoi.get(";")!);
        this.addSp(S);
      }
    }
    return S;
  }

  /** one shared "( opened after name" path — sets the string mode for
   *  say/run_skill no matter WHICH branch opened the call parens */
  private enterCall(name: string) {
    this.parens.push({ kind: "call", name, arg: (CALL_ARGS[name] ?? 0) === 0 ? -1 : 0 });
    this.stringMode = name === "run_skill" ? "skill" : "say";
    if (name === "run_skill") this.skillStrFilled = false;
  }

  step(t: string) {
    this.lastWasDigit = t >= "0" && t <= "9" && t.length === 1;
    this.lastWasDot = t === ".";
    if (t === " " || t === "IND") {
      this.lastWasSp = t === " ";
      return; // pure formatting: no state change
    }
    this.lastWasSp = false;
    const st = this.state;

    if (st === "comment") {
      if (t === "\n") this.state = this.commentPrev;
      return;
    }
    if (st === "stringOpen") {
      if (t === '"') {
        this.state = "exprCont";
      } else if (this.stringMode === "skill") {
        this.skillStrFilled = true;
      }
      return;
    }
    if (t === "\n") {
      // newlines are formatting everywhere outside strings
      if (st === "top" || st === "stmt") return;
      return;
    }

    switch (st) {
      case "top":
        if (t === "int" || t === "float") {
          this.state = "wantIdent";
          this.inGlobalInit = true;
          this.localDecl = false;
        } else if (t === "every") {
          this.state = "wantParen";
          this._sawEveryKw = true;
        } else if (t === "#") {
          this.commentPrev = "top";
          this.state = "comment";
        }
        return;
      case "wantIdent":
        this.lastIdent = t;
        this.state = "wantEqOrSemi";
        return;
      case "wantEqOrSemi":
        if (t === "=") this.state = "exprStart";
        else if (t === ";") {
          if (this.localDecl) this.locals.add(this.lastIdent);
          else this.globals.add(this.lastIdent);
          this.inGlobalInit = false;
          this.localDecl = false;
          this.state = "top";
        }
        return;
      case "wantParen":
        if (t === "(") {
          if (this._sawEveryKw) {
            this._sawEveryKw = false;
            this.state = "wantHook";
          } else {
            this.state = "exprStart";
          }
        }
        return;
      case "wantHook":
        this.usedHooks.add(t);
        this.state = "wantClose";
        return;
      case "wantClose":
        if (t === ")") this.state = "postCtrlParen";
        return;
      case "postCtrlParen":
        if (t === "{") {
          this.stmtSeen = false;
          this.blocks.push({ isLoop: this._pendingLoop, isIf: this._pendingIf });
          this._pendingLoop = false;
          this._pendingIf = false;
          if (this._sawEveryKw) {
            this.seenEvery = true;
            this._sawEveryKw = false;
          }
          this.locals.clear();
          this.state = "stmt";
        }
        return;
      case "stmt":
        if (t !== "}" && t !== "\n" && t !== " " && t !== "IND" && t !== "#" && t !== "//") this.stmtSeen = true;
        if (t === "}") {
          const popped = this.blocks.pop();
          this.locals.clear();
          if (this.blocks.length === 0) this.state = "top";
          else this.state = "stmt";
          void popped;
          return;
        }
        if (t === "int" || t === "float") {
          this.state = "wantIdent";
          this.inGlobalInit = false;
          this.localDecl = true;
          return;
        }
        if (t === "if" || t === "while" || t === "repeat") {
          this.parens.push({ kind: "ctrl", kw: t });
          this._pendingLoop = t !== "if";
          this._pendingIf = t === "if";
          this.state = "wantParen";
          return;
        }
        if (t === "break") {
          this.state = "exprCont";
          return;
        }
        this.lastIdent = t;
        this.state = "stmtIdent";
        return;
      case "stmtIdent":
        if (t === "(") {
          this.enterCall(this.lastIdent);
          if (this.lastIdent === "say" || this.lastIdent === "run_skill") this.state = "exprStart";
          else this.state = (CALL_ARGS[this.lastIdent] ?? 0) === 0 ? "exprCont" : "exprStart";
          return;
        }
        this.state = "exprStart"; // assignment RHS
        return;
      case "exprStart": {
        if (t === '"') {
          this.state = "stringOpen";
          return;
        }
        if ((VOCAB.tags[t] ?? "") === "builtin") {
          this.lastIdent = t;
          this.state = "wantCallParen";
          return;
        }
        this.state = "exprCont";
        return;
      }
      case "wantCallParen":
        if (t === "(") {
          this.enterCall(this.lastIdent);
          this.state = (CALL_ARGS[this.lastIdent] ?? 0) === 0 ? "exprCont" : "exprStart";
        }
        return;
      case "postVoid":
        if (t === ";") this.state = "stmt";
        return;
      case "exprCont": {
        if (COMPARISONS.indexOf(t) >= 0) {
          this.state = "exprStart";
          return;
        }
        if (t === "(") {
          this.enterCall(this.lastIdent);
          this.state = (CALL_ARGS[this.lastIdent] ?? 0) === 0 ? "exprCont" : "exprStart";
          return;
        }
        if (t === ",") {
          const top = this.parens[this.parens.length - 1];
          if (top && top.kind === "call") top.arg++;
          this.state = "exprStart";
          return;
        }
        if (t === ")") {
          const popped = this.parens.pop();
          this.lastIdent = "";
          if (popped && popped.kind === "ctrl") this.state = "postCtrlParen";
          else if (popped && popped.kind === "call" && VOID_CALLS.has(popped.name)) this.state = "postVoid";
          else this.state = "exprCont";
          return;
        }
        if (t === ";") {
          // a global initializer's ';' closes the DECLARATION — back to top;
          // a normal statement's ';' just ends the line inside the block
          if (this.localDecl) this.locals.add(this.lastIdent); // "int x = 1;" form
          this.state = this.inGlobalInit ? "top" : "stmt";
          this.inGlobalInit = false;
          this.localDecl = false;
          return;
        }
        return;
      }
    }
  }

  _pendingEvery = false;
  _pendingIf = false;
  _pendingLoop = false;
  _sawEveryKw = false;
}

/* ------------------------------------------------------------------ */
/* sampling                                                           */
/* ------------------------------------------------------------------ */

export interface SampleOpts {
  temperature: number;
  topK: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* the brain                                                          */
/* ------------------------------------------------------------------ */

interface LayerWeights {
  ln1w: Float32Array; ln1b: Float32Array;
  qkv: Float32Array; qkvb: Float32Array;
  ow: Float32Array; ob: Float32Array;
  ln2w: Float32Array; ln2b: Float32Array;
  w1: Float32Array; w1b: Float32Array;
  w2: Float32Array; w2b: Float32Array;
}

function ln(x: Float32Array, w: Float32Array, b: Float32Array, d: number, out: Float32Array) {
  let mu = 0;
  for (let i = 0; i < d; i++) mu += x[i];
  mu /= d;
  let varr = 0;
  for (let i = 0; i < d; i++) {
    const c = x[i] - mu;
    varr += c * c;
  }
  varr /= d;
  const inv = 1 / Math.sqrt(varr + 1e-5);
  for (let i = 0; i < d; i++) out[i] = (x[i] - mu) * inv * w[i] + b[i];
}

function matvec(x: Float32Array, W: Float32Array, bias: Float32Array, dIn: number, dOut: number, out: Float32Array) {
  for (let j = 0; j < dOut; j++) out[j] = bias[j];
  for (let i = 0; i < dIn; i++) {
    const xi = x[i];
    if (xi === 0) continue;
    const base = i * dOut;
    for (let j = 0; j < dOut; j++) out[j] += xi * W[base + j];
  }
}

export interface PlanParsed {
  title: string;
  tagline: string;
  bullets: string[];
  theme: string;
}

export function parsePlan(text: string): PlanParsed {
  const p: PlanParsed = { title: "", tagline: "", bullets: [], theme: "" };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("title:")) p.title = line.slice(6).trim();
    else if (line.startsWith("tagline:")) p.tagline = line.slice(8).trim();
    // "ruangan:" = ID plans, "room:" = EN plans — same field, two tongues
    else if (line.startsWith("ruangan:")) p.theme = line.slice(8).trim();
    else if (line.startsWith("room:")) p.theme = line.slice(5).trim();
    else if (line.startsWith("-")) p.bullets.push(line.slice(1).trim());
  }
  if (!p.title && text) p.title = text.trim().split("\n")[0].slice(0, 40);
  return p;
}

export class RoultBrain {
  private D: number; private L: number; private H: number; private DH: number; private DFF: number; private MAXT: number; private V: number;
  private emb: Float32Array;
  private pos: Float32Array;
  private layers: LayerWeights[] = [];
  private finw: Float32Array; private finb: Float32Array;
  private kCache: Float32Array[] = [];
  private vCache: Float32Array[] = [];
  ctx: number[] = [];
  T = 0;
  private mask = new CodeMask();
  private inCode = false;
  private recent: number[] = [];
  private rng: () => number;
  private pendingLogits: Float32Array | null = null;

  private xbuf = new Float32Array(0);
  private hbuf = new Float32Array(0);
  private qkbuf = new Float32Array(0);
  private abuf = new Float32Array(0);
  private f1buf = new Float32Array(0);
  private silubuf = new Float32Array(0);
  private f2buf = new Float32Array(0);
  private sbuf = new Float32Array(0);
  private logitbuf = new Float32Array(0);

  constructor(W: RoultWeights, seed: number) {
    const h = W.header;
    this.V = h.V; this.D = h.D; this.L = h.L; this.H = h.H; this.DFF = h.DFF; this.MAXT = h.MAXT;
    this.DH = h.D / h.H;
    this.emb = W.tensors.get("emb")!.fp32;
    this.pos = W.tensors.get("pos")!.fp32;
    this.finw = W.tensors.get("fin.w")!.fp32;
    this.finb = W.tensors.get("fin.b")!.fp32;
    for (let l = 0; l < this.L; l++) {
      const g = (n: string) => W.tensors.get(`${l}.${n}`)!.fp32;
      this.layers.push({
        ln1w: g("ln1.w"), ln1b: g("ln1.b"),
        qkv: g("qkv"), qkvb: g("qkv.b"),
        ow: g("o"), ob: g("o.b"),
        ln2w: g("ln2.w"), ln2b: g("ln2.b"),
        w1: g("w1"), w1b: g("w1.b"),
        w2: g("w2"), w2b: g("w2.b"),
      });
      this.kCache.push(new Float32Array(this.MAXT * this.D));
      this.vCache.push(new Float32Array(this.MAXT * this.D));
    }
    this.rng = mulberry32(seed);
    this.alloc();
  }

  private alloc() {
    this.xbuf = new Float32Array(this.D);
    this.hbuf = new Float32Array(this.D);
    this.qkbuf = new Float32Array(3 * this.D);
    this.abuf = new Float32Array(this.D);
    this.f1buf = new Float32Array(this.DFF);
    this.silubuf = new Float32Array(this.DFF);
    this.f2buf = new Float32Array(this.D);
    this.sbuf = new Float32Array(this.MAXT);
    this.logitbuf = new Float32Array(this.V);
  }

  reset(seed: number) {
    this.rng = mulberry32(seed);
    this.ctx = [];
    this.T = 0;
    this.inCode = false;
    this.recent = [];
    this.mask = new CodeMask();
    this.pendingLogits = null;
    for (let l = 0; l < this.L; l++) {
      this.kCache[l].fill(0);
      this.vCache[l].fill(0);
    }
  }

  /** real architecture specs — the UI shows them off (20M, from scratch) */
  info(): { V: number; D: number; L: number; H: number; DFF: number; MAXT: number; params: number } {
    const perLayer =
      2 * this.D + // ln1
      this.D * 3 * this.D + 3 * this.D + // qkv
      this.D * this.D + this.D + // o
      2 * this.D + // ln2
      this.D * this.DFF + this.DFF + // w1
      this.DFF * this.D + this.D; // w2
    const params =
      this.V * this.D + // emb (tied with the head)
      this.MAXT * this.D + // pos
      this.L * perLayer +
      2 * this.D; // final ln
    return { V: this.V, D: this.D, L: this.L, H: this.H, DFF: this.DFF, MAXT: this.MAXT, params };
  }

  /** feed prompt tokens; keeps logits for the next sampled token */
  prime(tokens: number[]) {
    for (let i = 0; i < tokens.length; i++) {
      const last = i === tokens.length - 1;
      this.pendingLogits = this.step(tokens[i], last);
    }
    this.ctx = tokens.slice();
  }

  /** one transformer step; returns next-position logits when wanted */
  private step(token: number, wantLogits: boolean): Float32Array | null {
    if (this.T >= this.MAXT) return null;
    const D = this.D;
    const x = this.xbuf;
    const t0 = this.T;
    for (let i = 0; i < D; i++) x[i] = this.emb[token * D + i] + this.pos[t0 * D + i];

    for (let l = 0; l < this.L; l++) {
      const LW = this.layers[l];
      const kc = this.kCache[l];
      const vc = this.vCache[l];
      ln(x, LW.ln1w, LW.ln1b, D, this.hbuf);
      matvec(this.hbuf, LW.qkv, LW.qkvb, D, 3 * D, this.qkbuf);
      const kBase = t0 * D;
      for (let i = 0; i < D; i++) {
        kc[kBase + i] = this.qkbuf[D + i];
        vc[kBase + i] = this.qkbuf[2 * D + i];
      }
      const inv = 1 / Math.sqrt(this.DH);
      for (let h = 0; h < this.H; h++) {
        const off = h * this.DH;
        let maxS = -Infinity;
        for (let tt = 0; tt <= t0; tt++) {
          let s = 0;
          const kvOff = tt * D + off;
          for (let i = 0; i < this.DH; i++) s += this.qkbuf[off + i] * kc[kvOff + i];
          s *= inv;
          this.sbuf[tt] = s;
          if (s > maxS) maxS = s;
        }
        let sum = 0;
        for (let tt = 0; tt <= t0; tt++) {
          const e = Math.exp(this.sbuf[tt] - maxS);
          this.sbuf[tt] = e;
          sum += e;
        }
        const invSum = 1 / sum;
        for (let i = 0; i < this.DH; i++) this.abuf[off + i] = 0;
        for (let tt = 0; tt <= t0; tt++) {
          const p = this.sbuf[tt] * invSum;
          if (p < 1e-6) continue;
          const kvOff = tt * D + off;
          for (let i = 0; i < this.DH; i++) this.abuf[off + i] += p * vc[kvOff + i];
        }
      }
      matvec(this.abuf, LW.ow, LW.ob, D, D, this.hbuf);
      for (let i = 0; i < D; i++) x[i] += this.hbuf[i];
      ln(x, LW.ln2w, LW.ln2b, D, this.hbuf);
      matvec(this.hbuf, LW.w1, LW.w1b, D, this.DFF, this.f1buf);
      for (let i = 0; i < this.DFF; i++) {
        const f = this.f1buf[i];
        this.silubuf[i] = f / (1 + Math.exp(-f));
      }
      matvec(this.silubuf, LW.w2, LW.w2b, this.DFF, D, this.f2buf);
      for (let i = 0; i < D; i++) x[i] += this.f2buf[i];
    }
    this.T = t0 + 1;
    if (!wantLogits) return null;
    ln(x, this.finw, this.finb, D, this.hbuf);
    const out = this.logitbuf;
    for (let v = 0; v < this.V; v++) {
      let s = 0;
      const base = v * D;
      for (let i = 0; i < D; i++) s += this.hbuf[i] * this.emb[base + i];
      out[v] = s;
    }
    return out;
  }

  private sample(opts: { temperature: number; topK: number }, maskIds: Set<number> | null): number {
    const logits = this.pendingLogits!;
    const n = this.V;
    // light repetition penalty on content tokens only
    const fmt = new Set(["\n", " ", "IND", ";", ",", "(", ")", "{", "}"]);
    const counts = new Map<number, number>();
    for (const r of this.recent) {
      counts.set(r, (counts.get(r) ?? 0) + 1);
    }
    for (const [r, c] of counts) {
      const s0 = VOCAB.itos[r];
      if (fmt.has(s0)) continue;
      if (s0.length === 1 && s0 >= "0" && s0 <= "9") continue;
      const tag = VOCAB.tags[s0] ?? "";
      if (tag !== "word" && tag !== "ident" && tag !== "builtin" && tag !== "hook" && tag !== "const") continue;
      logits[r] -= c >= 2 ? 3.2 : 1.1;
    }
    // comparisons loop-breaker
    for (const op of COMPARISONS) {
      const id = VOCAB.stoi.get(op)!;
      const c = counts.get(id) ?? 0;
      if (c >= 2) logits[id] -= 4.0;
    }
    if (maskIds) {
      for (let v = 0; v < n; v++) if (!maskIds.has(v)) logits[v] = -1e9;
    }
    const temp = Math.max(0.05, opts.temperature);
    const scaled = new Float32Array(n);
    let maxL = -Infinity;
    for (let v = 0; v < n; v++) {
      scaled[v] = logits[v] / temp;
      if (scaled[v] > maxL) maxL = scaled[v];
    }
    let sum = 0;
    for (let v = 0; v < n; v++) {
      scaled[v] = Math.exp(scaled[v] - maxL);
      sum += scaled[v];
    }
    const idx: number[] = [];
    if (maskIds && maskIds.size > 0) maskIds.forEach((v) => idx.push(v));
    else if (maskIds) idx.push(VOCAB.stoi.get("\n")!); // empty mask: whitespace is always safe
    else for (let v = 0; v < n; v++) idx.push(v);
    idx.sort((a, b) => scaled[b] - scaled[a]);
    const k = Math.min(opts.topK, idx.length);
    let ksum = 0;
    for (let i = 0; i < k; i++) ksum += scaled[idx[i]];
    let r = this.rng() * ksum;
    for (let i = 0; i < k; i++) {
      r -= scaled[idx[i]];
      if (r <= 0) return idx[i];
    }
    return idx[0];
  }

  private commit(t: number) {
    this.ctx.push(t);
    this.recent.push(t);
    if (this.recent.length > 24) this.recent.shift();
    this.pendingLogits = this.step(t, true);
  }

  private pushPrompt(t: number) {
    this.ctx.push(t);
    this.recent.push(t);
    if (this.recent.length > 24) this.recent.shift();
  }

  /** finish an in-progress program cleanly: close stmts, blocks, then <end> */
  private async closeOut(mask: CodeMask, onCode: (c: string) => void): Promise<string> {
    let extra = "";
    const commitStr = (t: string) => {
      const id = VOCAB.stoi.get(t)!;
      this.pushPrompt(id);
      mask.step(t);
      onCode(t);
      extra += t === "IND" ? "    " : t;
      this.pendingLogits = this.step(id, true);
    };
    for (let i = 0; i < 48; i++) {
      const st = mask.state;
      if (st === "top") break;
      if (st === "exprCont") {
        const top = mask.parens[mask.parens.length - 1];
        if (top) commitStr(")");
        else commitStr(";");
      } else if (st === "postVoid") commitStr(";");
      else if (st === "stringOpen") {
        // an unfilled run_skill("...) string gets a real skill id before the quote
        if (mask.stringMode === "skill" && !mask.skillStrFilled) commitStr("peek");
        commitStr('"');
      } else if (st === "stmt") commitStr("}");
      else if (st === "exprStart") {
        const top = mask.parens[mask.parens.length - 1];
        if (top && top.kind === "call" && (top.name === "say" || (top.name === "run_skill" && top.arg === 0))) commitStr('"');
        else commitStr("1");
      } else if (st === "wantParen") commitStr("(");
      else if (st === "wantHook") commitStr("round");
      else if (st === "wantClose") commitStr(")");
      else if (st === "postCtrlParen") commitStr("{");
      else if (st === "wantIdent") {
        commitStr("x");
        commitStr("=");
        commitStr("1");
        commitStr(";");
      } else if (st === "wantEqOrSemi") {
        commitStr("=");
        commitStr("1");
        commitStr(";");
      } else if (st === "wantCallParen") commitStr("(");
      else break;
      await yieldToUi();
    }
    if (mask.state === "top") this.commit(T_END);
    return extra;
  }

  /** generate plan text; stops on <revise>/<think>/<code> (committed) */
  async generatePlan(
    opts: { temperature: number; topK: number },
    onText: (chunk: string) => void,
    maxNew = 120,
  ): Promise<"revise" | "think" | "code" | "full"> {
    let produced = 0;
    for (;;) {
      if (!this.pendingLogits) return "full";
      const t = this.sample(opts, null);
      const s = VOCAB.itos[t];
      if (t === T_REVISE || t === T_THINK || t === T_CODE) {
        this.commit(t);
        if (t === T_CODE) {
          this.inCode = true;
          this.mask = new CodeMask();
        }
        return t === T_REVISE ? "revise" : t === T_THINK ? "think" : "code";
      }
      this.pushPrompt(t);
      onText(s);
      produced++;
      if (produced >= maxNew || this.T >= this.MAXT - 2) return "full";
      this.pendingLogits = this.step(t, true);
      await yieldToUi();
    }
  }

  /** continue: <think> lines then the grammar-masked <code> program */
  async generateDeep(
    opts: { temperature: number; topK: number },
    onThink: (line: string) => void,
    onCode: (chunk: string) => void,
    maxNew = 430,
  ): Promise<string> {
    let codeText = "";
    let produced = 0;
    let thinkLine = "";
    const thinkBan = new Set([T_INTENT, T_PLAN, T_REVISE]);
    for (;;) {
      if (!this.pendingLogits) break;
      let masked = this.inCode
        ? this.mask.allowed()
        : (() => {
            const all = new Set<number>();
            for (let v = 0; v < this.V; v++) all.add(v);
            for (const b of thinkBan) all.delete(b);
            return all;
          })();
      if (masked && this.inCode) {
        // whitespace budget: after 2 straight formatting tokens, close the
        // spigot — the model loves padding and it eats the context window
        const ws = /[\n ]$/.test(codeText) && /[\n ]$/.test(codeText.slice(0, -1));
        if (/\n\n\n$/.test(codeText)) masked.delete(VOCAB.stoi.get("\n")!);
        if (ws) {
          masked.delete(VOCAB.stoi.get("\n")!);
          masked.delete(VOCAB.stoi.get("IND")!);
          masked.delete(VOCAB.stoi.get(" ")!);
        }
      }
      const t = this.sample(opts, masked);
      const s = VOCAB.itos[t];
      if (t === T_END) {
        this.commit(t);
        break;
      }
      if (t === T_CODE) {
        this.commit(t);
        this.inCode = true;
        this.mask = new CodeMask();
        continue;
      }
      this.pushPrompt(t);
      if (this.inCode) {
        const raw = s === "IND" ? "    " : s;
        codeText += raw;
        onCode(raw);
        this.mask.step(s);
      } else {
        thinkLine += s;
        if (s === "\n") {
          const l0 = thinkLine.trim();
          if (l0) onThink(l0);
          thinkLine = "";
        }
      }
      produced++;
      // think guard: force the code section if the model rambles
      if (!this.inCode && produced > 60) {
        this.commit(T_CODE);
        this.inCode = true;
        this.mask = new CodeMask();
        continue;
      }
      // near-end guard: finish the program cleanly instead of truncating
      if (this.inCode && (produced >= maxNew - 14 || this.T >= this.MAXT - 8 || codeText.length > 640)) {
        codeText += await this.closeOut(this.mask, onCode);
        break;
      }
      if (produced >= maxNew || this.T >= this.MAXT - 2) break;
      this.pendingLogits = this.step(t, true);
      await yieldToUi();
    }
    return codeText;
  }

  startIntent(intent: string) {
    this.reset((Math.random() * 2 ** 31) | 0);
    const tokens = encodeText(`<intent> ${intent}\n<plan>\n`);
    this.prime(tokens);
  }

  pushRevise(instruction: string) {
    const tokens = encodeText(` ${instruction}\n<plan>\n`);
    for (let i = 0; i < tokens.length; i++) {
      const last = i === tokens.length - 1;
      this.pendingLogits = this.step(tokens[i], last);
      this.pushPrompt(tokens[i]);
    }
  }
}

function yieldToUi(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

/* ------------------------------------------------------------------ */
/* high-level session                                                 */
/* ------------------------------------------------------------------ */

export interface RoultSessionEvents {
  onPlanLine?: (line: string) => void;
  onThinkLine?: (line: string) => void;
  onCodeChunk?: (chunk: string) => void;
}

export class RoultSession {
  brain: RoultBrain;
  opts: { temperature: number; topK: number };
  /** planning runs a bit colder than codegen — plans are template picks */
  private planOpts: { temperature: number; topK: number };

  constructor(W: RoultWeights, temperature = 0.8) {
    this.brain = new RoultBrain(W, (Math.random() * 2 ** 31) | 0);
    this.opts = { temperature, topK: 24 };
    this.planOpts = { temperature: Math.max(0.4, temperature * 0.8), topK: 18 };
  }

  /** snapshot the whole KV state so a losing branch can be thrown away
   *  without re-priming the winner (plain memcopy — cheap) */
  private snapshot() {
    const b = this.brain as unknown as {
      kCache: Float32Array[]; vCache: Float32Array[]; ctx: number[]; T: number;
      pendingLogits: Float32Array | null; recent: number[];
    };
    return {
      k: b.kCache.map((a) => a.slice()),
      v: b.vCache.map((a) => a.slice()),
      ctx: b.ctx.slice(),
      T: b.T,
      logits: b.pendingLogits ? b.pendingLogits.slice() : null,
      recent: b.recent.slice(),
    };
  }

  private restore(s: ReturnType<RoultSession["snapshot"]>) {
    const b = this.brain as unknown as {
      kCache: Float32Array[]; vCache: Float32Array[]; ctx: number[]; T: number;
      pendingLogits: Float32Array | null; recent: number[];
    };
    b.kCache = s.k;
    b.vCache = s.v;
    b.ctx = s.ctx;
    b.T = s.T;
    b.pendingLogits = s.logits;
    b.recent = s.recent;
  }

  /** content-word overlap between the user's intent and a plan branch —
   *  measured on the BULLETS only (the mechanic lines, not the flavor) */
  private static scoreBranch(intent: string, plan: string): number {
    const stop = new Set([
      "the", "and", "with", "that", "when", "every", "please", "mode", "make",
      "give", "let", "gets", "each", "instead", "round", "rounds", "player",
      "dealer", "game", "table", "this", "for", "kalo", "kalau", "terus",
      "buat", "biar", "bang", "dong", "deh", "aja", "gitu", "ya", "ke", "di",
      "yang", "dengan", "karena", "semua", "juga", "sama", "pas", "udah",
    ]);
    const words = [...new Set((intent.toLowerCase().match(/[a-z][a-z0-9_]*/g) ?? []).filter(
      (w) => w.length > 2 && !stop.has(w),
    ))];
    // only the "- ..." mechanic bullets carry the actual feature
    const bullets = plan
      .split("\n")
      .filter((l) => l.trimStart().startsWith("-"))
      .join(" ")
      .toLowerCase();
    let hits = 0;
    for (const w of words) if (bullets.includes(w)) hits += 3;
    return hits;
  }

  /**
   * BEST-OF-2: the model proposes TWO plan branches from scratch (fresh
   * samples), the branch that actually talks about the user's words wins.
   * A plain inference-time rerank — the model itself stays untouched.
   */
  async start(intent: string, ev: RoultSessionEvents): Promise<PlanParsed> {
    // branch A
    this.brain.startIntent(intent);
    let bufA = "";
    await this.brain.generatePlan(this.planOpts, (chunk) => { bufA += chunk; });
    const snapA = this.snapshot();
    // branch B
    this.brain.startIntent(intent);
    let bufB = "";
    await this.brain.generatePlan(this.planOpts, (chunk) => { bufB += chunk; });
    const scoreA = RoultSession.scoreBranch(intent, bufA);
    const scoreB = RoultSession.scoreBranch(intent, bufB);
    const winner = scoreB > scoreA ? bufB : bufA;
    if (winner === bufA) this.restore(snapA); // B dies, A's KV state returns
    for (const line of winner.split("\n")) {
      const l0 = line.trim();
      if (l0) ev.onPlanLine?.(l0);
    }
    void bufB;
    return parsePlan(winner);
  }

  async revise(instruction: string, ev: RoultSessionEvents): Promise<PlanParsed> {
    this.brain.pushRevise(instruction);
    let buf = "";
    await this.brain.generatePlan(this.planOpts, (chunk) => {
      buf += chunk;
      if (chunk === "\n") {
        const l0 = buf.trim();
        buf = "";
        if (l0) ev.onPlanLine?.(l0);
      }
    });
    if (buf.trim()) ev.onPlanLine?.(buf.trim());
    const planText = decodeTokens(this.planTokenRange());
    return parsePlan(planText);
  }

  /** LANJUT — deep think + code generation; returns the code text */
  async generateCode(ev: RoultSessionEvents): Promise<string> {
    const code = await this.brain.generateDeep(
      this.opts,
      ev.onThinkLine ?? (() => {}),
      ev.onCodeChunk ?? (() => {}),
    );
    return code;
  }

  /** last plan section = tokens after the final <plan> up to next special */
  private planTokenRange(): number[] {
    const ctx = this.brain.ctx;
    let start = -1;
    for (let i = ctx.length - 1; i >= 0; i--) {
      if (ctx[i] === T_PLAN) {
        start = i + 1;
        break;
      }
    }
    if (start < 0) return [];
    const end = ctx.findIndex((t, i) => i >= start && (t === T_THINK || t === T_REVISE || t === T_CODE || t === T_END));
    return ctx.slice(start, end < 0 ? ctx.length : end);
  }
}

export async function openSession(temperature = 0.8): Promise<RoultSession> {
  const W = await loadWeights();
  return new RoultSession(W, temperature);
}

void SPECIALS;
