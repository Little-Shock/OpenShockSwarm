#!/usr/bin/env node

import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function normalizeNextE2ETsconfig(projectRoot = path.resolve(__dirname, "..")) {
  const webRoot = path.join(projectRoot, "apps", "web");
  const tsconfigPath = path.join(webRoot, "tsconfig.json");

  const tsconfig = JSON.parse(await readFile(tsconfigPath, "utf8"));
  const include = Array.isArray(tsconfig.include) ? tsconfig.include : [];
  const nextE2EWildcards = new Set([
    ".next-e2e-*/types/**/*.ts",
    ".next-e2e-*/dev/types/**/*.ts",
    ".next-verify-*/types/**/*.ts",
    ".next-verify-*/dev/types/**/*.ts",
  ]);
  const normalizedInclude = include.filter((entry) => {
    if (typeof entry !== "string") {
      return true;
    }
    if (nextE2EWildcards.has(entry)) {
      return true;
    }
    return (
      !/^\.next-e2e-[^*]/.test(entry) &&
      !/^\.next-verify(?:-[^/*]+)?(?:\/|$)/.test(entry)
    );
  });

  const normalized = normalizedInclude.length !== include.length;
  if (normalized) {
    tsconfig.include = normalizedInclude;
    await writeFile(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`, "utf8");
  }

  return normalized;
}

export async function cleanNextE2EArtifacts(projectRoot = path.resolve(__dirname, "..")) {
  const webRoot = path.join(projectRoot, "apps", "web");
  const entries = await readdir(webRoot, { withFileTypes: true });
  const staleDirs = entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        (entry.name.startsWith(".next-e2e") ||
          entry.name === ".next-verify" ||
          entry.name.startsWith(".next-verify-"))
    )
    .map((entry) => path.join(webRoot, entry.name));

  for (const target of staleDirs) {
    // Next can still leave trace/build files behind briefly after an interrupted verify run.
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }

  const normalized = await normalizeNextE2ETsconfig(projectRoot);

  const scopedTsconfigEntries = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        (/^\.tsconfig-next-e2e-.*\.json$/.test(entry.name) ||
          /^\.next-e2e-tsconfig-.*\.json$/.test(entry.name))
    )
    .map((entry) => path.join(webRoot, entry.name));

  await Promise.all(scopedTsconfigEntries.map((target) => rm(target, { force: true })));

  return {
    cleanedDirs: staleDirs.length,
    normalizedTsconfig: normalized,
    cleanedScopedTsconfigFiles: scopedTsconfigEntries.length,
  };
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedAsScript) {
  const result = await cleanNextE2EArtifacts();
  if (result.cleanedDirs > 0 || result.normalizedTsconfig || result.cleanedScopedTsconfigFiles > 0) {
    const summary = [
      result.cleanedDirs > 0 ? `cleaned ${result.cleanedDirs} Next E2E dist dir(s)` : "",
      result.normalizedTsconfig ? "normalized apps/web/tsconfig.json" : "",
      result.cleanedScopedTsconfigFiles > 0 ? `removed ${result.cleanedScopedTsconfigFiles} scoped Next E2E tsconfig file(s)` : "",
    ]
      .filter(Boolean)
      .join("; ");
    console.log(summary);
  }
}
