"""
roult2/model.py — a ~20M parameter pre-LN transformer, implemented from
scratch in numpy (forward AND manual backward). Trained FROM SCRATCH on the
corpus in data/roult2/corpus.jsonl.

Config: d_model=384, n_layers=11, n_heads=6 (d_head 64), d_ff=1536,
vocab ~1100, maxT=384. Params ≈ 20M — deliberately smaller than the old
55M brain so the browser download (int8 roult.bin) and warmup stay FAST,
while still fully bilingual (ID/EN intents -> matching plan/think).

Memory strategy (2 cores / ~2GB budget):
  - store per-layer inputs x_L + attention probs (fp16)
  - recompute LN outputs, q/k/v and ffn hidden during backward
"""

import json
import math
import os

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DATA = os.path.join(ROOT, "data", "roult2")
CKPT = os.path.join(DATA, "ckpt.npz")
LOG = os.path.join(DATA, "trainlog.jsonl")
VOCAB = os.path.join(os.path.dirname(__file__), "vocab.json")

D = 384
L = 11
H = 6
DH = D // H
DFF = 1536
MAXT = 384


def config():
    with open(VOCAB, encoding="utf-8") as f:
        v = json.load(f)
    V = len(v["itos"])
    return V


# ------------------------------------------------------------------ #
# init                                                               #
# ------------------------------------------------------------------ #

def init_params(V, seed=0):
    rs = np.random.RandomState(seed)
    P = {}
    P["emb"] = (rs.randn(V, D) * 0.02).astype(np.float32)          # tied w/ head
    P["pos"] = (rs.randn(MAXT, D) * 0.01).astype(np.float32)
    for l in range(L):
        sc = 1.0 / math.sqrt(D)
        P[f"{l}.ln1.w"] = np.ones(D, dtype=np.float32)
        P[f"{l}.ln1.b"] = np.zeros(D, dtype=np.float32)
        P[f"{l}.qkv"] = (rs.randn(D, 3 * D) * sc).astype(np.float32)
        P[f"{l}.qkv.b"] = np.zeros(3 * D, dtype=np.float32)
        P[f"{l}.o"] = (rs.randn(D, D) * sc).astype(np.float32)
        P[f"{l}.o.b"] = np.zeros(D, dtype=np.float32)
        P[f"{l}.ln2.w"] = np.ones(D, dtype=np.float32)
        P[f"{l}.ln2.b"] = np.zeros(D, dtype=np.float32)
        P[f"{l}.w1"] = (rs.randn(D, DFF) * sc).astype(np.float32)
        P[f"{l}.w1.b"] = np.zeros(DFF, dtype=np.float32)
        P[f"{l}.w2"] = (rs.randn(DFF, D) * sc).astype(np.float32)
        P[f"{l}.w2.b"] = np.zeros(D, dtype=np.float32)
    P["fin.w"] = np.ones(D, dtype=np.float32)
    P["fin.b"] = np.zeros(D, dtype=np.float32)
    return P


def param_count(P):
    return int(sum(p.size for p in P.values()))


# ------------------------------------------------------------------ #
# primitives                                                         #
# ------------------------------------------------------------------ #

def layernorm(x, w, b):
    mu = x.mean(-1, keepdims=True)
    var = x.var(-1, keepdims=True)
    inv = 1.0 / np.sqrt(var + 1e-5)
    y = (x - mu) * inv
    cache = (inv,)
    return y * w + b, cache


def layernorm_bwd(dy, y_cache, x, w, b):
    (inv,) = y_cache
    mu = x.mean(-1, keepdims=True)
    xc = x - mu
    dw = (dy * xc * inv).sum(axis=(0, 1))
    db = dy.sum(axis=(0, 1))
    # standard LN backward: dx = inv * (a - mean(a) - xhat * mean(a*xhat))
    a = dy * w
    xhat = xc * inv
    dx = inv * (a - a.mean(-1, keepdims=True) - xhat * (a * xhat).mean(-1, keepdims=True))
    return dx, dw, db


def gelu(f):
    """SiLU (swish) — x * sigmoid(x). Same role as GELU in pre-LN transformers
    (LLaMA-style), but numpy-friendly: sigmoid is SIMD-exp, tanh is not."""
    return f * (1.0 / (1.0 + np.exp(-f)))


def gelu_bwd(da, f):
    s = 1.0 / (1.0 + np.exp(-f))
    return da * s * (1.0 + f * (1.0 - s))


def causal_mask(T):
    return np.triu(np.full((T, T), -1e9, dtype=np.float32), k=1)


# ------------------------------------------------------------------ #
# forward                                                            #
# ------------------------------------------------------------------ #

def forward(P, tokens):
    """tokens: (B,T) int32, 0=pad (loss masked). returns loss, cache, stats"""
    B, T = tokens.shape
    x = P["emb"][tokens] + P["pos"][:T][None, :, :]              # (B,T,D)
    xs = [x]
    probs_all = []
    mask = causal_mask(T)
    pad_mask = (tokens == 0)[:, :, None]                          # (B,T,1)

    for l in range(L):
        h, c1 = layernorm(x, P[f"{l}.ln1.w"], P[f"{l}.ln1.b"])
        qkv = h @ P[f"{l}.qkv"] + P[f"{l}.qkv.b"]                 # (B,T,3D)
        q, k, v = np.split(qkv, 3, axis=-1)
        q = q.reshape(B, T, H, DH).transpose(0, 2, 1, 3)          # (B,H,T,DH)
        k = k.reshape(B, T, H, DH).transpose(0, 2, 1, 3)
        v = v.reshape(B, T, H, DH).transpose(0, 2, 1, 3)
        scores = q @ k.transpose(0, 1, 3, 2) / math.sqrt(DH)      # (B,H,T,T)
        scores = scores + mask
        scores = np.where(pad_mask.transpose(0, 2, 1)[:, None], -1e9, scores)  # mask pad KEYS
        scores -= scores.max(-1, keepdims=True)
        e = np.exp(scores)
        probs = e / e.sum(-1, keepdims=True)                      # (B,H,T,T)
        probs_all.append(probs.astype(np.float16))
        attn = (probs @ v).transpose(0, 2, 1, 3).reshape(B, T, D)  # (B,T,D)
        proj = attn @ P[f"{l}.o"] + P[f"{l}.o.b"]
        y = x + proj
        h2, c2 = layernorm(y, P[f"{l}.ln2.w"], P[f"{l}.ln2.b"])
        f1 = h2 @ P[f"{l}.w1"] + P[f"{l}.w1.b"]                   # (B,T,DFF)
        a = gelu(f1)
        f2 = a @ P[f"{l}.w2"] + P[f"{l}.w2.b"]
        x = y + f2
        xs.append(x)

    hf, cf = layernorm(x, P["fin.w"], P["fin.b"])
    logits = hf @ P["emb"].T                                      # (B,T,V)
    # loss over non-pad targets (predict token t from t-1 handled in data prep)
    lab = tokens[:, 1:]
    lg = logits[:, :-1]
    m = lab != 0
    ntok = int(m.sum())
    if ntok == 0:
        ntok = 1
    lgf = lg.reshape(-1, lg.shape[-1]).astype(np.float64)
    labf = lab.reshape(-1)
    mx = lgf.max(-1, keepdims=True)
    z = lgf - mx
    ez = np.exp(z)
    sm = ez / ez.sum(-1, keepdims=True)
    nll = -np.log(np.maximum(sm[np.arange(labf.size), labf], 1e-9))
    nll = nll.reshape(lab.shape)
    loss = float((nll * m).sum() / ntok)
    cache = {
        "tokens": tokens, "xs": xs, "probs": probs_all, "hf": hf, "cf": cf,
        "sm": sm.reshape(lab.shape + (sm.shape[-1],)), "lab": lab, "m": m,
        "ntok": ntok, "mask": mask, "pad": pad_mask, "logits": logits,
    }
    return loss, cache


# ------------------------------------------------------------------ #
# backward                                                           #
# ------------------------------------------------------------------ #

def backward(P, cache):
    tokens = cache["tokens"]
    xs = cache["xs"]
    probs_all = cache["probs"]
    B, T = tokens.shape
    V = P["emb"].shape[0]
    G = {}

    # ---- loss ----
    dsm = cache["sm"].copy()
    Bi, Ti = dsm.shape[0], dsm.shape[1]
    dsm[np.arange(Bi)[:, None], np.arange(Ti)[None, :], cache["lab"]] -= 1.0
    dsm[~cache["m"]] = 0.0          # pad-target positions carry no loss signal
    dsm /= cache["ntok"]
    # logits[:, :-1] reshape (B*(T-1), V) -> backprop into logits
    dlog = np.zeros((B, T, V), dtype=np.float32)
    dlog[:, :-1] = dsm
    dhf = dlog @ P["emb"]                                          # (B,T,D)
    G["emb"] = dlog.reshape(-1, V).T @ cache["hf"].reshape(-1, D)  # tied head grad

    dx, dw, db = layernorm_bwd(dhf, cache["cf"], xs[-1], P["fin.w"], P["fin.b"])
    G["fin.w"], G["fin.b"] = dw, db

    for l in range(L - 1, -1, -1):
        # x_after = y + f2(y);  y = x + proj(x)
        dz = dx                                                    # grad wrt xs[l+1]
        x_l = xs[l]
        q_r, k_r, v_r = _split_qkv(P, l, x_l, B, T)
        probs_r = probs_all[l].astype(np.float32)
        attn_r = (probs_r @ v_r).transpose(0, 2, 1, 3).reshape(B, T, D)
        proj_r = attn_r @ P[f"{l}.o"] + P[f"{l}.o.b"]
        y = x_l + proj_r
        # ---- f2 branch ----
        f1 = _recompute_f1(P, l, cache, y, B, T)
        a = gelu(f1)
        G[f"{l}.w2"] = a.reshape(-1, DFF).T @ dz.reshape(-1, D)
        G[f"{l}.w2.b"] = dz.sum(axis=(0, 1))
        da = dz @ P[f"{l}.w2"].T
        df1 = gelu_bwd(da, f1)
        h2, _c2 = layernorm(y, P[f"{l}.ln2.w"], P[f"{l}.ln2.b"])
        G[f"{l}.w1"] = h2.reshape(-1, D).T @ df1.reshape(-1, DFF)
        G[f"{l}.w1.b"] = df1.sum(axis=(0, 1))
        dh2 = df1 @ P[f"{l}.w1"].T
        dy2, dw2, db2 = layernorm_bwd(dh2, _c2, y, P[f"{l}.ln2.w"], P[f"{l}.ln2.b"])
        G[f"{l}.ln2.w"], G[f"{l}.ln2.b"] = dw2, db2
        dy = dz + dy2                       # x_after = y + f2(y): identity + f2 branch
        # ---- attention branch ----
        G[f"{l}.o"] = attn_r.reshape(-1, D).T @ dy.reshape(-1, D)
        G[f"{l}.o.b"] = dy.sum(axis=(0, 1))
        dattn_flat = dy @ P[f"{l}.o"].T
        dattn = dattn_flat.reshape(B, T, H, DH).transpose(0, 2, 1, 3)   # (B,H,T,DH)
        probs = probs_all[l].astype(np.float32)
        dv = probs.transpose(0, 1, 3, 2) @ dattn                   # (B,H,T,DH)
        dprobs = dattn @ v_r.transpose(0, 1, 3, 2)
        # softmax bwd (causal/pad masks are additive constants — their
        # gradient contribution vanishes through P≈0, no explicit zeroing)
        s = (dprobs * probs).sum(-1, keepdims=True)
        dscores = probs * (dprobs - s)
        dscores /= math.sqrt(DH)
        dq = dscores @ k_r
        dk = dscores.transpose(0, 1, 3, 2) @ q_r
        dq = dq.transpose(0, 2, 1, 3).reshape(B, T, D)
        dk = dk.transpose(0, 2, 1, 3).reshape(B, T, D)
        dvf = dv.transpose(0, 2, 1, 3).reshape(B, T, D)
        dqkv = np.concatenate([dq, dk, dvf], axis=-1)              # (B,T,3D)
        h, _c1 = layernorm(x_l, P[f"{l}.ln1.w"], P[f"{l}.ln1.b"])
        G[f"{l}.qkv"] = h.reshape(-1, D).T @ dqkv.reshape(-1, 3 * D)
        G[f"{l}.qkv.b"] = dqkv.sum(axis=(0, 1))
        dh = dqkv @ P[f"{l}.qkv"].T
        dx0, dw1, db1 = layernorm_bwd(dh, _c1, x_l, P[f"{l}.ln1.w"], P[f"{l}.ln1.b"])
        G[f"{l}.ln1.w"], G[f"{l}.ln1.b"] = dw1, db1
        dx = dy + dx0                       # y = x + proj(x): identity + attention branch
    # embedding + pos grads
    demb_tok = np.zeros_like(P["emb"])
    np.add.at(demb_tok, tokens.reshape(-1), dx.reshape(-1, D))
    G["emb"] = G["emb"] + demb_tok
    gpos = np.zeros_like(P["pos"])
    gpos[:T] = dx.sum(axis=0)
    G["pos"] = gpos
    # mask pad columns of emb rows? pad token never predicted (lab!=0), only fed;
    # zero its grad to keep it inert
    G["emb"][0] = 0.0
    return G


# --- recompute helpers (shared between the two bwd paths) ---

def _ln1(P, l, x):
    return layernorm(x, P[f"{l}.ln1.w"], P[f"{l}.ln1.b"])[0]

def _split_qkv(P, l, x, B, T):
    h = _ln1(P, l, x)
    qkv = h @ P[f"{l}.qkv"] + P[f"{l}.qkv.b"]
    q, k, v = np.split(qkv, 3, axis=-1)
    q = q.reshape(B, T, H, DH).transpose(0, 2, 1, 3)
    k = k.reshape(B, T, H, DH).transpose(0, 2, 1, 3)
    v = v.reshape(B, T, H, DH).transpose(0, 2, 1, 3)
    return q, k, v

def _ln2(P, l, y):
    return layernorm(y, P[f"{l}.ln2.w"], P[f"{l}.ln2.b"])[0]

def _recompute_f1(P, l, cache, y, B, T):
    h2 = _ln2(P, l, y)
    return h2 @ P[f"{l}.w1"] + P[f"{l}.w1.b"]


# ------------------------------------------------------------------ #
# training step                                                      #
# ------------------------------------------------------------------ #

def make_batches(tokens_list, batch_size, rng):
    idx = rng.permutation(len(tokens_list))
    for i in range(0, len(idx) - batch_size + 1, batch_size):
        sel = idx[i:i + batch_size]
        yield np.stack([tokens_list[j] for j in sel]).astype(np.int32)


def adam_step(P, G, m, v, t, lr, b1=0.9, b2=0.95, eps=1e-8, wd=0.01):
    mat_keys = (".qkv", ".o", ".w1", ".w2")
    for k, p in P.items():
        g = G[k]
        is_matrix = any(s in k for s in mat_keys) and not k.endswith(".b")
        if is_matrix:
            g = g + wd * p
        m[k] = b1 * m[k] + (1 - b1) * g
        v[k] = b2 * v[k] + (1 - b2) * (g * g)
        mh = m[k] / (1 - b1 ** t)
        vh = v[k] / (1 - b2 ** t)
        p -= lr * mh / (np.sqrt(vh) + eps)


def save_ckpt(P, m, v, step):
    np.savez(CKPT, **{f"p_{k}": v0 for k, v0 in P.items()},
             **{f"m_{k}": v0 for k, v0 in m.items()},
             **{f"v_{k}": v0 for k, v0 in v.items()},
             step=np.array(step))


def load_ckpt():
    z = np.load(CKPT)
    P = {k[2:]: z[k] for k in z.files if k.startswith("p_")}
    m = {k[2:]: z[k] for k in z.files if k.startswith("m_")}
    v = {k[2:]: z[k] for k in z.files if k.startswith("v_")}
    step = int(z["step"])
    return P, m, v, step
