#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = path.join(repoRoot, "apps", "web", "src");
const statePath = path.join(repoRoot, "data", "phase0", "state.json");
const importGuardAllowlist = new Set([
  "apps/web/src/components/phase-zero-views.tsx",
  "apps/web/src/lib/mock-data.ts",
]);

const uiCopyMatchers = [/^apps\/web\/src\/components\/.*\.tsx$/, /^apps\/web\/src\/app\/.*\.tsx$/];
const bannedCopyRules = [
  { label: "stale mock wording", pattern: /本地 mock/g },
  { label: "stale mock wording", pattern: /还在 mock/g },
  { label: "stale mock wording", pattern: /mock 频道/g },
  { label: "stale mock wording", pattern: /mock room/g },
  { label: "stale mock wording", pattern: /mock 卡片/g },
  { label: "stale mock wording", pattern: /mock issue/g },
  { label: "stale mock wording", pattern: /mock run/g },
  { label: "stale mock wording", pattern: /mock agent/g },
  { label: "stale mock wording", pattern: /mock workspace/g },
  { label: "placeholder leak wording", pattern: /placeholder 注释窗口/g },
];

const stateStringKeys = new Set([
  "title",
  "summary",
  "message",
  "purpose",
  "room",
  "label",
  "nextAction",
  "reviewSummary",
  "branch",
  "worktree",
  "worktreePath",
  "cwd",
  "path",
  "scope",
  "pullRequest",
  "controlNote",
  "content",
  "defaultRoute",
  "fromLane",
  "toLane",
  "policy",
  "errorMessage",
  "replayAnchor",
  "failureAnchor",
  "closeoutReason",
  "actor",
]);
const stateLeakPatterns = [
  { label: "question-burst residue", test: (value) => /\?{2,}/.test(value) },
  { label: "e2e date residue", test: (value) => /\bE2E\b.*\b20\d{6,}\b/i.test(value) },
  { label: "placeholder residue", test: (value) => /\bplaceholder\b|\bfixture\b|\btest-only\b/i.test(value) },
  { label: "todo residue", test: (value) => /\bTODO\b/.test(value) },
  { label: "mock residue", test: (value) => /本地 mock|还在 mock|mock 频道|mock room|mock 卡片|mock issue|mock run|mock agent|mock workspace/.test(value) },
  { label: "internal path residue", test: (value) => /[A-Za-z]:\\|\/tmp\/openshock|\.openshock-worktrees|\.slock\//.test(value) },
];

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

function toPosixRelative(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function lineNumberForIndex(content, index) {
  return content.slice(0, index).split("\n").length;
}

function shouldCheckCopy(relPath) {
  return uiCopyMatchers.some((pattern) => pattern.test(relPath));
}

function shouldCheckImport(relPath) {
  return relPath.startsWith("apps/web/src/") && !importGuardAllowlist.has(relPath);
}

function inspectStateValue(value, trail, findings) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectStateValue(item, `${trail}[${index}]`, findings));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const nextTrail = trail ? `${trail}.${key}` : key;
    if (typeof nested === "string" && stateStringKeys.has(key)) {
      const trimmed = nested.trim();
      for (const pattern of stateLeakPatterns) {
        if (trimmed && pattern.test(trimmed)) {
          findings.push({ relPath: "data/phase0/state.json", line: nextTrail, message: `${pattern.label}: ${trimmed}` });
          break;
        }
      }
      continue;
    }
    inspectStateValue(nested, nextTrail, findings);
  }
}

const findings = [];
const files = await walk(webRoot);

for (const filePath of files) {
  if (!/\.(ts|tsx)$/.test(filePath)) {
    continue;
  }
  const relPath = toPosixRelative(filePath);
  const content = await fs.readFile(filePath, "utf8");

  if (shouldCheckImport(relPath) && content.includes('from "@/lib/mock-data"')) {
    findings.push({
      relPath,
      line: lineNumberForIndex(content, content.indexOf('from "@/lib/mock-data"')),
      message: 'live surface must not import from "@/lib/mock-data"',
    });
  }

  if (!shouldCheckCopy(relPath)) {
    continue;
  }
  for (const rule of bannedCopyRules) {
    for (const match of content.matchAll(rule.pattern)) {
      findings.push({
        relPath,
        line: lineNumberForIndex(content, match.index ?? 0),
        message: `${rule.label}: ${match[0]}`,
      });
    }
  }
}

let stateChecked = false;
try {
  const stateContent = await fs.readFile(statePath, "utf8");
  stateChecked = true;
  inspectStateValue(JSON.parse(stateContent), "", findings);
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
    stateChecked = false;
  } else {
    throw error;
  }
}

if (findings.length > 0) {
  console.error("live truth hygiene failed:");
  for (const finding of findings) {
    console.error(`- ${finding.relPath}:${finding.line} ${finding.message}`);
  }
  process.exit(1);
}

console.log(
  `live truth hygiene ok: checked ${files.length} web source files${stateChecked ? " and current state file" : ""}; no disallowed mock-data imports, banned placeholder wording, or tracked live-truth residue found.`
);
