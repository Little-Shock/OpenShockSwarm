import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const viewSource = readFileSync(new URL("../components/live-memory-views.tsx", import.meta.url), "utf8");

test("memory provider UI labels unconfigured real external memory distinctly from fake health", () => {
  assert.match(viewSource, /function providerIsUnconfiguredExternal\(provider: MemoryProviderBinding\)/);
  assert.match(viewSource, /provider\.kind === "external-persistent"/);
  assert.match(viewSource, /not configured\|未配置/i);
  assert.match(viewSource, /return "未配置";/);
  assert.match(viewSource, /providerStatusLabel\(provider\)/);
});
