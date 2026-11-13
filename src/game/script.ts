/**
 * script.ts — ENGINE C: the custom-effect language.
 *
 * This is NOT a JS interpreter. The player writes a C program, we parse it,
 * and COMPILE IT STRAIGHT INTO A WEBASSEMBLY BINARY. The browser's own WASM
 * engine executes it natively — no loop running inside JavaScript, no eval.
 *
 * Language (a real C subset):
 *   int bonus = 0;                    // globals (int / float)
 *   float scale = 1.5;
 *
 *   every (dealer_take_damage) {      // hooks: setup, turn, round, hit,
 *     bonus += 1;                     //   player_take_damage,
 *     if (bonus >= 3) {               //   dealer_take_damage, skill,
 *       heal(PLAYER, 1);              //   shop, death, coin, peek
 *       bonus = 0;
 *     }
 *   }
 *
 *   every (skill) {
 *     if (hp(DEALER) <= 2) run_skill("cuffs", DEALER);
 *   }
 *
 * Builtins:  heal(side,n)  damage(side,n)  run_skill("id",side)
 *            hp(side)  score()  round()  rand(n)  last_skill()
 *            print(x)  print("text")  say("text")
 *            chance(p)  shuffle()  theme(color)
 *            set_dmg_next(n)  set_coin(0|1)
 * Constants: PLAYER=0, DEALER=1, SKILL_REROLL ... SKILL_GAMBLE
 * Control:   if / else, while, repeat(n) (n <= 0 = infinite, fuel-guarded),
 *            break, int & float arithmetic, && || ! == != < <= > >= += -=
 *
 * The compiled module imports a small host environment (heal/damage/...) and
 * exports one function per hook. Infinite loops are impossible: every loop
 * iteration calls fuel_check(), and the host TRAPS (throws into WASM) once
 * the fuel budget is spent.
 */

import { ALL_SKILL_IDS, type SkillId } from "./doodle";
import type { Side } from "./logic";

/* ------------------------------------------------------------------ */
/* public API                                                          */
/* ------------------------------------------------------------------ */

export type ScriptEventName =
  | "setup"
  | "turn"
  | "round"
  | "hit"
  | "player_take_damage"
  | "dealer_take_damage"
  | "skill"
  | "shop"
  | "death"
  | "coin"
  | "peek";

export const SCRIPT_EVENTS: ScriptEventName[] = [
  "setup",
  "turn",
  "round",
  "hit",
  "player_take_damage",
  "dealer_take_damage",
  "skill",
  "shop",
  "death",
  "coin",
  "peek",
];

export interface ScriptHost {
  runSkill(id: SkillId, target: Side): void;
  heal(side: Side, n: number): void;
  damage(side: Side, n: number): void;
  say(text: string): void;
  /** Live game state for hp()/score()/round(). */
  stateRef(): { hp: Record<Side, number>; score: number; round: number };
  /** ENGINE C v2 builtins — optional so older hosts/tests still work. */
  /** chance(p): true with p percent probability. */
  chance?(p: number): boolean;
  /** shuffle(): scramble the remaining shell order. */
  shuffle?(): void;
  /** theme(color): tint the room light (0 resets). */
  theme?(color: number): void;
  /** set_dmg_next(n): the next trigger pull deals n damage. */
  setDmgNext?(n: number): void;
  /** set_coin(1|0): force the next gamble flip (heads/tails). */
  setCoin?(win: number): void;
}

export interface CompileResult {
  ok: boolean;
  errors: string[]; // "line N: ..."
  hooks: ScriptEventName[]; // hooks the program defines
  bytes: Uint8Array | null; // the compiled WebAssembly module
}

const MAX_FUEL = 200000; // loop iterations per hook call
const SIDE_BY_CODE: readonly Side[] = ["player", "enemy"] as const;

/* ------------------------------------------------------------------ */
/* tokenizer                                                           */
/* ------------------------------------------------------------------ */

type TokType = "num" | "ident" | "str" | "punct";
interface Tok {
  t: TokType;
  v: string;
  line: number;
}

function tokenize(src: string): { toks: Tok[]; errors: string[] } {
  const toks: Tok[] = [];
  const errors: string[] = [];
  let line = 1;
  let i = 0;
  const push = (t: TokType, v: string, ln: number) => toks.push({ t, v, line: ln });
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    // comments: //  #  /* */
    if ((c === "/" && src[i + 1] === "/") || c === "#") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"') {
      let s = "";
      i++;
      let closed = false;
      while (i < src.length) {
        const ch = src[i];
        if (ch === "\\" && src[i + 1]) {
          const n = src[i + 1];
          s += n === "n" ? "\n" : n === "t" ? "\t" : n;
          i += 2;
          continue;
        }
        if (ch === '"') {
          closed = true;
          i++;
          break;
        }
        if (ch === "\n") break;
        s += ch;
        i++;
      }
      if (!closed) errors.push(`line ${line}: unterminated string`);
      push("str", s, line);
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i;
      let dot = false;
      while (j < src.length && /[0-9.eE]/.test(src[j])) {
        if (src[j] === ".") {
          if (dot) break;
          dot = true;
        }
        j++;
      }
      // exponent sign
      if (j < src.length && /[eE]/.test(src[j - 1] ?? "") && (src[j] === "+" || src[j] === "-")) j++;
      push("num", src.slice(i, j), line);
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      push("ident", src.slice(i, j), line);
      i = j;
      continue;
    }
    // punct (longest first)
    const three = src.slice(i, i + 2);
    let matched = "";
    for (const p of ["==", "!=", "<=", ">=", "+=", "-=", "&&", "||", "++", "--"]) {
      if (three === p) {
        matched = p;
        break;
      }
    }
    if (matched) {
      push("punct", matched, line);
      i += 2;
      continue;
    }
    if ("(){};+-*/%<>!=,".includes(c)) {
      push("punct", c, line);
      i++;
      continue;
    }
    errors.push(`line ${line}: unexpected character "${c}"`);
    i++;
  }
  return { toks, errors };
}

/* ------------------------------------------------------------------ */
/* AST                                                                 */
/* ------------------------------------------------------------------ */

type ValType = "i32" | "f32";

type Expr =
  | { k: "num"; v: number; t: ValType; line: number }
  | { k: "str"; s: string; line: number }
  | { k: "var"; name: string; line: number }
  | { k: "const"; v: number; line: number }
  | { k: "call"; name: string; args: Expr[]; line: number }
  | { k: "bin"; op: string; a: Expr; b: Expr; line: number }
  | { k: "un"; op: "-" | "!"; a: Expr; line: number }
  | { k: "assign"; name: string; op: string; e: Expr; line: number };

type Stmt =
  | { k: "decl"; t: ValType; name: string; init: Expr | null; line: number }
  | { k: "expr"; e: Expr }
  | { k: "if"; cond: Expr; then: Stmt[]; els: Stmt[]; line: number }
  | { k: "while"; cond: Expr; body: Stmt[]; line: number }
  | { k: "repeat"; n: Expr; body: Stmt[]; line: number }
  | { k: "break"; line: number };

interface Program {
  globals: { name: string; t: ValType; init: number | null; line: number }[];
  hooks: { event: ScriptEventName; body: Stmt[] }[];
}

/* ------------------------------------------------------------------ */
/* constants (compile-time)                                            */
/* ------------------------------------------------------------------ */

const CONSTS: Record<string, number> = (() => {
  const c: Record<string, number> = { PLAYER: 0, DEALER: 1 };
  for (let i = 0; i < ALL_SKILL_IDS.length; i++) c[`SKILL_${ALL_SKILL_IDS[i].toUpperCase()}`] = i;
  return c;
})();

const SKILL_BY_NAME = new Map<string, number>(ALL_SKILL_IDS.map((id, i) => [id, i]));

/* ------------------------------------------------------------------ */
/* parser (recursive descent, C syntax)                                */
/* ------------------------------------------------------------------ */

function parseProgram(src: string): { prog: Program; errors: string[] } {
  const { toks, errors: tokErr } = tokenize(src);
  const errors = [...tokErr];
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const at = (t: TokType, v: string) => {
    const k = toks[p];
    return !!k && k.t === t && k.v === v;
  };
  const atPunct = (v: string) => at("punct", v);
  const eat = (t: TokType, v: string, what: string): boolean => {
    if (at(t, v)) {
      p++;
      return true;
    }
    const k = peek();
    errors.push(`line ${k ? k.line : toks.length ? toks[toks.length - 1].line : 1}: expected ${what} ${v}, got ${k ? `"${k.v}"` : "end of file"}`);
    return false;
  };
  const lineOf = (tok: Tok | undefined) => (tok ? tok.line : toks.length ? toks[toks.length - 1].line : 1);

  /** skip tokens until a likely statement boundary (error recovery).
   *  ALWAYS makes progress — never returns with p unchanged. */
  const sync = () => {
    const start = p;
    let depth = 0;
    while (p < toks.length) {
      const k = toks[p];
      if (k.t === "punct") {
        if (k.v === "{" || k.v === "(") {
          depth++;
          p++;
          continue;
        }
        if (k.v === "}") {
          if (depth === 0) {
            if (p === start) p++; // guarantee progress even on a stray }
            return; // leave } for the block parser
          }
          depth--;
          p++;
          continue;
        }
        if (k.v === ")") {
          if (depth === 0) {
            p++; // stray ) inside a broken construct — consume it
            continue;
          }
          depth--;
          p++;
          continue;
        }
        if (k.v === ";" && depth === 0) {
          p++;
          return;
        }
        p++;
        continue;
      }
      p++;
    }
  };

  const parseBlock = (): Stmt[] => {
    const body: Stmt[] = [];
    if (!eat("punct", "{", "'{'")) {
      sync();
      return body;
    }
    while (!atPunct("}") && p < toks.length) {
      const s = parseStmt();
      if (s) body.push(s);
    }
    eat("punct", "}", "'}'");
    return body;
  };

  const parseStmtOrBlock = (): Stmt[] => {
    if (atPunct("{")) return parseBlock();
    const s = parseStmt();
    return s ? [s] : [];
  };

  const parseStmt = (): Stmt | null => {
    const k = peek();
    if (!k) return null;
    if (k.t === "punct" && k.v === ";") {
      p++;
      return null;
    }
    if (k.t === "ident" && (k.v === "int" || k.v === "float") && toks[p + 1]?.t === "ident") {
      const line = k.line;
      p++;
      const t: ValType = k.v === "int" ? "i32" : "f32";
      const name = next().v;
      let init: Expr | null = null;
      if (atPunct("=")) {
        p++;
        init = parseExpr();
      }
      eat("punct", ";", "';' after declaration");
      return { k: "decl", t, name, init, line };
    }
    if (k.t === "ident" && k.v === "if") {
      const line = k.line;
      p++;
      eat("punct", "(", "'(' after if");
      const cond = parseExpr();
      eat("punct", ")", "')' after if condition");
      const then = parseStmtOrBlock();
      let els: Stmt[] = [];
      if (at("ident", "else")) {
        p++;
        els = parseStmtOrBlock();
      }
      return { k: "if", cond, then, els, line };
    }
    if (k.t === "ident" && k.v === "while") {
      const line = k.line;
      p++;
      eat("punct", "(", "'(' after while");
      const cond = parseExpr();
      eat("punct", ")", "')' after while condition");
      const body = parseStmtOrBlock();
      return { k: "while", cond, body, line };
    }
    if (k.t === "ident" && k.v === "repeat") {
      const line = k.line;
      p++;
      eat("punct", "(", "'(' after repeat");
      const n = parseExpr();
      eat("punct", ")", "')' after repeat count");
      const body = parseStmtOrBlock();
      return { k: "repeat", n, body, line };
    }
    if (k.t === "ident" && k.v === "break") {
      const line = k.line;
      p++;
      eat("punct", ";", "';' after break");
      return { k: "break", line };
    }
    // expression statement
    const e = parseExpr();
    eat("punct", ";", "';'");
    return { k: "expr", e };
  };

  /* --- expressions (precedence climbing) --- */
  const parseExpr = (): Expr => parseAssign();

  const parseAssign = (): Expr => {
    // lvalue lookahead: IDENT (=|+=|-=)
    const save = p;
    if (peek()?.t === "ident" && !CONSTS[peek()!.v]) {
      const name = next().v;
      const opTok = peek();
      if (opTok?.t === "punct" && (opTok.v === "=" || opTok.v === "+=" || opTok.v === "-=")) {
        const line = opTok.line;
        p++;
        const e = parseAssign();
        return { k: "assign", name, op: opTok.v, e, line };
      }
      p = save;
    }
    return parseOr();
  };

  const binLoop = (sub: () => Expr, ops: string[]): Expr => {
    let a = sub();
    for (;;) {
      const k = peek();
      if (k?.t === "punct" && ops.includes(k.v)) {
        const line = k.line;
        p++;
        const b = sub();
        a = { k: "bin", op: k.v, a, b, line };
      } else return a;
    }
  };

  const parseOr = () => binLoop(parseAnd, ["||"]);
  const parseAnd = () => binLoop(parseEq, ["&&"]);
  const parseEq = () => binLoop(parseRel, ["==", "!="]);
  const parseRel = () => binLoop(parseAdd, ["<", "<=", ">", ">="]);
  const parseAdd = () => binLoop(parseMul, ["+", "-"]);
  const parseMul = () => binLoop(parseUnary, ["*", "/", "%"]);

  const parseUnary = (): Expr => {
    const k = peek();
    if (k?.t === "punct" && (k.v === "-" || k.v === "!")) {
      p++;
      const a = parseUnary();
      return { k: "un", op: k.v as "-" | "!", a, line: k.line };
    }
    return parsePrimary();
  };

  const parsePrimary = (): Expr => {
    const k = next();
    if (!k) {
      errors.push("line 1: unexpected end of file inside an expression");
      return { k: "num", v: 0, t: "i32", line: 1 };
    }
    if (k.t === "num") {
      const isFloat = /[.eE]/.test(k.v);
      return { k: "num", v: Number(k.v), t: isFloat ? "f32" : "i32", line: k.line };
    }
    if (k.t === "str") return { k: "str", s: k.v, line: k.line };
    if (k.t === "punct" && k.v === "(") {
      const e = parseExpr();
      eat("punct", ")", "')'");
      return e;
    }
    if (k.t === "ident") {
      if (atPunct("(")) {
        p++;
        const args: Expr[] = [];
        if (!atPunct(")")) {
          for (;;) {
            args.push(parseExpr());
            if (atPunct(",")) {
              p++;
              continue;
            }
            break;
          }
        }
        eat("punct", ")", "')' after arguments");
        return { k: "call", name: k.v, args, line: k.line };
      }
      if (CONSTS[k.v] !== undefined) return { k: "const", v: CONSTS[k.v], line: k.line };
      return { k: "var", name: k.v, line: k.line };
    }
    errors.push(`line ${k.line}: unexpected "${k.v}" in expression`);
    return { k: "num", v: 0, t: "i32", line: k.line };
  };

  /* --- top level --- */
  const prog: Program = { globals: [], hooks: [] };
  while (p < toks.length) {
    const k = peek();
    if (k.t === "ident" && (k.v === "int" || k.v === "float") && toks[p + 1]?.t === "ident" && toks[p + 2]?.t === "punct" && (toks[p + 2].v === ";" || toks[p + 2].v === "=")) {
      const line = k.line;
      p++;
      const t: ValType = k.v === "int" ? "i32" : "f32";
      const name = next().v;
      let init: Expr | null = null;
      if (atPunct("=")) {
        p++;
        init = parseExpr();
      }
      eat("punct", ";", "';' after global declaration");
      let initV: number | null = null;
      if (init) {
        // only constant literals are legal global initializers
        const fold = (e: Expr): number | null => {
          if (e.k === "num") return e.v;
          if (e.k === "const") return e.v;
          if (e.k === "un" && e.op === "-" && e.a.k === "num") return -e.a.v;
          return null;
        };
        initV = init ? fold(init) : null;
        if (initV === null) errors.push(`line ${line}: global initializer must be a constant number`);
      }
      prog.globals.push({ name, t, init: initV, line });
      continue;
    }
    if (k.t === "ident" && k.v === "every") {
      const line = k.line;
      p++;
      eat("punct", "(", "'(' after every");
      const evTok = next();
      const ev = evTok?.v ?? "";
      if (!SCRIPT_EVENTS.includes(ev as ScriptEventName)) {
        errors.push(`line ${line}: unknown event "${ev}" — use ${SCRIPT_EVENTS.join(", ")}`);
        sync();
        continue;
      }
      eat("punct", ")", "')' after event name");
      const body = parseBlock();
      const existing = prog.hooks.find((h) => h.event === ev);
      if (existing) existing.body.push(...body);
      else prog.hooks.push({ event: ev as ScriptEventName, body });
      continue;
    }
    errors.push(`line ${k.line}: expected "int", "float" or "every (...)", got "${k.v}"`);
    sync();
  }

  return { prog, errors };
}

/* ------------------------------------------------------------------ */
/* WASM binary emitter                                                 */
/* ------------------------------------------------------------------ */

// host import indices (fixed order)
const I_HEAL = 0;
const I_DAMAGE = 1;
const I_RUN_SKILL = 2;
const I_PRINT_NUM = 3;
const I_PRINT_STR = 4;
const I_SAY = 5;
const I_HP = 6;
const I_SCORE = 7;
const I_ROUND = 8;
const I_RAND = 9;
const I_LAST_SKILL = 10;
const I_FUEL = 11;
// ENGINE C v2 — appended AFTER fuel so every legacy index stays stable
const I_CHANCE = 12;
const I_SHUFFLE = 13;
const I_THEME = 14;
const I_SETDMG = 15;
const I_SETCOIN = 16;

const uleb = (n: number): number[] => {
  const out: number[] = [];
  let v = n;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return out;
};

const sleb = (n: number): number[] => {
  const out: number[] = [];
  let v = n | 0;
  for (;;) {
    const b = v & 0x7f;
    v >>= 7;
    if ((v === 0 && !(b & 0x40)) || (v === -1 && b & 0x40)) {
      out.push(b);
      return out;
    }
    out.push(b | 0x80);
  }
};

const f32bytes = (v: number): number[] => {
  const ab = new ArrayBuffer(4);
  new DataView(ab).setFloat32(0, v, true);
  return [...new Uint8Array(ab)];
};

const utf8 = (s: string): number[] => [...new TextEncoder().encode(s)];
const nameBytes = (s: string): number[] => [...uleb(utf8(s).length), ...utf8(s)];

/** one compiled hook function */
class FuncCtx {
  bytes: number[] = [];
  locals: ValType[] = [];
  localIdx = new Map<string, number>();
  /** label stack — "block" | "loop" | "if", innermost last */
  labels: ("block" | "loop" | "if")[] = [];
  errors: string[] = [];

  push(...b: number[]) {
    this.bytes.push(...b);
  }
}

interface EmitEnv {
  globals: Map<string, { idx: number; t: ValType }>;
  strings: Map<string, number>;
  dataBytes: number[];
  errors: string[];
}

function addError(env: EmitEnv, line: number, msg: string) {
  env.errors.push(`line ${line}: ${msg}`);
}

function resolveVar(env: EmitEnv, ctx: FuncCtx, name: string): { kind: "local" | "global"; idx: number; t: ValType } | null {
  const li = ctx.localIdx.get(name);
  if (li !== undefined) return { kind: "local", idx: li, t: ctx.locals[li] };
  const g = env.globals.get(name);
  if (g) return { kind: "global", idx: g.idx, t: g.t };
  return null;
}

/** push a coercion so the value on the stack has type `to` */
function coerce(ctx: FuncCtx, from: ValType, to: ValType) {
  if (from === to) return;
  if (from === "f32" && to === "i32") ctx.push(0xa8); // i32.trunc_f32_s
  else ctx.push(0xb2); // f32.convert_i32_s
}

function emitBin(ctx: FuncCtx, op: string, ta: ValType, tb: ValType, line: number, env: EmitEnv): ValType {
  // promote to common type
  const t: ValType = ta === "f32" || tb === "f32" ? "f32" : "i32";
  coerce(ctx, ta, t);
  coerce(ctx, tb, t);
  const I = t === "i32";
  switch (op) {
    case "+": ctx.push(I ? 0x6a : 0x92); break;
    case "-": ctx.push(I ? 0x6b : 0x93); break;
    case "*": ctx.push(I ? 0x6c : 0x94); break;
    case "/":
      if (I) ctx.push(0x6d);
      else ctx.push(0x95);
      break;
    case "%":
      if (!I) {
        addError(env, line, "operator % needs int operands");
        ctx.push(0x6f);
      } else ctx.push(0x6f);
      break;
    case "==": ctx.push(I ? 0x46 : 0x5b); break;
    case "!=": ctx.push(I ? 0x47 : 0x5c); break;
    case "<": ctx.push(I ? 0x48 : 0x5d); break;
    case "<=": ctx.push(I ? 0x4c : 0x5f); break;
    case ">": ctx.push(I ? 0x4a : 0x5e); break;
    case ">=": ctx.push(I ? 0x4e : 0x60); break;
    default:
      addError(env, line, `unknown operator "${op}"`);
      ctx.push(0x6a);
  }
  // comparisons produce i32
  return op === "+" || op === "-" || op === "*" || op === "/" || op === "%" ? t : "i32";
}

/** compile an expression; returns its type ("void" for void calls) */
function emitExpr(e: Expr, ctx: FuncCtx, env: EmitEnv): ValType | "void" {
  switch (e.k) {
    case "num": {
      if (e.t === "i32") ctx.push(0x41, ...sleb(Math.round(e.v)));
      else ctx.push(0x43, ...f32bytes(e.v));
      return e.t;
    }
    case "const": {
      ctx.push(0x41, ...sleb(e.v));
      return "i32";
    }
    case "str": {
      // a bare string is useless outside a call — treat as its pointer anyway
      const off = internString(env, e.s);
      ctx.push(0x41, ...sleb(off));
      return "i32";
    }
    case "var": {
      const r = resolveVar(env, ctx, e.name);
      if (!r) {
        addError(env, e.line, `unknown variable "${e.name}"`);
        ctx.push(0x41, 0);
        return "i32";
      }
      if (r.kind === "local") ctx.push(0x20, ...uleb(r.idx));
      else ctx.push(0x23, ...uleb(r.idx));
      return r.t;
    }
    case "un": {
      const t = emitExpr(e.a, ctx, env);
      if (t === "void") {
        addError(env, e.line, "operator needs a value");
        ctx.push(0x41, 0);
        return "i32";
      }
      if (e.op === "!") {
        coerce(ctx, t as ValType, "i32");
        ctx.push(0x45); // i32.eqz
        return "i32";
      }
      if (t === "f32") {
        ctx.push(0x8c); // f32.neg
        return t;
      }
      // i32 negation with x already on the stack: -x === x * -1
      ctx.push(0x41, ...sleb(-1), 0x6c);
      return t;
    }
    case "bin": {
      if (e.op === "&&" || e.op === "||") {
        const ta = emitExpr(e.a, ctx, env);
        if (ta === "void") {
          addError(env, e.line, "left side needs a value");
          ctx.push(0x41, 0); // keep the stack balanced for the if below
        } else coerce(ctx, ta, "i32");
        ctx.push(0x04, 0x7f); // if (result i32)
        ctx.labels.push("if");
        if (e.op === "&&") {
          const tb = emitExpr(e.b, ctx, env);
          if (tb === "void") {
            addError(env, e.line, "right side needs a value");
            ctx.push(0x41, 0);
          } else coerce(ctx, tb, "i32");
          ctx.push(0x05, 0x41, 0);
        } else {
          ctx.push(0x41, 1, 0x05);
          const tb = emitExpr(e.b, ctx, env);
          if (tb === "void") {
            addError(env, e.line, "right side needs a value");
            ctx.push(0x41, 0);
          } else coerce(ctx, tb, "i32");
        }
        ctx.push(0x0b); // end if
        ctx.labels.pop();
        return "i32";
      }
      const ta = emitExpr(e.a, ctx, env);
      const tb = emitExpr(e.b, ctx, env);
      if (ta === "void" || tb === "void") {
        addError(env, e.line, "operator needs values, not void calls");
        ctx.push(0x41, 0);
        return "i32";
      }
      return emitBin(ctx, e.op, ta, tb, e.line, env);
    }
    case "assign": {
      const r = resolveVar(env, ctx, e.name);
      if (!r) {
        addError(env, e.line, `unknown variable "${e.name}" (declare it: int ${e.name} = 0;)`);
        const tv = emitExpr(e.e, ctx, env);
        if (tv !== "void") ctx.push(0x1a); // keep the stack balanced
        return "void";
      }
      if (CONSTS[e.name] !== undefined) addError(env, e.line, `cannot assign to constant ${e.name}`);
      if (e.op === "=") {
        const t = emitExpr(e.e, ctx, env);
        if (t === "void") {
          addError(env, e.line, "cannot assign a void call");
          ctx.push(0x41, 0);
        } else coerce(ctx, t, r.t);
      } else {
        // load var, apply op, store
        if (r.kind === "local") ctx.push(0x20, ...uleb(r.idx));
        else ctx.push(0x23, ...uleb(r.idx));
        const t = emitExpr(e.e, ctx, env);
        if (t === "void") {
          addError(env, e.line, "cannot use a void call here");
          ctx.push(0x41, 0);
        } else coerce(ctx, t, r.t);
        ctx.push(r.t === "i32" ? 0x6a : 0x92); // add
      }
      if (r.kind === "local") ctx.push(0x21, ...uleb(r.idx));
      else ctx.push(0x24, ...uleb(r.idx));
      return "void";
    }
    case "call": {
      return emitCall(e, ctx, env);
    }
  }
}

function internString(env: EmitEnv, s: string): number {
  const existing = env.strings.get(s);
  if (existing !== undefined) return existing;
  const off = env.dataBytes.length;
  const b = utf8(s);
  env.dataBytes.push(...b, 0); // NUL-terminated
  env.strings.set(s, off);
  return off;
}

function emitCall(e: { k: "call"; name: string; args: Expr[]; line: number }, ctx: FuncCtx, env: EmitEnv): ValType | "void" {
  const arg = (i: number): ValType | "void" => (e.args[i] ? emitExpr(e.args[i], ctx, env) : (addError(env, e.line, `${e.name}() is missing argument ${i + 1}`), "i32"));
  const wantInt = (t: ValType | "void", what: string) => {
    if (t === "void") addError(env, e.line, `${what} must be a value`);
    else coerce(ctx, t, "i32");
  };
  switch (e.name) {
    case "heal":
    case "damage": {
      if (e.args.length !== 2) addError(env, e.line, `${e.name}(side, amount) takes 2 arguments`);
      wantInt(arg(0), "side");
      wantInt(arg(1), "amount");
      ctx.push(0x10, ...uleb(e.name === "heal" ? I_HEAL : I_DAMAGE));
      return "void";
    }
    case "run_skill": {
      if (e.args.length !== 2) addError(env, e.line, 'run_skill("skill", side) takes 2 arguments');
      const a0 = e.args[0];
      if (a0 && a0.k === "str") {
        const idx = SKILL_BY_NAME.get(a0.s);
        if (idx === undefined) {
          addError(env, e.line, `unknown skill "${a0.s}" — valid: ${ALL_SKILL_IDS.join(", ")}`);
          ctx.push(0x41, 0);
        } else ctx.push(0x41, ...sleb(idx));
      } else if (a0) {
        const t0 = emitExpr(a0, ctx, env);
        if (t0 === "void") {
          addError(env, e.line, "skill id must be a value");
          ctx.push(0x41, 0);
        } else coerce(ctx, t0, "i32");
      } else {
        ctx.push(0x41, 0);
      }
      wantInt(arg(1), "side");
      ctx.push(0x10, ...uleb(I_RUN_SKILL));
      return "void";
    }
    case "print": {
      if (e.args.length !== 1) addError(env, e.line, "print(x) takes 1 argument");
      const a0 = e.args[0];
      if (!a0) {
        ctx.push(0x41, 0);
        return "void";
      }
      if (a0.k === "str") {
        const off = internString(env, a0.s);
        ctx.push(0x41, ...sleb(off), 0x10, ...uleb(I_PRINT_STR));
        return "void";
      }
      const t = emitExpr(a0, ctx, env);
      if (t === "i32") ctx.push(0xb8); // f64.convert_i32_s
      else if (t === "f32") ctx.push(0xbb); // f64.promote_f32
      else {
        addError(env, e.line, "print needs a value");
        ctx.push(0x41, 0, 0xb8);
      }
      ctx.push(0x10, ...uleb(I_PRINT_NUM));
      return "void";
    }
    case "say": {
      const a0 = e.args[0];
      if (a0 && a0.k === "str") {
        const off = internString(env, a0.s);
        ctx.push(0x41, ...sleb(off), 0x10, ...uleb(I_SAY));
        return "void";
      }
      addError(env, e.line, 'say("text") needs a string');
      return "void";
    }
    case "hp": {
      if (e.args.length !== 1) addError(env, e.line, "hp(side) takes 1 argument");
      wantInt(arg(0), "side");
      ctx.push(0x10, ...uleb(I_HP));
      return "i32";
    }
    case "score": {
      ctx.push(0x10, ...uleb(I_SCORE));
      return "i32";
    }
    case "round": {
      ctx.push(0x10, ...uleb(I_ROUND));
      return "i32";
    }
    case "rand": {
      if (e.args.length !== 1) addError(env, e.line, "rand(n) takes 1 argument");
      wantInt(arg(0), "n");
      ctx.push(0x10, ...uleb(I_RAND));
      return "i32";
    }
    case "last_skill": {
      ctx.push(0x10, ...uleb(I_LAST_SKILL));
      return "i32";
    }
    case "chance": {
      // chance(p): 1 with p% probability, else 0
      if (e.args.length !== 1) addError(env, e.line, "chance(p) takes 1 argument (0-100)");
      wantInt(arg(0), "p");
      ctx.push(0x10, ...uleb(I_CHANCE));
      return "i32";
    }
    case "shuffle": {
      // shuffle(): scramble the remaining shell order
      if (e.args.length !== 0) addError(env, e.line, "shuffle() takes no arguments");
      ctx.push(0x10, ...uleb(I_SHUFFLE));
      return "void";
    }
    case "theme": {
      // theme(color): tint the room light (0 = back to warm default)
      if (e.args.length !== 1) addError(env, e.line, "theme(color) takes 1 argument (0xRRGGBB)");
      wantInt(arg(0), "color");
      ctx.push(0x10, ...uleb(I_THEME));
      return "void";
    }
    case "set_dmg_next": {
      // set_dmg_next(n): the next trigger pull deals n damage
      if (e.args.length !== 1) addError(env, e.line, "set_dmg_next(n) takes 1 argument");
      wantInt(arg(0), "n");
      ctx.push(0x10, ...uleb(I_SETDMG));
      return "void";
    }
    case "set_coin": {
      // set_coin(1|0): force the next gamble flip — heads (+1 HP) or tails (-1)
      if (e.args.length !== 1) addError(env, e.line, "set_coin(win) takes 1 argument (1 or 0)");
      wantInt(arg(0), "win");
      ctx.push(0x10, ...uleb(I_SETCOIN));
      return "void";
    }
    default:
      addError(env, e.line, `unknown function "${e.name}" — valid: heal damage run_skill print say hp score round rand last_skill chance shuffle theme set_dmg_next set_coin`);
      // consume arguments so the stack stays balanced
      for (const a of e.args) {
        const t = emitExpr(a, ctx, env);
        if (t !== "void") ctx.push(0x1a); // drop
      }
      return "void";
  }
}

function fuelGuard(ctx: FuncCtx) {
  ctx.push(0x10, ...uleb(I_FUEL));
}

function emitStmt(s: Stmt, ctx: FuncCtx, env: EmitEnv) {
  switch (s.k) {
    case "decl": {
      if (ctx.localIdx.has(s.name) || env.globals.has(s.name)) {
        addError(env, s.line, `"${s.name}" is already declared`);
      }
      const idx = ctx.locals.length;
      ctx.locals.push(s.t);
      ctx.localIdx.set(s.name, idx);
      if (s.init) {
        const t = emitExpr(s.init, ctx, env);
        if (t === "void") {
          addError(env, s.line, "cannot initialize from a void call");
          ctx.push(0x41, 0);
        } else coerce(ctx, t, s.t);
        ctx.push(0x21, ...uleb(idx));
      }
      break;
    }
    case "expr": {
      const t = emitExpr(s.e, ctx, env);
      if (t !== "void") ctx.push(0x1a); // drop stray value
      break;
    }
    case "if": {
      const t = emitExpr(s.cond, ctx, env);
      if (t === "void") {
        addError(env, s.line, "if condition must be a value");
        ctx.push(0x41, 0);
      } else coerce(ctx, t, "i32");
      ctx.push(0x04, 0x40); // if
      ctx.labels.push("if");
      for (const st of s.then) emitStmt(st, ctx, env);
      if (s.els.length) {
        ctx.push(0x05); // else
        for (const st of s.els) emitStmt(st, ctx, env);
      }
      ctx.push(0x0b); // end
      ctx.labels.pop();
      break;
    }
    case "while": {
      ctx.labels.push("block");
      ctx.push(0x02, 0x40); // block $exit
      ctx.labels.push("loop");
      ctx.push(0x03, 0x40); // loop $top
      fuelGuard(ctx);
      const t = emitExpr(s.cond, ctx, env);
      if (t === "void") {
        addError(env, s.line, "while condition must be a value");
        ctx.push(0x41, 0);
      } else coerce(ctx, t, "i32");
      ctx.push(0x45); // i32.eqz
      ctx.push(0x0d, ...uleb(1)); // br_if $exit
      for (const st of s.body) emitStmt(st, ctx, env);
      ctx.push(0x0c, 0); // br $top
      ctx.push(0x0b); // end loop
      ctx.push(0x0b); // end block
      ctx.labels.pop();
      ctx.labels.pop();
      break;
    }
    case "repeat": {
      // count evaluated once; n <= 0 loops forever (fuel guard stops it)
      const t = emitExpr(s.n, ctx, env);
      if (t === "void") {
        addError(env, s.line, "repeat count must be a value");
        ctx.push(0x41, 0);
      } else coerce(ctx, t, "i32");
      const cIdx = ctx.locals.length;
      ctx.locals.push("i32");
      ctx.push(0x21, ...uleb(cIdx)); // local.set $c
      ctx.labels.push("block");
      ctx.push(0x02, 0x40); // block $exit
      ctx.labels.push("loop");
      ctx.push(0x03, 0x40); // loop $top
      fuelGuard(ctx);
      ctx.push(0x20, ...uleb(cIdx)); // local.get $c
      ctx.push(0x45); // == 0 ?
      ctx.push(0x0d, ...uleb(1)); // br_if $exit
      for (const st of s.body) emitStmt(st, ctx, env);
      ctx.push(0x20, ...uleb(cIdx));
      ctx.push(0x41, 1, 0x6b);
      ctx.push(0x21, ...uleb(cIdx)); // c -= 1
      ctx.push(0x0c, 0); // br $top
      ctx.push(0x0b); // end loop
      ctx.push(0x0b); // end block
      ctx.labels.pop();
      ctx.labels.pop();
      break;
    }
    case "break": {
      // find the innermost loop; its wrapper block is one label below it
      let li = -1;
      for (let i = ctx.labels.length - 1; i >= 0; i--) {
        if (ctx.labels[i] === "loop") {
          li = i;
          break;
        }
      }
      if (li < 0) {
        addError(env, s.line, "break outside of a loop");
        ctx.push(0x00); // unreachable so the binary still validates
        return;
      }
      const depth = ctx.labels.length - 1 - (li - 1); // target the loop's wrapper block
      ctx.push(0x0c, ...uleb(depth));
      break;
    }
  }
}

/* ------------------------------------------------------------------ */
/* compile: tokens → AST → WASM binary                                 */
/* ------------------------------------------------------------------ */

export function compileScript(src: string): CompileResult {
  const { prog, errors } = parseProgram(src);
  const env: EmitEnv = {
    globals: new Map(),
    strings: new Map(),
    dataBytes: [],
    errors: [...errors],
  };

  // globals
  prog.globals.forEach((g, i) => {
    if (env.globals.has(g.name)) addError(env, g.line, `"${g.name}" is already declared`);
    else env.globals.set(g.name, { idx: i, t: g.t });
  });

  // hook functions (one function per event, merged bodies)
  const hookFuncs = SCRIPT_EVENTS.filter((ev) => prog.hooks.some((h) => h.event === ev)).map((ev) => {
    const ctx = new FuncCtx();
    const hook = prog.hooks.find((h) => h.event === ev)!;
    for (const st of hook.body) emitStmt(st, ctx, env);
    return { event: ev, ctx };
  });

  if (env.errors.length) {
    return { ok: false, errors: env.errors.slice(0, 8), hooks: [], bytes: null };
  }

  const T_FUNC_VOID_VOID = 5; // () -> ()
  const types: number[][] = [
    // 0: (i32,i32)->()
    [0x60, 2, 0x7f, 0x7f, 0],
    // 1: (f64)->()
    [0x60, 1, 0x7c, 0],
    // 2: (i32)->()
    [0x60, 1, 0x7f, 0],
    // 3: (i32)->i32
    [0x60, 1, 0x7f, 1, 0x7f],
    // 4: ()->i32
    [0x60, 0, 1, 0x7f],
    // 5: ()->()
    [0x60, 0, 0],
  ];
  const importFuncs: { name: string; type: number }[] = [
    { name: "heal", type: 0 },
    { name: "damage", type: 0 },
    { name: "run_skill", type: 0 },
    { name: "print_num", type: 1 },
    { name: "print_str", type: 2 },
    { name: "say", type: 2 },
    { name: "hp", type: 3 },
    { name: "score", type: 4 },
    { name: "round", type: 4 },
    { name: "rand", type: 3 },
    { name: "last_skill", type: 4 },
    { name: "fuel_check", type: T_FUNC_VOID_VOID },
    // ENGINE C v2
    { name: "chance", type: 3 }, // (i32)->i32
    { name: "shuffle", type: T_FUNC_VOID_VOID }, // ()->()
    { name: "theme", type: 2 }, // (i32)->()
    { name: "set_dmg_next", type: 2 },
    { name: "set_coin", type: 2 },
  ];

  const section = (id: number, payload: number[]): number[] => [...uleb(id), ...uleb(payload.length), ...payload];

  // ---- type section (1)
  let typePayload: number[] = [...uleb(types.length)];
  for (const t of types) typePayload.push(...t);
  // ---- import section (2)
  let importPayload: number[] = [...uleb(importFuncs.length)];
  for (const f of importFuncs) importPayload.push(...nameBytes("env"), ...nameBytes(f.name), 0x00, ...uleb(f.type));
  // ---- function section (3)
  const funcTypeIdx = hookFuncs.map(() => T_FUNC_VOID_VOID);
  let funcPayload: number[] = [...uleb(funcTypeIdx.length), ...funcTypeIdx.flatMap((t) => uleb(t))];
  // ---- memory section (5)
  const memoryPayload: number[] = [1, 0x00, 1]; // 1 memory, min 1 page
  // ---- global section (6)
  let globalPayload: number[] = [...uleb(prog.globals.length)];
  for (const g of prog.globals) {
    globalPayload.push(g.t === "i32" ? 0x7f : 0x7d, 0x01); // mutable
    if (g.t === "i32") globalPayload.push(0x41, ...sleb(Math.round(g.init ?? 0)), 0x0b);
    else globalPayload.push(0x43, ...f32bytes(g.init ?? 0), 0x0b);
  }
  // ---- export section (7)
  const exports: { name: string; kind: number; idx: number }[] = [
    { name: "memory", kind: 0x02, idx: 0 },
    ...hookFuncs.map((f, i) => ({ name: f.event, kind: 0x00, idx: importFuncs.length + i })),
  ];
  let exportPayload: number[] = [...uleb(exports.length)];
  for (const e of exports) exportPayload.push(...nameBytes(e.name), e.kind, ...uleb(e.idx));
  // ---- code section (10)
  let codePayload: number[] = [...uleb(hookFuncs.length)];
  for (const f of hookFuncs) {
    const localsDecl: number[] = [...uleb(f.ctx.locals.length)];
    for (const lt of f.ctx.locals) localsDecl.push(1, lt === "i32" ? 0x7f : 0x7d);
    const body = [...localsDecl, ...f.ctx.bytes, 0x0b];
    codePayload.push(...uleb(body.length), ...body);
  }
  // ---- data section (11)
  let dataPayload: number[] = [...uleb(env.dataBytes.length ? 1 : 0)];
  if (env.dataBytes.length) {
    dataPayload.push(0x00, 0x41, ...sleb(0), 0x0b); // segment at offset 0
    dataPayload.push(...uleb(env.dataBytes.length), ...env.dataBytes);
  }

  const bin: number[] = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  bin.push(...section(1, typePayload));
  bin.push(...section(2, importPayload));
  bin.push(...section(3, funcPayload));
  bin.push(...section(5, memoryPayload));
  bin.push(...section(6, globalPayload));
  bin.push(...section(7, exportPayload));
  bin.push(...section(10, codePayload));
  bin.push(...section(11, dataPayload));

  return {
    ok: true,
    errors: [],
    hooks: hookFuncs.map((f) => f.event),
    bytes: new Uint8Array(bin),
  };
}

/* ------------------------------------------------------------------ */
/* runtime: instantiate the module with the game host                  */
/* ------------------------------------------------------------------ */

function readCString(mem: WebAssembly.Memory, ptr: number): string {
  const buf = new Uint8Array(mem.buffer);
  let end = ptr;
  while (end < buf.length && buf[end] !== 0) end++;
  return new TextDecoder().decode(buf.subarray(ptr, end));
}

export class ScriptRuntime {
  private ex: Record<string, () => void> = {};
  private mem: WebAssembly.Memory | null = null;
  private fuel = 0;
  private saidError = false;
  lastSkill = -1;

  private constructor(
    private host: ScriptHost,
    private onFatal: (msg: string) => void,
  ) {}

  static async instantiate(bytes: Uint8Array, host: ScriptHost, onFatal?: (msg: string) => void): Promise<ScriptRuntime> {
    const rt = new ScriptRuntime(host, onFatal ?? (() => {}));
    const env = {
      heal: (s: number, n: number) => host.heal(rt.side(s), n),
      damage: (s: number, n: number) => host.damage(rt.side(s), n),
      run_skill: (id: number, s: number) => {
        const sid = ALL_SKILL_IDS[id];
        if (sid) host.runSkill(sid, rt.side(s));
      },
      print_num: (v: number) => host.say(Number.isInteger(v) ? String(v) : String(+v.toFixed(2))),
      print_str: (p: number) => host.say(rt.readStr(p)),
      say: (p: number) => host.say(rt.readStr(p)),
      hp: (s: number) => host.stateRef().hp[rt.side(s)] | 0,
      score: () => host.stateRef().score | 0,
      round: () => host.stateRef().round | 0,
      rand: (n: number) => (n > 0 ? Math.floor(Math.random() * n) : 0),
      last_skill: () => rt.lastSkill,
      fuel_check: () => {
        rt.fuel++;
        if (rt.fuel > MAX_FUEL) throw new Error("loop ran too long — fuel exhausted (use break or smaller repeat)");
      },
      // ENGINE C v2 — optional host methods fall back to sensible defaults
      chance: (p: number) => (host.chance ? (host.chance(p) ? 1 : 0) : Math.random() * 100 < p ? 1 : 0),
      shuffle: () => host.shuffle?.(),
      theme: (c: number) => host.theme?.(c >>> 0),
      set_dmg_next: (n: number) => host.setDmgNext?.(n),
      set_coin: (n: number) => host.setCoin?.(n !== 0 ? 1 : 0),
    };
    try {
      const { instance } = await WebAssembly.instantiate(
        bytes as unknown as ArrayBuffer,
        { env },
      );
      const ex = instance.exports as unknown as Record<string, unknown>;
      rt.mem = ex.memory as WebAssembly.Memory;
      for (const ev of SCRIPT_EVENTS) {
        if (typeof ex[ev] === "function") rt.ex[ev] = ex[ev] as () => void;
      }
      return rt;
    } catch (e) {
      throw new Error(`engine C failed to compile: ${(e as Error).message}`);
    }
  }

  private side(s: number): Side {
    return SIDE_BY_CODE[s] ?? "player";
  }

  private readStr(ptr: number): string {
    return this.mem ? readCString(this.mem, ptr) : "";
  }

  get hooks(): ScriptEventName[] {
    return SCRIPT_EVENTS.filter((e) => this.ex[e]);
  }

  has(event: ScriptEventName): boolean {
    return !!this.ex[event];
  }

  /** Fire a hook. Traps (fuel exhaustion, div by zero, ...) are caught once
   *  and reported through the host's say() — a broken rule never breaks the game. */
  fire(event: ScriptEventName, ctx: { skill?: SkillId } = {}) {
    const fn = this.ex[event];
    if (!fn) return;
    if (ctx.skill) this.lastSkill = ALL_SKILL_IDS.indexOf(ctx.skill);
    this.fuel = 0;
    try {
      fn();
    } catch (e) {
      if (!this.saidError) {
        this.saidError = true;
        const msg = e instanceof Error ? e.message : String(e);
        this.onFatal(`[ENGINE C] script stopped: ${msg}`);
      }
    }
  }
}
