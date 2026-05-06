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
        const { exitCode, ...rest } = result;
        process.stdout.write(`${JSON.stringify(rest)}\n`);
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
        process.stdout.write(`${JSON.stringify({ ok: false, input: inputPath, error: err.message })}\n`);
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
