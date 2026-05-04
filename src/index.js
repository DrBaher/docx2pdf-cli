"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const BACKENDS = ["libreoffice", "gotenberg", "convertapi", "pages", "word", "textutil-cups"];
const BACKEND_FIDELITY = {
  libreoffice: "high",
  gotenberg: "high",
  convertapi: "high",
  pages: "high",
  word: "high",
  "textutil-cups": "text-only"
};
const EXIT = { USAGE: 2, MISSING_DEP: 3, CONVERT_FAIL: 4 };

class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

function shellQuote(v) {
  return `'${String(v).replace(/'/g, `'\\''`)}'`;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: options.encoding === "buffer" ? null : "utf8",
    timeout: options.timeoutMs,
    input: options.input,
    maxBuffer: 20 * 1024 * 1024
  });
  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      throw new CliError(`Command timed out: ${command} ${args.join(" ")}`, EXIT.CONVERT_FAIL);
    }
    throw new CliError(`Failed to run '${command}': ${result.error.message}`, EXIT.CONVERT_FAIL);
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function commandExists(command, runner = runCommand) {
  try {
    return runner("sh", ["-lc", `command -v ${shellQuote(command)}`]).status === 0;
  } catch {
    return false;
  }
}

function appScriptable(appName, runner = runCommand) {
  if (!commandExists("osascript", runner)) return false;
  try {
    return runner("osascript", ["-e", `id of application \"${appName}\"`]).status === 0;
  } catch {
    return false;
  }
}

function getAvailableBackends(runner = runCommand) {
  const out = [];
  if (commandExists("soffice", runner) || commandExists("lowriter", runner)) out.push("libreoffice");
  if (process.env.GOTENBERG_URL && commandExists("curl", runner)) out.push("gotenberg");
  if (process.env.CONVERTAPI_SECRET && commandExists("curl", runner)) out.push("convertapi");
  if (appScriptable("Pages", runner)) out.push("pages");
  if (appScriptable("Microsoft Word", runner)) out.push("word");
  if (commandExists("textutil", runner) && commandExists("cupsfilter", runner)) out.push("textutil-cups");
  return out;
}

function getBackendDiagnostics(runner = runCommand) {
  return {
    gotenbergUrl: process.env.GOTENBERG_URL || null,
    convertapiSecret: Boolean(process.env.CONVERTAPI_SECRET),
    curl: commandExists("curl", runner),
    soffice: commandExists("soffice", runner),
    lowriter: commandExists("lowriter", runner),
    osascript: commandExists("osascript", runner),
    pages: appScriptable("Pages", runner),
    word: appScriptable("Microsoft Word", runner),
    textutil: commandExists("textutil", runner),
    cupsfilter: commandExists("cupsfilter", runner),
    availableBackends: getAvailableBackends(runner)
  };
}

function getBackendReasons(runner = runCommand) {
  const reasons = {};
  reasons.libreoffice = (commandExists("soffice", runner) || commandExists("lowriter", runner))
    ? "available — high fidelity, local"
    : "skipped — install LibreOffice (provides soffice or lowriter)";
  if (process.env.GOTENBERG_URL) {
    reasons.gotenberg = commandExists("curl", runner)
      ? `available — high fidelity, server: ${process.env.GOTENBERG_URL}`
      : "skipped — GOTENBERG_URL set but curl not found";
  } else {
    reasons.gotenberg = "skipped — set GOTENBERG_URL to enable";
  }
  if (process.env.CONVERTAPI_SECRET) {
    reasons.convertapi = commandExists("curl", runner)
      ? "available — high fidelity, cloud"
      : "skipped — CONVERTAPI_SECRET set but curl not found";
  } else {
    reasons.convertapi = "skipped — set CONVERTAPI_SECRET to enable";
  }
  reasons.pages = appScriptable("Pages", runner)
    ? "available — high fidelity, macOS"
    : "skipped — Apple Pages not installed or not scriptable";
  reasons.word = appScriptable("Microsoft Word", runner)
    ? "available — high fidelity, macOS"
    : "skipped — Microsoft Word not installed or not scriptable";
  if (commandExists("textutil", runner) && commandExists("cupsfilter", runner)) {
    reasons["textutil-cups"] = "available — TEXT-ONLY fallback (strips formatting)";
  } else {
    reasons["textutil-cups"] = "skipped — requires textutil and cupsfilter";
  }
  return reasons;
}

function selectBackend(preferred, available, options = {}) {
  const { strict = false } = options;
  if (preferred === "auto") {
    const candidates = strict
      ? available.filter((b) => BACKEND_FIDELITY[b] === "high")
      : available;
    if (candidates.length) return candidates[0];
    if (strict && available.length) {
      throw new CliError(
        `No high-fidelity backend available. Available text-only fallback: ${available.join(", ")}. Install LibreOffice or set GOTENBERG_URL/CONVERTAPI_SECRET.`,
        EXIT.MISSING_DEP
      );
    }
    throw new CliError("No conversion backend available. Install LibreOffice, Pages, Word, or use textutil+cupsfilter.", EXIT.MISSING_DEP);
  }
  if (!BACKENDS.includes(preferred)) throw new CliError(`Unsupported backend '${preferred}'.`, EXIT.USAGE);
  if (!available.includes(preferred)) throw new CliError(`Requested backend '${preferred}' is not available.`, EXIT.MISSING_DEP);
  return preferred;
}

function parseArgs(argv) {
  const o = {
    backend: "auto",
    overwrite: false,
    help: false,
    version: false,
    timeoutSeconds: 120,
    listBackends: false,
    doctor: false,
    quiet: false,
    json: false,
    why: false,
    strictFidelity: false,
    outDir: null,
    checkFonts: false,
    concurrency: 1
  };
  const pos = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") { o.help = true; continue; }
    if (a === "--version" || a === "-v") { o.version = true; continue; }
    if (a === "--overwrite" || a === "--force") { o.overwrite = true; continue; }
    if (a === "--list-backends") { o.listBackends = true; continue; }
    if (a === "--doctor") { o.doctor = true; continue; }
    if (a === "--quiet" || a === "-q") { o.quiet = true; continue; }
    if (a === "--json") { o.json = true; continue; }
    if (a === "--why") { o.why = true; continue; }
    if (a === "--strict-fidelity") { o.strictFidelity = true; continue; }
    if (a === "--check-fonts") { o.checkFonts = true; continue; }
    if (a.startsWith("--concurrency=")) { o.concurrency = Number(a.split("=",2)[1]); continue; }
    if (a === "--concurrency") { o.concurrency = Number(argv[++i]); if (!Number.isFinite(o.concurrency)) throw new CliError("Missing numeric value after --concurrency.", EXIT.USAGE); continue; }
    if (a.startsWith("--backend=")) { o.backend = a.split("=",2)[1]; continue; }
    if (a === "--backend") { o.backend = argv[++i]; if (!o.backend) throw new CliError("Missing value after --backend.", EXIT.USAGE); continue; }
    if (a.startsWith("--timeout-seconds=")) { o.timeoutSeconds = Number(a.split("=",2)[1]); continue; }
    if (a === "--timeout-seconds") { o.timeoutSeconds = Number(argv[++i]); if (!Number.isFinite(o.timeoutSeconds)) throw new CliError("Missing numeric value after --timeout-seconds.", EXIT.USAGE); continue; }
    if (a.startsWith("--out-dir=")) { o.outDir = a.split("=",2)[1]; continue; }
    if (a === "--out-dir") { o.outDir = argv[++i]; if (!o.outDir) throw new CliError("Missing value after --out-dir.", EXIT.USAGE); continue; }
    if (a.startsWith("--")) throw new CliError(`Unknown option '${a}'.`, EXIT.USAGE);
    pos.push(a);
  }
  if (o.help || o.version || o.listBackends || o.doctor) return o;
  if (o.checkFonts) {
    if (pos.length < 1) throw new CliError("--check-fonts requires an input file", EXIT.USAGE);
    o.input = pos[0];
    o.inputs = [pos[0]];
    return o;
  }
  if (pos.length < 1) throw new CliError("Usage: docx2pdf [options] <input.docx> [output.pdf]\n       docx2pdf [options] --out-dir <dir> <input.docx>...", EXIT.USAGE);
  if (!Number.isFinite(o.timeoutSeconds) || o.timeoutSeconds <= 0) throw new CliError("--timeout-seconds must be > 0", EXIT.USAGE);
  if (!Number.isInteger(o.concurrency) || o.concurrency < 1) throw new CliError("--concurrency must be a positive integer", EXIT.USAGE);

  if (o.outDir) {
    o.inputs = pos;
    o.input = pos[0];
    o.output = null;
  } else if (pos.length === 1) {
    o.inputs = pos;
    o.input = pos[0];
  } else if (pos.length === 2) {
    o.inputs = [pos[0]];
    o.input = pos[0];
    o.output = pos[1];
  } else {
    throw new CliError("Multiple inputs require --out-dir <dir>", EXIT.USAGE);
  }
  return o;
}

function resolvePaths(inputPath, outputPath) {
  const input = path.resolve(inputPath);
  const output = outputPath ? path.resolve(outputPath) : path.join(path.dirname(input), `${path.basename(input, path.extname(input))}.pdf`);
  return { input, output };
}

function validatePaths(input, output, overwrite) {
  if (!fs.existsSync(input)) throw new CliError(`Input file not found: ${input}`, EXIT.USAGE);
  if (!fs.statSync(input).isFile()) throw new CliError(`Input path is not a file: ${input}`, EXIT.USAGE);
  if (path.extname(input).toLowerCase() !== ".docx") throw new CliError(`Input must be a .docx file: ${input}`, EXIT.USAGE);
  if (fs.existsSync(output) && !overwrite) throw new CliError(`Output file already exists: ${output}. Use --overwrite to replace it.`, EXIT.USAGE);
  fs.mkdirSync(path.dirname(output), { recursive: true });
}

function toAppleScriptString(value) { return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`; }

function convertWithLibreOffice(input, output, runner, timeoutMs) {
  const bin = commandExists("soffice", runner) ? "soffice" : "lowriter";
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-lo-"));
  const profileDir = path.join(tempDir, "profile");
  const outDir = path.join(tempDir, "out");
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  try {
    const r = runner(bin, [
      `-env:UserInstallation=file://${profileDir}`,
      "--headless",
      "--convert-to", "pdf",
      "--outdir", outDir,
      input
    ], { timeoutMs });
    if (r.status !== 0) throw new CliError(`LibreOffice conversion failed: ${String(r.stderr || "").trim()}`, EXIT.CONVERT_FAIL);
    const generated = path.join(outDir, `${path.basename(input, path.extname(input))}.pdf`);
    if (!fs.existsSync(generated)) throw new CliError(`LibreOffice did not generate: ${generated}`, EXIT.CONVERT_FAIL);
    try {
      fs.renameSync(generated, output);
    } catch (err) {
      if (err && err.code === "EXDEV") {
        fs.copyFileSync(generated, output);
      } else {
        throw err;
      }
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function runOsa(script, runner, timeoutMs, name) {
  const r = runner("osascript", ["-e", script], { timeoutMs });
  if (r.status !== 0) throw new CliError(`${name} conversion failed: ${String(r.stderr || "").trim()}`, EXIT.CONVERT_FAIL);
}

function convertWithPages(input, output, runner = runCommand, timeoutMs = 120000) {
  const script = `
set inputFile to POSIX file ${toAppleScriptString(input)}
set outputFile to POSIX file ${toAppleScriptString(output)}
set theDocument to missing value
tell application "Pages"
  try
    set theDocument to open inputFile
    export theDocument to outputFile as PDF
    close theDocument saving no
  on error errMsg
    if theDocument is not missing value then
      try
        close theDocument saving no
      end try
    end if
    error errMsg
  end try
end tell`;
  runOsa(script, runner, timeoutMs, "Pages");
}

function convertWithWord(input, output, runner = runCommand, timeoutMs = 120000) {
  const script = `
set inputPath to ${toAppleScriptString(input)}
set outputPath to ${toAppleScriptString(output)}
set theDocument to missing value
tell application "Microsoft Word"
  try
    set theDocument to open inputPath
    save as active document file name outputPath file format format PDF
    close theDocument saving no
  on error errMsg
    if theDocument is not missing value then
      try
        close theDocument saving no
      end try
    end if
    error errMsg
  end try
end tell`;
  runOsa(script, runner, timeoutMs, "Microsoft Word");
}

function convertWithGotenberg(input, output, runner = runCommand, timeoutMs = 120000) {
  const base = process.env.GOTENBERG_URL;
  if (!base) throw new CliError("GOTENBERG_URL is required for gotenberg backend.", EXIT.MISSING_DEP);

  const endpoint = `${String(base).replace(/\/+$/, "")}/forms/libreoffice/convert`;
  const r = runner("curl", [
    "-sS",
    "-fL",
    "-X",
    "POST",
    endpoint,
    "-F",
    `files=@${input}`,
    "-o",
    output
  ], { timeoutMs });

  if (r.status !== 0) {
    try { fs.unlinkSync(output); } catch {}
    throw new CliError(`Gotenberg conversion failed: ${String(r.stderr || "").trim()}`, EXIT.CONVERT_FAIL);
  }
}

function convertWithConvertApi(input, output, runner = runCommand, timeoutMs = 120000) {
  const secret = process.env.CONVERTAPI_SECRET;
  if (!secret) throw new CliError("CONVERTAPI_SECRET is required for convertapi backend.", EXIT.MISSING_DEP);

  const post = runner("curl", [
    "-sS",
    "-f",
    "-X",
    "POST",
    "https://v2.convertapi.com/convert/docx/to/pdf",
    "-H",
    `Authorization: Bearer ${secret}`,
    "-F",
    "StoreFile=true",
    "-F",
    `File=@${input}`
  ], { timeoutMs });

  if (post.status !== 0) {
    throw new CliError(`ConvertAPI request failed: ${String(post.stderr || "").trim()}`, EXIT.CONVERT_FAIL);
  }

  let parsed;
  try {
    parsed = JSON.parse(String(post.stdout || ""));
  } catch {
    throw new CliError("ConvertAPI returned invalid JSON.", EXIT.CONVERT_FAIL);
  }

  const fileUrl = parsed?.Files?.[0]?.Url;
  if (!fileUrl) throw new CliError("ConvertAPI response missing output URL.", EXIT.CONVERT_FAIL);

  const dl = runner("curl", ["-sS", "-fL", fileUrl, "-o", output], { timeoutMs });
  if (dl.status !== 0) {
    try { fs.unlinkSync(output); } catch {}
    throw new CliError(`Failed to download converted PDF: ${String(dl.stderr || "").trim()}`, EXIT.CONVERT_FAIL);
  }
}

function convertWithTextutilCups(input, output, runner = runCommand, timeoutMs = 120000) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-"));
  const tempText = path.join(tempDir, "intermediate.txt");
  try {
    const t = runner("textutil", ["-convert", "txt", "-stdout", input], { timeoutMs });
    if (t.status !== 0) throw new CliError(`textutil failed: ${String(t.stderr || "").trim()}`, EXIT.CONVERT_FAIL);
    fs.writeFileSync(tempText, t.stdout, "utf8");
    const p = runner("cupsfilter", ["-m", "application/pdf", tempText], { encoding: "buffer", timeoutMs });
    if (p.status !== 0) throw new CliError(`cupsfilter failed: ${String(Buffer.isBuffer(p.stderr)?p.stderr.toString("utf8"):p.stderr||"").trim()}`, EXIT.CONVERT_FAIL);
    fs.writeFileSync(output, p.stdout);
  } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
}

function expandIfGlob(pattern) {
  if (fs.existsSync(pattern)) return [pattern];
  if (!/[*?[]/.test(pattern)) return [pattern];
  const dir = path.dirname(pattern) || ".";
  const base = path.basename(pattern);
  const regex = new RegExp(
    "^" + base.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
  );
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [pattern];
  }
  const matches = entries
    .filter((f) => regex.test(f))
    .map((f) => path.join(dir, f))
    .sort();
  return matches.length ? matches : [pattern];
}

function expandInputs(inputs) {
  const out = [];
  for (const p of inputs) {
    for (const expanded of expandIfGlob(p)) out.push(expanded);
  }
  return out;
}

function listDocxFonts(input, runner = runCommand) {
  if (!commandExists("unzip", runner)) return null;
  const r = runner("unzip", ["-p", input, "word/fontTable.xml"], { timeoutMs: 5000 });
  if (r.status !== 0) return [];
  const xml = String(r.stdout || "");
  const fonts = new Set();
  for (const m of xml.matchAll(/<w:font\s+w:name="([^"]+)"/g)) fonts.add(m[1]);
  return [...fonts];
}

function listSystemFonts(runner = runCommand) {
  if (!commandExists("fc-list", runner)) return null;
  const r = runner("fc-list", [":", "family"], { timeoutMs: 5000 });
  if (r.status !== 0) return null;
  const families = new Set();
  for (const line of String(r.stdout || "").split("\n")) {
    for (const fam of line.split(",")) {
      const trimmed = fam.trim();
      if (trimmed) families.add(trimmed.toLowerCase());
    }
  }
  return families;
}

function checkFonts(input, runner = runCommand) {
  const docxFonts = listDocxFonts(input, runner);
  if (docxFonts === null) return { available: false, reason: "unzip not found", all: [], missing: [] };
  const sysFonts = listSystemFonts(runner);
  if (sysFonts === null) return { available: false, reason: "fc-list not found (install fontconfig)", all: docxFonts, missing: [] };
  const missing = docxFonts.filter((f) => !sysFonts.has(f.toLowerCase()));
  return { available: true, all: docxFonts, missing };
}

function convertDocxToPdf(options, runner = runCommand) {
  const { input, output, backend = "auto", overwrite = false, timeoutSeconds = 120, strictFidelity = false } = options;
  const { input: i, output: o } = resolvePaths(input, output);
  validatePaths(i, o, overwrite);
  const selected = selectBackend(backend, getAvailableBackends(runner), { strict: strictFidelity });
  const timeoutMs = Math.floor(timeoutSeconds * 1000);
  if (selected === "libreoffice") convertWithLibreOffice(i, o, runner, timeoutMs);
  else if (selected === "gotenberg") convertWithGotenberg(i, o, runner, timeoutMs);
  else if (selected === "convertapi") convertWithConvertApi(i, o, runner, timeoutMs);
  else if (selected === "pages") convertWithPages(i, o, runner, timeoutMs);
  else if (selected === "word") convertWithWord(i, o, runner, timeoutMs);
  else convertWithTextutilCups(i, o, runner, timeoutMs);
  if (!fs.existsSync(o) || fs.statSync(o).size === 0) throw new CliError(`No PDF written: ${o}`, EXIT.CONVERT_FAIL);
  return { backend: selected, input: i, output: o };
}

function usageText() {
  return `docx2pdf - convert DOCX to PDF

Usage:
  docx2pdf [options] <input.docx> [output.pdf]
  docx2pdf [options] --out-dir <dir> <input.docx>...

Options:
  --backend <auto|libreoffice|gotenberg|convertapi|pages|word|textutil-cups>
  --strict-fidelity         in auto mode, refuse to fall back to text-only backend
  --out-dir <dir>           write outputs to <dir>/<basename>.pdf (enables batch mode)
  --concurrency <n>         run up to N conversions in parallel in batch mode (default: 1)
  --timeout-seconds <n>     conversion timeout (default: 120)
  --overwrite, --force      replace existing output file
  --quiet, -q               suppress success output (errors still print)
  --json                    emit machine-readable JSON (NDJSON in batch mode)
  --why                     print backend selection reasoning to stderr
  --check-fonts             report which fonts in the .docx are missing
  --list-backends           show available backends and exit
  --doctor                  print full diagnostics as JSON and exit
  -h, --help
  -v, --version
`;
}

module.exports = { BACKENDS, BACKEND_FIDELITY, EXIT, CliError, parseArgs, resolvePaths, validatePaths, getAvailableBackends, getBackendDiagnostics, getBackendReasons, selectBackend, convertDocxToPdf, usageText, runCommand, commandExists, appScriptable, convertWithPages, convertWithWord, convertWithTextutilCups, convertWithLibreOffice, convertWithGotenberg, convertWithConvertApi, listDocxFonts, listSystemFonts, checkFonts, expandIfGlob, expandInputs };
