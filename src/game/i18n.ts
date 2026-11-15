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
  btnHelp: "HELP",
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
  optProb: "Live/blank percentage",
  optProbHint: "(under the shell board)",
  optDaily: "Daily seed — same run for everyone",
  optDailyHint: "(from today's date, not hardcoded)",
  optTutorial: "Interactive tutorial",
  optTutorialHint: "(spotlight walkthrough — OFF by default)",
  optTutReplay: "Replay tutorial",
  optTutReplayHint: "(starts a practice table right now)",
  tutStart: "START",
  tutReplayed: "Tutorial rearmed — hints return on your next table.",
  on: "ON",
  off: "OFF",
  // ---------- mutator popup ----------
  mutTitle: "CUSTOM TABLE",
  mutSub: "This table obeys YOUR rules. Everything is optional.",
  mutCardPool: "Cards that may appear",
  mutCardPoolHint: "the DICE never rolls EPIC/LEGEND — EPIC comes from the SHOP only on NORMAL+, LEGEND needs INSANE/ENDLESS",
  mutAllowLegend: "Allow LEGEND cards",
  mutLegendNote: "legends only spawn on INSANE / ENDLESS — even when picked here",
  mutAi: "difficulty",
  mutAiEndlessHint: "ENDLESS: score mode — the Dealer HP input is dead",
  mutHpPlayer: "Your HP",
  mutHpDealer: "Dealer HP (score-less tables only)",
  mutSkillsPlayer: "Skills the dice gives you",
  mutSkillsDealer: "Skills the Dealer gets",
  mutAllowDup: "Allow duplicate cards (each copy = own slot, own cooldown)",
  mutRules: "Custom effects — ENGINE C",
  mutEngineCSub: "your script is compiled to WebAssembly and runs natively — not in JS",
  mutRulePh: 'int bonus = 0;\n\nevery (dealer_take_damage) {\n  bonus += 1;\n  if (bonus >= 3) {\n    heal(PLAYER, 1);\n    bonus = 0;\n  }\n}\n\nevery (skill) {\n  if (hp(DEALER) <= 2) {\n    run_skill("cuffs", DEALER);\n  }\n}',
  mutAddRule: "COMPILE",
  mutClearAll: "CLEAR",
  mutNoRules: "No custom rules — the table plays vanilla.",
  mutRuleCount: "rule(s) active",
  mutCompileOk: "OK — compiled. Hooks: {a}",
  mutHookNone: "compiled — no hooks yet (write some every (...) blocks)",
  mutSyntaxTitle: "SYNTAX CHEAT SHEET",
  mutStartBtn: "RUN DEBUG MODE",
  // ---------- debug mode (RUN DEBUG MODE from the custom table) ----------
  dbgSetHp: "SET HP",
  dbgAddSkill: "ADD SKILL",
  dbgNextRound: "NEXT ROUND",
  dbgYou: "YOU",
  dbgDealer: "DEALER",
  dbgAddHint: "full charges, own slot",
  dbgNextHint: "ends the round NOW — the shop break still comes first",
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
  // ---------- run stats ----------
  statsTitle: "RUN STATS",
  stShots: "Shots fired",
  stHits: "Bullets landed",
  stAcc: "Accuracy",
  stPeeks: "Peeks (live found)",
  stDmgDealt: "Damage dealt",
  stDmgTaken: "Damage taken",
  stSkills: "Skills used",
  bestStd: "BEST: won in {r} rounds",
  bestEndless: "BEST: score {s} (round {r})",
  bestNone: "No personal best yet — this run writes history.",
  newBest: "NEW BEST!",
  // ---------- interactive tutorial (contextual hints) ----------
  tutGotIt: "GOT IT",
  tut1: "LIVE (red) hurts, BLANK (blue) is empty. The board up top counts them honestly — but only for 3 turns. Q = shoot self, E = shoot the Dealer.",
  tut2: "Skills are FREE actions — using one never passes the turn. Press 1-4 or click a card.",
  tut3: "The board FADED. From now on both of you run on memory — track every fired shell on the table edge.",
  tut4: "SHOP BREAK: hover the items on the table to inspect them, click to buy a 1-use TRIAL. Ring the golden bell to fight on.",
  tut5: "DANGER: your heart is pounding. Coffee heals, Phoenix refuses death — and shooting yourself with a BLANK earns a free shot at the Dealer.",
  tut6: "You MUST shoot now (a reroll leaves no way out). Pick the target the odds forgive.",
  // ---------- interactive tutorial (spotlight walkthrough) ----------
  tutSpot: "TUTORIAL",
  tutNext: "NEXT",
  tutSkip: "Skip the tutorial",
  tutClick: "CLICK IT!",
  tutWaiting: "play on — this card pops when it happens",
  tutStepWelcome:
    "Welcome to the table. This walkthrough runs on a REAL table — everything you do counts. Follow the golden outline; when it says CLICK IT, really click that thing.",
  tutStepDealer:
    "THE DEALER. His hearts hang top-right. Drop them all to zero and the room is yours. (ENDLESS swaps his hearts for a SCORE counter.)",
  tutStepYou:
    "YOU. Your hearts sit under your name. Hit zero and the run is over — so read the odds before you pull.",
  tutStepBoard:
    "The LIVE/BLANK board. It honestly counts the shells left in the cylinder — but only for the first 3 turns, then it fades. The % chip below shows whichever side is more likely.",
  tutStepSkills:
    "Your skill cards. Skills are FREE — they never pass the turn. Try one now: click any card, or press 1-4. A number over a card means it's still resting.",
  tutStepFire:
    "Time to pull the trigger. SHOOT SELF — a blank pays one free shot at the Dealer, live hurts. SHOOT DEALER — live hits him. Click whichever the odds forgive.",
  tutStepCash:
    "Your CASH. Bullets you land pay $100, voodoo reflections $150, surviving a round $75. Between rounds 3 random items land on the table — hover to inspect, click to buy a 1-use TRIAL.",
  tutStepShop:
    "SHOP BREAK. Hover the items ON THE TABLE to read price & effect; click to buy one as a 1-use TRIAL. Ring the golden bell on the left to end the break and load the next round.",
  tutStepFade:
    "THE BOARD FADED. Both of you run on memory now — the spent shells on the table edge are your ledger, in firing order.",
  tutStepEnd:
    "That's the whole walk. The rest you learn by surviving: Phoenix refuses death, Reroll forces a shot, Voodoo reflects pain, Rewind undoes a trigger, Third Eye reads three shells. Good luck — and don't trust his grin.",
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
  // ---------- custom table / mutators ----------
  mutHoldHint: "hold 1s / right-click = mutator button",
  mutBtn: "MUTATORS",
  mutOnOff: "MUTATORS",
  mutOnOffHint: "off = the plain vanilla table",
  mutOffNote: "mutators are OFF — the table plays by the book.",
};

const ID: Record<keyof typeof EN, string> = {
  // ---------- main menu ----------
  tagline: "satu revolver · enam chamber · tanpa ampun",
  btnPlay: "PILIH MEJA",
  btnSettings: "PENGATURAN",
  btnHelp: "BANTUAN",
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
  optProb: "Persentase live/blank",
  optProbHint: "(di bawah papan shell)",
  optDaily: "Seed harian — run sama untuk semua orang",
  optDailyHint: "(dihitung dari tanggal hari ini, bukan hardcoded)",
  optTutorial: "Tutorial interaktif",
  optTutorialHint: "(tur spotlight — default MATI)",
  optTutReplay: "Ulangi tutorial",
  optTutReplayHint: "(langsung mulai meja latihan)",
  tutStart: "MULAI",
  tutReplayed: "Tutorial diaktifkan lagi — hint muncul di meja berikutnya.",
  on: "NYALA",
  off: "MATI",
  // ---------- mutator popup ----------
  mutTitle: "MEJA KUSTOM",
  mutSub: "Meja ini nurut aturan LU. Semua opsional.",
  mutCardPool: "Kartu yang boleh muncul",
  mutCardPoolHint: "DADU tidak pernah mengeluarkan EPIC/LEGEND — EPIC cuma lewat TOKO di NORMAL+, LEGEND butuh GILA/TANPA BATAS",
  mutAllowLegend: "Izinkan kartu LEGEND",
  mutLegendNote: "legend cuma muncul di GILA / TANPA BATAS — walau dipilih di sini",
  mutAi: "kesulitan",
  mutAiEndlessHint: "ENDLESS: mode skor — input HP Dealer mati",
  mutHpPlayer: "HP kamu",
  mutHpDealer: "HP Dealer (meja bukan endless)",
  mutSkillsPlayer: "Jumlah skill buat kamu",
  mutSkillsDealer: "Jumlah skill buat Dealer",
  mutAllowDup: "Izinkan kartu dobel (tiap salinan = slot sendiri, cooldown sendiri)",
  mutRules: "Efek kustom — ENGINE C",
  mutEngineCSub: "script-mu dikompilasi ke WebAssembly dan jalan native — bukan di JS",
  mutRulePh: 'int bonus = 0;\n\nevery (dealer_take_damage) {\n  bonus += 1;\n  if (bonus >= 3) {\n    heal(PLAYER, 1);\n    bonus = 0;\n  }\n}\n\nevery (skill) {\n  if (hp(DEALER) <= 2) {\n    run_skill("cuffs", DEALER);\n  }\n}',
  mutAddRule: "COMPILE",
  mutClearAll: "BERSIHKAN",
  mutNoRules: "Belum ada aturan kustom — meja main normal.",
  mutRuleCount: "aturan aktif",
  mutCompileOk: "OK — terkompilasi. Hook: {a}",
  mutHookNone: "terkompilasi — belum ada hook (tulis blok every (...) dulu)",
  mutSyntaxTitle: "CONTOH SYNTAX",
  mutStartBtn: "JALANIN DEBUG MODE",
  // ---------- debug mode (JALANIN DEBUG MODE dari meja kustom) ----------
  dbgSetHp: "SET HP",
  dbgAddSkill: "TAMBAH SKILL",
  dbgNextRound: "ROUND BERIKUT",
  dbgYou: "KAMU",
  dbgDealer: "DEALER",
  dbgAddHint: "charge penuh, slot sendiri",
  dbgNextHint: "akhirin round-nya SEKARANG — shop tetep duluan",
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
  // ---------- run stats ----------
  statsTitle: "STATISTIK RUN",
  stShots: "Tembakan",
  stHits: "Peluru kena",
  stAcc: "Akurasi",
  stPeeks: "Peek (dapet live)",
  stDmgDealt: "Damage dibagikan",
  stDmgTaken: "Damage diterima",
  stSkills: "Skill dipakai",
  bestStd: "REKOR: menang dalam {r} ronde",
  bestEndless: "REKOR: skor {s} (ronde {r})",
  bestNone: "Belum ada rekor pribadi — run ini nulis sejarah.",
  newBest: "REKOR BARU!",
  // ---------- interactive tutorial ----------
  tutGotIt: "NGERTI",
  tut1: "LIVE (merah) nyakitin, BLANK (biru) kosong. Papan di atas ngitungnya jujur — tapi cuma 3 giliran. Q = tembak diri, E = tembak Dealer.",
  tut2: "Skill itu GRATIS — pakai skill gak melewatkan giliran. Tekan 1-4 atau klik kartunya.",
  tut3: "Papannya MENGELAP. Mulai sekarang kalian berdua jalan pakai ingatan — perhatikan tiap shell yang terlempar di tepi meja.",
  tut4: "ISTIRAHAT TOKO: arahkan kursor ke barang di meja buat inspect, klik buat beli COBA 1 pakai. Bunyikan lonceng emas buat lanjut.",
  tut5: "BAHAYA: jantungmu berdebar. Coffee nyembuhin, Phoenix nolak kematian — dan nembak diri pakai BLANK kasih tembakan gratis ke Dealer.",
  tut6: "Kamu HARUS nembak sekarang (hasil reroll gak ada jalan keluar). Pilih target yang paling pengertian sama peluang.",
  // ---------- interactive tutorial (spotlight walkthrough) ----------
  tutSpot: "TUTORIAL",
  tutNext: "LANJUT",
  tutSkip: "Lewati tutorial",
  tutClick: "KLIK INI!",
  tutWaiting: "main aja dulu — kartu ini muncul pas kejadiannya datang",
  tutStepWelcome:
    "Selamat datang di meja. Tur ini jalan di meja BENERAN — semua yang kamu lakuin itu nyata. Ikuti garis emasnya; pas dia bilang KLIK INI, klik beneran.",
  tutStepDealer:
    "THE DEALER. Hati-hatinya nongkrong di kanan atas. Nol-in semuanya dan ruangan ini jadi milikmu. (TANPA BATAS mengganti hati-hatinya jadi penghitung SKOR.)",
  tutStepYou:
    "KAMU. Hati-hatimu ada di bawah namamu. Nol berarti tamat — jadi baca peluangnya dulu sebelum narik trigger.",
  tutStepBoard:
    "Papan LIVE/BLANK. Dia ngitung shell yang tersisa di chamber dengan jujur — tapi cuma 3 giliran pertama, habis itu memudar. Chip % di bawah nunjukin sisi yang peluangnya lebih gede.",
  tutStepSkills:
    "Kartu skill-mu. Skill itu GRATIS — gak pernah melewatkan giliran. Coba sekarang: klik salah satu kartu, atau tekan 1-4. Angka di atas kartu artinya dia masih istirahat.",
  tutStepFire:
    "Saatnya narik trigger. TEMBAK DIRI — blank bayar satu tembakan gratis ke Dealer, live nyakitin kamu. TEMBAK DEALER — live kena dia. Klik yang paling dimaafkan peluang.",
  tutStepCash:
    "UANG-mu. Peluru yang kena bayar $100, pantulan voodoo $150, selamat satu ronde $75. Di sela ronde 3 barang acak muncul di meja — hover buat inspect, klik buat beli COBA 1 pakai.",
  tutStepShop:
    "ISTIRAHAT TOKO. Hover barang DI ATAS MEJA buat baca harga & efek; klik buat beli sebagai COBA 1 pakai. Bunyikan lonceng emas di kiri buat akhiri istirahat dan isi ronde berikutnya.",
  tutStepFade:
    "PAPANNYA MENGELAP. Sekarang kalian berdua jalan pakai ingatan — shell bekas di tepi meja adalah buku besarmu, urut dari yang ditembak.",
  tutStepEnd:
    "Tur-nya cuma itu. Sisanya kamu belajar dengan bertahan: Phoenix nolak mati, Reroll maksa nembak, Voodoo pantulkan sakit, Rewind batalkan tembakan, Third Eye baca 3 shell. Semoga beruntung — dan jangan percaya senyum dia.",
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
  // ---------- custom table / mutators ----------
  mutHoldHint: "tahan 1 dtk / klik kanan = tombol mutator",
  mutBtn: "MUTATOR",
  mutOnOff: "MUTATOR",
  mutOnOffHint: "off = meja polos tanpa mutator",
  mutOffNote: "mutator OFF — meja main sesuai aturan baku.",
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
