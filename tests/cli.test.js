"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  BACKEND_FIDELITY,
  BACKENDS,
  CliError,
  INSTALL_HINTS,
  checkFonts,
  computeRecommendation,
  convertDocxToPdf,
  convertWithLibreOffice,
  convertWithGotenberg,
  convertWithConvertApi,
  EXIT,
  expandIfGlob,
  expandInputs,
  fontFamilyMatches,
  getAvailableBackends,
  getBackendDiagnostics,
  getBackendReasons,
  getInstallCommand,
  listDocxFonts,
  listSystemFonts,
  parseArgs,
  resolvePaths,
  selectBackend
} = require("../src/index");

test("parseArgs parses input, output, backend, and overwrite", () => {
  const parsed = parseArgs([
    "--backend",
    "textutil-cups",
    "--overwrite",
    "input.docx",
    "output.pdf"
  ]);

  assert.equal(parsed.backend, "textutil-cups");
  assert.equal(parsed.overwrite, true);
  assert.equal(parsed.input, "input.docx");
  assert.equal(parsed.output, "output.pdf");
});

test("parseArgs rejects unknown options", () => {
  assert.throws(() => parseArgs(["--wat", "input.docx"]), CliError);
});

test("resolvePaths defaults output next to input", () => {
  const resolved = resolvePaths("/tmp/demo.docx");
  assert.equal(resolved.output, "/tmp/demo.pdf");
});

test("selectBackend prefers the first available backend in auto mode", () => {
  assert.equal(selectBackend("auto", ["pages", "textutil-cups"]), "pages");
});

test("getAvailableBackends detects command-backed fallback", () => {
  const calls = [];
  const runner = (command, args) => {
    calls.push([command, args]);

    if (command === "sh" && args[1].includes("osascript")) {
      return { status: 0, stdout: "/usr/bin/osascript\n", stderr: "" };
    }

    if (command === "osascript") {
      return { status: 1, stdout: "", stderr: "missing app" };
    }

    if (command === "sh" && args[1].includes("textutil")) {
      return { status: 0, stdout: "/usr/bin/textutil\n", stderr: "" };
    }

    if (command === "sh" && args[1].includes("cupsfilter")) {
      return { status: 0, stdout: "/usr/sbin/cupsfilter\n", stderr: "" };
    }

    throw new Error(`Unexpected call: ${command} ${args.join(" ")}`);
  };

  assert.deepEqual(getAvailableBackends(runner), ["textutil-cups"]);
  assert.ok(calls.length > 0);
});

test("convertDocxToPdf writes a PDF with textutil-cups backend", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-test-"));

  try {
    const input = path.join(tempDir, "sample.docx");
    const output = path.join(tempDir, "sample.pdf");
    fs.writeFileSync(input, "placeholder");

    const runner = (command, args, options = {}) => {
      if (command === "sh" && args[1].includes("osascript")) {
        return { status: 0, stdout: "/usr/bin/osascript\n", stderr: "" };
      }

      if (command === "osascript") {
        return { status: 1, stdout: "", stderr: "missing app" };
      }

      if (command === "sh" && args[1].includes("textutil")) {
        return { status: 0, stdout: "/usr/bin/textutil\n", stderr: "" };
      }

      if (command === "sh" && args[1].includes("cupsfilter")) {
        return { status: 0, stdout: "/usr/sbin/cupsfilter\n", stderr: "" };
      }

      if (command === "textutil") {
        assert.deepEqual(args, ["-convert", "txt", "-stdout", input]);
        return { status: 0, stdout: "Hello from docx\n", stderr: "" };
      }

      if (command === "cupsfilter") {
        assert.deepEqual(args.slice(0, 2), ["-m", "application/pdf"]);
        assert.equal(options.encoding, "buffer");
        return { status: 0, stdout: Buffer.from("%PDF-1.4\nfake\n"), stderr: Buffer.alloc(0) };
      }

      throw new Error(`Unexpected call: ${command} ${args.join(" ")}`);
    };

    const result = convertDocxToPdf({ input, output, backend: "textutil-cups" }, runner);

    assert.equal(result.backend, "textutil-cups");
    assert.equal(fs.existsSync(output), true);
    assert.match(fs.readFileSync(output, "utf8"), /%PDF-1.4/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("parseArgs rejects --backend with no value", () => {
  assert.throws(() => parseArgs(["--backend"]), /Missing value after --backend/);
});

test("parseArgs rejects unsupported backend at selection time", () => {
  assert.throws(() => selectBackend("nope", []), /Unsupported backend/);
});

test("selectBackend errors when requested backend is unavailable", () => {
  assert.throws(() => selectBackend("pages", ["textutil-cups"]), /not available/);
});

test("selectBackend errors in auto mode with no available backends", () => {
  assert.throws(() => selectBackend("auto", []), /No conversion backend available/);
});

test("parseArgs rejects non-numeric --timeout-seconds", () => {
  assert.throws(() => parseArgs(["--timeout-seconds", "soon", "in.docx"]), /Missing numeric value/);
});

test("parseArgs rejects zero or negative --timeout-seconds", () => {
  assert.throws(() => parseArgs(["--timeout-seconds=0", "in.docx"]), /must be > 0/);
});

test("parseArgs rejects 3+ positional args without --out-dir", () => {
  assert.throws(() => parseArgs(["a.docx", "b.pdf", "extra"]), /Multiple inputs require --out-dir/);
});

test("parseArgs accepts multiple inputs with --out-dir", () => {
  const o = parseArgs(["--out-dir", "/tmp/pdfs", "a.docx", "b.docx", "c.docx"]);
  assert.deepEqual(o.inputs, ["a.docx", "b.docx", "c.docx"]);
  assert.equal(o.outDir, "/tmp/pdfs");
  assert.equal(o.output, null);
});

test("parseArgs single input + --out-dir routes through batch path", () => {
  const o = parseArgs(["--out-dir", "/tmp/pdfs", "a.docx"]);
  assert.deepEqual(o.inputs, ["a.docx"]);
  assert.equal(o.outDir, "/tmp/pdfs");
});

test("parseArgs --out-dir with no value errors", () => {
  assert.throws(() => parseArgs(["--out-dir"]), /Missing value after --out-dir/);
});

test("parseArgs rejects no positional args", () => {
  assert.throws(() => parseArgs([]), /Usage:/);
});

test("parseArgs accepts --help without positional args", () => {
  const o = parseArgs(["--help"]);
  assert.equal(o.help, true);
});

test("parseArgs accepts equals form for --backend and --timeout-seconds", () => {
  const o = parseArgs(["--backend=pages", "--timeout-seconds=30", "in.docx"]);
  assert.equal(o.backend, "pages");
  assert.equal(o.timeoutSeconds, 30);
});

test("parseArgs accepts --retries and validates non-negative integer", () => {
  const o = parseArgs(["--retries", "2", "in.docx"]);
  assert.equal(o.retries, 2);
  assert.throws(() => parseArgs(["--retries", "-1", "in.docx"]), /non-negative integer/);
});

test("convertWithLibreOffice writes into tmpdir then moves into place", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-test-"));
  try {
    const input = path.join(tempDir, "sample.docx");
    const output = path.join(tempDir, "renamed.pdf");
    fs.writeFileSync(input, "placeholder");

    let capturedOutdir = null;
    const runner = (command, args) => {
      if (command === "sh" && args[1].includes("soffice")) {
        return { status: 0, stdout: "/usr/bin/soffice\n", stderr: "" };
      }
      if (command === "soffice") {
        const idx = args.indexOf("--outdir");
        capturedOutdir = args[idx + 1];
        const generated = path.join(capturedOutdir, "sample.pdf");
        fs.writeFileSync(generated, "%PDF-1.4\nfake\n");
        return { status: 0, stdout: "", stderr: "" };
      }
      throw new Error(`Unexpected call: ${command} ${args.join(" ")}`);
    };

    convertWithLibreOffice(input, output, runner, 1000);

    assert.ok(capturedOutdir, "soffice should have been invoked with --outdir");
    assert.notEqual(capturedOutdir, path.dirname(output), "outdir must be a tmpdir, not the output dir");
    assert.equal(fs.existsSync(output), true);
    assert.match(fs.readFileSync(output, "utf8"), /%PDF-1.4/);
    assert.equal(fs.existsSync(capturedOutdir), false, "tmpdir must be cleaned up");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("convertWithLibreOffice passes a per-call -env:UserInstallation profile dir", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-test-"));
  try {
    const input = path.join(tempDir, "sample.docx");
    fs.writeFileSync(input, "placeholder");

    const profilesSeen = [];
    const runConvert = (output) => {
      const runner = (command, args) => {
        if (command === "sh" && args[1].includes("soffice")) {
          return { status: 0, stdout: "/usr/bin/soffice\n", stderr: "" };
        }
        if (command === "soffice") {
          const envArg = args.find(a => a.startsWith("-env:UserInstallation="));
          assert.ok(envArg, "soffice must receive -env:UserInstallation=...");
          assert.match(envArg, /^-env:UserInstallation=file:\/\//);
          profilesSeen.push(envArg);
          const idx = args.indexOf("--outdir");
          const generated = path.join(args[idx + 1], "sample.pdf");
          fs.writeFileSync(generated, "%PDF-1.4\nfake\n");
          return { status: 0, stdout: "", stderr: "" };
        }
        throw new Error(`Unexpected call: ${command} ${args.join(" ")}`);
      };
      convertWithLibreOffice(input, output, runner, 1000);
    };

    runConvert(path.join(tempDir, "out1.pdf"));
    runConvert(path.join(tempDir, "out2.pdf"));

    assert.equal(profilesSeen.length, 2);
    assert.notEqual(profilesSeen[0], profilesSeen[1], "each call must use a fresh profile dir");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("convertWithLibreOffice surfaces stderr on failure", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-test-"));
  try {
    const input = path.join(tempDir, "sample.docx");
    const output = path.join(tempDir, "sample.pdf");
    fs.writeFileSync(input, "placeholder");

    const runner = (command, args) => {
      if (command === "sh" && args[1].includes("soffice")) {
        return { status: 0, stdout: "/usr/bin/soffice\n", stderr: "" };
      }
      if (command === "soffice") {
        return { status: 1, stdout: "", stderr: "boom: corrupt document\n" };
      }
      throw new Error(`Unexpected call: ${command} ${args.join(" ")}`);
    };

    assert.throws(
      () => convertWithLibreOffice(input, output, runner, 1000),
      /LibreOffice conversion failed: boom: corrupt document/
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("convertWithGotenberg errors when GOTENBERG_URL is unset", () => {
  const previous = process.env.GOTENBERG_URL;
  delete process.env.GOTENBERG_URL;
  try {
    assert.throws(
      () => convertWithGotenberg("in.docx", "out.pdf", () => { throw new Error("runner should not be called"); }, 1000),
      (err) => err instanceof CliError && err.exitCode === EXIT.MISSING_DEP && /GOTENBERG_URL is required/.test(err.message)
    );
  } finally {
    if (previous !== undefined) process.env.GOTENBERG_URL = previous;
  }
});

test("convertWithGotenberg trims trailing slashes from base URL", () => {
  const previous = process.env.GOTENBERG_URL;
  process.env.GOTENBERG_URL = "http://example.test:3000///";
  try {
    let captured = null;
    const runner = (command, args) => {
      if (command === "curl") {
        captured = args;
        return { status: 0, stdout: "", stderr: "" };
      }
      throw new Error(`Unexpected call: ${command}`);
    };
    convertWithGotenberg("in.docx", "out.pdf", runner, 1000);
    const endpoint = captured[captured.indexOf("POST") + 1];
    assert.equal(endpoint, "http://example.test:3000/forms/libreoffice/convert");
    assert.ok(captured.includes("-fL"), "curl must use -fL to fail on HTTP errors");
  } finally {
    if (previous === undefined) delete process.env.GOTENBERG_URL;
    else process.env.GOTENBERG_URL = previous;
  }
});

test("convertWithGotenberg cleans up partial output on HTTP failure", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-test-"));
  const previous = process.env.GOTENBERG_URL;
  process.env.GOTENBERG_URL = "http://example.test:3000";
  try {
    const output = path.join(tempDir, "out.pdf");
    const runner = (command) => {
      if (command === "curl") {
        fs.writeFileSync(output, "partial");
        return { status: 22, stdout: "", stderr: "The requested URL returned error: 500\n" };
      }
      throw new Error(`Unexpected call: ${command}`);
    };
    assert.throws(
      () => convertWithGotenberg("in.docx", output, runner, 1000),
      /Gotenberg conversion failed/
    );
    assert.equal(fs.existsSync(output), false, "partial output must be removed");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.GOTENBERG_URL;
    else process.env.GOTENBERG_URL = previous;
  }
});

test("convertWithGotenberg retries transient failures", () => {
  const previous = process.env.GOTENBERG_URL;
  process.env.GOTENBERG_URL = "http://127.0.0.1:3000";
  const calls = [];
  try {
    const runner = (command, args) => {
      calls.push([command, args]);
      if (calls.length < 3) return { status: 22, stdout: "", stderr: "http fail" };
      return { status: 0, stdout: "", stderr: "" };
    };
    convertWithGotenberg("in.docx", "out.pdf", runner, 1000, 2);
    assert.equal(calls.length, 3);
  } finally {
    if (previous === undefined) delete process.env.GOTENBERG_URL;
    else process.env.GOTENBERG_URL = previous;
  }
});

test("convertWithConvertApi errors when CONVERTAPI_SECRET is unset", () => {
  const previous = process.env.CONVERTAPI_SECRET;
  delete process.env.CONVERTAPI_SECRET;
  try {
    assert.throws(
      () => convertWithConvertApi("in.docx", "out.pdf", () => { throw new Error("runner should not be called"); }, 1000),
      (err) => err instanceof CliError && err.exitCode === EXIT.MISSING_DEP && /CONVERTAPI_SECRET is required/.test(err.message)
    );
  } finally {
    if (previous !== undefined) process.env.CONVERTAPI_SECRET = previous;
  }
});

test("convertWithConvertApi sends secret via Authorization header, not URL", () => {
  const previous = process.env.CONVERTAPI_SECRET;
  process.env.CONVERTAPI_SECRET = "s3cret-token";
  try {
    const calls = [];
    const runner = (command, args) => {
      calls.push(args);
      if (calls.length === 1) {
        return { status: 0, stdout: JSON.stringify({ Files: [{ Url: "https://example.test/out.pdf" }] }), stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };
    convertWithConvertApi("in.docx", "out.pdf", runner, 1000);

    const post = calls[0];
    const url = post[post.indexOf("POST") + 1];
    assert.equal(url, "https://v2.convertapi.com/convert/docx/to/pdf");
    assert.ok(!url.includes("s3cret-token"), "secret must not appear in URL");
    assert.ok(!post.some(a => typeof a === "string" && a.includes("Secret=")), "no Secret= form/query");
    const headerIdx = post.indexOf("-H");
    assert.notEqual(headerIdx, -1);
    assert.equal(post[headerIdx + 1], "Authorization: Bearer s3cret-token");
    assert.ok(post.includes("-f"), "curl must use -f to fail on HTTP errors");

    const dl = calls[1];
    assert.ok(dl.includes("-fL"));
    assert.ok(dl.includes("https://example.test/out.pdf"));
  } finally {
    if (previous === undefined) delete process.env.CONVERTAPI_SECRET;
    else process.env.CONVERTAPI_SECRET = previous;
  }
});

test("convertWithConvertApi errors on invalid JSON response", () => {
  const previous = process.env.CONVERTAPI_SECRET;
  process.env.CONVERTAPI_SECRET = "x";
  try {
    const runner = () => ({ status: 0, stdout: "<html>not json</html>", stderr: "" });
    assert.throws(
      () => convertWithConvertApi("in.docx", "out.pdf", runner, 1000),
      /invalid JSON/
    );
  } finally {
    if (previous === undefined) delete process.env.CONVERTAPI_SECRET;
    else process.env.CONVERTAPI_SECRET = previous;
  }
});

test("convertWithConvertApi errors when response is missing file URL", () => {
  const previous = process.env.CONVERTAPI_SECRET;
  process.env.CONVERTAPI_SECRET = "x";
  try {
    const runner = () => ({ status: 0, stdout: JSON.stringify({ Files: [] }), stderr: "" });
    assert.throws(
      () => convertWithConvertApi("in.docx", "out.pdf", runner, 1000),
      /missing output URL/
    );
  } finally {
    if (previous === undefined) delete process.env.CONVERTAPI_SECRET;
    else process.env.CONVERTAPI_SECRET = previous;
  }
});

test("BACKEND_FIDELITY tags textutil-cups as text-only and others as high", () => {
  assert.equal(BACKEND_FIDELITY["textutil-cups"], "text-only");
  for (const b of ["libreoffice", "gotenberg", "convertapi", "pages", "word"]) {
    assert.equal(BACKEND_FIDELITY[b], "high", `${b} should be high fidelity`);
  }
});

test("selectBackend with strict excludes text-only fallbacks", () => {
  assert.equal(
    selectBackend("auto", ["libreoffice", "textutil-cups"], { strict: true }),
    "libreoffice"
  );
});

test("selectBackend with strict errors when only text-only available", () => {
  assert.throws(
    () => selectBackend("auto", ["textutil-cups"], { strict: true }),
    /No high-fidelity backend available/
  );
});

test("selectBackend with strict still errors when nothing available", () => {
  assert.throws(
    () => selectBackend("auto", [], { strict: true }),
    /No conversion backend available/
  );
});

test("selectBackend without strict still picks textutil-cups in auto mode", () => {
  assert.equal(selectBackend("auto", ["textutil-cups"]), "textutil-cups");
});

test("selectBackend with strict still honors explicit non-auto request", () => {
  assert.equal(
    selectBackend("textutil-cups", ["textutil-cups"], { strict: true }),
    "textutil-cups"
  );
});

test("getBackendDiagnostics memoizes commandExists/appScriptable probes within one call", () => {
  const probeCounts = {};
  const runner = (command, args) => {
    if (command === "sh") {
      const m = args[1].match(/command -v '([^']+)'/);
      const probed = m ? m[1] : "?";
      probeCounts[`cmd:${probed}`] = (probeCounts[`cmd:${probed}`] || 0) + 1;
      return { status: 0, stdout: "/usr/bin/" + probed + "\n", stderr: "" };
    }
    if (command === "osascript") {
      const m = args[1].match(/id of application "([^"]+)"/);
      const probed = m ? m[1] : "?";
      probeCounts[`app:${probed}`] = (probeCounts[`app:${probed}`] || 0) + 1;
      return { status: 1, stdout: "", stderr: "missing app" };
    }
    throw new Error(`Unexpected: ${command}`);
  };

  const previous = {
    go: process.env.GOTENBERG_URL,
    ca: process.env.CONVERTAPI_SECRET
  };
  process.env.GOTENBERG_URL = "http://test.local:3000";
  process.env.CONVERTAPI_SECRET = "x";
  try {
    const { getBackendDiagnostics } = require("../src/index");
    getBackendDiagnostics(runner);
    // Each unique probe should be counted exactly once even though
    // the high-level call uses each repeatedly.
    for (const [probe, count] of Object.entries(probeCounts)) {
      assert.equal(count, 1, `probe ${probe} ran ${count} times — should have been cached at 1`);
    }
  } finally {
    if (previous.go === undefined) delete process.env.GOTENBERG_URL;
    else process.env.GOTENBERG_URL = previous.go;
    if (previous.ca === undefined) delete process.env.CONVERTAPI_SECRET;
    else process.env.CONVERTAPI_SECRET = previous.ca;
  }
});

test("getBackendReasons returns a reason string for every known backend", () => {
  const runner = (command, args) => {
    if (command === "sh" && args[1].includes("osascript")) return { status: 0, stdout: "/usr/bin/osascript\n", stderr: "" };
    if (command === "osascript") return { status: 1, stdout: "", stderr: "missing app" };
    if (command === "sh") return { status: 1, stdout: "", stderr: "" };
    return { status: 1, stdout: "", stderr: "" };
  };
  const reasons = getBackendReasons(runner);
  for (const b of ["libreoffice", "gotenberg", "convertapi", "pages", "word", "textutil-cups"]) {
    assert.ok(typeof reasons[b] === "string" && reasons[b].length > 0, `missing reason for ${b}`);
  }
});

test("getBackendReasons reports gotenberg env-driven activation", () => {
  const previous = process.env.GOTENBERG_URL;
  process.env.GOTENBERG_URL = "http://test.local:3000";
  try {
    const runner = (command) => {
      if (command === "sh") return { status: 0, stdout: "/usr/bin/curl\n", stderr: "" };
      return { status: 1, stdout: "", stderr: "" };
    };
    const reasons = getBackendReasons(runner);
    assert.match(reasons.gotenberg, /available/);
    assert.match(reasons.gotenberg, /test\.local:3000/);
  } finally {
    if (previous === undefined) delete process.env.GOTENBERG_URL;
    else process.env.GOTENBERG_URL = previous;
  }
});

test("getBackendReasons explains why convertapi is skipped without secret", () => {
  const previous = process.env.CONVERTAPI_SECRET;
  delete process.env.CONVERTAPI_SECRET;
  try {
    const reasons = getBackendReasons(() => ({ status: 1, stdout: "", stderr: "" }));
    assert.match(reasons.convertapi, /CONVERTAPI_SECRET/);
  } finally {
    if (previous !== undefined) process.env.CONVERTAPI_SECRET = previous;
  }
});

test("parseArgs accepts --quiet, -q, --json, --why, --strict-fidelity flags", () => {
  const o1 = parseArgs(["--quiet", "--json", "--why", "--strict-fidelity", "in.docx"]);
  assert.equal(o1.quiet, true);
  assert.equal(o1.json, true);
  assert.equal(o1.why, true);
  assert.equal(o1.strictFidelity, true);
  const o2 = parseArgs(["-q", "in.docx"]);
  assert.equal(o2.quiet, true);
});

test("convertDocxToPdf passes strictFidelity through to selectBackend", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-test-"));
  try {
    const input = path.join(tempDir, "sample.docx");
    const output = path.join(tempDir, "sample.pdf");
    fs.writeFileSync(input, "placeholder");

    const previous = {
      go: process.env.GOTENBERG_URL,
      ca: process.env.CONVERTAPI_SECRET
    };
    delete process.env.GOTENBERG_URL;
    delete process.env.CONVERTAPI_SECRET;

    try {
      const runner = (command, args) => {
        if (command === "sh" && args[1].includes("soffice")) return { status: 1, stdout: "", stderr: "" };
        if (command === "sh" && args[1].includes("lowriter")) return { status: 1, stdout: "", stderr: "" };
        if (command === "sh" && args[1].includes("osascript")) return { status: 0, stdout: "/usr/bin/osascript\n", stderr: "" };
        if (command === "osascript") return { status: 1, stdout: "", stderr: "" };
        if (command === "sh" && args[1].includes("textutil")) return { status: 0, stdout: "/usr/bin/textutil\n", stderr: "" };
        if (command === "sh" && args[1].includes("cupsfilter")) return { status: 0, stdout: "/usr/sbin/cupsfilter\n", stderr: "" };
        return { status: 1, stdout: "", stderr: "" };
      };
      assert.throws(
        () => convertDocxToPdf({ input, output, backend: "auto", strictFidelity: true }, runner),
        /No high-fidelity backend available/
      );
    } finally {
      if (previous.go !== undefined) process.env.GOTENBERG_URL = previous.go;
      if (previous.ca !== undefined) process.env.CONVERTAPI_SECRET = previous.ca;
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("listDocxFonts returns null when unzip is missing", () => {
  const runner = (command, args) => {
    if (command === "sh" && args[1].includes("unzip")) return { status: 1, stdout: "", stderr: "" };
    return { status: 1, stdout: "", stderr: "" };
  };
  assert.equal(listDocxFonts("/whatever.docx", runner), null);
});

test("listDocxFonts parses font names from fontTable.xml", () => {
  const xml = `<?xml version="1.0"?>
<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:font w:name="Calibri"><w:panose1 w:val="020F0502020204030204"/></w:font>
  <w:font w:name="Times New Roman"><w:panose1 w:val="02020603050405020304"/></w:font>
  <w:font w:name="Cambria"/>
</w:fonts>`;
  const runner = (command, args) => {
    if (command === "sh" && args[1].includes("unzip")) return { status: 0, stdout: "/usr/bin/unzip\n", stderr: "" };
    if (command === "unzip") return { status: 0, stdout: xml, stderr: "" };
    throw new Error(`Unexpected: ${command}`);
  };
  const fonts = listDocxFonts("/some.docx", runner);
  assert.deepEqual(fonts.sort(), ["Calibri", "Cambria", "Times New Roman"]);
});

test("listDocxFonts returns empty array when fontTable.xml is missing from archive", () => {
  const runner = (command, args) => {
    if (command === "sh" && args[1].includes("unzip")) return { status: 0, stdout: "/usr/bin/unzip\n", stderr: "" };
    if (command === "unzip") return { status: 11, stdout: "", stderr: "no such file in archive" };
    throw new Error(`Unexpected: ${command}`);
  };
  assert.deepEqual(listDocxFonts("/some.docx", runner), []);
});

test("listSystemFonts returns null when fc-list is missing", () => {
  const runner = () => ({ status: 1, stdout: "", stderr: "" });
  assert.equal(listSystemFonts(runner), null);
});

test("listSystemFonts parses comma-separated family aliases case-insensitively", () => {
  const runner = (command, args) => {
    if (command === "sh" && args[1].includes("fc-list")) return { status: 0, stdout: "/usr/bin/fc-list\n", stderr: "" };
    if (command === "fc-list") return { status: 0, stdout: "Helvetica\nTimes,Times Regular\nArial\n", stderr: "" };
    throw new Error(`Unexpected: ${command}`);
  };
  const fonts = listSystemFonts(runner);
  assert.ok(fonts.has("helvetica"));
  assert.ok(fonts.has("times"));
  assert.ok(fonts.has("times regular"));
  assert.ok(fonts.has("arial"));
});

test("fontFamilyMatches matches exactly when present", () => {
  const sys = new Set(["calibri", "times new roman"]);
  assert.equal(fontFamilyMatches("Calibri", sys), true);
  assert.equal(fontFamilyMatches("Times New Roman", sys), true);
});

test("fontFamilyMatches strips standard weight/style suffixes", () => {
  const sys = new Set(["calibri", "times new roman", "arial"]);
  assert.equal(fontFamilyMatches("Calibri Light", sys), true);
  assert.equal(fontFamilyMatches("Calibri Bold", sys), true);
  assert.equal(fontFamilyMatches("Times New Roman Bold Italic", sys), true);
  assert.equal(fontFamilyMatches("Arial Black", sys), true);
});

test("fontFamilyMatches does NOT match different family names that look like suffixes", () => {
  const sys = new Set(["helvetica"]);
  // "Helvetica Neue" is a different family — Neue is not a recognized weight/style suffix
  assert.equal(fontFamilyMatches("Helvetica Neue", sys), false);
});

test("fontFamilyMatches returns false when family not installed at all", () => {
  const sys = new Set(["arial"]);
  assert.equal(fontFamilyMatches("Calibri", sys), false);
  assert.equal(fontFamilyMatches("Calibri Light", sys), false);
});

test("checkFonts reports missing fonts case-insensitively", () => {
  const xml = `<w:fonts><w:font w:name="Calibri"/><w:font w:name="Helvetica"/></w:fonts>`;
  const runner = (command, args) => {
    if (command === "sh" && args[1].includes("unzip")) return { status: 0, stdout: "/usr/bin/unzip\n", stderr: "" };
    if (command === "sh" && args[1].includes("fc-list")) return { status: 0, stdout: "/usr/bin/fc-list\n", stderr: "" };
    if (command === "unzip") return { status: 0, stdout: xml, stderr: "" };
    if (command === "fc-list") return { status: 0, stdout: "helvetica\nTimes\n", stderr: "" };
    throw new Error(`Unexpected: ${command}`);
  };
  const result = checkFonts("/some.docx", runner);
  assert.equal(result.available, true);
  assert.deepEqual(result.all.sort(), ["Calibri", "Helvetica"]);
  assert.deepEqual(result.missing, ["Calibri"]);
});

test("checkFonts marks unavailable when unzip is missing", () => {
  const runner = () => ({ status: 1, stdout: "", stderr: "" });
  const result = checkFonts("/some.docx", runner);
  assert.equal(result.available, false);
  assert.match(result.reason, /unzip/);
});

test("checkFonts marks unavailable when fc-list is missing but lists docx fonts", () => {
  const xml = `<w:fonts><w:font w:name="Calibri"/></w:fonts>`;
  const runner = (command, args) => {
    if (command === "sh" && args[1].includes("unzip")) return { status: 0, stdout: "/usr/bin/unzip\n", stderr: "" };
    if (command === "sh" && args[1].includes("fc-list")) return { status: 1, stdout: "", stderr: "" };
    if (command === "unzip") return { status: 0, stdout: xml, stderr: "" };
    throw new Error(`Unexpected: ${command}`);
  };
  const result = checkFonts("/some.docx", runner);
  assert.equal(result.available, false);
  assert.match(result.reason, /fc-list/);
  assert.deepEqual(result.all, ["Calibri"]);
});

test("parseArgs --check-fonts requires an input file", () => {
  assert.throws(() => parseArgs(["--check-fonts"]), /requires an input file/);
});

test("parseArgs --check-fonts populates input and inputs", () => {
  const o = parseArgs(["--check-fonts", "doc.docx"]);
  assert.equal(o.checkFonts, true);
  assert.equal(o.input, "doc.docx");
  assert.deepEqual(o.inputs, ["doc.docx"]);
});

test("parseArgs --check-fonts accepts multiple inputs", () => {
  const o = parseArgs(["--check-fonts", "a.docx", "b.docx", "c.docx"]);
  assert.deepEqual(o.inputs, ["a.docx", "b.docx", "c.docx"]);
});

test("expandIfGlob returns literal when path exists", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-test-"));
  try {
    const file = path.join(tempDir, "exists.docx");
    fs.writeFileSync(file, "");
    assert.deepEqual(expandIfGlob(file), [file]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("expandIfGlob returns literal when no glob characters", () => {
  assert.deepEqual(expandIfGlob("/nope/does/not/exist.docx"), ["/nope/does/not/exist.docx"]);
});

test("expandIfGlob expands * to matching files in directory, sorted", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-test-"));
  try {
    fs.writeFileSync(path.join(tempDir, "c.docx"), "");
    fs.writeFileSync(path.join(tempDir, "a.docx"), "");
    fs.writeFileSync(path.join(tempDir, "b.docx"), "");
    fs.writeFileSync(path.join(tempDir, "ignored.txt"), "");
    const matches = expandIfGlob(path.join(tempDir, "*.docx"));
    assert.deepEqual(matches, [
      path.join(tempDir, "a.docx"),
      path.join(tempDir, "b.docx"),
      path.join(tempDir, "c.docx")
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("expandIfGlob expands ? as single-char wildcard", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-test-"));
  try {
    fs.writeFileSync(path.join(tempDir, "ab.docx"), "");
    fs.writeFileSync(path.join(tempDir, "ac.docx"), "");
    fs.writeFileSync(path.join(tempDir, "abc.docx"), "");
    const matches = expandIfGlob(path.join(tempDir, "a?.docx"));
    assert.deepEqual(matches, [
      path.join(tempDir, "ab.docx"),
      path.join(tempDir, "ac.docx")
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("expandIfGlob preserves the literal pattern when no matches", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-test-"));
  try {
    const pattern = path.join(tempDir, "*.docx");
    assert.deepEqual(expandIfGlob(pattern), [pattern]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("expandIfGlob preserves the literal pattern when directory does not exist", () => {
  const pattern = "/nope/does/not/*.docx";
  assert.deepEqual(expandIfGlob(pattern), [pattern]);
});

test("expandInputs preserves order across multiple positional args", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-test-"));
  try {
    fs.writeFileSync(path.join(tempDir, "a.docx"), "");
    fs.writeFileSync(path.join(tempDir, "b.docx"), "");
    const literal = path.join(tempDir, "z-literal.docx");
    fs.writeFileSync(literal, "");
    const result = expandInputs([
      path.join(tempDir, "*.docx"),
      literal
    ]);
    assert.equal(result[0], path.join(tempDir, "a.docx"));
    assert.equal(result[1], path.join(tempDir, "b.docx"));
    assert.equal(result[2], literal);
    assert.equal(result[3], literal);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("parseArgs accepts --concurrency=N and --concurrency N", () => {
  const o1 = parseArgs(["--concurrency=4", "in.docx"]);
  assert.equal(o1.concurrency, 4);
  const o2 = parseArgs(["--concurrency", "8", "in.docx"]);
  assert.equal(o2.concurrency, 8);
});

test("parseArgs defaults --concurrency to 1", () => {
  const o = parseArgs(["in.docx"]);
  assert.equal(o.concurrency, 1);
});

test("parseArgs rejects --concurrency with non-positive or non-integer values", () => {
  assert.throws(() => parseArgs(["--concurrency=0", "in.docx"]), /positive integer/);
  assert.throws(() => parseArgs(["--concurrency=-2", "in.docx"]), /positive integer/);
  assert.throws(() => parseArgs(["--concurrency=1.5", "in.docx"]), /positive integer/);
});

test("parseArgs rejects --concurrency with no value", () => {
  assert.throws(() => parseArgs(["--concurrency"]), /Missing numeric value/);
});

test("convertDocxToPdf refuses overwrite without flag", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-test-"));

  try {
    const input = path.join(tempDir, "sample.docx");
    const output = path.join(tempDir, "sample.pdf");
    fs.writeFileSync(input, "placeholder");
    fs.writeFileSync(output, "existing");

    assert.throws(
      () => convertDocxToPdf({ input, output, backend: "textutil-cups" }, () => {
        throw new Error("runner should not be called");
      }),
      /Output file already exists/
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ----- Onboarding helpers -----

test("INSTALL_HINTS covers every backend with at least one platform key", () => {
  for (const b of BACKENDS) {
    const hints = INSTALL_HINTS[b];
    assert.ok(hints, `no INSTALL_HINTS for ${b}`);
    assert.ok(Object.keys(hints).length > 0, `${b} hints is empty`);
  }
});

test("getInstallCommand returns _all when present (gotenberg, convertapi)", () => {
  const r = () => ({ status: 0, stdout: "", stderr: "" });
  assert.match(getInstallCommand("gotenberg", r), /docker run/);
  assert.match(getInstallCommand("convertapi", r), /CONVERTAPI_SECRET/);
});

test("getInstallCommand picks platform-specific hint for libreoffice", () => {
  const r = () => ({ status: 0, stdout: "", stderr: "" });
  const cmd = getInstallCommand("libreoffice", r);
  if (process.platform === "darwin") {
    assert.match(cmd, /brew install --cask libreoffice/);
  }
});

test("computeRecommendation prefers Docker-Gotenberg when Docker is installed", () => {
  const rec = computeRecommendation({
    availableBackends: [],
    tools: { docker: true }
  });
  assert.equal(rec.backend, "gotenberg");
  assert.match(rec.command, /docker run/);
});

test("computeRecommendation falls back to libreoffice when no Docker and no high-fidelity backend", () => {
  const rec = computeRecommendation({
    availableBackends: [],
    tools: { docker: false }
  });
  assert.equal(rec.backend, "libreoffice");
});

test("computeRecommendation returns null when a high-fidelity backend already works", () => {
  const rec = computeRecommendation({
    availableBackends: ["libreoffice"],
    tools: { docker: false }
  });
  assert.equal(rec, null);
});

test("computeRecommendation still recommends when only text-only backend is available", () => {
  const rec = computeRecommendation({
    availableBackends: ["textutil-cups"],
    tools: { docker: false }
  });
  assert.notEqual(rec, null);
  assert.equal(rec.backend, "libreoffice");
});

test("getBackendDiagnostics includes tools.docker and backends[*].install", () => {
  const runner = (command, args) => {
    if (command === "sh" && args[1].includes("docker")) return { status: 0, stdout: "/usr/local/bin/docker\n", stderr: "" };
    if (command === "sh") return { status: 1, stdout: "", stderr: "" };
    if (command === "osascript") return { status: 1, stdout: "", stderr: "" };
    return { status: 1, stdout: "", stderr: "" };
  };
  const previous = { go: process.env.GOTENBERG_URL, ca: process.env.CONVERTAPI_SECRET };
  delete process.env.GOTENBERG_URL;
  delete process.env.CONVERTAPI_SECRET;
  try {
    const d = getBackendDiagnostics(runner);
    assert.equal(d.tools.docker, true);
    assert.equal(d.backends.libreoffice.available, false);
    assert.ok(d.backends.libreoffice.install, "libreoffice should have an install hint");
    assert.equal(d.backends.gotenberg.available, false);
    assert.ok(d.recommendation, "Docker present + nothing installed should yield a recommendation");
    assert.equal(d.recommendation.backend, "gotenberg");
    // backwards-compat: flat tool keys still present at the top level
    assert.equal(d.docker, true);
    assert.equal("soffice" in d, true);
    assert.equal("availableBackends" in d, true);
  } finally {
    if (previous.go !== undefined) process.env.GOTENBERG_URL = previous.go;
    if (previous.ca !== undefined) process.env.CONVERTAPI_SECRET = previous.ca;
  }
});

test("getBackendDiagnostics memoizes commandExists/appScriptable probes within one call", () => {
  const probeCounts = {};
  const runner = (command, args) => {
    if (command === "sh") {
      const m = args[1].match(/command -v '([^']+)'/);
      const probed = m ? m[1] : "?";
      probeCounts[`cmd:${probed}`] = (probeCounts[`cmd:${probed}`] || 0) + 1;
      return { status: 0, stdout: "/usr/bin/" + probed + "\n", stderr: "" };
    }
    if (command === "osascript") {
      const m = args[1].match(/id of application "([^"]+)"/);
      const probed = m ? m[1] : "?";
      probeCounts[`app:${probed}`] = (probeCounts[`app:${probed}`] || 0) + 1;
      return { status: 1, stdout: "", stderr: "missing app" };
    }
    throw new Error(`Unexpected: ${command}`);
  };
  const previous = { go: process.env.GOTENBERG_URL, ca: process.env.CONVERTAPI_SECRET };
  process.env.GOTENBERG_URL = "http://test.local:3000";
  process.env.CONVERTAPI_SECRET = "x";
  try {
    getBackendDiagnostics(runner);
    for (const [probe, count] of Object.entries(probeCounts)) {
      assert.equal(count, 1, `probe ${probe} ran ${count} times — should have been cached at 1`);
    }
  } finally {
    if (previous.go === undefined) delete process.env.GOTENBERG_URL;
    else process.env.GOTENBERG_URL = previous.go;
    if (previous.ca === undefined) delete process.env.CONVERTAPI_SECRET;
    else process.env.CONVERTAPI_SECRET = previous.ca;
  }
});

test("selectBackend tags 'NO_BACKEND' kind on CliError when no backends available", () => {
  try {
    selectBackend("auto", []);
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof CliError);
    assert.equal(err.kind, "NO_BACKEND");
  }
});

test("selectBackend tags 'NO_BACKEND' kind in strict mode with only text-only", () => {
  try {
    selectBackend("auto", ["textutil-cups"], { strict: true });
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof CliError);
    assert.equal(err.kind, "NO_BACKEND");
  }
});
