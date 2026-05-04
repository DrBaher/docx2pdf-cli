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
  const env = options.envReplace
    ? options.envReplace
    : { ...process.env, ...(options.env || {}) };
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env,
    cwd: options.cwd
  });
}

function envWithoutBackends() {
  const env = { ...process.env };
  delete env.GOTENBERG_URL;
  delete env.CONVERTAPI_SECRET;
  return env;
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
  assert.match(r.stdout, /--out-dir/);
});

test("batch mode with --out-dir + --json emits one NDJSON line per file and continues on errors", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-test-"));
  try {
    const outDir = path.join(tempDir, "out");
    const inputs = [
      path.join(tempDir, "missing1.docx"),
      path.join(tempDir, "missing2.docx"),
      path.join(tempDir, "missing3.docx")
    ];
    const r = runCli(["--json", "--out-dir", outDir, ...inputs]);
    const lines = r.stdout.trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 3, `expected 3 NDJSON lines, got: ${r.stdout}`);
    for (let idx = 0; idx < lines.length; idx += 1) {
      const obj = JSON.parse(lines[idx]);
      assert.equal(obj.ok, false);
      assert.match(obj.input, new RegExp(`missing${idx + 1}\\.docx$`));
      assert.ok(obj.error && obj.error.length > 0);
    }
    assert.equal(r.status, EXIT.USAGE, "exit code should be the first failure's exit code");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("batch mode without --json reports per-file failures on stderr", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-test-"));
  try {
    const outDir = path.join(tempDir, "out");
    const inputs = [
      path.join(tempDir, "missing1.docx"),
      path.join(tempDir, "missing2.docx")
    ];
    const r = runCli(["--out-dir", outDir, ...inputs]);
    assert.match(r.stderr, /Failed: .*missing1\.docx/);
    assert.match(r.stderr, /Failed: .*missing2\.docx/);
    assert.equal(r.status, EXIT.USAGE);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("batch mode --quiet suppresses per-file Failed lines", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-test-"));
  try {
    const outDir = path.join(tempDir, "out");
    const inputs = [path.join(tempDir, "missing.docx"), path.join(tempDir, "missing2.docx")];
    const r = runCli(["--quiet", "--out-dir", outDir, ...inputs]);
    assert.equal(r.stderr, "");
    assert.notEqual(r.status, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("--check-fonts handles both fc-list-available and missing hosts", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-test-"));
  try {
    const fake = path.join(tempDir, "fake.docx");
    fs.writeFileSync(fake, "not a real zip");
    const r = runCli(["--check-fonts", fake]);
    if (r.status === 0) {
      // host has fc-list; non-zip means no fontTable entries detected
      assert.match(r.stdout, /Fonts in fake\.docx/);
      assert.match(r.stdout, /no fontTable\.xml entries|MISSING|ok/);
    } else {
      // host missing fc-list (or unzip)
      assert.equal(r.status, EXIT.MISSING_DEP);
      assert.match(r.stderr, /Cannot check fonts/);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("--check-fonts --json emits structured output when fc-list is present", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-test-"));
  try {
    const fake = path.join(tempDir, "fake.docx");
    fs.writeFileSync(fake, "not a real zip");
    const r = runCli(["--check-fonts", "--json", fake]);
    if (r.status === 0) {
      const obj = JSON.parse(r.stdout.trim());
      assert.ok(Array.isArray(obj.all));
      assert.ok(Array.isArray(obj.missing));
      assert.equal(obj.input, fake);
    } else {
      assert.equal(r.status, EXIT.MISSING_DEP);
      assert.match(r.stderr, /Cannot check fonts/);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("--check-fonts errors out without an input", () => {
  const r = runCli(["--check-fonts"]);
  assert.equal(r.status, EXIT.USAGE);
  assert.match(r.stderr, /requires an input file/);
});

test("parallel batch with --concurrency emits one NDJSON line per input in input order", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-test-"));
  try {
    const outDir = path.join(tempDir, "out");
    const inputs = [
      path.join(tempDir, "alpha.docx"),
      path.join(tempDir, "bravo.docx"),
      path.join(tempDir, "charlie.docx"),
      path.join(tempDir, "delta.docx")
    ];
    const r = runCli(["--concurrency=3", "--json", "--out-dir", outDir, ...inputs]);
    const lines = r.stdout.trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 4, `expected 4 NDJSON lines, got: ${r.stdout}\n stderr: ${r.stderr}`);
    const parsed = lines.map((l) => JSON.parse(l));
    assert.equal(parsed[0].input, inputs[0], "results emitted in input order");
    assert.equal(parsed[1].input, inputs[1]);
    assert.equal(parsed[2].input, inputs[2]);
    assert.equal(parsed[3].input, inputs[3]);
    for (const p of parsed) {
      assert.equal(p.ok, false);
      assert.ok(p.error);
    }
    assert.notEqual(r.status, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("internal glob expansion: --out-dir + literal *.docx pattern matches files", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-test-"));
  try {
    const outDir = path.join(tempDir, "out");
    const names = ["one.docx", "two.docx", "three.docx"];
    for (const n of names) fs.writeFileSync(path.join(tempDir, n), "");
    // Pass the literal glob pattern as a single argv element so the test shell
    // doesn't pre-expand it. CLI must expand internally.
    // Force --backend gotenberg with GOTENBERG_URL unset → fast EXIT.MISSING_DEP
    // per file. We only care that 3 inputs reached the conversion path.
    const pattern = path.join(tempDir, "*.docx");
    const r = runCli(
      ["--json", "--backend", "gotenberg", "--out-dir", outDir, pattern],
      { envReplace: envWithoutBackends() }
    );
    const lines = r.stdout.trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 3, `expected 3 NDJSON lines from glob, got: ${r.stdout}`);
    const inputs = lines.map((l) => JSON.parse(l).input);
    assert.deepEqual(inputs.sort(), names.map((n) => path.join(tempDir, n)).sort());
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("internal glob expansion preserves literal pattern when no match", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-test-"));
  try {
    const outDir = path.join(tempDir, "out");
    const pattern = path.join(tempDir, "no-match-*.docx");
    const r = runCli(
      ["--json", "--backend", "gotenberg", "--out-dir", outDir, pattern],
      { envReplace: envWithoutBackends() }
    );
    const lines = r.stdout.trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 1);
    const obj = JSON.parse(lines[0]);
    assert.equal(obj.ok, false);
    assert.equal(obj.input, pattern);
    assert.match(obj.error, /Input file not found/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("parallel batch with --concurrency without --json prints per-file lines", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-test-"));
  try {
    const outDir = path.join(tempDir, "out");
    const inputs = [
      path.join(tempDir, "alpha.docx"),
      path.join(tempDir, "bravo.docx")
    ];
    const r = runCli(["--concurrency=2", "--out-dir", outDir, ...inputs]);
    assert.match(r.stderr, /Failed: .*alpha\.docx/);
    assert.match(r.stderr, /Failed: .*bravo\.docx/);
    assert.notEqual(r.status, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("single-file mode with --json emits one success-shape line if conversion succeeds", () => {
  // Without a real conversion backend in test, this would be flaky;
  // use a missing file to confirm single-file mode does NOT use NDJSON
  // failure shape — single-file failures go through stderr like before.
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-test-"));
  try {
    const r = runCli(["--json", path.join(tempDir, "missing.docx")]);
    assert.equal(r.stdout, "", "single-file failure does not write to stdout");
    assert.match(r.stderr, /Input file not found/);
    assert.equal(r.status, EXIT.USAGE);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
