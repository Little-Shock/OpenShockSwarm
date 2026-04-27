import { spawnSync } from "node:child_process";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { normalizeNextE2ETsconfig } from "../clean-next-e2e-dist.mjs";

function timestamp() {
  return new Date().toISOString();
}

const RECOVERABLE_BUILD_ARTIFACTS = [
  ".nft.json",
  "build-manifest.json",
  "routes-manifest.json",
  "prerender-manifest.json",
  "required-server-files.json",
  "pages-manifest.json",
  "app-paths-manifest.json",
];

const REQUIRED_BUILD_ARTIFACTS = [
  "BUILD_ID",
  "build-manifest.json",
  "routes-manifest.json",
  "required-server-files.json",
  "server/pages-manifest.json",
  "server/app-paths-manifest.json",
  "server/app/page.js.nft.json",
];

function isRetryableNextArtifactMiss(result) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.toLowerCase();
  return output.includes("enoent") && RECOVERABLE_BUILD_ARTIFACTS.some((artifact) => output.includes(artifact));
}

function isRetryableNextBuildLock(result) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.toLowerCase();
  return output.includes("another next build process is already running");
}

async function pathStatsOrNull(targetPath) {
  try {
    return await stat(targetPath);
  } catch {
    return null;
  }
}

async function waitForRecoveredBuildArtifacts(webDistDir, timeoutMs = 45_000, intervalMs = 500) {
  const started = Date.now();
  const lockPath = path.join(webDistDir, "lock");
  let lastNewestMtimeMs = -1;
  let stablePasses = 0;

  while (Date.now() - started < timeoutMs) {
    const lockStats = await pathStatsOrNull(lockPath);
    let newestArtifactMtimeMs = 0;
    let allArtifactsPresent = true;

    for (const relativePath of REQUIRED_BUILD_ARTIFACTS) {
      const artifactStats = await pathStatsOrNull(path.join(webDistDir, relativePath));
      if (!artifactStats?.isFile()) {
        allArtifactsPresent = false;
        break;
      }
      newestArtifactMtimeMs = Math.max(newestArtifactMtimeMs, artifactStats.mtimeMs);
    }

    if (!lockStats && allArtifactsPresent) {
      stablePasses = newestArtifactMtimeMs === lastNewestMtimeMs ? stablePasses + 1 : 1;
      lastNewestMtimeMs = newestArtifactMtimeMs;
      if (stablePasses >= 2) {
        return true;
      }
    } else {
      stablePasses = 0;
      lastNewestMtimeMs = -1;
    }

    await delay(intervalMs);
  }

  return false;
}

async function normalizeTrackedTsconfig(projectRoot, log) {
  const normalized = await normalizeNextE2ETsconfig(projectRoot);
  if (normalized) {
    log.push(`[${timestamp()}] normalized apps/web/tsconfig.json after build attempt`, "");
  }
}

function uniqueStrings(values) {
  return [...new Set(values.filter((entry) => typeof entry === "string" && entry.length > 0))];
}

function scopedIncludeEntries(include, distDirName) {
  const distDirTypes = typeof distDirName === "string" && distDirName.length > 0
    ? [`${distDirName}/types/**/*.ts`, `${distDirName}/dev/types/**/*.ts`]
    : [];
  return uniqueStrings([
    ...include.filter(
      (entry) =>
        typeof entry !== "string" ||
        (!/^\.next-e2e-[^*]/.test(entry) &&
          !/^\.next-verify(?:-[^/*]+)?(?:\/|$)/.test(entry))
    ),
    ".next-e2e-*/types/**/*.ts",
    ".next-e2e-*/dev/types/**/*.ts",
    ".next-verify-*/types/**/*.ts",
    ".next-verify-*/dev/types/**/*.ts",
    ...distDirTypes,
  ]);
}

async function createScopedTsconfig(projectRoot, distDirName) {
  const webRoot = path.join(projectRoot, "apps", "web");
  const baseTsconfigPath = path.join(webRoot, "tsconfig.json");
  const scopedTsconfigName = `.next-e2e-tsconfig-${distDirName.replace(/[^a-z0-9-]+/gi, "-")}.json`;
  const scopedTsconfigPath = path.join(webRoot, scopedTsconfigName);
  const parsed = JSON.parse(await readFile(baseTsconfigPath, "utf8"));
  const include = scopedIncludeEntries(Array.isArray(parsed.include) ? parsed.include : [], distDirName);

  await writeFile(
    scopedTsconfigPath,
    `${JSON.stringify({ extends: "./tsconfig.json", include }, null, 2)}\n`,
    "utf8"
  );

  return { scopedTsconfigName, scopedTsconfigPath };
}

export async function buildHeadedWebApp({
  projectRoot,
  webDistDir,
  webEnv,
  buildLogPath,
  failureMessage = "web build failed before headed replay",
}) {
  const log = [];
  const maxAttempts = 5;
  const distDirName = webEnv.OPENSHOCK_NEXT_DIST_DIR?.trim() || "";
  const webRoot = path.join(projectRoot, "apps", "web");
  let lastScopedTsconfig = null;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const scopedTsconfig = distDirName ? await createScopedTsconfig(projectRoot, distDirName) : null;
      const buildEnv = scopedTsconfig
        ? {
            ...webEnv,
            OPENSHOCK_NEXT_TSCONFIG_PATH: scopedTsconfig.scopedTsconfigName,
          }
        : webEnv;
      lastScopedTsconfig = scopedTsconfig;

      await rm(webDistDir, { recursive: true, force: true });

      const result = spawnSync("pnpm", ["build"], {
        cwd: webRoot,
        env: buildEnv,
        encoding: "utf8",
      });

      log.push(
        `[${timestamp()}] attempt ${attempt}/${maxAttempts}: (cd apps/web && pnpm build)`,
        scopedTsconfig ? `[${timestamp()}] using scoped tsconfig ${scopedTsconfig.scopedTsconfigName}` : "",
        result.stdout ?? "",
        result.stderr ?? "",
        `[${timestamp()}] exited code=${result.status} signal=${result.signal ?? "null"}`,
        ""
      );

      if (result.status === 0) {
        await normalizeTrackedTsconfig(projectRoot, log);
        await writeFile(buildLogPath, log.join("\n"), "utf8");
        return;
      }

      const retryableArtifactMiss = isRetryableNextArtifactMiss(result);
      const retryableBuildLock = isRetryableNextBuildLock(result);

      if (retryableArtifactMiss || retryableBuildLock) {
        log.push(
          `[${timestamp()}] waiting for Next build lock/artifacts to settle after non-zero exit`,
          ""
        );
        const recoveredArtifacts = await waitForRecoveredBuildArtifacts(webDistDir);
        if (recoveredArtifacts) {
          log.push(
            `[${timestamp()}] Next build returned non-zero but recovered artifacts completed after lock release; continuing with generated dist`,
            ""
          );
          await normalizeTrackedTsconfig(projectRoot, log);
          await writeFile(buildLogPath, log.join("\n"), "utf8");
          return;
        }
      }

      await normalizeTrackedTsconfig(projectRoot, log);

      if (attempt < maxAttempts && retryableArtifactMiss) {
        log.push(`[${timestamp()}] retrying after transient Next trace artifact miss`, "");
        continue;
      }

      if (attempt < maxAttempts && retryableBuildLock) {
        const retryDelayMs = attempt * 3_000;
        log.push(
          `[${timestamp()}] retrying after Next build lock contention; waiting ${retryDelayMs}ms before retry`,
          ""
        );
        await delay(retryDelayMs);
        continue;
      }

      await writeFile(buildLogPath, log.join("\n"), "utf8");
      throw new Error(`${failureMessage}. See ${buildLogPath}`);
    }
  } finally {
    if (lastScopedTsconfig) {
      await rm(lastScopedTsconfig.scopedTsconfigPath, { force: true });
    }
  }
}
