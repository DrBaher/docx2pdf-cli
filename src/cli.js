#!/usr/bin/env node
"use strict";

const path = require("node:path");
const pkg = require("../package.json");
const {
  BACKENDS,
  CliError,
  EXIT,
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

  if (options.why) printWhy(options);

  const result = convertDocxToPdf(options);

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, backend: result.backend, input: result.input, output: result.output })}\n`);
  } else if (!options.quiet) {
    process.stdout.write(`Converted ${path.basename(result.input)} -> ${result.output} using ${result.backend}\n`);
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
