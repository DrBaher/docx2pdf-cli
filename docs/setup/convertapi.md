# ConvertAPI backend

SaaS conversion via API key. Vendor-managed, no local install. Paid (free tier exists for low volume).

## Configure

1. Sign up at [convertapi.com](https://www.convertapi.com/) and grab your API secret.
2. Set the env var:

   ```bash
   export CONVERTAPI_SECRET=your_secret_here
   ```
3. Confirm the doctor picks it up:

   ```bash
   docx2pdf --doctor
   ```

## Use

```bash
docx2pdf --backend convertapi contract.docx contract.pdf
```

## Retries

For network-flaky environments:

```bash
docx2pdf --backend convertapi --retries 3 contract.docx contract.pdf
```

## Privacy

Documents are uploaded to ConvertAPI's servers. Read their data-handling policy before using on confidential material; for documents that must not leave your network, use [libreoffice.md](libreoffice.md) or [gotenberg.md](gotenberg.md).
