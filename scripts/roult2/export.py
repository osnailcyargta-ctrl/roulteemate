"""
roult2/export.py — quantizes the trained checkpoint to int8 (per-row scales)
and writes the browser inference binary + copies vocab.json next to the
runtime code.

  public/models/roult.bin   (≈21MB, self-describing layout)
  src/game/roult/vocab.json (itos + token tags)

Layout (little endian):
  magic "RLT2" | u32 ver | u32 V | u32 D | u32 L | u32 H | u32 DFF | u32 MAXT
  u32 nTensors
  per tensor: u8 nameLen | name | u8 kind(0=fp32,1=int8 rowscales) | u32 ndim
              | ndim × u32 dim
              kind0: ndim… raw f32
              kind1: rows × f32 scales, then rows*cols int8
"""
import json
import os
import shutil
import struct
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model as M

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_BIN = os.path.join(ROOT, "public", "models", "roult.bin")
OUT_VOCAB = os.path.join(ROOT, "src", "game", "roult", "vocab.json")

INT8 = {"emb", "qkv", ".o", ".w1", ".w2"}  # matrices → int8; rest fp32


def is_int8(name):
    if name == "emb":
        return True
    for s in (".qkv", ".o", ".w1", ".w2"):
        if s in name and not name.endswith(".b"):
            return True
    return False


def main():
    P, _m, _v, step = M.load_ckpt()
    V = P["emb"].shape[0]
    print(f"export from step {step}, params={M.param_count(P):,}")

    out = bytearray()
    out += b"RLT2"
    out += struct.pack("<IIIIIIII", 1, V, M.D, M.L, M.H, M.DFF, M.MAXT, len(P))

    for name, arr in P.items():
        a = arr.astype(np.float32)
        if a.ndim == 1:
            kind = 0
        elif is_int8(name):
            kind = 1
        else:
            kind = 0
        nb = name.encode("utf-8")
        out += struct.pack("<B", len(nb)) + nb
        out += struct.pack("<B", kind)
        out += struct.pack("<I", a.ndim)
        for d in a.shape:
            out += struct.pack("<I", int(d))
        if kind == 0:
            out += a.tobytes()
        else:
            rows, cols = a.shape
            amax = np.abs(a).max(axis=1).astype(np.float32)
            scales = np.maximum(amax / 127.0, 1e-8).astype(np.float32)
            q = np.clip(np.round(a / scales[:, None]), -127, 127).astype(np.int8)
            out += scales.tobytes()
            out += q.tobytes()

    os.makedirs(os.path.dirname(OUT_BIN), exist_ok=True)
    with open(OUT_BIN, "wb") as f:
        f.write(out)
    print(f"roult.bin written: {len(out) / 1e6:.1f} MB")

    shutil.copy(os.path.join(os.path.dirname(__file__), "vocab.json"), OUT_VOCAB)
    with open(OUT_VOCAB, encoding="utf-8") as f:
        vj = json.load(f)
    print(f"vocab.json copied: {len(vj['itos'])} tokens")


if __name__ == "__main__":
    main()
