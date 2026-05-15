# Microsoft Word backend

macOS-only. The highest-fidelity option — actually opens the file in Word and prints to PDF. Requires Automation permission.

## Prereqs

- macOS with Microsoft Word installed (`/Applications/Microsoft Word.app`).
- A licensed Office account or active Microsoft 365 subscription.
- Automation permission granted to whatever shell or app is running `docx2pdf`. On first invocation, macOS will prompt; pressing "Don't Allow" disables this backend permanently until you re-grant it in System Settings → Privacy & Security → Automation.

## Use

```bash
docx2pdf --backend word contract.docx contract.pdf
```

## When to use

- Documents with complex Word-specific features (advanced track-changes, SmartArt, embedded Excel/PowerPoint with live OLE).
- Final renders where you're handing a PDF to a counterparty and want zero risk of layout drift.

## Caveats

- ~3–5s per file just to launch and render in Word.
- macOS only — there's no equivalent backend on Linux/Windows in this CLI.
- Word's silent-print behavior can occasionally pop a save-prompt dialog. If batch runs stall, check for a Word window awaiting interaction.

For server-side / batch / cross-platform, see [libreoffice.md](libreoffice.md) or [gotenberg.md](gotenberg.md).
