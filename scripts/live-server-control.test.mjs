import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

test("status prefers live route truth across workspaces", async () => {
  const ownerRoot = await mkdtemp(path.join(os.tmpdir(), "openshock-live-owner-"));
  const altRoot = await mkdtemp(path.join(os.tmpdir(), "openshock-live-alt-"));
  const live = await listenWithPayload({
    service: "openshock-server",
    managed: true,
    status: "running",
    message: "live service owner metadata is present; use the recorded reload command for controlled roll/restart",
    owner: "@Andrew",
    pid: 2189538,
    workspaceRoot: ownerRoot,
    repoRoot,
    address: "",
    baseUrl: "",
    healthUrl: "",
    stateUrl: "",
    metadataPath: path.join(ownerRoot, "data", "ops", "live-server.json"),
    logPath: path.join(ownerRoot, "data", "logs", "openshock-server.log"),
    branch: "tkt-59-live-service-owner-control",
    head: "7c0f3f6",
    launchCommand: "mock launch",
    launchedAt: "2026-04-09T05:20:00Z",
    statusCommand: "",
    startCommand: "",
    stopCommand: "",
    reloadCommand: "",
  });
  const baseUrl = `http://127.0.0.1:${live.port}`;
  live.payload.address = `127.0.0.1:${live.port}`;
  live.payload.baseUrl = baseUrl;
  live.payload.healthUrl = `${baseUrl}/healthz`;
  live.payload.stateUrl = `${baseUrl}/v1/state`;
  live.payload.statusCommand = `pnpm --dir ${JSON.stringify(repoRoot)} ops:live-server:status -- --workspace-root ${JSON.stringify(ownerRoot)} --server-url ${JSON.stringify(baseUrl)} --server-addr ${JSON.stringify(live.payload.address)}`;
  live.payload.startCommand = `pnpm --dir ${JSON.stringify(repoRoot)} ops:live-server:start -- --workspace-root ${JSON.stringify(ownerRoot)} --server-url ${JSON.stringify(baseUrl)} --server-addr ${JSON.stringify(live.payload.address)}`;
  live.payload.stopCommand = `pnpm --dir ${JSON.stringify(repoRoot)} ops:live-server:stop -- --workspace-root ${JSON.stringify(ownerRoot)} --server-url ${JSON.stringify(baseUrl)} --server-addr ${JSON.stringify(live.payload.address)}`;
  live.payload.reloadCommand = `pnpm --dir ${JSON.stringify(repoRoot)} ops:live-server:reload -- --workspace-root ${JSON.stringify(ownerRoot)} --server-url ${JSON.stringify(baseUrl)} --server-addr ${JSON.stringify(live.payload.address)}`;

  const status = await runStatus({
    OPENSHOCK_WORKSPACE_ROOT: altRoot,
    OPENSHOCK_SERVER_ADDR: live.payload.address,
    OPENSHOCK_SERVER_URL: baseUrl,
  });

  assert.equal(status.managed, true);
  assert.equal(status.status, "running");
  assert.equal(status.owner, "@Andrew");
  assert.equal(status.workspaceRoot, ownerRoot);
  assert.equal(status.metadataPath, path.join(ownerRoot, "data", "ops", "live-server.json"));
  assert.equal(status.branch, "tkt-59-live-service-owner-control");
  assert.equal(status.head, "7c0f3f6");
  assert.match(status.reloadCommand, /--workspace-root/);
  await closeServer(live.server);
});

test("status falls back to workspace metadata when live route is unavailable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openshock-live-local-"));
  const metadataPath = path.join(root, "data", "ops", "live-server.json");
  await mkdir(path.dirname(metadataPath), { recursive: true });
  const live = await listenWithHandlers({
    "/v1/runtime/live-service": () => notFound(),
    "/healthz": () => json(200, { service: "openshock-server" }),
    "/v1/state": () => json(200, { workspace: { name: "probe" } }),
  });
  const baseUrl = `http://127.0.0.1:${live.port}`;
  const address = `127.0.0.1:${live.port}`;
  await writeFile(
    metadataPath,
    `${JSON.stringify(
      {
        service: "openshock-server",
        owner: "@Max",
        pid: 4242,
        workspaceRoot: root,
        repoRoot,
        address,
        baseUrl,
        healthUrl: `${baseUrl}/healthz`,
        stateUrl: `${baseUrl}/v1/state`,
        logPath: path.join(root, "data", "logs", "openshock-server.log"),
        branch: "dev",
        head: "abcdef1",
        launchCommand: "mock launch",
        launchedAt: "2026-04-09T05:20:00Z",
        status: "running",
        statusCommand: `pnpm --dir ${JSON.stringify(repoRoot)} ops:live-server:status -- --workspace-root ${JSON.stringify(root)} --server-url ${JSON.stringify(baseUrl)} --server-addr ${JSON.stringify(address)}`,
        startCommand: `pnpm --dir ${JSON.stringify(repoRoot)} ops:live-server:start -- --workspace-root ${JSON.stringify(root)} --server-url ${JSON.stringify(baseUrl)} --server-addr ${JSON.stringify(address)}`,
        stopCommand: `pnpm --dir ${JSON.stringify(repoRoot)} ops:live-server:stop -- --workspace-root ${JSON.stringify(root)} --server-url ${JSON.stringify(baseUrl)} --server-addr ${JSON.stringify(address)}`,
        reloadCommand: `pnpm --dir ${JSON.stringify(repoRoot)} ops:live-server:reload -- --workspace-root ${JSON.stringify(root)} --server-url ${JSON.stringify(baseUrl)} --server-addr ${JSON.stringify(address)}`,
      },
      null,
      2,
    )}\n`,
  );
  const status = await runStatus({
    OPENSHOCK_WORKSPACE_ROOT: root,
    OPENSHOCK_SERVER_ADDR: address,
    OPENSHOCK_SERVER_URL: baseUrl,
  });

  assert.equal(status.managed, true);
  assert.equal(status.owner, "@Max");
  assert.equal(status.metadataPath, metadataPath);
  assert.equal(status.head, "abcdef1");
  await closeServer(live.server);
});

test("reload refuses to operate from a different workspace than the managed owner", async () => {
  const ownerRoot = await mkdtemp(path.join(os.tmpdir(), "openshock-live-owner-"));
  const altRoot = await mkdtemp(path.join(os.tmpdir(), "openshock-live-alt-"));
  const live = await listenWithPayload({
    service: "openshock-server",
    managed: true,
    status: "running",
    message: "live service owner metadata is present; use the recorded reload command for controlled roll/restart",
    owner: "@Andrew",
    pid: 2189538,
    workspaceRoot: ownerRoot,
    repoRoot,
    address: "",
    baseUrl: "",
    healthUrl: "",
    stateUrl: "",
    metadataPath: path.join(ownerRoot, "data", "ops", "live-server.json"),
    logPath: path.join(ownerRoot, "data", "logs", "openshock-server.log"),
    branch: "tkt-59-live-service-owner-control",
    head: "7c0f3f6",
    launchCommand: "mock launch",
    launchedAt: "2026-04-09T05:20:00Z",
    statusCommand: "",
    startCommand: "",
    stopCommand: "",
    reloadCommand: "",
  });
  const baseUrl = `http://127.0.0.1:${live.port}`;
  const address = `127.0.0.1:${live.port}`;
  live.payload.address = address;
  live.payload.baseUrl = baseUrl;
  live.payload.healthUrl = `${baseUrl}/healthz`;
  live.payload.stateUrl = `${baseUrl}/v1/state`;
  live.payload.reloadCommand = `pnpm --dir ${JSON.stringify(repoRoot)} ops:live-server:reload -- --workspace-root ${JSON.stringify(ownerRoot)} --server-url ${JSON.stringify(baseUrl)} --server-addr ${JSON.stringify(address)}`;

  await assert.rejects(
    () =>
      execFileAsync("node", ["./scripts/live-server-control.mjs", "reload"], {
        cwd: repoRoot,
        env: {
          ...process.env,
          OPENSHOCK_WORKSPACE_ROOT: altRoot,
          OPENSHOCK_SERVER_ADDR: address,
          OPENSHOCK_SERVER_URL: baseUrl,
        },
      }),
    /refusing to reload .*actual managed service is controlled by .*rerun .*ops:live-server:reload/,
  );

  await closeServer(live.server);
});

async function runStatus(env) {
  const { stdout } = await execFileAsync("node", ["./scripts/live-server-control.mjs", "status"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
    },
  });
  return JSON.parse(stdout);
}

async function listenWithPayload(payload) {
  const live = await listenWithHandlers({
    "/v1/runtime/live-service": () => json(200, payload),
    "/healthz": () => json(200, { service: "openshock-server" }),
    "/v1/state": () => json(200, { workspace: { id: "ws_123" } }),
  });
  return { ...live, payload };
}

async function listenWithHandlers(handlers) {
  const server = http.createServer((req, res) => {
    const handler = handlers[req.url] || (() => notFound());
    const response = handler(req);
    res.writeHead(response.status, response.headers);
    res.end(response.body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test server did not expose a TCP port");
  }
  return { server, port: address.port };
}

async function closeServer(server) {
  server.close();
  await once(server, "close");
}

function json(status, body) {
  return {
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function notFound() {
  return {
    status: 404,
    headers: { "content-type": "text/plain" },
    body: "not found",
  };
}
