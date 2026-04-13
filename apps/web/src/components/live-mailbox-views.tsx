"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { OpenShockShell } from "@/components/open-shock-shell";
import { DetailRail, Panel } from "@/components/phase-zero-views";
import { usePhaseZeroState } from "@/lib/live-phase0";
import type { AgentHandoff, WorkspaceGovernanceSuggestedHandoff } from "@/lib/phase-zero-types";
import { hasSessionPermission, permissionBoundaryCopy, permissionStatus, permissionStatusSurfaceLabel } from "@/lib/session-authz";

type MailboxAdvanceAction = "acknowledged" | "blocked" | "comment" | "completed";
type MailboxBatchBusyAction = MailboxAdvanceAction | "completed:continue";
type MailboxCommentActorMode = "from" | "to";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function handoffStatusLabel(status: AgentHandoff["status"]) {
  switch (status) {
    case "acknowledged":
      return "处理中";
    case "blocked":
      return "阻塞";
    case "completed":
      return "已完成";
    default:
      return "待接手";
  }
}

function handoffStatusTone(status: AgentHandoff["status"]) {
  switch (status) {
    case "acknowledged":
      return "bg-[var(--shock-lime)]";
    case "blocked":
      return "bg-[var(--shock-pink)] text-white";
    case "completed":
      return "bg-[var(--shock-ink)] text-white";
    default:
      return "bg-[var(--shock-yellow)]";
  }
}

function availableHandoffActions(status: AgentHandoff["status"]): MailboxAdvanceAction[] {
  switch (status) {
    case "requested":
      return ["acknowledged", "blocked", "comment"];
    case "acknowledged":
      return ["blocked", "comment", "completed"];
    case "blocked":
      return ["acknowledged", "comment"];
    default:
      return ["comment"];
  }
}

function batchSelectableHandoff(handoff: AgentHandoff) {
  return handoff.status !== "completed";
}

function commonBatchActions(handoffs: AgentHandoff[]) {
  if (handoffs.length === 0) {
    return [] as MailboxAdvanceAction[];
  }
  return availableHandoffActions(handoffs[0].status).filter((action) =>
    handoffs.every((handoff) => availableHandoffActions(handoff.status).includes(action))
  );
}

function batchGovernedPolicyStatus(selection: {
  selectedCount: number;
  governedCount: number;
  canContinueGovernedRoute: boolean;
}) {
  if (selection.selectedCount === 0) {
    return "pending";
  }
  if (selection.canContinueGovernedRoute) {
    return "ready";
  }
  if (selection.governedCount > 0) {
    return "watch";
  }
  return "draft";
}

function batchGovernedPolicySummary(input: {
  selectedCount: number;
  governedCount: number;
  canContinueGovernedRoute: boolean;
  governedSuggestion: WorkspaceGovernanceSuggestedHandoff;
  roomId: string;
}) {
  if (input.selectedCount === 0) {
    return "先选中当前讨论中的自动交接，再批量继续下一步。";
  }
  if (input.governedCount !== input.selectedCount) {
    return "当前选择里包含其他类型的交接，自动续下一步只会对纯自动交接生效。";
  }
  if (!input.canContinueGovernedRoute) {
    return "当前选择还不能批量完成，请先把状态推进到可完成。";
  }
  if (input.governedSuggestion.roomId !== input.roomId) {
    return "当前讨论还没有现成的下一步建议，批量完成后系统会重新计算。";
  }
  switch (input.governedSuggestion.status) {
    case "active":
      return "当前下一步已经有人在处理。批量完成后系统会重新评估，避免重复创建。";
    case "blocked":
      return input.governedSuggestion.reason || "当前下一步仍被阻塞。批量完成后会重新计算，但不会绕过阻塞。";
    case "done":
      return "当前流程已到最后阶段。批量完成后会继续处理剩余收尾动作。";
    case "ready":
      return input.governedSuggestion.reason || "系统已经给出下一步建议，批量完成后会自动接上。";
    default:
      return "批量完成后系统会重新判断下一步，只在条件满足时自动接上。";
  }
}

function mailboxKindLabel(kind?: AgentHandoff["kind"]) {
  switch (kind) {
    case "room-auto":
      return "房间接棒";
    case "governed":
      return "自动交接";
    case "delivery-closeout":
      return "交付收尾";
    case "delivery-reply":
      return "收尾回复";
    default:
      return "手动交接";
  }
}

function mailboxReplyStatusLabel(status: AgentHandoff["status"]) {
  switch (status) {
    case "acknowledged":
      return "处理中";
    case "blocked":
      return "回复受阻";
    case "completed":
      return "回复完成";
    default:
      return "等待回复";
  }
}

function mailboxReplyStatusTone(status: AgentHandoff["status"]) {
  switch (status) {
    case "acknowledged":
      return "bg-[var(--shock-lime)]";
    case "blocked":
      return "bg-[var(--shock-pink)] text-white";
    case "completed":
      return "bg-[var(--shock-yellow)]";
    default:
      return "bg-white";
  }
}

function mailboxParentStatusLabel(status: AgentHandoff["status"]) {
  return `主交接 ${handoffStatusLabel(status)}`;
}

function findMailboxParent(mailbox: AgentHandoff[], handoff: AgentHandoff) {
  if (!handoff.parentHandoffId) {
    return null;
  }
  return mailbox.find((item) => item.id === handoff.parentHandoffId) ?? null;
}

function findLatestMailboxReply(mailbox: AgentHandoff[], parentHandoffId: string) {
  return (
    mailbox.find((item) => item.kind === "delivery-reply" && item.parentHandoffId === parentHandoffId) ?? null
  );
}

function countMailboxReplies(mailbox: AgentHandoff[], parentHandoffId: string) {
  return mailbox.filter((item) => item.kind === "delivery-reply" && item.parentHandoffId === parentHandoffId).length;
}

function formatActionLabel(action: "acknowledged" | "blocked" | "comment" | "completed") {
  switch (action) {
    case "acknowledged":
      return "接手";
    case "blocked":
      return "标记阻塞";
    case "comment":
      return "留言";
    default:
      return "完成";
  }
}

function mailboxMessageKindLabel(kind: AgentHandoff["messages"][number]["kind"]) {
  switch (kind) {
    case "request":
      return "请求";
    case "ack":
      return "已接手";
    case "blocked":
      return "阻塞";
    case "comment":
      return "留言";
    case "parent-progress":
      return "主任务进度";
    case "response-progress":
      return "回复进度";
    default:
      return "完成";
  }
}

function governanceStatusLabel(status: string) {
  switch (status) {
    case "active":
      return "进行中";
    case "ready":
      return "就绪";
    case "required":
      return "需要处理";
    case "blocked":
      return "阻塞";
    case "done":
      return "完成";
    case "draft":
      return "草稿";
    case "watch":
      return "关注";
    default:
      return "等待中";
  }
}

function governanceTone(status: string): "lime" | "yellow" | "pink" | "paper" | "white" {
  switch (status) {
    case "done":
    case "ready":
      return "lime";
    case "active":
    case "required":
    case "draft":
    case "watch":
      return "yellow";
    case "blocked":
      return "pink";
    default:
      return "paper";
  }
}

function escalationQueueAgeLabel(entry: {
  elapsedMinutes: number;
  thresholdMinutes: number;
  timeLabel?: string;
}) {
  if (entry.elapsedMinutes > 0) {
    return `${entry.elapsedMinutes} / ${entry.thresholdMinutes} 分钟`;
  }
  if (entry.timeLabel?.trim()) {
    return entry.timeLabel;
  }
  return `${entry.thresholdMinutes} 分钟时限`;
}

function escalationRoomRollupSummary(entry: {
  escalationCount: number;
  blockedCount: number;
}) {
  const activeCount = Math.max(0, entry.escalationCount - entry.blockedCount);
  if (entry.blockedCount > 0 && activeCount > 0) {
    return `${entry.escalationCount} 项 · ${entry.blockedCount} 项阻塞 · ${activeCount} 项处理中`;
  }
  if (entry.blockedCount > 0) {
    return `${entry.escalationCount} 项 · ${entry.blockedCount} 项阻塞`;
  }
  return `${entry.escalationCount} 项 · 全部处理中`;
}

function governedCloseoutLabel(href: string) {
  return href.startsWith("/pull-requests/") ? "打开交付详情" : "查看收尾结果";
}

function GovernanceMetric({
  label,
  value,
  detail,
  testId,
}: {
  label: string;
  value: string;
  detail: string;
  testId?: string;
}) {
  return (
    <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.58)]">{label}</p>
      <p data-testid={testId} className="mt-2 font-display text-[26px] font-bold leading-7">
        {value}
      </p>
      <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{detail}</p>
    </div>
  );
}

export function LiveMailboxPageContent() {
  const searchParams = useSearchParams();
  const {
    state,
    loading,
    error,
    createHandoff,
    createGovernedHandoffForRoom,
    updateHandoff,
  } = usePhaseZeroState();
  const [roomId, setRoomId] = useState("");
  const [fromAgentId, setFromAgentId] = useState("");
  const [toAgentId, setToAgentId] = useState("");
  const [title, setTitle] = useState("把当前讨论交给下一位智能体");
  const [summary, setSummary] = useState("当前背景、执行进度和待办已整理好，接手后可以直接继续。");
  const [busyKey, setBusyKey] = useState("");
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [commentActors, setCommentActors] = useState<Record<string, string>>({});
  const [lastAppliedGovernedRouteKey, setLastAppliedGovernedRouteKey] = useState("");
  const [selectedMailboxIds, setSelectedMailboxIds] = useState<string[]>([]);
  const [mailboxBatchNote, setMailboxBatchNote] = useState("");
  const [mailboxBatchCommentActorMode, setMailboxBatchCommentActorMode] =
    useState<MailboxCommentActorMode>("from");
  const [mailboxBatchBusyAction, setMailboxBatchBusyAction] = useState<MailboxBatchBusyAction | null>(null);
  const highlightedHandoffId = searchParams.get("handoffId");
  const requestedRoomId = searchParams.get("roomId");
  const orderedMailbox = highlightedHandoffId
    ? [...state.mailbox].sort((left, right) => {
        if (left.id === highlightedHandoffId) return -1;
        if (right.id === highlightedHandoffId) return 1;
        return right.updatedAt.localeCompare(left.updatedAt);
      })
    : state.mailbox;
  const mailboxForRoom = requestedRoomId
    ? orderedMailbox.filter((handoff) => handoff.roomId === requestedRoomId)
    : orderedMailbox;
  const authSession = state.auth.session;
  const canMutate = hasSessionPermission(authSession, "run.execute");
  const mutationStatus = loading ? "syncing" : error ? "sync_failed" : permissionStatus(authSession, "run.execute");
  const mutationBoundary = permissionBoundaryCopy(authSession, "run.execute");
  const mailboxMutationBusy = busyKey !== "" || mailboxBatchBusyAction !== null;
  const openCount = loading || error ? 0 : state.mailbox.filter((item) => item.status !== "completed").length;
  const blockedCount = loading || error ? 0 : state.mailbox.filter((item) => item.status === "blocked").length;
  const completedCount = loading || error ? 0 : state.mailbox.filter((item) => item.status === "completed").length;
  const selectableMailboxHandoffs = mailboxForRoom.filter(batchSelectableHandoff);
  const selectableMailboxIds = selectableMailboxHandoffs.map((handoff) => handoff.id);
  const selectedMailboxHandoffs = mailboxForRoom.filter((handoff) => selectedMailboxIds.includes(handoff.id));
  const selectedGovernedMailboxHandoffs = selectedMailboxHandoffs.filter((handoff) => handoff.kind === "governed");
  const batchActions = commonBatchActions(selectedMailboxHandoffs);
  const governance = state.workspace.governance;
  const escalationQueue = governance.escalationSla.queue ?? [];
  const escalationRollup = governance.escalationSla.rollup ?? [];
  const governedSuggestion = governance.routingPolicy.suggestedHandoff;
  const batchCanContinueGovernedRoute =
    selectedMailboxHandoffs.length > 0 &&
    selectedGovernedMailboxHandoffs.length === selectedMailboxHandoffs.length &&
    batchActions.includes("completed");
  const batchGovernedStatus = batchGovernedPolicyStatus({
    selectedCount: selectedMailboxHandoffs.length,
    governedCount: selectedGovernedMailboxHandoffs.length,
    canContinueGovernedRoute: batchCanContinueGovernedRoute,
  });
  const batchGovernedSummary = batchGovernedPolicySummary({
    selectedCount: selectedMailboxHandoffs.length,
    governedCount: selectedGovernedMailboxHandoffs.length,
    canContinueGovernedRoute: batchCanContinueGovernedRoute,
    governedSuggestion,
    roomId,
  });
  const governedRouteKey = [
    governedSuggestion.status,
    governedSuggestion.roomId,
    governedSuggestion.fromAgentId,
    governedSuggestion.toAgentId,
    governedSuggestion.handoffId,
    governedSuggestion.draftTitle,
  ].join(":");

  useEffect(() => {
    if (loading || error || state.rooms.length === 0) {
      return;
    }
    const nextRoomId =
      requestedRoomId && state.rooms.some((room) => room.id === requestedRoomId)
        ? requestedRoomId
        : state.rooms[0]?.id;
    if (!roomId && nextRoomId) {
      setRoomId(nextRoomId);
    }
  }, [loading, error, requestedRoomId, roomId, state.rooms]);

  useEffect(() => {
    if (loading || error || state.rooms.length === 0 || state.agents.length === 0 || !roomId) {
      return;
    }
    const selectedRoom = state.rooms.find((room) => room.id === roomId) ?? state.rooms[0];
    const ownerAgent =
      state.agents.find((agent) => agent.name === selectedRoom.topic.owner) ?? state.agents[0];
    const fallbackTarget =
      state.agents.find((agent) => agent.id !== ownerAgent.id) ?? ownerAgent;

    if (!fromAgentId || !state.agents.some((agent) => agent.id === fromAgentId)) {
      setFromAgentId(ownerAgent.id);
    }

    if (
      !toAgentId ||
      !state.agents.some((agent) => agent.id === toAgentId) ||
      toAgentId === ownerAgent.id
    ) {
      setToAgentId(fallbackTarget.id);
    }
  }, [loading, error, roomId, fromAgentId, toAgentId, state.rooms, state.agents]);

  function applyGovernedRouteSuggestion() {
    if (governedSuggestion.roomId !== roomId || governedSuggestion.status !== "ready") {
      return;
    }
    if (governedSuggestion.fromAgentId) {
      setFromAgentId(governedSuggestion.fromAgentId);
    }
    if (governedSuggestion.toAgentId) {
      setToAgentId(governedSuggestion.toAgentId);
    }
    if (governedSuggestion.draftTitle) {
      setTitle(governedSuggestion.draftTitle);
    }
    if (governedSuggestion.draftSummary) {
      setSummary(governedSuggestion.draftSummary);
    }
    setLastAppliedGovernedRouteKey(governedRouteKey);
  }

  useEffect(() => {
    if (loading || error || governedSuggestion.status !== "ready" || governedSuggestion.roomId !== roomId) {
      return;
    }
    if (!governedSuggestion.fromAgentId || !governedSuggestion.toAgentId) {
      return;
    }
    if (lastAppliedGovernedRouteKey === governedRouteKey) {
      return;
    }
    setFromAgentId(governedSuggestion.fromAgentId);
    setToAgentId(governedSuggestion.toAgentId);
    if (governedSuggestion.draftTitle) {
      setTitle(governedSuggestion.draftTitle);
    }
    if (governedSuggestion.draftSummary) {
      setSummary(governedSuggestion.draftSummary);
    }
    setLastAppliedGovernedRouteKey(governedRouteKey);
  }, [
    error,
    governedRouteKey,
    governedSuggestion.draftSummary,
    governedSuggestion.draftTitle,
    governedSuggestion.fromAgentId,
    governedSuggestion.roomId,
    governedSuggestion.status,
    governedSuggestion.toAgentId,
    lastAppliedGovernedRouteKey,
    loading,
    roomId,
  ]);

  useEffect(() => {
    if (loading || error) {
      return;
    }
    setSelectedMailboxIds((current) => {
      const next = current.filter((handoffId) => selectableMailboxIds.includes(handoffId));
      if (next.length === current.length && next.every((handoffId, index) => handoffId === current[index])) {
        return current;
      }
      return next;
    });
  }, [error, loading, selectableMailboxIds]);

  function governedCreateInput() {
    if (governedSuggestion.roomId !== roomId || governedSuggestion.status !== "ready") {
      return null;
    }
    if (!governedSuggestion.fromAgentId || !governedSuggestion.toAgentId || !governedSuggestion.draftTitle?.trim()) {
      return null;
    }
    return {
      roomId: governedSuggestion.roomId,
      fromAgentId: governedSuggestion.fromAgentId,
      toAgentId: governedSuggestion.toAgentId,
      title: governedSuggestion.draftTitle.trim(),
      summary: governedSuggestion.draftSummary?.trim() ?? "",
      kind: "governed" as const,
    };
  }

  async function submitCreate(
    input: {
      roomId: string;
      fromAgentId: string;
      toAgentId: string;
      title: string;
      summary: string;
      kind?: "governed";
    },
    busyLabel: string
  ) {
    if (mailboxMutationBusy || !canMutate) {
      return;
    }
    setBusyKey(busyLabel);
    setActionError(null);
    try {
      await createHandoff(input);
    } catch (mutationError) {
      setActionError({
        id: "create",
        message: mutationError instanceof Error ? mutationError.message : "创建交接任务失败",
      });
    } finally {
      setBusyKey("");
    }
  }

  async function handleCreate() {
    await submitCreate(
      {
        roomId,
        fromAgentId,
        toAgentId,
        title: title.trim(),
        summary: summary.trim(),
      },
      "create"
    );
  }

  async function handleCreateGovernedRoute() {
    const input = governedCreateInput();
    if (!input) {
      return;
    }
    applyGovernedRouteSuggestion();
    await submitCreate(input, "governed-create");
  }

  async function handleCreateGovernedRouteForRoom(targetRoomId: string) {
    if (mailboxMutationBusy || !canMutate) {
      return;
    }
    const actionKey = `governed-rollup:${targetRoomId}`;
    setBusyKey(actionKey);
    setActionError(null);
    try {
      await createGovernedHandoffForRoom({ roomId: targetRoomId });
    } catch (mutationError) {
      setActionError({
        id: actionKey,
        message: mutationError instanceof Error ? mutationError.message : "自动交接创建失败",
      });
    } finally {
      setBusyKey("");
    }
  }

  async function handleAdvance(
    handoff: AgentHandoff,
    action: MailboxAdvanceAction,
    options?: { continueGovernedRoute?: boolean }
  ) {
    if (mailboxMutationBusy || !canMutate) {
      return;
    }
    const actionKey = options?.continueGovernedRoute ? `${handoff.id}:${action}:continue` : `${handoff.id}:${action}`;
    setBusyKey(actionKey);
    setActionError(null);
    const note = notes[handoff.id]?.trim() || undefined;
    const commentActorId =
      commentActors[handoff.id] === handoff.toAgentId ? handoff.toAgentId : handoff.fromAgentId;
    try {
      await updateHandoff(handoff.id, {
        action,
        actingAgentId: action === "comment" ? commentActorId : handoff.toAgentId,
        note,
        continueGovernedRoute: options?.continueGovernedRoute,
      });
      if (action === "comment" && note) {
        setNotes((current) => ({ ...current, [handoff.id]: "" }));
      }
    } catch (mutationError) {
      setActionError({
        id: handoff.id,
        message: mutationError instanceof Error ? mutationError.message : "交接更新失败",
      });
    } finally {
      setBusyKey("");
    }
  }

  function toggleMailboxSelection(handoffId: string, selected: boolean) {
    setSelectedMailboxIds((current) => {
      if (selected) {
        return current.includes(handoffId) ? current : [...current, handoffId];
      }
      return current.filter((item) => item !== handoffId);
    });
  }

  async function handleBatchMailboxAction(
    action: MailboxAdvanceAction,
    options?: { continueGovernedRoute?: boolean }
  ) {
    if (!canMutate || mailboxMutationBusy || selectedMailboxHandoffs.length === 0 || !batchActions.includes(action)) {
      return;
    }
    const note = mailboxBatchNote.trim();
    if ((action === "blocked" || action === "comment") && !note) {
      return;
    }

    setActionError(null);
    const continueGovernedRoute = action === "completed" && options?.continueGovernedRoute === true;
    setMailboxBatchBusyAction(continueGovernedRoute ? "completed:continue" : action);
    try {
      for (const handoff of [...selectedMailboxHandoffs]) {
        await updateHandoff(handoff.id, {
          action,
          actingAgentId:
            action === "comment"
              ? mailboxBatchCommentActorMode === "to"
                ? handoff.toAgentId
                : handoff.fromAgentId
              : handoff.toAgentId,
          note: action === "acknowledged" ? undefined : note || undefined,
          continueGovernedRoute: continueGovernedRoute && handoff.kind === "governed",
        });
      }
      setMailboxBatchNote("");
    } catch (mutationError) {
      setActionError({
        id: "batch",
        message: mutationError instanceof Error ? mutationError.message : "批量处理失败",
      });
    } finally {
      setMailboxBatchBusyAction(null);
    }
  }

  return (
    <OpenShockShell
      view="mailbox"
      eyebrow="交接"
      title="所有交接"
      description="这里查看和处理需要继续交接的事项。"
      contextTitle="交接概览"
      contextDescription="可以在这里看到交接状态、阻塞情况和完成进度。"
      contextBody={
        <DetailRail
          label="交接统计"
          items={[
            { label: "进行中", value: `${openCount}` },
            { label: "阻塞", value: `${blockedCount}` },
            { label: "已完成", value: `${completedCount}` },
            { label: "状态", value: permissionStatusSurfaceLabel(mutationStatus) },
          ]}
        />
      }
    >
      {loading ? (
        <Panel tone="paper">
          <p className="font-display text-2xl font-bold">正在载入交接</p>
          <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">正在获取当前交接记录。</p>
        </Panel>
      ) : error ? (
        <Panel tone="pink">
          <p className="font-display text-2xl font-bold">交接载入失败</p>
          <p className="mt-3 text-sm leading-6 text-white/80">{error}</p>
        </Panel>
      ) : (
        <div className="space-y-4">
          <Panel tone="lime">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                  智能体协作
                </p>
                <h3 className="mt-2 font-display text-3xl font-bold">当前协作流程总览</h3>
                <p
                  data-testid="mailbox-governance-summary"
                  className="mt-3 max-w-3xl text-sm leading-6 text-[color:rgba(24,20,14,0.74)]"
                >
                  {governance.summary}
                </p>
              </div>
              <span
                data-testid="mailbox-governance-template"
                className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]"
              >
                {governance.label}
              </span>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <GovernanceMetric
                label="待处理交接"
                value={`${governance.stats.openHandoffs}`}
                detail="这里显示还没处理完的交接。"
                testId="mailbox-governance-open-handoffs"
              />
              <GovernanceMetric
                label="阻塞事项"
                value={`${governance.stats.blockedEscalations}`}
                detail="需要人工处理的阻塞会集中显示在这里。"
                testId="mailbox-governance-blocked-escalations"
              />
              <GovernanceMetric
                label="评审关卡"
                value={`${governance.stats.reviewGates}`}
                detail="评审相关状态会同步到交接、PR 和收件箱。"
                testId="mailbox-governance-review-gates"
              />
              <GovernanceMetric
                label="人工确认"
                value={`${governance.stats.humanOverrideGates}`}
                detail="需要你拍板的步骤会一直保持可见。"
                testId="mailbox-governance-human-override-gates"
              />
            </div>
          </Panel>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_0.85fr]">
            <Panel tone="white">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                    协作分工
                  </p>
                  <h3 className="mt-2 font-display text-2xl font-bold">当前团队分工</h3>
                </div>
                <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                  {governance.teamTopology.length} 条分工
                </span>
              </div>
              <div className="mt-4 space-y-3">
                {governance.teamTopology.map((lane) => (
                  <Panel key={lane.id} tone={governanceTone(lane.status)} className="!p-3.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">
                          {lane.role}
                        </p>
                        <h4
                          data-testid={`mailbox-governance-lane-${lane.id}`}
                          className="mt-2 font-display text-[24px] font-bold leading-7"
                        >
                          {lane.label}
                        </h4>
                      </div>
                      <span
                        data-testid={`mailbox-governance-lane-status-${lane.id}`}
                        className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]"
                      >
                        {governanceStatusLabel(lane.status)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6">{lane.summary}</p>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2">
                        <p className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">默认智能体</p>
                        <p className="mt-1.5 text-sm leading-6">{lane.defaultAgent || "按团队自定义"}</p>
                      </div>
                      <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2">
                        <p className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">分工</p>
                        <p className="mt-1.5 text-sm leading-6">{lane.lane || "当前分工信息整理中。"}</p>
                      </div>
                    </div>
                  </Panel>
                ))}
              </div>
            </Panel>

            <div className="space-y-4">
              <Panel tone={governanceTone(governance.humanOverride.status)}>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                  人工确认
                </p>
                <p
                  data-testid="mailbox-governance-human-override"
                  className="mt-2 font-display text-2xl font-bold"
                >
                  {governanceStatusLabel(governance.humanOverride.status)}
                </p>
                <p className="mt-3 text-sm leading-6">{governance.humanOverride.summary}</p>
                {governance.humanOverride.href ? (
                  <Link
                    href={governance.humanOverride.href}
                    className="mt-4 inline-flex rounded-[12px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                  >
                    打开处理入口
                  </Link>
                ) : null}
              </Panel>

              <Panel tone={governanceTone(governance.responseAggregation.status)}>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                  最终回复
                </p>
                <p
                  data-testid="mailbox-governance-response-aggregation"
                  className="mt-2 font-display text-2xl font-bold"
                >
                  {governance.responseAggregation.finalResponse || "等待收尾"}
                </p>
                <p className="mt-3 text-sm leading-6">{governance.responseAggregation.summary}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(governance.responseAggregation.sources ?? []).map((source, index) => (
                    <span
                      key={`${source}-${index}`}
                      className="rounded-full border border-[var(--shock-ink)] bg-white px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em]"
                    >
                      {source}
                    </span>
                  ))}
                </div>
              </Panel>

              <Panel tone={governanceTone(governance.escalationSla.status)}>
                <div
                  data-testid="mailbox-governance-escalation-queue"
                  className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                        升级队列
                      </p>
                      <p className="mt-2 font-display text-2xl font-bold">当前治理升级队列</p>
                      <p className="mt-3 text-sm leading-6">{governance.escalationSla.summary}</p>
                    </div>
                    <span
                      data-testid="mailbox-governance-escalation-count"
                      className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]"
                    >
                      {escalationQueue.length} 项
                    </span>
                  </div>
                  <div className="mt-4 space-y-3">
                    {escalationQueue.length === 0 ? (
                      <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                        当前没有需要升级处理的事项。新的阻塞或超时交接会显示在这里。
                      </p>
                    ) : (
                      escalationQueue.map((entry) => (
                        <div
                          key={entry.id}
                          data-testid={`mailbox-governance-escalation-entry-${entry.id}`}
                          className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-display text-lg font-semibold">{entry.label}</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <span className="rounded-full border border-[var(--shock-ink)] bg-white px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]">
                                  {entry.source}
                                </span>
                                {entry.owner ? (
                                  <span className="rounded-full border border-[var(--shock-ink)] bg-white px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]">
                                    {entry.owner}
                                  </span>
                                ) : null}
                                <span className="rounded-full border border-[var(--shock-ink)] bg-white px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]">
                                  {escalationQueueAgeLabel(entry)}
                                </span>
                              </div>
                            </div>
                            <span
                              data-testid={`mailbox-governance-escalation-status-${entry.id}`}
                              className={cn(
                                "rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]",
                                governanceTone(entry.status) === "pink"
                                  ? "bg-[var(--shock-pink)] text-white"
                                  : governanceTone(entry.status) === "lime"
                                    ? "bg-[var(--shock-lime)]"
                                    : governanceTone(entry.status) === "yellow"
                                      ? "bg-[var(--shock-yellow)]"
                                      : "bg-white"
                              )}
                            >
                              {governanceStatusLabel(entry.status)}
                            </span>
                          </div>
                          <p className="mt-3 text-sm leading-6">{entry.summary}</p>
                          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{entry.nextStep}</p>
                          {entry.href ? (
                            <Link
                              href={entry.href}
                              className="mt-3 inline-flex rounded-[12px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                            >
                              打开详情
                            </Link>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </Panel>

              <Panel tone={escalationRollup.some((entry) => entry.status === "blocked") ? "pink" : "paper"}>
                <div
                  data-testid="mailbox-governance-escalation-rollup"
                  className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                        cross-room escalation rollup
                      </p>
                      <p className="mt-2 font-display text-2xl font-bold">哪些讨论间还在冒烟</p>
                      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                        当前 queue 只显示治理焦点；这里把整个 workspace 里仍有 escalation 的 room 摆平，避免只盯一个 room 时漏看其他冒烟点。
                      </p>
                    </div>
                    <span
                      data-testid="mailbox-governance-escalation-rollup-count"
                      className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]"
                    >
                      {escalationRollup.length} rooms
                    </span>
                  </div>
                  <div className="mt-4 space-y-3">
                    {escalationRollup.length === 0 ? (
                      <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                        当前没有跨 room escalation；新的 hot room 会直接出现在这里。
                      </p>
                    ) : (
                      escalationRollup.map((entry) => (
                        <div
                          key={entry.roomId}
                          data-testid={`mailbox-governance-escalation-rollup-room-${entry.roomId}`}
                          className={cn(
                            "rounded-[18px] border-2 border-[var(--shock-ink)] px-4 py-3",
                            entry.roomId === roomId ? "bg-white" : "bg-[#fffaf0]"
                          )}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-display text-lg font-semibold">{entry.roomTitle}</p>
                                {entry.roomId === roomId ? (
                                  <span className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]">
                                    current room
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.6)]">
                                {escalationRoomRollupSummary(entry)}
                                {entry.latestSource ? ` · 最近来源 ${entry.latestSource}` : ""}
                              </p>
                              {(entry.currentOwner || entry.currentLane) ? (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {entry.currentOwner ? (
                                    <span className="rounded-full border border-[var(--shock-ink)] bg-white px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]">
                                      当前负责人 {entry.currentOwner}
                                    </span>
                                  ) : null}
                                  {entry.currentLane ? (
                                    <span className="rounded-full border border-[var(--shock-ink)] bg-white px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]">
                                      当前分工 {entry.currentLane}
                                    </span>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                            <span
                              data-testid={`mailbox-governance-escalation-rollup-status-${entry.roomId}`}
                              className={cn(
                                "rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]",
                                governanceTone(entry.status) === "pink"
                                  ? "bg-[var(--shock-pink)] text-white"
                                  : governanceTone(entry.status) === "lime"
                                    ? "bg-[var(--shock-lime)]"
                                    : governanceTone(entry.status) === "yellow"
                                      ? "bg-[var(--shock-yellow)]"
                                      : "bg-white"
                              )}
                            >
                              {governanceStatusLabel(entry.status)}
                            </span>
                          </div>
                          {entry.latestLabel ? <p className="mt-3 font-display text-base font-semibold">{entry.latestLabel}</p> : null}
                          {entry.latestSummary ? (
                            <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{entry.latestSummary}</p>
                          ) : null}
                          {(entry.nextRouteLabel || entry.nextRouteSummary) ? (
                            <div className="mt-3 rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                                    下一步建议
                                  </p>
                                  {entry.nextRouteLabel ? <p className="mt-2 font-display text-base font-semibold">{entry.nextRouteLabel}</p> : null}
                                </div>
                                <span
                                  data-testid={`mailbox-governance-escalation-rollup-route-status-${entry.roomId}`}
                                  className={cn(
                                    "rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]",
                                    governanceTone(entry.nextRouteStatus ?? "pending") === "pink"
                                      ? "bg-[var(--shock-pink)] text-white"
                                      : governanceTone(entry.nextRouteStatus ?? "pending") === "lime"
                                        ? "bg-[var(--shock-lime)]"
                                        : governanceTone(entry.nextRouteStatus ?? "pending") === "yellow"
                                          ? "bg-[var(--shock-yellow)]"
                                          : "bg-[var(--shock-paper)]"
                                  )}
                                >
                                  {governanceStatusLabel(entry.nextRouteStatus ?? "pending")}
                                </span>
                              </div>
                              {entry.nextRouteSummary ? (
                                <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{entry.nextRouteSummary}</p>
                              ) : null}
                              <div className="mt-3 flex flex-wrap gap-2">
                                {entry.nextRouteStatus === "ready" ? (
                                  <button
                                    type="button"
                                    data-testid={`mailbox-governance-escalation-rollup-route-create-${entry.roomId}`}
                                    disabled={!canMutate || mailboxMutationBusy}
                                    onClick={() => void handleCreateGovernedRouteForRoom(entry.roomId)}
                                    className="rounded-[12px] border-2 border-[var(--shock-ink)] bg-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white disabled:opacity-60"
                                  >
                                    {busyKey === `governed-rollup:${entry.roomId}` ? "创建中..." : "创建自动交接"}
                                  </button>
                                ) : null}
                                {entry.nextRouteHref ? (
                                  <Link
                                    href={entry.nextRouteHref}
                                    className="inline-flex rounded-[12px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                                  >
                                    打开下一步
                                  </Link>
                                ) : null}
                                {entry.href ? (
                                  <Link
                                    href={entry.href}
                                    className="inline-flex rounded-[12px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                                  >
                                    查看该讨论
                                  </Link>
                                ) : null}
                              </div>
                              {actionError?.id === `governed-rollup:${entry.roomId}` ? (
                                <p className="mt-3 text-sm leading-6 text-[var(--shock-pink)]">{actionError.message}</p>
                              ) : null}
                            </div>
                          ) : entry.href ? (
                            <Link
                              href={entry.href}
                              className="mt-3 inline-flex rounded-[12px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                            >
                              查看该讨论
                            </Link>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </Panel>

              <Panel tone="paper">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                  协作规则
                </p>
                <div className="mt-3 space-y-2">
                  {governance.handoffRules.map((rule) => (
                    <div
                      key={rule.id}
                      data-testid={`mailbox-governance-rule-${rule.id}`}
                      className="rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <p className="font-display text-lg font-semibold">{rule.label}</p>
                        <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em]">
                          {governanceStatusLabel(rule.status)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6">{rule.summary}</p>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          </div>

          <Panel tone="paper">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                  示例流程
                </p>
                <h3 className="mt-2 font-display text-2xl font-bold">
                  当前流程从任务到交付已经可以串起来
                </h3>
              </div>
              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                {governance.walkthrough.length} 步
              </span>
            </div>
            <div className="mt-4 grid gap-3 xl:grid-cols-5">
              {governance.walkthrough.map((step) => (
                <Panel key={step.id} tone={governanceTone(step.status)} className="!p-3.5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">{step.label}</p>
                  <p
                    data-testid={`mailbox-governance-step-${step.id}`}
                    className="mt-2 font-display text-[22px] font-bold leading-7"
                  >
                    {step.summary}
                  </p>
                  <p className="mt-2 text-sm leading-6">{step.detail}</p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em]">
                      {governanceStatusLabel(step.status)}
                    </span>
                    {step.href ? (
                      <Link href={step.href} className="font-mono text-[10px] uppercase tracking-[0.16em] underline">
                        打开
                      </Link>
                    ) : null}
                  </div>
                </Panel>
              ))}
            </div>
          </Panel>

          <Panel tone="yellow">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                  发起交接
                </p>
                <h3 className="mt-2 font-display text-3xl font-bold">从当前讨论发起交接</h3>
                <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                  发起后，讨论、收件箱和交接记录会同步更新，接手人可以直接在这里继续处理。
                </p>
                {governedSuggestion.roomId === roomId ? (
                  <div
                    data-testid="mailbox-governed-route"
                    className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                          自动交接
                        </p>
                        <p
                          data-testid="mailbox-governed-route-status"
                          className="mt-2 font-display text-2xl font-bold"
                        >
                          {governanceStatusLabel(governedSuggestion.status)}
                        </p>
                        <p
                          data-testid="mailbox-governed-route-reason"
                          className="mt-2 max-w-3xl text-sm leading-6 text-[color:rgba(24,20,14,0.74)]"
                        >
                          {governedSuggestion.reason}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {governedSuggestion.status === "ready" ? (
                          <>
                            <button
                              type="button"
                              data-testid="mailbox-governed-route-apply"
                              onClick={applyGovernedRouteSuggestion}
                              className="rounded-[12px] border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                            >
                              采用建议
                            </button>
                            <button
                              type="button"
                              data-testid="mailbox-governed-route-create"
                              onClick={() => void handleCreateGovernedRoute()}
                              disabled={!canMutate || mailboxMutationBusy}
                              className="rounded-[12px] border-2 border-[var(--shock-ink)] bg-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white disabled:opacity-60"
                            >
                              {busyKey === "governed-create" ? "创建中..." : "创建自动交接"}
                            </button>
                          </>
                        ) : null}
                        {governedSuggestion.status === "active" && governedSuggestion.href ? (
                          <Link
                            href={governedSuggestion.href}
                            data-testid="mailbox-governed-route-focus"
                            className="rounded-[12px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                          >
                            打开当前交接
                          </Link>
                        ) : null}
                        {governedSuggestion.status === "done" && governedSuggestion.href ? (
                          <Link
                            href={governedSuggestion.href}
                            data-testid="mailbox-governed-route-closeout"
                            className="rounded-[12px] border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                          >
                            {governedCloseoutLabel(governedSuggestion.href)}
                          </Link>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {governedSuggestion.fromLaneLabel ? (
                        <span className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em]">
                          {governedSuggestion.fromLaneLabel} · {governedSuggestion.fromAgent || "人工指定"}
                        </span>
                      ) : null}
                      {governedSuggestion.toLaneLabel ? (
                        <span className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em]">
                          {governedSuggestion.toLaneLabel} · {governedSuggestion.toAgent || "人工指定"}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em]">讨论</span>
                    <select
                      data-testid="mailbox-create-room"
                      value={roomId}
                      onChange={(event) => setRoomId(event.target.value)}
                      disabled={!canMutate}
                      className="w-full border-2 border-[var(--shock-ink)] bg-white px-3 py-3 text-sm"
                    >
                      {state.rooms.map((room) => (
                        <option key={room.id} value={room.id}>
                          {room.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em]">发起方</span>
                    <select
                      data-testid="mailbox-create-from-agent"
                      value={fromAgentId}
                      onChange={(event) => setFromAgentId(event.target.value)}
                      disabled={!canMutate}
                      className="w-full border-2 border-[var(--shock-ink)] bg-white px-3 py-3 text-sm"
                    >
                      {state.agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em]">接收方</span>
                    <select
                      data-testid="mailbox-create-to-agent"
                      value={toAgentId}
                      onChange={(event) => setToAgentId(event.target.value)}
                      disabled={!canMutate}
                      className="w-full border-2 border-[var(--shock-ink)] bg-white px-3 py-3 text-sm"
                    >
                      {state.agents.map((agent) => (
                        <option key={agent.id} value={agent.id} disabled={agent.id === fromAgentId}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em]">标题</span>
                    <input
                      data-testid="mailbox-create-title"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      disabled={!canMutate}
                      className="w-full border-2 border-[var(--shock-ink)] bg-white px-3 py-3 text-sm"
                    />
                  </label>
                </div>
                <label className="mt-3 block space-y-2">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em]">说明</span>
                  <textarea
                    data-testid="mailbox-create-summary"
                    value={summary}
                    onChange={(event) => setSummary(event.target.value)}
                    disabled={!canMutate}
                    className="min-h-[120px] w-full border-2 border-[var(--shock-ink)] bg-white px-3 py-3 text-sm"
                  />
                </label>
              </div>

              <div className="space-y-3">
                <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                    当前权限
                  </p>
                  <p data-testid="mailbox-mutation-status" className="mt-2 font-display text-2xl font-bold">
                    {permissionStatusSurfaceLabel(mutationStatus)}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                    {canMutate ? "当前账号可以创建和推进交接。" : mutationBoundary}
                  </p>
                </div>
                <button
                  type="button"
                  data-testid="mailbox-create-submit"
                  onClick={() => void handleCreate()}
                  disabled={!canMutate || mailboxMutationBusy}
                  className="w-full border-2 border-[var(--shock-ink)] bg-[var(--shock-ink)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-white disabled:opacity-60"
                >
                  {busyKey === "create" ? "创建中..." : "创建交接"}
                </button>
                {actionError?.id === "create" ? (
                  <p className="text-sm leading-6 text-[var(--shock-pink)]">{actionError.message}</p>
                ) : null}
              </div>
            </div>
          </Panel>

          <div className="space-y-4">
            {mailboxForRoom.length === 0 ? (
              <Panel tone="white">
                <p className="font-display text-2xl font-bold">当前还没有交接项</p>
                <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                  可以直接从上方创建第一条交接，相关状态会同步到讨论和收件箱。
                </p>
              </Panel>
            ) : (
              <>
                <Panel tone="paper">
                  <div
                    data-testid="mailbox-batch-surface"
                    className="rounded-[22px] border-2 border-[var(--shock-ink)] bg-[#fff7dd] px-5 py-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                          批量处理
                        </p>
                        <h3 className="mt-2 font-display text-2xl font-bold">批量处理当前可见交接</h3>
                        <p className="mt-3 max-w-3xl text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                          先选中多条交接，再统一执行接手、留言、阻塞或完成。
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span
                          data-testid="mailbox-batch-selected-count"
                          className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em]"
                        >
                          已选 {selectedMailboxHandoffs.length}
                        </span>
                        <button
                          type="button"
                          data-testid="mailbox-batch-select-open"
                          disabled={!canMutate || mailboxMutationBusy || selectableMailboxHandoffs.length === 0}
                          onClick={() => setSelectedMailboxIds(selectableMailboxHandoffs.map((handoff) => handoff.id))}
                          className="rounded-[12px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] disabled:opacity-60"
                        >
                          全选可处理项
                        </button>
                        <button
                          type="button"
                          data-testid="mailbox-batch-clear"
                          disabled={mailboxMutationBusy || selectedMailboxIds.length === 0}
                          onClick={() => setSelectedMailboxIds([])}
                          className="rounded-[12px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] disabled:opacity-60"
                        >
                          清空
                        </button>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_240px]">
                      <div className="space-y-3">
                        <textarea
                          data-testid="mailbox-batch-note"
                          value={mailboxBatchNote}
                          disabled={!canMutate}
                          onChange={(event) => setMailboxBatchNote(event.target.value)}
                          className="min-h-[108px] w-full rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3 text-sm disabled:opacity-60"
                          placeholder="批量阻塞或留言时，会把这段说明写入所有选中的交接。"
                        />
                        <label className="block space-y-2">
                          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                            留言身份
                          </span>
                          <select
                            data-testid="mailbox-batch-comment-actor-mode"
                            value={mailboxBatchCommentActorMode}
                            disabled={!canMutate}
                            onChange={(event) =>
                              setMailboxBatchCommentActorMode(event.target.value as MailboxCommentActorMode)
                            }
                            className="w-full rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3 text-sm disabled:opacity-60"
                          >
                            <option value="from">发起方</option>
                            <option value="to">接收方</option>
                          </select>
                        </label>
                        <div
                          data-testid="mailbox-batch-policy"
                          className={cn(
                            "rounded-[18px] border-2 border-[var(--shock-ink)] px-4 py-4",
                            governanceTone(batchGovernedStatus) === "pink"
                              ? "bg-[var(--shock-pink)] text-white"
                              : governanceTone(batchGovernedStatus) === "lime"
                                ? "bg-[var(--shock-lime)]"
                                : governanceTone(batchGovernedStatus) === "yellow"
                                  ? "bg-[var(--shock-yellow)]"
                                  : "bg-white"
                          )}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">
                                自动续接
                              </p>
                              <p className="mt-2 font-display text-lg font-semibold">批量收口时顺手续下一棒</p>
                            </div>
                            <span
                              data-testid="mailbox-batch-policy-status"
                              className="rounded-full border border-[var(--shock-ink)] bg-white px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--shock-ink)]"
                            >
                              {governanceStatusLabel(batchGovernedStatus)}
                            </span>
                          </div>
                          <p data-testid="mailbox-batch-policy-summary" className="mt-3 text-sm leading-6">
                            {batchGovernedSummary}
                          </p>
                          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">
                            自动交接 {selectedGovernedMailboxHandoffs.length} / 已选 {selectedMailboxHandoffs.length}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {selectedMailboxHandoffs.map((handoff) => (
                            <span
                              key={handoff.id}
                              data-testid={`mailbox-batch-selected-${handoff.id}`}
                              className="rounded-full border border-[var(--shock-ink)] bg-white px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em]"
                            >
                              {handoff.title}
                            </span>
                          ))}
                          {selectedMailboxHandoffs.length === 0 ? (
                            <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.56)]">
                              还没有选中交接。先从下方列表勾选。
                            </span>
                          ) : null}
                        </div>
                        {!canMutate ? <p className="text-sm leading-6">{mutationBoundary}</p> : null}
                        {actionError?.id === "batch" ? (
                          <p className="text-sm leading-6 text-[var(--shock-pink)]">{actionError.message}</p>
                        ) : null}
                      </div>
                      <div className="grid gap-2">
                        {(["acknowledged", "blocked", "comment", "completed"] as const).map((action) => (
                          <button
                            key={action}
                            type="button"
                            data-testid={`mailbox-batch-action-${action}`}
                            disabled={
                              !canMutate ||
                              mailboxMutationBusy ||
                              selectedMailboxHandoffs.length === 0 ||
                              !batchActions.includes(action) ||
                              ((action === "blocked" || action === "comment") && !mailboxBatchNote.trim())
                            }
                            onClick={() => void handleBatchMailboxAction(action)}
                            className={cn(
                              "rounded-[14px] border-2 border-[var(--shock-ink)] px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.16em] disabled:opacity-60",
                              action === "blocked"
                                ? "bg-[var(--shock-pink)] text-white"
                                : action === "comment"
                                  ? "bg-white"
                                  : action === "completed"
                                    ? "bg-[var(--shock-yellow)]"
                                    : "bg-[var(--shock-lime)]"
                            )}
                          >
                            {mailboxBatchBusyAction === action ? "处理中..." : `批量${formatActionLabel(action)}`}
                          </button>
                        ))}
                        <button
                          type="button"
                          data-testid="mailbox-batch-action-completed-continue"
                          disabled={!canMutate || mailboxMutationBusy || !batchCanContinueGovernedRoute}
                          onClick={() => void handleBatchMailboxAction("completed", { continueGovernedRoute: true })}
                          className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-ink)] px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.16em] text-white disabled:opacity-60"
                        >
                          {mailboxBatchBusyAction === "completed:continue"
                            ? "处理中..."
                            : "批量完成并继续下一步"}
                        </button>
                      </div>
                    </div>
                  </div>
                </Panel>
                {mailboxForRoom.map((handoff) => {
                const room = state.rooms.find((item) => item.id === handoff.roomId);
                const fromAgentHref = `/agents/${handoff.fromAgentId}`;
                const toAgentHref = `/agents/${handoff.toAgentId}`;
                const active = highlightedHandoffId === handoff.id;
                const parentHandoff = findMailboxParent(state.mailbox, handoff);
                const responseHandoff =
                  handoff.kind === "delivery-closeout" ? findLatestMailboxReply(state.mailbox, handoff.id) : null;
                const responseAttemptCount = responseHandoff ? countMailboxReplies(state.mailbox, handoff.id) : 0;
                const canResumeParent =
                  handoff.kind === "delivery-reply" &&
                  parentHandoff &&
                  handoff.status === "completed" &&
                  parentHandoff.status === "blocked";
                const selectedForBatch = selectedMailboxIds.includes(handoff.id);
                const noteValue = notes[handoff.id] ?? "";
                const commentActorId =
                  commentActors[handoff.id] === handoff.toAgentId ? handoff.toAgentId : handoff.fromAgentId;
                const availableActions = availableHandoffActions(handoff.status);
                const canAck = availableActions.includes("acknowledged");
                const canBlock = availableActions.includes("blocked");
                const canComplete = availableActions.includes("completed");

                return (
                  <Panel
                    key={handoff.id}
                    tone={handoff.status === "blocked" ? "pink" : handoff.status === "acknowledged" ? "lime" : "white"}
                    className={cn(
                      selectedForBatch && "ring-2 ring-[var(--shock-purple)] ring-offset-2 ring-offset-[var(--shock-paper)]",
                      active && "ring-2 ring-[var(--shock-ink)] ring-offset-2 ring-offset-[var(--shock-paper)]"
                    )}
                  >
                    <article data-testid={`mailbox-card-${handoff.id}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            {batchSelectableHandoff(handoff) ? (
                              <label className="inline-flex items-center gap-2 rounded-full border-2 border-[var(--shock-ink)] bg-white px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em]">
                                <input
                                  type="checkbox"
                                  data-testid={`mailbox-select-${handoff.id}`}
                                  checked={selectedForBatch}
                                  disabled={!canMutate || mailboxMutationBusy}
                                  onChange={(event) => toggleMailboxSelection(handoff.id, event.target.checked)}
                                  className="h-3.5 w-3.5 accent-[var(--shock-purple)]"
                                />
                                批量
                              </label>
                            ) : null}
                            <p className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">
                              {handoff.issueKey} / {handoff.id}
                            </p>
                            <span
                              data-testid={`mailbox-kind-${handoff.id}`}
                              className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]"
                            >
                              {mailboxKindLabel(handoff.kind)}
                            </span>
                            {responseHandoff ? (
                              <span
                                data-testid={`mailbox-response-status-${handoff.id}`}
                                className={cn(
                                  "rounded-full border-2 border-[var(--shock-ink)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]",
                                  mailboxReplyStatusTone(responseHandoff.status)
                                )}
                              >
                                {mailboxReplyStatusLabel(responseHandoff.status)}
                              </span>
                            ) : null}
                            {responseAttemptCount > 0 ? (
                              <span
                                data-testid={`mailbox-response-attempts-${handoff.id}`}
                                className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]"
                              >
                                回复 {responseAttemptCount} 次
                              </span>
                            ) : null}
                            {selectedForBatch ? (
                              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-purple)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-white">
                                已选
                              </span>
                            ) : null}
                          </div>
                          <h3 className="mt-2 font-display text-3xl font-bold">{handoff.title}</h3>
                        </div>
                        <span
                          data-testid={`mailbox-status-${handoff.id}`}
                          className={cn(
                            "rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]",
                            handoffStatusTone(handoff.status)
                          )}
                        >
                          {handoffStatusLabel(handoff.status)}
                        </span>
                      </div>

                      <p className="mt-3 text-base leading-7">{handoff.summary}</p>
                      <p data-testid={`mailbox-last-action-${handoff.id}`} className="mt-3 text-sm leading-6 opacity-80">
                        {handoff.lastAction}
                      </p>
                      {parentHandoff ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          <span
                            data-testid={`mailbox-parent-chip-${handoff.id}`}
                            className="rounded-[12px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                          >
                            主交接 · {parentHandoff.title}
                          </span>
                          <span
                            data-testid={`mailbox-parent-status-${handoff.id}`}
                            className={cn(
                              "rounded-[12px] border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]",
                              handoffStatusTone(parentHandoff.status)
                            )}
                          >
                            {mailboxParentStatusLabel(parentHandoff.status)}
                          </span>
                        </div>
                      ) : null}

                      <div className="mt-5 grid gap-3 md:grid-cols-4">
                        <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5">
                          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.6)]">发起方</p>
                          <Link href={fromAgentHref} className="mt-1.5 block font-display text-[16px] font-semibold leading-5">
                            {handoff.fromAgent}
                          </Link>
                        </div>
                        <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5">
                          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.6)]">接收方</p>
                          <Link href={toAgentHref} className="mt-1.5 block font-display text-[16px] font-semibold leading-5">
                            {handoff.toAgent}
                          </Link>
                        </div>
                        <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5">
                          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.6)]">创建时间</p>
                          <p className="mt-1.5 font-display text-[16px] font-semibold leading-5">{handoff.requestedAt}</p>
                        </div>
                        <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5">
                          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.6)]">更新时间</p>
                          <p className="mt-1.5 font-display text-[16px] font-semibold leading-5">{handoff.updatedAt}</p>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <Link
                          href={`/rooms/${handoff.roomId}?tab=context`}
                          data-testid={`mailbox-room-link-${handoff.id}`}
                          className="rounded-[12px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                        >
                          {room?.title ?? handoff.roomId}
                        </Link>
                        <Link
                          href={`/inbox?handoffId=${handoff.id}`}
                          data-testid={`mailbox-inbox-link-${handoff.id}`}
                          className="rounded-[12px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                        >
                          打开收件箱
                        </Link>
                        {parentHandoff ? (
                          <Link
                            href={`/inbox?handoffId=${parentHandoff.id}&roomId=${parentHandoff.roomId}`}
                            data-testid={`mailbox-parent-link-${handoff.id}`}
                            className="rounded-[12px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                          >
                            打开主交接
                          </Link>
                        ) : null}
                        {responseHandoff ? (
                          <Link
                            href={`/inbox?handoffId=${responseHandoff.id}&roomId=${responseHandoff.roomId}`}
                            data-testid={`mailbox-response-link-${handoff.id}`}
                            className="rounded-[12px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                          >
                            打开回复
                          </Link>
                        ) : null}
                        {canResumeParent ? (
                          <button
                            type="button"
                            data-testid={`mailbox-action-resume-parent-${handoff.id}`}
                            disabled={!canMutate || mailboxMutationBusy}
                            onClick={() => void handleAdvance(parentHandoff, "acknowledged")}
                            className="rounded-[12px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] disabled:opacity-50"
                          >
                            {busyKey === `${parentHandoff.id}:acknowledged` ? "处理中..." : "继续主交接"}
                          </button>
                        ) : null}
                      </div>

                      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                        <div>
                          <p className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">交接记录</p>
                          <div className="mt-3 space-y-3">
                            {handoff.messages.map((message) => (
                              <div
                                key={message.id}
                                data-testid={`mailbox-message-${message.id}`}
                                className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">
                                    {mailboxMessageKindLabel(message.kind)}
                                  </span>
                                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">
                                    {message.createdAt}
                                  </span>
                                </div>
                                <p className="mt-2 font-display text-lg font-semibold">{message.authorName}</p>
                                <p className="mt-2 text-sm leading-6">{message.body}</p>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                            <p className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">处理说明</p>
                            <textarea
                              data-testid={`mailbox-note-${handoff.id}`}
                              value={noteValue}
                              onChange={(event) =>
                                setNotes((current) => ({ ...current, [handoff.id]: event.target.value }))
                              }
                              disabled={!canMutate}
                              className="mt-3 min-h-[120px] w-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3 text-sm"
                              placeholder="需要留言或标记阻塞时，请写清楚原因；完成时也可以补充说明。"
                            />
                            <label className="mt-3 block space-y-2">
                              <span className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">
                                留言身份
                              </span>
                              <select
                                data-testid={`mailbox-comment-actor-${handoff.id}`}
                                value={commentActorId}
                                disabled={!canMutate}
                                onChange={(event) =>
                                  setCommentActors((current) => ({
                                    ...current,
                                    [handoff.id]: event.target.value,
                                  }))
                                }
                                className="w-full border-2 border-[var(--shock-ink)] bg-white px-3 py-3 text-sm"
                              >
                                <option value={handoff.fromAgentId}>{handoff.fromAgent}</option>
                                <option value={handoff.toAgentId}>{handoff.toAgent}</option>
                              </select>
                            </label>
                          </div>
                          <div className="grid gap-2">
                            {([
                              ["acknowledged", canAck],
                              ["blocked", canBlock],
                              ["comment", true],
                              ["completed", canComplete],
                            ] as const).map(([action, enabled]) => (
                              <button
                                key={action}
                                type="button"
                                data-testid={`mailbox-action-${action}-${handoff.id}`}
                                disabled={
                                  !canMutate ||
                                  !enabled ||
                                  mailboxMutationBusy ||
                                  (action === "comment" && !noteValue.trim())
                                }
                                onClick={() => void handleAdvance(handoff, action)}
                                className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.16em] disabled:opacity-50"
                              >
                                {busyKey === `${handoff.id}:${action}` ? "处理中..." : formatActionLabel(action)}
                              </button>
                            ))}
                            {canComplete ? (
                              <button
                                type="button"
                                data-testid={`mailbox-action-completed-continue-${handoff.id}`}
                                disabled={!canMutate || mailboxMutationBusy}
                                onClick={() => void handleAdvance(handoff, "completed", { continueGovernedRoute: true })}
                                className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-ink)] px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.16em] text-white disabled:opacity-50"
                              >
                                {busyKey === `${handoff.id}:completed:continue` ? "处理中..." : "完成并继续下一步"}
                              </button>
                            ) : null}
                          </div>
                          {actionError?.id === handoff.id ? (
                            <p className="text-sm leading-6 text-[var(--shock-pink)]">{actionError.message}</p>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  </Panel>
                );
              })}
              </>
            )}
          </div>
        </div>
      )}
    </OpenShockShell>
  );
}
