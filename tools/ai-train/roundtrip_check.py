#!/usr/bin/env python3
"""Round-trip proof: telemetry JSONL -> train_bc.parse_line().

Reads a JSONL file produced by src/telemetry.js (see gen_fixture.mjs) and feeds
every line through the trainer's real validator. Exits non-zero if any line is
rejected, so a schema drift between the recorder and the trainer fails loudly.

Run in the ai-train container:
    podman run --rm -v "$PWD":/work -w /work --entrypoint python neon-ai-train \
        tools/ai-train/roundtrip_check.py tests/fixtures/telemetry-roundtrip.jsonl
"""
import sys

from train_bc import parse_line  # noqa: E402  (same directory)


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "tests/fixtures/telemetry-roundtrip.jsonl"
    width = int(sys.argv[2]) if len(sys.argv) > 2 else 50  # obs v2 default (3.20.0)
    ok = 0
    with open(path, "r", encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            obs, target, rec = parse_line(line, width, f"{path}:{lineno}")
            assert obs.shape == (width,) and target.shape == (3,)
            ok += 1
    if ok == 0:
        print("round-trip FAILED: no rows", file=sys.stderr)
        return 1
    print(f"round-trip OK: {ok} telemetry rows accepted by parse_line()")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
