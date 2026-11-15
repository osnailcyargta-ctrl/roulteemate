"""
roult2/train.py — trains the ~20M param transformer FROM SCRATCH on the
corpus. Designed for the sandbox: each invocation runs at most ~9 minutes,
then saves a checkpoint. Call repeatedly:

  python3 scripts/roult2/train.py init                # fresh weights
  python3 scripts/roult2/train.py run <steps> <lr0> <lr1>

Logs to data/roult2/trainlog.jsonl ({step, loss, val, lr, sps}).
"""
import json
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model as M

DATA = M.DATA
CORPUS = os.path.join(DATA, "corpus.jsonl")
LOG = M.LOG
CKPT = M.CKPT

B = 6


def load_corpus():
    with open(CORPUS, encoding="utf-8") as f:
        lines = f.read().strip().split("\n")
    n = len(lines)
    padded = np.zeros((n, M.MAXT), dtype=np.int32)
    lens = np.zeros(n, dtype=np.int32)
    for i, l in enumerate(lines):
        t = np.array(json.loads(l), dtype=np.int32)
        L0 = min(len(t), M.MAXT)
        padded[i, :L0] = t[:L0]
        lens[i] = L0
    return padded, lens


def cmd_init():
    V = M.config()
    P = M.init_params(V, seed=20261114)
    m = {k: np.zeros_like(v) for k, v in P.items()}
    v = {k: np.zeros_like(v) for k, v in P.items()}
    M.save_ckpt(P, m, v, 0)
    print(f"init: params={M.param_count(P):,} vocab={V} ckpt saved")


def bucketed_batches(train, lens_train, B, rng):
    """sort by length, batch neighbors, trim T to the chunk max (64-aligned).
    Cuts wasted padding massively; batch ORDER is shuffled so training stays
    stochastic."""
    order = np.argsort(lens_train, kind="stable")
    chunks = [order[i:i + B] for i in range(0, train.shape[0] - B + 1, B)]
    rng.shuffle(chunks)
    for ch in chunks:
        L0 = int(lens_train[ch].max())
        T0 = min(M.MAXT, ((L0 + 63) // 64) * 64)
        yield train[ch][:, :T0]


def cmd_run(max_steps, lr0, lr1, budget_s=530):
    padded, lens = load_corpus()
    n = padded.shape[0]
    n_val = 120
    train = padded[:n - n_val]
    val = padded[n - n_val:]

    P, m, v, step0 = M.load_ckpt()
    print(f"resume from step {step0}, params={M.param_count(P):,}")

    rng = np.random.RandomState(1000 + step0)
    val_idx = rng.choice(val.shape[0], size=4, replace=False)
    val_batch = val[val_idx]
    lens_train = lens[:n - n_val]

    logf = open(LOG, "a", encoding="utf-8")
    t0 = time.time()
    local = 0
    ema = None
    losses = []
    while local < max_steps:
        if time.time() - t0 > budget_s:
            break
        for batch in bucketed_batches(train, lens_train, B, rng):
            if local >= max_steps or time.time() - t0 > budget_s:
                break
            loss, cache = M.forward(P, batch)
            G = M.backward(P, cache)
            # cosine LR across this invocation
            frac = local / max(1, max_steps)
            lr = lr1 + 0.5 * (lr0 - lr1) * (1 + np.cos(np.pi * frac))
            M.adam_step(P, G, m, v, step0 + local + 1, lr)
            ema = loss if ema is None else 0.92 * ema + 0.08 * loss
            losses.append(loss)
            local += 1
            if local % 10 == 0:
                sps = local / (time.time() - t0)
                el = time.time() - t0
                print(f"step {step0 + local} loss={ema:.4f} lr={lr:.5f} {sps:.2f} it/s elapsed={el:.0f}s", flush=True)
            if local % 40 == 0:
                vl = 0.0
                for vb in val_batch:
                    l, _ = M.forward(P, vb[None])
                    vl += l
                vl /= len(val_batch)
                rec = {"step": step0 + local, "loss": round(float(ema), 4), "val": round(float(vl), 4), "lr": round(float(lr), 6)}
                logf.write(json.dumps(rec) + "\n")
                logf.flush()
                print(f"VAL step {step0 + local}: loss={ema:.4f} val={vl:.4f}", flush=True)

    # save checkpoint (atomic-ish)
    tmp = CKPT + ".tmp.npz"
    np.savez(tmp, **{f"p_{k}": v0 for k, v0 in P.items()},
             **{f"m_{k}": v0 for k, v0 in m.items()},
             **{f"v_{k}": v0 for k, v0 in v.items()},
             step=np.array(step0 + local))
    os.replace(tmp, CKPT)
    el = time.time() - t0
    print(f"DONE +{local} steps in {el:.0f}s ({local / max(1, el):.2f} it/s) final_loss={np.mean(losses[-10:]) if losses else float('nan'):.4f}", flush=True)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "init":
        cmd_init()
    elif cmd == "run":
        steps = int(sys.argv[2])
        lr0 = float(sys.argv[3])
        lr1 = float(sys.argv[4])
        budget = float(sys.argv[5]) if len(sys.argv) > 5 else 530
        cmd_run(steps, lr0, lr1, budget)
    else:
        print("usage: train.py init | run <steps> <lr0> <lr1> [budget_s]")
