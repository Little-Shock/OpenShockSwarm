#!/usr/bin/env node

import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(args) {
  const result = {
    port: "",
    workspaceRoot: "",
    hitsFile: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--port") {
      result.port = args[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (value === "--workspace-root") {
      result.workspaceRoot = args[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (value === "--hits-file") {
      result.hitsFile = args[index + 1] ?? "";
      index += 1;
    }
  }

  return result;
}

const parsed = parseArgs(process.argv.slice(2));
const port = Number(parsed.port);
const workspaceRoot = parsed.workspaceRoot || process.cwd();
const hitsFile = parsed.hitsFile ? path.resolve(parsed.hitsFile) : "";
const hits = { exec: 0, runtime: 0, healthz: 0 };

if (!Number.isFinite(port) || port <= 0) {
  throw new Error("mock daemon requires --port");
}

async function persistHits() {
  if (!hitsFile) {
    return;
  }
  await mkdir(path.dirname(hitsFile), { recursive: true });
  await writeFile(hitsFile, JSON.stringify(hits, null, 2), "utf8");
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    hits.healthz += 1;
    void persistHits();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "synthetic-openshock-daemon" }));
    return;
  }

  if (req.method === "GET" && req.url === "/v1/runtime") {
    hits.runtime += 1;
    void persistHits();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        runtimeId: "shock-main",
        daemonUrl: `http://127.0.0.1:${port}`,
        machine: "shock-main",
        detectedCli: ["codex"],
        providers: [
          {
            id: "codex",
            label: "Codex CLI",
            mode: "direct-cli",
            capabilities: ["conversation", "non-interactive-exec"],
            models: ["gpt-5.3-codex"],
            transport: "http bridge",
          },
        ],
        shell: "bash",
        state: "online",
        workspaceRoot,
        reportedAt: new Date().toISOString(),
        heartbeatIntervalSeconds: 10,
        heartbeatTimeoutSeconds: 45,
      })
    );
    return;
  }

  if (req.method === "POST" && req.url === "/v1/exec") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      const payload = body ? JSON.parse(body) : {};
      hits.exec += 1;
      void persistHits();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          provider: payload.provider || "codex",
          output: `synthetic daemon output for ${payload.runId || "adhoc"}`,
        })
      );
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

async function shutdown(code = 0) {
  await persistHits().catch(() => {});
  server.close(() => {
    process.exit(code);
  });
}

process.on("SIGTERM", () => {
  void shutdown(0);
});

process.on("SIGINT", () => {
  void shutdown(0);
});

await persistHits();
await new Promise((resolve, reject) => {
  server.on("error", reject);
  server.listen(port, "127.0.0.1", resolve);
});
