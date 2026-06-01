"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// rank-check/launcher/bootstrap-launcher.ts
var import_child_process2 = require("child_process");
var path3 = __toESM(require("path"), 1);
var fs3 = __toESM(require("fs"), 1);
var os = __toESM(require("os"), 1);

// rank-check/launcher/git-sync.ts
var import_child_process = require("child_process");
var import_util = require("util");
var fs = __toESM(require("fs"), 1);
var path = __toESM(require("path"), 1);
var execAsync = (0, import_util.promisify)(import_child_process.exec);
var GIT_CHECK_INTERVAL_MS = Number(
  process.env.GIT_CHECK_INTERVAL_MS || 5 * 60 * 1e3
);
var GIT_BRANCH = process.env.GIT_BRANCH || "main";
async function runGit(projectRoot, args, timeoutMs = 12e4) {
  const { stdout } = await execAsync(`git -C "${projectRoot}" ${args}`, {
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024
  });
  return (stdout || "").trim();
}
async function syncGitRepo(projectRoot, options = {}) {
  const branch = options.branch || GIT_BRANCH;
  const hardReset = options.hardReset ?? process.env.GIT_SYNC_HARD_RESET === "1";
  if (!fs.existsSync(path.join(projectRoot, ".git"))) {
    return {
      updated: false,
      localHash: "",
      remoteHash: "",
      message: "Git \uC800\uC7A5\uC18C\uAC00 \uC544\uB2D8 (.git \uC5C6\uC74C)"
    };
  }
  try {
    await runGit(projectRoot, `fetch origin ${branch}`);
    const localHash = await runGit(projectRoot, "rev-parse HEAD");
    const remoteHash = await runGit(projectRoot, `rev-parse origin/${branch}`);
    if (localHash === remoteHash) {
      return {
        updated: false,
        localHash,
        remoteHash,
        message: "\uCD5C\uC2E0 \uC0C1\uD0DC"
      };
    }
    let pullLog = "";
    if (hardReset) {
      pullLog = await runGit(projectRoot, `reset --hard origin/${branch}`);
    } else {
      pullLog = await runGit(projectRoot, `pull origin ${branch}`);
    }
    const newHash = await runGit(projectRoot, "rev-parse HEAD");
    return {
      updated: true,
      localHash: newHash,
      remoteHash,
      message: pullLog || `\uC5C5\uB370\uC774\uD2B8 \uC644\uB8CC (${localHash.slice(0, 7)} \u2192 ${newHash.slice(0, 7)})`
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      updated: false,
      localHash: "",
      remoteHash: "",
      message: `Git \uB3D9\uAE30\uD654 \uC2E4\uD328: ${msg}`
    };
  }
}

// rank-check/utils/load-project-env.ts
var fs2 = __toESM(require("fs"), 1);
var path2 = __toESM(require("path"), 1);
function unquote(value) {
  const v = value.trim();
  if (v.startsWith('"') && v.endsWith('"') || v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1).trim();
  }
  return v;
}
function loadProjectEnvFile(rootDir) {
  const envPath = path2.join(rootDir, ".env");
  const out = {};
  if (!fs2.existsSync(envPath)) return out;
  const content = fs2.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = unquote(trimmed.slice(eq + 1));
    if (key) out[key] = value;
  }
  if (!out.SUPABASE_URL && out.NEXT_PUBLIC_SUPABASE_URL) {
    out.SUPABASE_URL = out.NEXT_PUBLIC_SUPABASE_URL;
  }
  if (!out.SUPABASE_SERVICE_ROLE_KEY && out.SUPABASE_ANON_KEY) {
    out.SUPABASE_SERVICE_ROLE_KEY = out.SUPABASE_ANON_KEY;
  }
  return out;
}
function buildEnvWithProjectFile(rootDir, extra = {}) {
  const fileEnv = loadProjectEnvFile(rootDir);
  return { ...process.env, ...fileEnv, ...extra };
}

// rank-check/launcher/bootstrap-launcher.ts
var GIT_REPO = process.env.NAVER_RANK_GIT_REPO || "https://github.com/paust0270-debug/sellermate_naver_place_all.git";
var GIT_BRANCH2 = process.env.GIT_BRANCH || "main";
function resolveInstallDir() {
  if (process.env.NAVER_RANK_INSTALL_DIR?.trim()) {
    return path3.resolve(process.env.NAVER_RANK_INSTALL_DIR.trim());
  }
  if (fs3.existsSync("D:\\")) {
    return "D:\\naverrank";
  }
  const localApp = process.env.LOCALAPPDATA || path3.join(os.homedir(), "AppData", "Local");
  return path3.join(localApp, "SellermateNaverRank");
}
var INSTALL_DIR = resolveInstallDir();
function log(message) {
  const timestamp = (/* @__PURE__ */ new Date()).toLocaleTimeString("ko-KR");
  console.log(`[${timestamp}] ${message}`);
}
function exitWithPause(code) {
  if (process.platform === "win32" && process.env.NAVER_RANK_NO_PAUSE !== "1") {
    console.log("");
    try {
      (0, import_child_process2.execSync)("cmd /c pause", { stdio: "inherit" });
    } catch {
    }
  }
  process.exit(code);
}
function buildChildEnv() {
  return buildEnvWithProjectFile(INSTALL_DIR, {
    GIT_SYNC_HARD_RESET: "1",
    GIT_CHECK_INTERVAL_MS: String(5 * 60 * 1e3)
  });
}
function resolveLauncherScript() {
  const candidates = [
    "rank-check/launcher/remote-watch-launcher.ts",
    "run-unified.ts",
    "rank-check/launcher/auto-update-launcher.ts"
  ];
  for (const rel of candidates) {
    if (fs3.existsSync(path3.join(INSTALL_DIR, rel))) {
      return rel;
    }
  }
  return null;
}
function isUnifiedLauncher(rel) {
  return rel.includes("remote-watch") || rel === "run-unified.ts" || rel.endsWith("run-unified.ts");
}
function killChildTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    try {
      (0, import_child_process2.execSync)(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore", windowsHide: true });
    } catch {
    }
  } else {
    try {
      child.kill("SIGTERM");
    } catch {
    }
  }
}
function findNodeBin() {
  try {
    const out = (0, import_child_process2.execSync)("where node", {
      encoding: "utf8",
      shell: true,
      windowsHide: true
    }).trim();
    const first = out.split(/\r?\n/).find((line) => line.trim().endsWith("node.exe"));
    if (first?.trim() && fs3.existsSync(first.trim())) {
      return first.trim();
    }
  } catch {
  }
  return "node";
}
function getTsxSpawn(scriptRel) {
  const scriptPath = path3.join(INSTALL_DIR, scriptRel);
  const nodeBin = findNodeBin();
  const localTsx = path3.join(INSTALL_DIR, "node_modules", "tsx", "dist", "cli.mjs");
  const tsxCmd = path3.join(INSTALL_DIR, "node_modules", ".bin", "tsx.cmd");
  if (fs3.existsSync(localTsx)) {
    return { command: nodeBin, args: [localTsx, scriptPath], shell: false };
  }
  if (fs3.existsSync(tsxCmd)) {
    return { command: tsxCmd, args: [scriptPath], shell: true };
  }
  if (process.platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "npx", "tsx", scriptRel],
      shell: false
    };
  }
  return { command: "npx", args: ["tsx", scriptRel], shell: true };
}
function runCommand(command, options = {}) {
  try {
    (0, import_child_process2.execSync)(command, {
      cwd: options.cwd || INSTALL_DIR,
      stdio: options.silent ? "pipe" : "inherit",
      encoding: "utf8",
      shell: true,
      env: options.env ? { ...process.env, ...options.env } : process.env
    });
    return true;
  } catch {
    return false;
  }
}
function normalizeGitRemoteUrl(url) {
  return url.trim().replace(/\.git$/i, "").replace(/\/$/, "").toLowerCase().replace(/^git@github\.com:/, "https://github.com/").replace(/^ssh:\/\/git@github\.com\//, "https://github.com/");
}
function ensureGitOrigin() {
  const gitDir = path3.join(INSTALL_DIR, ".git");
  if (!fs3.existsSync(gitDir)) return;
  let current = "";
  try {
    current = (0, import_child_process2.execSync)("git config --get remote.origin.url", {
      cwd: INSTALL_DIR,
      encoding: "utf8",
      windowsHide: true
    }).trim();
  } catch {
    current = "";
  }
  const want = normalizeGitRemoteUrl(GIT_REPO);
  const have = normalizeGitRemoteUrl(current || "");
  if (!have || have !== want) {
    if (current) log(`Git origin \uAD50\uC815: ${current}`);
    log(`\u2192 ${GIT_REPO}`);
    runCommand(`git remote set-url origin "${GIT_REPO}"`, { cwd: INSTALL_DIR });
  } else {
    log(`Git origin OK (${current})`);
  }
}
async function main() {
  console.log("");
  console.log("=".repeat(50));
  console.log("  NaverRank Checker - Auto Installer");
  console.log("=".repeat(50));
  console.log("");
  console.log(`\uC124\uCE58 \uACBD\uB85C: ${INSTALL_DIR}`);
  if (!fs3.existsSync("D:\\")) {
    log("D: \uB4DC\uB77C\uC774\uBE0C \uC5C6\uC74C \u2192 \uC0AC\uC6A9\uC790 \uD3F4\uB354\uC5D0 \uC124\uCE58\uD569\uB2C8\uB2E4.");
  }
  console.log("-".repeat(50));
  log(`[1/5] \uC124\uCE58 \uD3F4\uB354: ${INSTALL_DIR}`);
  console.log("-".repeat(50));
  if (!fs3.existsSync(INSTALL_DIR)) {
    log("\uD3F4\uB354 \uC0DD\uC131 \uC911...");
    fs3.mkdirSync(INSTALL_DIR, { recursive: true });
    log("\uD3F4\uB354 \uC0DD\uC131 \uC644\uB8CC");
  } else {
    log("\uAE30\uC874 \uD3F4\uB354 \uBC1C\uACAC");
  }
  console.log("");
  console.log("-".repeat(50));
  log("[2/5] Git \uC5C5\uB370\uC774\uD2B8");
  console.log("-".repeat(50));
  if (!runCommand("git --version", { silent: true, cwd: os.homedir() })) {
    console.log("[\uC624\uB958] Git\uC774 \uC124\uCE58\uB418\uC5B4 \uC788\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
    console.log("https://git-scm.com/download/win \uC5D0\uC11C \uC124\uCE58\uD574\uC8FC\uC138\uC694.");
    exitWithPause(1);
  }
  const gitDir = path3.join(INSTALL_DIR, ".git");
  const installParent = path3.dirname(INSTALL_DIR);
  if (fs3.existsSync(gitDir)) {
    ensureGitOrigin();
    log("git fetch...");
    runCommand(`git fetch origin ${GIT_BRANCH2}`, { cwd: INSTALL_DIR });
    log("git reset --hard...");
    runCommand(`git reset --hard origin/${GIT_BRANCH2}`, { cwd: INSTALL_DIR });
    log("Git \uC5C5\uB370\uC774\uD2B8 \uC644\uB8CC");
  } else {
    if (!fs3.existsSync(installParent)) {
      fs3.mkdirSync(installParent, { recursive: true });
    }
    log(`git clone \u2192 ${INSTALL_DIR}`);
    if (!runCommand(`git clone ${GIT_REPO} "${INSTALL_DIR}"`, { cwd: installParent })) {
      console.log("[\uC624\uB958] Git clone \uC2E4\uD328");
      console.log("  - \uC778\uD130\uB137 / GitHub \uC811\uC18D \uD655\uC778");
      console.log("  - \uB610\uB294 \uC218\uB3D9 clone \uD6C4 NAVER_RANK_INSTALL_DIR \uD658\uACBD\uBCC0\uC218\uB85C \uACBD\uB85C \uC9C0\uC815");
      exitWithPause(1);
    }
    log("Git clone \uC644\uB8CC");
  }
  console.log("");
  console.log("-".repeat(50));
  log("[3/5] \uD658\uACBD \uC124\uC815 (.env)");
  console.log("-".repeat(50));
  const envPath = path3.join(INSTALL_DIR, ".env");
  const envExample = path3.join(INSTALL_DIR, ".env.example");
  if (fs3.existsSync(envPath)) {
    log("\uAE30\uC874 .env \uC720\uC9C0 (\uB36E\uC5B4\uC4F0\uC9C0 \uC54A\uC74C)");
  } else if (fs3.existsSync(envExample)) {
    fs3.copyFileSync(envExample, envPath);
    log(".env\uB97C .env.example\uC5D0\uC11C \uBCF5\uC0AC\uD588\uC2B5\uB2C8\uB2E4.");
    console.log("  \u2192 Supabase \uD0A4(sb_secret_ / sb_publishable_)\uB97C .env\uC5D0 \uC785\uB825 \uD6C4 \uB2E4\uC2DC \uC2E4\uD589\uD558\uC138\uC694.");
    exitWithPause(1);
  } else {
    fs3.writeFileSync(
      envPath,
      [
        "SUPABASE_URL=https://your-project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY=sb_secret_your-key",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_your-key"
      ].join("\n"),
      "utf8"
    );
    log(".env \uD15C\uD50C\uB9BF \uC0DD\uC131 \u2014 \uD0A4 \uC785\uB825 \uD6C4 \uB2E4\uC2DC \uC2E4\uD589\uD558\uC138\uC694.");
    exitWithPause(1);
  }
  const fileEnv = loadProjectEnvFile(INSTALL_DIR);
  if (!fileEnv.SUPABASE_URL || !fileEnv.SUPABASE_SERVICE_ROLE_KEY) {
    console.log("[\uC624\uB958] .env\uC5D0 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4.");
    console.log(`  \uACBD\uB85C: ${envPath}`);
    exitWithPause(1);
  }
  if (fileEnv.SUPABASE_SERVICE_ROLE_KEY.startsWith("eyJ")) {
    console.log("");
    console.log("[\uC624\uB958] Legacy JWT service_role \uD0A4(eyJ\u2026) \u2014 Supabase\uC5D0\uC11C \uBE44\uD65C\uC131\uD654\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
    console.log(`  .env: ${envPath}`);
    console.log("  \u2192 Supabase \uB300\uC2DC\uBCF4\uB4DC \u2192 API Keys \u2192 sb_secret_\u2026 \uB97C \uBCF5\uC0AC\uD574 SUPABASE_SERVICE_ROLE_KEY \uC5D0 \uB123\uC73C\uC138\uC694.");
    console.log("  \u2192 \uC815\uC0C1 PC\uC758 .env \uB97C \uD1B5\uC9F8\uB85C \uBCF5\uC0AC\uD574\uB3C4 \uB429\uB2C8\uB2E4.");
    exitWithPause(1);
  }
  console.log("");
  console.log("-".repeat(50));
  log("[4/5] \uC758\uC874\uC131 \uC124\uCE58");
  console.log("-".repeat(50));
  if (!runCommand("npm --version", { silent: true, cwd: INSTALL_DIR })) {
    console.log("[\uC624\uB958] npm\uC774 \uC124\uCE58\uB418\uC5B4 \uC788\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
    console.log("https://nodejs.org \uC5D0\uC11C Node.js\uB97C \uC124\uCE58\uD574\uC8FC\uC138\uC694.");
    exitWithPause(1);
  }
  log("npm install... (\uC2DC\uAC04\uC774 \uAC78\uB9B4 \uC218 \uC788\uC2B5\uB2C8\uB2E4, tsx \uD3EC\uD568 devDependencies)");
  const installOk = runCommand(
    "npm install --legacy-peer-deps --include=dev",
    {
      cwd: INSTALL_DIR,
      env: {
        NPM_CONFIG_PRODUCTION: "false",
        NODE_ENV: "development"
      }
    }
  );
  if (installOk) {
    log("\uC758\uC874\uC131 \uC124\uCE58 \uC644\uB8CC");
  } else {
    console.log("[\uACBD\uACE0] npm install \uC2E4\uD328");
    console.log("\uAE30\uC874 node_modules\uB85C \uACC4\uC18D \uC2DC\uB3C4\uD569\uB2C8\uB2E4.");
  }
  const tsxCli = path3.join(INSTALL_DIR, "node_modules", "tsx", "dist", "cli.mjs");
  if (!fs3.existsSync(tsxCli)) {
    log("tsx \uC5C6\uC74C \u2192 \uCD94\uAC00 \uC124\uCE58 \uC2DC\uB3C4...");
    runCommand("npm install tsx@^4.7.0 --save-dev --legacy-peer-deps", {
      cwd: INSTALL_DIR,
      env: { NPM_CONFIG_PRODUCTION: "false" }
    });
  }
  console.log("");
  console.log("-".repeat(50));
  log("Supabase \uC5F0\uACB0 \uD655\uC778");
  console.log("-".repeat(50));
  const verifyScript = path3.join(INSTALL_DIR, "rank-check", "scripts", "verify-supabase-env.ts");
  if (fs3.existsSync(verifyScript) && fs3.existsSync(tsxCli)) {
    const nodeExe = process.execPath;
    const verifyOk = runCommand(`"${nodeExe}" "${tsxCli}" "${verifyScript}"`, {
      cwd: INSTALL_DIR,
      env: { ...process.env, ...fileEnv }
    });
    if (!verifyOk) {
      console.log("");
      console.log("[\uC624\uB958] Supabase\uC5D0 \uC5F0\uACB0\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
      console.log(`  .env: ${envPath}`);
      console.log("  \u2192 \uC815\uC0C1 PC\uC758 .env(SUPABASE_URL, sb_secret_ \uD0A4)\uB97C \uBCF5\uC0AC\uD558\uC138\uC694.");
      console.log("  \u2192 Legacy JWT(eyJ\u2026)\uB294 \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
      console.log("  \u2192 \uBC29\uD654\uBCBD/\uB9DD\uC5D0\uC11C *.supabase.co \uCC28\uB2E8 \uC5EC\uBD80\uB97C \uD655\uC778\uD558\uC138\uC694.");
      exitWithPause(1);
    }
  } else {
    log("Supabase \uC810\uAC80 \uC2A4\uD06C\uB9BD\uD2B8 \uC5C6\uC74C \u2014 \uC2A4\uD0B5");
  }
  console.log("");
  console.log("-".repeat(50));
  log("[5/5] \uC6D0\uACA9 \uAC10\uC2DC \uB7F0\uCC98 \uC2DC\uC791 (Git 5\uBD84 + \uD1B5\uD569 \uC2E4\uD589)");
  console.log("-".repeat(50));
  const launcherRel = resolveLauncherScript();
  if (!launcherRel) {
    console.log("[\uC624\uB958] \uB7F0\uCC98 \uC2A4\uD06C\uB9BD\uD2B8\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
    console.log("  GitHub main\uC5D0 \uCD5C\uC2E0 \uCF54\uB4DC\uAC00 push \uB418\uC5C8\uB294\uC9C0 \uD655\uC778\uD558\uC138\uC694.");
    console.log(`  \uC124\uCE58 \uD3F4\uB354: ${INSTALL_DIR}`);
    exitWithPause(1);
  }
  if (!isUnifiedLauncher(launcherRel)) {
    console.log("");
    console.log("[\uC624\uB958] \uAD6C\uBC84\uC804 \uC800\uC7A5\uC18C/\uB7F0\uCC98(auto-update)\uB9CC \uC788\uC2B5\uB2C8\uB2E4. \uD1B5\uD569 \uB7EC\uB108\uB97C \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
    console.log(`  \uD604\uC7AC Git origin\uC774 ${GIT_REPO} \uC778\uC9C0 \uD655\uC778 \uD6C4 EXE\uB97C \uB2E4\uC2DC \uC2E4\uD589\uD558\uC138\uC694.`);
    console.log("  \uC218\uB3D9 \uAD50\uC815:");
    console.log(`    cd "${INSTALL_DIR}"`);
    console.log(`    git remote set-url origin ${GIT_REPO}`);
    console.log(`    git fetch origin ${GIT_BRANCH2} && git reset --hard origin/${GIT_BRANCH2}`);
    exitWithPause(1);
  }
  const unified = isUnifiedLauncher(launcherRel);
  const useBootstrapGitWatch = unified && !launcherRel.includes("remote-watch");
  log(`\uC2E4\uD589: ${launcherRel}`);
  console.log("");
  console.log("=".repeat(50));
  if (unified) {
    console.log("  \uD1B5\uD569 \uB7EC\uB108: \uC1FC\uD551(\uC720\uB8CC)\u2192\uCFE0\uD321(\uC720\uB8CC)\u2192\uD50C\uB808\uC774\uC2A4(\uC720\uB8CC)\u2192\uD50C\uB808\uC774\uC2A4(\uBB34\uB8CC)\u2192\uC1FC\uD551(\uBB34\uB8CC)\u2192\uCFE0\uD321(\uBB34\uB8CC)");
    console.log(
      useBootstrapGitWatch ? "  Git 5\uBD84\uB9C8\uB2E4 \uC5C5\uB370\uC774\uD2B8 (\uBD80\uD2B8\uC2A4\uD2B8\uB7A9 \uAC10\uC2DC)" : "  Git 5\uBD84\uB9C8\uB2E4 \uC5C5\uB370\uC774\uD2B8 (remote-watch-launcher)"
    );
  } else {
    console.log("  \u26A0\uFE0F \uC1FC\uD551 \uC21C\uC704\uCCB4\uD06C\uB9CC \uC2E4\uD589 (\uAD6C\uBC84\uC804 auto-update-launcher)");
    console.log("  \uD1B5\uD569 \uC2E4\uD589: run-unified.ts \uAC00 \uC124\uCE58 \uD3F4\uB354\uC5D0 \uC788\uB294\uC9C0 \uD655\uC778\uD558\uC138\uC694.");
  }
  console.log("  \uC885\uB8CC: Ctrl+C");
  console.log("=".repeat(50));
  console.log("");
  let child = null;
  let lastGitCheck = 0;
  let shuttingDown = false;
  const startChild = () => {
    const { command, args, shell } = getTsxSpawn(launcherRel);
    log(`\u25B6\uFE0F ${command} ${args.join(" ")}`);
    child = (0, import_child_process2.spawn)(command, args, {
      cwd: INSTALL_DIR,
      stdio: "inherit",
      shell,
      windowsHide: false,
      env: buildChildEnv()
    });
    child.on("error", (error) => {
      console.log(`[\uC624\uB958] \uC2E4\uD589 \uC2E4\uD328: ${error.message}`);
      exitWithPause(1);
    });
    child.on("close", (code) => {
      child = null;
      if (shuttingDown) {
        process.exit(code || 0);
        return;
      }
      log(`\uD504\uB85C\uC138\uC2A4 \uC885\uB8CC (\uCF54\uB4DC: ${code ?? "?"}) \u2014 5\uCD08 \uD6C4 \uC7AC\uC2DC\uC791`);
      setTimeout(() => {
        if (!shuttingDown) startChild();
      }, 5e3);
    });
  };
  startChild();
  if (useBootstrapGitWatch) {
    setInterval(async () => {
      if (shuttingDown) return;
      const now = Date.now();
      if (now - lastGitCheck < GIT_CHECK_INTERVAL_MS) return;
      lastGitCheck = now;
      const result = await syncGitRepo(INSTALL_DIR, { hardReset: true });
      if (result.updated) {
        log(`Git \uC5C5\uB370\uC774\uD2B8 \u2192 \uD1B5\uD569 \uB7EC\uB108 \uC7AC\uC2DC\uC791 (${result.message})`);
        killChildTree(child);
        child = null;
        setTimeout(() => {
          if (!shuttingDown) startChild();
        }, 2e3);
      }
    }, 6e4);
  }
  process.on("SIGINT", () => {
    shuttingDown = true;
    console.log("");
    log("\uC885\uB8CC \uC2E0\uD638 \uC218\uC2E0...");
    killChildTree(child);
    process.exit(0);
  });
}
main().catch((error) => {
  console.error("[\uC624\uB958]", error);
  exitWithPause(1);
});
