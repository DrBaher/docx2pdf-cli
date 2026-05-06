# docx2pdf-cli

[![npm version](https://img.shields.io/npm/v/docx2pdf-cli.svg)](https://www.npmjs.com/package/docx2pdf-cli)
[![npm downloads](https://img.shields.io/npm/dw/docx2pdf-cli.svg)](https://www.npmjs.com/package/docx2pdf-cli)
[![CI](https://github.com/DrBaher/docx2pdf-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/DrBaher/docx2pdf-cli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Honest, batch-aware DOCX → PDF converter with hybrid backends.

- **Tells you which backend ran and why** — `--why` prints the full decision tree; no opaque "auto" mode that silently picks a low-fidelity fallback.
- **Concurrency-safe LibreOffice** — each call gets its own `UserInstallation` profile dir, so parallel invocations don't deadlock on a shared profile.
- **Batch mode with NDJSON** — convert globs of inputs into an output directory, with one structured line per file for CI piping.
- **Font preflight** — warns when fonts in the document aren't installed before LibreOffice/Gotenberg substitute them silently.
- **Six pluggable backends**, with strict-fidelity guard against the text-only fallback.

## How it compares

|                                 | docx2pdf-cli       | [libreoffice-convert](https://www.npmjs.com/package/libreoffice-convert) | [AlJohri/docx2pdf](https://github.com/AlJohri/docx2pdf) | [Gotenberg](https://gotenberg.dev) | [dxpdf](https://lib.rs/crates/dxpdf) |
|---------------------------------|--------------------|--------------------------------------------------------------------------|--------------------------------------------------------|------------------------------------|--------------------------------------|
| Backend approach                | hybrid (6)         | LibreOffice                                                              | MS Word automation                                     | LibreOffice (server)               | native Skia renderer                 |
| Concurrency-safe LO             | ✅ per-call profile | ❌ shared profile collision                                              | n/a                                                    | ✅                                  | n/a                                  |
| Batch CLI + NDJSON              | ✅                  | ❌ (library API only)                                                    | ❌                                                      | n/a (HTTP server)                  | ❌                                    |
| Backend transparency (`--why`)  | ✅                  | ❌                                                                        | ❌                                                      | ❌                                  | ❌                                    |
| Font preflight                  | ✅                  | ❌                                                                        | ❌                                                      | ❌                                  | ❌                                    |
| Linux + macOS + Windows         | ✅                  | ✅                                                                        | macOS + Windows only                                   | ✅ (Docker)                         | ✅                                    |
| Install                         | `npm i -g`         | `npm i`                                                                  | `pip install`                                          | Docker                             | `cargo install` / `pip`              |

Honest notes: `libreoffice-convert` is a leaner Node *library API* (we're a CLI). Gotenberg also handles HTML→PDF and scales as a server. `dxpdf` ships a custom renderer that avoids LibreOffice entirely (~100ms per doc) but is still feature-incomplete.

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

## For AI agents / automation

If you're wiring this into agents, use strict + machine-readable defaults:

```bash
docx2pdf --strict-fidelity --json --out-dir ./pdfs *.docx
```

- `--strict-fidelity` prevents silent downgrade to text-only conversion.
- `--json` emits NDJSON in batch mode for robust parsing.
- `--why` is useful for audits/debugging backend choice.

See [AGENTS.md](AGENTS.md) for default routing and fallback policy.
For deeper integration, see [docs/AGENT_INTEGRATION.md](docs/AGENT_INTEGRATION.md), [`llms.txt`](llms.txt), and [`examples/agent-defaults.json`](examples/agent-defaults.json).

Machine-readable capabilities:

```bash
docx2pdf --capabilities
```

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
docx2pdf --retries 2 --backend gotenberg --out-dir ./pdfs *.docx   # retry transient network failures
```

Globs are expanded by your shell on macOS/Linux. On Windows or with quoted patterns (`"*.docx"`), the CLI expands `*` and `?` against the directory itself.

In batch mode, one bad file does not stop the rest. With `--json`, each file emits one NDJSON line:

```json
{"ok":true,"backend":"libreoffice","input":"/abs/a.docx","output":"/abs/pdfs/a.pdf","outputBytes":123456,"durationMs":842}
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
--retries <n>             retry failed network backends n times (default: 0)
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

## Adoption resources

- [Agent Integration Guide](docs/AGENT_INTEGRATION.md)
- [JSON Schemas](schemas/)
