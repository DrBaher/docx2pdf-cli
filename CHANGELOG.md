# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [Unreleased]

## [0.1.1] - 2026-05-04

### Added
- Real DOCX fixture (`tests/fixtures/sample.docx`) and end-to-end smoke test that runs an actual LibreOffice conversion in CI on Ubuntu.
- CI: install `libreoffice` on Ubuntu runners; additionally `npm pack` + global install on the Node 20 / Ubuntu cell to catch bin-path / files-allowlist regressions.
- README: install/CI/license/npm version badges; comparison table vs. `libreoffice-convert`, AlJohri's `docx2pdf`, Gotenberg, and `dxpdf`.
- Issue templates and PR template under `.github/`.
- Release workflow that publishes to npm with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) on tag push.
- `CHANGELOG.md`.

### Changed
- Font preflight now strips standard weight/style suffixes (Light, Bold, Italic, etc.) before matching against system fonts. "Calibri Light" no longer warns when "Calibri" is installed; "Helvetica Neue" still does *not* match "Helvetica" (Neue is a separate family, not a weight).
- `--check-fonts` now accepts multiple inputs and emits one report (or one NDJSON line with `--json`) per file.
- `runParallel` surfaces full child stderr instead of only the last line when a child crashes without emitting parsable JSON.
- Backend probing (`commandExists` / `appScriptable`) memoizes within a single high-level call, cutting `--doctor` and `--why` from ~14 sh probes to ~8.

### Fixed
- Multi-input `--check-fonts` previously dropped all inputs after the first.

## [0.1.0] - 2026-05-04

Initial release. Honest, batch-aware DOCX → PDF CLI with hybrid backends.

### Highlights
- **Backend transparency** — `--why` prints the decision tree; `--strict-fidelity` refuses the text-only fallback.
- **Concurrency-safe LibreOffice** — per-call `-env:UserInstallation` profile dir; `--concurrency N` runs parallel batch conversions safely.
- **Batch mode** — multiple inputs with `--out-dir`, NDJSON output via `--json`, continue-on-error per file, deterministic ordering.
- **Font preflight** — `--check-fonts` reports missing fonts; auto-warning before LibreOffice / Gotenberg substitute silently.
- **Six pluggable backends** — libreoffice, gotenberg, convertapi, pages, word, textutil-cups.
- **Internal glob expansion** for cross-shell compatibility.

[Unreleased]: https://github.com/DrBaher/docx2pdf-cli/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/DrBaher/docx2pdf-cli/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/DrBaher/docx2pdf-cli/releases/tag/v0.1.0
