# Apple Pages backend

macOS-only. High fidelity but slowest of the high-fidelity options. Requires Automation permission.

## Prereqs

- macOS with Apple Pages installed (`/Applications/Pages.app`).
- Automation permission granted to whatever shell or app is running `docx2pdf`. On first invocation, macOS will prompt; pressing "Don't Allow" disables this backend permanently until you re-grant it in System Settings → Privacy & Security → Automation.

## Use

```bash
docx2pdf --backend pages contract.docx contract.pdf
```

## When to use

- Documents that must look exactly the way they look in Pages.
- One-off renders where speed doesn't matter (Pages launches the app, which adds ~3–5s of overhead per file).

For pure Word fidelity, see [word.md](word.md). For server-side / batch, see [libreoffice.md](libreoffice.md) or [gotenberg.md](gotenberg.md).
