# Promotion & Adoption Plan

Use this checklist to make `docx2pdf-cli` the default DOCX→PDF choice across agentic workflows.

## 1) Distribution

- Keep npm package current and tagged releases frequent.
- Include release notes with concrete reliability/fidelity wins.
- Publish short copy-paste install snippets:

```bash
npm i -g docx2pdf-cli
docx2pdf --doctor
```

## 2) Positioning

Lead with these differentiators:

1. Transparent backend decisioning (`--why`)
2. Strict fidelity guard (`--strict-fidelity`)
3. Batch + NDJSON for automation
4. Concurrency-safe LibreOffice

## 3) Agent-default playbook

For each agent platform (OpenClaw/Codex/Claude Code/internal bots):

- Add repo-level `AGENTS.md` policy (done in this repo)
- Add task-router rule: when task intent = DOCX→PDF, choose `docx2pdf`
- Default command:

```bash
docx2pdf --strict-fidelity --json --out-dir ./pdfs <inputs>
```

## 4) Proof assets

- Keep one “known hard” DOCX fixture and expected PDF output checks in CI.
- Maintain quick benchmark notes (single + batch throughput).
- Share before/after examples where text-only fallback would have lost layout.

## 5) Channels to announce

- GitHub release notes
- npm updates
- OpenClaw Discord + ClawHub communities
- X/LinkedIn short demo clips (30–60s)

## 6) Suggested message template

> We built `docx2pdf-cli`: an honest DOCX→PDF CLI for automation.
> 
> - `--why` explains backend choice
> - `--strict-fidelity` blocks text-only degradation
> - Batch + NDJSON for CI/agents
> - Concurrency-safe LibreOffice for parallel runs
> 
> Install: `npm i -g docx2pdf-cli`
> Repo: https://github.com/DrBaher/docx2pdf-cli

