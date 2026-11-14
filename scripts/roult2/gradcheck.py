"""
roult2/gradcheck.py — verifies the hand-written backward pass against
numerical gradients on a tiny config. MUST pass before training.
Run: python3 scripts/roult2/gradcheck.py
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model as M

# shrink the config
M.D, M.L, M.H, M.DH, M.DFF, M.MAXT = 16, 2, 2, 8, 32, 12

V = 60
rs = np.random.RandomState(7)
P = M.init_params(V, seed=3)
rng = np.random.RandomState(11)
tokens = rng.randint(1, V, size=(2, 8)).astype(np.int32)
tokens[0, 5] = 0  # exercise the pad path

loss, cache = M.forward(P, tokens)
G = M.backward(P, cache)
print(f"tiny forward loss = {loss:.4f}")

eps = 1e-3
checked = 0
worst = 0.0
worst_key = ""
failures = []

# sample indices across all param tensors
keys = list(P.keys())
for k in keys:
    p = P[k]
    n_checks = 6 if p.size > 6 else p.size
    for _ in range(n_checks):
        idx = tuple(rng.randint(0, s) for s in p.shape)
        orig = p[idx]
        p[idx] = orig + eps
        lp, _ = M.forward(P, tokens)
        p[idx] = orig - eps
        lm, _ = M.forward(P, tokens)
        p[idx] = orig
        num = (lp - lm) / (2 * eps)
        ana = G[k][idx]
        denom = max(1e-6, abs(num) + abs(ana))
        rel = abs(num - ana) / denom
        checked += 1
        if rel > worst:
            worst = rel
            worst_key = f"{k}{idx}"
        if rel > 0.03 and abs(num - ana) > 2e-4:
            failures.append((k, idx, float(num), float(ana), rel))

print(f"checked {checked} param grads; worst rel err = {worst:.5f} at {worst_key}")
if failures:
    print("FAILURES:")
    for k, idx, num, ana, rel in failures[:10]:
        print(f"  {k}{idx}: numeric={num:.6f} analytic={ana:.6f} rel={rel:.4f}")
    sys.exit(1)
print("GRADCHECK PASS")
