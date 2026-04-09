#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const serverURL = normalizeURL(process.env.OPENSHOCK_SERVER_URL || "http://127.0.0.1:8080");
const endpoint = `${serverURL}/v1/experience-metrics`;

const response = await fetch(endpoint);
if (!response.ok) {
  const body = await response.text();
  throw new Error(`GET ${endpoint} failed with ${response.status}: ${body.slice(0, 400)}`);
}

const snapshot = await response.json();
assertSnapshot(snapshot);

if (args.json) {
  console.log(JSON.stringify(snapshot, null, 2));
} else {
  const report = buildReport(serverURL, snapshot);
  console.log(report);
  if (args.reportPath) {
    const reportPath = path.resolve(process.cwd(), args.reportPath);
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${report}\n`, "utf8");
    console.error(`experience metrics report written to ${reportPath}`);
  }
}

function parseArgs(argv) {
  const result = {
    json: false,
    reportPath: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--json") {
      result.json = true;
      continue;
    }
    if (value === "--report") {
      result.reportPath = argv[index + 1] ?? "";
      index += 1;
    }
  }

  return result;
}

function normalizeURL(value) {
  return String(value).trim().replace(/\/+$/, "");
}

function assertSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("experience metrics response must be an object");
  }
  if (!Array.isArray(snapshot.sections) || snapshot.sections.length === 0) {
    throw new Error("experience metrics response missing sections");
  }
}

function buildReport(serverURL, snapshot) {
  const lines = [
    "# Experience Metrics Probe",
    "",
    `- Server: \`${serverURL}\``,
    `- Refreshed At: \`${snapshot.refreshedAt}\``,
    `- Workspace: \`${snapshot.workspace}\``,
    `- Repo: \`${snapshot.repo || "unset"}\``,
    `- Branch: \`${snapshot.branch || "unset"}\``,
    `- Summary: ${snapshot.summary}`,
    `- Methodology: ${snapshot.methodology}`,
    "",
  ];

  for (const section of snapshot.sections) {
    lines.push(`## ${section.label}`);
    lines.push("");
    lines.push(`- Summary: ${section.summary}`);
    lines.push(
      `- Counts: ready=${section.readyCount} warning=${section.warningCount} blocked=${section.blockedCount} partial=${section.partialCount}`,
    );
    for (const metric of section.metrics || []) {
      lines.push(
        `- [${statusLabel(metric.status)}] ${metric.label}: ${metric.value} | target: ${metric.target} | ${metric.summary}${metric.href ? ` | href: ${metric.href}` : ""}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function statusLabel(status) {
  switch (status) {
    case "ready":
      return "READY";
    case "warning":
      return "WARNING";
    case "blocked":
      return "BLOCKED";
    case "partial":
      return "PARTIAL";
    default:
      return String(status || "UNKNOWN").toUpperCase();
  }
}
