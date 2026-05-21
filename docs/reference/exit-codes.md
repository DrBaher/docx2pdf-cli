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
  "input": "contract.docx",
  "error": "No conversion backend is available on this host.",
  "exitCode": 3
}
```

The JSON failure object is **flat**: `error` is a human-readable string and `exitCode` is the stable class. Branch on the exit code (or the `exitCode` field), not on the message.

## Error causes by exit code

| Cause | Exit | Notes |
|---|---|---|
| Invalid input | `2` | Missing arg, bad flag, or file not found. |
| Strict-fidelity refused | `2` | `--strict-fidelity` set but the only resolved backend is `textutil-cups`. |
| No backend | `3` | No backend can convert; run `docx2pdf --doctor` for the next install step. |
| Backend timeout | `4` | Backend hung past the per-invocation timeout. |
| Backend failed | `4` | Backend ran but produced no PDF or exited non-zero. |

## Disabling the JSON envelope

The default output is plain text. Add `--json` to switch to structured JSON. There's no env var; the flag is the toggle.
