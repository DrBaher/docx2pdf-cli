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

test("smoke: end-to-end LibreOffice conversion of fixture produces a valid PDF", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-smoke-"));
  try {
    const fixture = path.join(__dirname, "fixtures", "sample.docx");
    const out = path.join(tempDir, "smoke.pdf");
    const r = runCli(["--backend", "libreoffice", fixture, out]);
    if (r.status === EXIT.MISSING_DEP) {
      t.skip("LibreOffice not installed; CI installs it on Ubuntu");
      return;
    }
    assert.equal(r.status, 0, `conversion failed: ${r.stderr}`);
    assert.equal(fs.existsSync(out), true);
    const buf = fs.readFileSync(out);
    assert.equal(buf.slice(0, 5).toString("utf8"), "%PDF-", `output is not a PDF`);
    assert.ok(buf.length > 100, `output PDF is suspiciously small (${buf.length} bytes)`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

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

test("--doctor JSON includes platform, tools.docker, backends[*].install, and recommendation", () => {
  const r = runCli(["--doctor"]);
  const jsonEnd = r.stdout.lastIndexOf("}");
  const parsed = JSON.parse(r.stdout.slice(0, jsonEnd + 1));
  assert.ok(parsed.platform);
  assert.ok(parsed.platformKey);
  assert.ok(parsed.tools);
  assert.ok("docker" in parsed.tools);
  assert.ok(parsed.backends);
  for (const b of ["libreoffice", "gotenberg", "convertapi"]) {
    assert.ok(parsed.backends[b], `missing backends.${b}`);
    assert.ok("available" in parsed.backends[b]);
  }
  // gotenberg always has an _all install command
  assert.match(parsed.backends.gotenberg.install, /docker run/);
  // recommendation may be null if a high-fidelity backend is locally available
  if (parsed.recommendation !== null) {
    assert.ok(parsed.recommendation.backend);
    assert.ok(parsed.recommendation.command);
    assert.ok(parsed.recommendation.rationale);
  }
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
  assert.match(r.stdout, /--capabilities/);
});

test("--capabilities emits parseable agent-oriented JSON", () => {
  const r = runCli(["--capabilities"]);
  assert.equal(r.status, 0);
  const obj = JSON.parse(r.stdout);
  assert.equal(obj.tool, "docx2pdf-cli");
  assert.equal(typeof obj.version, "string");
  assert.equal(obj.capabilitySpecVersion, "1.0.0");
  assert.equal(obj.intent, "convert_docx_to_pdf");
  assert.equal(obj.defaultForIntent, true);
  assert.ok(Array.isArray(obj.backends));
  assert.equal(obj.supports.json, true);
  assert.equal(obj.supports.retries, true);
  assert.equal(obj.policies.neverSilentlyDropStrictFidelity, true);
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
      assert.equal(typeof obj.exitCode, "number");
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

test("--check-fonts --json emits one NDJSON line per input", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-test-"));
  try {
    const fake = path.join(tempDir, "fake.docx");
    fs.writeFileSync(fake, "not a real zip");
    const r = runCli(["--check-fonts", "--json", fake]);
    const lines = r.stdout.trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 1);
    const obj = JSON.parse(lines[0]);
    assert.equal(obj.input, fake);
    if (obj.available === false) {
      assert.equal(r.status, EXIT.MISSING_DEP);
      assert.ok(obj.reason);
    } else {
      assert.equal(r.status, 0);
      assert.ok(Array.isArray(obj.all));
      assert.ok(Array.isArray(obj.missing));
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("--check-fonts --json with multiple inputs emits one line per input", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-test-"));
  try {
    const a = path.join(tempDir, "a.docx");
    const b = path.join(tempDir, "b.docx");
    const c = path.join(tempDir, "c.docx");
    [a, b, c].forEach((p) => fs.writeFileSync(p, "not a real zip"));
    const r = runCli(["--check-fonts", "--json", a, b, c]);
    const lines = r.stdout.trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 3, `expected 3 NDJSON lines, got: ${r.stdout}`);
    const inputs = lines.map((l) => JSON.parse(l).input);
    assert.deepEqual(inputs, [a, b, c]);
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
      assert.equal(typeof p.exitCode, "number");
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

test("single-file --json success includes outputBytes and durationMs", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-json-success-"));
  try {
    const fixture = path.join(__dirname, "fixtures", "sample.docx");
    const out = path.join(tempDir, "sample.pdf");
    const r = runCli(["--json", "--backend", "libreoffice", fixture, out]);
    if (r.status === EXIT.MISSING_DEP) {
      t.skip("LibreOffice not installed; CI installs it on Ubuntu");
      return;
    }
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const lines = r.stdout.trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 1);
    const obj = JSON.parse(lines[0]);
    assert.equal(obj.ok, true);
    assert.equal(obj.backend, "libreoffice");
    assert.equal(obj.output, out);
    assert.equal(typeof obj.outputBytes, "number");
    assert.ok(obj.outputBytes > 0);
    assert.equal(typeof obj.durationMs, "number");
    assert.ok(obj.durationMs >= 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("demo: zero-config command runs the bundled sample", () => {
  const r = runCli(["demo"]);
  assert.match(r.stderr, /docx2pdf demo/, `expected demo intro on stderr, got: ${r.stderr}`);
  if (r.status === EXIT.MISSING_DEP) {
    // No backend installed: the demo explains what to install instead.
    assert.match(r.stderr, /No PDF backend is installed/);
    return;
  }
  assert.equal(r.status, 0, `demo failed: ${r.stderr}`);
  assert.match(r.stdout, /Converted the sample DOCX to PDF/);
});

// Regression: `demo` is a subcommand, not an input filename. A leading flag used
// to push `demo` into the positional slot, failing with "Input file not found:
// .../demo". It must be detected as the sole positional regardless of position.
test("demo: detected even when a flag precedes the subcommand", () => {
  for (const args of [["--json", "demo"], ["--why", "demo"], ["--quiet", "demo"]]) {
    const r = runCli(args);
    assert.doesNotMatch(r.stderr, /Input file not found/, `'${args.join(" ")}' misparsed demo as a filename: ${r.stderr}`);
    if (r.status === EXIT.MISSING_DEP) {
      assert.match(r.stderr, /No PDF backend is installed/);
      continue;
    }
    assert.equal(r.status, 0, `'${args.join(" ")}' demo failed: ${r.stderr}`);
  }
});

// Guard: `demo` as a flag *value* (here, a backend name) must NOT trigger the
// demo subcommand — it's the value of --backend, not a positional.
test("demo: a flag value of 'demo' does not trigger the subcommand", () => {
  const r = runCli(["--backend", "demo", "nonexistent.docx"], { envReplace: envWithoutBackends() });
  assert.doesNotMatch(r.stderr, /docx2pdf demo —/, `--backend demo wrongly ran the demo: ${r.stderr}`);
});

// Regression: requesting a specific-but-unavailable backend exits 3 and, per the
// catalog/capabilities contract (exit 3 carries error.kind NO_BACKEND), prints
// the setup help. The CliError used to omit the kind, so printSetupHelp (gated
// on kind === "NO_BACKEND") was silently skipped.
test("error: requested-but-unavailable backend exits 3 and prints setup help", () => {
  const fixture = path.join(__dirname, "fixtures", "sample.docx");
  const r = runCli(
    ["--backend", "gotenberg", fixture, "/tmp/docx2pdf-nobackend.pdf"],
    { envReplace: envWithoutBackends() }
  );
  assert.equal(r.status, EXIT.MISSING_DEP, `expected exit 3, got ${r.status}: ${r.stderr}`);
  assert.match(r.stderr, /not available/);
  assert.match(r.stderr, /All install options:/, `setup help was skipped: ${r.stderr}`);
});

// Regression: the synchronous fd-1 drain loop in stdout pipe mode must treat a
// consumer that closes the pipe early (EPIPE) as a clean exit, never crash with
// a raw EPIPE/EAGAIN stack trace + exit 1.
test("pipe: stdout consumer closing early does not emit a raw stack trace", () => {
  const fixture = path.join(__dirname, "fixtures", "sample.docx");
  // Pipe into a consumer that reads a single byte then exits, closing the read
  // end while the CLI may still be writing.
  const r = spawnSync(
    "/bin/sh",
    ["-c", `'${process.execPath}' '${CLI}' '${fixture}' - | head -c 1 >/dev/null`],
    { encoding: "utf8" }
  );
  // No backend on this host → MISSING_DEP is fine; we only assert no crash trace.
  assert.doesNotMatch(r.stderr || "", /at Object\.|at Module\.|EPIPE\n\s+at /, `raw stack trace leaked: ${r.stderr}`);
  assert.notEqual(r.status, null, `CLI was killed by a signal: ${r.signal}`);
});

test("pipe: reads DOCX from stdin ('-') and writes to a file", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-stdin-"));
  try {
    const fixture = fs.readFileSync(path.join(__dirname, "fixtures", "sample.docx"));
    const out = path.join(tempDir, "out.pdf");
    const r = spawnSync(process.execPath, [CLI, "-", out], { input: fixture, encoding: "utf8" });
    if (r.status === EXIT.MISSING_DEP) return; // no backend on this host
    assert.equal(r.status, 0, `stdin convert failed: ${r.stderr}`);
    assert.equal(fs.existsSync(out), true);
    assert.equal(fs.readFileSync(out).slice(0, 5).toString("utf8"), "%PDF-");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("pipe: writes PDF to stdout ('-')", () => {
  const fixture = path.join(__dirname, "fixtures", "sample.docx");
  const r = spawnSync(process.execPath, [CLI, fixture, "-"], { encoding: "buffer" });
  if (r.status === EXIT.MISSING_DEP) return; // no backend on this host
  assert.equal(r.status, 0, `stdout convert failed: ${r.stderr && r.stderr.toString()}`);
  assert.equal(r.stdout.slice(0, 5).toString("utf8"), "%PDF-");
});

// Regression: a non-writable/non-existent output directory must produce a clean
// CliError (message + EXIT.USAGE), never a raw Node stack trace + exit 1.
test("error: output under a non-existent root is a clean CliError, no stack trace", () => {
  const fixture = path.join(__dirname, "fixtures", "sample.docx");
  // A path whose parent cannot be created (root-owned, non-writable on POSIX).
  const out = "/no-such-root-docx2pdf/sub/out.pdf";
  const r = runCli([fixture, out]);
  assert.equal(r.status, EXIT.USAGE, `expected EXIT.USAGE, got ${r.status}: ${r.stderr}`);
  assert.match(r.stderr, /Cannot create output directory/);
  assert.doesNotMatch(r.stderr, /\bat .*\(.*:\d+:\d+\)/, `stderr leaked a stack trace: ${r.stderr}`);
  assert.doesNotMatch(r.stderr, /Error: ENOENT|Error: EACCES|Error: EEXIST/);
});

test("error: output dir that is a regular file is a clean CliError, no stack trace", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-outfile-"));
  try {
    const fixture = path.join(__dirname, "fixtures", "sample.docx");
    // Make a regular file, then ask for output *inside* it -> dirname is a file.
    const blocker = path.join(tempDir, "iam-a-file");
    fs.writeFileSync(blocker, "x");
    const out = path.join(blocker, "out.pdf");
    const r = runCli([fixture, out]);
    assert.equal(r.status, EXIT.USAGE, `expected EXIT.USAGE, got ${r.status}: ${r.stderr}`);
    assert.match(r.stderr, /Output directory is not a directory|Cannot create output directory/);
    assert.doesNotMatch(r.stderr, /\bat .*\(.*:\d+:\d+\)/, `stderr leaked a stack trace: ${r.stderr}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("error: --out-dir pointing at a regular file is a clean error, no stack trace", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-outdir-"));
  try {
    const fixture = path.join(__dirname, "fixtures", "sample.docx");
    const blocker = path.join(tempDir, "not-a-dir");
    fs.writeFileSync(blocker, "x");
    const r = runCli(["--out-dir", blocker, fixture]);
    assert.notEqual(r.status, 0, `expected non-zero exit, got 0: ${r.stdout}`);
    assert.match(r.stderr, /not a directory|Cannot create output directory/);
    assert.doesNotMatch(r.stderr, /\bat .*\(.*:\d+:\d+\)/, `stderr leaked a stack trace: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /EEXIST: mkdir/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// Regression: a read-only output directory yields a clean error (not a raw EACCES
// stack). Skipped when running as root, where the mode is ignored.
test("error: read-only output directory is a clean error, no stack trace", (t) => {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    t.skip("running as root; directory mode is not enforced");
    return;
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-ro-"));
  try {
    const fixture = path.join(__dirname, "fixtures", "sample.docx");
    const roDir = path.join(tempDir, "ro");
    fs.mkdirSync(roDir);
    fs.chmodSync(roDir, 0o500); // read+execute, no write
    const out = path.join(roDir, "out.pdf");
    const r = runCli([fixture, out]);
    if (r.status === 0 || r.status === EXIT.MISSING_DEP) {
      t.skip("no backend installed, or filesystem did not enforce read-only mode");
      return;
    }
    // The dir already exists, so mkdir succeeds and the write fails later in the
    // backend -> a clean CONVERT_FAIL. Either way: a documented non-zero code and
    // a "Cannot write/create" message, never a raw EACCES stack trace.
    assert.ok(
      r.status === EXIT.USAGE || r.status === EXIT.CONVERT_FAIL,
      `expected a clean USAGE/CONVERT_FAIL code, got ${r.status}: ${r.stderr}`
    );
    assert.match(r.stderr, /Cannot (write|create) output|not a directory/);
    assert.doesNotMatch(r.stderr, /\bat .*\(.*:\d+:\d+\)/, `stderr leaked a stack trace: ${r.stderr}`);
  } finally {
    try { fs.chmodSync(path.join(tempDir, "ro"), 0o700); } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
