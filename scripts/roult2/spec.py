"""
roult2/spec.py — single source of truth for the ROULT v2 language model.

- the pretokenizer regex (must be byte-identical with the JS port)
- token categories, vocab builder, encode/decode
- shared pools: identifiers, taunts, moods, seed vocabulary

The model: a ~55M param pre-LN transformer trained FROM SCRATCH on a
synthetic corpus of (intent -> plan -> [revise -> plan] -> think -> code)
examples written in roulteematescript (ENGINE C).
"""

import re
import json
import os

# ------------------------------------------------------------------ #
# specials                                                           #
# ------------------------------------------------------------------ #
SPECIALS = ["<pad>", "<intent>", "<plan>", "<revise>", "<think>", "<code>", "<end>"]
PAD, INTENT, PLAN, REVISE, THINK, CODE, END = range(7)

# ------------------------------------------------------------------ #
# the pretokenizer regex — JS port must be identical                 #
# ------------------------------------------------------------------ #
REGEX_STR = (
    r"(<intent>|<plan>|<revise>|<think>|<code>|<end>)"
    r"|(//[^\n]*)"
    r"|(#[^\n]*)"
    r'|("[^"\n]*")'
    r"|([0-9]+(?:\.[0-9]+)?)"
    r"|([A-Za-z_][A-Za-z0-9_]*)"
    r"|(==|!=|<=|>=|\+=|-=|&&|\|\|)"
    r"|([(){};,+\-*/%<>!=.:?|])"
    r"|(\n[ ]*)"
    r"|( +)"
)
REGEX = re.compile(REGEX_STR)

# ------------------------------------------------------------------ #
# ENGINE C vocabulary facts (mirrors src/game/script.ts exactly)     #
# ------------------------------------------------------------------ #
HOOKS = [
    "round", "turn", "hit", "player_take_damage", "dealer_take_damage",
    "skill", "shop", "coin", "peek",
]
# setup/death exist in the grammar but the engine never fires them — excluded
KEYWORDS = ["int", "float", "every", "if", "else", "while", "repeat", "break"]
BUILTINS = [
    "heal", "damage", "run_skill", "say", "hp", "score", "round", "rand",
    "last_skill", "chance", "shuffle", "theme", "set_dmg_next", "set_coin",
]
# print() omitted: dev noise, keep the model's output clean
SKILL_IDS = ["reroll", "voodoo", "peek", "eject", "coffee", "cuffs", "phoenix", "thirdEye"]
SKILL_CONSTS = ["SKILL_" + s.upper() for s in SKILL_IDS]
SIDE_CONSTS = ["PLAYER", "DEALER"]
PUNCTS = ["==", "!=", "<=", ">=", "+=", "-=", "&&", "||",
          "(", ")", "{", "}", ";", ",", "+", "-", "*", "/", "%", ".", "<", ">", "!", "="]
# prose-only puncts (never generated inside <code>, still need tokens)
PROSE_PUNCTS = [":", "?", "|"]
NL, IND, SP = "\n", "IND", " "   # IND decodes to 4 spaces

IDENT_POOL = [
    "dmg", "heal", "regen", "tick", "count", "scale", "spike", "streak",
    "pot", "tax", "rage", "debt", "greed", "mercy", "ramp", "blood",
    "luck", "fever", "curse", "pact", "extra", "k", "n", "turnNo",
    "hitCount", "roundNo", "glow", "shadow", "frenzy", "hunger",
]

TAUNTS = [
    "waktu habis...", "shell-nya diacak!", "jackpot!", "darahku...",
    "jangan nakal", "peluru asli? mungkin", "dua arah, satu kubur",
    "makin tua, makin lapar", "satu utk aku", "tangan dingin",
    "keputusan buruk", "ronde terakhir", "koin gak bisa dipercaya",
    "kelihatan semua...", "aku lihat kamu", "jangan lari",
    "semua celah kulihat", "koin paling jujur", "tipis tipis aja",
    "hunger never waits", "the house always drinks",
    "satu lagi, satu lagi", "keberuntunganmu habis", "meja ini ingat",
    "hidup segan mati tak segan", "aku hitam putih kamu abu",
    "kunci diri kirim salam", "kejar kejaran",
]

MOODS = [
    "crypt", "cabin merah", "neon bawah tanah", "kapal karam", "gudang tua",
    "salju", "gurun", "hotel rusak", "kereta malam", "rumah kaca",
]

TITLES = {
    "vampire": ["DARAH SEPERSELIT", "NYEDETIK", "VAMPIRE TABLE", "SEDOTAN"],
    "leech": ["TANGAN LEMBAP", "PEMULIHAAN DURJANA", "SUCKER PUNCH"],
    "escalate": ["BUTA WAKTU", "ESKALASI", "MEJA PEMARAH", "BUNGA HUTANG"],
    "soften": ["BALM PERRONDE", "TIUPAN PEMULIH", "NAPAS KEDUA"],
    "endgame": ["LIMA DETIK TERAKHIR", "JAM SEGEL", "HITUNG MUNDUR"],
    "fury": ["MERAH MEPET", "CACING TANAH", "GIGI TERAKHIR"],
    "coinrig": ["KEPALA SELALU", "KOIN BERAT", "JACKPOT HALUS"],
    "chaos": ["PELURU CAKAR", "TANGAN GELOMBANG", "SHUFFLE ROULETTE"],
    "shopfree": ["TOKO JUMAT", "SALES UANG", "KASIR BAIK"],
    "peektax": ["INTIP = PAJAK", "MATA BAYAR", "PENALTI PENASARAN"],
    "skillecho": ["GEMA KARTU", "BONUS GILIRAN", "ECHO GELANG"],
    "phoenixpraise": ["SAYAP SAYAP", "ABU MENJADI", "BIRD BONUS"],
    "eyepraise": ["RETINA UANG", "PANDANGAN KE-3", "LIDAH MATA"],
    "theme": ["GANTI CAHAYA", "LAMPU RUSAK", "MOOD SWING"],
    "taunt": ["MULUT MEJA", "NGOCEH", "SINDIRAN PERGILIRAN"],
    "burst": ["DOBLE TAP", "TIGA PUKULAN", "KOMBO KAMSEUPAYA"],
    "loopdrain": ["PAYASAN", "PANEN PELAN", "GORILO DRILL"],
}

# ------------------------------------------------------------------ #
# seed vocabulary: domain words that MUST be in vocab even if rare   #
# ------------------------------------------------------------------ #
SEED_WORDS = """
gw gua aku lu loe kamu kita dealer musuh lawan player pemain teman
darah hp damage heal healing sembuh sembuhin nyembuhin nyegerin nyedot sedot
hisap nambah nambahin naik turun naikin turunin kurangin kurang
tiap setiap every per kali giliran ronde turn round waktu hit hitung count
peluru shell pelor mag koin coin flip koinflip gamble jackpot
acak diacak shuffle aduk campur peluang chance probabilitas
persen brutal gila kejam galak adil tipis dikit halus ramah
baik jahat durjana nakal bonus gratis free penalti pajak tax denda
regen pemulihan mandat ampun mercy
toko shop belanja kasir sales stok barang reroll voodoo peek eject
coffee cuffs phoenix burung api abu mata thirdEye mataketiga lihat liat
intip pengintip ngintip kena tembak sabet
meja ruangan room tema theme lampu cahaya ungu merah biru hijau emas
kelabu gelap crypt kapal gudang hotel kereta salju gurun kabin neon
vampir dracula leech lintah
mulai akhir akhiran terakhir akhirnya habis tinggal mepet kritis
satu dua tiga empat lima enam tujuh delapan sembilan sepuluh
kalo kalau jika karena terus lalu trus plus tambah
tanpa jangan ganti swap tukar bikin buat semua atau juga
pas saat udah dah sudah baru lagi
aku dia mereka tentu paham jelas ok oke siap
sisi arah target damagein ngeheal
score skor poin nilai rand angka nomor
say bilang omong ngoceh sindir taunt komentar catatan catetan
plan rencana tagline judul bullet poin inti balance imbang
mendadak serentak burst kombo combo doble triple dobel tiga
gema echo panggil teriak pamit sidik jari tangan
the and when gets gain free penalty
tension fair blood vampire leech drain feed feeds drinks house always
rng luck lucky rigged weighted chaos scrambled scramble
naikan turunkan besarin kecilin ubah ditambah dihapus dihapusin
""".split()

# ------------------------------------------------------------------ #
# pretokenize + encode                                               #
# ------------------------------------------------------------------ #

def pretokenize(text):
    """yield (kind, value) pairs using REGEX."""
    for m in REGEX.finditer(text):
        special, c1, c2, string, num, word, p2, p1, nl, sp = m.groups()
        if special is not None:
            yield ("special", special)
        elif c1 is not None or c2 is not None:
            yield ("comment", c1 if c1 is not None else c2)
        elif string is not None:
            yield ("str", string)
        elif num is not None:
            yield ("num", num)
        elif word is not None:
            yield ("word", word)
        elif p2 is not None:
            yield ("punct", p2)
        elif p1 is not None:
            yield ("punct", p1)
        elif nl is not None:
            yield ("nl", nl)
        elif sp is not None:
            yield ("sp", sp)


def encode(text, vocab, allow_char=True):
    """text -> list of token ids. numbers split into digit tokens; unknown
    words fall back to char tokens (a-z0-9 in vocab)."""
    stoi = vocab["stoi"]
    ids = []

    def w(tok):
        t = stoi.get(tok)
        if t is not None:
            ids.append(t)
            return True
        return False

    def word_or_chars(word):
        if w(word):
            return
        if not allow_char:
            ids.append(stoi["<unk>"])
            return
        for ch in word:
            if not w(ch) and ch.isalnum():
                ids.append(stoi["<unk>"])

    def prose_stream(inner):
        """word-level encode of free text (used for comment/string bodies)"""
        for kind, v in pretokenize(inner):
            if kind == "word":
                word_or_chars(v.lower())
            elif kind == "num":
                for ch in v:
                    if ch.isdigit():
                        w(ch)
                    elif ch == ".":
                        w(".")
            elif kind == "sp":
                w(" ")
            elif kind == "punct":
                w(v)

    for kind, v in pretokenize(text):
        if kind == "special":
            w(v)
        elif kind == "comment":
            marker = "//" if v.startswith("//") else "#"
            w(marker)
            w(" ")
            prose_stream(v[len(marker):])
            w("\n")
        elif kind == "str":
            w('"')
            prose_stream(v[1:-1])
            w('"')
        elif kind == "num":
            for ch in v:
                if ch.isdigit():
                    w(ch)
                elif ch == ".":
                    w(".")
        elif kind == "word":
            word_or_chars(v if _is_code(v) else v.lower())
        elif kind == "punct":
            w(v)
        elif kind == "nl":
            lead = len(v) - 1
            w("\n")
            for _ in range(lead // 4):
                w("IND")
        elif kind == "sp":
            w(" ")
    return ids


def _is_code(word):
    """code identifiers are case-sensitive; everything else lowercases."""
    return (
        word in KEYWORDS or word in BUILTINS or word in HOOKS
        or word in SIDE_CONSTS or word in SKILL_CONSTS or word in IDENT_POOL
    )


def decode(ids, itos):
    out = []
    for t in ids:
        s = itos[t]
        if s == "IND":
            out.append("    ")
        elif s == "<unk>":
            out.append("?")
        else:
            out.append(s)
    return "".join(out)


# ------------------------------------------------------------------ #
# vocab builder                                                      #
# ------------------------------------------------------------------ #

def build_vocab(word_freq, max_words=1240):
    itos = list(SPECIALS)                # 0..6
    itos += ["\n", "IND", " "]
    itos += [str(d) for d in range(10)]
    itos += PUNCTS + PROSE_PUNCTS
    itos += ['"']
    itos += KEYWORDS + BUILTINS + HOOKS + SIDE_CONSTS + SKILL_CONSTS
    itos += IDENT_POOL
    seen = set()
    itos2 = []
    for t in itos:
        if t not in seen:
            seen.add(t)
            itos2.append(t)
    itos = itos2
    words = []
    seenw = set(itos)
    for word in SEED_WORDS:
        if word not in seenw:
            seenw.add(word)
            words.append(word)
    for word, _c in sorted(word_freq.items(), key=lambda kv: -kv[1]):
        if word not in seenw and len(words) < max_words:
            seenw.add(word)
            words.append(word)
    itos += words
    for ch in "abcdefghijklmnopqrstuvwxyz0123456789":
        itos.append(ch)
    itos.append("<unk>")
    stoi = {t: i for i, t in enumerate(itos)}
    return {"itos": itos, "stoi": stoi}


# ------------------------------------------------------------------ #
# token tags for the JS grammar masker                               #
# ------------------------------------------------------------------ #

def token_tags(itos):
    tags = {}
    for t in itos:
        if t.startswith("<") and t.endswith(">"):
            tags[t] = "special"
        elif t == "\n":
            tags[t] = "nl"
        elif t == "IND":
            tags[t] = "ind"
        elif t == " ":
            tags[t] = "sp"
        elif t.isdigit():
            tags[t] = "digit"
        elif t in PUNCTS or t in PROSE_PUNCTS:
            tags[t] = "punct"
        elif t == '"':
            tags[t] = "quote"
        elif t in KEYWORDS:
            tags[t] = "keyword"
        elif t in BUILTINS:
            tags[t] = "builtin"
        elif t in HOOKS:
            tags[t] = "hook"
        elif t in SIDE_CONSTS or t in SKILL_CONSTS:
            tags[t] = "const"
        elif t in IDENT_POOL:
            tags[t] = "ident"
        elif t == "//" or t == "#":
            tags[t] = "comment"
        elif len(t) == 1 and t.isalnum():
            tags[t] = "char"
        elif t == "<unk>":
            tags[t] = "unk"
        else:
            tags[t] = "word"
    return tags


def save_shared(outdir, vocab):
    payload = {
        "itos": vocab["itos"],
        "tags": token_tags(vocab["itos"]),
        "specials": SPECIALS,
    }
    with open(os.path.join(outdir, "vocab.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
