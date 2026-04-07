"use client";

import { useDeferredValue, useEffect, useState, type FormEvent } from "react";

import { DetailRail, Panel } from "@/components/phase-zero-views";
import { usePhaseZeroState } from "@/lib/live-phase0";
import {
  type MemoryArtifactDetail,
  type MemoryInjectionPolicy,
  type MemoryInjectionPreview,
  type MemoryPromotion,
  type MemoryPromotionKind,
  type MemoryPromotionStatus,
  useLiveMemoryCenter,
} from "@/lib/live-memory";
import type { AuthSession, MemoryGovernance } from "@/lib/mock-data";

const API_BASE = process.env.NEXT_PUBLIC_OPENSHOCK_API_BASE ?? "http://127.0.0.1:8080";
const POLICY_MAX_ITEM_OPTIONS = [4, 6, 8, 10, 12] as const;

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function toTestID(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function formatTimestamp(value?: string) {
  if (!value) {
    return "尚未发生";
  }

  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function governanceTone(governance?: MemoryGovernance) {
  if (governance?.requiresReview) {
    return "bg-[var(--shock-yellow)]";
  }
  if (governance?.mode?.includes("ledger")) {
    return "bg-[var(--shock-lime)]";
  }
  if (governance?.mode === "state-snapshot") {
    return "bg-[var(--shock-lime)]";
  }
  return "bg-white";
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

function valueOrFallback(value: string | number | undefined | null, fallback: string) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? `${value}` : fallback;
  }
  return value && String(value).trim().length > 0 ? String(value) : fallback;
}

function hasPermission(session: AuthSession, permission: string) {
  return session.status === "active" && session.permissions.includes(permission);
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

function policyModeLabel(mode: MemoryInjectionPolicy["mode"]) {
  return mode === "governed-first" ? "Governed First" : "Balanced";
}

function previewLabel(preview: MemoryInjectionPreview) {
  const parts = [preview.issueKey || preview.sessionId];
  if (preview.roomId) {
    parts.push(preview.roomId);
  }
  if (preview.runId) {
    parts.push(preview.runId);
  }
  return parts.join(" / ");
}

function promotionKindLabel(kind: MemoryPromotionKind) {
  return kind === "policy" ? "Policy" : "Skill";
}

function promotionStatusLabel(status: MemoryPromotionStatus) {
  switch (status) {
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    default:
      return "pending_review";
  }
}

function promotionTone(status: MemoryPromotionStatus) {
  switch (status) {
    case "approved":
      return "lime";
    case "rejected":
      return "pink";
    default:
      return "yellow";
  }
}

function ArtifactFact({
  label,
  value,
  testID,
}: {
  label: string;
  value: string;
  testID?: string;
}) {
  return (
    <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3" data-testid={testID}>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">{label}</p>
      <p className="mt-2 text-sm leading-6">{value}</p>
    </div>
  );
}

function StatusRow({
  label,
  value,
  tone = "white",
  testID,
}: {
  label: string;
  value: string;
  tone?: "white" | "yellow" | "lime" | "pink";
  testID?: string;
}) {
  return (
    <div
      data-testid={testID}
      className={cn(
        "rounded-[18px] border-2 border-[var(--shock-ink)] px-4 py-3",
        tone === "yellow" && "bg-[var(--shock-yellow)]",
        tone === "lime" && "bg-[var(--shock-lime)]",
        tone === "pink" && "bg-[var(--shock-pink)] text-white",
        tone === "white" && "bg-white"
      )}
    >
      <p
        className={cn(
          "font-mono text-[10px] uppercase tracking-[0.18em]",
          tone === "pink" ? "text-white/78" : "text-[color:rgba(24,20,14,0.62)]"
        )}
      >
        {label}
      </p>
      <p className="mt-2 text-sm leading-6">{value}</p>
    </div>
  );
}

function MutationFeedback({
  error,
  success,
}: {
  error: string | null;
  success: string | null;
}) {
  return (
    <>
      {error ? (
        <p
          data-testid="memory-mutation-error"
          className="mt-4 rounded-[16px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-4 text-sm leading-6 text-white"
        >
          {error}
        </p>
      ) : null}
      {success ? (
        <p
          data-testid="memory-mutation-success"
          className="mt-4 rounded-[16px] border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-4 py-4 text-sm leading-6"
        >
          {success}
        </p>
      ) : null}
    </>
  );
}

function EmptyState({
  title,
  message,
  testID,
}: {
  title: string;
  message: string;
  testID?: string;
}) {
  return (
    <div
      data-testid={testID}
      className="rounded-[20px] border-2 border-dashed border-[var(--shock-ink)] bg-white px-5 py-5"
    >
      <p className="font-display text-2xl font-bold">{title}</p>
      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{message}</p>
    </div>
  );
}

function LiveMemoryRailBody() {
  const { state, loading, error } = usePhaseZeroState();
  const { center, loading: centerLoading, error: centerError } = useLiveMemoryCenter();
  const memory = state.memory;
  const governed = loading || error ? 0 : memory.filter((item) => item.governance?.mode).length;

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
          label: "Pending",
          value: centerLoading ? "同步中" : centerError ? "读取失败" : `${center.pendingCount} review`,
        },
        {
          label: "Policy",
          value: centerLoading ? "同步中" : centerError ? "读取失败" : policyModeLabel(center.policy.mode),
        },
      ]}
    />
  );
}

export function LiveMemoryContextRail() {
  return <LiveMemoryRailBody />;
}

export function LiveMemoryView() {
  const { state, loading, error, refresh } = usePhaseZeroState();
  const { center, loading: centerLoading, error: centerError, updatePolicy, createPromotion, reviewPromotion } = useLiveMemoryCenter();
  const memory = state.memory;
  const session = state.auth.session;
  const canMutate = hasPermission(session, "memory.write");

  const [selectedArtifactId, setSelectedArtifactId] = useState("");
  const resolvedArtifactId =
    selectedArtifactId && memory.some((item) => item.id === selectedArtifactId) ? selectedArtifactId : (memory[0]?.id ?? "");
  const deferredArtifactId = useDeferredValue(resolvedArtifactId);

  const [selectedSessionId, setSelectedSessionId] = useState("");
  const resolvedSessionId =
    selectedSessionId && center.previews.some((item) => item.sessionId === selectedSessionId)
      ? selectedSessionId
      : (center.previews[0]?.sessionId ?? "");

  const [detail, setDetail] = useState<MemoryArtifactDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [policyModeDraft, setPolicyModeDraft] = useState<MemoryInjectionPolicy["mode"]>("governed-first");
  const [includeRoomNotesDraft, setIncludeRoomNotesDraft] = useState(true);
  const [includeDecisionLedgerDraft, setIncludeDecisionLedgerDraft] = useState(true);
  const [includeAgentMemoryDraft, setIncludeAgentMemoryDraft] = useState(false);
  const [includePromotedArtifactsDraft, setIncludePromotedArtifactsDraft] = useState(true);
  const [maxItemsDraft, setMaxItemsDraft] = useState(6);
  const [policyDirty, setPolicyDirty] = useState(false);

  const [promotionKind, setPromotionKind] = useState<MemoryPromotionKind>("skill");
  const [promotionTitle, setPromotionTitle] = useState("");
  const [promotionRationale, setPromotionRationale] = useState("");

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutationSuccess, setMutationSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!deferredArtifactId) {
      setDetail(null);
      setDetailError(null);
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

  useEffect(() => {
    if (!policyDirty) {
      setPolicyModeDraft(center.policy.mode);
      setIncludeRoomNotesDraft(center.policy.includeRoomNotes);
      setIncludeDecisionLedgerDraft(center.policy.includeDecisionLedger);
      setIncludeAgentMemoryDraft(center.policy.includeAgentMemory);
      setIncludePromotedArtifactsDraft(center.policy.includePromotedArtifacts);
      setMaxItemsDraft(center.policy.maxItems);
    }
  }, [center.policy, policyDirty]);

  const selectedArtifact = memory.find((item) => item.id === resolvedArtifactId) ?? memory[0];
  const resolvedDetail = detail && detail.artifact.id === deferredArtifactId ? detail : null;
  const versions = resolvedDetail?.versions ?? [];
  const latestVersion = versions[versions.length - 1];
  const previousVersion = versions.length > 1 ? versions[versions.length - 2] : undefined;
  const diff = buildDiffPreview(previousVersion?.content, latestVersion?.content ?? resolvedDetail?.content);
  const preview = center.previews.find((item) => item.sessionId === resolvedSessionId) ?? center.previews[0];
  const decisionArtifacts = memory.filter((item) => item.kind === "decision").length;
  const governedArtifacts = memory.filter((item) => item.governance?.mode).length;
  const promotedLedgers = memory.filter((item) => item.kind === "skill-ledger" || item.kind === "policy-ledger").length;

  async function runAction(action: string, task: () => Promise<void>) {
    setBusyAction(action);
    setMutationError(null);
    setMutationSuccess(null);
    try {
      await task();
    } catch (mutationFailure) {
      setMutationError(mutationFailure instanceof Error ? mutationFailure.message : "memory action failed");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSavePolicy() {
    await runAction("save-policy", async () => {
      await updatePolicy({
        mode: policyModeDraft,
        includeRoomNotes: includeRoomNotesDraft,
        includeDecisionLedger: includeDecisionLedgerDraft,
        includeAgentMemory: includeAgentMemoryDraft,
        includePromotedArtifacts: includePromotedArtifactsDraft,
        maxItems: maxItemsDraft,
      });
      setPolicyDirty(false);
      await refresh();
      setMutationSuccess(`memory policy switched to ${policyModeLabel(policyModeDraft)} / ${maxItemsDraft} items`);
    });
  }

  async function handleCreatePromotion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedArtifact) {
      setMutationError("请先选择要提升的 memory artifact");
      return;
    }

    await runAction("create-promotion", async () => {
      await createPromotion({
        memoryId: selectedArtifact.id,
        sourceVersion: latestVersion?.version ?? selectedArtifact.version,
        kind: promotionKind,
        title: promotionTitle.trim(),
        rationale: promotionRationale.trim(),
      });
      setPromotionTitle("");
      setPromotionRationale("");
      setMutationSuccess(`${selectedArtifact.path} queued for ${promotionKindLabel(promotionKind)} review`);
    });
  }

  async function handleReviewPromotion(promotion: MemoryPromotion, status: Extract<MemoryPromotionStatus, "approved" | "rejected">) {
    await runAction(`review-${promotion.id}-${status}`, async () => {
      await reviewPromotion(promotion.id, {
        status,
        reviewNote: status === "approved" ? "memory center review approved" : "memory center review rejected",
      });
      await refresh();
      setMutationSuccess(`${promotion.title} marked ${promotionStatusLabel(status)}`);
    });
  }

  function onPolicyToggle(next: boolean, setter: (value: boolean) => void) {
    setter(next);
    setPolicyDirty(true);
  }

  return (
    <div className="space-y-4">
      {error ? (
        <Panel tone="pink">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">State Sync Failed</p>
          <p className="mt-3 text-base leading-7">memory center 仍可展示局部 detail，但当前 `/v1/state` 拉取失败：{error}</p>
        </Panel>
      ) : null}

      {centerError ? (
        <Panel tone="pink">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Center Sync Failed</p>
          <p className="mt-3 text-base leading-7">`/v1/memory-center` 当前读取失败：{centerError}</p>
        </Panel>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <ArtifactFact label="Artifacts" value={loading ? "同步中" : `${memory.length} items`} testID="memory-artifact-count" />
        <ArtifactFact label="Governed" value={loading ? "同步中" : `${governedArtifacts} governed`} testID="memory-governed-count" />
        <ArtifactFact
          label="Promotion Queue"
          value={centerLoading ? "同步中" : `${center.pendingCount} pending / ${center.approvedCount} approved`}
          testID="memory-pending-count"
        />
        <ArtifactFact
          label="Injection Pack"
          value={preview ? `${preview.items.length} items / ${preview.files.length} files` : centerLoading ? "同步中" : "未选择"}
          testID="memory-preview-size"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
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
            这页现在不只读 detail。它会把 injection policy、next-run preview、promotion review queue 和 version audit 收成同一套 live truth。
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-1">
            <StatusRow label="Governed Artifacts" value={`${governedArtifacts} artifacts`} tone="white" />
            <StatusRow label="Decision Ledgers" value={`${decisionArtifacts} ledgers`} tone="yellow" />
            <StatusRow label="Promoted Ledgers" value={`${promotedLedgers} ledgers`} tone="lime" />
            <StatusRow label="Current Policy" value={centerLoading ? "同步中" : policyModeLabel(center.policy.mode)} tone="white" />
          </div>

          <div className="mt-5 space-y-3">
            {memory.length === 0 ? (
              <EmptyState title="memory registry 为空" message="等 server 返回 `/v1/memory` 真值后，这里会展开 governed artifact registry。" />
            ) : (
              memory.map((artifact) => {
                const active = artifact.id === selectedArtifact?.id;
                const testID = `memory-artifact-${toTestID(artifact.path)}`;
                return (
                  <button
                    key={artifact.id}
                    type="button"
                    data-testid={testID}
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
                <h2 data-testid="memory-detail-path" className="mt-2 font-display text-3xl font-bold">
                  {selectedArtifact?.path ?? "等待选择"}
                </h2>
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
              <ArtifactFact
                label="Source / Actor"
                value={
                  selectedArtifact
                    ? `${valueOrFallback(selectedArtifact.latestSource, "unknown")} / ${valueOrFallback(selectedArtifact.latestActor, "unknown")}`
                    : "未选择"
                }
              />
              <ArtifactFact
                label="Digest / Size"
                value={
                  selectedArtifact
                    ? `${valueOrFallback(selectedArtifact.digest?.slice(0, 10), "n/a")} / ${formatBytes(selectedArtifact.sizeBytes)}`
                    : "未选择"
                }
              />
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_0.85fr]">
              <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Current Content</p>
                <pre
                  data-testid="memory-detail-content"
                  className="mt-3 max-h-[360px] overflow-auto whitespace-pre-wrap font-mono text-[12px] leading-6 text-[color:rgba(24,20,14,0.82)]"
                >
                  {detailLoading ? "正在读取 artifact detail..." : resolvedDetail?.content || "# 暂无内容"}
                </pre>
              </div>

              <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Diff Preview</p>
                <p className="mt-3 text-sm leading-6">
                  {previousVersion ? `v${previousVersion.version} -> v${latestVersion?.version ?? "?"}` : "只有基线版本，还没有上一版可对比。"}
                </p>
                <p className="mt-2 rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em]">
                  {diff.summary}
                </p>
                <pre className="mt-3 max-h-[280px] overflow-auto whitespace-pre-wrap rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3 font-mono text-[12px] leading-6">
                  {diff.preview.join("\n")}
                </pre>
              </div>
            </div>
          </Panel>

          <Panel tone={canMutate ? "yellow" : "paper"}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">Injection Policy</p>
                <h2 className="mt-2 font-display text-3xl font-bold">下一条任务真正会注入什么</h2>
              </div>
              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                {canMutate ? "memory.write live" : "read-only session"}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
              这层把 recall policy、session-level injection preview、mounted files 和 runtime tools 收成同一页真值。变更 policy 后，下一条任务的 prompt summary 和 file pack 会一起更新。
            </p>

            {!canMutate ? (
              <div className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
                <p className="font-mono text-[11px] uppercase tracking-[0.16em]">
                  当前 session 没有 `memory.write`。仍可检查 preview / audit，但 policy 和 promotion mutation 保持只读。
                </p>
              </div>
            ) : null}

            <div className="mt-5 grid gap-4 xl:grid-cols-[0.95fr_minmax(0,1.05fr)]">
              <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Policy Draft</p>
                  <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
                    {policyDirty ? "dirty" : "synced"}
                  </span>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {(["governed-first", "balanced"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      data-testid={`memory-policy-mode-${mode}`}
                      disabled={!canMutate || busyAction !== null}
                      onClick={() => {
                        setPolicyModeDraft(mode);
                        setPolicyDirty(true);
                      }}
                      className={cn(
                        "rounded-[18px] border-2 border-[var(--shock-ink)] px-4 py-4 text-left disabled:opacity-60",
                        policyModeDraft === mode ? "bg-[var(--shock-yellow)] shadow-[4px_4px_0_0_var(--shock-ink)]" : "bg-white"
                      )}
                    >
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em]">{policyModeLabel(mode)}</p>
                      <p className="mt-2 text-sm leading-6">
                        {mode === "governed-first" ? "优先把 decision / promoted ledger 推到 recall pack 前面。" : "平衡 session path 与 promoted memory，不只盯 review-required artifacts。"}
                      </p>
                    </button>
                  ))}
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <button
                    type="button"
                    data-testid="memory-policy-room"
                    disabled={!canMutate || busyAction !== null}
                    onClick={() => onPolicyToggle(!includeRoomNotesDraft, setIncludeRoomNotesDraft)}
                    className={cn(
                      "rounded-[18px] border-2 border-[var(--shock-ink)] px-4 py-4 text-left disabled:opacity-60",
                      includeRoomNotesDraft ? "bg-[var(--shock-lime)]" : "bg-white"
                    )}
                  >
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em]">Room Notes</p>
                    <p className="mt-2 text-sm leading-6">{includeRoomNotesDraft ? "注入 room note" : "跳过 room note"}</p>
                  </button>
                  <button
                    type="button"
                    data-testid="memory-policy-decision"
                    disabled={!canMutate || busyAction !== null}
                    onClick={() => onPolicyToggle(!includeDecisionLedgerDraft, setIncludeDecisionLedgerDraft)}
                    className={cn(
                      "rounded-[18px] border-2 border-[var(--shock-ink)] px-4 py-4 text-left disabled:opacity-60",
                      includeDecisionLedgerDraft ? "bg-[var(--shock-lime)]" : "bg-white"
                    )}
                  >
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em]">Decision Ledger</p>
                    <p className="mt-2 text-sm leading-6">{includeDecisionLedgerDraft ? "注入 issue decision" : "跳过 decision ledger"}</p>
                  </button>
                  <button
                    type="button"
                    data-testid="memory-policy-agent"
                    disabled={!canMutate || busyAction !== null}
                    onClick={() => onPolicyToggle(!includeAgentMemoryDraft, setIncludeAgentMemoryDraft)}
                    className={cn(
                      "rounded-[18px] border-2 border-[var(--shock-ink)] px-4 py-4 text-left disabled:opacity-60",
                      includeAgentMemoryDraft ? "bg-[var(--shock-lime)]" : "bg-white"
                    )}
                  >
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em]">Agent Memory</p>
                    <p className="mt-2 text-sm leading-6">{includeAgentMemoryDraft ? "附带 owner agent memory" : "只用 workspace / room / issue memory"}</p>
                  </button>
                  <button
                    type="button"
                    data-testid="memory-policy-promoted"
                    disabled={!canMutate || busyAction !== null}
                    onClick={() => onPolicyToggle(!includePromotedArtifactsDraft, setIncludePromotedArtifactsDraft)}
                    className={cn(
                      "rounded-[18px] border-2 border-[var(--shock-ink)] px-4 py-4 text-left disabled:opacity-60",
                      includePromotedArtifactsDraft ? "bg-[var(--shock-lime)]" : "bg-white"
                    )}
                  >
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em]">Promoted Ledgers</p>
                    <p className="mt-2 text-sm leading-6">{includePromotedArtifactsDraft ? "skill / policy ledger 进入 preview" : "暂不注入 promoted ledgers"}</p>
                  </button>
                </div>

                <div className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4">
                  <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]" htmlFor="memory-policy-max-items">
                    Max Injected Items
                  </label>
                  <select
                    id="memory-policy-max-items"
                    data-testid="memory-policy-max-items"
                    value={maxItemsDraft}
                    onChange={(event) => {
                      setMaxItemsDraft(Number(event.target.value));
                      setPolicyDirty(true);
                    }}
                    disabled={!canMutate || busyAction !== null}
                    className="mt-3 w-full rounded-[10px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3 text-sm outline-none disabled:opacity-60"
                  >
                    {POLICY_MAX_ITEM_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option} items
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    data-testid="memory-policy-save"
                    disabled={!canMutate || busyAction !== null || !policyDirty}
                    onClick={() => void handleSavePolicy()}
                    className="rounded-[10px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] disabled:opacity-60"
                  >
                    {busyAction === "save-policy" ? "saving..." : "save policy"}
                  </button>
                  <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                    Updated by {valueOrFallback(center.policy.updatedBy, "unknown")} @ {formatTimestamp(center.policy.updatedAt)}
                  </p>
                </div>
              </div>

              <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Injection Preview</p>
                    <h3 className="mt-2 font-display text-2xl font-bold">{preview ? preview.title : "等待 session"}</h3>
                  </div>
                  <select
                    data-testid="memory-preview-session"
                    value={resolvedSessionId}
                    onChange={(event) => setSelectedSessionId(event.target.value)}
                    className="rounded-[10px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3 text-sm outline-none"
                  >
                    {center.previews.map((item) => (
                      <option key={item.sessionId} value={item.sessionId}>
                        {previewLabel(item)}
                      </option>
                    ))}
                  </select>
                </div>

                {preview ? (
                  <>
                    <StatusRow label="Recall Policy" value={preview.recallPolicy} tone="yellow" />
                    <div className="mt-3 rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4">
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">Prompt Summary</p>
                      <pre data-testid="memory-preview-summary" className="mt-3 whitespace-pre-wrap font-mono text-[12px] leading-6">
                        {preview.promptSummary}
                      </pre>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">Mounted Files</p>
                        <div className="mt-3 space-y-2">
                          {preview.files.map((path) => (
                            <StatusRow
                              key={path}
                              label={path}
                              value="mounted into next run"
                              tone="white"
                              testID={`memory-preview-file-${toTestID(path)}`}
                            />
                          ))}
                        </div>
                      </div>

                      <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">Runtime Tools</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {preview.tools.map((tool) => (
                            <span key={tool} className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em]">
                              {tool}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 space-y-3">
                      {preview.items.map((item) => (
                        <div
                          key={`${item.path}-${item.reason}`}
                          data-testid={`memory-preview-item-${toTestID(item.path)}`}
                          className={cn("rounded-[18px] border-2 border-[var(--shock-ink)] px-4 py-4", governanceTone(item.governance))}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
                                {item.scope} / {item.kind}
                              </p>
                              <p className="mt-2 font-display text-2xl font-bold">{item.path}</p>
                            </div>
                            <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
                              {item.required ? "required" : item.reason}
                            </span>
                          </div>
                          <p className="mt-3 text-sm leading-6">{item.latestWrite || item.summary}</p>
                          {item.snippet ? (
                            <pre className="mt-3 whitespace-pre-wrap rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3 font-mono text-[12px] leading-6">
                              {item.snippet}
                            </pre>
                          ) : null}
                          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.6)]">
                            {summarizeGovernance(item.governance)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <EmptyState title="preview 未就绪" message="等 `/v1/memory-center` 返回 session-level recall truth 后，这里会展开 injection pack。" />
                )}
              </div>
            </div>

            <MutationFeedback error={mutationError} success={mutationSuccess} />
          </Panel>

          <Panel tone={canMutate ? "paper" : "white"}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">Promotion Flow</p>
                <h2 className="mt-2 font-display text-3xl font-bold">把高价值经验提升成 Skill / Policy</h2>
              </div>
              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                {center.pendingCount} pending / {center.approvedCount} approved
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
              普通 writeback 只进入 artifact history。要进入可复用的 skill / policy ledger，必须先发 promotion request，再由人类 review 把它转成正式 injected truth。
            </p>

            <div className="mt-5 grid gap-4 xl:grid-cols-[0.9fr_minmax(0,1.1fr)]">
              <form onSubmit={handleCreatePromotion} className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">Promotion Draft</p>
                  <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
                    {selectedArtifact ? selectedArtifact.path : "no artifact"}
                  </span>
                </div>

                <StatusRow
                  label="Selected Source"
                  value={selectedArtifact ? `${selectedArtifact.path} @ v${selectedArtifact.version ?? 0}` : "请先在左侧选择 artifact"}
                  tone="white"
                  testID="memory-promotion-source"
                />

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {(["skill", "policy"] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      data-testid={`memory-promotion-kind-${kind}`}
                      disabled={!canMutate || busyAction !== null}
                      onClick={() => setPromotionKind(kind)}
                      className={cn(
                        "rounded-[18px] border-2 border-[var(--shock-ink)] px-4 py-4 text-left disabled:opacity-60",
                        promotionKind === kind ? "bg-[var(--shock-yellow)] shadow-[4px_4px_0_0_var(--shock-ink)]" : "bg-white"
                      )}
                    >
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em]">{promotionKindLabel(kind)}</p>
                      <p className="mt-2 text-sm leading-6">
                        {kind === "skill" ? "把已验证有效的操作套路送进 `notes/skills.md`。" : "把需要人工确认的规则送进 `notes/policies.md`。"}
                      </p>
                    </button>
                  ))}
                </div>

                <div className="mt-4 space-y-3">
                  <input
                    data-testid="memory-promotion-title"
                    type="text"
                    value={promotionTitle}
                    onChange={(event) => setPromotionTitle(event.target.value)}
                    disabled={!canMutate || busyAction !== null}
                    className="w-full rounded-[10px] border-2 border-[var(--shock-ink)] px-3 py-3 text-sm outline-none disabled:opacity-60"
                    placeholder={promotionKind === "skill" ? "Room Conflict Triage" : "Room Over User Priority"}
                    required
                  />
                  <textarea
                    data-testid="memory-promotion-rationale"
                    value={promotionRationale}
                    onChange={(event) => setPromotionRationale(event.target.value)}
                    disabled={!canMutate || busyAction !== null}
                    className="min-h-[140px] w-full rounded-[10px] border-2 border-[var(--shock-ink)] px-3 py-3 text-sm leading-6 outline-none disabled:opacity-60"
                    placeholder="说明为什么这条经验值得被注入到下一条任务，而不是只留在单次 artifact history。"
                  />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    data-testid="memory-promotion-submit"
                    type="submit"
                    disabled={!canMutate || busyAction !== null || !selectedArtifact}
                    className="rounded-[10px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] disabled:opacity-60"
                  >
                    {busyAction === "create-promotion" ? "submitting..." : "queue promotion"}
                  </button>
                  <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                    当前会提交 {promotionKindLabel(promotionKind)} review；批准后才会真正写入 promoted ledger。
                  </p>
                </div>
              </form>

              <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">Review Queue</p>
                    <h3 className="mt-2 font-display text-2xl font-bold">governance / approval queue</h3>
                  </div>
                  <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
                    {center.promotions.length} requests
                  </span>
                </div>

                <div className="mt-4 space-y-3">
                  {center.promotions.length === 0 ? (
                    <EmptyState title="还没有 promotion request" message="先从左侧 artifact 发起一条 skill / policy promotion。批准后，它会进入 injected ledgers。" testID="memory-promotion-empty" />
                  ) : (
                    center.promotions.map((promotion) => {
                      const slug = toTestID(promotion.title);
                      const reviewBusy = busyAction === `review-${promotion.id}-approved` || busyAction === `review-${promotion.id}-rejected`;
                      return (
                        <div key={promotion.id} className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
                                {promotionKindLabel(promotion.kind)} / {promotion.sourcePath} @ v{promotion.sourceVersion}
                              </p>
                              <h4 className="mt-2 font-display text-2xl font-bold">{promotion.title}</h4>
                            </div>
                            <span
                              data-testid={`memory-promotion-${slug}-status`}
                              className={cn(
                                "rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]",
                                promotionTone(promotion.status) === "yellow" && "bg-[var(--shock-yellow)]",
                                promotionTone(promotion.status) === "lime" && "bg-[var(--shock-lime)]",
                                promotionTone(promotion.status) === "pink" && "bg-[var(--shock-pink)] text-white"
                              )}
                            >
                              {promotionStatusLabel(promotion.status)}
                            </span>
                          </div>

                          <p className="mt-3 text-sm leading-6">{promotion.rationale || "这条 promotion 没有额外 rationale。"}</p>
                          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.62)]">
                            proposed by {promotion.proposedBy} @ {formatTimestamp(promotion.proposedAt)}
                          </p>

                          {promotion.excerpt ? (
                            <pre className="mt-3 whitespace-pre-wrap rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3 font-mono text-[12px] leading-6">
                              {promotion.excerpt}
                            </pre>
                          ) : null}

                          {promotion.status === "pending_review" ? (
                            <div className="mt-4 flex flex-wrap gap-3">
                              <button
                                type="button"
                                data-testid={`memory-promotion-${slug}-approve`}
                                disabled={!canMutate || reviewBusy}
                                onClick={() => void handleReviewPromotion(promotion, "approved")}
                                className="rounded-[10px] border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] disabled:opacity-60"
                              >
                                {busyAction === `review-${promotion.id}-approved` ? "approving..." : "approve"}
                              </button>
                              <button
                                type="button"
                                data-testid={`memory-promotion-${slug}-reject`}
                                disabled={!canMutate || reviewBusy}
                                onClick={() => void handleReviewPromotion(promotion, "rejected")}
                                className="rounded-[10px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] disabled:opacity-60"
                              >
                                {busyAction === `review-${promotion.id}-rejected` ? "rejecting..." : "reject"}
                              </button>
                            </div>
                          ) : (
                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                              <StatusRow label="Reviewed By" value={valueOrFallback(promotion.reviewedBy, "未记录")} tone={promotionTone(promotion.status)} />
                              <StatusRow label="Reviewed At" value={formatTimestamp(promotion.reviewedAt)} tone="white" />
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
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
                <EmptyState title="当前 artifact 还没有 version history" message="等 `/v1/memory/:id` 返回 versions 后，这里会展开 audit timeline。" />
              ) : (
                [...versions].reverse().map((version) => (
                  <div key={`${version.version}-${version.updatedAt}`} className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">
                          v{version.version} / {formatTimestamp(version.updatedAt)}
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
