import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { findLatestReleaseEvidence } from "./release-evidence-latest.mjs";

function createReport(root, reportName, artifactSuffix, mtimeMs) {
  const docsTestingDir = path.join(root, "docs", "testing");
  const reportPath = path.join(docsTestingDir, reportName);
  const date = reportName.replace(/^Test-Report-/, "").replace(/-release-(candidate-gate|full-gate)\.md$/, "");
  const artifactDir = path.join(docsTestingDir, "artifacts", date, artifactSuffix);

  mkdirSync(path.dirname(reportPath), { recursive: true });
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(reportPath, `# ${reportName}\n`);
  const mtime = new Date(mtimeMs);
  utimesSync(reportPath, mtime, mtime);
}

test("findLatestReleaseEvidence picks the newest report for each gate type", () => {
  const root = mkdtempSync(path.join(tmpdir(), "openshock-release-evidence-"));
  try {
    createReport(root, "Test-Report-2026-04-27-release-candidate-gate.md", "release-candidate", 1000);
    createReport(root, "Test-Report-2026-04-28-release-candidate-gate.md", "release-candidate", 2000);
    createReport(root, "Test-Report-2026-04-26-release-full-gate.md", "release-full", 1500);
    createReport(root, "Test-Report-2026-04-28-release-full-gate.md", "release-full", 2500);

    const rc = findLatestReleaseEvidence("rc", { rootDir: root });
    const full = findLatestReleaseEvidence("full", { rootDir: root });

    assert.equal(rc?.date, "2026-04-28");
    assert.equal(rc?.generateCommand, "pnpm verify:release:rc");
    assert.equal(rc?.reportPath, path.join("docs", "testing", "Test-Report-2026-04-28-release-candidate-gate.md"));
    assert.equal(rc?.artifactDir, path.join("docs", "testing", "artifacts", "2026-04-28", "release-candidate"));
    assert.equal(rc?.artifactDirExists, true);

    assert.equal(full?.date, "2026-04-28");
    assert.equal(full?.generateCommand, "pnpm verify:release:full");
    assert.equal(full?.reportPath, path.join("docs", "testing", "Test-Report-2026-04-28-release-full-gate.md"));
    assert.equal(full?.artifactDir, path.join("docs", "testing", "artifacts", "2026-04-28", "release-full"));
    assert.equal(full?.artifactDirExists, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("findLatestReleaseEvidence returns null when the requested report type is absent", () => {
  const root = mkdtempSync(path.join(tmpdir(), "openshock-release-evidence-empty-"));
  try {
    mkdirSync(path.join(root, "docs", "testing"), { recursive: true });
    assert.equal(findLatestReleaseEvidence("rc", { rootDir: root }), null);
    assert.equal(findLatestReleaseEvidence("full", { rootDir: root }), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
