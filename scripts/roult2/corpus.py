"""
roult2/corpus.py — builds the FROM-SCRATCH training corpus for roult v2.

Every example:
  <intent> {free text, id/en slang} <plan> {title/tagline/bullets/ruangan}
  [<revise> {instruction} <plan> {revised plan}]   (~35%)
  <think> {reasoning bullets} <code> {ENGINE C} <end>

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
#   bullets: [str]  think: [str]  intents: [(text, mentions_n(bool))]

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
        "bullets": [f"- dealer sembuh {n} tiap player kena peluru (hook player_take_damage)"],
        "think": [
            f"- sifat utamanya vampir: hook player_take_damage cuma nyala pas peluru kena player",
            f"- heal {n} per kena bikin dealer ngebut pelan, masih ada counterplay",
        ],
    }
    d["intents"] = [
        (f"vampire mode: kalo gw kena tembak dealer malah heal {n}", True),
        (f"mode vampir, tiap aku kena dealer sembuh {n}", True),
        ("gw kena peluru tapi dealer malah makin sehat, gitu deh", False),
        ("dealer jadi vampir: darah gw jadi makanannya", False),
        (f"vampire table bang, dealer nyedot tiap peluru yang ngena gw", False),
        ("kalo aku kena damage, dealer heal dikit", False),
        ("the dealer heals when i get hit, vampire rules", False),
        ("tiap player kena, dealer nambah darah", False),
        ("buat yang iseng: damage ke gw bikin dealer hidup lagi", False),
        (f"vampire play: gw kena = dealer heal {n}", True),
    ]
    return d

def f_leech(sev):
    n = num(sev, "heal")
    d = {
        "globals": [],
        "hooks": {"dealer_take_damage": [f"heal(PLAYER, {n});"]},
        "bullets": [f"- player heal {n} tiap dealer kena peluru (hook dealer_take_damage)"],
        "think": [
            "- lifesteal: hook dealer_take_damage nyala pas peluru masuk dealer",
            f"- heal {n} per hit: agresif tapi adil, dua-duanya masih bisa mati",
        ],
    }
    d["intents"] = [
        (f"lifesteal: tiap gw nembak dealer, darah gw nambah {n}", True),
        ("gw heal tiap berhasil nutupin peluru ke dealer", False),
        ("tiap hit ke dealer, aku sembuh dikit", False),
        (f"mode lintah: darah dealer jadi darah gw, heal {n} per kena", True),
        ("player nyedot darah dealer tiap kena", False),
        ("leech mode: my hits heal me a bit", False),
        ("tiap aku berhasil nembak, darahku naik", False),
        ("succ tiap hit dong biar tahan lama", False),
    ]
    return d

def f_escalate(sev):
    a = num(sev, "start")
    k = num(sev, "step")
    target = rng.choice(["PLAYER", "DEALER"])
    v = "dmg"
    who = "player" if target == "PLAYER" else "dealer"
    d = {
        "globals": [(v, "int", a)],
        "hooks": {"round": [f"{v} += {k};", f"damage({target}, {v});"]},
        "bullets": [f"- damage ke {who} mulai {a}, naik +{k} tiap ronde (hook round)"],
        "think": [
            f"- eskalasi pake global {v}: tiap ronde nambah {k}",
            f"- hook round paling stabil buat pengali waktu, makin lama makin sakit buat {who}",
        ],
    }
    if target == "PLAYER":
        d["intents"] = [
            (f"damage ke gw mulai {a} terus naik {k} tiap ronde", True),
            ("makin lama makin sakit buat player", False),
            ("eskalasi brutal: tiap ronde damage ke aku nambah", False),
            ("damage escalator buat player bang, biar buru-buru", False),
            (f"ronde makin tua peluru makin ngaco, mulai {a} plus {k} tiap ronde", True),
            ("escalating damage each round on the player", False),
            ("tiap ronde pelurunya makin kenceng", False),
        ]
    else:
        d["intents"] = [
            (f"dealer kena damage otomatis mulai {a}, nambah {k} tiap ronde", True),
            ("pasang tekanan waktu: dealer bocor tiap ronde", False),
            ("tiap ronde dealer kehilangan darah dikit, makin lama makin banyak", False),
            ("escalanat buat dealer, biar meja buru-buru", False),
            ("round pressure on the dealer, small bleed that grows", False),
            ("meja ini bocor: dealer kena damage tiap ronde", False),
        ]
    return d

def f_soften(sev):
    h = num(sev, "heal")
    p = num(sev, "period")
    t = "tick"
    d = {
        "globals": [(t, "int", 0)],
        "hooks": {"round": [f"{t} += 1;", f"if ({t} >= {p}) {{", f"    heal(PLAYER, {h});", f"    {t} = 0;", "}"]},
        "bullets": [f"- player regen {h} tiap {p} ronde (hook round)"],
        "think": [
            f"- regen pake counter {t}, reset abis heal biar periodenya bener",
            f"- heal {h} tiap {p} ronde: pelan, nggak bikin immortality",
        ],
    }
    d["intents"] = [
        (f"kasih regen {h} tiap {p} ronde buat player", True),
        ("player heal dikit tiap beberapa ronde", False),
        (f"tiap {p} ronde aku dapet napas kedua, heal {h}", True),
        ("regen pelan-pelan biar game-nya tahan lama", False),
        ("heal kecil buat player tiap beberapa ronde", False),
        ("small regen every few rounds", False),
    ]
    return d

def f_endgame(sev):
    r = num(sev, "period") + 2
    dm = num(sev, "dmg") + (1 if sev == "high" else 0)
    d = {
        "globals": [],
        "hooks": {"round": [f"if (round() >= {r}) {{", f"    damage(PLAYER, {dm});", '    say("waktu habis...");', "}"]},
        "bullets": [f"- mulai ronde {r} player kena {dm} tiap ronde + peringatan (hook round)"],
        "think": [
            f"- round() >= {r} nandain akhir permainan, tension naik",
            "- say() buat tanda satu baris, nggak lebay",
        ],
    }
    d["intents"] = [
        (f"mulai ronde {r} damage ke gw nempel {dm} tiap ronde", True),
        ("pas ronde makhir, meja jadi galak + kasih tahu", False),
        ("endgame tension: ronde tua tambah damage", False),
        ("kasih jam segel: ronde akhir makin bahaya", False),
        ("tiap ronde setelah beberapa ronde, player kena tambahan + dealer ngoceh", False),
        ("dmg ramps after round 5-ish plus a warning line", False),
    ]
    return d

def f_fury(sev):
    t = num(sev, "thr")
    dm = num(sev, "dmg") + 1
    d = {
        "globals": [],
        "hooks": {"dealer_take_damage": [f"if (hp(DEALER) <= {t}) {{", f"    damage(PLAYER, {dm});", '    say("jangan nakal");', "}"]},
        "bullets": [f"- dealer darahnya mepet (<= {t}) langsung ngamuk: {dm} damage (hook dealer_take_damage)"],
        "think": [
            f"- hp(DEALER) <= {t} artinya meja mepet mati, dia balas ngejar",
            f"- damage {dm} + taunt: dramatis tapi jarang nyala",
        ],
    }
    d["intents"] = [
        (f"kalo darah dealer tinggal dikit dia ngamuk: damage {dm} balik", True),
        ("dealer mode cacing tanah, pas mepet dia ngamuk", False),
        ("pas dealer hampir mati dia ngejar balik", False),
        ("berserk buat dealer pas hp kritis", False),
        ("dealer desperation: makin mepet makin galak", False),
        ("when the dealer is almost dead he gets angry", False),
    ]
    return d

def f_coinrig(sev):
    p = num(sev, "chance")
    d = {
        "globals": [],
        "hooks": {"coin": [f"if (chance({p})) {{", "    set_coin(1);", "}"]},
        "bullets": [f"- koin condong menang {p}% (hook coin)"],
        "think": [
            f"- chance({p}) di hook coin: gamble jadi sedikit ramah",
            "- set_coin(1) cuma nge-pakse flip berikutnya, bukan selamanya",
        ],
    }
    d["intents"] = [
        (f"koin miring ke kita {p} persen pas gamble", True),
        ("koin-nya diberat ke sisi jackpot", False),
        ("gamble lebih sering menang, peluang naikin", False),
        ("pasang koin berat: flip condong menang", False),
        ("bias the gamble coin toward winning", False),
        ("koin pembawa untung dikit", False),
    ]
    return d

def f_chaos(sev):
    p = num(sev, "chance")
    d = {
        "globals": [],
        "hooks": {"turn": [f"if (chance({p})) {{", "    shuffle();", '    say("shell-nya diacak!");', "}"]},
        "bullets": [f"- peluru diacak {p}% tiap giliran (hook turn)"],
        "think": [
            f"- shuffle() di tengah giliran bikin tracking mental hampir gak berguna",
            f"- {p}%: cukup sering, gak permanen",
        ],
    }
    d["intents"] = [
        (f"pelurunya diacak tiap giliran, peluang {p} persen", True),
        ("shell diacak-acak dong tiap turn", False),
        ("shuffle peluru terus biar gak bisa dihafal", False),
        ("acak ulang meja tiap giliran, bikin tegang", False),
        ("randomize the shells every turn with some chance", False),
        ("peluru mimit diacak ulang, tangan gelombang", False),
    ]
    return d

def f_shopfree(sev):
    sk = rng.choice(["reroll", "coffee", "peek", "cuffs"])
    d = {
        "globals": [],
        "hooks": {"shop": [f'run_skill("{sk}", PLAYER);']},
        "bullets": [f"- tiap buka toko dapat {sk} gratis (hook shop)"],
        "think": [
            f'- run_skill("{sk}", PLAYER) nyala pas meja buka toko',
            "- gratis tapi cuma sekali per kunjungan toko",
        ],
    }
    d["intents"] = [
        (f"tiap masuk toko dapet {sk} gratis", False),
        ("belanja dikasih bonus skill gratis", False),
        ("shop ramah: tiap buka toko ada skill free", False),
        (f"kasir baik: {sk} gratis tiap belanja", False),
        ("free shop skill every visit", False),
    ]
    return d

def f_peektax(sev):
    d0 = num(sev, "dmg")
    if rng.random() < 0.5:
        lines = [f"damage(PLAYER, {d0});"]
        bullet = f"- ngintip kena pajak: {d0} damage (hook peek)"
        intent0 = f"ngintip kena penalti {d0} damage"
        intent1 = "peek bukan gratis: kena damage dikit"
    else:
        lines = [f"heal(DEALER, {d0});"]
        bullet = f"- ngintip kena pajak: dealer heal {d0} (hook peek)"
        intent0 = f"kalo gw intip, dealer malah heal {d0}"
        intent1 = "mata bayar: peek bikin dealer makin sehat"
    d = {"globals": [], "hooks": {"peek": lines}, "bullets": [bullet],
         "think": ["- hook peek nyala tiap kaca pembesar dipakai", "- pajak kecil tapi bikin mikir dua kali"]}
    d["intents"] = [(intent0, True), (intent1, False), ("peeping costs something", False), ("penalti buat yang penasaran", False)]
    return d

def f_skillecho(sev):
    n = num(sev, "heal")
    sk, const = rng.choice([("reroll", "SKILL_REROLL"), ("cuffs", "SKILL_CUFFS"), ("coffee", "SKILL_COFFEE"), ("voodoo", "SKILL_VOODOO")])
    d = {
        "globals": [],
        "hooks": {"skill": [f"if (last_skill() == {const}) {{", f"    heal(PLAYER, {n});", "}"]},
        "bullets": [f"- tiap pakai {sk}, player heal {n} (hook skill)"],
        "think": [
            f"- last_skill() == {const} nangkep pemakaian {sk}",
            f"- heal {n}: kecil, tapi konsisten",
        ],
    }
    d["intents"] = [
        (f"tiap aku pake {sk} dikasih heal {n}", True),
        (f"{sk} jadi ada bonus darah", False),
        ("bonus heal tiap pakai skill tertentu", False),
        ("skill echo: pakai skill, dapet bonus", False),
        ("heal when i use a specific skill", False),
    ]
    return d

def f_phoenixpraise(sev):
    n = num(sev, "heal")
    d = {
        "globals": [],
        "hooks": {"skill": [f"if (last_skill() == SKILL_PHOENIX) {{", f"    heal(PLAYER, {n});", "}"]},
        "bullets": [f"- abis bangkit pakai phoenix, heal {n} (hook skill)"],
        "think": ["- SKILL_PHOENIX di last_skill() nandain abis bangkit", f"- heal {n} bikin resurrection makin terasa"],
    }
    d["intents"] = [
        (f"abis phoenix, heal {n} dong", True),
        ("phoenix bangkit dikasih bonus darah", False),
        ("resurrection lebih manja dikit", False),
        ("bonus heal after phoenix", False),
    ]
    return d

def f_eyepraise(sev):
    d = {
        "globals": [],
        "hooks": {"skill": ["if (last_skill() == SKILL_THIRDEYE) {", '    say("kelihatan semua...");', "}"]},
        "bullets": ["- abis third eye, dealer ngoceh (hook skill)"],
        "think": ["- SKILL_THIRDEYE triggernya pas mata ketiga dipakai", "- cuma flavor line, gak ngubah angka"],
    }
    d["intents"] = [
        ("abis pake third eye dealer ngoceh", False),
        ("pas mata ketiga dibuka ada reaksi dari meja", False),
        ("third eye gets a reaction line", False),
    ]
    return d

def f_theme(sev):
    r = num(sev, "period") + 1
    c = rng.choice([16711850, 65280, 255, 16776960, 11141375, 4128832])
    d = {
        "globals": [],
        "hooks": {"round": [f"if (round() == {r}) {{", f"    theme({c});", "}"]},
        "bullets": [f"- pas ronde {r} lampu ruangan berubah (theme {c})"],
        "think": [f"- theme({c}) ganti warna lampu pas ronde {r}", "- kosmetik doang, aman buat balance"],
    }
    d["intents"] = [
        (f"ronde {r} ganti tema ruangan", True),
        ("ganti lampu meja di tengah game", False),
        ("temanya ruangan ganti pas ronde tertentu", False),
        ("mood swing: room light changes mid game", False),
    ]
    return d

def f_taunt(sev):
    line = "waktu habis..."
    if rng.random() < 0.5:
        lines = [f'    say("{line}");']
        lines = [f'say("{line}");']
        bullet = f"- dealer ngoceh tiap giliran (hook turn)"
        think = ["- hook turn nyala tiap gantian", "- satu baris flavor, nggak ngubah mekanik"]
    else:
        r = num(sev, "period") + 2
        lines = [f"if (round() >= {r}) {{", f'    say("{line}");', "}"]
        bullet = f"- mulai ronde {r} dealer ngoceh (hook turn)"
        think = [f"- round() >= {r}: ngoceh mulai di ronde tua", "- flavor buat tension"]
    d = {"globals": [], "hooks": {"turn": lines}, "bullets": [bullet], "think": think}
    d["intents"] = [
        ("dealer banyak omong tiap giliran", False),
        ("kasih sindiran tiap giliran biar tegang", False),
        ("the dealer talks trash every turn", False),
        ("meja ngoceh dong biar hidup", False),
    ]
    return d

def f_burst(sev):
    p = num(sev, "chance") // 2
    d = {
        "globals": [],
        "hooks": {"dealer_take_damage": [f"if (chance({p})) {{", "    repeat(2) {", "        damage(DEALER, 1);", "    }", '    say("doble tap!");', "}"]},
        "bullets": [f"- {p}% doble tap: damage ganda ke dealer (hook dealer_take_damage)"],
        "think": ["- repeat(2) = kombo dua pukulan", f"- chance({p}) bikin kombo spesial, bukan tiap hit"],
    }
    d["intents"] = [
        (f"kadang kombo doble tap {p} persen", True),
        ("kasih kombo damage ganda sesekali", False),
        ("double tap combo sometimes", False),
        ("tiap nembak ada kesempatan kombo 2x", False),
    ]
    return d

def f_loopdrain(sev):
    p = num(sev, "chance") // 3
    g = "drain"
    d = {
        "globals": [(g, "int", 3)],
        "hooks": {"round": [f"if (chance({p})) {{", f"    {g} = 3;", f"    while ({g} > 0) {{", f"        {g} -= 1;", "        damage(DEALER, 1);", "    }", "}"]},
        "bullets": [f"- {p}% panen pelan: 3 tambalan ke dealer (hook round)"],
        "think": [f"- while({g} > 0) nge-pump 3 damage, fuel guard bawaan bakal jaga", f"- chance({p}) biar jarang tapi kenceng"],
    }
    d["intents"] = [
        (f"sese kali ada panen pelan {p} persen, 3 tambalan ke dealer", True),
        ("kadang dealer kepanen 3x sekaligus", False),
        ("satu ronde bisa kejadian triple damage buat dealer", False),
        ("occasionally triple drain on the dealer", False),
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
    "soften": "tambah regen tiap ronde",
    "chaos": "peluru diacak tiap ronde",
    "coinrig": "koin dikit ke arah kita",
    "taunt": "dealer ikut ngoceh",
    "peektax": "intip kena pajak",
}

TAGLINES = {
    "vampire": "tiap peluru yang kena gw jadi sustennya",
    "leech": "darah dealer pindah ke tangan gw",
    "escalate": "makin lama makin nggak ada yang aman",
    "soften": "napas kecil di antara tembakan",
    "endgame": "jam pasir mulai bicara",
    "fury": "jangan paksa dia ngamuk",
    "coinrig": "koin punya sisi favorit",
    "chaos": "tangan gelombang, peluru cakar",
    "shopfree": "toko yang terlalu baik hati",
    "peektax": "penasaran itu mahal",
    "skillecho": "kartu balik suara",
    "phoenixpraise": "abu abu jadi napas",
    "eyepraise": "yang tersembunyi jadi berat",
    "theme": "lampu ikut ikut pemain",
    "taunt": "meja yang perlu banyak bicara",
    "burst": "kadang datang dua kali",
    "loopdrain": "panen pelan pake gerinda",
}

# ------------------------------------------------------------------ #
# assembly                                                           #
# ------------------------------------------------------------------ #

HOOK_ORDER = ["round", "turn", "hit", "player_take_damage", "dealer_take_damage", "skill", "shop", "coin", "peek"]

def mood_for(feat_ids):
    pool = {
        "vampire": ["crypt", "kapal karam", "gudang tua"],
        "fury": ["cabin merah", "gudang tua"],
        "coinrig": ["neon bawah tanah"],
        "chaos": ["kereta malam", "neon bawah tanah"],
        "theme": ["rumah kaca", "salju"],
    }
    for f in feat_ids:
        if f in pool:
            return rng.choice(pool[f])
    return rng.choice(spec.MOODS)

def emit_code(feats, used):
    """feats: list of feature dicts (in selection order). returns code str"""
    tight = False
    gap = "\n"
    style_paren = True  # canonical: every (hook) {
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
        head = f"every({hook}) {{" if not style_paren else f"every ({hook}) {{"
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
    title = spec.TITLES[primary][0].lower()
    tag = TAGLINES[primary]
    lines = [f"title: {title}", f"tagline: {tag}"]
    for f in feats:
        lines += f["bullets"]
    lines.append(f"ruangan: {mood}")
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
    lines.append("- cek ulang: argumen builtin valid, hook urutannya " + " + ".join(hooks_used))
    lines = lines[:4]
    return "\n".join("- " + l[2:] if l.startswith("- ") else "- " + l for l in lines)

def assemble_intent(feats, sevs):
    """1-3 sentence intent from the feature banks"""
    parts = []
    for i, f in enumerate(feats):
        bank = f["intents"]
        text, _ = rng.choice(bank)
        parts.append(text)
    joiner = rng.choice([" + ", ", terus ", ", plus ", ". terus ", " gimana? terus ", " | ", ", sama "])
    intent = parts[0]
    for p in parts[1:]:
        intent += joiner + p
    # severity words sometimes appended / prepended
    if rng.random() < 0.3:
        sev = sevs[0]
        word = rng.choice({"low": ["tipis aja", "adil dikit", "jangan kejam"], "mid": ["standar aja", "seimbang"], "high": ["brutal", "gila", "kejam", "nyekik"]}[sev])
        intent += f" ({word})"
    # occasional typo / slang noise (char-fallback training)
    if rng.random() < 0.09:
        intent = _add_noise(intent)
    if len(intent) > 190:
        intent = intent[:intent.rfind(" ", 0, 190)] if " " in intent[:190] else intent[:190]
    return intent

NOISE = [
    ("bikin", "bikinin"), ("heal", "healingin"), ("ronde", "ronndee"),
    ("vampir", "vampirrr"), ("tembak", "tembak2"), ("diacak", "diacak2"),
    ("peluru", "pelorrr"), ("koin", "koinz"), ("toko", "tokoo"),
]

def _add_noise(s):
    w0 = rng.choice(NOISE)
    return s.replace(w0[0], w0[1], 1)

# ------------------------------------------------------------------ #
# revision                                                           #
# ------------------------------------------------------------------ #

BRUTALIZE = ["lebih brutal", "gebrak lebih keras", "naikin semuanya", "jangan manja", "kejam-in dong"]
SOFTEN = ["lebih adil", "pelan pelan aja", "turunin angkanya", "jangan kejam", "halusin dikit"]

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
        return rng.choice(BRUTALIZE), list(feat_ids), new_dicts, "up"
    if instr_kind == "soften":
        new_dicts = []
        for f in feat_dicts:
            d = dict(f)
            d["bullets"] = [bump_num(b, delta_dn) for b in f["bullets"]]
            new_dicts.append(d)
        return rng.choice(SOFTEN), list(feat_ids), new_dicts, "dn"
    if instr_kind == "add":
        add_id = rng.choice(list(ADDONS.keys()))
        if add_id in feat_ids:
            add_id = rng.choice([a for a in ADDONS if a not in feat_ids] or ["taunt"])
        sev = pick_sev()
        new_f = FEATURES[add_id](sev)
        return ADDONS[add_id], feat_ids + [add_id], feat_dicts + [new_f], None
    if instr_kind == "remove":
        if len(feat_ids) <= 1:
            return None, None, None, None
        idx = rng.randrange(len(feat_ids))
        gone = feat_ids[idx]
        b0 = feat_dicts[idx]["bullets"][0]
        instr = rng.choice([f"hapus yang {gone}", f"jangan {gone} dulu", "buang satu mekanik"])
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
    n_target = int(sys.argv[1]) if len(sys.argv) > 1 else 6500
    texts = []
    seen_codes = {}
    hook_stat = {}
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
        for _f in ids:
            pass
    print(f"generated {len(texts)} examples from {tries} tries")
    vocab_path = os.path.join(OUT_VOCAB, "vocab.json")
    if os.path.exists(vocab_path):
        with open(vocab_path, encoding="utf-8") as f:
            payload = json.load(f)
        stoi = {t: i for i, t in enumerate(payload["itos"])}
        vocab = {"itos": payload["itos"], "stoi": stoi}
        print(f"reusing existing vocab: {len(vocab['itos'])} tokens")
    else:
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
        # roundtrip check on clean examples (no noise) is implicit: decode
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
    # print a sample
    print("=== SAMPLE ===")
    print(spec.decode(kept[0], vocab["itos"])[:1200])

def _norm_code(code):
    import re as _re
    s = _re.sub(r"\d+", "N", code)
    s = _re.sub(r"\b(?:dmg|heal|regen|tick|count|scale|spike|streak|pot|tax|rage|debt|greed|mercy|ramp|blood|luck|fever|curse|pact|extra|k|n|turnNo|hitCount|roundNo|glow|shadow|frenzy|hunger)\b", "V", s)
    return s

if __name__ == "__main__":
    main()
