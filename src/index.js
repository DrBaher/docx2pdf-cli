"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const BACKENDS = ["libreoffice", "gotenberg", "convertapi", "pages", "word", "textutil-cups"];
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

function selectBackend(preferred, available) {
  if (preferred === "auto") {
    if (available.length) return available[0];
    throw new CliError("No conversion backend available. Install LibreOffice, Pages, Word, or use textutil+cupsfilter.", EXIT.MISSING_DEP);
  }
  if (!BACKENDS.includes(preferred)) throw new CliError(`Unsupported backend '${preferred}'.`, EXIT.USAGE);
  if (!available.includes(preferred)) throw new CliError(`Requested backend '${preferred}' is not available.`, EXIT.MISSING_DEP);
  return preferred;
}

function parseArgs(argv) {
  const o = { backend: "auto", overwrite: false, help: false, version: false, timeoutSeconds: 120, listBackends: false, doctor: false };
  const pos = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") { o.help = true; continue; }
    if (a === "--version" || a === "-v") { o.version = true; continue; }
    if (a === "--overwrite" || a === "--force") { o.overwrite = true; continue; }
    if (a === "--list-backends") { o.listBackends = true; continue; }
    if (a === "--doctor") { o.doctor = true; continue; }
    if (a.startsWith("--backend=")) { o.backend = a.split("=",2)[1]; continue; }
    if (a === "--backend") { o.backend = argv[++i]; if (!o.backend) throw new CliError("Missing value after --backend.", EXIT.USAGE); continue; }
    if (a.startsWith("--timeout-seconds=")) { o.timeoutSeconds = Number(a.split("=",2)[1]); continue; }
    if (a === "--timeout-seconds") { o.timeoutSeconds = Number(argv[++i]); if (!Number.isFinite(o.timeoutSeconds)) throw new CliError("Missing numeric value after --timeout-seconds.", EXIT.USAGE); continue; }
    if (a.startsWith("--")) throw new CliError(`Unknown option '${a}'.`, EXIT.USAGE);
    pos.push(a);
  }
  if (o.help || o.version || o.listBackends || o.doctor) return o;
  if (pos.length < 1 || pos.length > 2) throw new CliError("Usage: docx2pdf [options] <input.docx> [output.pdf]", EXIT.USAGE);
  if (!Number.isFinite(o.timeoutSeconds) || o.timeoutSeconds <= 0) throw new CliError("--timeout-seconds must be > 0", EXIT.USAGE);
  o.input = pos[0]; o.output = pos[1];
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
  try {
    const r = runner(bin, ["--headless", "--convert-to", "pdf", "--outdir", tempDir, input], { timeoutMs });
    if (r.status !== 0) throw new CliError(`LibreOffice conversion failed: ${String(r.stderr || "").trim()}`, EXIT.CONVERT_FAIL);
    const generated = path.join(tempDir, `${path.basename(input, path.extname(input))}.pdf`);
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

function convertDocxToPdf(options, runner = runCommand) {
  const { input, output, backend = "auto", overwrite = false, timeoutSeconds = 120 } = options;
  const { input: i, output: o } = resolvePaths(input, output);
  validatePaths(i, o, overwrite);
  const selected = selectBackend(backend, getAvailableBackends(runner));
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
  return `docx2pdf - convert DOCX to PDF\n\nUsage:\n  docx2pdf [options] <input.docx> [output.pdf]\n\nOptions:\n  --backend <auto|libreoffice|gotenberg|convertapi|pages|word|textutil-cups>\n  --timeout-seconds <n>\n  --overwrite, --force\n  --list-backends\n  --doctor\n  -h, --help\n  -v, --version\n`;
}

module.exports = { BACKENDS, EXIT, CliError, parseArgs, resolvePaths, validatePaths, getAvailableBackends, getBackendDiagnostics, selectBackend, convertDocxToPdf, usageText, runCommand, commandExists, appScriptable, convertWithPages, convertWithWord, convertWithTextutilCups, convertWithLibreOffice, convertWithGotenberg, convertWithConvertApi };
