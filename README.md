# docx2pdf-cli

Honest, batch-aware DOCX → PDF converter with hybrid backends.

- **Tells you which backend ran and why** — `--why` prints the full decision tree; no opaque "auto" mode that silently picks a low-fidelity fallback.
- **Concurrency-safe LibreOffice** — each call gets its own `UserInstallation` profile dir, so parallel invocations don't deadlock on a shared profile.
- **Batch mode with NDJSON** — convert globs of inputs into an output directory, with one structured line per file for CI piping.
- **Font preflight** — warns when fonts in the document aren't installed before LibreOffice/Gotenberg substitute them silently.
- **Six pluggable backends**, with strict-fidelity guard against the text-only fallback.

## Install

```bash
npm i -g docx2pdf-cli
```

Or from a clone:

```bash
git clone https://github.com/DrBaher/docx2pdf-cli.git
cd docx2pdf-cli && ./install.sh
```

You'll also need at least one backend's runtime — LibreOffice (`brew install --cask libreoffice` on macOS, `apt install libreoffice` on Debian/Ubuntu) is the easiest. Run `docx2pdf --doctor` to see what's available.

## Backends (auto order)

| Backend | Fidelity | Requires |
|---|---|---|
| `libreoffice` | high (local) | `soffice` or `lowriter` |
| `gotenberg` | high (server) | `GOTENBERG_URL` + `curl` |
| `convertapi` | high (cloud) | `CONVERTAPI_SECRET` + `curl` |
| `pages` | high (macOS) | Apple Pages, Automation permission |
| `word` | high (macOS) | Microsoft Word, Automation permission |
| `textutil-cups` | text-only | `textutil` + `cupsfilter` (macOS) |

`auto` selects the first available. Add `--strict-fidelity` to refuse the `textutil-cups` fallback when no high-fidelity backend is available.

## Quick start

### Local (LibreOffice)
```bash
docx2pdf input.docx output.pdf
```

### Self-hosted Gotenberg
```bash
export GOTENBERG_URL="http://127.0.0.1:3000"
docx2pdf --backend gotenberg input.docx output.pdf
```

### Cloud ConvertAPI (optional)
```bash
export CONVERTAPI_SECRET="<your-secret>"
docx2pdf --backend convertapi input.docx output.pdf
```

### Batch mode
```bash
docx2pdf --out-dir ./pdfs *.docx
docx2pdf --json --out-dir ./pdfs *.docx | jq
docx2pdf --concurrency 4 --out-dir ./pdfs *.docx     # parallel, safe with LibreOffice
```

Globs are expanded by your shell on macOS/Linux. On Windows or with quoted patterns (`"*.docx"`), the CLI expands `*` and `?` against the directory itself.

In batch mode, one bad file does not stop the rest. With `--json`, each file emits one NDJSON line:

```json
{"ok":true,"backend":"libreoffice","input":"/abs/a.docx","output":"/abs/pdfs/a.pdf"}
{"ok":false,"input":"/abs/b.docx","error":"LibreOffice conversion failed: ..."}
```

Exit code is `0` only if every file succeeded.

## Diagnostics

```bash
docx2pdf --list-backends            # which backends are usable on this machine
docx2pdf --doctor                   # full diagnostics as JSON
docx2pdf --why input.docx           # print backend selection reasoning to stderr, then convert
docx2pdf --check-fonts input.docx   # report which fonts in the document are missing
```

`--check-fonts` requires `unzip` and `fc-list` (install fontconfig on macOS via `brew install fontconfig`).

## Run Gotenberg locally (Docker)
```bash
docker run --rm -p 3000:3000 gotenberg/gotenberg:8
```

## All options

```
--backend <auto|libreoffice|gotenberg|convertapi|pages|word|textutil-cups>
--strict-fidelity         in auto mode, refuse to fall back to text-only backend
--out-dir <dir>           write outputs to <dir>/<basename>.pdf (enables batch mode)
--concurrency <n>         run up to N conversions in parallel in batch mode (default: 1)
--timeout-seconds <n>     conversion timeout (default: 120)
--overwrite, --force      replace existing output file
--quiet, -q               suppress success output (errors still print)
--json                    emit machine-readable JSON (NDJSON in batch mode)
--why                     print backend selection reasoning to stderr
--check-fonts             report which fonts in the .docx are missing
--list-backends           show available backends and exit
--doctor                  print full diagnostics as JSON and exit
-h, --help
-v, --version
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 2 | Usage / bad arguments |
| 3 | Required backend or tool unavailable |
| 4 | Conversion failed |

## License

MIT — see [LICENSE](LICENSE).
