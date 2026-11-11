/**
 * taunts.ts — dialog PAKDE si musuh doodle. Bahasa santai kayak orang
 * main kartu di pos ronda.
 */

export const TAUNTS = {
  gameStart: [
    "Duduk yang manis ya.",
    "Ini bukan permainan anak-anak.",
    "Kamu yakin mau lanjut?",
    "Revolver ini udah laper nih.",
  ],
  playerBlankSelf: [
    "Husss... kosong.",
    "Rezeki baru buat kamu.",
    "Hati-hati, sisanya nunggu.",
  ],
  playerHitSelf: [
    "Dasar. HAHAHA.",
    "Sakit kan? Sakit kan?",
    "Nangis dulu, sana.",
  ],
  playerHitsEnemy: [
    "Anjing... berani juga.",
    "Ini baru seru!",
    "Luka ini gue catat.",
  ],
  playerShootsBlank: [
    "Meleset nasib, bukan peluru.",
    "Coba lagi, janjian.",
    "HAHA! Kosong!",
  ],
  enemyTurn: [
    "Gantian, nak.",
    "Tolong doakan blank.",
    "Jantungmu kedengeran lho.",
    "Dingin ya pelorunya.",
  ],
  enemyBlankSelf: [
    "Fuh... kosong.",
    "Nasib gue masih bagus.",
    "Satu langkah lagi.",
  ],
  enemyHitPlayer: [
    "Kebalik ya, nak.",
    "Jangan nangis.",
    "Itu baru peluru.",
  ],
  enemyHitSelf: [
    "SIAL!",
    "Kira gue bales dendam?",
    "Tch... luka kecil.",
  ],
  enemyLowHp: [
    "Gue belum kalah!",
    "Serigua tua masih gigit.",
    "Terakhir... ini serius.",
  ],
  voodoo: [
    "Gue pasang jimat.",
    "Sakiti gue? Balik ke kamu.",
  ],
  playerVoodooCast: [
    "Itu apaan? Bau aneh.",
    "Jangan pake sihir, cuek!",
  ],
  reflect: [
    "APA?! Kok balik?!",
    "SIHIR! Ini sihir!",
  ],
  cuffed: [
    "EI! Lepasin!",
    "Main curang ya kamu...",
  ],
  scan: [
    "Bentar, gue mantau dulu.",
    "Bau gue tajam malam ini.",
  ],
  useBuang: [
    "Yang ini gue tolak.",
    "Buang yang busuk.",
  ],
  useKopi: [
    "Sruput... baru lagi.",
    "Kopi gue! Jangan diganggu.",
  ],
  useReroll: [
    "Gue geser dikit nasibnya.",
    "Puter lagi, tuhan.",
  ],
} as const;

export type TauntKey = keyof typeof TAUNTS;

export function pick(key: TauntKey): string {
  const arr = TAUNTS[key];
  return arr[Math.floor(Math.random() * arr.length)];
}
