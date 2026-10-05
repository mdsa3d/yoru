#!/usr/bin/env python3
"""Generate JS<->Python parity reference vectors for src/mlp.js (UPLIFT-PLAN B7/C).

Writes two fixtures consumed by tests/mlp.test.mjs:

  tests/fixtures/mlp-reference.json      small mixed-activation net (5->6->5->4->3,
                                         tanh/relu/sigmoid/identity) + 8 I/O vectors
  tests/fixtures/mlp-asset-vectors.json  I/O vectors for the shipped weights file
                                         (assets/ai/rival-policy-synthetic.json)

Reference semantics match the JS runner: weights/inputs stored as float32,
accumulation in float64, elementwise activation. Agreement is therefore
limited by float64 rounding only (|diff| << 1e-5).

Run inside the container (see README.md):
  podman run --rm -v "$PWD":/work -w /work --entrypoint python neon-ai-train \
      tools/ai-train/make_reference.py
"""
import json
import math
import os

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ASSET = os.path.join(ROOT, "assets", "ai", "rival-policy-synthetic.json")


def act(name, z):
    if name == "tanh":
        return np.tanh(z)
    if name == "relu":
        return np.maximum(z, 0.0)
    if name == "sigmoid":
        return 1.0 / (1.0 + np.exp(-z))
    if name == "identity":
        return z
    raise ValueError(name)


def forward_f64_over_f32(spec, x):
    """The reference: f32 storage (as the browser Float32Array sees it), f64 math."""
    a = np.asarray(x, dtype=np.float32).astype(np.float64)
    for L in spec["layers"]:
        W = np.asarray(L["W"], dtype=np.float32).astype(np.float64)
        b = np.asarray(L["b"], dtype=np.float32).astype(np.float64)
        units = L["units"]
        W = W.reshape(-1, units)
        a = act(L["activation"], a @ W + b)
    return a


def seeded_spec():
    rng = np.random.default_rng(20261003)
    widths = [5, 6, 5, 4, 3]
    activations = ["tanh", "relu", "sigmoid", "identity"]
    layers = []
    for fi, fo, name in zip(widths[:-1], widths[1:], activations):
        limit = math.sqrt(6.0 / (fi + fo))
        W = rng.uniform(-limit, limit, size=(fi, fo)).astype(np.float32)
        b = rng.uniform(-0.25, 0.25, size=fo).astype(np.float32)
        layers.append({"units": fo, "activation": name,
                       "W": [float(v) for v in W.ravel()], "b": [float(v) for v in b]})
    return {"format": "neon-rash-mlp@1", "input": widths[0], "output": widths[-1],
            "meta": {"label": "parity reference fixture (seeded, untrained)"}, "layers": layers}


def vectors(spec, n, seed):
    rng = np.random.default_rng(seed)
    out = []
    for _ in range(n):
        x = rng.uniform(-2.0, 2.0, size=spec["input"]).astype(np.float32)
        y = forward_f64_over_f32(spec, x)
        out.append({"in": [float(v) for v in x], "out": [float(v) for v in y]})
    return out


def main():
    spec = seeded_spec()
    ref = {"weights": spec, "vectors": vectors(spec, 8, 11)}
    p1 = os.path.join(ROOT, "tests", "fixtures", "mlp-reference.json")
    with open(p1, "w", encoding="utf-8") as fh:
        json.dump(ref, fh, separators=(",", ":"))
    print(f"wrote {p1}")

    if os.path.exists(ASSET):
        with open(ASSET, encoding="utf-8") as fh:
            asset_spec = json.load(fh)
        asset = {"weightsPath": "assets/ai/rival-policy-synthetic.json",
                 "vectors": vectors(asset_spec, 6, 23)}
        p2 = os.path.join(ROOT, "tests", "fixtures", "mlp-asset-vectors.json")
        with open(p2, "w", encoding="utf-8") as fh:
            json.dump(asset, fh, separators=(",", ":"))
        print(f"wrote {p2}")
    else:
        print(f"NOTE: {ASSET} missing; skipped asset vectors (run train_bc.py --init-only first)")


if __name__ == "__main__":
    main()
