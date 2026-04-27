import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, "..");

const RELEASE_EVIDENCE_TYPES = {
  rc: {
    label: "release candidate",
    reportPattern: /^Test-Report-(.+)-release-candidate-gate\.md$/,
    artifactSuffix: "release-candidate",
    generateCommand: "pnpm verify:release:rc",
  },
  full: {
    label: "release full",
    reportPattern: /^Test-Report-(.+)-release-full-gate\.md$/,
    artifactSuffix: "release-full",
    generateCommand: "pnpm verify:release:full",
  },
};

function projectRoot(rootDir) {
  return path.resolve(rootDir || process.env.OPENSHOCK_RELEASE_EVIDENCE_ROOT || DEFAULT_ROOT);
}

function testingDir(rootDir) {
  return path.join(projectRoot(rootDir), "docs", "testing");
}

function latestMatch(entries, pattern, dirPath) {
  const matches = entries
    .map((entry) => {
      const groups = entry.match(pattern);
      if (!groups) {
        return null;
      }
      const absolutePath = path.join(dirPath, entry);
      return {
        entry,
        date: groups[1],
        absolutePath,
        mtimeMs: statSync(absolutePath).mtimeMs,
      };
    })
    .filter(Boolean);

  matches.sort((left, right) => {
    if (right.mtimeMs !== left.mtimeMs) {
      return right.mtimeMs - left.mtimeMs;
    }
    return right.entry.localeCompare(left.entry);
  });

  return matches[0] ?? null;
}

export function findLatestReleaseEvidence(type, options = {}) {
  const definition = RELEASE_EVIDENCE_TYPES[type];
  if (!definition) {
    throw new Error(`unknown release evidence type: ${type}`);
  }

  const docsTestingDir = testingDir(options.rootDir);
  if (!existsSync(docsTestingDir)) {
    return null;
  }

  const latest = latestMatch(readdirSync(docsTestingDir), definition.reportPattern, docsTestingDir);
  if (!latest) {
    return null;
  }

  const root = projectRoot(options.rootDir);
  const reportRelativePath = path.join("docs", "testing", latest.entry);
  const artifactRelativePath = path.join("docs", "testing", "artifacts", latest.date, definition.artifactSuffix);

  return {
    type,
    label: definition.label,
    date: latest.date,
    generateCommand: definition.generateCommand,
    reportPath: reportRelativePath,
    reportAbsolutePath: path.join(root, reportRelativePath),
    artifactDir: artifactRelativePath,
    artifactAbsolutePath: path.join(root, artifactRelativePath),
    artifactDirExists: existsSync(path.join(root, artifactRelativePath)),
  };
}

function usage() {
  return "usage: node ./scripts/release-evidence-latest.mjs [rc|full|all] [--json]";
}

function parseArgs(argv) {
  let mode = "all";
  let json = false;

  for (const arg of argv) {
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "rc" || arg === "full" || arg === "all") {
      mode = arg;
      continue;
    }
    throw new Error(usage());
  }

  return { mode, json };
}

function formatHumanReadable(results, mode) {
  const requestedTypes = mode === "all" ? ["rc", "full"] : [mode];
  return requestedTypes
    .map((type) => {
      const result = results[type];
      if (!result) {
        return `latest ${type} evidence: missing\nnext: ${RELEASE_EVIDENCE_TYPES[type].generateCommand}`;
      }
      return [
        `latest ${result.type} evidence`,
        `report: ${result.reportPath}`,
        `artifacts: ${result.artifactDir}${result.artifactDirExists ? "" : ` (missing directory; rerun ${result.generateCommand})`}`,
        `next: ${result.generateCommand}`,
      ].join("\n");
    })
    .join("\n\n");
}

function runCli() {
  const { mode, json } = parseArgs(process.argv.slice(2));
  const requestedTypes = mode === "all" ? ["rc", "full"] : [mode];
  const results = Object.fromEntries(requestedTypes.map((type) => [type, findLatestReleaseEvidence(type)]));

  const hasRequestedEvidence = requestedTypes.some((type) => results[type]);
  if (!hasRequestedEvidence) {
    console.error(formatHumanReadable(results, mode));
    process.exitCode = 1;
    return;
  }

  if (json) {
    console.log(JSON.stringify({ mode, results }, null, 2));
    return;
  }

  console.log(formatHumanReadable(results, mode));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
