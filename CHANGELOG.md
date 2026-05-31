# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [Unreleased]

## [0.2.3] - 2026-05-31

### Fixed
- **Unwritable / missing output directory no longer dumps a raw Node stack trace.** Write-path `fs.*` calls are now wrapped so an `ENOENT`/`EACCES`/`EEXIST` becomes a clean `CliError` with a documented non-zero exit code instead of a traceback + exit 1:
  - `validatePaths` now rejects an output whose parent is a regular file (`Output directory is not a directory`) and converts a failed `mkdir` into `Cannot create output directory <dir>: <code>` (exit 2, `USAGE`).
  - The LibreOffice backend's final `rename`/`copy` into the destination and the textutil-cups `writeFileSync` calls now raise `Cannot write output <path>: <code>` (exit 4, `CONVERT_FAIL`).
- **`--out-dir <regular-file>`** now reports a clear "not a directory" error instead of a raw `EEXIST: mkdir` trace.
- **PDF-to-stdout (`-`) no longer truncates large output** on a slow pipe: the buffer is now written synchronously to fd 1 and fully drained before exit.

## [0.2.2] - 2026-05-15

### Added
- **`--catalog json`** — machine-readable flag inventory. Same shape across the three-CLI suite (matching `sign --catalog json` and `nda-review-cli --catalog json`). Agents call this at startup rather than parsing `--help`. Stable across minor versions.
- `--retries <n>` flag for network backends (`gotenberg`, `convertapi`) to retry transient failures in a controlled way.
- JSON success telemetry now includes `outputBytes` and `durationMs` for easier automation, observability, and benchmarking.
- Capability payload (`docx2pdf --capabilities`) now advertises retry support via `supports.retries`.
- **AGENTS.md as the canonical agent entry point** — replaces the prior `docs/AGENT_INTEGRATION.md` (merged). Documents the output contract, exit-code map, discovery commands, recommended defaults, fallback policy, and a failure-mode → recovery table.
- **`docs/setup/` per-backend pages** for libreoffice, gotenberg, convertapi, pages, and word.
- **`docs/reference/`** — canonical homes for backends, doctor JSON shape, exit codes, and JSON/NDJSON output. Concept docs that previously lived inline in the README.
- **`schemas/doctor.schema.json`** — formal JSON schema for the `--doctor` output (was previously documented only by example).

### Changed
- Retry backoff implementation now uses non-busy synchronous wait (`Atomics.wait`) to avoid CPU spin during retry delays.
- Parallel JSON mode now preserves full child success telemetry fields instead of collapsing to a minimal shape.
- Test suite skips the `--json` success-telemetry test when LibreOffice is unavailable (same pattern as the existing smoke test). Fixes macOS CI runs.
- README restructured around audience: "Run this" (`docx2pdf --doctor`) → "Where to go next" decision tree → human quickstart → backends overview → diagnostics → agent affordances. Human path now precedes the agent section.

### Removed
- `docs/AGENT_INTEGRATION.md` (merged into top-level `AGENTS.md` — 87-line duplication eliminated).

## [0.2.1] - 2026-05-05

### Added
- **Smarter onboarding when no backend is available.** Generic "no conversion backend" error replaced (well, supplemented — the original message stays as the first line so existing parsers don't break) with a platform-specific recommendation and per-backend install commands printed inline. If Docker is detected, leads with the one-line `docker run gotenberg/gotenberg:8` path so the user doesn't need to install LibreOffice (~700MB) at all.
- **`--doctor` JSON enriched with actionable setup data**:
  - `platform` (`darwin` / `linux` / `win32`) and `platformKey` (`linux-apt`, `linux-dnf`, etc.)
  - `tools.docker`, `tools.unzip`, `tools.fcList` (in addition to existing tool flags, all preserved at the top level for backwards compat)
  - `backends[name]` object with `available`, `fidelity`, `reason`, and `install` (platform-specific install command)
  - top-level `recommendation` field — single best next step for this host (Docker-Gotenberg if Docker is installed, else LibreOffice)
- `CliError` now carries an optional `kind` property (e.g. `"NO_BACKEND"`) so library callers can branch on error type instead of error-message text.
- `AGENTS.md` extended with a setup-recipe section covering the JSON shape, the discovery-then-install flow, the consent prompt pattern, and a clean-up note for Docker-started Gotenberg containers.

### Changed
- `commandExists` switched from `sh -lc` to `sh -c`. The login shell was reading user shell-init files and rebuilding `PATH`, sometimes returning probes for commands that `spawn()` itself couldn't actually find (e.g. when a parent process had cleared `PATH`).

## [0.2.0] - 2026-05-05

### Added
- `AGENTS.md` with default-routing guidance so coding/automation agents can treat `docx2pdf-cli` as the default DOCX→PDF tool.
- `llms.txt`, `docs/AGENT_INTEGRATION.md`, and `examples/agent-defaults.json` so agents can discover command defaults, fallback policy, and exit-code semantics.
- README section for AI/automation defaults (`--strict-fidelity --json`).
- Test coverage for agent assets (`tests/agent-assets.test.js`) to prevent accidental regression/removal.
- `--capabilities` CLI flag for machine-readable agent introspection.
- JSON Schemas for agent metadata and capability outputs under `schemas/`.
- Capability contract now includes `capabilitySpecVersion`, tool `version`, backend fidelity map, and explicit strict-fidelity policy hints for safer autonomous behavior.

### Changed
- npm keywords expanded for discoverability (`docx2pdf`, `ai-agent`, `automation`).
- npm package allowlist now includes agent/adoption docs and examples.

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

[Unreleased]: https://github.com/DrBaher/docx2pdf-cli/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/DrBaher/docx2pdf-cli/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/DrBaher/docx2pdf-cli/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/DrBaher/docx2pdf-cli/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/DrBaher/docx2pdf-cli/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/DrBaher/docx2pdf-cli/releases/tag/v0.1.0
