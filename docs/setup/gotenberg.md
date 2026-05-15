# Gotenberg backend

LibreOffice in a Docker container, exposed as an HTTP API. Same engine, same fidelity as the local LibreOffice backend, but zero system mutation and consistent output across a fleet.

## Run

```bash
docker run --rm -d -p 3000:3000 gotenberg/gotenberg:8
export GOTENBERG_URL=http://127.0.0.1:3000
docx2pdf --backend gotenberg contract.docx contract.pdf
```

That's it. The doctor probe will start picking `gotenberg` automatically once `GOTENBERG_URL` is set.

## Persistent server

For a fleet that all hits the same server, run Gotenberg behind a reverse proxy:

```bash
docker run -d --name gotenberg --restart unless-stopped \
  -p 3000:3000 gotenberg/gotenberg:8
```

Then point every client at the shared URL via env or a per-call `--backend-config gotenbergUrl=https://gotenberg.internal`.

## Retries

For network-flaky environments, pass `--retries N`:

```bash
docx2pdf --backend gotenberg --retries 3 --strict-fidelity contract.docx contract.pdf
```

The retry uses non-busy backoff (`Atomics.wait`) so it doesn't spin CPU during the delay. `--capabilities` advertises this via `supports.retries: true`.

## Cleanup

`docker run --rm -d` runs detached. The container lives until reboot or explicit stop:

```bash
docker ps | grep gotenberg
docker stop <container-id>
```

## When to use this over LibreOffice

| Scenario | Pick |
|---|---|
| Single developer machine, willing to install 700 MB | LibreOffice |
| Single developer machine, Docker already installed | Gotenberg |
| Fleet of agents/CI workers | Gotenberg (one server, deterministic output) |
| Air-gapped network | LibreOffice |
| Need to scale conversion throughput horizontally | Gotenberg behind a load balancer |
