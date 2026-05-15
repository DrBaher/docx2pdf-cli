# Setup

Backend-specific install + configuration. You only need to read the one(s) you'll use.

| File | Use when |
|---|---|
| [libreoffice.md](libreoffice.md) | Local LibreOffice on Linux/macOS/Windows — the most reliable default. |
| [gotenberg.md](gotenberg.md) | Docker-hosted LibreOffice as a server — zero system mutation. |
| [convertapi.md](convertapi.md) | SaaS conversion via API key. |
| [pages.md](pages.md) | Apple Pages on macOS via AppleScript. |
| [word.md](word.md) | Microsoft Word on macOS via AppleScript. |

For backend-selection guidance, see [docs/reference/backends.md](../reference/backends.md). For the `--doctor` JSON shape that drives auto-recommendation, see [docs/reference/doctor.md](../reference/doctor.md).

Quickest path on most hosts:

```bash
docx2pdf --doctor
# Follow the `recommendation` field.
```
