# Backends

`docx2pdf-cli` supports six conversion backends. This is the canonical reference for what each one does and when to pick it.

## Auto-selection order

The `auto` backend (default) walks these in order and picks the first available:

| # | Backend | Fidelity | Requires |
|---|---|---|---|
| 1 | `libreoffice` | high (local) | `soffice` or `lowriter` on PATH |
| 2 | `gotenberg` | high (server) | `GOTENBERG_URL` + `curl` |
| 3 | `convertapi` | high (cloud) | `CONVERTAPI_SECRET` + `curl` |
| 4 | `pages` | high (macOS) | Apple Pages + Automation permission |
| 5 | `word` | high (macOS) | Microsoft Word + Automation permission |
| 6 | `textutil-cups` | text-only | `textutil` + `cupsfilter` (macOS) |

Pass `--strict-fidelity` to refuse the text-only `textutil-cups` fallback. The auto selector will then exit `3` (`NO_BACKEND`) rather than silently downgrading.

`--list-backends` prints this order live. `--why <input>` explains the decision tree for a specific file.

## Picking a backend

| If you… | Pick |
|---|---|
| Run on a typical Linux server | `libreoffice` (`apt install libreoffice` / `dnf install libreoffice`) |
| Want zero-install on a developer Mac with Docker | `gotenberg` via `docker run gotenberg/gotenberg:8` |
| Need consistent output across a fleet of machines | `gotenberg` (one server, all clients hit the same URL) |
| Are on a SaaS plan and don't want to host anything | `convertapi` |
| Want pixel-perfect macOS rendering of complex layouts | `word` or `pages` (high fidelity but desktop-only) |
| Need a tiny-footprint fallback on macOS | `textutil-cups` (lossy — text only) |

The `--doctor` probe gives a per-host `recommendation` that takes installed tooling into account (Docker → Gotenberg; otherwise LibreOffice). Agents should prefer that over hardcoded rules.

## Setup

Each backend has its own setup file in [docs/setup/](../setup/):

- [libreoffice.md](../setup/libreoffice.md)
- [gotenberg.md](../setup/gotenberg.md)
- [convertapi.md](../setup/convertapi.md)
- [pages.md](../setup/pages.md)
- [word.md](../setup/word.md)

## Fidelity caveats

Even the high-fidelity backends are not all equivalent:

- **LibreOffice** renders DOCX through its own engine. Layout matches Word ~95% of the time; rare divergences on complex tables, embedded objects, and SmartArt.
- **Gotenberg** is LibreOffice in a container. Same engine, so same fidelity — but the container model means consistent output across machines.
- **ConvertAPI** is a paid cloud service. Their fidelity is opaque (vendor-managed) but generally Word-class.
- **Pages** and **Word** are macOS automation — they actually open the file in the real app and print to PDF. Highest fidelity but slowest and macOS-only.
- **textutil-cups** is text extraction + reflow. Layout is lost.

For documents where layout matters (contracts, forms with field placement, anything that will be signed by a counterparty), pin `--backend libreoffice` or `--backend word` and run a visual diff against a known-good PDF before shipping.

## Network retries

For network backends (`gotenberg`, `convertapi`), pass `--retries N` to absorb transient failures. The retry uses non-busy backoff (`Atomics.wait`) so it doesn't spin CPU during the delay.

```bash
docx2pdf --backend gotenberg --retries 3 --strict-fidelity contract.docx contract.pdf
```

Capability discovery advertises this via `supports.retries: true` in `--capabilities`.
