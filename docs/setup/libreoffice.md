# LibreOffice backend

The most reliable default. Works on Linux, macOS, and Windows. High fidelity for DOCX (Word-class ~95%).

## Install

| Platform | Command |
|---|---|
| macOS (Homebrew) | `brew install --cask libreoffice` |
| Debian/Ubuntu | `sudo apt install libreoffice` |
| Fedora/RHEL | `sudo dnf install libreoffice` |
| Arch | `sudo pacman -S libreoffice-fresh` |
| Windows | [Download installer](https://www.libreoffice.org/download/download-libreoffice/) |

Once installed, either `soffice` or `lowriter` must be on `PATH`. The doctor probe looks for both.

```bash
docx2pdf --doctor    # confirms libreoffice availability + version
docx2pdf contract.docx contract.pdf
```

## Concurrency

LibreOffice's default behavior is to share a `UserInstallation` profile across instances, which deadlocks parallel invocations. `docx2pdf` works around this by passing a per-call `-env:UserInstallation` profile directory — so `--concurrency N` is safe out of the box.

```bash
docx2pdf --concurrency 4 --out-dir ./pdfs ./drafts/*.docx
```

## Known limitations

- Complex SmartArt may render as a static bitmap.
- Embedded Excel/PowerPoint objects sometimes lose interactive features.
- Word-specific track-changes formatting may differ subtly.

For pixel-perfect Word fidelity, see [word.md](word.md) (macOS only).

## Footprint

LibreOffice installs ~700 MB. If that's prohibitive and Docker is available, prefer [gotenberg.md](gotenberg.md) — same engine, no local install.
