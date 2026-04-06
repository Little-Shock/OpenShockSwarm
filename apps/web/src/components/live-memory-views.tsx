"use client";

import { useDeferredValue, useEffect, useState } from "react";

import { DetailRail, Panel } from "@/components/phase-zero-views";
import { usePhaseZeroState } from "@/lib/live-phase0";
import type { MemoryArtifact, MemoryGovernance } from "@/lib/mock-data";

const API_BASE = process.env.NEXT_PUBLIC_OPENSHOCK_API_BASE ?? "http://127.0.0.1:8080";

type MemoryArtifactSurface = MemoryArtifact;

type MemoryArtifactVersion = {
  version: number;
  summary: string;
  updatedAt: string;
  source: string;
  actor: string;
  digest?: string;
  sizeBytes?: number;
  content?: string;
};

type MemoryArtifactDetail = {
  artifact: MemoryArtifactSurface;
  content?: string;
  versions: MemoryArtifactVersion[];
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function governanceTone(governance?: MemoryGovernance) {
  if (governance?.requiresReview) {
    return "bg-[var(--shock-yellow)]";
  }
  if (governance?.mode === "state-snapshot") {
    return "bg-[var(--shock-lime)]";
  }
  return "bg-white";
}

function valueOrFallback(value: string | number | undefined | null, fallback: string) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? `${value}` : fallback;
  }
  return value && String(value).trim().length > 0 ? String(value) : fallback;
}

function summarizeGovernance(governance?: MemoryGovernance) {
  if (!governance?.mode) {
    return "未声明 governance";
  }

  const parts = [governance.mode];
  if (governance.requiresReview) {
    parts.push("review required");
  }
  if (governance.escalation) {
    parts.push(`escalate:${governance.escalation}`);
  }
  return parts.join(" / ");
}

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) {
    return "未记录";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function buildDiffPreview(previous?: string, current?: string) {
  const before = (previous ?? "").split("\n");
  const after = (current ?? "").split("\n");
  const lines: string[] = [];
  let additions = 0;
  let removals = 0;

  for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
    const left = before[index] ?? "";
    const right = after[index] ?? "";
    if (left === right) {
      continue;
    }
    if (left) {
      removals += 1;
      if (lines.length < 8) {
        lines.push(`- ${left}`);
      }
    }
    if (right) {
      additions += 1;
      if (lines.length < 8) {
        lines.push(`+ ${right}`);
      }
    }
  }

  if (additions === 0 && removals === 0) {
    return {
      summary: "当前版本和上一版内容一致，差异为 metadata 变更。",
      preview: ["# no content diff"],
    };
  }

  return {
    summary: `+${additions} / -${removals} lines`,
    preview: lines.length > 0 ? lines : ["# diff omitted"],
  };
}

function ArtifactFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">{label}</p>
      <p className="mt-2 text-sm leading-6">{value}</p>
    </div>
  );
}

export function LiveMemoryContextRail() {
  const { state, loading, error } = usePhaseZeroState();
  const memory = state.memory;
  const governed = loading || error ? 0 : memory.filter((item) => item.governance?.mode).length;
  const reviewRequired = loading || error ? 0 : memory.filter((item) => item.governance?.requiresReview).length;

  return (
    <DetailRail
      label="Memory Truth"
      items={[
        {
          label: "Artifacts",
          value: loading ? "同步中" : error ? "读取失败" : `${memory.length} items`,
        },
        {
          label: "Governed",
          value: loading ? "同步中" : error ? "读取失败" : `${governed} governed`,
        },
        {
          label: "Review Gate",
          value: loading ? "同步中" : error ? "读取失败" : `${reviewRequired} require review`,
        },
        {
          label: "Mode",
          value: loading ? "同步中" : error ? "读取失败" : state.workspace.memoryMode || "未声明",
        },
      ]}
    />
  );
}

export function LiveMemoryView() {
  const { state, loading, error } = usePhaseZeroState();
  const memory = state.memory;
  const [selectedArtifactId, setSelectedArtifactId] = useState<string>("");
  const resolvedArtifactId =
    selectedArtifactId && memory.some((item) => item.id === selectedArtifactId) ? selectedArtifactId : (memory[0]?.id ?? "");
  const deferredArtifactId = useDeferredValue(resolvedArtifactId);
  const [detail, setDetail] = useState<MemoryArtifactDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    if (!deferredArtifactId) {
      return;
    }

    let cancelled = false;
    setDetailLoading(true);

    void (async () => {
      setDetailError(null);
      try {
        const response = await fetch(`${API_BASE}/v1/memory/${deferredArtifactId}`, { cache: "no-store" });
        const payload = (await response.json()) as MemoryArtifactDetail & { error?: string };
        if (!response.ok) {
          throw new Error(payload.error || `request failed: ${response.status}`);
        }
        if (!cancelled) {
          setDetail(payload);
        }
      } catch (fetchError: unknown) {
        if (!cancelled) {
          setDetail(null);
          setDetailError(fetchError instanceof Error ? fetchError.message : "memory detail fetch failed");
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [deferredArtifactId]);

  const selectedArtifact = memory.find((item) => item.id === resolvedArtifactId) ?? memory[0];
  const resolvedDetail = detail && detail.artifact.id === deferredArtifactId ? detail : null;
  const versions = resolvedDetail?.versions ?? [];
  const latestVersion = versions[versions.length - 1];
  const previousVersion = versions.length > 1 ? versions[versions.length - 2] : undefined;
  const diff = buildDiffPreview(previousVersion?.content, latestVersion?.content ?? resolvedDetail?.content);
  const decisionArtifacts = memory.filter((item) => item.kind === "decision").length;
  const agentArtifacts = memory.filter((item) => item.scope.startsWith("agent:")).length;

  return (
    <div className="space-y-4">
      {error ? (
        <Panel tone="pink">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">State Sync Failed</p>
          <p className="mt-3 text-base leading-7">memory center 仍可展示局部 detail，但当前 `/v1/state` 拉取失败：{error}</p>
        </Panel>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <ArtifactFact label="Artifacts" value={loading ? "同步中" : `${memory.length} items`} />
        <ArtifactFact label="Decision Ledger" value={loading ? "同步中" : `${decisionArtifacts} files`} />
        <ArtifactFact label="Agent Memory" value={loading ? "同步中" : `${agentArtifacts} scopes`} />
        <ArtifactFact
          label="Latest Audit"
          value={latestVersion ? `${latestVersion.actor} / ${latestVersion.source}` : detailLoading ? "读取中" : "未选择"}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Panel tone="paper">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">Memory Registry</p>
              <h2 className="mt-2 font-display text-3xl font-bold">可治理记忆面</h2>
            </div>
            <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
              {loading ? "syncing" : `${memory.length} artifacts`}
            </span>
          </div>
          <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">
            这里不再只看 `memoryPaths` 或摘要，而是直接展示 artifact registry、governance policy、version audit 和最近一次内容差异。
          </p>

          <div className="mt-5 space-y-3">
            {memory.length === 0 ? (
              <div className="rounded-[18px] border-2 border-dashed border-[var(--shock-ink)] bg-white px-4 py-4 text-sm leading-6 text-[color:rgba(24,20,14,0.7)]">
                当前 state 还没有 memory artifacts。等 server 返回 `/v1/memory` 真值后，这里会展开 registry。
              </div>
            ) : (
              memory.map((artifact) => {
                const active = artifact.id === selectedArtifact?.id;
                return (
                  <button
                    key={artifact.id}
                    type="button"
                    onClick={() => setSelectedArtifactId(artifact.id)}
                    className={cn(
                      "w-full rounded-[18px] border-2 border-[var(--shock-ink)] px-4 py-4 text-left transition-transform hover:-translate-y-0.5",
                      active ? "bg-[var(--shock-yellow)] shadow-[4px_4px_0_0_var(--shock-ink)]" : governanceTone(artifact.governance)
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">{artifact.scope}</p>
                        <p className="mt-2 font-display text-xl font-bold">{artifact.path}</p>
                      </div>
                      <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
                        v{artifact.version ?? 0}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-6">{artifact.summary}</p>
                    <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">
                      {summarizeGovernance(artifact.governance)}
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel tone="white">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">Artifact Detail</p>
                <h2 className="mt-2 font-display text-3xl font-bold">{selectedArtifact?.path ?? "等待选择"}</h2>
              </div>
              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                {selectedArtifact ? summarizeGovernance(selectedArtifact.governance) : "no artifact"}
              </span>
            </div>

            {detailError ? (
              <p className="mt-4 rounded-[16px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-4 text-sm leading-6 text-white">
                `/v1/memory/{deferredArtifactId}` 读取失败：{detailError}
              </p>
            ) : null}

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <ArtifactFact label="Version" value={selectedArtifact ? `v${selectedArtifact.version ?? 0}` : "未选择"} />
              <ArtifactFact label="Latest Write" value={valueOrFallback(selectedArtifact?.latestWrite, "未记录")} />
              <ArtifactFact label="Source / Actor" value={selectedArtifact ? `${valueOrFallback(selectedArtifact.latestSource, "unknown")} / ${valueOrFallback(selectedArtifact.latestActor, "unknown")}` : "未选择"} />
              <ArtifactFact label="Digest / Size" value={selectedArtifact ? `${valueOrFallback(selectedArtifact.digest?.slice(0, 10), "n/a")} / ${formatBytes(selectedArtifact.sizeBytes)}` : "未选择"} />
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_0.9fr]">
              <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Current Content</p>
                <pre className="mt-3 max-h-[360px] overflow-auto whitespace-pre-wrap font-mono text-[12px] leading-6 text-[color:rgba(24,20,14,0.82)]">
                  {detailLoading ? "正在读取 artifact detail..." : resolvedDetail?.content || "# 暂无内容"}
                </pre>
              </div>

              <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Diff Preview</p>
                <p className="mt-3 text-sm leading-6">{previousVersion ? `v${previousVersion.version} -> v${latestVersion?.version ?? "?"}` : "只有基线版本，还没有上一版可对比。"} </p>
                <p className="mt-2 rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em]">
                  {diff.summary}
                </p>
                <pre className="mt-3 max-h-[280px] overflow-auto whitespace-pre-wrap rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3 font-mono text-[12px] leading-6">
                  {diff.preview.join("\n")}
                </pre>
              </div>
            </div>
          </Panel>

          <Panel tone="paper">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">Audit Timeline</p>
                <h2 className="mt-2 font-display text-3xl font-bold">版本轨迹</h2>
              </div>
              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                {versions.length} records
              </span>
            </div>

            <div className="mt-5 space-y-3">
              {versions.length === 0 ? (
                <div className="rounded-[18px] border-2 border-dashed border-[var(--shock-ink)] bg-white px-4 py-4 text-sm leading-6 text-[color:rgba(24,20,14,0.7)]">
                  当前 artifact 还没有 version history。
                </div>
              ) : (
                [...versions].reverse().map((version) => (
                  <div key={`${version.version}-${version.updatedAt}`} className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">
                          v{version.version} / {version.updatedAt}
                        </p>
                        <p className="mt-2 text-sm leading-6">{version.summary}</p>
                      </div>
                      <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                        {version.source} / {version.actor}
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <ArtifactFact label="Digest" value={valueOrFallback(version.digest?.slice(0, 16), "未记录")} />
                      <ArtifactFact label="Size" value={formatBytes(version.sizeBytes)} />
                      <ArtifactFact label="Summary" value={version.summary} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
