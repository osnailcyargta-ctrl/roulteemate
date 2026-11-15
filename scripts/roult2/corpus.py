"""
roult2/corpus.py — builds the FROM-SCRATCH training corpus for roult v2.

Every example:
  <intent> {free text, id/en slang} <plan> {title/tagline/bullets/room}
  [<revise> {instruction} <plan> {revised plan}]   (~35%)
  <think> {reasoning bullets} <code> {ENGINE C} <end>

FULLY BILINGUAL: each example is generated in ONE language (id or en, 50/50).
The plan/think/revise/taunt language ALWAYS matches the intent language, so
the model learns "EN in -> EN out, ID in -> ID out" and roult follows the
user's language automatically.

The ENGINE C code uses ONLY constructs verified against src/game/script.ts:
int/float globals with constant init, every (hook) blocks, if/else, while,
repeat, break, chance/shuffle/theme/set_dmg_next/set_coin, run_skill with a
valid skill id, hp/score/round/rand/last_skill, heal/damage/say, && || !,
== != < <= > >=, += -=, %.
Hooks used: round, turn, hit, player_take_damage, dealer_take_damage,
skill, shop, coin, peek  (setup/death never fire in the engine -> excluded).

Usage:  python3 scripts/roult2/corpus.py [N_EXAMPLES]
Writes: data/roult2/corpus.jsonl, scripts/roult2/vocab.json, stats.json
"""

import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spec  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_DATA = os.path.join(ROOT, "data", "roult2")
OUT_VOCAB = os.path.join(os.path.dirname(os.path.abspath(__file__)))

rng = random.Random(20261114)

SEV_NUM = {
    "low":  {"heal": 1, "dmg": 1, "chance": (12, 25), "period": (4, 6), "thr": (4, 5), "start": 1, "step": 1},
    "mid":  {"heal": 2, "dmg": 1, "chance": (28, 50), "period": (3, 4), "thr": (2, 3), "start": 1, "step": 1},
    "high": {"heal": 3, "dmg": 2, "chance": (55, 82), "period": (2, 3), "thr": (1, 2), "start": 2, "step": 2},
}
SEVS = ["low", "mid", "high"]
SEV_WEIGHTS = [0.3, 0.45, 0.25]

# ------------------------------------------------------------------ #
# per-example language                                                #
# ------------------------------------------------------------------ #
LANG = "id"  # global: the language of the CURRENT example ("id" | "en")


def B(id_s, en_s):
    """pick the string for the current example language"""
    return id_s if LANG == "id" else en_s


def TAU():
    return rng.choice(spec.TAUNTS[LANG])


def pick_sev():
    return rng.choices(SEVS, weights=SEV_WEIGHTS)[0]


def num(sev, key):
    d = SEV_NUM[sev]
    v = d[key]
    if isinstance(v, tuple):
        return rng.randint(*v)
    return v + (1 if (sev == "high" and key == "heal" and rng.random() < 0.4) else 0)


def pick_ident(used):
    for _ in range(20):
        n = rng.choice(spec.IDENT_POOL)
        if n not in used:
            used.add(n)
            return n
    raise RuntimeError("ident pool exhausted")

# ------------------------------------------------------------------ #
# features                                                           #
# ------------------------------------------------------------------ #
# each feature returns a dict:
#   globals: [(name, "int"/"float", init)]
#   hooks:   {hookName: [line0, ...]}  (lines are code WITHOUT indent)
#   bullets: [str]  think: [str]  intents: [(id, en, mentions_n(bool))]


def f_vampire(sev):
    n = num(sev, "heal")
    wrapped = rng.random() < 0.15
    p = num(sev, "chance")
    if wrapped:
        lines = [f"if (chance({p})) {{", f"    heal(DEALER, {n});", "}"]
    else:
        lines = [f"heal(DEALER, {n});"]
    d = {
        "globals": [],
        "hooks": {"player_take_damage": lines},
        "bullets": [B(f"- dealer sembuh {n} tiap player kena peluru (hook player_take_damage)",
                      f"- the dealer heals {n} every time the player takes a bullet (player_take_damage hook)")],
        "think": [
            B("- sifat utamanya vampir: hook player_take_damage cuma nyala pas peluru kena player",
              "- the core is vampiric: player_take_damage only fires when a bullet lands on the player"),
            B(f"- heal {n} per kena bikin dealer ngebut pelan, masih ada counterplay",
              f"- healing {n} per hit lets the dealer creep back slowly, the counterplay stays"),
        ],
    }
    d["intents"] = [
        (f"vampire mode: kalo gw kena tembak dealer malah heal {n}", f"vampire mode: when i get shot the dealer heals {n} instead", True),
        (f"mode vampir, tiap aku kena dealer sembuh {n}", f"vampire table, every time i get hit the dealer mends {n}", True),
        ("gw kena peluru tapi dealer malah makin sehat, gitu deh", "i eat the bullet but the dealer gets healthier, that kind of table", False),
        ("dealer jadi vampir: darah gw jadi makanannya", "make the dealer a vampire: my blood is his food", False),
        ("vampire table bang, dealer nyedot tiap peluru yang ngena gw", "vampire table please, the dealer drinks every bullet that hits me", False),
        ("kalo aku kena damage, dealer heal dikit", "when i take damage the dealer heals a bit", False),
        ("the dealer heals when i get hit, vampire rules", "the dealer heals when i get hit, vampire rules", False),
        ("tiap player kena, dealer nambah darah", "every hit on the player feeds the house", False),
        ("buat yang iseng: damage ke gw bikin dealer hidup lagi", "for the cruel ones: damage on me brings the dealer back to life", False),
        (f"vampire play: gw kena = dealer heal {n}", f"vampire play: i get hit = the dealer drinks {n}", True),
    ]
    return d


def f_leech(sev):
    n = num(sev, "heal")
    d = {
        "globals": [],
        "hooks": {"dealer_take_damage": [f"heal(PLAYER, {n});"]},
        "bullets": [B(f"- player heal {n} tiap dealer kena peluru (hook dealer_take_damage)",
                      f"- the player heals {n} every time the dealer is hit (dealer_take_damage hook)")],
        "think": [
            B("- lifesteal: hook dealer_take_damage nyala pas peluru masuk dealer",
              "- lifesteal: dealer_take_damage fires when a bullet enters the dealer"),
            B(f"- heal {n} per hit: agresif tapi adil, dua-duanya masih bisa mati",
              f"- {n} per hit: aggressive but fair, both of you can still die"),
        ],
    }
    d["intents"] = [
        (f"lifesteal: tiap gw nembak dealer, darah gw nambah {n}", f"lifesteal: every time i shoot the dealer i heal {n}", True),
        ("gw heal tiap berhasil nutupin peluru ke dealer", "my hits heal me a little", False),
        ("tiap hit ke dealer, aku sembuh dikit", "each hit on the dealer mends me a bit", False),
        (f"mode lintah: darah dealer jadi darah gw, heal {n} per kena", f"leech mode: the blood of the dealer becomes mine, {n} back per hit", True),
        ("player nyedot darah dealer tiap kena", "the player siphons the dealer every time he is hit", False),
        ("leech mode: my hits heal me a bit", "leech mode: my hits heal me a bit", False),
        ("tiap aku berhasil nembak, darahku naik", "every landed shot raises my hp", False),
        ("succ tiap hit dong biar tahan lama", "give me a drain on every hit so i last longer", False),
    ]
    return d


def f_escalate(sev):
    a = num(sev, "start")
    k = num(sev, "step")
    target = rng.choice(["PLAYER", "DEALER"])
    v = "dmg"
    who = B("player", "the player") if target == "PLAYER" else B("dealer", "the dealer")
    d = {
        "globals": [(v, "int", a)],
        "hooks": {"round": [f"{v} += {k};", f"damage({target}, {v});"]},
        "bullets": [B(f"- damage ke {who} mulai {a}, naik +{k} tiap ronde (hook round)",
                      f"- damage to {who} starts at {a}, climbs +{k} each round (round hook)")],
        "think": [
            B(f"- eskalasi pake global {v}: tiap ronde nambah {k}",
              f"- the escalation lives in the {v} global: +{k} every round"),
            B(f"- hook round paling stabil buat pengali waktu, makin lama makin sakit buat {who}",
              f"- the round hook is the most stable clock, the pain on {who} keeps growing"),
        ],
    }
    if target == "PLAYER":
        d["intents"] = [
            (f"damage ke gw mulai {a} terus naik {k} tiap ronde", f"damage to me starts at {a} and climbs {k} each round", True),
            ("makin lama makin sakit buat player", "the longer it goes the more it hurts the player", False),
            ("eskalasi brutal: tiap ronde damage ke aku nambah", "brutal escalator: my damage rises every round", False),
            ("damage escalator buat player bang, biar buru-buru", "escalating damage on the player please, keep them rushing", False),
            (f"ronde makin tua peluru makin ngaco, mulai {a} plus {k} tiap ronde", f"older rounds hit harder: start {a} plus {k} per round", True),
            ("escalating damage each round on the player", "escalating damage each round on the player", False),
            ("tiap ronde pelurunya makin kenceng", "each round the shell bites harder", False),
        ]
    else:
        d["intents"] = [
            (f"dealer kena damage otomatis mulai {a}, nambah {k} tiap ronde", f"the dealer takes automatic damage starting at {a}, +{k} every round", True),
            ("pasang tekanan waktu: dealer bocor tiap ronde", "time pressure: the dealer leaks blood every round", False),
            ("tiap ronde dealer kehilangan darah dikit, makin lama makin banyak", "each round the dealer loses a little blood, growing over time", False),
            ("escalanat buat dealer, biar meja buru-buru", "an escalator for the dealer so the table rushes", False),
            ("round pressure on the dealer, small bleed that grows", "round pressure on the dealer, a small bleed that grows", False),
            ("meja ini bocor: dealer kena damage tiap ronde", "this table leaks: the dealer hurts every round", False),
        ]
    return d


def f_soften(sev):
    h = num(sev, "heal")
    p = num(sev, "period")
    t = "tick"
    d = {
        "globals": [(t, "int", 0)],
        "hooks": {"round": [f"{t} += 1;", f"if ({t} >= {p}) {{", f"    heal(PLAYER, {h});", f"    {t} = 0;", "}"]},
        "bullets": [B(f"- player regen {h} tiap {p} ronde (hook round)",
                      f"- the player regens {h} every {p} rounds (round hook)")],
        "think": [
            B(f"- regen pake counter {t}, reset abis heal biar periodenya bener",
              f"- the regen uses the {t} counter, reset after the heal keeps the period honest"),
            B(f"- heal {h} tiap {p} ronde: pelan, nggak bikin immortality",
              f"- heal {h} every {p} rounds: slow, never immortality"),
        ],
    }
    d["intents"] = [
        (f"kasih regen {h} tiap {p} ronde buat player", f"give the player a regen of {h} every {p} rounds", True),
        ("player heal dikit tiap beberapa ronde", "the player heals a little every few rounds", False),
        (f"tiap {p} ronde aku dapet napas kedua, heal {h}", f"every {p} rounds i get a second wind, heal {h}", True),
        ("regen pelan-pelan biar game-nya tahan lama", "a slow regen so the match lasts longer", False),
        ("heal kecil buat player tiap beberapa ronde", "a small heal for the player every few rounds", False),
        ("small regen every few rounds", "small regen every few rounds", False),
    ]
    return d


def f_endgame(sev):
    r = num(sev, "period") + 2
    dm = num(sev, "dmg") + (1 if sev == "high" else 0)
    taunt = TAU()
    d = {
        "globals": [],
        "hooks": {"round": [f"if (round() >= {r}) {{", f"    damage(PLAYER, {dm});", f'    say("{taunt}");', "}"]},
        "bullets": [B(f"- mulai ronde {r} player kena {dm} tiap ronde + peringatan (hook round)",
                      f"- from round {r} the player takes {dm} each round + a warning (round hook)")],
        "think": [
            B(f"- round() >= {r} nandain akhir permainan, tension naik",
              f"- round() >= {r} marks the endgame, the tension climbs"),
            B("- say() buat tanda satu baris, nggak lebay",
              "- one say() line as the sign, no drama overflow"),
        ],
    }
    d["intents"] = [
        (f"mulai ronde {r} damage ke gw nempel {dm} tiap ronde", f"from round {r} i take {dm} damage each round", True),
        ("pas ronde makhir, meja jadi galak + kasih tahu", "late game the table turns mean and announces it", False),
        ("endgame tension: ronde tua tambah damage", "endgame tension: old rounds add damage", False),
        ("kasih jam segel: ronde akhir makin bahaya", "add a sealed hourglass: the final rounds get dangerous", False),
        ("tiap ronde setelah beberapa ronde, player kena tambahan + dealer ngoceh", "after a few rounds the player takes extra damage + the dealer mocks", False),
        ("dmg ramps after round 5-ish plus a warning line", "dmg ramps after round 5-ish plus a warning line", False),
    ]
    return d


def f_fury(sev):
    t = num(sev, "thr")
    dm = num(sev, "dmg") + 1
    taunt = TAU()
    d = {
        "globals": [],
        "hooks": {"dealer_take_damage": [f"if (hp(DEALER) <= {t}) {{", f"    damage(PLAYER, {dm});", f'    say("{taunt}");', "}"]},
        "bullets": [B(f"- dealer darahnya mepet (<= {t}) langsung ngamuk: {dm} damage (hook dealer_take_damage)",
                      f"- the dealer at low hp (<= {t}) instantly rages back: {dm} damage (dealer_take_damage hook)")],
        "think": [
            B(f"- hp(DEALER) <= {t} artinya meja mepet mati, dia balas ngejar",
              f"- hp(DEALER) <= {t} means the table is one step from death, he chases back"),
            B(f"- damage {dm} + taunt: dramatis tapi jarang nyala",
              f"- {dm} damage + a taunt: dramatic but rarely live"),
        ],
    }
    d["intents"] = [
        (f"kalo darah dealer tinggal dikit dia ngamuk: damage {dm} balik", f"when the dealer is almost dead he rages: {dm} damage back", True),
        ("dealer mode cacing tanah, pas mepet dia ngamuk", "worm mode for the dealer: near death he strikes back", False),
        ("pas dealer hampir mati dia ngejar balik", "when the dealer is almost dead he chases back", False),
        ("berserk buat dealer pas hp kritis", "berserk for the dealer at critical hp", False),
        ("dealer desperation: makin mepet makin galak", "dealer desperation: the closer to death the meaner", False),
        ("when the dealer is almost dead he gets angry", "when the dealer is almost dead he gets angry", False),
    ]
    return d


def f_coinrig(sev):
    p = num(sev, "chance")
    d = {
        "globals": [],
        "hooks": {"coin": [f"if (chance({p})) {{", "    set_coin(1);", "}"]},
        "bullets": [B(f"- koin condong menang {p}% (hook coin)",
                      f"- the gamble coin leans toward heads {p}% (coin hook)")],
        "think": [
            B(f"- chance({p}) di hook coin: gamble jadi sedikit ramah",
              f"- chance({p}) inside the coin hook: the gamble turns slightly kind"),
            B("- set_coin(1) cuma nge-pakse flip berikutnya, bukan selamanya",
              "- set_coin(1) only forces the next flip, not forever"),
        ],
    }
    d["intents"] = [
        (f"koin miring ke kita {p} persen pas gamble", f"the coin leans toward us {p} percent on gamble", True),
        ("koin-nya diberat ke sisi jackpot", "weight the coin toward the jackpot side", False),
        ("gamble lebih sering menang, peluang naikin", "gamble wins more often, raise the odds", False),
        ("pasang koin berat: flip condong menang", "loaded coin: the flips favor winning", False),
        ("bias the gamble coin toward winning", "bias the gamble coin toward winning", False),
        ("koin pembawa untung dikit", "a slightly lucky coin", False),
    ]
    return d


def f_chaos(sev):
    p = num(sev, "chance")
    taunt = TAU()
    d = {
        "globals": [],
        "hooks": {"turn": [f"if (chance({p})) {{", "    shuffle();", f'    say("{taunt}");', "}"]},
        "bullets": [B(f"- peluru diacak {p}% tiap giliran (hook turn)",
                      f"- the shells get scrambled {p}% every turn (turn hook)")],
        "think": [
            B("- shuffle() di tengah giliran bikin tracking mental hampir gak berguna",
              "- shuffle() mid-turn makes mental tracking almost useless"),
            B(f"- {p}%: cukup sering, gak permanen",
              f"- {p}%: often enough, never permanent"),
        ],
    }
    d["intents"] = [
        (f"pelurunya diacak tiap giliran, peluang {p} persen", f"the shells get scrambled every turn, {p} percent chance", True),
        ("shell diacak-acak dong tiap turn", "shuffle the shells each turn so memory fails", False),
        ("shuffle peluru terus biar gak bisa dihafal", "keep re-shuffling the cylinder, no memorizing", False),
        ("acak ulang meja tiap giliran, bikin tegang", "re-randomize the table every turn, keep it tense", False),
        ("randomize the shells every turn with some chance", "randomize the shells every turn with some chance", False),
        ("peluru mimit diacak ulang, tangan gelombang", "wave hands: the bullets crawl around", False),
    ]
    return d


def f_shopfree(sev):
    sk = rng.choice(["reroll", "coffee", "peek", "cuffs"])
    d = {
        "globals": [],
        "hooks": {"shop": [f'run_skill("{sk}", PLAYER);']},
        "bullets": [B(f"- tiap buka toko dapat {sk} gratis (hook shop)",
                      f"- every shop visit grants a free {sk} (shop hook)")],
        "think": [
            B(f'- run_skill("{sk}", PLAYER) nyala pas meja buka toko',
              f'- run_skill("{sk}", PLAYER) fires when the table stocks its goods'),
            B("- gratis tapi cuma sekali per kunjungan toko",
              "- free, but only once per visit"),
        ],
    }
    d["intents"] = [
        (f"tiap masuk toko dapet {sk} gratis", f"every shop visit grants a free {sk}", False),
        ("belanja dikasih bonus skill gratis", "shopping comes with a free skill bonus", False),
        ("shop ramah: tiap buka toko ada skill free", "kind shop: a free skill every visit", False),
        (f"kasir baik: {sk} gratis tiap belanja", f"nice cashier: free {sk} with every purchase", False),
        ("free shop skill every visit", "free shop skill every visit", False),
        ("beli apapun dikasih bonus", "every stop at the shop drops a gift", False),
    ]
    return d


def f_peektax(sev):
    d0 = num(sev, "dmg")
    if rng.random() < 0.5:
        lines = [f"damage(PLAYER, {d0});"]
        bullet = B(f"- ngintip kena pajak: {d0} damage (hook peek)",
                   f"- peeping is taxed: {d0} damage (peek hook)")
        intents = [
            (f"ngintip kena penalti {d0} damage", f"peeping costs {d0} damage", True),
            ("peek bukan gratis: kena damage dikit", "peeking is not free: take a little damage", False),
            ("peeping costs something", "peeping costs something", False),
            ("penalti buat yang penasaran", "a penalty for the curious ones", False),
        ]
    else:
        lines = [f"heal(DEALER, {d0});"]
        bullet = B(f"- ngintip kena pajak: dealer heal {d0} (hook peek)",
                   f"- peeping is taxed: the dealer heals {d0} (peek hook)")
        intents = [
            (f"kalo gw intip, dealer malah heal {d0}", f"if i peek, the dealer heals {d0} instead", True),
            ("mata bayar: peek bikin dealer makin sehat", "paying eyes: peeking makes the dealer healthier", False),
            ("peeping costs something", "peeping costs something", False),
            ("intip = ngasih makan ke dealer", "the magnifier feeds the house", False),
        ]
    d = {"globals": [], "hooks": {"peek": lines}, "bullets": [bullet],
         "think": [B("- hook peek nyala tiap kaca pembesar dipakai", "- the peek hook fires every time the magnifier is used"),
                   B("- pajak kecil tapi bikin mikir dua kali", "- a small tax that makes you think twice")]}
    d["intents"] = intents
    return d


def f_skillecho(sev):
    n = num(sev, "heal")
    sk, const = rng.choice([("reroll", "SKILL_REROLL"), ("cuffs", "SKILL_CUFFS"), ("coffee", "SKILL_COFFEE"), ("voodoo", "SKILL_VOODOO")])
    d = {
        "globals": [],
        "hooks": {"skill": [f"if (last_skill() == {const}) {{", f"    heal(PLAYER, {n});", "}"]},
        "bullets": [B(f"- tiap pakai {sk}, player heal {n} (hook skill)",
                      f"- using {sk} heals the player {n} (skill hook)")],
        "think": [
            B(f"- last_skill() == {const} nangkep pemakaian {sk}",
              f"- last_skill() == {const} catches the {sk} use"),
            B(f"- heal {n}: kecil, tapi konsisten",
              f"- {n} hp: small, but consistent"),
        ],
    }
    d["intents"] = [
        (f"tiap aku pake {sk} dikasih heal {n}", f"every time i use {sk} i get a heal of {n}", True),
        (f"{sk} jadi ada bonus darah", f"{sk} now carries an hp bonus", False),
        ("bonus heal tiap pakai skill tertentu", "a small heal bonus when a specific skill is used", False),
        ("skill echo: pakai skill, dapet bonus", "skill echo: use a skill, get a bonus", False),
        ("heal when i use a specific skill", "heal when i use a specific skill", False),
        (f"echo bonus di {sk}", f"an echo bonus on {sk} uses", False),
    ]
    return d


def f_phoenixpraise(sev):
    n = num(sev, "heal")
    d = {
        "globals": [],
        "hooks": {"skill": [f"if (last_skill() == SKILL_PHOENIX) {{", f"    heal(PLAYER, {n});", "}"]},
        "bullets": [B(f"- abis bangkit pakai phoenix, heal {n} (hook skill)",
                      f"- after rising with phoenix, heal {n} (skill hook)")],
        "think": [B("- SKILL_PHOENIX di last_skill() nandain abis bangkit", "- SKILL_PHOENIX in last_skill() marks the resurrection"),
                  B(f"- heal {n} bikin resurrection makin terasa", f"- heal {n} makes the resurrection feel real")],
    }
    d["intents"] = [
        (f"abis phoenix, heal {n} dong", f"after phoenix, heal {n} please", True),
        ("phoenix bangkit dikasih bonus darah", "the resurrection gets an hp bonus", False),
        ("resurrection lebih manja dikit", "being reborn spoils me a little", False),
        ("bonus heal after phoenix", "bonus heal after phoenix", False),
        ("phoenix bangkit sekalian nyembuhin", "phoenix rises and mends me", False),
    ]
    return d


def f_eyepraise(sev):
    taunt = TAU()
    d = {
        "globals": [],
        "hooks": {"skill": ["if (last_skill() == SKILL_THIRDEYE) {", f'    say("{taunt}");', "}"]},
        "bullets": [B("- abis third eye, dealer ngoceh (hook skill)",
                      "- after the third eye, the dealer rambles (skill hook)")],
        "think": [B("- SKILL_THIRDEYE triggernya pas mata ketiga dipakai", "- SKILL_THIRDEYE triggers when the third eye is used"),
                  B("- cuma flavor line, gak ngubah angka", "- a flavor line only, the numbers stay untouched")],
    }
    d["intents"] = [
        ("abis pake third eye dealer ngoceh", "after using the third eye the dealer rambles", False),
        ("pas mata ketiga dibuka ada reaksi dari meja", "when the third eye opens the table reacts", False),
        ("third eye gets a reaction line", "third eye gets a reaction line", False),
        ("mata ketiga bikin dealer banyak bicara", "the eye makes the dealer talk", False),
    ]
    return d


def f_theme(sev):
    r = num(sev, "period") + 1
    c = rng.choice([16711850, 65280, 255, 16776960, 11141375, 4128832])
    d = {
        "globals": [],
        "hooks": {"round": [f"if (round() == {r}) {{", f"    theme({c});", "}"]},
        "bullets": [B(f"- pas ronde {r} lampu ruangan berubah (theme {c})",
                      f"- at round {r} the room lights change (theme {c})")],
        "think": [B(f"- theme({c}) ganti warna lampu pas ronde {r}", f"- theme({c}) retints the light at round {r}"),
                  B("- kosmetik doang, aman buat balance", "- cosmetic only, safe for balance")],
    }
    d["intents"] = [
        (f"ronde {r} ganti tema ruangan", f"at round {r} the room theme changes", True),
        ("ganti lampu meja di tengah game", "change the table lights mid game", False),
        ("temanya ruangan ganti pas ronde tertentu", "the mood of the room shifts at a certain round", False),
        ("mood swing: room light changes mid game", "mood swing: room light changes mid game", False),
        (f"swap warna lampu pas ronde {r}", f"swap the lamp color on round {r}", False),
    ]
    return d


def f_taunt(sev):
    line = TAU()
    if rng.random() < 0.5:
        lines = [f'say("{line}");']
        bullet = B("- dealer ngoceh tiap giliran (hook turn)",
                   "- the dealer rambles every turn (turn hook)")
        think = [B("- hook turn nyala tiap gantian", "- the turn hook fires on every swap"),
                 B("- satu baris flavor, nggak ngubah mekanik", "- one flavor line, no mechanics touched")]
    else:
        r = num(sev, "period") + 2
        lines = [f"if (round() >= {r}) {{", f'    say("{line}");', "}"]
        bullet = B(f"- mulai ronde {r} dealer ngoceh (hook turn)",
                   f"- from round {r} the dealer rambles (turn hook)")
        think = [B(f"- round() >= {r}: ngoceh mulai di ronde tua", f"- round() >= {r}: the rambling starts in the late rounds"),
                 B("- flavor buat tension", "- flavor for tension")]
    d = {"globals": [], "hooks": {"turn": lines}, "bullets": [bullet], "think": think}
    d["intents"] = [
        ("dealer banyak omong tiap giliran", "the dealer talks a lot every turn", False),
        ("kasih sindiran tiap giliran biar tegang", "a mocking line every turn keeps it tense", False),
        ("the dealer talks trash every turn", "the dealer talks trash every turn", False),
        ("meja ngoceh dong biar hidup", "make the table ramble, it feels alive", False),
        ("sindiran per giliran", "one taunt per turn", False),
    ]
    return d


def f_burst(sev):
    p = num(sev, "chance") // 2
    d = {
        "globals": [],
        "hooks": {"dealer_take_damage": [f"if (chance({p})) {{", "    repeat(2) {", "        damage(DEALER, 1);", "    }", '    say("doble tap!");', "}"]},
        "bullets": [B(f"- {p}% doble tap: damage ganda ke dealer (hook dealer_take_damage)",
                      f"- {p}% double tap: double damage to the dealer (dealer_take_damage hook)")],
        "think": [B("- repeat(2) = kombo dua pukulan", "- repeat(2) = a two hit combo"),
                  B(f"- chance({p}) bikin kombo spesial, bukan tiap hit", f"- chance({p}) keeps the combo special, not every hit")],
    }
    d["intents"] = [
        (f"kadang kombo doble tap {p} persen", f"sometimes a double tap combo, {p} percent", True),
        ("kasih kombo damage ganda sesekali", "an occasional double damage combo", False),
        ("double tap combo sometimes", "double tap combo sometimes", False),
        ("tiap nembak ada kesempatan kombo 2x", "every shot has a chance of a 2x combo", False),
        ("kombo langka yang keras", "a rare combo burst that hits hard", False),
    ]
    return d


def f_loopdrain(sev):
    p = num(sev, "chance") // 3
    g = "drain"
    d = {
        "globals": [(g, "int", 3)],
        "hooks": {"round": [f"if (chance({p})) {{", f"    {g} = 3;", f"    while ({g} > 0) {{", f"        {g} -= 1;", "        damage(DEALER, 1);", "    }", "}"]},
        "bullets": [B(f"- {p}% panen pelan: 3 tambalan ke dealer (hook round)",
                      f"- {p}% slow harvest: 3 chips of damage to the dealer (round hook)")],
        "think": [B(f"- while({g} > 0) nge-pump 3 damage, fuel guard bawaan bakal jaga", f"- while({g} > 0) pumps 3 damage, the built-in fuel guard protects"),
                  B(f"- chance({p}) biar jarang tapi kenceng", f"- chance({p}) keeps it rare but heavy")],
    }
    d["intents"] = [
        (f"sese kali ada panen pelan {p} persen, 3 tambalan ke dealer", f"rare slow harvest {p} percent, 3 chips to the dealer", True),
        ("kadang dealer kepanen 3x sekaligus", "sometimes the dealer takes 3 hits at once", False),
        ("satu ronde bisa kejadian triple damage buat dealer", "one round can drop a triple damage on the dealer", False),
        ("occasionally triple drain on the dealer", "occasionally triple drain on the dealer", False),
        ("gerinda pelan tapi dalam", "a slow grinder, deep cuts", False),
    ]
    return d


FEATURES = {
    "vampire": f_vampire, "leech": f_leech, "escalate": f_escalate,
    "soften": f_soften, "endgame": f_endgame, "fury": f_fury,
    "coinrig": f_coinrig, "chaos": f_chaos, "shopfree": f_shopfree,
    "peektax": f_peektax, "skillecho": f_skillecho, "phoenixpraise": f_phoenixpraise,
    "eyepraise": f_eyepraise, "theme": f_theme, "taunt": f_taunt,
    "burst": f_burst, "loopdrain": f_loopdrain,
}
# rare features only appear as add-ons
RARE = {"theme", "loopdrain", "eyepraise", "phoenixpraise", "burst", "skillecho"}

CORES = ["vampire", "leech", "escalate", "soften", "endgame", "fury", "coinrig", "chaos", "shopfree", "peektax", "taunt"]

ADDONS = {
    "soften": ("tambah regen tiap ronde", "add a small regen each round"),
    "chaos": ("peluru diacak tiap ronde", "scramble the shells every round"),
    "coinrig": ("koin dikit ke arah kita", "lean the coin toward us a bit"),
    "taunt": ("dealer ikut ngoceh", "let the dealer ramble too"),
    "peektax": ("intip kena pajak", "make peeping cost something"),
}

TAGLINES = {
    "vampire": ("tiap peluru yang kena gw jadi sustennya", "every bullet that hits you becomes its meal"),
    "leech": ("darah dealer pindah ke tangan gw", "the blood of the dealer moves into your hands"),
    "escalate": ("makin lama makin nggak ada yang aman", "the longer it goes, the less is safe"),
    "soften": ("napas kecil di antara tembakan", "a small breath between shots"),
    "endgame": ("jam pasir mulai bicara", "the hourglass starts talking"),
    "fury": ("jangan paksa dia ngamuk", "do not push him into a rage"),
    "coinrig": ("koin punya sisi favorit", "the coin has a favorite side"),
    "chaos": ("tangan gelombang, peluru cakar", "waving hands, clawing bullets"),
    "shopfree": ("toko yang terlalu baik hati", "a shop that is too kind"),
    "peektax": ("penasaran itu mahal", "curiosity is expensive"),
    "skillecho": ("kartu balik suara", "the cards echo back"),
    "phoenixpraise": ("abu abu jadi napas", "ashes become breath"),
    "eyepraise": ("yang tersembunyi jadi berat", "the hidden becomes heavy"),
    "theme": ("lampu ikut ikut pemain", "the lights take your side"),
    "taunt": ("meja yang perlu banyak bicara", "a table that needs to talk"),
    "burst": ("kadang datang dua kali", "sometimes it comes twice"),
    "loopdrain": ("panen pelan pake gerinda", "a slow harvest with a grinder"),
}

# ------------------------------------------------------------------ #
# assembly                                                           #
# ------------------------------------------------------------------ #

HOOK_ORDER = ["round", "turn", "hit", "player_take_damage", "dealer_take_damage", "skill", "shop", "coin", "peek"]

MOOD_POOL = {
    "vampire": [("crypt", "crypt"), ("kapal karam", "shipwreck"), ("gudang tua", "old warehouse")],
    "fury": [("cabin merah", "red cabin"), ("gudang tua", "old warehouse")],
    "coinrig": [("neon bawah tanah", "underground neon")],
    "chaos": [("kereta malam", "night train"), ("neon bawah tanah", "underground neon")],
    "theme": [("rumah kaca", "glass house"), ("salju", "snow")],
}


def mood_for(feat_ids):
    for f in feat_ids:
        if f in MOOD_POOL:
            mid, men = rng.choice(MOOD_POOL[f])
            return mid if LANG == "id" else men
    mid, men = rng.choice(spec.MOODS)
    return mid if LANG == "id" else men


def emit_code(feats, used):
    """feats: list of feature dicts (in selection order). returns code str"""
    tight = False
    out = []
    # globals
    gmap = {}
    for f in feats:
        for name, t, init in f["globals"]:
            if name in gmap:
                continue
            gmap[name] = (t, init)
            out.append(f"int {name} = {init};")
    if out:
        out.append("")
        if not tight:
            out.append("")
    # hooks merged in canonical order
    for hook in HOOK_ORDER:
        lines = []
        for f in feats:
            lines += f["hooks"].get(hook, [])
        if not lines:
            continue
        head = f"every ({hook}) {{" if rng.random() < 0.75 else f"every({hook}) {{"
        out.append(head)
        for ln in lines:
            out.append(("    " + ln) if ln else "")
        out.append("}")
        if not tight:
            out.append("")
    while out and out[-1] == "":
        out.pop()
    return "\n".join(out) + "\n"


def plan_text(primary, feats, mood):
    titles = spec.TITLES[primary][LANG]
    title = rng.choice(titles).lower()
    tag = TAGLINES[primary][0] if LANG == "id" else TAGLINES[primary][1]
    lines = [f"title: {title}", f"tagline: {tag}"]
    for f in feats:
        lines += f["bullets"]
    lines.append(B(f"ruangan: {mood}", f"room: {mood}"))
    return "\n".join(lines)


def think_text(feats):
    lines = []
    for f in feats:
        lines += f["think"]
    hooks_used = []
    for f in feats:
        for h in f["hooks"]:
            if h not in hooks_used:
                hooks_used.append(h)
    lines.append(B("- cek ulang: argumen builtin valid, hook urutannya " + " + ".join(hooks_used),
                   "- double check: builtin args valid, hook order " + " + ".join(hooks_used)))
    lines = lines[:4]
    return "\n".join("- " + l[2:] if l.startswith("- ") else "- " + l for l in lines)


def assemble_intent(feats, sevs):
    """1-3 sentence intent from the feature banks"""
    parts = []
    for f in feats:
        bank = f["intents"]
        idt, ent, _flag = rng.choice(bank)
        parts.append(idt if LANG == "id" else ent)
    joiners_id = [" + ", ", terus ", ", plus ", ". terus ", " gimana? terus ", " | ", ", sama "]
    joiners_en = [" + ", ", and ", ", plus ", ". then ", " also ", " | ", " then "]
    joiner = rng.choice(joiners_id if LANG == "id" else joiners_en)
    intent = parts[0]
    for p in parts[1:]:
        intent += joiner + p
    # severity words sometimes appended / prepended
    if rng.random() < 0.3:
        sev = sevs[0]
        word_id = {"low": ["tipis aja", "adil dikit", "jangan kejam"], "mid": ["standar aja", "seimbang"], "high": ["brutal", "gila", "kejam", "nyekik"]}[sev]
        word_en = {"low": ["keep it fair", "soft please", "be gentle"], "mid": ["standard is fine", "balanced"], "high": ["brutal", "insane", "cruel", "merciless"]}[sev]
        word = rng.choice(word_id if LANG == "id" else word_en)
        intent += f" ({word})"
    # occasional typo / slang noise (char-fallback training)
    if rng.random() < 0.09:
        intent = _add_noise(intent)
    if len(intent) > 190:
        intent = intent[:intent.rfind(" ", 0, 190)] if " " in intent[:190] else intent[:190]
    return intent


NOISE_ID = [
    ("bikin", "bikinin"), ("heal", "healingin"), ("ronde", "ronndee"),
    ("vampir", "vampirrr"), ("tembak", "tembak2"), ("diacak", "diacak2"),
    ("peluru", "pelorrr"), ("koin", "koinz"), ("toko", "tokoo"),
]
NOISE_EN = [
    ("heal", "heall"), ("dealer", "dealet"), ("round", "ronud"),
    ("shell", "shlell"), ("coin", "c0in"), ("peek", "peke"),
    ("damage", "dammage"), ("brutal", "brutall"),
]


def _add_noise(s):
    src = NOISE_ID if LANG == "id" else NOISE_EN
    w0 = rng.choice(src)
    return s.replace(w0[0], w0[1], 1)

# ------------------------------------------------------------------ #
# revision                                                           #
# ------------------------------------------------------------------ #

BRUTALIZE = (["lebih brutal", "gebrak lebih keras", "naikin semuanya", "jangan manja", "kejam-in dong"],
             ["more brutal", "hit harder", "scale it all up", "do not be soft", "make it cruel"])
SOFTEN_R = (["lebih adil", "pelan pelan aja", "turunin angkanya", "jangan kejam", "halusin dikit"],
            ["more fair", "tone it down", "lower the numbers", "be gentle", "softer please"])


def bump_num(text_line, delta_fn):
    """rewrite numbers in a bullet line by a delta function"""
    out = []
    i = 0
    while i < len(text_line):
        c = text_line[i]
        if c.isdigit():
            j = i
            while j < len(text_line) and text_line[j].isdigit():
                j += 1
            n0 = int(text_line[i:j])
            n1 = max(1, min(90, delta_fn(n0)))
            out.append(str(n1))
            i = j
        else:
            out.append(c)
            i += 1
    return "".join(out)


def revise_mode(feat_ids, feat_dicts, instr_kind):
    """returns (instr_text, new_feat_ids, new_feat_dicts, delta)"""
    delta_up = lambda n: max(2, int(n * 2) if n <= 4 else min(85, n + 20))
    delta_dn = lambda n: max(1, max(1, n // 2) if n <= 4 else max(10, n - 20))
    if instr_kind == "brutal":
        new_dicts = []
        for f in feat_dicts:
            d = dict(f)
            d["bullets"] = [bump_num(b, delta_up) for b in f["bullets"]]
            new_dicts.append(d)
        return rng.choice(BRUTALIZE[0] if LANG == "id" else BRUTALIZE[1]), list(feat_ids), new_dicts, "up"
    if instr_kind == "soften":
        new_dicts = []
        for f in feat_dicts:
            d = dict(f)
            d["bullets"] = [bump_num(b, delta_dn) for b in f["bullets"]]
            new_dicts.append(d)
        return rng.choice(SOFTEN_R[0] if LANG == "id" else SOFTEN_R[1]), list(feat_ids), new_dicts, "dn"
    if instr_kind == "add":
        add_id = rng.choice(list(ADDONS.keys()))
        if add_id in feat_ids:
            add_id = rng.choice([a for a in ADDONS if a not in feat_ids] or ["taunt"])
        sev = pick_sev()
        new_f = FEATURES[add_id](sev)
        instr = ADDONS[add_id][0] if LANG == "id" else ADDONS[add_id][1]
        return instr, feat_ids + [add_id], feat_dicts + [new_f], None
    if instr_kind == "remove":
        if len(feat_ids) <= 1:
            return None, None, None, None
        idx = rng.randrange(len(feat_ids))
        gone = feat_ids[idx]
        instr = rng.choice([
            B(f"hapus yang {gone}", f"remove the {gone}"),
            B(f"jangan {gone} dulu", f"drop the {gone} part"),
            B("buang satu mekanik", "take one mechanic out"),
        ])
        return instr, feat_ids[:idx] + feat_ids[idx + 1:], feat_dicts[:idx] + feat_dicts[idx + 1:], None
    return None, None, None, None


def code_from(feat_ids, feat_dicts, delta, sev0):
    """re-emit code for revised knobs: scale the numbers inside code lines
    so plan bullets and code agree"""
    up = delta == "up"
    fn = (lambda n: max(2, int(n * 2) if n <= 4 else min(85, n + 20))) if up else (
        lambda n: max(1, n // 2 if n <= 4 else max(10, n - 20)))
    used = set()
    out_lines = []
    gmap = {}
    for f in feat_dicts:
        for name, t, init in f["globals"]:
            if name in gmap:
                continue
            gmap[name] = fn(init) if up or (delta == "dn" and init > 1) else init
            out_lines.append(("g", f"int {name} = {gmap[name]};"))
    if out_lines:
        out_lines.append(("g", ""))
        out_lines.append(("g", ""))
    for hook in HOOK_ORDER:
        lines = []
        for f in feat_dicts:
            for ln in f["hooks"].get(hook, []):
                if delta in ("up", "dn"):
                    ln = bump_num(ln, fn)
                lines.append(ln)
        if not lines:
            continue
        lines = [f"every ({hook}) {{" if rng.random() < 0.7 else f"every({hook}) {{" ] + [("    " + l if l else "") for l in lines] + ["}", ""]
        for l in lines:
            out_lines.append(("c", l))
    while out_lines and out_lines[-1][1] == "":
        out_lines.pop()
    return "\n".join(l for _k, l in out_lines) + "\n"

# ------------------------------------------------------------------ #
# main generation                                                    #
# ------------------------------------------------------------------ #

def make_example():
    global LANG
    LANG = rng.choice(["id", "en"])
    n_feats = rng.choices([1, 2], weights=[0.72, 0.28])[0]
    ids = [rng.choice(CORES)]
    while len(ids) < n_feats:
        cand = rng.choice(CORES + list(RARE))
        if cand not in ids:
            ids.append(cand)
    if rng.random() < 0.08 and ids[0] in RARE:
        ids[0] = rng.choice(CORES)
    ids = ids[:n_feats]
    sevs = [pick_sev() for _ in ids]
    dicts = [FEATURES[i](s) for i, s in zip(ids, sevs)]
    mood = mood_for(ids)
    intent = assemble_intent(dicts, sevs)
    plan = plan_text(ids[0], dicts, mood)
    code = emit_code(dicts, set())

    # revision rounds only on short modes — keeps the sequence inside budget
    has_rev = n_feats <= 2 and rng.random() < 0.38
    if has_rev:
        kind = rng.choices(["brutal", "soften", "add", "remove"], weights=[0.32, 0.28, 0.28, 0.12])[0]
        instr, ids2, dicts2, delta = revise_mode(ids, dicts, kind)
        if instr is None:
            has_rev = False
        else:
            mood2 = mood if rng.random() < 0.7 else mood_for(ids2)
            plan2 = plan_text(ids2[0], dicts2, mood2)
            code2 = code_from(ids2, dicts2, delta, sevs[0])
            text = (
                f"<intent> {intent}\n"
                f"<plan>\n{plan}\n"
                f"<revise> {instr}\n"
                f"<plan>\n{plan2}\n"
                f"<think>\n{think_text(dicts2)}\n"
                f"<code>\n{code2}<end>"
            )
            return text, ids2
    text = (
        f"<intent> {intent}\n"
        f"<plan>\n{plan}\n"
        f"<think>\n{think_text(dicts)}\n"
        f"<code>\n{code}<end>"
    )
    return text, ids


def collect_wordfreq(texts):
    freq = {}
    for t in texts:
        for m in spec.REGEX.finditer(t):
            special, c1, c2, string, numv, word, p2, p1, nl, sp = m.groups()
            if word is not None and not spec._is_code(word):
                w0 = word.lower()
                freq[w0] = freq.get(w0, 0) + 1
            elif c1 is not None or c2 is not None or string is not None:
                inner = (c1 or c2 or string[1:-1])
                for m2 in spec.REGEX.finditer(inner):
                    w0 = m2.group(6)
                    if w0 is not None and not spec._is_code(w0):
                        freq[w0] = freq.get(w0, 0) + 1
    return freq


def main():
    n_target = int(sys.argv[1]) if len(sys.argv) > 1 else 7000
    texts = []
    seen_codes = {}
    tries = 0
    while len(texts) < n_target and tries < n_target * 6:
        tries += 1
        text, ids = make_example()
        # structural dedupe on the code part
        code_part = text.split("<code>\n", 1)[1]
        key = _norm_code(code_part)
        if seen_codes.get(key, 0) >= 3:
            continue
        seen_codes[key] = seen_codes.get(key, 0) + 1
        texts.append(text)
    idn = sum(1 for t in texts if "<intent> " in t)
    print(f"generated {len(texts)} examples from {tries} tries")
    vocab_path = os.path.join(OUT_VOCAB, "vocab.json")
    # the model changed -> always rebuild the vocab from scratch
    freq = collect_wordfreq(texts)
    vocab = spec.build_vocab(freq)
    spec.save_shared(OUT_VOCAB, vocab)
    print(f"vocab size: {len(vocab['itos'])}")

    # encode + length filter
    kept = []
    dropped_long = 0
    total_tokens = 0
    roundtrip_fail = 0
    for t in texts:
        ids = spec.encode(t, vocab)
        if len(ids) > 380:
            dropped_long += 1
            continue
        total_tokens += len(ids)
        kept.append(ids)
        dec = spec.decode(ids, vocab["itos"])
        if dec != t:
            roundtrip_fail += 1
            if roundtrip_fail <= 3:
                print("--- ROUNDTRIP MISMATCH ---")
                print(repr(t[:300]))
                print(repr(dec[:300]))
    print(f"kept {len(kept)} examples, {total_tokens} tokens (avg {total_tokens // max(1, len(kept))}), dropped_long={dropped_long}, roundtrip_fail={roundtrip_fail}")

    os.makedirs(OUT_DATA, exist_ok=True)
    with open(os.path.join(OUT_DATA, "corpus.jsonl"), "w", encoding="utf-8") as f:
        for ids in kept:
            f.write(json.dumps(ids) + "\n")
    stats = {
        "examples": len(kept),
        "tokens": total_tokens,
        "vocab": len(vocab["itos"]),
    }
    with open(os.path.join(OUT_DATA, "stats.json"), "w") as f:
        json.dump(stats, f, indent=2)
    # print a sample of each language
    print("=== SAMPLE (first) ===")
    print(spec.decode(kept[0], vocab["itos"])[:900])


def _norm_code(code):
    import re as _re
    s = _re.sub(r"\d+", "N", code)
    s = _re.sub(r"\b(?:dmg|heal|regen|tick|count|scale|spike|streak|pot|tax|rage|debt|greed|mercy|ramp|blood|luck|fever|curse|pact|extra|k|n|turnNo|hitCount|roundNo|glow|shadow|frenzy|hunger|drain)\b", "V", s)
    return s


if __name__ == "__main__":
    main()
