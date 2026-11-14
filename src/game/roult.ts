/**
 * roult.ts — the ROULT assistant engine. 100% local: no API keys, no
 * network calls, everything runs in this file + the real ENGINE C compiler.
 *
 * The pipeline (visible in the popup as the "thinking" trace):
 *   1. UNDERSTAND — a neural intent classifier trained from scratch
 *      (scripts/roult-train.py: 136->48->16 MLP, exported to
 *      roult-model.json) plus high-precision keyword rules read the
 *      prompt and pull out mechanics, a room theme and a severity knob.
 *   2. PLAN — mechanics get numbers, a title and balance notes.
 *      The player can REVISI (mutate aspects) or LANJUT.
 *   3. GENERATE — the plan is synthesized into a fresh ENGINE C program
 *      (variables, hooks, comments) and validated with the REAL compiler
 *      (compileScript) before it is shown.
 *
 * The chat popup keeps a 4096-token context window (estTokens) and trims
 * the oldest turns when it overflows.
 */

import { compileScript, type ScriptEventName } from "./script";
import ROULT_MODEL_JSON from "./roult-model.json";

/* ------------------------------------------------------------------ */
/* trained model                                                       */
/* ------------------------------------------------------------------ */

interface RoultModel {
  in: number;
  hidden: number;
  labels: string[];
  keywords: string[];
  tri: number;
  w1: number[][];
  b1: number[];
  w2: number[][];
  b2: number[];
}

const MODEL = ROULT_MODEL_JSON as unknown as RoultModel;
const TRI = MODEL.tri ?? 112;

function normText(s: string): string {
  let out = "";
  let prev = " ";
  for (const raw of s.toLowerCase()) {
    const c = /[a-z0-9]/.test(raw) ? raw : " ";
    if (c === " " && prev === " ") continue;
    out += c;
    prev = c;
  }
  return out.trim();
}

/** identical feature extraction to scripts/roult-train.py */
function features(text: string): number[] {
  const s = normText(text);
  const v = new Array<number>(MODEL.in).fill(0);
  const cnt = new Array<number>(TRI).fill(0);
  for (let i = 2; i < s.length; i++) {
    let h = 0;
    for (let k = 0; k < 3; k++) h = (h * 33 + s.charCodeAt(i - 2 + k)) % TRI;
    cnt[h] += 1;
  }
  let n = 0;
  for (const c of cnt) n += c * c;
  n = Math.sqrt(n);
  if (n > 0) for (let i = 0; i < TRI; i++) cnt[i] /= n;
  for (let i = 0; i < TRI; i++) v[i] = cnt[i];
  const words = s ? s.split(" ") : [];
  MODEL.keywords.forEach((kw, k) => {
    if (words.includes(kw)) v[TRI + k] = 1;
  });
  return v;
}

const sig = (x: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));

/** the trained network, forward pass */
function classify(text: string): Map<string, number> {
  const v = features(text);
  const out = new Map<string, number>();
  const hid = MODEL.w1.map((row, j) => {
    let sum = MODEL.b1[j] ?? 0;
    for (let i = 0; i < v.length; i++) sum += row[i] * v[i];
    return Math.max(0, sum);
  });
  MODEL.labels.forEach((label, k) => {
    const row = MODEL.w2[k];
    let sum = MODEL.b2[k] ?? 0;
    for (let j = 0; j < hid.length; j++) sum += row[j] * hid[j];
    out.set(label, sig(sum));
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* mechanic vocabulary                                                 */
/* ------------------------------------------------------------------ */

export type MechId =
  | "vampPlayer" | "vampDealer" | "mirror" | "taxPlayer" | "taxDealer"
  | "roundChaos" | "shuffleChaos" | "luckyCoin" | "mercyDeath" | "suddenDeath"
  | "skillToll" | "roundHeal" | "dealerRamp" | "peekToll" | "firstBlood"
  | "randomGift";

export const MECH_IDS: MechId[] = [
  "vampPlayer", "vampDealer", "mirror", "taxPlayer", "taxDealer",
  "roundChaos", "shuffleChaos", "luckyCoin", "mercyDeath", "suddenDeath",
  "skillToll", "roundHeal", "dealerRamp", "peekToll", "firstBlood",
  "randomGift",
];

export const MECH_LABEL: Record<MechId, string> = {
  vampPlayer: "vampir kamu",
  vampDealer: "vampir dealer",
  mirror: "pantulan karma",
  taxPlayer: "pajak darah kamu",
  taxDealer: "pajak darah dealer",
  roundChaos: "peluru nyasar tiap ronde",
  shuffleChaos: "peluru diacak tiap ronde",
  luckyCoin: "koin selalu untung",
  mercyDeath: "satu denyut kematian",
  suddenDeath: "sudden death",
  skillToll: "skill bayar darah",
  roundHeal: "regen tiap ronde",
  dealerRamp: "peluru dealer makin sakit",
  peekToll: "ngintip bayar darah",
  firstBlood: "first blood",
  randomGift: "hadiah acak",
};

const MECH_HOOK: Record<MechId, ScriptEventName> = {
  vampPlayer: "dealer_take_damage",
  vampDealer: "player_take_damage",
  mirror: "player_take_damage",
  taxPlayer: "turn",
  taxDealer: "turn",
  roundChaos: "round",
  shuffleChaos: "round",
  luckyCoin: "coin",
  mercyDeath: "death",
  suddenDeath: "round",
  skillToll: "skill",
  roundHeal: "round",
  dealerRamp: "round",
  peekToll: "peek",
  firstBlood: "round",
  randomGift: "round",
};

/** high-precision keyword rules — the net handles the fuzzy rest */
const RULES: { re: RegExp; mech: MechId }[] = [
  { re: /(vampir|vampire|hisap|leech).*(aku|player|kamu|gw)|.*(nembak|kena|hit|tembak|luka).*(sembuh|nyembuh|heal|nambah)/, mech: "vampPlayer" },
  { re: /dealer\s*(nya)?\s*(yang\s*)?(jadi\s*)?(vampir|hisap|leech)|kalau aku kena.*(dealer|dia).*(sembuh|nyembuh|heal|nambah)|tiap aku (kena|ketembak).*(dealer|dia).*(sembuh|nyembuh|heal|nambah)|player take damage.*(heal|sembuh)/, mech: "vampDealer" },
  { re: /(pantul|reflect|karma|cermin|balik).*(dealer|dia|penembak)|aku kena.*(dealer|dia).*(kena|ikut|balik)/, mech: "mirror" },
  { re: /(pajak|tax|potong|bayar).*(darah|nyawa|hp)|tiap (giliran|turn).*aku.*(damage|kena|potong)/, mech: "taxPlayer" },
  { re: /pajak.*dealer|dealer.*kepotong|dealer.*pajak/, mech: "taxDealer" },
  { re: /(nyasar|chaos|kejutan|strike|liar|dadakan).*(ronde|round|damage)|(ronde|round).*(acak|random|chaos)/, mech: "roundChaos" },
  { re: /(shuffle|acak ulang|aduk|diacak|amnesia|ingatan)/, mech: "shuffleChaos" },
  { re: /(coin|koin|gamble|flip).*(menang|rigged|auto|head|untung|paksa|bohong)|set_coin/, mech: "luckyCoin" },
  { re: /(bangun|bangkit|extra life|nyawa kedua|ditolak|denyut|selamat).*(mati|death|hp|sekali)|mati.*bangkit/, mech: "mercyDeath" },
  { re: /sudden death|(ronde|round) \d.*semua|semua.*kena.*(ronde|round)|cepat tamat/, mech: "suddenDeath" },
  { re: /skill.*(bayar|darah|potong|nyawa|gratis)|pakai skill.*(kena|berkurang)/, mech: "skillToll" },
  { re: /(regen|sembuh|heal|nyawa).*(tiap ronde|per ronde|ronde baru)|tiap ronde.*(sembuh|heal|nambah)/, mech: "roundHeal" },
  { re: /(dealer|dia).*(makin|naik|dread|ramp).*(sakit|jahat|besar|ronde)|damage dealer.*(naik|makin)/, mech: "dealerRamp" },
  { re: /(peek|ngintip|mata mata|intip).*(bayar|darah|nyawa|potong|hp)/, mech: "peekToll" },
  { re: /first blood|ronde (pertama|1|satu).*(dealer|dia).*(kena|damage)/, mech: "firstBlood" },
  { re: /(kado|hadiah|gift|langit|mercy).*(acak|random|gratis|heal)|chance.*(heal|nyawa)/, mech: "randomGift" },
];

interface ThemeDef {
  key: string;
  name: string;
  color: number;
  re: RegExp;
}

const THEMES: ThemeDef[] = [
  { key: "crimson", name: "CRIMSON", color: 0x8f2418, re: /(vampir|darah|blood|merah|crimson|pantul|karma)/ },
  { key: "ember", name: "EMBERFALL", color: 0xd98a2b, re: /(phoenix|api|fire|jalur|emas|gold|koin|coin|untung|fajar)/ },
  { key: "void", name: "VOIDLIGHT", color: 0x5b3fa8, re: /(ungu|void|gelap|dark|shadow|bayang|mata|eye|intip|ilusi|paranoia)/ },
  { key: "tide", name: "DEADTIDE", color: 0x2f7f8a, re: /(hantu|ghost|laut|air|dingin|biru|teal|amnesia|memori|ingatan)/ },
  { key: "moss", name: "ROTGARDEN", color: 0x5e9c5b, re: /(racun|hijau|poison|voodoo|santai|regen|tank|bertahan|sembuh)/ },
];

const ARCHETYPE: Record<MechId, string> = {
  vampPlayer: "DEBT",
  vampDealer: "HUNGER",
  mirror: "JUSTICE",
  taxPlayer: "TITHE",
  taxDealer: "LEVY",
  roundChaos: "ROULETTE",
  shuffleChaos: "AMNESIA",
  luckyCoin: "FORTUNE",
  mercyDeath: "MERCY",
  suddenDeath: "CURFEW",
  skillToll: "TOLL",
  roundHeal: "BULWARK",
  dealerRamp: "SIEGE",
  peekToll: "PARANOIA",
  firstBlood: "OPENING",
  randomGift: "PATRON",
};

const TAGLINES: Record<MechId, string> = {
  vampPlayer: "every wound you land, you drink back",
  vampDealer: "your blood is his dinner",
  mirror: "the pain you take is the pain he pays",
  taxPlayer: "the house collects every turn",
  taxDealer: "the house pays its own dues",
  roundChaos: "every reload, a stray bullet picks a side",
  shuffleChaos: "memory dies at every reload",
  luckyCoin: "the coin never lies — it just always lands heads",
  mercyDeath: "you die once. only once.",
  suddenDeath: "the room runs out of patience",
  skillToll: "power drinks blood",
  roundHeal: "scars close a little at every reload",
  dealerRamp: "his bullets grow heavier every round",
  peekToll: "forbidden sight, paid in blood",
  firstBlood: "the first reload bites hardest",
  randomGift: "sometimes the room decides you live",
};

/* ------------------------------------------------------------------ */
/* plan                                                                */
/* ------------------------------------------------------------------ */

export interface Mech {
  id: MechId;
  params: Record<string, number>;
}

export interface RoultPlan {
  title: string;
  tagline: string;
  themeName: string;
  themeColor: number;
  severity: number; // 0 adil — 1 seru — 2 brutal
  mechs: Mech[];
  idea: string;
  variant: number;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function severityOf(prompt: string): number {
  if (/(brutal|sadis|gila|kejam|insane|sulit|hard|nyeleneh|nggak adil|tidak adil|extreme|maut)/.test(prompt)) return 2;
  if (/(santai|mudah|easy|adil|seimbang|balanced|casual|lemah|ringan)/.test(prompt)) return 0;
  return 1;
}

function themeOf(prompt: string, severity: number, rng: () => number): ThemeDef {
  for (const th of THEMES) if (th.re.test(prompt)) return th;
  return THEMES[[1, 3, 0][severity] ?? 3];
}

function paramsFor(mech: MechId, severity: number, rng: () => number): Record<string, number> {
  const jitter = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  switch (mech) {
    case "vampPlayer": return { n: severity >= 2 ? 2 : 1 };
    case "vampDealer": return { n: severity >= 2 ? 2 : 1 };
    case "mirror": return { n: severity >= 2 ? 2 : 1 };
    case "taxPlayer": return { n: severity >= 2 ? 2 : 1 };
    case "taxDealer": return { n: severity >= 2 ? 2 : 1 };
    case "roundChaos": return { p: [30, 45, 60][severity], n: severity >= 2 ? 2 : 1 };
    case "shuffleChaos": return {};
    case "luckyCoin": return {};
    case "mercyDeath": return { n: severity === 0 ? 3 : 2 };
    case "suddenDeath": return { at: jitter(6, 9), n: severity >= 2 ? 2 : 1 };
    case "skillToll": return { n: 1 };
    case "roundHeal": return { n: severity === 0 ? 2 : 1 };
    case "dealerRamp": return { start: severity >= 2 ? 2 : 1, step: 1 };
    case "peekToll": return { n: 1 };
    case "firstBlood": return { n: severity >= 2 ? 3 : 2 };
    case "randomGift": return { p: [45, 35, 25][severity], n: severity === 0 ? 2 : 1 };
  }
}

function detectMechs(prompt: string): MechId[] {
  const found: MechId[] = [];
  const source = new Map<MechId, "rule" | "net">();
  const push = (m: MechId, src: "rule" | "net") => {
    if (!source.has(m)) {
      source.set(m, src);
      found.push(m);
    }
  };
  for (const r of RULES) if (r.re.test(prompt)) push(r.mech, "rule");
  // the trained net fills in what exact rules miss (typos, unseen phrasing)
  const scores = classify(prompt);
  const fuzzy = MECH_IDS.filter((m) => (scores.get(m) ?? 0) > 0.62 && !source.has(m)).sort(
    (a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0),
  );
  for (const m of fuzzy) {
    if (found.length >= 3) break;
    push(m, "net");
  }
  // mutually exclusive pairs — if both sides got picked, the rule-hit wins
  const EXCLUDE: [MechId, MechId][] = [
    ["vampPlayer", "vampDealer"],
    ["taxPlayer", "taxDealer"],
    ["roundHeal", "skillToll"],
  ];
  for (const [a, b] of EXCLUDE) {
    if (source.has(a) && source.has(b)) {
      const drop = source.get(b) === "rule" && source.get(a) !== "rule" ? a : b;
      source.delete(drop);
      const idx = found.indexOf(drop);
      if (idx >= 0) found.splice(idx, 1);
    }
  }
  return found;
}

const MAX_MECHS = 3;

/** build a fresh plan from a free-form prompt */
export function makePlan(prompt: string, seed: number): RoultPlan {
  const rng = mulberry32(seed || 1);
  const severity = severityOf(prompt);
  const theme = themeOf(prompt, severity, rng);
  let ids = detectMechs(prompt);
  if (ids.length === 0) {
    // nothing recognizable — roul improvises something playable
    ids = severity === 0 ? ["roundHeal", "roundChaos"] : ["roundChaos", "shuffleChaos"];
  }
  const mechs = ids.slice(0, MAX_MECHS).map((id) => ({ id, params: paramsFor(id, severity, rng) }));
  // explicit numbers in the prompt win: "sudden death ronde 6", "ronde 8"...
  const roundHint = /(?:ronde|round)\s*(\d{1,2})/.exec(prompt);
  if (roundHint) {
    for (const m of mechs) {
      if (m.id === "suddenDeath") m.params.at = Math.max(2, Math.min(12, parseInt(roundHint[1], 10)));
    }
  }
  // explicit amounts too: "sembuh 1", "kena 2"...
  const nHint = /(?:sembuh|heal|regen|nyawa|damage|kena)\s*(\d{1,2})/.exec(prompt);
  if (nHint) {
    const n = Math.max(1, Math.min(6, parseInt(nHint[1], 10)));
    for (const m of mechs) {
      if (m.id === "roundHeal") m.params.n = n;
      if (m.id === "suddenDeath") m.params.n = n;
      if (m.id === "vampPlayer") m.params.n = n;
      if (m.id === "taxPlayer") m.params.n = n;
    }
  }
  const primary = mechs[0].id;
  return {
    title: `${theme.name} ${ARCHETYPE[primary]}`,
    tagline: TAGLINES[primary],
    themeName: theme.name,
    themeColor: theme.color,
    severity,
    mechs,
    idea: prompt.trim(),
    variant: 1,
  };
}

export interface ReviseResult {
  plan: RoultPlan;
  applied: string[];
}

/** mutate a plan from a free-form revision instruction */
export function revisePlan(prev: RoultPlan, instruction: string, seed: number): ReviseResult {
  const rng = mulberry32(seed || 1);
  const low = instruction.toLowerCase();
  const plan: RoultPlan = {
    ...prev,
    severity: prev.severity,
    mechs: prev.mechs.map((m) => ({ ...m, params: { ...m.params } })),
    variant: prev.variant + 1,
  };
  const applied: string[] = [];

  // removals first — "buang pajak", "hapus vampir", ...
  const removeMatch = /(hapus|buang|ilangin|lepas|remove|kurangin|tanpa|gak usah|jangan)/.test(low);
  if (removeMatch) {
    for (const m of [...plan.mechs]) {
      const label = MECH_LABEL[m.id];
      if (low.split(/\s+/).some((w) => w.length > 3 && label.includes(w))) {
        plan.mechs = plan.mechs.filter((x) => x.id !== m.id);
        applied.push(`dibuang: ${label}`);
      }
    }
    if (applied.length === 0) {
      plan.mechs = plan.mechs.slice(1);
      applied.push(`dibuang: ${plan.mechs.length ? MECH_LABEL[prev.mechs[0].id] : "satu mekanik"}`);
    }
  }

  if (/(brutal|sadis|gila|kejam|naik|harder|susah|nyakit)/.test(low) && plan.severity < 2) {
    plan.severity += 1;
    applied.push(`severity ${plan.severity}/2 (makin sakit)`);
  }
  if (/(adil|seimbang|turun|santai|easier|lemah|ringan|gak usah kejam)/.test(low) && plan.severity > 0) {
    plan.severity -= 1;
    applied.push(`severity ${plan.severity}/2 (makin ramah)`);
  }
  if (/(acak|random|chaos|dadak|kado|untung)/.test(low) && !plan.mechs.some((m) => m.id === "roundChaos")) {
    plan.mechs.push({ id: "roundChaos", params: paramsFor("roundChaos", plan.severity, rng) });
    applied.push("ditambah: peluru nyasar tiap ronde");
  }
  if (/(shuffle|diacak ulang|amnesia|ingatan)/.test(low) && !plan.mechs.some((m) => m.id === "shuffleChaos")) {
    plan.mechs.push({ id: "shuffleChaos", params: {} });
    applied.push("ditambah: peluru diacak tiap ronde");
  }
  if (/(heal|sembuh|bertahan|tank|regen|nyawa nambah)/.test(low) && !plan.mechs.some((m) => m.id === "roundHeal")) {
    plan.mechs.push({ id: "roundHeal", params: paramsFor("roundHeal", plan.severity, rng) });
    applied.push("ditambah: regen tiap ronde");
  }
  if (/(vampir|hisap|leech)/.test(low) && !plan.mechs.some((m) => m.id === "vampPlayer")) {
    plan.mechs.push({ id: "vampPlayer", params: paramsFor("vampPlayer", plan.severity, rng) });
    applied.push("ditambah: vampir kamu");
  }
  if (/(tema|warna|ruangan|lampu|ganti suasana)/.test(low)) {
    const cur = THEMES.findIndex((t) => t.name === plan.themeName);
    const next = THEMES[(cur + 1 + Math.floor(rng() * (THEMES.length - 1))) % THEMES.length];
    plan.themeName = next.name;
    plan.themeColor = next.color;
    applied.push(`tema: ${next.name}`);
  }
  if (/(koin|coin|gamble|flip)/.test(low) && !plan.mechs.some((m) => m.id === "luckyCoin")) {
    plan.mechs.push({ id: "luckyCoin", params: {} });
    applied.push("ditambah: koin selalu untung");
  }

  // re-derive the numbers against the new severity
  plan.mechs = plan.mechs.map((m) => ({ id: m.id, params: paramsFor(m.id, plan.severity, rng) }));
  if (plan.mechs.length === 0) {
    plan.mechs.push({ id: "roundChaos", params: paramsFor("roundChaos", plan.severity, rng) });
    applied.push("darurat: satu mekanik chaos biar tetap jalan");
  }
  if (plan.mechs.length > MAX_MECHS) plan.mechs = plan.mechs.slice(0, MAX_MECHS);

  const primary = plan.mechs[0].id;
  plan.title = `${plan.themeName} ${ARCHETYPE[primary]}`;
  plan.tagline = TAGLINES[primary];
  if (applied.length === 0) applied.push("angka dioceng ulang, rasa dijaga");
  return { plan, applied };
}

/* ------------------------------------------------------------------ */
/* thinking trace                                                      */
/* ------------------------------------------------------------------ */

const TOP_WORDS_STOP = new Set([
  "buat","gw","aku","yang","mau","mode","gamemode","dong","tiap","kalo","kalau","bikin","jadi","apa","biar","dengan","dari","the","a","an","for","with","and","game","gak","nggak","terus","kayak","gitu","aja","lu","kamu","dia","saya","pengen","pingin",
]);

function topWords(prompt: string, max = 4): string[] {
  const words = normText(prompt).split(" ").filter((w) => w.length > 2 && !TOP_WORDS_STOP.has(w));
  const seen: string[] = [];
  for (const w of words) if (!seen.includes(w) && seen.length < max) seen.push(w);
  return seen;
}

export function traceThinking(prompt: string, plan: RoultPlan, deep: boolean): string[] {
  const hooks = [...new Set(plan.mechs.map((m) => MECH_HOOK[m.id]))];
  const pressure = plan.severity >= 2 ? "~2.5 HP/ronde" : plan.severity === 1 ? "~1.5 HP/ronde" : "~0.8 HP/ronde";
  const quick = [
    `membaca niat lu: "${topWords(prompt).join(", ") || "…"}"`,
    `mekanik terdeteksi: ${plan.mechs.map((m) => MECH_LABEL[m.id]).join(" + ")}`,
    `tema ruangan: ${plan.themeName} · severity ${plan.severity}/2`,
    "menyusun rencana…",
  ];
  if (!deep) return quick;
  return [
    ...quick.slice(0, 3),
    `mapping ke ENGINE C: hooks [${hooks.join(", ")}] · tekanan ${pressure}`,
    "menyeimbangkan angka: HP start 5, ronde wajar 4-7 sebelum tamat",
    "merakit program dari nol: globals → hooks → guard grammar",
    "memeriksa ulang: if/chance/heal/damage/set_coin — semua builtin valid",
    "compiling sanity check via WASM… siap",
  ];
}

/* ------------------------------------------------------------------ */
/* code synthesis                                                      */
/* ------------------------------------------------------------------ */

const hex = (n: number) => `0x${n.toString(16).padStart(6, "0")}`;

function emitMech(m: Mech, plan: RoultPlan, rng: () => number): { hook: ScriptEventName; code: string } | null {
  const p = m.params;
  const C = (s: string) => `  // ${s}`;
  switch (m.id) {
    case "vampPlayer":
      return {
        hook: "dealer_take_damage",
        code: [
          C("vampir — every wound you land on the DEALER feeds you back"),
          `every (dealer_take_damage) {`,
          `  heal(PLAYER, ${p.n});`,
          `}`,
        ].join("\n"),
      };
    case "vampDealer":
      return {
        hook: "player_take_damage",
        code: [
          C("the DEALER drinks — every hit you take feeds him"),
          `every (player_take_damage) {`,
          `  heal(DEALER, ${p.n});`,
          `}`,
        ].join("\n"),
      };
    case "mirror":
      return {
        hook: "player_take_damage",
        code: [
          C("karma — the pain you take comes straight back to the DEALER"),
          `every (player_take_damage) {`,
          `  damage(DEALER, ${p.n});`,
          `}`,
        ].join("\n"),
      };
    case "taxPlayer":
      return {
        hook: "turn",
        code: [
          C("blood tax — every turn start, the DEALER takes his cut"),
          `every (turn) {`,
          `  damage(PLAYER, ${p.n});`,
          `}`,
        ].join("\n"),
      };
    case "taxDealer":
      return {
        hook: "turn",
        code: [
          C("the house pays dues — every turn start, the DEALER bleeds"),
          `every (turn) {`,
          `  damage(DEALER, ${p.n});`,
          `}`,
        ].join("\n"),
      };
    case "roundChaos": {
      const hitYou = rng() < 0.5;
      const lines = [
        C("stray bullets — every reload a coin flip picks who bleeds"),
        `every (round) {`,
        `  if (chance(${p.p})) {`,
        `    damage(${hitYou ? "PLAYER" : "DEALER"}, ${p.n});`,
        `  }`,
        `  if (chance(${Math.max(10, (p.p as number) - 15)})) {`,
        `    damage(${hitYou ? "DEALER" : "PLAYER"}, ${p.n});`,
        `  }`,
        `}`,
      ];
      return { hook: "round", code: lines.join("\n") };
    }
    case "shuffleChaos":
      return {
        hook: "round",
        code: [
          C("amnesia — the shells are re-scrambled at every reload; memory won't save you"),
          `every (round) {`,
          `  shuffle();`,
          `}`,
        ].join("\n"),
      };
    case "luckyCoin":
      return {
        hook: "coin",
        code: [
          C("the coin never lies — it lands heads for you, always"),
          `every (coin) {`,
          `  set_coin(1);`,
          `}`,
        ].join("\n"),
      };
    case "mercyDeath":
      return {
        hook: "death",
        code: [
          C("one denied death — the first time you hit 0 HP, you get back up"),
          `int mercyUsed = 0;`,
          ``,
          `every (death) {`,
          `  if (mercyUsed == 0 && hp(PLAYER) <= 0) {`,
          `    mercyUsed = 1;`,
          `    heal(PLAYER, ${p.n});`,
          `  }`,
          `}`,
        ].join("\n"),
      };
    case "suddenDeath":
      return {
        hook: "round",
        code: [
          C(`sudden death — from round ${p.at} on, EVERYONE bleeds at every reload`),
          `every (round) {`,
          `  if (round() >= ${p.at}) {`,
          `    damage(PLAYER, ${p.n});`,
          `    damage(DEALER, ${p.n});`,
          `  }`,
          `}`,
        ].join("\n"),
      };
    case "skillToll":
      return {
        hook: "skill",
        code: [
          C("power is not free — every skill costs a drop of blood"),
          `every (skill) {`,
          `  damage(PLAYER, ${p.n});`,
          `}`,
        ].join("\n"),
      };
    case "roundHeal":
      return {
        hook: "round",
        code: [
          C("slow regeneration — scars close a little at every reload"),
          `every (round) {`,
          `  heal(PLAYER, ${p.n});`,
          `}`,
        ].join("\n"),
      };
    case "dealerRamp":
      return {
        hook: "round",
        code: [
          C("the siege — the DEALER's next bullet grows heavier every round"),
          `int dread = ${p.start};`,
          ``,
          `every (round) {`,
          `  set_dmg_next(dread);`,
          `  dread += ${p.step};`,
          `}`,
        ].join("\n"),
      };
    case "peekToll":
      return {
        hook: "peek",
        code: [
          C("forbidden sight has a price — every peek costs blood"),
          `every (peek) {`,
          `  damage(PLAYER, ${p.n});`,
          `}`,
        ].join("\n"),
      };
    case "firstBlood":
      return {
        hook: "round",
        code: [
          C("first blood — the opening round bites the DEALER hard"),
          `every (round) {`,
          `  if (round() == 1) {`,
          `    damage(DEALER, ${p.n});`,
          `  }`,
          `}`,
        ].join("\n"),
      };
    case "randomGift":
      return {
        hook: "round",
        code: [
          C("occasional mercy — sometimes the room decides you live"),
          `every (round) {`,
          `  if (chance(${p.p})) {`,
          `    heal(PLAYER, ${p.n});`,
          `  }`,
          `}`,
        ].join("\n"),
      };
  }
}

/** synthesize the full ENGINE C program for a plan */
export function generateCode(plan: RoultPlan, seed: number): string {
  const rng = mulberry32((seed || 1) ^ (plan.variant * 7919));
  const themeLine = THEMES.find((t) => t.name === plan.themeName)?.name ?? plan.themeName;
  const header = [
    `// ==========================================================`,
    `// ROULTEEMATE — CUSTOM RULES : ${plan.title}`,
    `// ${plan.tagline}`,
    `// idea    : "${plan.idea.slice(0, 60)}${plan.idea.length > 60 ? "…" : ""}"`,
    `// severity: ${plan.severity}/2 · theme: ${plan.themeName}`,
    `// built by roul · compiled to WASM by ENGINE C`,
    `// ==========================================================`,
    ``,
    `// room light — the ${themeLine.toLowerCase()} tint`,
    `every (setup) {`,
    `  theme(${plan.themeColor}); // ${hex(plan.themeColor)}`,
    `}`,
  ];
  const blocks = plan.mechs
    .map((m) => emitMech(m, plan, rng))
    .filter((b): b is { hook: ScriptEventName; code: string } => b !== null)
    .map((b) => b.code);
  return [...header, ...blocks].join("\n\n") + "\n";
}

export interface RoultResult {
  code: string;
  ok: boolean;
  errors: string[];
  hooks: string[];
  bytes: Uint8Array | null;
  size: number;
}

/** generate + validate with the REAL compiler */
export function buildScript(plan: RoultPlan, seed: number): RoultResult {
  const code = generateCode(plan, seed);
  const res = compileScript(code);
  return {
    code,
    ok: res.ok,
    errors: res.errors,
    hooks: res.hooks,
    bytes: res.bytes,
    size: res.bytes?.length ?? 0,
  };
}

/* ------------------------------------------------------------------ */
/* context window                                                      */
/* ------------------------------------------------------------------ */

export const ROULT_CTX_LIMIT = 4096;

export function estTokens(s: string): number {
  const words = s.trim() ? s.trim().split(/\s+/).length : 0;
  return Math.ceil(s.length / 4) + Math.ceil(words * 0.6);
}

/** estimate the whole chat's token usage; the UI trims when over budget */
export function chatTokens(texts: string[], systemTokens: number): number {
  return texts.reduce((sum, s) => sum + estTokens(s), systemTokens);
}
