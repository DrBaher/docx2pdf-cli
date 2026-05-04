# docx2pdf-cli

CLI-first DOCX → PDF converter with hybrid backends.

## Hybrid backend order (auto)
1. `libreoffice` (local headless, best local fidelity)
2. `gotenberg` (self-hosted server)
3. `convertapi` (cloud API)
4. `pages` (Apple Pages)
5. `word` (Microsoft Word)
6. `textutil-cups` (text-only fallback)

## No ConvertAPI required
Yes — you can run fully without ConvertAPI:
- Local only: install LibreOffice (`soffice`) and use `--backend libreoffice` (or auto)
- Self-hosted: run Gotenberg and set `GOTENBERG_URL`

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

## Run Gotenberg locally (Docker)
```bash
docker run --rm -p 3000:3000 gotenberg/gotenberg:8
```

## Diagnostics
```bash
docx2pdf --list-backends
docx2pdf --doctor
```

## Options
- `--backend <auto|libreoffice|gotenberg|convertapi|pages|word|textutil-cups>`
- `--timeout-seconds <n>` (default: 120)
- `--overwrite` / `--force`
- `--list-backends`
- `--doctor`
- `-h, --help`
- `-v, --version`

## Install
```bash
./install.sh
```

## Publish to wider world
- Publish on npm (`npm publish`) so users can `npm i -g docx2pdf-cli`
- Optional: provide a Homebrew tap formula for macOS users
