import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

function resolveLinuxChromiumExecutable() {
  const candidates = [
    process.env.OPENSHOCK_CHROMIUM_PATH,
    "/snap/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // try next candidate
    }
  }

  throw new Error("No executable Chromium binary found. Set OPENSHOCK_CHROMIUM_PATH to continue.");
}

function windowsPathToWslPath(windowsPath) {
  const normalized = windowsPath.replace(/\\/g, "/");
  const drivePrefix = normalized.match(/^([A-Za-z]):\//);
  if (!drivePrefix) {
    return normalized;
  }
  return `/mnt/${drivePrefix[1].toLowerCase()}${normalized.slice(2)}`;
}

function resolveWindowsChromeExecutable() {
  const candidates = [
    process.env.OPENSHOCK_WINDOWS_CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      accessSync(windowsPathToWslPath(candidate), fsConstants.F_OK);
      return candidate;
    } catch {
      // try next candidate
    }
  }

  throw new Error("No Windows Chrome executable found. Set OPENSHOCK_WINDOWS_CHROME_PATH to continue.");
}

function resolveWindowsChromeUserDataDir() {
  return process.env.OPENSHOCK_WINDOWS_CHROME_USER_DATA_DIR?.trim() || "C:\\Users\\30477\\AppData\\Local\\Temp\\OpenShockCDP";
}

async function waitForCdpReady(url, timeoutMs = 15_000) {
  const started = Date.now();
  let lastError = null;

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${url.replace(/\/$/, "")}/json/version`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }

  if (lastError instanceof Error) {
    throw new Error(`Windows Chrome CDP did not become ready at ${url}: ${lastError.message}`);
  }
  throw new Error(`Windows Chrome CDP did not become ready at ${url}`);
}

function startWindowsChrome(cdpUrl) {
  const cmdPath = "/mnt/c/Windows/System32/cmd.exe";
  accessSync(cmdPath, fsConstants.X_OK);

  const port = new URL(cdpUrl).port || "9222";
  const chromePath = resolveWindowsChromeExecutable();
  const userDataDir = resolveWindowsChromeUserDataDir();
  const command = `start "" "${chromePath}" --remote-debugging-port=${port} --user-data-dir="${userDataDir}" --new-window about:blank`;

  const child = spawn(cmdPath, ["/c", command], {
    cwd: "/mnt/c/Windows/System32",
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export async function launchChromiumSession(chromium) {
  const cdpUrl = process.env.OPENSHOCK_CHROMIUM_CDP_URL?.trim();

  if (process.env.OPENSHOCK_WINDOWS_CHROME === "1") {
    const effectiveCdpUrl = cdpUrl || `http://127.0.0.1:${process.env.OPENSHOCK_WINDOWS_CHROME_CDP_PORT?.trim() || "9222"}`;
    startWindowsChrome(effectiveCdpUrl);
    await waitForCdpReady(effectiveCdpUrl);
    return chromium.connectOverCDP(effectiveCdpUrl);
  }

  if (cdpUrl) {
    await waitForCdpReady(cdpUrl);
    return chromium.connectOverCDP(cdpUrl);
  }

  return chromium.launch({
    executablePath: resolveLinuxChromiumExecutable(),
    headless: process.env.OPENSHOCK_E2E_HEADLESS === "1",
  });
}
