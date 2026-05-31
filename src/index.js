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
  constructor(message, exitCode = 1, kind = null) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
    this.kind = kind;
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

function commandExists(command, runner = runCommand, cache = null) {
  const key = `cmd:${command}`;
  if (cache && cache.has(key)) return cache.get(key);
  let result;
  try {
    result = runner("sh", ["-c", `command -v ${shellQuote(command)}`]).status === 0;
  } catch {
    result = false;
  }
  if (cache) cache.set(key, result);
  return result;
}

function appScriptable(appName, runner = runCommand, cache = null) {
  const key = `app:${appName}`;
  if (cache && cache.has(key)) return cache.get(key);
  let result = false;
  if (commandExists("osascript", runner, cache)) {
    try {
      result = runner("osascript", ["-e", `id of application \"${appName}\"`]).status === 0;
    } catch {
      result = false;
    }
  }
  if (cache) cache.set(key, result);
  return result;
}

function detectLinuxPackageManager(runner = runCommand, cache = null) {
  if (process.platform !== "linux") return null;
  if (commandExists("apt-get", runner, cache)) return "apt";
  if (commandExists("dnf", runner, cache)) return "dnf";
  if (commandExists("yum", runner, cache)) return "yum";
  if (commandExists("pacman", runner, cache)) return "pacman";
  if (commandExists("apk", runner, cache)) return "apk";
  return null;
}

function platformKey(runner = runCommand, cache = null) {
  if (process.platform === "linux") {
    const pm = detectLinuxPackageManager(runner, cache);
    return pm ? `linux-${pm}` : "linux";
  }
  return process.platform;
}

const INSTALL_HINTS = {
  libreoffice: {
    darwin: "brew install --cask libreoffice",
    "linux-apt": "sudo apt-get update && sudo apt-get install -y libreoffice",
    "linux-dnf": "sudo dnf install -y libreoffice",
    "linux-yum": "sudo yum install -y libreoffice",
    "linux-pacman": "sudo pacman -S --noconfirm libreoffice-fresh",
    "linux-apk": "sudo apk add libreoffice",
    linux: "Install LibreOffice via your distro's package manager (apt-get / dnf / pacman / apk).",
    win32: "winget install TheDocumentFoundation.LibreOffice"
  },
  gotenberg: {
    _all: "docker run --rm -d -p 3000:3000 gotenberg/gotenberg:8 && export GOTENBERG_URL=http://127.0.0.1:3000"
  },
  convertapi: {
    _all: "Get a secret at https://www.convertapi.com/, then: export CONVERTAPI_SECRET=<your-secret>"
  },
  pages: {
    darwin: "Install Pages from the Mac App Store. On first run, grant Automation permission for the calling terminal/IDE in System Settings → Privacy & Security → Automation."
  },
  word: {
    darwin: "Install Microsoft Word from the App Store or microsoft.com. On first run, grant Automation permission for the calling terminal/IDE."
  },
  "textutil-cups": {
    darwin: "Built-in on macOS — should always be available."
  }
};

function getInstallCommand(backend, runner = runCommand, cache = null) {
  const hints = INSTALL_HINTS[backend] || {};
  if (hints._all) return hints._all;
  const key = platformKey(runner, cache);
  return hints[key] || hints[process.platform] || null;
}

function computeRecommendation(diagnostics) {
  if (diagnostics.availableBackends.some((b) => BACKEND_FIDELITY[b] === "high")) return null;
  if (diagnostics.tools && diagnostics.tools.docker) {
    return {
      backend: "gotenberg",
      rationale: "Docker is already installed. Run Gotenberg in a container in ~30 seconds without modifying your system.",
      command: INSTALL_HINTS.gotenberg._all
    };
  }
  return {
    backend: "libreoffice",
    rationale: "LibreOffice provides the best local-only fidelity. One-time install, no recurring cost, no internet required after install.",
    command: getInstallCommand("libreoffice")
  };
}

function getAvailableBackends(runner = runCommand, cache = null) {
  const c = cache || new Map();
  const out = [];
  if (commandExists("soffice", runner, c) || commandExists("lowriter", runner, c)) out.push("libreoffice");
  if (process.env.GOTENBERG_URL && commandExists("curl", runner, c)) out.push("gotenberg");
  if (process.env.CONVERTAPI_SECRET && commandExists("curl", runner, c)) out.push("convertapi");
  if (appScriptable("Pages", runner, c)) out.push("pages");
  if (appScriptable("Microsoft Word", runner, c)) out.push("word");
  if (commandExists("textutil", runner, c) && commandExists("cupsfilter", runner, c)) out.push("textutil-cups");
  return out;
}

function getBackendDiagnostics(runner = runCommand) {
  const c = new Map();
  const tools = {
    curl: commandExists("curl", runner, c),
    soffice: commandExists("soffice", runner, c),
    lowriter: commandExists("lowriter", runner, c),
    osascript: commandExists("osascript", runner, c),
    pages: appScriptable("Pages", runner, c),
    word: appScriptable("Microsoft Word", runner, c),
    textutil: commandExists("textutil", runner, c),
    cupsfilter: commandExists("cupsfilter", runner, c),
    docker: commandExists("docker", runner, c),
    unzip: commandExists("unzip", runner, c),
    fcList: commandExists("fc-list", runner, c)
  };
  const availableBackends = getAvailableBackends(runner, c);
  const reasons = getBackendReasons(runner, c);
  const backends = {};
  for (const b of BACKENDS) {
    backends[b] = {
      available: availableBackends.includes(b),
      fidelity: BACKEND_FIDELITY[b],
      reason: reasons[b],
      install: getInstallCommand(b, runner, c)
    };
  }
  const out = {
    platform: process.platform,
    platformKey: platformKey(runner, c),
    gotenbergUrl: process.env.GOTENBERG_URL || null,
    convertapiSecret: Boolean(process.env.CONVERTAPI_SECRET),
    tools,
    backends,
    availableBackends
  };
  out.recommendation = computeRecommendation(out);
  // Backwards compat: keep flat tool keys at the top level so existing
  // --doctor consumers (and tests) don't break.
  Object.assign(out, tools);
  return out;
}

function getBackendReasons(runner = runCommand, cache = null) {
  const c = cache || new Map();
  const reasons = {};
  reasons.libreoffice = (commandExists("soffice", runner, c) || commandExists("lowriter", runner, c))
    ? "available — high fidelity, local"
    : "skipped — install LibreOffice (provides soffice or lowriter)";
  if (process.env.GOTENBERG_URL) {
    reasons.gotenberg = commandExists("curl", runner, c)
      ? `available — high fidelity, server: ${process.env.GOTENBERG_URL}`
      : "skipped — GOTENBERG_URL set but curl not found";
  } else {
    reasons.gotenberg = "skipped — set GOTENBERG_URL to enable";
  }
  if (process.env.CONVERTAPI_SECRET) {
    reasons.convertapi = commandExists("curl", runner, c)
      ? "available — high fidelity, cloud"
      : "skipped — CONVERTAPI_SECRET set but curl not found";
  } else {
    reasons.convertapi = "skipped — set CONVERTAPI_SECRET to enable";
  }
  reasons.pages = appScriptable("Pages", runner, c)
    ? "available — high fidelity, macOS"
    : "skipped — Apple Pages not installed or not scriptable";
  reasons.word = appScriptable("Microsoft Word", runner, c)
    ? "available — high fidelity, macOS"
    : "skipped — Microsoft Word not installed or not scriptable";
  if (commandExists("textutil", runner, c) && commandExists("cupsfilter", runner, c)) {
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
        EXIT.MISSING_DEP,
        "NO_BACKEND"
      );
    }
    throw new CliError(
      "No conversion backend available. Install LibreOffice, Pages, Word, or use textutil+cupsfilter.",
      EXIT.MISSING_DEP,
      "NO_BACKEND"
    );
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
    capabilities: false,
    catalog: null,
    quiet: false,
    json: false,
    why: false,
    strictFidelity: false,
    outDir: null,
    checkFonts: false,
    concurrency: 1,
    retries: 0
  };
  const pos = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") { o.help = true; continue; }
    if (a === "--version" || a === "-v") { o.version = true; continue; }
    if (a === "--overwrite" || a === "--force") { o.overwrite = true; continue; }
    if (a === "--list-backends") { o.listBackends = true; continue; }
    if (a === "--doctor") { o.doctor = true; continue; }
    if (a === "--capabilities") { o.capabilities = true; continue; }
    if (a.startsWith("--catalog=")) { o.catalog = a.split("=", 2)[1]; continue; }
    if (a === "--catalog") { o.catalog = argv[++i]; if (!o.catalog) throw new CliError("Missing value after --catalog.", EXIT.USAGE); continue; }
    if (a === "--quiet" || a === "-q") { o.quiet = true; continue; }
    if (a === "--json") { o.json = true; continue; }
    if (a === "--why") { o.why = true; continue; }
    if (a === "--strict-fidelity") { o.strictFidelity = true; continue; }
    if (a === "--check-fonts") { o.checkFonts = true; continue; }
    if (a.startsWith("--concurrency=")) { o.concurrency = Number(a.split("=",2)[1]); continue; }
    if (a === "--concurrency") { o.concurrency = Number(argv[++i]); if (!Number.isFinite(o.concurrency)) throw new CliError("Missing numeric value after --concurrency.", EXIT.USAGE); continue; }
    if (a.startsWith("--retries=")) { o.retries = Number(a.split("=",2)[1]); continue; }
    if (a === "--retries") { o.retries = Number(argv[++i]); if (!Number.isFinite(o.retries)) throw new CliError("Missing numeric value after --retries.", EXIT.USAGE); continue; }
    if (a.startsWith("--backend=")) { o.backend = a.split("=",2)[1]; continue; }
    if (a === "--backend") { o.backend = argv[++i]; if (!o.backend) throw new CliError("Missing value after --backend.", EXIT.USAGE); continue; }
    if (a.startsWith("--timeout-seconds=")) { o.timeoutSeconds = Number(a.split("=",2)[1]); continue; }
    if (a === "--timeout-seconds") { o.timeoutSeconds = Number(argv[++i]); if (!Number.isFinite(o.timeoutSeconds)) throw new CliError("Missing numeric value after --timeout-seconds.", EXIT.USAGE); continue; }
    if (a.startsWith("--out-dir=")) { o.outDir = a.split("=",2)[1]; continue; }
    if (a === "--out-dir") { o.outDir = argv[++i]; if (!o.outDir) throw new CliError("Missing value after --out-dir.", EXIT.USAGE); continue; }
    if (a.startsWith("--")) throw new CliError(`Unknown option '${a}'.`, EXIT.USAGE);
    pos.push(a);
  }
  if (o.help || o.version || o.listBackends || o.doctor || o.capabilities || o.catalog) return o;
  if (o.checkFonts) {
    if (pos.length < 1) throw new CliError("--check-fonts requires an input file", EXIT.USAGE);
    o.input = pos[0];
    o.inputs = pos;
    return o;
  }
  if (pos.length < 1) throw new CliError("Usage: docx2pdf [options] <input.docx> [output.pdf]\n       docx2pdf [options] --out-dir <dir> <input.docx>...", EXIT.USAGE);
  if (!Number.isFinite(o.timeoutSeconds) || o.timeoutSeconds <= 0) throw new CliError("--timeout-seconds must be > 0", EXIT.USAGE);
  if (!Number.isInteger(o.concurrency) || o.concurrency < 1) throw new CliError("--concurrency must be a positive integer", EXIT.USAGE);
  if (!Number.isInteger(o.retries) || o.retries < 0) throw new CliError("--retries must be a non-negative integer", EXIT.USAGE);

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
  const outDir = path.dirname(output);
  if (fs.existsSync(outDir) && !fs.statSync(outDir).isDirectory()) {
    throw new CliError(`Output directory is not a directory: ${outDir}`, EXIT.USAGE);
  }
  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch (err) {
    throw new CliError(`Cannot create output directory ${outDir}: ${err.code || err.message}`, EXIT.USAGE);
  }
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
      try {
        fs.renameSync(generated, output);
      } catch (err) {
        if (err && err.code === "EXDEV") {
          fs.copyFileSync(generated, output);
        } else {
          throw err;
        }
      }
    } catch (err) {
      throw new CliError(`Cannot write output ${output}: ${err.code || err.message}`, EXIT.CONVERT_FAIL);
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

function convertWithGotenberg(input, output, runner = runCommand, timeoutMs = 120000, retries = 0) {
  const base = process.env.GOTENBERG_URL;
  if (!base) throw new CliError("GOTENBERG_URL is required for gotenberg backend.", EXIT.MISSING_DEP);

  const endpoint = `${String(base).replace(/\/+$/, "")}/forms/libreoffice/convert`;
  let lastErr = null;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
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
    if (r.status === 0) return;
    lastErr = String(r.stderr || "").trim();
    try { fs.unlinkSync(output); } catch {}
  }
  throw new CliError(`Gotenberg conversion failed after ${retries + 1} attempt(s): ${lastErr || "unknown error"}`, EXIT.CONVERT_FAIL);
}

function waitMs(ms) {
  if (ms <= 0) return;
  // Synchronous sleep without CPU busy-loop
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function convertWithConvertApi(input, output, runner = runCommand, timeoutMs = 120000, retries = 0) {
  const secret = process.env.CONVERTAPI_SECRET;
  if (!secret) throw new CliError("CONVERTAPI_SECRET is required for convertapi backend.", EXIT.MISSING_DEP);

  let lastErr = null;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
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
      lastErr = `request failed: ${String(post.stderr || "").trim()}`;
      if (attempt <= retries) waitMs(250 * attempt);
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(String(post.stdout || ""));
    } catch {
      lastErr = "invalid JSON response";
      if (attempt <= retries) waitMs(250 * attempt);
      continue;
    }

    const fileUrl = parsed?.Files?.[0]?.Url;
    if (!fileUrl) {
      lastErr = "response missing output URL";
      if (attempt <= retries) waitMs(250 * attempt);
      continue;
    }

    const dl = runner("curl", ["-sS", "-fL", fileUrl, "-o", output], { timeoutMs });
    if (dl.status === 0) return;
    lastErr = `download failed: ${String(dl.stderr || "").trim()}`;
    try { fs.unlinkSync(output); } catch {}
    if (attempt <= retries) waitMs(250 * attempt);
  }
  throw new CliError(`ConvertAPI conversion failed after ${retries + 1} attempt(s): ${lastErr || "unknown error"}`, EXIT.CONVERT_FAIL);
}

function convertWithTextutilCups(input, output, runner = runCommand, timeoutMs = 120000) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "docx2pdf-cli-"));
  const tempText = path.join(tempDir, "intermediate.txt");
  try {
    const t = runner("textutil", ["-convert", "txt", "-stdout", input], { timeoutMs });
    if (t.status !== 0) throw new CliError(`textutil failed: ${String(t.stderr || "").trim()}`, EXIT.CONVERT_FAIL);
    try {
      fs.writeFileSync(tempText, t.stdout, "utf8");
    } catch (err) {
      throw new CliError(`Cannot write intermediate file ${tempText}: ${err.code || err.message}`, EXIT.CONVERT_FAIL);
    }
    const p = runner("cupsfilter", ["-m", "application/pdf", tempText], { encoding: "buffer", timeoutMs });
    if (p.status !== 0) throw new CliError(`cupsfilter failed: ${String(Buffer.isBuffer(p.stderr)?p.stderr.toString("utf8"):p.stderr||"").trim()}`, EXIT.CONVERT_FAIL);
    try {
      fs.writeFileSync(output, p.stdout);
    } catch (err) {
      throw new CliError(`Cannot write output ${output}: ${err.code || err.message}`, EXIT.CONVERT_FAIL);
    }
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

const FONT_STYLE_SUFFIXES = [
  "thin", "extra light", "extralight", "ultra light", "ultralight",
  "light", "regular", "normal", "book", "medium",
  "semi bold", "semibold", "demi bold", "demibold",
  "bold", "extra bold", "extrabold", "ultra bold", "ultrabold",
  "black", "heavy",
  "italic", "oblique"
];

function fontFamilyMatches(docFont, sysFonts) {
  const lower = docFont.toLowerCase();
  if (sysFonts.has(lower)) return true;
  let stripped = lower;
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of FONT_STYLE_SUFFIXES) {
      if (stripped.endsWith(" " + suffix)) {
        stripped = stripped.slice(0, -(suffix.length + 1)).trim();
        changed = true;
        break;
      }
    }
  }
  return stripped !== lower && sysFonts.has(stripped);
}

function checkFonts(input, runner = runCommand) {
  const docxFonts = listDocxFonts(input, runner);
  if (docxFonts === null) return { available: false, reason: "unzip not found", all: [], missing: [] };
  const sysFonts = listSystemFonts(runner);
  if (sysFonts === null) return { available: false, reason: "fc-list not found (install fontconfig)", all: docxFonts, missing: [] };
  const missing = docxFonts.filter((f) => !fontFamilyMatches(f, sysFonts));
  return { available: true, all: docxFonts, missing };
}

function convertDocxToPdf(options, runner = runCommand) {
  const { input, output, backend = "auto", overwrite = false, timeoutSeconds = 120, strictFidelity = false, retries = 0 } = options;
  const { input: i, output: o } = resolvePaths(input, output);
  validatePaths(i, o, overwrite);
  const selected = selectBackend(backend, getAvailableBackends(runner), { strict: strictFidelity });
  const timeoutMs = Math.floor(timeoutSeconds * 1000);
  if (selected === "libreoffice") convertWithLibreOffice(i, o, runner, timeoutMs);
  else if (selected === "gotenberg") convertWithGotenberg(i, o, runner, timeoutMs, retries);
  else if (selected === "convertapi") convertWithConvertApi(i, o, runner, timeoutMs, retries);
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
  docx2pdf demo                            zero-config: convert a bundled sample
  cat in.docx | docx2pdf - out.pdf         read DOCX from stdin
  docx2pdf in.docx - > out.pdf             write PDF to stdout ('-')

Options:
  --backend <auto|libreoffice|gotenberg|convertapi|pages|word|textutil-cups>
  --strict-fidelity         in auto mode, refuse to fall back to text-only backend
  --out-dir <dir>           write outputs to <dir>/<basename>.pdf (enables batch mode)
  --concurrency <n>         run up to N conversions in parallel in batch mode (default: 1)
  --retries <n>             retry failed network backends n times (default: 0)
  --timeout-seconds <n>     conversion timeout (default: 120)
  --overwrite, --force      replace existing output file
  --quiet, -q               suppress success output (errors still print)
  --json                    emit machine-readable JSON (NDJSON in batch mode)
  --why                     print backend selection reasoning to stderr
  --check-fonts             report which fonts in the .docx are missing
  --list-backends           show available backends and exit
  --doctor                  print full diagnostics as JSON and exit
  --capabilities            print machine-readable tool capabilities JSON and exit
  --catalog json            print machine-readable flag inventory and exit
  -h, --help
  -v, --version
`;
}

module.exports = { BACKENDS, BACKEND_FIDELITY, EXIT, CliError, INSTALL_HINTS, parseArgs, resolvePaths, validatePaths, getAvailableBackends, getBackendDiagnostics, getBackendReasons, selectBackend, convertDocxToPdf, usageText, runCommand, commandExists, appScriptable, computeRecommendation, detectLinuxPackageManager, getInstallCommand, platformKey, convertWithPages, convertWithWord, convertWithTextutilCups, convertWithLibreOffice, convertWithGotenberg, convertWithConvertApi, listDocxFonts, listSystemFonts, checkFonts, fontFamilyMatches, expandIfGlob, expandInputs };
