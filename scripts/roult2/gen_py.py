"""
roult2/gen_py.py — greedy generation straight from the numpy checkpoint.
Separates "model still undertrained" from "TS engine bug": if THIS produces
sane code but the node test doesn't, the TS inference has a bug.

Usage: python3 scripts/roult2/gen_py.py "intent text" [maxNew] [temperature]
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spec
import model as M


def generate(P, prompt_ids, max_new=220, temperature=0.8, seed=1):
    rng = np.random.RandomState(seed)
    itos = json.load(open(os.path.join(os.path.dirname(__file__), "vocab.json"), encoding="utf-8"))["itos"]
    stoi = {t: i for i, t in enumerate(itos)}
    ctx = list(prompt_ids)
    out = []
    for _ in range(max_new):
        tokens = np.array(ctx[-(M.MAXT - 1):], dtype=np.int32)[None]
        # shift: last position predicts the next token
        _, cache = M.forward(P, np.concatenate([tokens, np.zeros((1, 1), dtype=np.int32)], axis=1))
        logits = cache["logits"][0, len(ctx[-(M.MAXT - 1):]) - 1]  # last real position
        logits = logits - logits.max()
        if temperature <= 0:
            t = int(np.argmax(logits))
        else:
            p = np.exp(logits / temperature)
            p /= p.sum()
            t = int(rng.choice(len(p), p=p))
        if t == spec.END:
            out.append(t)
            break
        out.append(t)
        ctx.append(t)
    return out, itos


def main():
    intent = sys.argv[1] if len(sys.argv) > 1 else "vampire mode: kalo gw kena tembak dealer malah heal 2"
    max_new = int(sys.argv[2]) if len(sys.argv) > 2 else 220
    temp = float(sys.argv[3]) if len(sys.argv) > 3 else 0.8
    P, _, _, step = M.load_ckpt()
    print(f"ckpt step {step}")
    itos = json.load(open(os.path.join(os.path.dirname(__file__), "vocab.json"), encoding="utf-8"))["itos"]
    stoi = {t: i for i, t in enumerate(itos)}
    prompt = f"<intent> {intent}\n<plan>\n"
    vocab = {"stoi": stoi}
    ids = spec.encode(prompt, vocab)
    out, itos2 = generate(P, ids, max_new, temp)
    text = spec.decode(ids + out, itos2)
    print(text)


if __name__ == "__main__":
    main()
