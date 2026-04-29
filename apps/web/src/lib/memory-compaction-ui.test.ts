import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const memoryViewPath = resolve(__dirname, "../components/live-memory-views.tsx");
const liveMemoryPath = resolve(__dirname, "./live-memory.ts");

function memoryViewSource() {
  return readFileSync(memoryViewPath, "utf8");
}

function liveMemorySource() {
  return readFileSync(liveMemoryPath, "utf8");
}

test("memory UI keeps compaction queue as a collapsed supporting section after the default stack", () => {
  const source = memoryViewSource();
  const defaultStackIndex = source.indexOf('data-testid="memory-default-stack"');
  const compactionIndex = source.indexOf('data-testid="memory-compaction-details"');

  assert.notEqual(defaultStackIndex, -1, "default memory stack should stay on the first surface");
  assert.notEqual(compactionIndex, -1, "compaction disclosure should render");
  assert.ok(defaultStackIndex < compactionIndex, "compaction queue should not move above the default file stack");
  assert.match(source, /data-testid="memory-compaction-details-summary"/);
  assert.match(source, /默认文件栈保持在上方；这里只处理需要人工确认的合并候选。/);
});

test("memory compaction queue renders candidate review anchors", () => {
  const source = memoryViewSource();

  assert.match(source, /center\.compactionQueue\.map/);
  assert.match(source, /data-testid=\{`memory-compaction-item-\$\{slug\}`\}/);
  assert.match(source, /data-testid=\{`memory-compaction-source-\$\{slug\}`\}/);
  assert.match(source, /data-testid=\{`memory-compaction-reason-\$\{slug\}`\}/);
  assert.match(source, /data-testid=\{`memory-compaction-status-\$\{slug\}`\}/);
  assert.match(source, /data-testid=\{`memory-compaction-\$\{slug\}-approve`\}/);
  assert.match(source, /data-testid=\{`memory-compaction-\$\{slug\}-dismiss`\}/);
  assert.match(source, /handleReviewCompaction\(candidate, "approved"\)/);
  assert.match(source, /handleReviewCompaction\(candidate, "dismissed"\)/);
});

test("live memory client includes compaction queue state and review endpoint", () => {
  const source = liveMemorySource();

  assert.match(source, /export type MemoryCompactionCandidate = \{/);
  assert.match(source, /sourceArtifactId: string;/);
  assert.match(source, /reason: string;/);
  assert.match(source, /status: MemoryCompactionStatus;/);
  assert.match(source, /updatedAt: string;/);
  assert.match(source, /compactionQueue: MemoryCompactionCandidate\[\];/);
  assert.match(source, /compactionQueue: \[\],/);
  assert.match(source, /reviewCompactionCandidate/);
  assert.match(source, /\/v1\/memory-center\/compaction\/\$\{candidateId\}\/review/);
});
