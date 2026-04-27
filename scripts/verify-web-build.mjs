#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildHeadedWebApp } from "./lib/headed-web-build.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const distDirName = process.env.OPENSHOCK_NEXT_DIST_DIR?.trim() || ".next-verify";
const webDistDir = path.join(projectRoot, "apps", "web", distDirName);
const buildLogPath = path.join(
  projectRoot,
  "apps",
  "web",
  `${distDirName.replace(/[^a-z0-9._-]+/gi, "-")}-build.log`,
);

await buildHeadedWebApp({
  projectRoot,
  webDistDir,
  webEnv: {
    ...process.env,
    OPENSHOCK_NEXT_DIST_DIR: distDirName,
  },
  buildLogPath,
  failureMessage: `verify:web build failed for ${distDirName}`,
});

console.log(`web build ok: ${path.relative(projectRoot, buildLogPath)}`);
