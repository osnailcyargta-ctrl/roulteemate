/**
 * taunts.ts — dialogue lines for THE DEALER, the doodle enemy.
 * A grinning old card-shark who has done this far too many times.
 * Bilingual: EN (default) and ID. The Dealer keeps his voice in both.
 */

import { getLang, type Lang } from "./i18n";

type Line = { en: string[]; id: string[] };

export const TAUNTS: Record<string, Line> = {
  gameStart: {
    en: ["Take a seat, kid.", "This is no children's game.", "Sure you want to continue?", "This revolver is getting hungry."],
    id: ["Duduklah, nak.", "Ini bukan mainan anak-anak.", "Yakin mau lanjut?", "Revolver ini mulai lapar."],
  },
  playerBlankSelf: {
    en: ["Hush... empty.", "A little gift for you.", "Careful, the rest are waiting."],
    id: ["Ssst... kosong.", "Hadiah kecil buat kamu.", "Hati-hati, yang lain masih menunggu."],
  },
  playerHitSelf: {
    en: ["Pathetic. HAHAHA.", "Hurts, doesn't it?", "Go cry about it."],
    id: ["Menyedihkan. HAHAHA.", "Sakit kan?", "Sana nangis."],
  },
  playerHitsEnemy: {
    en: ["Ghh... you've got guts.", "Now it's getting fun!", "I'll remember that wound."],
    id: ["Ghh... kamu berani juga.", "Sekarang makin seru!", "Luka ini kuingat baik-baik."],
  },
  playerShootsBlank: {
    en: ["Fate missed, not the bullet.", "Try again, why don't you.", "HAHA! Empty!"],
    id: ["Nasib meleset, bukan pelurunya.", "Coba lagi dong.", "HAHA! Kosong!"],
  },
  enemyTurn: {
    en: ["My turn, kid.", "Pray for a blank.", "I can hear your heart.", "Cold steel, isn't it?"],
    id: ["Giliran saya, nak.", "Berdoalah dapat yang kosong.", "Aku bisa dengar jantungmu.", "Baja yang dingin kan?"],
  },
  enemyBlankSelf: {
    en: ["Phew... empty.", "My luck holds.", "One step closer."],
    id: ["Fiuh... kosong.", "Untungku masih setia.", "Selangkah lebih dekat."],
  },
  enemyHitPlayer: {
    en: ["Tables turn, kid.", "Don't cry.", "THAT is a bullet."],
    id: ["Keadaan berbalik, nak.", "Jangan nangis.", "ITU namanya peluru."],
  },
  enemyHitSelf: {
    en: ["DAMN IT!", "Think I'm afraid of pain?", "Tch... a scratch."],
    id: ["SIALAN!", "Kira aku takut sakit?", "Ced... cuma lecet."],
  },
  enemyLowHp: {
    en: ["I'm not done yet!", "This old dog still bites.", "Last one... no more games."],
    id: ["Aku belum kalah!", "Anjing tua ini masih menggigit.", "Yang terakhir... tak ada main-main lagi."],
  },
  voodoo: {
    en: ["My talisman is on.", "Hurt me? It comes back to you."],
    id: ["Jimatku sudah aktif.", "Sakitiku? Balik ke kamu."],
  },
  playerVoodooCast: {
    en: ["What is that smell?", "No witchcraft at my table!"],
    id: ["Bau apa itu?", "Jangan sihir di mejaku!"],
  },
  reflect: {
    en: ["WHAT?! It came back?!", "MAGIC! This is sorcery!"],
    id: ["APA?! Balik ke aku?!", "SULAP! Ini sihir!"],
  },
  cuffed: {
    en: ["HEY! Untie me!", "Cheating at my table..."],
    id: ["HEI! Lepaskan!", "Curang di mejaku..."],
  },
  scan: {
    en: ["Hold on, let me look.", "My nose is sharp tonight."],
    id: ["Tunggu, biar aku lihat.", "Hidungku tajam malam ini."],
  },
  useEject: {
    en: ["Not this one.", "Throw out the rotten shell."],
    id: ["Bukan yang ini.", "Buang peluru busuknya."],
  },
  useCoffee: {
    en: ["Sip... another round.", "My coffee! Don't touch it."],
    id: ["Teguk... ronde berikutnya.", "Kopi saya! Jangan disentuh."],
  },
  useReroll: {
    en: ["Nudge fate a little.", "Spin it again, gods."],
    id: ["Geser nasib sedikit.", "Putar lagi, para dewa."],
  },
  rewind: {
    en: ["Nope. That one did not happen.", "Time bends for me too, kid."],
    id: ["Bukan. Yang itu tidak pernah terjadi.", "Waktu bisa melengkung untukku juga, nak."],
  },
  shop: {
    en: ["Business break. You buying, kid?", "Everything's for sale. Even luck.", "Cash on the table or get out."],
    id: ["Istirahat dagang. Mau beli, nak?", "Semua ada harganya. Termasuk keberuntungan.", "Uang di meja, atau keluar."],
  },
  shopBuy: {
    en: ["Pleasure doing business.", "Money well spent. Maybe.", "Yours. One use, no refunds."],
    id: ["Senang berbisnis.", "Uang habis dengan baik. Mungkin.", "Jadi milikmu. Sekali pakai, tanpa refund."],
  },
  shopPoor: {
    en: ["No cash, no charms, kid.", "Come back when you're richer.", "That's not enough. Ha!"],
    id: ["Tanpa uang, tanpa jimat, nak.", "Kembali kalau sudah lebih kaya.", "Kurang banyak. Ha!"],
  },
  shopFull: {
    en: ["Four skills is all your hands hold.", "Greedy. You can't carry more."],
    id: ["Empat skill, itu batas tanganmu.", "Serakah. Nggak bisa bawa lebih."],
  },
  bellRing: {
    en: ["As you wish. Load 'em up!", "Back to the game, then."],
    id: ["Kalau itu maumu. Isi pelurunya!", "Kembali ke permainan, kalau begitu."],
  },
  aiForget: {
    en: ["Wait... how many was it?", "Tch. Lost count.", "The board went dark, didn't it...", "Three left? Or four? Tch."],
    id: ["Hei... berapa tadi?", "Ced. Lupa hitungannya.", "Papannya sudah gelap kan...", "Tinggal tiga? Atau empat? Ced."],
  },
  phoenix: {
    en: ["WHAT?! HOW ARE YOU ALIVE?!", "That fire... that's not natural!", "You should be ASHES, kid!"],
    id: ["APA?! KENAPA MASIH HIDUP?!", "Api itu... bukan hal biasa!", "Kamu harusnya jadi ABU, nak!"],
  },
  thirdEye: {
    en: ["Those eyes... stop LOOKING at the gun!", "Sorcery again. I hate sorcery."],
    id: ["Mata itu... berhenti MELIHAT senjatanya!", "Sihir lagi. Aku benci sihir."],
  },
  endlessScore: {
    en: ["SCORE is rising, kid. Keep going.", "Every bullet feeds the counter."],
    id: ["SKOR naik, nak. Teruskan.", "Setiap peluru memberi makan penghitung itu."],
  },
} as const;

export type TauntKey = keyof typeof TAUNTS;

export function pick(key: TauntKey): string {
  const arr = TAUNTS[key][getLang()] ?? TAUNTS[key].en;
  return arr[Math.floor(Math.random() * arr.length)];
}

export function pickLang(key: TauntKey, lang: Lang): string {
  const arr = TAUNTS[key][lang] ?? TAUNTS[key].en;
  return arr[Math.floor(Math.random() * arr.length)];
}
