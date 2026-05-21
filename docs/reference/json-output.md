# JSON / NDJSON output

`docx2pdf` writes plain text by default. Pass `--json` for the structured envelope.

## Single-file mode

```bash
docx2pdf --json contract.docx contract.pdf
```

Writes one JSON object to stdout on success:

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

On failure, a flat error object is emitted instead — `{ "ok": false, "input": "...", "error": "<message>", "exitCode": N }` (`error` is a human-readable string). Branch on the exit code (see [exit-codes.md](exit-codes.md)), which carries the class.

## Batch (NDJSON) mode

```bash
docx2pdf --json --out-dir ./pdfs *.docx
```

Writes one JSON object per line to stdout, plus a final summary line:

```jsonl
{"ok": true, "backend": "libreoffice", "input": "/abs/contract-a.docx", "output": "/abs/pdfs/contract-a.pdf", "outputBytes": 12345, "durationMs": 287}
{"ok": true, "backend": "libreoffice", "input": "/abs/contract-b.docx", "output": "/abs/pdfs/contract-b.pdf", "outputBytes": 18900, "durationMs": 312}
{"ok": false, "input": "/abs/broken.docx", "error": "LibreOffice exited 1", "exitCode": 4}
{"ok": true, "summary": {"total": 3, "succeeded": 2, "failed": 1, "durationMs": 920}}
```

Pipe to `jq` for per-line branching:

```bash
docx2pdf --json --out-dir ./pdfs *.docx | jq -c 'select(.ok == false) | .input'
```

## Telemetry fields

| Field | Type | Notes |
|---|---|---|
| `backend` | string | The backend that actually ran. |
| `input` | string (absolute path) | Resolved path; symlinks unfollowed. |
| `output` | string (absolute path) | Where the PDF landed. |
| `outputBytes` | number | Size of the produced PDF on disk. |
| `durationMs` | number | Wall-clock from invocation to PDF flush. |
| `exitCode` | number (failures only) | Same exit code an isolated invocation would have produced. |

## Parallel runs

When `--concurrency N` is set, NDJSON lines are emitted as each file completes — order is non-deterministic. A consumer that needs ordered output should sort by `input` or `durationMs` at the end. Telemetry fields are preserved fully (the per-file success envelope is the same regardless of concurrency).
