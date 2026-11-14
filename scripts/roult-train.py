#!/usr/bin/env python3
"""
roult-train.py — trains the ROULT intent classifier FROM SCRATCH.

A small multi-label MLP (136 -> 48 -> 16, ReLU + sigmoid, Adam, BCE loss)
trained on a synthetic corpus of Indonesian/English gamemode prompts that
is generated right here: templated prompts, synonym slots, filler words
and injected typos. No pretrained weights, no downloads, no API — the
network starts from random noise and learns the mapping
prompt text -> ENGINE C mechanic slots.

The trained weights are exported to src/game/roult-model.json and are
inferred 1:1 by src/game/roult.ts at runtime (100% local, in-browser).

Feature extraction MUST stay identical to roult.ts:
  - normalize: lowercase, [^a-z0-9]+ -> " ", collapse, trim
  - dims 0..111 : hashed char-trigram bag, L2-normalized
      hash = (h*33 + ord(ch)) % 112  over each trigram
  - dims 112..135 : 0/1 exact-word keyword flags (KEYWORDS, in order)

Run: python3 scripts/roult-train.py
"""

import json
import math
import random
import numpy as np

random.seed(7)
np.random.seed(7)

# ------------------------------------------------------------------ #
# vocabulary — MUST match src/game/roult.ts                          #
# ------------------------------------------------------------------ #

MECHS = [
    "vampPlayer", "vampDealer", "mirror", "taxPlayer", "taxDealer",
    "roundChaos", "shuffleChaos", "luckyCoin", "mercyDeath", "suddenDeath",
    "skillToll", "roundHeal", "dealerRamp", "peekToll", "firstBlood",
    "randomGift",
]
KEYWORDS = [
    "vampir", "darah", "sembuh", "heal", "dealer", "acak", "random",
    "koin", "coin", "ronde", "round", "nyawa", "hp", "tank", "pajak",
    "tax", "mata", "eye", "phoenix", "api", "ungu", "tema", "skil",
    "untung",
]
TRI = 112
KEY = len(KEYWORDS)
IN = TRI + KEY
HID = 48
OUT = len(MECHS)

# ------------------------------------------------------------------ #
# feature extraction (identical to roult.ts)                         #
# ------------------------------------------------------------------ #

def norm(s: str) -> str:
    out = []
    prev = " "
    for ch in s.lower():
        c = ch if ("a" <= ch <= "z" or "0" <= ch <= "9") else " "
        if c == " " and prev == " ":
            continue
        out.append(c)
        prev = c
    return "".join(out).strip()

def features(text: str) -> np.ndarray:
    s = norm(text)
    v = np.zeros(IN, dtype=np.float64)
    cnt = np.zeros(TRI, dtype=np.float64)
    for i in range(2, len(s)):
        h = 0
        for ch in s[i - 2 : i + 1]:
            h = (h * 33 + ord(ch)) % TRI
        cnt[h] += 1.0
    n = math.sqrt(float((cnt * cnt).sum()))
    if n > 0:
        cnt /= n
    v[:TRI] = cnt
    words = s.split(" ") if s else []
    for k, kw in enumerate(KEYWORDS):
        if kw in words:
            v[TRI + k] = 1.0
    return v

# ------------------------------------------------------------------ #
# synthetic corpus                                                   #
# ------------------------------------------------------------------ #

FILLERS = [
    "buatin ", "gw mau ", "aku mau ", "jadi gini ", "mode ", "gamemode ",
    " bikin dong", " anjing", " bro", " seru", " keren", " please",
    " yang seru", " buat roultemate", " dong", " woy", " coba",
]

TEMPLATES: dict[str, list[str]] = {
    "vampPlayer": [
        "buat gamemode vampir, tiap aku nembak dealer aku sembuh dikit",
        "vampire mode, kalau dealer kena peluru aku dapat heal",
        "tiap dealer kena, aku nyembuhin diri sendiri",
        "aku mau jadi vampir, darah dealer nyembuhin aku",
        "leech mode: luka yang aku kasih balik jadi nyawa aku",
        "hisap darah dealer tiap kali dia kena tembak",
        "kalau aku berhasil tembak dealer, hp aku nambah",
        "dealer take damage aku heal 1",
        "serangan aku ke dealer ngasih aku sembuh",
        "tiap hit yang kena dealer, aku sembuh dikit",
    ],
    "vampDealer": [
        "dealer nya yang jadi vampir, tiap aku kena dia sembuh",
        "kalau aku kena peluru, dealer sembuh dikit",
        "dealer hisap darah aku tiap aku kena",
        "setiap aku kena damage, hp dealer nambah",
        "mode hunger: dealer makan darahku tiap kena",
        "player take damage = dealer heal",
        "tiap aku ketembak, dealer dapat nyawa",
        "luka aku jadi makanan dealer",
    ],
    "mirror": [
        "mode pantulan, tiap aku kena dealer kena balik",
        "karma mode: luka ku balik ke dia dua kali",
        "tiap aku kena damage, dealer ikut kena",
        "reflect: player take damage juga nyakit dealer",
        "kalau dealer nembak aku, dia juga kena",
        "cermin mode, damage aku ke balas ke dealer",
        "tiap luka yang aku terima balik ke penembaknya",
    ],
    "taxPlayer": [
        "tiap giliran aku kepotong pajak darah",
        "dealer ngambil 1 nyawa aku tiap giliran",
        "mode pajak: nyawa ku berkurang tiap giliran",
        "tiap turn aku kena damage 1",
        "aku dibayarang dealer tiap giliran, sakit",
        "setiap giliran mulai, aku kepotong nyawa",
        "dealer nagih utang tiap giliran, damage pelan",
    ],
    "taxDealer": [
        "tiap giliran dealer kepotong pajak",
        "dealer kepotong nyawa tiap giliran",
        "mode pajak buat dealer, dia kena damage tiap turn",
        "tiap giliran mulai dealer kena 1",
        "dealer nagih utang ke diri dia sendiri",
    ],
    "roundChaos": [
        "tiap ronde ada peluru nyasar, kadang kena aku kadang dia",
        "chaos mode: damage dadakan tiap ronde",
        "tiap ronde baru ada random damage ke salah satu",
        "kadang kadang di awal ronde ada yang kebang",
        "ronde acak: chance peluru liar nyangkut ke siapa saja",
        "tiap ronde ada kejutan, bisa aku bisa dealer yang kena",
        "random strike tiap ronde baru",
    ],
    "shuffleChaos": [
        "tiap ronde pelurunya diacak ulang, ingatan gak berguna",
        "amnesia mode: shuffle isi senjata tiap ronde baru",
        "shuffle tiap ronde, hitungan hancur terus",
        "acak ulang chamber setiap ronde",
        "peluru di aduk tiap ronde biar susah dihitung",
    ],
    "luckyCoin": [
        "coin flip selalu menang buat aku",
        "koin nya rigged, gamble auto head",
        "tiap gamble aku pasti menang, paksa koin",
        "set_coin selalu 1 tiap mau gamble",
        "coin flip gak boleh bohong, selalu untung",
        "paksa hasil gamble jadi menang",
    ],
    "mercyDeath": [
        "kalau aku mati sekali, aku bangun lagi satu kali",
        "extra life: kematian pertama ditolak",
        "aku punya satu kesempatan bangkit tiap game",
        "death pertama aku di cancel, heal balik",
        "beri aku nyawa kedua, sekali bangkit dari mati",
        "kalau hp ku habis pertama kali, aku diselamatkan",
    ],
    "suddenDeath": [
        "ronde 6 semua langsung kena 2, cepat tamat",
        "sudden death mulai ronde 8, dua duanya kena",
        "di ronde tertentu semua orang kena damage besar",
        "mulai ronde 7 tiap ronde semua kena 2",
        "game harus cepat tamat, ronde 9 semua kena",
    ],
    "skillToll": [
        "pakai skill nyawa ku berkurang satu",
        "skill berbayar pake darah, tiap pakai skill aku kena 1",
        "tiap skill dipakai, aku kepotong hp",
        "skill bukan gratis, dia nagih darah",
        "gunakan skil = damage ke diri sendiri",
    ],
    "roundHeal": [
        "tiap ronde aku sembuh 1, mode tank",
        "regen pelan tiap ronde baru",
        "tiap ronde baru aku dapat heal 1",
        "aku mau jadi tank, tiap ronde sembuh dikit",
        "mode bertahan: hp ku nambah tiap ronde",
    ],
    "dealerRamp": [
        "dealer makin jahat, tembakan nya makin sakit tiap ronde",
        "damage dealer naik tiap ronde",
        "peluru dealer makin sakit seiring ronde",
        "escallasi: dealer damage naik 1 tiap ronde",
        "dealer ramp, awalnya 1 terus makin besar",
    ],
    "peekToll": [
        "ngintip kena bayar darah",
        "peek butuh nyawa satu, bayar dulu",
        "tiap aku peek, aku kepotong 1 hp",
        "mata mata berbayar, peek = damage 1",
    ],
    "firstBlood": [
        "ronde pertama dealer langsung kena 2",
        "first blood: ronde 1 dealer kena damage",
        "awal game dealer langsung kena sakit",
        "buka ronde 1 dengan damage ke dealer",
    ],
    "randomGift": [
        "kadang kadang langit ngasih heal gratis",
        "chance tiap ronde aku dapat nyawa bonus",
        "kado acak: peluang heal tiap ronde",
        "random gift, kadang aku sembuh sendiri",
        "untung untungan, ada chance dapat heal",
    ],
}

NEGATIVES = [
    "mode santai aja", "tema ungu dong", "ruangan biar biru",
    "aku mau meja biasa", "gak ada yang diubah", "biar default aja",
    "tema emas keren", "ganti warna lampu dong", "halo", "tes 1 2 3",
    "kamu siapa", "meja normal standar", "gamemode biasa aja",
    "bikin ruangan gelap", "tema merah aja",
]

def typo(s: str, rng: random.Random) -> str:
    words = s.split(" ")
    out = []
    for w in words:
        if len(w) > 3 and rng.random() < 0.18:
            k = rng.randrange(3)
            i = rng.randrange(1, len(w) - 1)
            if k == 0:
                w = w[:i] + w[i + 1:]          # deletion
            elif k == 1:
                w = w[:i] + w[i] + w[i:]       # duplication
            else:
                w = w[:i] + w[i + 1] + w[i] + w[i + 2:]  # swap
        out.append(w)
    return " ".join(out)

def augment(s: str, rng: random.Random) -> str:
    if rng.random() < 0.55:
        s = rng.choice(FILLERS) + s
    if rng.random() < 0.55:
        s = s + rng.choice(FILLERS)
    s = typo(s, rng)
    return s

def build_dataset() -> tuple[np.ndarray, np.ndarray]:
    rng = random.Random(1234)
    xs: list[np.ndarray] = []
    ys: list[np.ndarray] = []
    mechs = list(TEMPLATES.keys())

    # singles
    for mech in mechs:
        for tpl in TEMPLATES[mech]:
            for _ in range(9):
                y = np.zeros(OUT, dtype=np.float64)
                y[MECHS.index(mech)] = 1.0
                xs.append(features(augment(tpl, rng)))
                ys.append(y)

    # combos (two mechanics in one sentence)
    for _ in range(260):
        a, b = rng.sample(mechs, 2)
        ta = rng.choice(TEMPLATES[a])
        tb = rng.choice(TEMPLATES[b])
        joiner = rng.choice([" terus ", " plus ", " dan juga ", " + ", " sambil "])
        s = ta + joiner + tb
        y = np.zeros(OUT, dtype=np.float64)
        y[MECHS.index(a)] = 1.0
        y[MECHS.index(b)] = 1.0
        xs.append(features(augment(s, rng)))
        ys.append(y)

    # negatives
    for _ in range(150):
        s = rng.choice(NEGATIVES)
        y = np.zeros(OUT, dtype=np.float64)
        xs.append(features(augment(s, rng)))
        ys.append(y)

    idx = list(range(len(xs)))
    rng.shuffle(idx)
    X = np.stack([xs[i] for i in idx])
    Y = np.stack([ys[i] for i in idx])
    return X, Y

# ------------------------------------------------------------------ #
# the network                                                        #
# ------------------------------------------------------------------ #

def init_net(rng: random.Random):
    w1 = np.array([[rng.uniform(-0.12, 0.12) for _ in range(IN)] for _ in range(HID)])
    b1 = np.zeros(HID)
    w2 = np.array([[rng.uniform(-0.2, 0.2) for _ in range(HID)] for _ in range(OUT)])
    b2 = np.zeros(OUT)
    return w1, b1, w2, b2

def forward(X, w1, b1, w2, b2):
    H = np.maximum(0.0, X @ w1.T + b1)          # (N, HID)
    Z = H @ w2.T + b2                            # (N, OUT)
    P = 1.0 / (1.0 + np.exp(-np.clip(Z, -30, 30)))
    return H, P

def train():
    X, Y = build_dataset()
    n = X.shape[0]
    split = int(n * 0.94)
    Xtr, Ytr, Xva, Yva = X[:split], Y[:split], X[split:], Y[split:]
    print(f"corpus: {n} samples ({Xtr.shape[0]} train / {Xva.shape[0]} val), in={IN} hid={HID} out={OUT}")

    rng = random.Random(7)
    w1, b1, w2, b2 = init_net(rng)
    lr = 0.01
    beta1, beta2, eps = 0.9, 0.999, 1e-8
    m = [np.zeros_like(a) for a in (w1, b1, w2, b2)]
    v = [np.zeros_like(a) for a in (w1, b1, w2, b2)]
    params = [w1, b1, w2, b2]

    epochs = 30
    batch = 64
    step = 0
    for ep in range(epochs):
        order = np.random.permutation(Xtr.shape[0])
        tot_loss = 0.0
        for i in range(0, len(order), batch):
            idx = order[i : i + batch]
            xb, yb = Xtr[idx], Ytr[idx]
            H, P = forward(xb, w1, b1, w2, b2)
            eps_clip = np.clip(P, 1e-7, 1 - 1e-7)
            loss = -np.mean(yb * np.log(eps_clip) + (1 - yb) * np.log(1 - eps_clip))
            tot_loss += loss * len(idx)
            dZ = (P - yb) / len(idx)                 # (B, OUT)
            gW2 = dZ.T @ H                           # (OUT, HID)
            gb2 = dZ.sum(axis=0)
            dH = dZ @ w2                             # (B, HID)
            dH = dH * (H > 0)
            gW1 = dH.T @ xb                          # (HID, IN)
            gb1 = dH.sum(axis=0)
            grads = [gW1, gb1, gW2, gb2]
            step += 1
            for pidx in range(4):
                m[pidx] = beta1 * m[pidx] + (1 - beta1) * grads[pidx]
                v[pidx] = beta2 * v[pidx] + (1 - beta2) * grads[pidx] ** 2
                mh = m[pidx] / (1 - beta1 ** step)
                vh = v[pidx] / (1 - beta2 ** step)
                params[pidx] -= lr * mh / (np.sqrt(vh) + eps)
        _, Pv = forward(Xva, *params)
        pred = (Pv > 0.5).astype(float)
        acc = float((pred == Yva).mean())
        print(f"  epoch {ep+1:02d}  loss {tot_loss/len(Xtr):.4f}  val bin-acc {acc*100:.1f}%")

    w1, b1, w2, b2 = params
    # quick sanity probes (the real 6-case test lives in roult-test.ts)
    probes = [
        ("buat gamemode vampir, tiap aku nembak dealer aku sembuh", "vampPlayer"),
        ("pelurunya diacak tiap ronde", "shuffleChaos"),
        ("coin flip selalu menang", "luckyCoin"),
    ]
    _, Pp = forward(np.stack([features(p) for p, _ in probes]), w1, b1, w2, b2)
    for (p, want), row in zip(probes, Pp):
        got = MECHS[int(np.argmax(row))]
        print(f"  probe: {p[:44]!r} -> {got} (want {want}) {'OK' if got == want else 'MISS'}")

    model = {
        "in": IN,
        "hidden": HID,
        "labels": MECHS,
        "keywords": KEYWORDS,
        "tri": TRI,
        "w1": [[round(float(x), 5) for x in row] for row in w1],
        "b1": [round(float(x), 5) for x in b1],
        "w2": [[round(float(x), 5) for x in row] for row in w2],
        "b2": [round(float(x), 5) for x in b2],
    }
    out = "/home/z/my-project/src/game/roult-model.json"
    with open(out, "w") as f:
        json.dump(model, f, separators=(",", ":"))
    import os
    print(f"saved {out} ({os.path.getsize(out)//1024} KB)")

if __name__ == "__main__":
    train()
