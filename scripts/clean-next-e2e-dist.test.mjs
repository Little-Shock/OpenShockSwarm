import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { cleanNextE2EArtifacts } from "./clean-next-e2e-dist.mjs";

test("cleanNextE2EArtifacts removes stale Next dist folders and normalizes tsconfig includes", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "openshock-clean-next-"));
  const webRoot = path.join(projectRoot, "apps", "web");
  const nextVerifyRoot = path.join(webRoot, ".next-verify", "trace-build");
  const nextE2ERoot = path.join(webRoot, ".next-e2e-demo", "types");
  const scopedTsconfigPath = path.join(webRoot, ".tsconfig-next-e2e-demo.json");
  const tsconfigPath = path.join(webRoot, "tsconfig.json");

  await mkdir(nextVerifyRoot, { recursive: true });
  await mkdir(nextE2ERoot, { recursive: true });
  await writeFile(path.join(nextVerifyRoot, "trace.txt"), "trace\n", "utf8");
  await writeFile(path.join(nextE2ERoot, "demo.txt"), "demo\n", "utf8");
  await writeFile(scopedTsconfigPath, "{\n}\n", "utf8");
  await writeFile(
    tsconfigPath,
    `${JSON.stringify(
      {
        include: [
          "next-env.d.ts",
          ".next-verify/types/**/*.ts",
          ".next-verify/dev/types/**/*.ts",
          ".next-e2e-demo/types/**/*.ts",
          ".next-e2e-*/types/**/*.ts",
          ".next-e2e-*/dev/types/**/*.ts",
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  try {
    const result = await cleanNextE2EArtifacts(projectRoot);
    assert.equal(result.cleanedDirs, 2);
    assert.equal(result.cleanedScopedTsconfigFiles, 1);
    assert.equal(result.normalizedTsconfig, true);

    await assert.rejects(() => readFile(path.join(nextVerifyRoot, "trace.txt"), "utf8"));
    await assert.rejects(() => readFile(path.join(nextE2ERoot, "demo.txt"), "utf8"));
    await assert.rejects(() => readFile(scopedTsconfigPath, "utf8"));

    const tsconfig = JSON.parse(await readFile(tsconfigPath, "utf8"));
    assert.deepEqual(tsconfig.include, [
      "next-env.d.ts",
      ".next-e2e-*/types/**/*.ts",
      ".next-e2e-*/dev/types/**/*.ts",
    ]);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
