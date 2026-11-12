/**
 * i18n.ts — two languages: ENGLISH (default) and INDONESIA.
 * The DEALER's voice lives in taunts.ts (also bilingual); everything the
 * PLAYER reads in the UI goes through t() here.
 */

export type Lang = "en" | "id";

const EN = {
  // ---------- main menu ----------
  tagline: "one revolver · six chambers · no mercy",
  btnPlay: "PICK A TABLE",
  btnSettings: "SETTINGS",
  btnHelp: "HELP / HOW TO PLAY",
  // ---------- pick a table ----------
  pickTable: "PICK A TABLE",
  sitBtn: "SIT AT THE TABLE",
  diffEasy: "EASY",
  diffEasyDesc: "Your 6 HP vs his 5. The Dealer has 1 skill.",
  diffNormal: "NORMAL",
  diffNormalDesc: "5 vs 5 HP. 2 skills each. EPIC cards appear.",
  diffInsane: "INSANE",
  diffInsaneDesc: "Your 4 HP vs his 5. 3 skills + LEGEND cards in the shop.",
  diffEndless: "ENDLESS",
  diffEndlessDesc: "The DEALER never dies — his HP is a SCORE counter. Counts as INSANE.",
  // ---------- settings ----------
  settings: "SETTINGS",
  sound: "SOUND",
  soundOn: "SOUND ON",
  soundOff: "SOUND OFF",
  graphics: "GRAPHICS",
  qLow: "LOW",
  qMed: "MED",
  qHigh: "HIGH",
  uiQol: "UI & QOL",
  optShellStat: "Live / blank stat on the board",
  optTime: "Time",
  optTimeHint: "(round & total)",
  optRoundTime: "Show round time",
  optTotalTime: "Show total time",
  optFps: "Show FPS",
  optFpsHint: "(above the YOU tag)",
  optLanguage: "Language",
  optMutators: "Mutators (custom tables)",
  on: "ON",
  off: "OFF",
  // ---------- mutator popup ----------
  mutTitle: "CUSTOM TABLE",
  mutSub: "This table obeys YOUR rules. Everything is optional.",
  mutCardPool: "Cards that may appear",
  mutCardPoolHint: "rarity still applies: EPIC needs NORMAL+, LEGEND needs INSANE/ENDLESS",
  mutAllowLegend: "Allow LEGEND cards",
  mutLegendNote: "legends only spawn on INSANE / ENDLESS — even when picked here",
  mutAi: "Dealer AI brain",
  mutHpPlayer: "Your HP",
  mutHpDealer: "Dealer HP (score-less tables only)",
  mutSkillsPlayer: "Skills the dice gives you",
  mutSkillsDealer: "Skills the Dealer gets",
  mutAllowDup: "Allow duplicate cards (stack charges)",
  mutRules: "Custom effects (C-like script)",
  mutRulePh: 'every dealer take damage {\n  if hp player <= 2 {\n    heal player 1\n  }\n}',
  mutAddRule: "ADD RULE",
  mutClearAll: "CLEAR",
  mutNoRules: "No custom rules yet — the table plays vanilla.",
  mutRuleCount: "rule(s) active",
  mutSyntaxTitle: "SYNTAX CHEAT SHEET",
  mutStartBtn: "SIT AT THE TABLE",
  mutParseErr: "fix the red lines first",
  mutPoolAll: "ALL",
  mutPoolNone: "NONE",
  // ---------- script help ----------
  scVars: "variables",
  scEvents: "event hooks",
  scCommands: "commands",
  // ---------- HUD ----------
  round: "ROUND",
  cash: "$",
  yourTurn: "YOUR TURN",
  dealerTurn: "THE DEALER'S TURN...",
  mustShoot: "YOU MUST SHOOT!",
  you: "YOU",
  theDealer: "THE DEALER",
  skills: "SKILLS",
  cuffed: "cuffed",
  voodooTag: "voodoo",
  shootDealer: "SHOOT DEALER [E]",
  shootSelf: "SHOOT SELF [Q]",
  score: "SCORE",
  passives: "PASSIVE",
  trial: "TRIAL",
  // ---------- shop ----------
  shopTitle: "SHOP BREAK",
  shopSub: "Hover the items to buy. Ring the golden bell on the LEFT to start the next round.",
  bellName: "THE BELL",
  bellDesc: "Ring it to end the break — reload the gun and fight the next round.",
  tagTrial: "TRIAL · 1 USE",
  tagLegend: "LEGEND · INSANE+",
  tagEpic: "EPIC · NORMAL+",
  tagSold: "SOLD",
  // ---------- overlays ----------
  heads: "HEADS! +1 HP",
  tails: "TAILS! -1 HP",
  rewindTag: "REWIND",
  // ---------- game over ----------
  winTitle: "YOU SURVIVED!",
  winBody: "The Dealer fell in round {r}. This room is officially yours.",
  loseTitle: "GAME OVER",
  loseBody: "That bullet was for you. You lasted until round {r}.",
  loseEndlessBody: "The house always wins. You lasted until round {r} with SCORE {s}.",
  finalStats: "Final HP: you {a}/{b} · Dealer {c}/{d}",
  finalStatsEndless: "Final SCORE: {s} · your HP {a}/{b}",
  cashLeft: "Cash left: ${m} · Match time {t}",
  playAgain: "PLAY AGAIN",
  menu: "MENU",
  // ---------- engine toasts ----------
  boardFaded: "THE BOARD FADED — memorize your shells!",
  chamberEmpty: "CHAMBER EMPTY — the round is over!",
  dealerCuffedAgain: "THE DEALER IS CUFFED! Your turn again.",
  youCuffed: "You're cuffed! The DEALER goes again.",
  endlessIntro: "ENDLESS: the DEALER never dies — his HP is a SCORE counter. +1 per hit, -1 when he heals. Survive!",
  startCash: "Starting cash: ${m} — the table stocks goods between rounds.",
  // ---------- help ----------
  helpTitle: "HOW TO PLAY",
  helpClose: "X",
  skillsCount: "{n} SKILLS",
  helpTip: "Tip: MAGNIFYING GLASS before you decide. Reroll when the chamber feels too dangerous. Voodoo is at its meanest when the Dealer looks brave — every live bullet he fires at you crawls back into him.",
};

const ID: Record<keyof typeof EN, string> = {
  // ---------- main menu ----------
  tagline: "satu revolver · enam chamber · tanpa ampun",
  btnPlay: "PILIH MEJA",
  btnSettings: "PENGATURAN",
  btnHelp: "BANTUAN / CARA MAIN",
  // ---------- pick a table ----------
  pickTable: "PILIH MEJA",
  sitBtn: "DUDUK DI MEJA",
  diffEasy: "MUDAH",
  diffEasyDesc: "HP kamu 6 vs dia 5. Dealer punya 1 skill.",
  diffNormal: "NORMAL",
  diffNormalDesc: "HP 5 vs 5. 2 skill masing-masing. Kartu EPIC muncul.",
  diffInsane: "GILA",
  diffInsaneDesc: "HP kamu 4 vs dia 5. 3 skill + kartu LEGEND di toko.",
  diffEndless: "TANPA BATAS",
  diffEndlessDesc: "Dealer tidak pernah mati — HP-nya jadi penghitung SCORE. Dihitung GILA.",
  // ---------- settings ----------
  settings: "PENGATURAN",
  sound: "SUARA",
  soundOn: "SUARA NYALA",
  soundOff: "SUARA MATI",
  graphics: "GRAFIK",
  qLow: "RENDAH",
  qMed: "SEDANG",
  qHigh: "TINGGI",
  uiQol: "UI & KENYAMANAN",
  optShellStat: "Statistik live / blank di papan",
  optTime: "Waktu",
  optTimeHint: "(ronde & total)",
  optRoundTime: "Tampilkan waktu ronde",
  optTotalTime: "Tampilkan waktu total",
  optFps: "Tampilkan FPS",
  optFpsHint: "(di atas tag KAMU)",
  optLanguage: "Bahasa",
  optMutators: "Mutator (meja kustom)",
  on: "NYALA",
  off: "MATI",
  // ---------- mutator popup ----------
  mutTitle: "MEJA KUSTOM",
  mutSub: "Meja ini nurut aturan LU. Semua opsional.",
  mutCardPool: "Kartu yang boleh muncul",
  mutCardPoolHint: "rarity tetap berlaku: EPIC butuh NORMAL+, LEGEND butuh GILA/TANPA BATAS",
  mutAllowLegend: "Izinkan kartu LEGEND",
  mutLegendNote: "legend cuma muncul di GILA / TANPA BATAS — walau dipilih di sini",
  mutAi: "Otak AI Dealer",
  mutHpPlayer: "HP kamu",
  mutHpDealer: "HP Dealer (meja bukan endless)",
  mutSkillsPlayer: "Jumlah skill buat kamu",
  mutSkillsDealer: "Jumlah skill buat Dealer",
  mutAllowDup: "Izinkan kartu dobel (nambah charge)",
  mutRules: "Efek kustom (script gaya C)",
  mutRulePh: 'every dealer take damage {\n  if hp player <= 2 {\n    heal player 1\n  }\n}',
  mutAddRule: "TAMBAH ATURAN",
  mutClearAll: "BERSIHKAN",
  mutNoRules: "Belum ada aturan kustom — meja main normal.",
  mutRuleCount: "aturan aktif",
  mutSyntaxTitle: "CONTOH SYNTAX",
  mutStartBtn: "DUDUK DI MEJA",
  mutParseErr: "betulin baris merah dulu",
  mutPoolAll: "SEMUA",
  mutPoolNone: "KOSONG",
  // ---------- script help ----------
  scVars: "variabel",
  scEvents: "pemicu kejadian",
  scCommands: "perintah",
  // ---------- HUD ----------
  round: "RONDE",
  cash: "$",
  yourTurn: "GILIRAN KAMU",
  dealerTurn: "GILIRAN DEALER...",
  mustShoot: "KAMU HARUS NEMBAK!",
  you: "KAMU",
  theDealer: "THE DEALER",
  skills: "SKILL",
  cuffed: "diborgol",
  voodooTag: "voodoo",
  shootDealer: "TEMBAK DEALER [E]",
  shootSelf: "TEMBAK DIRI [Q]",
  score: "SKOR",
  passives: "PASIF",
  trial: "COBA",
  // ---------- shop ----------
  shopTitle: "ISTIRAHAT TOKO",
  shopSub: "Arahkan kursor buat beli. Bunyikan lonceng emas di KIRI buat mulai ronde berikutnya.",
  bellName: "LONCENG",
  bellDesc: "Bunyikan buat akhiri istirahat — reload senjata dan lanjut ronde berikutnya.",
  tagTrial: "COBA · 1 PAKAI",
  tagLegend: "LEGEND · GILA+",
  tagEpic: "EPIC · NORMAL+",
  tagSold: "TERJUAL",
  // ---------- overlays ----------
  heads: "HEADS! +1 HP",
  tails: "TAILS! -1 HP",
  rewindTag: "REWIND",
  // ---------- game over ----------
  winTitle: "KAMU SELAMAT!",
  winBody: "Dealer tumbang di ronde {r}. Ruangan ini resmi jadi milikmu.",
  loseTitle: "GAME OVER",
  loseBody: "Peluru itu buat kamu. Kamu bertahan sampai ronde {r}.",
  loseEndlessBody: "Bandar selalu menang. Kamu bertahan sampai ronde {r} dengan SKOR {s}.",
  finalStats: "HP akhir: kamu {a}/{b} · Dealer {c}/{d}",
  finalStatsEndless: "SKOR akhir: {s} · HP kamu {a}/{b}",
  cashLeft: "Uang sisa: ${m} · Durasi {t}",
  playAgain: "MAIN LAGI",
  menu: "MENU",
  // ---------- engine toasts ----------
  boardFaded: "PAPANNYA SUDAH GELAP — hafal pelurumu!",
  chamberEmpty: "CHAMBER KOSONG — ronde selesai!",
  dealerCuffedAgain: "DEALER DIBORGOL! Giliranmu lagi.",
  youCuffed: "Kamu diborgol! Dealer jalan lagi.",
  endlessIntro: "TANPA BATAS: Dealer tidak pernah mati — HP-nya jadi penghitung SKOR. +1 tiap kena, -1 kalau dia sembuh. Bertahanlah!",
  startCash: "Modal awal: ${m} — meja mengisi barang di sela ronde.",
  // ---------- help ----------
  helpTitle: "CARA MAIN",
  helpClose: "X",
  skillsCount: "{n} SKILL",
  helpTip: "Tips: pakai MAGNIFYING GLASS sebelum memutuskan. Reroll kalau chamber terasa terlalu berbahaya. Voodoo paling kejam saat Dealer kelihatan berani — setiap peluru hidup yang dia tembakkan ke kamu akan merayap balik ke dirinya.",
};

type Key = keyof typeof EN;
const DICTS: Record<Lang, Record<Key, string>> = { en: EN, id: ID };

let lang: Lang = "en";

export function setLang(l: Lang) {
  lang = l;
}

export function getLang(): Lang {
  return lang;
}

/** Translate a key; {a} {b} {r} {s} {m} {t} {n} placeholders get filled. */
export function t(key: Key, vars: Record<string, string | number> = {}): string {
  let s = DICTS[lang][key] ?? DICTS.en[key];
  for (const [k, v] of Object.entries(vars)) {
    s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}
