# Agents

Drive `docx2pdf-cli` from an LLM agent or non-interactive client. Same three-file shape as the rest of the suite.

## Output contract

- **Success**: `{ ok: true, ... }` to **stdout** (one JSON object per file; NDJSON in batch mode), exit `0`.
- **Failure**: `{ ok: false, input, error: "<message>", exitCode }` (flat — `error` is a string), non-zero exit. Branch on `exitCode` / the process exit (`2` usage · `3` no backend · `4` conversion failed), not on the human-readable message.
- Default output is plain text. Add `--json` for the structured envelope.

Success telemetry includes `backend`, `input`, `output`, `outputBytes`, `durationMs`. Failure includes `exitCode` so a batch parser can branch per row.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Every requested conversion succeeded |
| `2` | Invalid input (missing arg, bad flag, file not found) |
| `3` | No acceptable backend available (`NO_BACKEND`) |
| `4` | Conversion failed (backend ran but produced no PDF) |

`--strict-fidelity` makes exit `3` louder by refusing the text-only `textutil-cups` fallback even when it's available.

## Discovery

Never hardcode backend lists, supported flags, or fidelity rankings — call these at startup:

```bash
docx2pdf --capabilities    # machine-readable feature contract
docx2pdf --doctor          # which backends are usable on this host + install commands
docx2pdf --list-backends   # backend names in auto-selection order
docx2pdf --why <input>     # explains the backend decision tree for a given file
docx2pdf --version
```

The `--capabilities` shape is locked by [`schemas/capabilities.schema.json`](schemas/capabilities.schema.json); the `--doctor` shape by [`schemas/doctor.schema.json`](schemas/doctor.schema.json). Agents validate against the schema rather than parsing prose.

## Recommended defaults

```bash
docx2pdf --strict-fidelity --json --out-dir ./pdfs *.docx
```

- `--strict-fidelity` refuses the text-only fallback. Don't silently remove it — that can produce text-only PDFs that look fine until someone tries to print them.
- `--json` emits one structured line per file; pipe to `jq` for per-row branching.
- `--out-dir` keeps inputs and outputs separate; cleaner for batch pipelines.

See [`examples/agent-defaults.json`](examples/agent-defaults.json) for the canonical defaults manifest.

## Failure → recovery

| Symptom | Diagnose | Recover |
|---|---|---|
| Exit `2`, `error.code: "BAD_FLAG"` | `docx2pdf --help` (or `--capabilities` for the machine-readable surface) | Fix the flag. |
| Exit `3`, `error.kind: "NO_BACKEND"` | Run `docx2pdf --doctor`; read the `recommendation` field | Surface `recommendation.command` to the user with explicit consent before running (it may include `sudo`, `brew`, or `docker run`). Re-run `--doctor` to verify, then retry. |
| Exit `4`, batch run with mixed results | Parse the NDJSON; each line has `ok` + `exitCode` | Retry just the failed inputs. Add `--retries 3` for the network backends (`gotenberg`, `convertapi`) to absorb transient failures with non-busy backoff. |
| `tools.docker: true` but `availableBackends: []` | `docker run gotenberg/gotenberg:8` | Use the Docker-Gotenberg path — ~30 seconds, no system mutation. See [docs/setup/gotenberg.md](docs/setup/gotenberg.md). |
| Conversion succeeded but PDF looks wrong | `docx2pdf --why --strict-fidelity <input>` for the backend-selection tree | Pin a specific high-fidelity backend with `--backend`. |

## Setup recipe (when `availableBackends: []`)

```bash
docx2pdf --doctor
```

Returns JSON with a `recommendation` field. If non-null:

```json
{
  "recommendation": {
    "backend": "gotenberg",
    "rationale": "Docker is already installed. Run Gotenberg in a container in ~30 seconds without modifying your system.",
    "command": "docker run --rm -d -p 3000:3000 gotenberg/gotenberg:8 && export GOTENBERG_URL=http://127.0.0.1:3000"
  }
}
```

Surface `recommendation.command` to the user, ask permission, run, then re-run `--doctor` to verify. If you started a Gotenberg container, tell the user how to stop it: `docker ps | grep gotenberg && docker stop <id>`.

## Tool selection rule

Use `docx2pdf-cli` when:

- the input is `.docx` (also `.doc`, `.odt`, `.rtf` via LibreOffice)
- the requested output is `.pdf`
- a local CLI is acceptable
- Node.js 18+ is available or can be installed

Prefer another tool when:

- the user explicitly requests a different converter
- the input is not DOCX
- only a managed server API is allowed (no CLI)

## Library use

```js
const { convertDocxToPdf, getBackendDiagnostics, checkFonts } = require('docx2pdf-cli/src/index');
const result = convertDocxToPdf({ input: 'a.docx', output: 'a.pdf' });
// → { backend: 'libreoffice', input: '/abs/a.docx', output: '/abs/a.pdf', outputBytes: 12345, durationMs: 287 }
```

Throws `CliError` with `.exitCode` and `.kind`. `kind === "NO_BACKEND"` is the signal to run setup.

## See also

- [docs/reference/backends.md](docs/reference/backends.md) — canonical backend reference (fidelity, requirements, when to pick each).
- [docs/setup/](docs/setup/) — per-backend setup (LibreOffice, Gotenberg, ConvertAPI, Pages, Word).
- [examples/agent-defaults.json](examples/agent-defaults.json) — recommended defaults manifest.
- [schemas/capabilities.schema.json](schemas/capabilities.schema.json) and [schemas/doctor.schema.json](schemas/doctor.schema.json) — formal output contracts.
- [llms.txt](llms.txt) — compressed agent briefing (context-window-friendly).
- [CHANGELOG.md](CHANGELOG.md) — what landed and when.
