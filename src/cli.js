#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const pkg = require("../package.json");
const {
  BACKENDS,
  CliError,
  EXIT,
  INSTALL_HINTS,
  checkFonts,
  convertDocxToPdf,
  expandInputs,
  parseArgs,
  usageText,
  getAvailableBackends,
  getBackendDiagnostics,
  getBackendReasons,
  selectBackend
} = require("./index");

function buildChildArgs(options, inputPath, outDirAbs) {
  const args = ["--json", "--quiet", "--out-dir", outDirAbs];
  if (options.backend !== "auto") args.push("--backend", options.backend);
  if (options.strictFidelity) args.push("--strict-fidelity");
  if (options.overwrite) args.push("--overwrite");
  if (options.timeoutSeconds !== 120) args.push("--timeout-seconds", String(options.timeoutSeconds));
  if (options.retries !== 0) args.push("--retries", String(options.retries));
  args.push(inputPath);
  return args;
}

function spawnChild(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [__filename, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString("utf8"); });
    child.stderr.on("data", (d) => { stderr += d.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

async function runParallel(inputs, options, outDirAbs, willUseLOEngine) {
  const concurrency = Math.min(options.concurrency, inputs.length);
  const results = new Array(inputs.length);
  let next = 0;

  async function worker() {
    while (true) {
      const idx = next++;
      if (idx >= inputs.length) return;
      const inputPath = inputs[idx];

      if (willUseLOEngine && !options.quiet) {
        const fc = checkFonts(inputPath);
        if (fc.available && fc.missing.length) {
          const list = fc.missing.slice(0, 5).join(", ");
          const more = fc.missing.length > 5 ? `, ... +${fc.missing.length - 5} more` : "";
          process.stderr.write(`Warning: ${path.basename(inputPath)}: ${fc.missing.length} font(s) not installed (${list}${more}); LibreOffice will substitute.\n`);
        }
      }

      const childArgs = buildChildArgs(options, inputPath, outDirAbs);
      const r = await spawnChild(childArgs);
      let parsed = null;
      const line = r.stdout.trim().split("\n").pop();
      if (line) {
        try { parsed = JSON.parse(line); } catch { /* fallthrough to error */ }
      }
      if (parsed) {
        results[idx] = parsed;
      } else {
        const message = r.stderr.trim() || `child exited with status ${r.status}`;
        results[idx] = { ok: false, input: inputPath, error: message, exitCode: r.status || EXIT.CONVERT_FAIL };
      }
    }
  }

  const workers = Array(concurrency).fill(0).map(() => worker());
  await Promise.all(workers);

  let firstFailureExit = 0;
  for (const result of results) {
    if (result.ok) {
      if (options.json) {
        process.stdout.write(`${JSON.stringify({ ...result, ok: true })}\n`);
      } else {
        process.stdout.write(`Converted ${path.basename(result.input)} -> ${result.output} using ${result.backend}\n`);
      }
    } else {
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result)}\n`);
      } else if (!options.quiet) {
        process.stderr.write(`Failed: ${result.input}: ${result.error}\n`);
      }
      if (firstFailureExit === 0) firstFailureExit = result.exitCode || EXIT.CONVERT_FAIL;
    }
  }
  return firstFailureExit;
}

function printWhy(options) {
  const reasons = getBackendReasons();
  const available = getAvailableBackends();
  let selected = null;
  try {
    selected = selectBackend(options.backend, available, { strict: options.strictFidelity });
  } catch {
    // selection failure will be re-raised by convertDocxToPdf with a clearer error
  }
  process.stderr.write("Backend selection:\n");
  for (const b of BACKENDS) {
    const marker = b === selected ? "[SELECTED]" : "          ";
    process.stderr.write(`  ${marker} ${b} — ${reasons[b]}\n`);
  }
  process.stderr.write("\n");
}

function getCatalog() {
  // Machine-readable flag inventory, parallel to sign-cli's `sign --catalog json`
  // and nda-review-cli's `nda-review-cli --catalog json`. Each flag describes
  // its long form, type, default, what it does, and (when applicable) the
  // enumerated values it accepts. Agents call this at startup rather than
  // parsing --help text.
  return {
    name: "docx2pdf-cli",
    bin: "docx2pdf",
    version: pkg.version,
    description: "Honest, batch-aware DOCX → PDF converter with hybrid backends.",
    usage: [
      "docx2pdf [options] <input.docx> [output.pdf]",
      "docx2pdf [options] --out-dir <dir> <input.docx>..."
    ],
    flags: [
      { name: "--backend", type: "string", default: "auto", choices: ["auto", ...BACKENDS], help: "Backend to use. `auto` walks the order until one is available." },
      { name: "--strict-fidelity", type: "boolean", default: false, help: "In auto mode, refuse to fall back to the text-only backend." },
      { name: "--out-dir", type: "string", default: null, help: "Write outputs to <dir>/<basename>.pdf (enables batch mode)." },
      { name: "--concurrency", type: "number", default: 1, help: "Run up to N conversions in parallel in batch mode." },
      { name: "--retries", type: "number", default: 0, help: "Retry failed network backends (gotenberg/convertapi) N times with non-busy backoff." },
      { name: "--timeout-seconds", type: "number", default: 120, help: "Conversion timeout per file (seconds)." },
      { name: "--overwrite", aliases: ["--force"], type: "boolean", default: false, help: "Replace existing output file." },
      { name: "--quiet", aliases: ["-q"], type: "boolean", default: false, help: "Suppress success output (errors still print)." },
      { name: "--json", type: "boolean", default: false, help: "Emit machine-readable JSON. NDJSON in batch mode; per-file telemetry includes outputBytes + durationMs on success and exitCode on failure." },
      { name: "--why", type: "boolean", default: false, help: "Print backend-selection reasoning to stderr before converting." },
      { name: "--check-fonts", type: "boolean", default: false, help: "Report missing fonts referenced by the document. Requires unzip + fc-list." },
      { name: "--list-backends", type: "boolean", default: false, help: "Print available backends and exit." },
      { name: "--doctor", type: "boolean", default: false, help: "Print structured host-readiness JSON and exit. Schema: schemas/doctor.schema.json." },
      { name: "--capabilities", type: "boolean", default: false, help: "Print machine-readable capability contract and exit. Schema: schemas/capabilities.schema.json." },
      { name: "--catalog", type: "string", choices: ["json"], default: null, help: "Print this catalog and exit. Stable across minor versions — agents call at startup." },
      { name: "--help", aliases: ["-h"], type: "boolean", default: false, help: "Show usage and exit." },
      { name: "--version", aliases: ["-v"], type: "boolean", default: false, help: "Print package version and exit." }
    ],
    exitCodes: {
      "0": "success",
      "2": "usage_or_bad_arguments",
      "3": "backend_unavailable (error.kind: NO_BACKEND)",
      "4": "conversion_failed"
    },
    discovery: {
      capabilities: "docx2pdf --capabilities",
      doctor: "docx2pdf --doctor",
      catalog: "docx2pdf --catalog json"
    }
  };
}

function getCapabilities() {
  return {
    capabilitySpecVersion: "1.0.0",
    tool: "docx2pdf-cli",
    version: pkg.version,
    intent: "convert_docx_to_pdf",
    defaultForIntent: true,
    io: {
      inputExtensions: [".docx"],
      outputExtensions: [".pdf"]
    },
    modes: {
      single: "docx2pdf --strict-fidelity <input.docx> <output.pdf>",
      batch: "docx2pdf --strict-fidelity --json --out-dir <dir> <inputs...>"
    },
    supports: {
      nonInteractive: true,
      json: true,
      ndjsonBatch: true,
      strictFidelity: true,
      retries: true,
      backendExplain: true,
      fontPreflight: true,
      parallelBatch: true
    },
    backends: BACKENDS,
    backendFidelity: {
      libreoffice: "high",
      gotenberg: "high",
      convertapi: "high",
      pages: "high",
      word: "high",
      "textutil-cups": "text-only"
    },
    policies: {
      recommendedDefault: "docx2pdf --strict-fidelity --json --out-dir <dir> <inputs...>",
      neverSilentlyDropStrictFidelity: true
    },
    exitCodes: {
      0: "success",
      2: "usage_or_bad_arguments",
      3: "backend_unavailable",
      4: "conversion_failed"
    }
  };
}

function main(argv) {
  if (argv[0] === "demo") return runDemo();

  const options = parseArgs(argv);

  if (options.help) {
    process.stdout.write(`${usageText()}\n`);
    return 0;
  }

  if (options.version) {
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }

  if (options.listBackends) {
    const available = getAvailableBackends();
    process.stdout.write(`Auto order: libreoffice -> gotenberg -> convertapi -> pages -> word -> textutil-cups\n`);
    process.stdout.write(`Available: ${available.length ? available.join(", ") : "none"}\n`);
    return available.length ? 0 : EXIT.MISSING_DEP;
  }

  if (options.doctor) {
    const d = getBackendDiagnostics();
    process.stdout.write(`${JSON.stringify(d, null, 2)}\n`);
    if (!d.availableBackends.length) {
      process.stdout.write("Hint: install LibreOffice or enable macOS Automation permission for Pages/Word.\n");
      return EXIT.MISSING_DEP;
    }
    return 0;
  }

  if (options.capabilities) {
    process.stdout.write(`${JSON.stringify(getCapabilities(), null, 2)}\n`);
    return 0;
  }

  if (options.catalog) {
    if (options.catalog !== "json") {
      process.stderr.write(`Unknown --catalog format '${options.catalog}'. Supported: json\n`);
      return EXIT.USAGE;
    }
    process.stdout.write(`${JSON.stringify(getCatalog(), null, 2)}\n`);
    return 0;
  }

  if (options.checkFonts) {
    const inputs = expandInputs(options.inputs);
    let allUnavailable = true;
    let lastUnavailableReason = null;
    for (let idx = 0; idx < inputs.length; idx += 1) {
      const input = inputs[idx];
      const fc = checkFonts(input);
      if (!fc.available) {
        lastUnavailableReason = fc.reason;
        if (options.json) {
          process.stdout.write(`${JSON.stringify({ input, available: false, reason: fc.reason })}\n`);
        } else {
          process.stderr.write(`Cannot check fonts for ${path.basename(input)}: ${fc.reason}\n`);
        }
        continue;
      }
      allUnavailable = false;
      if (options.json) {
        process.stdout.write(`${JSON.stringify({ input, all: fc.all, missing: fc.missing })}\n`);
        continue;
      }
      if (idx > 0) process.stdout.write("\n");
      process.stdout.write(`Fonts in ${path.basename(input)}:\n`);
      if (fc.all.length === 0) {
        process.stdout.write("  (no fontTable.xml entries — DOCX may not declare any fonts)\n");
      } else {
        const missingSet = new Set(fc.missing);
        for (const f of fc.all) {
          process.stdout.write(`  [${missingSet.has(f) ? "MISSING" : "ok     "}] ${f}\n`);
        }
      }
      if (fc.missing.length) {
        process.stdout.write(`\n${fc.missing.length} font(s) not installed; LibreOffice/Gotenberg will substitute them silently.\n`);
      }
    }
    if (allUnavailable && lastUnavailableReason !== null) return EXIT.MISSING_DEP;
    return 0;
  }

  // Pipe mode: `-` as input reads a DOCX from stdin; `-` as output (or a bare
  // `docx2pdf -`) streams the PDF to stdout. Single-file only.
  const inputIsStdin = options.input === "-";
  const outputIsStdout = options.output === "-" || (inputIsStdin && !options.output);
  if (!options.outDir && (inputIsStdin || outputIsStdout)) {
    if ((options.inputs || []).length > 1) {
      process.stderr.write("stdin '-' supports a single input only.\n");
      return EXIT.USAGE;
    }
    if (options.why) printWhy(options);
    return runPipe(options, inputIsStdin, outputIsStdout);
  }

  if (options.why) printWhy(options);

  let plannedBackend = null;
  try {
    plannedBackend = selectBackend(options.backend, getAvailableBackends(), { strict: options.strictFidelity });
  } catch {
    // selection failure will surface inside convertDocxToPdf
  }
  const willUseLOEngine = plannedBackend === "libreoffice" || plannedBackend === "gotenberg";

  const inputs = options.outDir ? expandInputs(options.inputs) : options.inputs;
  const isBatch = inputs.length > 1 || options.outDir != null;
  const outDirAbs = options.outDir ? path.resolve(options.outDir) : null;

  if (options.concurrency > 1 && inputs.length > 1) {
    return runParallel(inputs, options, outDirAbs, willUseLOEngine);
  }

  const failures = [];
  for (const inputPath of inputs) {
    const output = outDirAbs
      ? path.join(outDirAbs, `${path.basename(inputPath, path.extname(inputPath))}.pdf`)
      : options.output;
    try {
      const startedAt = Date.now();
      if (willUseLOEngine && !options.quiet) {
        const fc = checkFonts(inputPath);
        if (fc.available && fc.missing.length) {
          const list = fc.missing.slice(0, 5).join(", ");
          const more = fc.missing.length > 5 ? `, ... +${fc.missing.length - 5} more` : "";
          process.stderr.write(`Warning: ${path.basename(inputPath)}: ${fc.missing.length} font(s) not installed (${list}${more}); LibreOffice will substitute.\n`);
        }
      }
      const result = convertDocxToPdf({ ...options, input: inputPath, output });
      const outputBytes = fs.statSync(result.output).size;
      const durationMs = Date.now() - startedAt;
      if (options.json) {
        process.stdout.write(`${JSON.stringify({ ok: true, backend: result.backend, input: result.input, output: result.output, outputBytes, durationMs })}\n`);
      } else if (!options.quiet) {
        process.stdout.write(`Converted ${path.basename(result.input)} -> ${result.output} using ${result.backend}\n`);
      }
    } catch (err) {
      if (!isBatch) throw err;
      failures.push({ input: inputPath, err });
      if (options.json) {
        process.stdout.write(`${JSON.stringify({ ok: false, input: inputPath, error: err.message, exitCode: err.exitCode || EXIT.CONVERT_FAIL })}\n`);
      } else if (!options.quiet) {
        process.stderr.write(`Failed: ${inputPath}: ${err.message}\n`);
      }
    }
  }

  if (failures.length) {
    const firstWithExit = failures.find(f => f.err && typeof f.err.exitCode === "number");
    return firstWithExit ? firstWithExit.err.exitCode : EXIT.CONVERT_FAIL;
  }
  return 0;
}

function printSetupHelp() {
  const d = getBackendDiagnostics();
  const lines = [];
  lines.push("");
  if (d.recommendation) {
    lines.push(`Recommended next step on ${d.platformKey}:`);
    lines.push(`  ${d.recommendation.backend} — ${d.recommendation.rationale}`);
    lines.push(`  Run: ${d.recommendation.command}`);
    lines.push("");
  }
  lines.push("All install options:");
  for (const b of BACKENDS) {
    const info = d.backends[b];
    if (info.available) continue;
    if (!info.install) continue;
    const tag = info.fidelity === "high" ? "" : " (text-only)";
    lines.push(`  • ${b}${tag}: ${info.install}`);
  }
  lines.push("");
  lines.push("After installing, re-run the same command. For full diagnostics");
  lines.push("(JSON, agent-friendly): docx2pdf --doctor");
  process.stderr.write(lines.join("\n") + "\n");
}

// Zero-config first run: convert a bundled sample DOCX to PDF using whatever
// backend is installed. If none is, explain what to install (the conversion
// itself is backend-dependent, so the demo is best-effort by design).
function runDemo() {
  const os = require("node:os");
  const sampleSrc = path.join(__dirname, "demo-sample.docx");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-demo-"));
  const input = path.join(tmpDir, "sample.docx");
  fs.copyFileSync(sampleSrc, input);

  process.stderr.write("docx2pdf demo — converting a bundled sample DOCX to PDF.\n");

  if (!getAvailableBackends().length) {
    process.stderr.write("\nNo PDF backend is installed yet, so the demo can't render the sample.\n");
    printSetupHelp();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    return EXIT.MISSING_DEP;
  }

  const output = path.join(tmpDir, "sample.pdf");
  try {
    const result = convertDocxToPdf({ input, output, backend: "auto", overwrite: true });
    const bytes = fs.statSync(result.output).size;
    process.stdout.write(`\n✓ Converted the sample DOCX to PDF (${bytes} bytes) via the '${result.backend}' backend.\n`);
    process.stdout.write(`  ${result.output}\n`);
    process.stdout.write("\nNow try your own file:\n  docx2pdf your.docx out.pdf\n  docx2pdf --doctor            # see all detected backends\n");
    return 0;
  } catch (err) {
    process.stderr.write(`\nDemo conversion failed: ${err.message}\n`);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    return err.exitCode || EXIT.CONVERT_FAIL;
  }
}

// Single-file conversion with stdin and/or stdout. Backends need a real file
// on disk, so stdin is buffered to a temp .docx and stdout output is rendered
// to a temp .pdf then streamed out. Temp files are always cleaned up.
function runPipe(options, inputIsStdin, outputIsStdout) {
  const os = require("node:os");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-pipe-"));
  try {
    let input = options.input;
    if (inputIsStdin) {
      const buf = fs.readFileSync(0); // fd 0 = stdin, read synchronously
      if (!buf.length) {
        process.stderr.write("No data on stdin (expected a .docx stream for '-').\n");
        return EXIT.USAGE;
      }
      input = path.join(tmpDir, "input.docx");
      fs.writeFileSync(input, buf);
    }
    const output = outputIsStdout ? path.join(tmpDir, "output.pdf") : path.resolve(options.output);
    const result = convertDocxToPdf({
      ...options,
      input,
      output,
      overwrite: outputIsStdout ? true : options.overwrite
    });
    if (outputIsStdout) {
      // Write synchronously to fd 1 so the full PDF drains before the process
      // exits — process.stdout.write() can truncate a large buffer on a slow pipe.
      const pdfBuf = fs.readFileSync(result.output);
      let offset = 0;
      while (offset < pdfBuf.length) {
        offset += fs.writeSync(1, pdfBuf, offset, pdfBuf.length - offset);
      }
      if (!options.quiet) {
        process.stderr.write(`Converted ${inputIsStdin ? "(stdin)" : path.basename(result.input)} -> stdout using ${result.backend}\n`);
      }
    } else {
      const bytes = fs.statSync(result.output).size;
      if (options.json) {
        process.stdout.write(`${JSON.stringify({ ok: true, backend: result.backend, input: inputIsStdin ? "-" : result.input, output: result.output, outputBytes: bytes })}\n`);
      } else if (!options.quiet) {
        process.stdout.write(`Converted ${inputIsStdin ? "(stdin)" : path.basename(result.input)} -> ${result.output} using ${result.backend}\n`);
      }
    }
    return 0;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

if (require.main === module) {
  Promise.resolve()
    .then(() => main(process.argv.slice(2)))
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      if (error instanceof CliError) {
        process.stderr.write(`${error.message}\n`);
        if (error.kind === "NO_BACKEND") printSetupHelp();
        process.exitCode = error.exitCode;
      } else {
        process.stderr.write(`${error.stack || String(error)}\n`);
        process.exitCode = 1;
      }
    });
}

module.exports = { main };
