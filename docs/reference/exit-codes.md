# Exit codes & error envelope

Every `docx2pdf` invocation honors the same exit-code semantics.

## The map

| Code | Meaning |
|------|---------|
| `0` | Every requested conversion succeeded |
| `2` | Invalid input (missing argument, bad flag, file not found) |
| `3` | No acceptable backend available (`error.kind: "NO_BACKEND"`) |
| `4` | Conversion failed (backend ran but no PDF was produced) |

In batch mode, the overall exit is the highest exit any file produced. Each NDJSON row carries its own `ok` and `exitCode` so a parser can branch per file.

## The success envelope

```json
{
  "ok": true,
  "backend": "libreoffice",
  "input": "/abs/contract.docx",
  "output": "/abs/contract.pdf",
  "outputBytes": 12345,
  "durationMs": 287
}
```

Batch mode (`--json` with multiple inputs) writes one such object per line as NDJSON, plus a final summary line at the end.

## The error envelope

Errors print to **stderr**, exit non-zero:

```json
{
  "ok": false,
  "error": {
    "code": "NO_BACKEND",
    "kind": "NO_BACKEND",
    "message": "No conversion backend is available on this host.",
    "exitCode": 3,
    "details": {
      "platform": "darwin",
      "recommendation": { ... }
    }
  }
}
```

`kind` is the stable class — agents should branch on this, not on the human-readable `message`.

## Stable error `kind`s

| Kind | Class | Notes |
|---|---|---|
| `INVALID_INPUT` | input | Exit `2`. Missing arg, bad flag, file not found. |
| `STRICT_FIDELITY_REFUSED` | input | Exit `2`. Asked for `--strict-fidelity` but the resolved backend is `textutil-cups`. |
| `NO_BACKEND` | infra | Exit `3`. No backend can convert. `details.recommendation` names the next install step. |
| `BACKEND_TIMEOUT` | runtime | Exit `4`. Backend hung past the per-invocation timeout. |
| `BACKEND_FAILED` | runtime | Exit `4`. Backend ran but produced no PDF or exited non-zero. `details.stderr` carries the backend's own output. |
| `FONT_MISSING` | runtime | Exit `4` (only when `--check-fonts --strict` is passed). The document references a font not on the host. |

## Disabling the JSON envelope

The default output is plain text. Add `--json` to switch to structured JSON. There's no env var; the flag is the toggle.
