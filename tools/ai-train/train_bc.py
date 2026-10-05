#!/usr/bin/env python3
"""Behaviour cloning for the YORU rival policy net (UPLIFT-PLAN B4).

NumPy-only MLP trainer. Reads telemetry JSONL (one JSON object per simulated
step, recorded by src/telemetry.js), validates every line defensively, trains
with Adam on MSE loss, and exports JSON weights in the `neon-rash-mlp@1`
format consumed by src/mlp.js.

Telemetry schema (settled with src/telemetry.js in 3.17.0 — one canonical
form; if the schema drifts again, only `parse_line()` should need to change):

    {"obs": [float, ...],                 # observation vector, --obs-width floats
     "input": {"steer": float,            # [-1, 1]
               "throttle": float,         # [ 0, 1]
               "brake": float},           # [ 0, 1]
     "tactic": "race"|...,                # string id, one of the seven TACTICS, informational
     "tacticDetail": {...},               # OPTIONAL object, extra tactical context, ignored
     "world": "akuma"|...,                # string, informational
     "bike": "nightblade"|...,            # string, informational
     "seed": int}                         # race seed, informational

Usage:
    train_bc.py --data run1.jsonl [--data run2.jsonl ...] --out weights.json
    train_bc.py --synthetic 4000 --out weights.json   # smoke: fabricated teacher
    train_bc.py --init-only --seed 7 --out weights.json  # untrained placeholder
"""
import argparse
import json
import math
import sys
import time

import numpy as np

# Format tags share one serialisation; @1 = v1 40-float obs, @2 = v2 50-float obs
# (src/obs.js — the 3.20.0 plan block). Chosen from --obs-width unless --format overrides.
FORMAT_V1 = "neon-rash-mlp@1"
FORMAT_V2 = "neon-rash-mlp@2"
VALID_TACTICS = {"race", "overtake", "defend", "yield", "slipstream", "block", "bait"}


# ---------------------------------------------------------------- telemetry
def parse_line(line, obs_width, lineno):
    """Validate one telemetry line. Returns (obs, target, record) or raises ValueError."""
    try:
        rec = json.loads(line)
    except json.JSONDecodeError as e:
        raise ValueError(f"line {lineno}: not JSON ({e})")
    if not isinstance(rec, dict):
        raise ValueError(f"line {lineno}: expected an object")
    obs = rec.get("obs")
    if not isinstance(obs, list) or len(obs) != obs_width:
        raise ValueError(f"line {lineno}: obs must be a list of {obs_width} floats")
    if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in obs):
        raise ValueError(f"line {lineno}: obs contains non-finite values")
    action = rec.get("input")
    if isinstance(action, dict):  # canonical shape
        triple = [action.get("steer"), action.get("throttle"), action.get("brake")]
    elif isinstance(action, list) and len(action) == 3:  # tolerate [steer,throttle,brake]
        triple = action
    else:
        raise ValueError(f"line {lineno}: input must be {{steer,throttle,brake}} or a 3-list")
    if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in triple):
        raise ValueError(f"line {lineno}: input contains non-finite values")
    steer, throttle, brake = triple
    if not -1.0 <= steer <= 1.0 or not 0.0 <= throttle <= 1.0 or not 0.0 <= brake <= 1.0:
        raise ValueError(f"line {lineno}: input out of range steer[-1,1] throttle/brake[0,1]")
    for key in ("tactic", "world", "bike"):
        if key in rec and not isinstance(rec[key], str):
            raise ValueError(f"line {lineno}: {key} must be a string")
    if "tactic" in rec and rec["tactic"] not in VALID_TACTICS:
        raise ValueError(f"line {lineno}: unknown tactic {rec['tactic']!r}")
    if "tacticDetail" in rec and not isinstance(rec["tacticDetail"], dict):
        raise ValueError(f"line {lineno}: tacticDetail must be an object when present")
    if "seed" in rec and not (isinstance(rec["seed"], int) and not isinstance(rec["seed"], bool)):
        raise ValueError(f"line {lineno}: seed must be an int")
    return np.asarray(obs, dtype=np.float64), np.asarray(triple, dtype=np.float64), rec


def load_telemetry(paths, obs_width, max_bad_ratio=0.5):
    """Returns (X, Y, stats); stats carries dataset provenance for the export meta.
    stats['keys'] is the per-row (world, bike, seed) race key used for the holdout split."""
    X, Y, bad = [], [], 0
    stats = {"rows": 0, "seeds": set(), "worlds": set(), "bikes": set(), "files": len(paths), "keys": []}
    for path in paths:
        with open(path, "r", encoding="utf-8") as fh:
            for lineno, line in enumerate(fh, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    obs, tgt, rec = parse_line(line, obs_width, f"{path}:{lineno}")
                    X.append(obs)
                    Y.append(tgt)
                    stats["rows"] += 1
                    stats["keys"].append((rec.get("world", "?"), rec.get("bike", "?"),
                                          rec.get("seed", -1), path))
                    for key in ("seeds", "worlds", "bikes"):
                        value = rec.get(key[:-1])
                        if value is not None:
                            stats[key].add(value)
                except ValueError as e:
                    bad += 1
                    if bad <= 10:
                        print(f"skip: {e}", file=sys.stderr)
    total = len(X) + bad
    if not X:
        raise SystemExit("no usable telemetry rows")
    if total and bad / total > max_bad_ratio:
        raise SystemExit(f"too many invalid rows ({bad}/{total}); check the telemetry schema")
    if bad:
        print(f"skipped {bad}/{total} invalid rows", file=sys.stderr)
    stats["seeds"] = sorted(stats["seeds"])
    stats["worlds"] = sorted(stats["worlds"])
    stats["bikes"] = sorted(stats["bikes"])
    return np.stack(X), np.stack(Y), stats


def split_holdout(n, keys, holdout, seed):
    """Race-level holdout: whole (world, bike, seed, file) races are held out together —
    a row-level split would leak temporally correlated frames and flatter the estimate.
    Returns (train_idx, held_idx); empty held_idx when holdout <= 0 or only one race."""
    if holdout <= 0:
        return np.arange(n), np.empty(0, dtype=int)
    races = sorted(set(keys))
    if len(races) < 2:
        return np.arange(n), np.empty(0, dtype=int)
    rng = np.random.default_rng(seed)
    perm = rng.permutation(len(races))
    held_races = {races[i] for i in perm[: max(1, int(round(len(races) * holdout)))]}
    train_idx = np.array([i for i, k in enumerate(keys) if k not in held_races], dtype=int)
    held_idx = np.array([i for i, k in enumerate(keys) if k in held_races], dtype=int)
    return train_idx, held_idx


def synthetic_teacher(n, obs_width, seed):
    """Fabricated expert for --synthetic smoke runs. NOT a driving policy:
    a fixed linear+nonlinear teacher so the training/export/parity path can be
    exercised end to end without real telemetry."""
    rng = np.random.default_rng(seed)
    X = rng.uniform(-1.0, 1.0, size=(n, obs_width))
    steer = np.tanh(-0.6 * X[:, 1] + 0.2 * X[:, 0])
    throttle = 1.0 / (1.0 + np.exp(-(1.2 * X[:, 2] - 0.8 * np.abs(X[:, 1]))))
    brake = np.clip(0.5 * np.abs(X[:, 3]) - 0.4 * X[:, 2], 0.0, 1.0)
    return X, np.stack([steer, throttle, brake], axis=1)


# ------------------------------------------------------------------ model
def init_mlp(widths, seed):
    rng = np.random.default_rng(seed)
    layers = []
    for fan_in, fan_out in zip(widths[:-1], widths[1:]):
        limit = math.sqrt(6.0 / (fan_in + fan_out))  # Xavier uniform
        W = rng.uniform(-limit, limit, size=(fan_in, fan_out))
        layers.append({"W": W, "b": np.zeros(fan_out), "activation": "tanh"})
    layers[-1]["activation"] = "identity"  # outputs: steer, throttle, brake in native ranges
    return layers


def forward(layers, X):
    A = X
    for L in layers:
        A = A @ L["W"] + L["b"]
        if L["activation"] == "tanh":
            A = np.tanh(A)
    return A


def mse(layers, X, Y):
    return float(np.mean(np.sum((forward(layers, X) - Y) ** 2, axis=1)))


def snapshot(layers):
    return [{"W": L["W"].copy(), "b": L["b"].copy(), "activation": L["activation"]} for L in layers]


def train(layers, X, Y, epochs, lr, batch, seed, Xh=None, Yh=None):
    """Adam on MSE. When a holdout (Xh, Yh) is given, per-epoch holdout MSE is printed
    and the BEST-holdout weights are returned (early-stopping by selection, not by
    halting), so a long schedule cannot ship an overfit tail epoch."""
    rng = np.random.default_rng(seed)
    # Adam state
    m = [{"W": np.zeros_like(L["W"]), "b": np.zeros_like(L["b"])} for L in layers]
    v = [{"W": np.zeros_like(L["W"]), "b": np.zeros_like(L["b"])} for L in layers]
    b1, b2, eps, t = 0.9, 0.999, 1e-8, 0
    n = len(X)
    best_mse, best_layers, best_epoch = float("inf"), None, -1
    for epoch in range(epochs):
        perm = rng.permutation(n)
        total = 0.0
        for start in range(0, n, batch):
            t += 1
            idx = perm[start:start + batch]
            xb, yb = X[idx], Y[idx]
            # forward, keeping pre/post activations for backprop
            acts, pre = [xb], []
            A = xb
            for L in layers:
                Z = A @ L["W"] + L["b"]
                pre.append(Z)
                A = np.tanh(Z) if L["activation"] == "tanh" else Z
                acts.append(A)
            err = A - yb
            total += float(np.sum(err ** 2))
            dA = 2.0 * err / len(xb)
            for li in reversed(range(len(layers))):
                L = layers[li]
                dZ = dA if L["activation"] == "identity" else dA * (1.0 - acts[li + 1] ** 2)
                gW = acts[li].T @ dZ
                gb = dZ.sum(axis=0)
                dA = dZ @ L["W"].T
                for key, g in (("W", gW), ("b", gb)):
                    m[li][key] = b1 * m[li][key] + (1 - b1) * g
                    v[li][key] = b2 * v[li][key] + (1 - b2) * g * g
                    mh = m[li][key] / (1 - b1 ** t)
                    vh = v[li][key] / (1 - b2 ** t)
                    L[key] -= lr * mh / (np.sqrt(vh) + eps)
        if Xh is not None and len(Xh):
            hm = mse(layers, Xh, Yh)
            if hm < best_mse:
                best_mse, best_layers, best_epoch = hm, snapshot(layers), epoch
            print(f"epoch {epoch:4d}  mse {total / n:.6f}  holdout {hm:.6f}", file=sys.stderr)
        elif epoch % max(1, epochs // 10) == 0 or epoch == epochs - 1:
            print(f"epoch {epoch:4d}  mse {total / n:.6f}", file=sys.stderr)
    if best_layers is not None:
        print(f"holdout-selected epoch {best_epoch} (holdout mse {best_mse:.6f})", file=sys.stderr)
        return best_layers, {"holdoutMse": best_mse, "holdoutEpoch": best_epoch}
    return layers, {}


def export_json(layers, obs_width, out_width, label, fmt=None, extra=None):
    """Serialize in neon-rash-mlp@1 (width-40 v1 obs) / neon-rash-mlp@2 (v2 obs).
    Weights are rounded through float32 so the JSON decimals round-trip exactly
    into the browser's Float32Array."""
    spec = {
        "format": fmt or (FORMAT_V1 if obs_width == 40 else FORMAT_V2),
        "input": obs_width,
        "output": out_width,
        "meta": {"label": label, "trained": False, "exported": time.strftime("%Y-%m-%d"),
                 **(extra or {})},
        "layers": [],
    }
    for L in layers:
        W32 = L["W"].astype(np.float32)
        b32 = L["b"].astype(np.float32)
        spec["layers"].append({
            "units": int(L["W"].shape[1]),
            "activation": L["activation"],
            "W": [float(x) for x in W32.ravel()],  # row-major, W[i*units+j]: input i -> output j
            "b": [float(x) for x in b32],
        })
    return spec


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--data", action="append", help="telemetry JSONL path (repeatable)")
    src.add_argument("--synthetic", type=int, metavar="N",
                     help="train on N fabricated teacher samples (smoke test only)")
    src.add_argument("--init-only", action="store_true",
                     help="export a seeded random init, no training (untrained placeholder)")
    ap.add_argument("--out", required=True, help="output weights JSON path")
    ap.add_argument("--obs-width", type=int, default=50,
                    help="obs vector width; 50 = v2 schema (default), 40 = legacy v1")
    ap.add_argument("--format", default=None, choices=[FORMAT_V1, FORMAT_V2],
                    help="export format tag (default: @1 for width 40, else @2)")
    ap.add_argument("--hidden", type=int, nargs="+", default=[128, 128])
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--lr", type=float, default=3e-3)
    ap.add_argument("--batch", type=int, default=256)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--holdout", type=float, default=0.1,
                    help="fraction of RACES held out (whole world/bike/seed races, seeded); "
                         "best-holdout epoch is exported; 0 disables")
    ap.add_argument("--label", default=None, help="provenance label stored in the JSON meta")
    args = ap.parse_args()

    widths = [args.obs_width, *args.hidden, 3]
    layers = init_mlp(widths, args.seed)

    if args.init_only:
        label = args.label or f"synthetic random init (seed {args.seed}) — UNTRAINED, not a driving policy"
        spec = export_json(layers, args.obs_width, 3, label, fmt=args.format)
    else:
        Xh = Yh = None
        if args.synthetic:
            X, Y = synthetic_teacher(args.synthetic, args.obs_width, args.seed)
            label = args.label or (f"SYNTHETIC smoke run on {args.synthetic} fabricated samples "
                                   f"(seed {args.seed}) — not trained on real telemetry")
        else:
            X, Y, stats = load_telemetry(args.data, args.obs_width)
            train_idx, held_idx = split_holdout(len(X), stats.pop("keys"), args.holdout, args.seed)
            if len(held_idx):
                Xh, Yh = X[held_idx], Y[held_idx]
                print(f"holdout: {len(held_idx)} rows ({len(held_idx) / len(X):.1%}) across held-out races; "
                      f"training on {len(train_idx)}", file=sys.stderr)
                X, Y = X[train_idx], Y[train_idx]
            label = args.label or f"behaviour cloning on {len(X)} telemetry rows"
        print(f"training on {len(X)} samples, widths {widths}", file=sys.stderr)
        layers, sel = train(layers, X, Y, args.epochs, args.lr, args.batch, args.seed, Xh, Yh)
        extra = {"samples": int(len(X)), "epochs": args.epochs, **sel}
        if Xh is not None:
            extra["holdoutRows"] = int(len(Xh))
        if args.data:
            extra["dataset"] = {"rows": stats["rows"], "files": stats["files"],
                                "seedCount": len(stats["seeds"]),
                                "worlds": stats["worlds"], "bikes": stats["bikes"]}
        spec = export_json(layers, args.obs_width, 3, label, fmt=args.format, extra=extra)
        spec["meta"]["trained"] = bool(args.data) or "synthetic-only"

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(spec, fh, separators=(",", ":"))
    params = sum(int(L["W"].size + L["b"].size) for L in layers)
    print(f"wrote {args.out} ({params} params) — label: {spec['meta']['label']}", file=sys.stderr)


if __name__ == "__main__":
    main()
