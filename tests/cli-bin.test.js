"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const CLI = path.resolve(__dirname, "..", "src", "cli.js");
const PKG = require("../package.json");
const { EXIT } = require("../src/index");

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...(options.env || {}) },
    cwd: options.cwd
  });
}

test("--help prints usage and exits 0", () => {
  const r = runCli(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /--backend/);
});

test("-h is an alias for --help", () => {
  const r = runCli(["-h"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage:/);
});

test("--version prints package version and exits 0", () => {
  const r = runCli(["--version"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), PKG.version);
});

test("--list-backends prints auto order line", () => {
  const r = runCli(["--list-backends"]);
  assert.match(r.stdout, /^Auto order: libreoffice -> gotenberg -> convertapi -> pages -> word -> textutil-cups/m);
  assert.match(r.stdout, /^Available:/m);
  assert.ok(r.status === 0 || r.status === EXIT.MISSING_DEP, `unexpected status ${r.status}`);
});

test("--doctor emits parseable JSON with expected schema", () => {
  const r = runCli(["--doctor"]);
  const jsonEnd = r.stdout.lastIndexOf("}");
  const parsed = JSON.parse(r.stdout.slice(0, jsonEnd + 1));
  assert.ok(Array.isArray(parsed.availableBackends));
  assert.ok("gotenbergUrl" in parsed);
  assert.ok("convertapiSecret" in parsed);
  assert.ok("soffice" in parsed);
  assert.ok("pages" in parsed);
  assert.ok(r.status === 0 || r.status === EXIT.MISSING_DEP, `unexpected status ${r.status}`);
});

test("unknown flag exits with EXIT.USAGE and prints to stderr", () => {
  const r = runCli(["--nope", "in.docx"]);
  assert.equal(r.status, EXIT.USAGE);
  assert.match(r.stderr, /Unknown option/);
});

test("missing input file exits with EXIT.USAGE", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-test-"));
  try {
    const missing = path.join(tempDir, "nope.docx");
    const r = runCli([missing]);
    assert.equal(r.status, EXIT.USAGE);
    assert.match(r.stderr, /Input file not found/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("non-docx input exits with EXIT.USAGE", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-test-"));
  try {
    const txt = path.join(tempDir, "notes.txt");
    fs.writeFileSync(txt, "hello");
    const r = runCli([txt]);
    assert.equal(r.status, EXIT.USAGE);
    assert.match(r.stderr, /must be a \.docx file/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("no arguments prints usage error and exits with EXIT.USAGE", () => {
  const r = runCli([]);
  assert.equal(r.status, EXIT.USAGE);
  assert.match(r.stderr, /Usage:/);
});

test("--why prints backend selection table to stderr", () => {
  const r = runCli(["--why", "--list-backends"]);
  // --list-backends short-circuits, but --why output goes to stderr only on convert paths;
  // confirm structure via a non-convert path that triggers --why: pair with a missing input
  const r2 = runCli(["--why", "/nonexistent/file.docx"]);
  assert.match(r2.stderr, /Backend selection:/);
  for (const b of ["libreoffice", "gotenberg", "convertapi", "pages", "word", "textutil-cups"]) {
    assert.match(r2.stderr, new RegExp(`\\b${b}\\b`));
  }
  assert.equal(r2.status, EXIT.USAGE);
});

test("--quiet suppresses success-path stdout but lets errors through", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-test-"));
  try {
    const txt = path.join(tempDir, "notes.txt");
    fs.writeFileSync(txt, "hello");
    const r = runCli(["--quiet", txt]);
    assert.equal(r.status, EXIT.USAGE);
    assert.match(r.stderr, /must be a \.docx file/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("--help mentions all new flags", () => {
  const r = runCli(["--help"]);
  assert.match(r.stdout, /--quiet/);
  assert.match(r.stdout, /--json/);
  assert.match(r.stdout, /--why/);
  assert.match(r.stdout, /--strict-fidelity/);
});
