# `--doctor` JSON

The structured form of `--doctor` returns host readiness data. Use it as the source of truth for what's installed and what to install next.

The shape is locked by [`schemas/doctor.schema.json`](../../schemas/doctor.schema.json) — agents should validate against the schema rather than parse the prose.

## Top-level shape

```json
{
  "platform": "darwin",
  "platformKey": "darwin",
  "tools": {
    "docker": true,
    "soffice": false,
    "lowriter": false,
    "curl": true,
    "unzip": true,
    "fcList": true,
    "textutil": true,
    "cupsfilter": true
  },
  "availableBackends": [],
  "backends": {
    "libreoffice": {
      "available": false,
      "fidelity": "high",
      "reason": "skipped — install LibreOffice (provides soffice or lowriter)",
      "install": "brew install --cask libreoffice"
    },
    "gotenberg": {
      "available": false,
      "fidelity": "high",
      "reason": "skipped — set GOTENBERG_URL to enable",
      "install": "docker run --rm -d -p 3000:3000 gotenberg/gotenberg:8 && export GOTENBERG_URL=http://127.0.0.1:3000"
    }
  },
  "recommendation": {
    "backend": "gotenberg",
    "rationale": "Docker is already installed. Run Gotenberg in a container in ~30 seconds without modifying your system.",
    "command": "docker run --rm -d -p 3000:3000 gotenberg/gotenberg:8 && export GOTENBERG_URL=http://127.0.0.1:3000"
  }
}
```

## Field-by-field

- **`platform`** — Node's `process.platform` value (`darwin` / `linux` / `win32`).
- **`platformKey`** — refined: `linux-apt`, `linux-dnf`, etc. Used to pick the right install command per backend.
- **`tools.*`** — booleans for each tool we probe. Top-level for backward compat; also reflected per-backend in `backends[name].available` reasoning.
- **`availableBackends`** — array of backend names that are usable *right now* on this host. Empty array means no conversion will succeed.
- **`backends[name]`**:
  - `available` — boolean.
  - `fidelity` — `high` / `text-only`. Matches the backend's spot in the auto-order.
  - `reason` — human-readable why it's (un)available. Useful for surfacing to a user.
  - `install` — the platform-specific install command. May be `null` if the backend is OS-locked (e.g. `pages` on Linux).
- **`recommendation`** — the single best next step for this host. Picks Docker-Gotenberg when Docker is available (no system mutation, ~30s); falls back to LibreOffice otherwise. `null` if there's already at least one available backend.

## Agent usage

1. Run `docx2pdf --doctor` and parse the JSON.
2. If `availableBackends` is non-empty, conversion will work — proceed.
3. If empty and `recommendation` is non-null, surface `recommendation.command` to the user. Ask consent before executing (the command may include `sudo`, `brew`, or `docker run` — these have system-level effects).
4. After install, re-run `--doctor` to verify.
5. If you started a Gotenberg container, tell the user how to stop it (`docker ps | grep gotenberg && docker stop <id>`).

## Schema versioning

The JSON shape is stable within a minor version. Future enrichments are additive (new fields, never removed). Validate against the bundled schema if your agent caches the contract.
