# 04 — Proof Assets Kit

Goal: make trust obvious for engineers and agent builders.

## Asset checklist

- [ ] **Deterministic benchmark log** (single-file + batch)
- [ ] **Fidelity demo** (layout-preserving backend vs text-only fallback)
- [ ] **Backend explainability demo** (`--why` output example)
- [ ] **Failure-mode demo** (strict-fidelity backend-missing error path)
- [ ] **CI badge screenshot + release provenance screenshot**

## Benchmark command templates

```bash
# single-file timing
time docx2pdf --strict-fidelity ./fixtures/sample.docx ./out/sample.pdf

# batch timing (parallel)
time docx2pdf --strict-fidelity --json --concurrency 4 --out-dir ./out ./fixtures/*.docx > ./out/results.ndjson
```

## Minimal “proof pack” structure

```
proof/
  README.md
  benchmark/
    run-<date>.md
    results.ndjson
  fidelity/
    input.docx
    output-high-fidelity.pdf
    output-text-only.pdf
  diagnostics/
    doctor.json
    why.txt
```

## Suggested narrative

1. “Here is the same DOCX via strict high-fidelity path vs text-only fallback.”
2. “Here is exactly why the backend was selected (`--why`).”
3. “Here are reproducible timings + CI evidence.”

