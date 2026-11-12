/**
 * script.ts — the CUSTOM EFFECT mini-language (C-like, as requested).
 *
 * A tiny hand-rolled tokenizer + recursive-descent parser + interpreter.
 * It never throws on user input: everything becomes a list of readable
 * errors with line numbers, shown right in the mutator popup.
 *
 * SYNTAX (based on C — braces, `if`, assignments, semicolons optional):
 *
 *   # variables — int, float (desimal) or string
 *   shots = 0
 *   ratio = 2.5
 *   mood = "angry"
 *
 *   # one-shot rules (run once, at game start)
 *   heal player 1
 *   print "good luck kid"
 *
 *   # conditions — lhs OP rhs, where an operand is:
 *   #   hp player | hp dealer | score | round | a number | a variable | "text"
 *   if hp dealer <= 2 run skill cuffs to player
 *   if hp player == 3 {
 *     heal player 1
 *     print "hanging on"
 *   } else {
 *     damage dealer 1
 *   }
 *
 *   # loops — repeat N times; NEGATIVE N = infinite (needs break!)
 *   repeat 3 heal player 1
 *   repeat -1 {
 *     if hp dealer <= 2 {
 *       run skill coffee to dealer
 *       break
 *     }
 *     add shots 1
 *   }
 *
 *   # event hooks — the rule body runs every time the event fires
 *   every hit { ... }                        # every trigger pull
 *   every player take damage { ... }
 *   every dealer take damage { ... }
 *   every skill cuffs used { ... }           # one specific skill
 *   every skill all used { ... }             # any skill
 *   every turn { ... }                       # every turn start
 *   every round { ... }                      # every new round / reload
 *
 *   # commands
 *   run skill <id|all> to <player|dealer>    # force a skill's effect
 *   heal <player|dealer> <n|var>
 *   damage <player|dealer> <n|var>
 *   set <var> = <value>        (also plain  <var> = <value>)
 *   add <var> <n|var>          sub <var> <n|var>
 *   print <text|var|number>
 *   break                      # exit the innermost repeat (kills infinite loops)
 */

import type { Side } from "./logic";
import type { SkillId } from "./doodle";

/* ============================== AST ============================== */

export type Operand =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "var"; name: string }
  | { kind: "hp"; side: Side }
  | { kind: "score" }
  | { kind: "round" };

export type Expr = Operand;

export interface Cond {
  lhs: Operand;
  op: "==" | "!=" | ">" | "<" | ">=" | "<=";
  rhs: Operand;
}

export type Stmt =
  | { kind: "assign"; name: string; expr: Expr }
  | { kind: "add"; name: string; expr: Expr; sign: 1 | -1 }
  | { kind: "if"; cond: Cond; then: Stmt[]; else: Stmt[] }
  | { kind: "repeat"; count: Expr; body: Stmt[]; line: number }
  | { kind: "break"; line: number }
  | { kind: "runSkill"; skill: SkillId | "all"; target: Side; line: number }
  | { kind: "heal"; target: Side; amount: Expr; line: number }
  | { kind: "damage"; target: Side; amount: Expr; line: number }
  | { kind: "print"; parts: Operand[]; line: number };

export type ScriptEvent =
  | "hit"
  | "damage:player"
  | "damage:dealer"
  | "skill:all"
  | `skill:${SkillId}`
  | "turn"
  | "round";

export interface EventHandler {
  event: ScriptEvent;
  body: Stmt[];
  line: number;
}

export interface Program {
  setup: Stmt[];
  handlers: EventHandler[];
}

/* ============================ tokenizer ============================ */

interface Tok {
  t: "word" | "num" | "str" | "sym";
  v: string;
  line: number;
}

const SYMBOLS = ["==", "!=", ">=", "<=", "=", ">", "<", "{", "}", "(", ")", ";"];

function tokenize(src: string): { toks: Tok[]; errors: string[] } {
  const toks: Tok[] = [];
  const errors: string[] = [];
  const lines = src.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = i + 1;
    let s = raw;
    const hash = s.indexOf("#");
    if (hash >= 0) s = s.slice(0, hash); // # comments
    const slashes = s.indexOf("//");
    if (slashes >= 0) s = s.slice(0, slashes); // // comments too
    s = s.trim();
    if (!s) return;
    let j = 0;
    while (j < s.length) {
      const c = s[j];
      if (/\s/.test(c)) {
        j++;
        continue;
      }
      if (c === '"') {
        const end = s.indexOf('"', j + 1);
        if (end < 0) {
          errors.push(`line ${line}: string is missing its closing "`);
          break;
        }
        toks.push({ t: "str", v: s.slice(j + 1, end), line });
        j = end + 1;
        continue;
      }
      if (/[0-9]/.test(c) || (c === "-" && /[0-9.]/.test(s[j + 1] ?? ""))) {
        const m = /^-?[0-9]+(\.[0-9]+)?/.exec(s.slice(j));
        if (!m) {
          errors.push(`line ${line}: weird number near "${s.slice(j, j + 6)}"`);
          break;
        }
        toks.push({ t: "num", v: m[0], line });
        j += m[0].length;
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(j))!;
        toks.push({ t: "word", v: m[0].toLowerCase(), line });
        j += m[0].length;
        continue;
      }
      const sym = SYMBOLS.find((y) => s.startsWith(y, j));
      if (sym) {
        toks.push({ t: "sym", v: sym, line });
        j += sym.length;
        continue;
      }
      errors.push(`line ${line}: I don't know the symbol "${c}"`);
      j++;
    }
  });
  return { toks, errors };
}

/* ============================== parser ============================== */

const SIDE_WORDS = new Set(["player", "dealer", "enemy", "you", "me"]);
const SIDE_MAP: Record<string, Side> = { player: "player", you: "player", me: "player", dealer: "enemy", enemy: "enemy" };
const OPS = ["==", "!=", ">=", "<=", ">", "<"];

export function parseScript(src: string): { program: Program; errors: string[] } {
  const { toks, errors } = tokenize(src);
  const program: Program = { setup: [], handlers: [] };
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];

  const err = (msg: string, line?: number) => {
    errors.push(`line ${line ?? peek()?.line ?? "?"}: ${msg}`);
  };

  /** An operand: number, string, variable, hp X, score, round. */
  const parseOperand = (): Operand | null => {
    const t = peek();
    if (!t) return null;
    if (t.t === "num") {
      next();
      return { kind: "num", value: parseFloat(t.v) };
    }
    if (t.t === "str") {
      next();
      return { kind: "str", value: t.v };
    }
    if (t.t === "word") {
      if (t.v === "hp" || t.v === "health") {
        next();
        const s = peek();
        if (s && s.t === "word" && SIDE_WORDS.has(s.v)) {
          next();
          return { kind: "hp", side: SIDE_MAP[s.v] };
        }
        err("hp needs a side: hp player / hp dealer");
        return null;
      }
      if (t.v === "score") {
        next();
        return { kind: "score" };
      }
      if (t.v === "round") {
        next();
        return { kind: "round" };
      }
      next();
      return { kind: "var", name: t.v };
    }
    return null;
  };

  const parseSide = (what: string): Side | null => {
    const t = peek();
    if (t && t.t === "word" && SIDE_WORDS.has(t.v)) {
      next();
      return SIDE_MAP[t.v];
    }
    err(`${what} needs player or dealer`);
    return null;
  };

  /** A single statement (no braces): assignment, command, if-without-braces... */
  const parseSimple = (): Stmt | null => {
    const t = peek();
    if (!t) return null;
    const line = t.line;

    // `if <cond> <simple statement>` (single-line if without braces)
    if (t.t === "word" && t.v === "if") {
      next();
      const cond = parseCond();
      if (!cond) return null;
      const body: Stmt[] = [];
      const inner = parseSimple();
      if (inner) body.push(inner);
      else err("expected a statement after the if condition", line);
      // optional else on the same line (rare but legal C-ish)
      let els: Stmt[] = [];
      const e = peek();
      if (e && e.t === "word" && e.v === "else") {
        next();
        const innerE = parseSimple();
        if (innerE) els.push(innerE);
        else err("expected a statement after else", line);
      }
      return { kind: "if", cond, then: body, else: els };
    }

    // `repeat <n> <simple statement>`
    if (t.t === "word" && t.v === "repeat") {
      next();
      const count = parseOperand();
      if (!count) {
        err("repeat needs a number or a variable", line);
        return null;
      }
      const inner = parseSimple();
      if (!inner) {
        err("expected a statement after repeat", line);
        return null;
      }
      return { kind: "repeat", count, body: [inner], line };
    }

    if (t.t === "word" && t.v === "break") {
      next();
      return { kind: "break", line };
    }

    if (t.t === "word" && t.v === "run") {
      next();
      const w = peek();
      if (!w || w.t !== "word" || (w.v !== "skill" && w.v !== "card")) {
        err("run needs: run skill <name|all> to <player|dealer>", line);
        return null;
      }
      next();
      const idTok = peek();
      if (!idTok || idTok.t !== "word") {
        err("which skill? run skill <name|all> to <player|dealer>", line);
        return null;
      }
      next();
      const skill = idTok.v === "all" || idTok.v === "random" ? "all" : (idTok.v as SkillId);
      const to = peek();
      if (!to || to.t !== "word" || to.v !== "to") {
        err("run skill needs `to`: run skill cuffs to player", line);
        return null;
      }
      next();
      const target = parseSide("run skill ... to");
      if (!target) return null;
      return { kind: "runSkill", skill, target, line };
    }

    if (t.t === "word" && (t.v === "heal" || t.v === "damage")) {
      next();
      const target = parseSide(t.v);
      if (!target) return null;
      const amount = parseOperand();
      if (!amount) {
        err(`${t.v} needs an amount (number or variable)`, line);
        return null;
      }
      return t.v === "heal"
        ? { kind: "heal", target, amount, line }
        : { kind: "damage", target, amount, line };
    }

    if (t.t === "word" && (t.v === "add" || t.v === "sub")) {
      next();
      const n = peek();
      if (!n || n.t !== "word") {
        err(`${t.v} needs a variable name`, line);
        return null;
      }
      next();
      const amount = parseOperand();
      if (!amount) {
        err(`${t.v} needs an amount`, line);
        return null;
      }
      return { kind: "add", name: n.v, expr: amount, sign: t.v === "add" ? 1 : -1 };
    }

    if (t.t === "word" && t.v === "set") {
      next(); // `set x = 5` — sugar for `x = 5`
    }

    if (t.t === "word" && t.v === "print") {
      next();
      const parts: Operand[] = [];
      for (;;) {
        const p = peek();
        if (!p || (p.t === "sym" && (p.v === ";" || p.v === "}"))) break;
        const op = parseOperand();
        if (!op) break;
        parts.push(op);
      }
      if (!parts.length) {
        err("print needs something to say", line);
        return null;
      }
      return { kind: "print", parts, line };
    }

    // plain assignment: name = value
    if (t.t === "word") {
      const name = t.v;
      // reserved words can't be variables
      if (["every", "if", "else", "repeat", "break", "run", "skill", "to", "heal", "damage", "add", "sub", "print", "hp", "score", "round", "set", "all", "used", "take"].includes(name)) {
        err(`unexpected word "${name}"`, line);
        // skip the line to keep parsing
        while (peek() && !(peek().t === "sym" && peek().v === "}")) next();
        return null;
      }
      next();
      const eq = peek();
      if (eq && eq.t === "sym" && eq.v === "=") {
        next();
        const expr = parseOperand();
        if (!expr) {
          err("assignment needs a value (number, 3.14-style decimal or \"text\")", line);
          return null;
        }
        return { kind: "assign", name, expr };
      }
      err(`unknown command "${name}"`, line);
      return null;
    }

    err(`unexpected "${t.v}"`, t.line);
    next();
    return null;
  };

  const parseCond = (): Cond | null => {
    const lhs = parseOperand();
    if (!lhs) return null;
    const op = peek();
    if (!op || op.t !== "sym" || !OPS.includes(op.v)) {
      err("condition needs an operator: == != > < >= <=");
      return null;
    }
    next();
    const rhs = parseOperand();
    if (!rhs) return null;
    return { lhs, op: op.v as Cond["op"], rhs };
  };

  /** A block: either { ... } or a single simple statement. */
  const parseBlock = (): Stmt[] | null => {
    const t = peek();
    if (t && t.t === "sym" && t.v === "{") {
      next();
      const body: Stmt[] = [];
      for (;;) {
        const p = peek();
        if (!p) {
          err("missing closing }");
          return body;
        }
        if (p.t === "sym" && p.v === "}") {
          next();
          return body;
        }
        if (p.t === "sym" && p.v === ";") {
          next();
          continue;
        }
        const st = parseStatement();
        if (st) body.push(...st);
      }
    }
    const inner = parseSimple();
    return inner ? [inner] : null;
  };

  /** Full statement: simple, or `if cond { } else { }`, or `repeat n { }`. */
  const parseStatement = (): Stmt[] | null => {
    const t = peek();
    if (!t) return null;
    if (t.t === "word" && t.v === "if") {
      next();
      const line = t.line;
      const cond = parseCond();
      if (!cond) return null;
      const then = parseBlock() ?? [];
      let els: Stmt[] = [];
      const e = peek();
      if (e && e.t === "word" && e.v === "else") {
        next();
        els = parseBlock() ?? [];
      }
      return [{ kind: "if", cond, then, else: els }];
    }
    if (t.t === "word" && t.v === "repeat") {
      next();
      const line = t.line;
      const count = parseOperand();
      if (!count) {
        err("repeat needs a number or variable (negative = infinite)", line);
        return null;
      }
      const body = parseBlock();
      if (!body) {
        err("repeat needs a { block } or a statement", line);
        return null;
      }
      return [{ kind: "repeat", count, body, line }];
    }
    const st = parseSimple();
    return st ? [st] : null;
  };

  /* top level: `every ...` handlers + free-floating setup statements */
  for (;;) {
    const t = peek();
    if (!t) break;
    if (t.t === "sym" && t.v === ";") {
      next();
      continue;
    }
    if (t.t === "word" && t.v === "every") {
      next();
      const line = t.line;
      const w = peek();
      if (!w || w.t !== "word") {
        err("every needs an event: every hit / every dealer take damage / every skill cuffs used", line);
        break;
      }
      let event: ScriptEvent | null = null;
      if (w.v === "hit" || w.v === "shot" || w.v === "shoot") {
        next();
        event = "hit";
      } else if (w.v === "turn") {
        next();
        event = "turn";
      } else if (w.v === "round") {
        next();
        event = "round";
      } else if (SIDE_WORDS.has(w.v)) {
        const side = SIDE_MAP[w.v];
        next();
        const take = peek();
        if (take && take.t === "word" && take.v === "take") {
          next();
          const dmg = peek();
          if (dmg && dmg.t === "word" && dmg.v === "damage") {
            next();
            event = side === "player" ? "damage:player" : "damage:dealer";
          } else {
            err("did you mean `every player take damage` or `every dealer take damage`?", line);
            break;
          }
        } else {
          err("did you mean `every player take damage` or `every dealer take damage`?", line);
          break;
        }
      } else if (w.v === "skill" || w.v === "skills") {
        next();
        const idTok = peek();
        if (!idTok || idTok.t !== "word") {
          err("every skill needs a name: every skill cuffs used", line);
          break;
        }
        next();
        const skill = idTok.v === "all" || idTok.v === "any" ? "all" : (idTok.v as SkillId);
        // optional trailing "used" / "is used"
        const u = peek();
        if (u && u.t === "word" && u.v === "used") next();
        const u2 = peek();
        if (u2 && u2.t === "word" && u2.v === "used") next();
        event = skill === "all" ? "skill:all" : (`skill:${skill}` as ScriptEvent);
      } else {
        err(`unknown event "every ${w.v}" — try: hit, player take damage, dealer take damage, skill <name> used`, line);
        break;
      }
      const body = parseBlock();
      if (!body) {
        err("every needs a { block }", line);
        break;
      }
      program.handlers.push({ event: event!, body, line });
      continue;
    }
    const sts = parseStatement();
    if (sts) program.setup.push(...sts);
  }

  return { program, errors };
}

/* ============================ runtime ============================ */

export type ScriptValue = number | string;

export interface ScriptHooks {
  /** Force a skill's effect onto a side. */
  runSkill(id: SkillId | "all", target: Side): void;
  /** Heal a side (ENDLESS: healing the dealer drains the score). */
  heal(side: Side, amount: number): void;
  /** Damage a side (ENDLESS: hurting the dealer feeds the score). */
  damage(side: Side, amount: number): void;
  /** Say something on screen. */
  say(text: string): void;
}

export interface ScriptContext {
  skill?: SkillId;
  side?: Side;
}

const MAX_STEPS = 400; // per event fire — runaway rules just stop
const MAX_REPEAT = 5000; // per repeat statement

function sideOf(s: Side | undefined): Side {
  return s === "enemy" ? "enemy" : "player";
}

export class ScriptRuntime {
  private vars = new Map<string, ScriptValue>();
  private steps = 0;

  constructor(
    private program: Program,
    private hooks: ScriptHooks,
  ) {}

  /** Setup statements run once, when the match starts. */
  setup() {
    this.steps = 0;
    this.exec(this.program.setup, {});
  }

  /** Fire an event: every matching handler runs. */
  fire(event: ScriptEvent, ctx: ScriptContext = {}) {
    this.steps = 0;
    for (const h of this.program.handlers) {
      if (h.event === event) this.exec(h.body, ctx);
    }
  }

  private value(op: Operand, ctx: ScriptContext): ScriptValue {
    switch (op.kind) {
      case "num":
        return op.value;
      case "str":
        return op.value;
      case "var": {
        const v = this.vars.get(op.name);
        if (v === undefined) return 0;
        return v;
      }
      case "hp": {
        const st = this.stateRef();
        return st ? (st.hp[op.side] ?? 0) : 0;
      }
      case "score":
        return this.stateRef()?.score ?? 0;
      case "round":
        return this.stateRef()?.round ?? 0;
    }
  }

  /** Injected by the engine: lets operands read the live game state. */
  stateRef: () => { hp: Record<Side, number>; score: number; round: number } | null = () => null;

  private num(v: ScriptValue): number {
    if (typeof v === "number") return v;
    const n = parseFloat(v);
    return Number.isNaN(n) ? 0 : n;
  }

  private test(c: Cond, ctx: ScriptContext): boolean {
    const a = this.value(c.lhs, ctx);
    const b = this.value(c.rhs, ctx);
    if (typeof a === "string" || typeof b === "string") {
      const sa = String(a);
      const sb = String(b);
      switch (c.op) {
        case "==":
          return sa === sb;
        case "!=":
          return sa !== sb;
        case ">":
          return sa > sb;
        case "<":
          return sa < sb;
        case ">=":
          return sa >= sb;
        case "<=":
          return sa <= sb;
      }
    }
    const x = this.num(a);
    const y = this.num(b);
    switch (c.op) {
      case "==":
        return x === y;
      case "!=":
        return x !== y;
      case ">":
        return x > y;
      case "<":
        return x < y;
      case ">=":
        return x >= y;
      case "<=":
        return x <= y;
    }
  }

  /** Execute statements. `brk` bubbles out of the innermost repeat. */
  private exec(body: Stmt[], ctx: ScriptContext): void {
    for (const st of body) {
      if (this.steps++ > MAX_STEPS) {
        this.hooks.say("[custom rules] too many steps — rule stopped");
        return;
      }
      const r = this.execOne(st, ctx);
      if (r) return;
    }
  }

  /** returns true when a break happened */
  private execOne(st: Stmt, ctx: ScriptContext): boolean {
    switch (st.kind) {
      case "assign": {
        this.vars.set(st.name, this.value(st.expr, ctx));
        return false;
      }
      case "add": {
        const cur = this.num(this.vars.get(st.name) ?? 0);
        const d = this.num(this.value(st.expr, ctx));
        this.vars.set(st.name, cur + st.sign * d);
        return false;
      }
      case "if": {
        if (this.test(st.cond, ctx)) this.exec(st.then, ctx);
        else this.exec(st.else, ctx);
        return false;
      }
      case "repeat": {
        const raw = this.value(st.count, ctx);
        let n = Math.floor(this.num(raw));
        const infinite = n < 0;
        if (infinite) n = MAX_REPEAT;
        for (let k = 0; k < n; k++) {
          if (this.steps++ > MAX_STEPS) {
            this.hooks.say(`[custom rules] line ${st.line}: repeat ran too long — stopped`);
            return true;
          }
          let broke = false;
          for (const inner of st.body) {
            if (this.steps++ > MAX_STEPS) {
              this.hooks.say(`[custom rules] too many steps — rule stopped`);
              broke = true;
              break;
            }
            if (inner.kind === "break") {
              broke = true;
              break;
            }
            if (this.execOne(inner, ctx)) {
              broke = true;
              break;
            }
          }
          if (broke) break;
        }
        return false;
      }
      case "break":
        return true;
      case "runSkill":
        this.hooks.runSkill(st.skill, st.target);
        return false;
      case "heal":
        this.hooks.heal(st.target, Math.round(this.num(this.value(st.amount, ctx))));
        return false;
      case "damage":
        this.hooks.damage(st.target, Math.round(this.num(this.value(st.amount, ctx))));
        return false;
      case "print": {
        const text = st.parts
          .map((p) => {
            const v = this.value(p, ctx);
            return typeof v === "string" ? v : String(v);
          })
          .join(" ");
        this.hooks.say(text);
        return false;
      }
    }
  }
}
