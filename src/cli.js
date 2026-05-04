#!/usr/bin/env node
"use strict";

const path = require("node:path");
const pkg = require("../package.json");
const {
  BACKENDS,
  CliError,
  EXIT,
  checkFonts,
  convertDocxToPdf,
  parseArgs,
  usageText,
  getAvailableBackends,
  getBackendDiagnostics,
  getBackendReasons,
  selectBackend
} = require("./index");

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

  if (options.checkFonts) {
    const fc = checkFonts(options.input);
    if (!fc.available) {
      process.stderr.write(`Cannot check fonts: ${fc.reason}\n`);
      return EXIT.MISSING_DEP;
    }
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ input: options.input, all: fc.all, missing: fc.missing })}\n`);
      return 0;
    }
    process.stdout.write(`Fonts in ${path.basename(options.input)}:\n`);
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

  const inputs = options.inputs;
  const isBatch = inputs.length > 1 || options.outDir != null;
  const outDirAbs = options.outDir ? path.resolve(options.outDir) : null;
  const failures = [];

  for (const inputPath of inputs) {
    const output = outDirAbs
      ? path.join(outDirAbs, `${path.basename(inputPath, path.extname(inputPath))}.pdf`)
      : options.output;
    try {
      if (willUseLOEngine && !options.quiet) {
        const fc = checkFonts(inputPath);
        if (fc.available && fc.missing.length) {
          const list = fc.missing.slice(0, 5).join(", ");
          const more = fc.missing.length > 5 ? `, ... +${fc.missing.length - 5} more` : "";
          process.stderr.write(`Warning: ${path.basename(inputPath)}: ${fc.missing.length} font(s) not installed (${list}${more}); LibreOffice will substitute.\n`);
        }
      }
      const result = convertDocxToPdf({ ...options, input: inputPath, output });
      if (options.json) {
        process.stdout.write(`${JSON.stringify({ ok: true, backend: result.backend, input: result.input, output: result.output })}\n`);
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

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = error.exitCode;
    } else {
      process.stderr.write(`${error.stack || String(error)}\n`);
      process.exitCode = 1;
    }
  }
}

module.exports = { main };
