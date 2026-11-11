/**
 * taunts.ts — dialogue lines for THE DEALER, the doodle enemy.
 * A grinning old card-shark who has done this far too many times.
 */

export const TAUNTS = {
  gameStart: [
    "Take a seat, kid.",
    "This is no children's game.",
    "Sure you want to continue?",
    "This revolver is getting hungry.",
  ],
  playerBlankSelf: [
    "Hush... empty.",
    "A little gift for you.",
    "Careful, the rest are waiting.",
  ],
  playerHitSelf: [
    "Pathetic. HAHAHA.",
    "Hurts, doesn't it?",
    "Go cry about it.",
  ],
  playerHitsEnemy: [
    "Ghh... you've got guts.",
    "Now it's getting fun!",
    "I'll remember that wound.",
  ],
  playerShootsBlank: [
    "Fate missed, not the bullet.",
    "Try again, why don't you.",
    "HAHA! Empty!",
  ],
  enemyTurn: [
    "My turn, kid.",
    "Pray for a blank.",
    "I can hear your heart.",
    "Cold steel, isn't it?",
  ],
  enemyBlankSelf: [
    "Phew... empty.",
    "My luck holds.",
    "One step closer.",
  ],
  enemyHitPlayer: [
    "Tables turn, kid.",
    "Don't cry.",
    "THAT is a bullet.",
  ],
  enemyHitSelf: [
    "DAMN IT!",
    "Think I'm afraid of pain?",
    "Tch... a scratch.",
  ],
  enemyLowHp: [
    "I'm not done yet!",
    "This old dog still bites.",
    "Last one... no more games.",
  ],
  voodoo: [
    "My talisman is on.",
    "Hurt me? It comes back to you.",
  ],
  playerVoodooCast: [
    "What is that smell?",
    "No witchcraft at my table!",
  ],
  reflect: [
    "WHAT?! It came back?!",
    "MAGIC! This is sorcery!",
  ],
  cuffed: [
    "HEY! Untie me!",
    "Cheating at my table...",
  ],
  scan: [
    "Hold on, let me look.",
    "My nose is sharp tonight.",
  ],
  useEject: [
    "Not this one.",
    "Throw out the rotten shell.",
  ],
  useCoffee: [
    "Sip... another round.",
    "My coffee! Don't touch it.",
  ],
  useReroll: [
    "Nudge fate a little.",
    "Spin it again, gods.",
  ],
  shop: [
    "Business break. You buying, kid?",
    "Everything's for sale. Even luck.",
    "Cash on the table or get out.",
  ],
  shopBuy: [
    "Pleasure doing business.",
    "Money well spent. Maybe.",
    "Yours. One use, no refunds.",
  ],
  shopPoor: [
    "No cash, no charms, kid.",
    "Come back when you're richer.",
    "That's not enough. Ha!",
  ],
  shopFull: [
    "Four skills is all your hands hold.",
    "Greedy. You can't carry more.",
  ],
  bellRing: [
    "As you wish. Load 'em up!",
    "Back to the game, then.",
  ],
  aiForget: [
    "Wait... how many was it?",
    "Tch. Lost count.",
    "The board went dark, didn't it...",
    "Three left? Or four? Tch.",
  ],
  phoenix: [
    "WHAT?! HOW ARE YOU ALIVE?!",
    "That fire... that's not natural!",
    "You should be ASHES, kid!",
  ],
  thirdEye: [
    "Those eyes... stop LOOKING at the gun!",
    "Sorcery again. I hate sorcery.",
  ],
} as const;

export type TauntKey = keyof typeof TAUNTS;

export function pick(key: TauntKey): string {
  const arr = TAUNTS[key];
  return arr[Math.floor(Math.random() * arr.length)];
}
