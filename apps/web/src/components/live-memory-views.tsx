"use client";

import { useDeferredValue, useEffect, useState, type FormEvent } from "react";

import { DetailRail, Panel } from "@/components/phase-zero-views";
import { usePhaseZeroState } from "@/lib/live-phase0";
import {
  type MemoryArtifactDetail,
  type MemoryCleanupRun,
  type MemoryProviderActivityRun,
  type MemoryInjectionPolicy,
  type MemoryInjectionPreview,
  type MemoryProviderBinding,
  type MemoryPromotion,
  type MemoryPromotionKind,
  type MemoryPromotionStatus,
  useLiveMemoryCenter,
} from "@/lib/live-memory";
import type { AuthSession, MemoryGovernance } from "@/lib/phase-zero-types";

const API_BASE = process.env.NEXT_PUBLIC_OPENSHOCK_API_BASE ?? "/api/control";
const POLICY_MAX_ITEM_OPTIONS = [4, 6, 8, 10, 12] as const;
const MEMORY_PROVIDER_SCOPE_OPTIONS = [
  "workspace",
  "issue-room",
  "room-notes",
  "decision-ledger",
  "promoted-ledger",
  "agent",
  "user",
  "run",
  "session",
] as const;

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

function governanceModeLabel(mode?: string) {
  switch (mode) {
    case "decision-ledger":
      return "决策记录";
    case "promoted-ledger":
      return "复用规则";
    case "state-snapshot":
      return "状态快照";
    default:
      return mode ? mode.replace(/-/g, " ") : "";
  }
}

function summarizeGovernance(governance?: MemoryGovernance) {
  if (!governance?.mode) {
    return "未设置规则";
  }

  const parts = [governanceModeLabel(governance.mode)];
  if (governance.requiresReview) {
    parts.push("需审核");
  }
  if (governance.escalation) {
    parts.push(`升级到 ${governance.escalation}`);
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
      summary: "内容没有变化，仅更新时间或来源发生了变化。",
      preview: ["# 内容无变化"],
    };
  }

  return {
    summary: `+${additions} / -${removals} lines`,
    preview: lines.length > 0 ? lines : ["# 已省略差异"],
  };
}

function policyModeLabel(mode: MemoryInjectionPolicy["mode"]) {
  return mode === "governed-first" ? "优先固定资料" : "平衡模式";
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
  return kind === "policy" ? "规则" : "技能";
}

function promotionStatusLabel(status: MemoryPromotionStatus) {
  switch (status) {
    case "approved":
      return "已通过";
    case "rejected":
      return "未通过";
    default:
      return "待审核";
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

function cleanupTone(status?: MemoryCleanupRun["status"]) {
  return status === "cleaned" ? "yellow" : "white";
}

function providerKindLabel(kind: MemoryProviderBinding["kind"]) {
  switch (kind) {
    case "workspace-file":
      return "工作区文件";
    case "search-sidecar":
      return "搜索索引";
    default:
      return "外部记忆";
  }
}

function providerStatusTone(status: MemoryProviderBinding["status"]) {
  switch (status) {
    case "healthy":
      return "lime";
    case "degraded":
      return "pink";
    default:
      return "white";
  }
}

function providerStatusLabel(status: MemoryProviderBinding["status"]) {
  switch (status) {
    case "healthy":
      return "正常";
    case "degraded":
      return "异常";
    default:
      return status;
  }
}

function providerActivityActionLabel(action: MemoryProviderActivityRun["action"]) {
  return action === "recovery" ? "恢复" : "检查";
}

function providerScopeLabel(scope: string) {
  return scope.replace(/-/g, " ");
}

function providerScopeSummary(provider: MemoryProviderBinding) {
  return `读取：${provider.readScopes.join(", ")} / 写入：${provider.writeScopes.length > 0 ? provider.writeScopes.join(", ") : "只读"}`;
}

function cleanupStatsSummary(stats: MemoryCleanupRun["stats"]) {
  if (!stats.totalRemoved) {
    return "当前无需清理";
  }

  const parts = [];
  if (stats.dedupedPending) {
    parts.push(`${stats.dedupedPending} 条重复`);
  }
  if (stats.supersededPending) {
    parts.push(`${stats.supersededPending} 条过期`);
  }
  if (stats.forgottenSourcePending) {
    parts.push(`${stats.forgottenSourcePending} 条已移除来源`);
  }
  if (stats.expiredPending || stats.expiredRejected) {
    parts.push(`${stats.expiredPending + stats.expiredRejected} 条超时`);
  }
  if (stats.orphanedPromotions) {
    parts.push(`${stats.orphanedPromotions} 条孤立申请`);
  }
  return parts.join(" / ");
}

function memoryArtifactStatusLabel(artifact?: {
  forgotten?: boolean;
  correctionCount?: number;
}) {
  if (!artifact) {
    return "未选择";
  }
  if (artifact.forgotten) {
    return "已移除";
  }
  if ((artifact.correctionCount ?? 0) > 0) {
    return `可用 / ${(artifact.correctionCount ?? 0)} 次修正`;
  }
  return "可用";
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
    <div className="rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5" data-testid={testID}>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">{label}</p>
      <p className="mt-1.5 text-sm leading-6">{value}</p>
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
        "rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-2.5",
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
      <p className="mt-1.5 text-sm leading-6">{value}</p>
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
  const activeProviders = center.providers.filter((provider) => provider.enabled).length;
  const degradedProviders = center.providers.filter((provider) => provider.status === "degraded").length;

  return (
    <DetailRail
      label="记忆"
      items={[
        {
          label: "条目",
          value: loading ? "同步中" : error ? "读取失败" : `${memory.length} 条`,
        },
        {
          label: "已纳入规则",
          value: loading ? "同步中" : error ? "读取失败" : `${governed} 条`,
        },
        {
          label: "待审核",
          value: centerLoading ? "同步中" : centerError ? "读取失败" : `${center.pendingCount} 条`,
        },
        {
          label: "带入方式",
          value: centerLoading ? "同步中" : centerError ? "读取失败" : policyModeLabel(center.policy.mode),
        },
        {
          label: "来源",
          value: centerLoading ? "同步中" : centerError ? "读取失败" : `${activeProviders} 可用 / ${degradedProviders} 异常`,
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
  const {
    center,
    loading: centerLoading,
    error: centerError,
    updatePolicy,
    updateProviders,
    checkProvider,
    recoverProvider,
    createPromotion,
    reviewPromotion,
    runCleanup,
    submitFeedback,
    forgetMemory,
  } = useLiveMemoryCenter();
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
  const [providerDrafts, setProviderDrafts] = useState<MemoryProviderBinding[]>([]);
  const [providerDirty, setProviderDirty] = useState(false);

  const [promotionKind, setPromotionKind] = useState<MemoryPromotionKind>("skill");
  const [promotionTitle, setPromotionTitle] = useState("");
  const [promotionRationale, setPromotionRationale] = useState("");
  const [feedbackSummary, setFeedbackSummary] = useState("人工修正");
  const [feedbackNote, setFeedbackNote] = useState("");
  const [forgetReason, setForgetReason] = useState("");

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

  useEffect(() => {
    if (!providerDirty) {
      setProviderDrafts(center.providers);
    }
  }, [center.providers, providerDirty]);

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
  const activeProviders = center.providers.filter((provider) => provider.enabled).length;
  const degradedProviders = center.providers.filter((provider) => provider.status === "degraded").length;
  const artifactSupportsMutation = Boolean(selectedArtifact && selectedArtifact.path !== "repo-binding");

  async function runAction(action: string, task: () => Promise<void>) {
    setBusyAction(action);
    setMutationError(null);
    setMutationSuccess(null);
    try {
      await task();
    } catch (mutationFailure) {
      setMutationError(mutationFailure instanceof Error ? mutationFailure.message : "操作失败");
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
      setMutationSuccess(`带入设置已更新为 ${policyModeLabel(policyModeDraft)}，最多 ${maxItemsDraft} 条。`);
    });
  }

  async function handleCreatePromotion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedArtifact) {
      setMutationError("请先选择要整理的内容。");
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
      setMutationSuccess(`${selectedArtifact.path} 已提交${promotionKindLabel(promotionKind)}审核。`);
    });
  }

  async function handleSubmitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedArtifact) {
      setMutationError("请先选择要修正的内容。");
      return;
    }

    await runAction("submit-feedback", async () => {
      const payload = await submitFeedback(selectedArtifact.id, {
        sourceVersion: latestVersion?.version ?? selectedArtifact.version,
        summary: feedbackSummary.trim(),
        note: feedbackNote.trim(),
      });
      setDetail(payload.detail);
      await refresh();
      setFeedbackSummary("人工修正");
      setFeedbackNote("");
      setMutationSuccess(`${selectedArtifact.path} 已更新。`);
    });
  }

  async function handleForget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedArtifact) {
      setMutationError("请先选择要移除的内容。");
      return;
    }

    await runAction("forget-artifact", async () => {
      const payload = await forgetMemory(selectedArtifact.id, {
        sourceVersion: latestVersion?.version ?? selectedArtifact.version,
        reason: forgetReason.trim(),
      });
      setDetail(payload.detail);
      await refresh();
      setForgetReason("");
      setMutationSuccess(`${selectedArtifact.path} 已从后续任务中移除。`);
    });
  }

  async function handleReviewPromotion(promotion: MemoryPromotion, status: Extract<MemoryPromotionStatus, "approved" | "rejected">) {
    await runAction(`review-${promotion.id}-${status}`, async () => {
      await reviewPromotion(promotion.id, {
        status,
        reviewNote: status === "approved" ? "审核通过" : "审核未通过",
      });
      await refresh();
      setMutationSuccess(`${promotion.title} 已${promotionStatusLabel(status)}。`);
    });
  }

  async function handleRunCleanup() {
    await runAction("run-cleanup", async () => {
      const payload = await runCleanup();
      setMutationSuccess(payload.cleanup.summary);
    });
  }

  function onPolicyToggle(next: boolean, setter: (value: boolean) => void) {
    setter(next);
    setPolicyDirty(true);
  }

  function updateProviderDraft(providerId: string, recipe: (current: MemoryProviderBinding) => MemoryProviderBinding) {
    setProviderDrafts((current) =>
      current.map((provider) => {
        if (provider.id !== providerId) {
          return provider;
        }
        return recipe(provider);
      })
    );
    setProviderDirty(true);
  }

  function toggleProviderScope(providerId: string, field: "readScopes" | "writeScopes", scope: string) {
    updateProviderDraft(providerId, (provider) => {
      const current = provider[field];
      const hasScope = current.includes(scope);
      const next = hasScope ? current.filter((item) => item !== scope) : [...current, scope];
      return {
        ...provider,
        [field]: next,
      };
    });
  }

  async function handleSaveProviders() {
    await runAction("save-providers", async () => {
      const payload = await updateProviders(providerDrafts);
      setProviderDirty(false);
      await refresh();
      const nextActive = payload.providers.filter((provider) => provider.enabled).length;
      const nextDegraded = payload.providers.filter((provider) => provider.status === "degraded").length;
      setMutationSuccess(`来源设置已保存：${nextActive} 个可用，${nextDegraded} 个异常。`);
    });
  }

  async function handleCheckProvider(providerId: string) {
    await runAction(`check-provider-${providerId}`, async () => {
      const payload = await checkProvider(providerId);
      const provider = payload.providers.find((item) => item.id === providerId);
      if (!provider) {
        throw new Error("检查已完成，但没有返回对应来源。");
      }
      await refresh();
      setMutationSuccess(`${provider.label} 检查完成，当前状态：${providerStatusLabel(provider.status)}。`);
    });
  }

  async function handleRecoverProvider(providerId: string) {
    await runAction(`recover-provider-${providerId}`, async () => {
      const payload = await recoverProvider(providerId);
      await refresh();
      setMutationSuccess(`${payload.provider.label} 恢复完成，当前状态：${providerStatusLabel(payload.provider.status)}。`);
    });
  }

  return (
    <div className="space-y-4">
      {error ? (
        <Panel tone="pink">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">状态同步失败</p>
          <p className="mt-3 text-base leading-7">当前无法读取工作区状态：{error}</p>
        </Panel>
      ) : null}

      {centerError ? (
        <Panel tone="pink">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">记忆同步失败</p>
          <p className="mt-3 text-base leading-7">当前无法读取记忆中心：{centerError}</p>
        </Panel>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <ArtifactFact label="条目" value={loading ? "同步中" : `${memory.length} 条`} testID="memory-artifact-count" />
        <ArtifactFact label="已纳入规则" value={loading ? "同步中" : `${governedArtifacts} 条`} testID="memory-governed-count" />
        <ArtifactFact
          label="待审核"
          value={centerLoading ? "同步中" : `${center.pendingCount} 待处理 / ${center.approvedCount} 已通过`}
          testID="memory-pending-count"
        />
        <ArtifactFact
          label="来源"
          value={centerLoading ? "同步中" : `${activeProviders} 可用 / ${degradedProviders} 异常`}
          testID="memory-provider-count"
        />
        <ArtifactFact
          label="下一次任务"
          value={preview ? `${preview.items.length} 条资料 / ${preview.files.length} 个文件` : centerLoading ? "同步中" : "未选择"}
          testID="memory-preview-size"
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Panel tone="paper" className="!p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">资料列表</p>
              <h2 className="mt-1.5 font-display text-[24px] font-bold leading-7">已有资料</h2>
            </div>
            <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
              {loading ? "同步中" : `${memory.length} 条`}
            </span>
          </div>
          <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">
            资料、规则栈和下一次任务预览。
          </p>

          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-1">
            <StatusRow label="已纳入规则" value={`${governedArtifacts} 条`} tone="white" />
            <StatusRow label="决策记录" value={`${decisionArtifacts} 条`} tone="yellow" />
            <StatusRow label="复用规则" value={`${promotedLedgers} 条`} tone="lime" />
            <StatusRow label="来源状态" value={`${activeProviders} 可用 / ${degradedProviders} 异常`} tone="white" />
            <StatusRow label="当前带入方式" value={centerLoading ? "同步中" : policyModeLabel(center.policy.mode)} tone="white" />
          </div>

          <div className="mt-4 space-y-2">
            {memory.length === 0 ? (
              <EmptyState title="暂无资料" message="同步后会显示资料和历史。" />
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
                      "w-full rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3 text-left transition-transform hover:-translate-y-0.5",
                      active ? "bg-[var(--shock-yellow)] shadow-[4px_4px_0_0_var(--shock-ink)]" : governanceTone(artifact.governance)
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">{artifact.scope}</p>
                        <p className="mt-1.5 font-display text-[18px] font-bold leading-5">{artifact.path}</p>
                      </div>
                      <span
                        className={cn(
                          "rounded-full border-2 border-[var(--shock-ink)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]",
                          artifact.forgotten ? "bg-[var(--shock-pink)] text-white" : "bg-white"
                        )}
                      >
                        {artifact.forgotten ? "已移除" : `v${artifact.version ?? 0}`}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6">{artifact.summary}</p>
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.58)]">
                      {summarizeGovernance(artifact.governance)}
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel tone="white" className="!p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">内容详情</p>
                <h2 data-testid="memory-detail-path" className="mt-1.5 font-display text-[24px] font-bold leading-7">
                  {selectedArtifact?.path ?? "等待选择"}
                </h2>
              </div>
              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                {selectedArtifact ? summarizeGovernance(selectedArtifact.governance) : "未选择"}
              </span>
            </div>

            {detailError ? (
              <p className="mt-4 rounded-[16px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-4 text-sm leading-6 text-white">
                无法读取这条资料：{detailError}
              </p>
            ) : null}

            <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              <ArtifactFact label="版本" value={selectedArtifact ? `v${selectedArtifact.version ?? 0}` : "未选择"} />
              <ArtifactFact
                label="状态"
                value={memoryArtifactStatusLabel(selectedArtifact)}
                testID="memory-detail-status"
              />
              <ArtifactFact
                label="范围 / 类型"
                value={selectedArtifact ? `${selectedArtifact.scope} / ${selectedArtifact.kind}` : "未选择"}
              />
              <ArtifactFact label="最近更新" value={valueOrFallback(selectedArtifact?.latestWrite, "未记录")} />
              <ArtifactFact
                label="来源 / 修改人"
                value={
                  selectedArtifact
                    ? `${valueOrFallback(selectedArtifact.latestSource, "未记录")} / ${valueOrFallback(selectedArtifact.latestActor, "未记录")}`
                    : "未选择"
                }
              />
              <ArtifactFact
                label="摘要 / 大小"
                value={
                  selectedArtifact
                    ? `${valueOrFallback(selectedArtifact.digest?.slice(0, 10), "未记录")} / ${formatBytes(selectedArtifact.sizeBytes)}`
                    : "未选择"
                }
              />
              <ArtifactFact
                label="修正记录"
                value={
                  selectedArtifact
                    ? `${selectedArtifact.correctionCount ?? 0} 次 / ${valueOrFallback(selectedArtifact.lastCorrectionBy, "暂无")}`
                    : "未选择"
                }
                testID="memory-detail-correction-count"
              />
            </div>

            <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_0.85fr]">
              <div className="rounded-[16px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">当前内容</p>
                <pre
                  data-testid="memory-detail-content"
                  className="mt-3 max-h-[360px] overflow-auto whitespace-pre-wrap font-mono text-[12px] leading-6 text-[color:rgba(24,20,14,0.82)]"
                >
                  {detailLoading ? "正在读取内容..." : resolvedDetail?.content || "# 暂无内容"}
                </pre>
              </div>

              <div className="rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">版本差异</p>
                <p className="mt-3 text-sm leading-6">
                  {previousVersion ? `v${previousVersion.version} -> v${latestVersion?.version ?? "?"}` : "暂无上一版可对比。"}
                </p>
                <p className="mt-2 rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em]">
                  {diff.summary}
                </p>
                <pre className="mt-3 max-h-[280px] overflow-auto whitespace-pre-wrap rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3 font-mono text-[12px] leading-6">
                  {diff.preview.join("\n")}
                </pre>
              </div>
            </div>

            <div className="mt-4 grid gap-3 xl:grid-cols-[0.95fr_minmax(0,1.05fr)]">
              <form onSubmit={handleSubmitFeedback} className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">修正内容</p>
                    <h3 className="mt-2 font-display text-2xl font-bold">更新这条资料</h3>
                  </div>
                  <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
                    {artifactSupportsMutation ? "可编辑" : "只读"}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">
                  提交后会保留历史，并更新这条资料的最新版本。
                </p>
                <div className="mt-4 space-y-3">
                  <input
                    data-testid="memory-feedback-summary"
                    type="text"
                    value={feedbackSummary}
                    onChange={(event) => setFeedbackSummary(event.target.value)}
                    disabled={!canMutate || !artifactSupportsMutation || selectedArtifact?.forgotten || busyAction !== null}
                    className="w-full rounded-[10px] border-2 border-[var(--shock-ink)] px-3 py-3 text-sm outline-none disabled:opacity-60"
                    placeholder="修正标题"
                    required
                  />
                  <textarea
                    data-testid="memory-feedback-note"
                    value={feedbackNote}
                    onChange={(event) => setFeedbackNote(event.target.value)}
                    disabled={!canMutate || !artifactSupportsMutation || selectedArtifact?.forgotten || busyAction !== null}
                    className="min-h-[140px] w-full rounded-[10px] border-2 border-[var(--shock-ink)] px-3 py-3 text-sm leading-6 outline-none disabled:opacity-60"
                    placeholder="说明哪里需要改，以及以后应该保留什么内容。"
                    required
                  />
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    data-testid="memory-feedback-submit"
                    type="submit"
                    disabled={!canMutate || !artifactSupportsMutation || selectedArtifact?.forgotten || busyAction !== null || !selectedArtifact}
                    className="rounded-[10px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] disabled:opacity-60"
                  >
                    {busyAction === "submit-feedback" ? "保存中..." : "保存修正"}
                  </button>
                  <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                    {selectedArtifact?.forgotten ? "已移除的内容不能继续修改。" : "会记录修改人、时间和版本。"}
                  </p>
                </div>
              </form>

              <form onSubmit={handleForget} className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">移除内容</p>
                    <h3 className="mt-2 font-display text-2xl font-bold">不要再带入后续任务</h3>
                  </div>
                  <span
                    className={cn(
                      "rounded-full border-2 border-[var(--shock-ink)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]",
                      selectedArtifact?.forgotten ? "bg-[var(--shock-pink)] text-white" : "bg-[var(--shock-paper)]"
                    )}
                  >
                    {selectedArtifact?.forgotten ? "已移除" : "可用"}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">
                  不会删历史，只是不再带进后续任务。
                </p>
                {selectedArtifact?.forgotten ? (
                  <div className="mt-4 rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-3 py-3 text-sm leading-6 text-white">
                    由 {valueOrFallback(selectedArtifact.forgottenBy, "未记录")} 于 {formatTimestamp(selectedArtifact.forgottenAt)} 移除。{valueOrFallback(selectedArtifact.forgetReason, "未记录原因")}
                  </div>
                ) : null}
                <textarea
                  data-testid="memory-forget-reason"
                  value={forgetReason}
                  onChange={(event) => setForgetReason(event.target.value)}
                  disabled={!canMutate || !artifactSupportsMutation || selectedArtifact?.forgotten || busyAction !== null}
                  className="mt-4 min-h-[140px] w-full rounded-[10px] border-2 border-[var(--shock-ink)] px-3 py-3 text-sm leading-6 outline-none disabled:opacity-60"
                  placeholder="说明为什么后续任务不该继续使用这条内容。"
                  required
                />
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    data-testid="memory-forget-submit"
                    type="submit"
                    disabled={!canMutate || !artifactSupportsMutation || selectedArtifact?.forgotten || busyAction !== null || !selectedArtifact}
                    className="rounded-[10px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] text-white disabled:opacity-60"
                  >
                    {busyAction === "forget-artifact" ? "处理中..." : "移除"}
                  </button>
                  <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                    {artifactSupportsMutation ? "会保留历史，并从后续任务中移除。" : "当前内容不能直接修改。"}
                  </p>
                </div>
              </form>
            </div>
          </Panel>

          <Panel tone={canMutate ? "paper" : "white"} className="!p-3.5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">记忆来源</p>
                <h2 className="mt-1.5 font-display text-[24px] font-bold leading-7">资料来源</h2>
              </div>
              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                {centerLoading ? "同步中" : `${activeProviders} 可用 / ${degradedProviders} 异常`}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
              本地文件、搜索索引和外部记忆来源。
            </p>

            <div className="mt-5 space-y-4">
              {providerDrafts.map((provider) => {
                const readOnlyWriteScopes = provider.kind === "search-sidecar";
                return (
                  <div
                    key={provider.id}
                    data-testid={`memory-provider-card-${provider.id}`}
                    className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
                          {providerKindLabel(provider.kind)}
                        </p>
                        <h3 className="mt-2 font-display text-2xl font-bold">{provider.label}</h3>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          data-testid={`memory-provider-status-${provider.id}`}
                          className={cn(
                            "rounded-full border-2 border-[var(--shock-ink)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]",
                            providerStatusTone(provider.status) === "lime" && "bg-[var(--shock-lime)]",
                            providerStatusTone(provider.status) === "pink" && "bg-[var(--shock-pink)] text-white",
                            providerStatusTone(provider.status) === "white" && "bg-[var(--shock-paper)]"
                          )}
                        >
                          {providerStatusLabel(provider.status)}
                        </span>
                        <button
                          type="button"
                          data-testid={`memory-provider-toggle-${provider.id}`}
                          disabled={!canMutate || busyAction !== null || provider.kind === "workspace-file"}
                          onClick={() =>
                            updateProviderDraft(provider.id, (current) => ({
                              ...current,
                              enabled: !current.enabled,
                            }))
                          }
                          className={cn(
                            "rounded-full border-2 border-[var(--shock-ink)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] disabled:opacity-60",
                            provider.enabled ? "bg-[var(--shock-yellow)]" : "bg-white"
                          )}
                        >
                          {provider.enabled ? "已启用" : "已停用"}
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                      <StatusRow label="范围" value={providerScopeSummary(provider)} tone="white" />
                      <StatusRow label="读取规则" value={provider.recallPolicy} tone="yellow" />
                      <StatusRow label="保留规则" value={provider.retentionPolicy} tone="white" />
                      <StatusRow
                        label="最近检查"
                        value={`${formatTimestamp(provider.lastCheckedAt)} / ${valueOrFallback(provider.lastCheckSource, "未记录")}`}
                        tone={provider.status === "degraded" ? "pink" : "white"}
                      />
                    </div>

                    <div className="mt-4 grid gap-2 md:grid-cols-2">
                      <StatusRow
                        label="当前状态"
                        value={valueOrFallback(provider.lastSummary, "暂无状态说明")}
                        tone={provider.status === "degraded" ? "pink" : provider.status === "healthy" ? "lime" : "white"}
                        testID={`memory-provider-health-summary-${provider.id}`}
                      />
                      <StatusRow
                        label="建议操作"
                        value={valueOrFallback(provider.nextAction, "当前无需额外处理")}
                        tone={provider.status === "degraded" ? "yellow" : "white"}
                        testID={`memory-provider-next-action-${provider.id}`}
                      />
                    </div>

                    {provider.lastError ? (
                      <p
                        data-testid={`memory-provider-error-${provider.id}`}
                        className="mt-4 rounded-[16px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-4 text-sm leading-6 text-white"
                      >
                        {provider.lastError}
                      </p>
                    ) : null}

                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        data-testid={`memory-provider-check-${provider.id}`}
                        disabled={!canMutate || busyAction !== null}
                        onClick={() => void handleCheckProvider(provider.id)}
                        className="rounded-[10px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] disabled:opacity-60"
                      >
                        {busyAction === `check-provider-${provider.id}` ? "检查中..." : "运行检查"}
                      </button>
                      <button
                        type="button"
                        data-testid={`memory-provider-recover-${provider.id}`}
                        disabled={!canMutate || busyAction !== null}
                        onClick={() => void handleRecoverProvider(provider.id)}
                        className="rounded-[10px] border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] disabled:opacity-60"
                      >
                        {busyAction === `recover-provider-${provider.id}` ? "恢复中..." : "尝试恢复"}
                      </button>
                      <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                        {provider.failureCount && provider.failureCount > 0
                          ? `已连续 ${provider.failureCount} 次异常。`
                          : "目前没有连续异常。"}
                      </p>
                    </div>

                    <div className="mt-4 grid gap-4 xl:grid-cols-2">
                      <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4">
                        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">读取范围</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {MEMORY_PROVIDER_SCOPE_OPTIONS.map((scope) => {
                            const active = provider.readScopes.includes(scope);
                            return (
                              <button
                                key={`${provider.id}-read-${scope}`}
                                type="button"
                                disabled={!canMutate || busyAction !== null}
                                onClick={() => toggleProviderScope(provider.id, "readScopes", scope)}
                                className={cn(
                                  "rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] disabled:opacity-60",
                                  active ? "bg-[var(--shock-lime)]" : "bg-white"
                                )}
                              >
                                {providerScopeLabel(scope)}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">写入范围</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {MEMORY_PROVIDER_SCOPE_OPTIONS.map((scope) => {
                            const active = provider.writeScopes.includes(scope);
                            return (
                              <button
                                key={`${provider.id}-write-${scope}`}
                                type="button"
                                disabled={!canMutate || busyAction !== null || readOnlyWriteScopes}
                                onClick={() => toggleProviderScope(provider.id, "writeScopes", scope)}
                                className={cn(
                                  "rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] disabled:opacity-60",
                                  active ? "bg-[var(--shock-yellow)]" : "bg-[var(--shock-paper)]"
                                )}
                              >
                                {providerScopeLabel(scope)}
                              </button>
                            );
                          })}
                        </div>
                        {readOnlyWriteScopes ? (
                          <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                            搜索索引只负责读取，不会写回。
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 xl:grid-cols-[repeat(3,minmax(0,1fr))]">
                      <input
                        type="text"
                        value={provider.recallPolicy}
                        disabled={!canMutate || busyAction !== null}
                        onChange={(event) =>
                          updateProviderDraft(provider.id, (current) => ({
                            ...current,
                            recallPolicy: event.target.value,
                          }))
                        }
                        className="w-full rounded-[10px] border-2 border-[var(--shock-ink)] px-3 py-3 text-sm outline-none disabled:opacity-60"
                        placeholder="读取规则"
                      />
                      <input
                        type="text"
                        value={provider.retentionPolicy}
                        disabled={!canMutate || busyAction !== null}
                        onChange={(event) =>
                          updateProviderDraft(provider.id, (current) => ({
                            ...current,
                            retentionPolicy: event.target.value,
                          }))
                        }
                        className="w-full rounded-[10px] border-2 border-[var(--shock-ink)] px-3 py-3 text-sm outline-none disabled:opacity-60"
                        placeholder="保留规则"
                      />
                      <input
                        type="text"
                        value={provider.sharingPolicy}
                        disabled={!canMutate || busyAction !== null}
                        onChange={(event) =>
                          updateProviderDraft(provider.id, (current) => ({
                            ...current,
                            sharingPolicy: event.target.value,
                          }))
                        }
                        className="w-full rounded-[10px] border-2 border-[var(--shock-ink)] px-3 py-3 text-sm outline-none disabled:opacity-60"
                        placeholder="共享规则"
                      />
                    </div>

                    <textarea
                      data-testid={`memory-provider-summary-${provider.id}`}
                      value={provider.summary}
                      disabled={!canMutate || busyAction !== null}
                      onChange={(event) =>
                        updateProviderDraft(provider.id, (current) => ({
                          ...current,
                          summary: event.target.value,
                        }))
                      }
                      className="mt-4 min-h-[110px] w-full rounded-[10px] border-2 border-[var(--shock-ink)] px-3 py-3 text-sm leading-6 outline-none disabled:opacity-60"
                      placeholder="补充说明"
                    />

                    <div className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">检查记录</p>
                        <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
                          {provider.activity.length} 条
                        </span>
                      </div>
                      <div className="mt-3 space-y-2" data-testid={`memory-provider-activity-${provider.id}`}>
                        {provider.activity.length === 0 ? (
                          <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">暂无检查记录。先运行一次检查或恢复。</p>
                        ) : (
                          provider.activity.map((event) => (
                            <div
                              key={event.id}
                              className={cn(
                                "rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3",
                                providerStatusTone(event.status) === "lime" && "bg-[var(--shock-lime)]",
                                providerStatusTone(event.status) === "pink" && "bg-[var(--shock-pink)] text-white",
                                providerStatusTone(event.status) === "white" && "bg-white"
                              )}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <p className="font-mono text-[10px] uppercase tracking-[0.18em]">
                                  {providerActivityActionLabel(event.action)} / {providerStatusLabel(event.status)}
                                </p>
                                <p className="font-mono text-[10px] uppercase tracking-[0.16em]">
                                  {formatTimestamp(event.triggeredAt)} / {valueOrFallback(event.triggeredBy, "系统")}
                                </p>
                              </div>
                              <p className="mt-2 text-sm leading-6">{event.summary}</p>
                              {event.detail ? <p className="mt-2 text-sm leading-6 opacity-80">{event.detail}</p> : null}
                              {event.nextAction ? (
                                <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] opacity-80">下一步：{event.nextAction}</p>
                              ) : null}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                data-testid="memory-providers-save"
                disabled={!canMutate || busyAction !== null || !providerDirty}
                onClick={() => void handleSaveProviders()}
                className="rounded-[10px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] disabled:opacity-60"
              >
                {busyAction === "save-providers" ? "保存中..." : "保存来源设置"}
              </button>
              <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                {providerDirty ? "有未保存修改。" : "已保存。"}
              </p>
            </div>
          </Panel>

          <Panel tone={canMutate ? "yellow" : "paper"} className="!p-3.5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">带入设置</p>
                <h2 className="mt-1.5 font-display text-[24px] font-bold leading-7">下一次任务会带什么</h2>
              </div>
              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                {canMutate ? "可编辑" : "只读"}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
              可以控制讨论记录、决策、Agent 资料等内容是否带入下一次任务。
            </p>

            {!canMutate ? (
              <div className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
                <p className="font-mono text-[11px] uppercase tracking-[0.16em]">
                  当前账号只读，不能修改。
                </p>
              </div>
            ) : null}

            <div className="mt-5 grid gap-4 xl:grid-cols-[0.95fr_minmax(0,1.05fr)]">
              <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">当前设置</p>
                  <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
                    {policyDirty ? "有修改" : "已保存"}
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
                        {mode === "governed-first" ? "优先带入固定资料和已确认内容。" : "平衡当前会话和长期资料。"}
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
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em]">讨论记录</p>
                    <p className="mt-2 text-sm leading-6">{includeRoomNotesDraft ? "带入讨论记录" : "不带入讨论记录"}</p>
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
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em]">决策记录</p>
                    <p className="mt-2 text-sm leading-6">{includeDecisionLedgerDraft ? "带入决策记录" : "不带入决策记录"}</p>
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
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em]">Agent 资料</p>
                    <p className="mt-2 text-sm leading-6">{includeAgentMemoryDraft ? "带入 Agent 资料" : "只用工作区和讨论资料"}</p>
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
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em]">复用规则</p>
                    <p className="mt-2 text-sm leading-6">{includePromotedArtifactsDraft ? "带入已沉淀的技能和规则" : "不带入复用规则"}</p>
                  </button>
                </div>

                <div className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4">
                  <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]" htmlFor="memory-policy-max-items">
                    最多带入条数
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
                        {option} 条
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
                    {busyAction === "save-policy" ? "保存中..." : "保存设置"}
                  </button>
                  <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                    最近更新：{valueOrFallback(center.policy.updatedBy, "未记录")} / {formatTimestamp(center.policy.updatedAt)}
                  </p>
                </div>
              </div>

              <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">预览</p>
                    <h3 className="mt-2 font-display text-2xl font-bold">{preview ? preview.title : "等待会话"}</h3>
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
                    <StatusRow label="读取规则" value={preview.recallPolicy} tone="yellow" />
                    <div className="mt-3 rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4">
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">任务摘要</p>
                      <pre data-testid="memory-preview-summary" className="mt-3 whitespace-pre-wrap font-mono text-[12px] leading-6">
                        {preview.promptSummary}
                      </pre>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">规则栈与附带文件</p>
                        <div className="mt-3 space-y-2">
                          {preview.files.map((path) => (
                            <StatusRow
                              key={path}
                              label={path}
                              value="下一次任务会读取"
                              tone="white"
                              testID={`memory-preview-file-${toTestID(path)}`}
                            />
                          ))}
                        </div>
                      </div>

                      <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">可用工具</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {preview.tools.map((tool) => (
                            <span key={tool} className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em]">
                              {tool}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">使用中的来源</p>
                        <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
                          {preview.providers.length} 个
                        </span>
                      </div>
                      <div className="mt-3 grid gap-3 xl:grid-cols-3">
                        {preview.providers.map((provider) => (
                          <div
                            key={provider.id}
                            data-testid={`memory-preview-provider-${provider.id}`}
                            className="rounded-[16px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
                                  {providerKindLabel(provider.kind)}
                                </p>
                                <p className="mt-2 font-display text-xl font-bold leading-6">{provider.label}</p>
                              </div>
                              <span
                                className={cn(
                                  "rounded-full border-2 border-[var(--shock-ink)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]",
                                  providerStatusTone(provider.status) === "lime" && "bg-[var(--shock-lime)]",
                                  providerStatusTone(provider.status) === "pink" && "bg-[var(--shock-pink)] text-white",
                                  providerStatusTone(provider.status) === "white" && "bg-white"
                                )}
                              >
                                {providerStatusLabel(provider.status)}
                              </span>
                            </div>
                            <p className="mt-3 text-sm leading-6">{provider.summary}</p>
                            {provider.lastSummary ? <p className="mt-3 text-sm leading-6">{provider.lastSummary}</p> : null}
                            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.62)]">
                              {providerScopeSummary(provider)}
                            </p>
                            {provider.lastError ? (
                              <p className="mt-3 rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-3 py-3 text-sm leading-6 text-white">
                                {provider.lastError}
                              </p>
                            ) : null}
                            {provider.nextAction ? (
                              <p className="mt-3 rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3 text-sm leading-6">
                                下一步：{provider.nextAction}
                              </p>
                            ) : null}
                          </div>
                        ))}
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
                              {item.required ? "必带" : item.reason}
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
                  <EmptyState title="预览暂不可用" message="同步后会显示下一次任务预览。" />
                )}
              </div>
            </div>

            <MutationFeedback error={mutationError} success={mutationSuccess} />
          </Panel>

          <Panel tone="white">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">清理记录</p>
                <h2 className="mt-2 font-display text-3xl font-bold">清理过期和重复内容</h2>
              </div>
              <button
                type="button"
                data-testid="memory-cleanup-run"
                disabled={!canMutate || busyAction !== null}
                onClick={() => void handleRunCleanup()}
                className="rounded-[10px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] disabled:opacity-60"
              >
                {busyAction === "run-cleanup"
                  ? "清理中..."
                  : center.cleanup.due && center.cleanup.dueCount > 0
                    ? `处理 ${center.cleanup.dueCount} 条待清理`
                    : "开始清理"}
              </button>
            </div>
            <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
              用来清理过期、重复或不再使用的条目。
            </p>

            <div className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
              <StatusRow
                label="当前状态"
                value={
                  center.cleanup.due && center.cleanup.dueCount > 0
                    ? `有 ${center.cleanup.dueCount} 条待清理项，建议现在执行。`
                    : center.cleanup.nextRunAt
                      ? `目前没有待清理项，下一次建议检查时间为 ${formatTimestamp(center.cleanup.nextRunAt)}。`
                      : "目前没有待清理项。"
                }
                tone={center.cleanup.due ? "yellow" : "white"}
                testID="memory-cleanup-schedule"
              />
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <ArtifactFact
                label="上次运行"
                value={center.cleanup.lastRunAt ? formatTimestamp(center.cleanup.lastRunAt) : "尚未执行"}
                testID="memory-cleanup-last-run"
              />
              <ArtifactFact
                label="执行人"
                value={valueOrFallback(center.cleanup.lastRunBy, "系统")}
                testID="memory-cleanup-last-actor"
              />
              <ArtifactFact
                label="结果"
                value={center.cleanup.lastStatus === "cleaned" ? "已清理" : center.cleanup.lastRunAt ? "无变化" : "尚未执行"}
                testID="memory-cleanup-last-status"
              />
              <ArtifactFact
                label="移除"
                value={`${center.cleanup.lastStats.totalRemoved} 条`}
                testID="memory-cleanup-removed-count"
              />
            </div>

            <div className="mt-4 grid gap-3 xl:grid-cols-[0.92fr_minmax(0,1.08fr)]">
              <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4">
                <StatusRow
                  label="摘要"
                  value={valueOrFallback(center.cleanup.lastSummary, "暂无清理记录")}
                  tone={cleanupTone(center.cleanup.lastStatus)}
                  testID="memory-cleanup-last-summary"
                />
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <StatusRow label="重复" value={`${center.cleanup.lastStats.dedupedPending} 条`} tone="white" />
                  <StatusRow label="过期" value={`${center.cleanup.lastStats.supersededPending} 条`} tone="white" />
                  <StatusRow label="已移除来源" value={`${center.cleanup.lastStats.forgottenSourcePending} 条`} tone="white" />
                  <StatusRow
                    label="超时 / 孤立"
                    value={`${center.cleanup.lastStats.expiredPending + center.cleanup.lastStats.expiredRejected + center.cleanup.lastStats.orphanedPromotions} 条`}
                    tone="white"
                  />
                </div>
                <div className="mt-3 rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">处理建议</p>
                  <p data-testid="memory-cleanup-last-recovery" className="mt-3 text-sm leading-6">
                    {valueOrFallback(center.cleanup.lastRecovery, "当前无需处理。")}
                  </p>
                </div>
              </div>

              <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">最近记录</p>
                    <h3 className="mt-2 font-display text-2xl font-bold">最近执行</h3>
                  </div>
                  <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
                    {center.cleanup.ledger.length} 次
                  </span>
                </div>

                <div className="mt-4 space-y-3">
                  {center.cleanup.ledger.length === 0 ? (
	                    <EmptyState
	                      title="暂无清理记录"
	                      message="运行清理后会显示结果。"
	                      testID="memory-cleanup-empty"
	                    />
                  ) : (
                    center.cleanup.ledger.map((entry) => (
                      <div key={entry.id} className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
                              {valueOrFallback(entry.triggeredBy, "系统")} / {formatTimestamp(entry.triggeredAt)}
                            </p>
                            <h4 className="mt-2 font-display text-2xl font-bold">{entry.summary}</h4>
                          </div>
                          <span
                            className={cn(
                              "rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]",
                              cleanupTone(entry.status) === "yellow" ? "bg-[var(--shock-yellow)]" : "bg-white"
                            )}
                          >
                            {entry.status === "cleaned" ? "已清理" : "无变化"}
                          </span>
                        </div>
                        <p className="mt-3 text-sm leading-6">{entry.recovery}</p>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <StatusRow label="移除" value={`${entry.stats.totalRemoved} 条`} tone={cleanupTone(entry.status)} />
                          <StatusRow label="明细" value={cleanupStatsSummary(entry.stats)} tone="white" />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </Panel>

          <Panel tone={canMutate ? "paper" : "white"}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">沉淀经验</p>
                <h2 className="mt-2 font-display text-3xl font-bold">把有价值的内容做成可复用规则</h2>
              </div>
              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                {center.pendingCount} 待处理 / {center.approvedCount} 已通过
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
              把有价值的内容整理成技能或规则。
            </p>

            <div className="mt-5 grid gap-4 xl:grid-cols-[0.9fr_minmax(0,1.1fr)]">
              <form onSubmit={handleCreatePromotion} className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">新建申请</p>
                  <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
                    {selectedArtifact ? selectedArtifact.path : "未选择"}
                  </span>
                </div>

                <StatusRow
                  label="当前内容"
                  value={selectedArtifact ? `${selectedArtifact.path} @ v${selectedArtifact.version ?? 0}` : "请先在左侧选择内容"}
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
                        {kind === "skill" ? "把稳定做法沉淀成技能。" : "把需要长期遵守的要求沉淀成规则。"}
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
                    placeholder="说明为什么值得长期复用。"
                  />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    data-testid="memory-promotion-submit"
                    type="submit"
                    disabled={!canMutate || busyAction !== null || !selectedArtifact}
                    className="rounded-[10px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] disabled:opacity-60"
                  >
                    {busyAction === "create-promotion" ? "提交中..." : "提交审核"}
                  </button>
                  <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                    提交后会进入审核，通过后才能加入可复用资料。
                  </p>
                </div>
              </form>

              <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">待审核</p>
                    <h3 className="mt-2 font-display text-2xl font-bold">审核列表</h3>
                  </div>
                  <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
                    {center.promotions.length} 条
                  </span>
                </div>

                <div className="mt-4 space-y-3">
                  {center.promotions.length === 0 ? (
                    <EmptyState title="暂无审核项" message="先从左侧内容发起一条技能或规则申请。" testID="memory-promotion-empty" />
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

                          <p className="mt-3 text-sm leading-6">{promotion.rationale || "暂无补充说明。"}</p>
                          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.62)]">
                            提交人：{promotion.proposedBy} / {formatTimestamp(promotion.proposedAt)}
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
                                {busyAction === `review-${promotion.id}-approved` ? "处理中..." : "通过"}
                              </button>
                              <button
                                type="button"
                                data-testid={`memory-promotion-${slug}-reject`}
                                disabled={!canMutate || reviewBusy}
                                onClick={() => void handleReviewPromotion(promotion, "rejected")}
                                className="rounded-[10px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] disabled:opacity-60"
                              >
                                {busyAction === `review-${promotion.id}-rejected` ? "处理中..." : "拒绝"}
                              </button>
                            </div>
                          ) : (
                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                              <StatusRow label="审核人" value={valueOrFallback(promotion.reviewedBy, "未记录")} tone={promotionTone(promotion.status)} />
                              <StatusRow label="审核时间" value={formatTimestamp(promotion.reviewedAt)} tone="white" />
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
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">历史版本</p>
                <h2 className="mt-2 font-display text-3xl font-bold">版本轨迹</h2>
              </div>
              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                {versions.length} 条
              </span>
            </div>

            <div className="mt-5 space-y-3">
              {versions.length === 0 ? (
	                <EmptyState title="暂无历史版本" message="同步后会显示版本变化。" />
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
                      <ArtifactFact label="摘要" value={valueOrFallback(version.digest?.slice(0, 16), "未记录")} />
                      <ArtifactFact label="大小" value={formatBytes(version.sizeBytes)} />
                      <ArtifactFact label="说明" value={version.summary} />
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
