"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { OpenShockShell } from "@/components/open-shock-shell";
import { DetailRail, Panel } from "@/components/phase-zero-views";
import { usePhaseZeroState } from "@/lib/live-phase0";
import type { AgentHandoff } from "@/lib/phase-zero-types";
import { hasSessionPermission, permissionBoundaryCopy, permissionStatus } from "@/lib/session-authz";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function handoffStatusLabel(status: AgentHandoff["status"]) {
  switch (status) {
    case "acknowledged":
      return "acknowledged";
    case "blocked":
      return "blocked";
    case "completed":
      return "completed";
    default:
      return "requested";
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

function mailboxKindLabel(kind?: AgentHandoff["kind"]) {
  switch (kind) {
    case "governed":
      return "governed";
    case "delivery-closeout":
      return "delivery closeout";
    case "delivery-reply":
      return "delivery reply";
    default:
      return "manual";
  }
}

function mailboxReplyStatusLabel(status: AgentHandoff["status"]) {
  switch (status) {
    case "acknowledged":
      return "reply active";
    case "blocked":
      return "reply blocked";
    case "completed":
      return "reply completed";
    default:
      return "reply requested";
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
  return `parent ${handoffStatusLabel(status)}`;
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
      return "Acknowledge";
    case "blocked":
      return "Block";
    case "comment":
      return "Formal Comment";
    default:
      return "Complete";
  }
}

function mailboxMessageKindLabel(kind: AgentHandoff["messages"][number]["kind"]) {
  switch (kind) {
    case "request":
      return "request";
    case "ack":
      return "ack";
    case "blocked":
      return "blocked";
    case "comment":
      return "comment";
    default:
      return "complete";
  }
}

function governanceStatusLabel(status: string) {
  switch (status) {
    case "active":
      return "active";
    case "ready":
      return "ready";
    case "required":
      return "required";
    case "blocked":
      return "blocked";
    case "done":
      return "done";
    case "draft":
      return "draft";
    case "watch":
      return "watch";
    default:
      return "pending";
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

function governedCloseoutLabel(href: string) {
  return href.startsWith("/pull-requests/") ? "Open Delivery Entry" : "Review Closeout";
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
    updateHandoff,
  } = usePhaseZeroState();
  const [roomId, setRoomId] = useState("");
  const [fromAgentId, setFromAgentId] = useState("");
  const [toAgentId, setToAgentId] = useState("");
  const [title, setTitle] = useState("把当前 room context 交给下一位 Agent");
  const [summary, setSummary] = useState("当前 Room / Run / Inbox truth 已整理完成，下一位 Agent 可以直接沿这份上下文继续推进。");
  const [busyKey, setBusyKey] = useState("");
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [commentActors, setCommentActors] = useState<Record<string, string>>({});
  const [lastAppliedGovernedRouteKey, setLastAppliedGovernedRouteKey] = useState("");
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
  const openCount = loading || error ? 0 : state.mailbox.filter((item) => item.status !== "completed").length;
  const blockedCount = loading || error ? 0 : state.mailbox.filter((item) => item.status === "blocked").length;
  const completedCount = loading || error ? 0 : state.mailbox.filter((item) => item.status === "completed").length;
  const governance = state.workspace.governance;
  const governedSuggestion = governance.routingPolicy.suggestedHandoff;
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
    };
  }

  async function submitCreate(
    input: {
      roomId: string;
      fromAgentId: string;
      toAgentId: string;
      title: string;
      summary: string;
    },
    busyLabel: string
  ) {
    if (busyKey || !canMutate) {
      return;
    }
    setBusyKey(busyLabel);
    setActionError(null);
    try {
      await createHandoff(input);
    } catch (mutationError) {
      setActionError({
        id: "create",
        message: mutationError instanceof Error ? mutationError.message : "handoff create failed",
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

  async function handleAdvance(
    handoff: AgentHandoff,
    action: "acknowledged" | "blocked" | "comment" | "completed",
    options?: { continueGovernedRoute?: boolean }
  ) {
    if (busyKey || !canMutate) {
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
        message: mutationError instanceof Error ? mutationError.message : "handoff update failed",
      });
    } finally {
      setBusyKey("");
    }
  }

  return (
    <OpenShockShell
      view="mailbox"
      eyebrow="Agent Mailbox"
      title="把 handoff 做成可回放的正式合同"
      description="Mailbox 不再只是口头约定。request、ack、blocked、complete 现在都挂在同一份 live ledger 上，并且能回跳到 room / inbox。"
      contextTitle="Mailbox Ledger"
      contextDescription="当前 page 直接消费 live handoff truth；谁交给谁、卡在哪、什么时候完成，都不再藏在隐式 prompt 里。"
      contextBody={
        <DetailRail
          label="Mailbox Stats"
          items={[
            { label: "Open", value: `${openCount}` },
            { label: "Blocked", value: `${blockedCount}` },
            { label: "Completed", value: `${completedCount}` },
            { label: "Mutation", value: mutationStatus },
          ]}
        />
      }
    >
      {loading ? (
        <Panel tone="paper">
          <p className="font-display text-2xl font-bold">正在同步 Mailbox</p>
          <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
            等待 server 返回当前 handoff ledger。
          </p>
        </Panel>
      ) : error ? (
        <Panel tone="pink">
          <p className="font-display text-2xl font-bold">Mailbox 同步失败</p>
          <p className="mt-3 text-sm leading-6 text-white/80">{error}</p>
        </Panel>
      ) : (
        <div className="space-y-4">
          <Panel tone="lime">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                  multi-agent governance
                </p>
                <h3 className="mt-2 font-display text-3xl font-bold">
                  从模板直接起出 reviewer / tester / human override 治理链
                </h3>
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
                label="open handoffs"
                value={`${governance.stats.openHandoffs}`}
                detail="formal request / ack / block / complete 会围同一份 mailbox ledger 聚合。"
                testId="mailbox-governance-open-handoffs"
              />
              <GovernanceMetric
                label="blocked escalations"
                value={`${governance.stats.blockedEscalations}`}
                detail="blocked signal 不再散落在 prompt 里，会先抬到 Inbox 再决定 unblock。"
                testId="mailbox-governance-blocked-escalations"
              />
              <GovernanceMetric
                label="review gates"
                value={`${governance.stats.reviewGates}`}
                detail="review truth 会同时收 mailbox / PR / inbox，而不是单看某一张卡。"
                testId="mailbox-governance-review-gates"
              />
              <GovernanceMetric
                label="human override"
                value={`${governance.stats.humanOverrideGates}`}
                detail="人工批准和最终 response 收口继续保持显式可见，不被自动链路吞掉。"
                testId="mailbox-governance-human-override-gates"
              />
            </div>
          </Panel>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_0.85fr]">
            <Panel tone="white">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                    team topology
                  </p>
                  <h3 className="mt-2 font-display text-2xl font-bold">模板拓扑和当前 live lane 现在同源可见</h3>
                </div>
                <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                  {governance.teamTopology.length} lanes
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
                        <p className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">default agent</p>
                        <p className="mt-1.5 text-sm leading-6">{lane.defaultAgent || "按团队自定义"}</p>
                      </div>
                      <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2">
                        <p className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">lane</p>
                        <p className="mt-1.5 text-sm leading-6">{lane.lane || "当前 lane 正在整理中。"}</p>
                      </div>
                    </div>
                  </Panel>
                ))}
              </div>
            </Panel>

            <div className="space-y-4">
              <Panel tone={governanceTone(governance.humanOverride.status)}>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                  human override
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
                    打开 override lane
                  </Link>
                ) : null}
              </Panel>

              <Panel tone={governanceTone(governance.responseAggregation.status)}>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                  response aggregation
                </p>
                <p
                  data-testid="mailbox-governance-response-aggregation"
                  className="mt-2 font-display text-2xl font-bold"
                >
                  {governance.responseAggregation.finalResponse || "等待 closeout"}
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

              <Panel tone="paper">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                  governance rules
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
                  TC-041 walkthrough
                </p>
                <h3 className="mt-2 font-display text-2xl font-bold">
                  {"issue -> handoff -> review -> test -> final response 现在是一条可回放治理链"}
                </h3>
              </div>
              <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                {governance.walkthrough.length} steps
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
                        open
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
                  request handoff
                </p>
                <h3 className="mt-2 font-display text-3xl font-bold">从 room 当前 owner 发起正式交接</h3>
                <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                  这一步会同时写入 mailbox ledger、room system note 和 inbox back-link。收到方之后只在同一条对象上 ack / block / comment / complete。
                </p>
                {governedSuggestion.roomId === roomId ? (
                  <div
                    data-testid="mailbox-governed-route"
                    className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                          governed handoff
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
                              Apply Governed Route
                            </button>
                            <button
                              type="button"
                              data-testid="mailbox-governed-route-create"
                              onClick={() => void handleCreateGovernedRoute()}
                              disabled={!canMutate || busyKey === "governed-create"}
                              className="rounded-[12px] border-2 border-[var(--shock-ink)] bg-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white disabled:opacity-60"
                            >
                              {busyKey === "governed-create" ? "Creating..." : "Create Governed Handoff"}
                            </button>
                          </>
                        ) : null}
                        {governedSuggestion.status === "active" && governedSuggestion.href ? (
                          <Link
                            href={governedSuggestion.href}
                            data-testid="mailbox-governed-route-focus"
                            className="rounded-[12px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                          >
                            Focus Active Handoff
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
                          {governedSuggestion.fromLaneLabel} · {governedSuggestion.fromAgent || "manual"}
                        </span>
                      ) : null}
                      {governedSuggestion.toLaneLabel ? (
                        <span className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em]">
                          {governedSuggestion.toLaneLabel} · {governedSuggestion.toAgent || "manual"}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em]">Room</span>
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
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em]">From</span>
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
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em]">To</span>
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
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em]">Title</span>
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
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em]">Summary</span>
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
                    mutation gate
                  </p>
                  <p data-testid="mailbox-mutation-status" className="mt-2 font-display text-2xl font-bold">
                    {mutationStatus}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                    {canMutate ? "当前 session 可以正式发起和推进 handoff。" : mutationBoundary}
                  </p>
                </div>
                <button
                  type="button"
                  data-testid="mailbox-create-submit"
                  onClick={() => void handleCreate()}
                  disabled={!canMutate || busyKey === "create"}
                  className="w-full border-2 border-[var(--shock-ink)] bg-[var(--shock-ink)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-white disabled:opacity-60"
                >
                  {busyKey === "create" ? "Creating..." : "Create Formal Handoff"}
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
                <p className="font-display text-2xl font-bold">当前还没有 formal handoff</p>
                <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                  现在可以直接从上面的 form 发起第一条 request，再观察 room / inbox / mailbox 三个面同时前滚。
                </p>
              </Panel>
            ) : (
              mailboxForRoom.map((handoff) => {
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
                const noteValue = notes[handoff.id] ?? "";
                const commentActorId =
                  commentActors[handoff.id] === handoff.toAgentId ? handoff.toAgentId : handoff.fromAgentId;
                const canAck = handoff.status === "requested" || handoff.status === "blocked";
                const canBlock = handoff.status === "requested" || handoff.status === "acknowledged";
                const canComplete = handoff.status === "acknowledged";

                return (
                  <Panel
                    key={handoff.id}
                    tone={handoff.status === "blocked" ? "pink" : handoff.status === "acknowledged" ? "lime" : "white"}
                    className={cn(active && "ring-2 ring-[var(--shock-ink)] ring-offset-2 ring-offset-[var(--shock-paper)]")}
                  >
                    <article data-testid={`mailbox-card-${handoff.id}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
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
                                reply x{responseAttemptCount}
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
                      <p className="mt-3 text-sm leading-6 opacity-80">{handoff.lastAction}</p>
                      {parentHandoff ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          <span
                            data-testid={`mailbox-parent-chip-${handoff.id}`}
                            className="rounded-[12px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                          >
                            parent {parentHandoff.title}
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
                          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.6)]">From</p>
                          <Link href={fromAgentHref} className="mt-1.5 block font-display text-[16px] font-semibold leading-5">
                            {handoff.fromAgent}
                          </Link>
                        </div>
                        <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5">
                          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.6)]">To</p>
                          <Link href={toAgentHref} className="mt-1.5 block font-display text-[16px] font-semibold leading-5">
                            {handoff.toAgent}
                          </Link>
                        </div>
                        <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5">
                          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.6)]">Requested</p>
                          <p className="mt-1.5 font-display text-[16px] font-semibold leading-5">{handoff.requestedAt}</p>
                        </div>
                        <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5">
                          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.6)]">Updated</p>
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
                          Inbox Back-link
                        </Link>
                        {parentHandoff ? (
                          <Link
                            href={`/inbox?handoffId=${parentHandoff.id}&roomId=${parentHandoff.roomId}`}
                            data-testid={`mailbox-parent-link-${handoff.id}`}
                            className="rounded-[12px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                          >
                            Open Parent Closeout
                          </Link>
                        ) : null}
                        {responseHandoff ? (
                          <Link
                            href={`/inbox?handoffId=${responseHandoff.id}&roomId=${responseHandoff.roomId}`}
                            data-testid={`mailbox-response-link-${handoff.id}`}
                            className="rounded-[12px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                          >
                            Open Unblock Reply
                          </Link>
                        ) : null}
                        {canResumeParent ? (
                          <button
                            type="button"
                            data-testid={`mailbox-action-resume-parent-${handoff.id}`}
                            disabled={!canMutate || busyKey === `${parentHandoff.id}:acknowledged`}
                            onClick={() => void handleAdvance(parentHandoff, "acknowledged")}
                            className="rounded-[12px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] disabled:opacity-50"
                          >
                            {busyKey === `${parentHandoff.id}:acknowledged` ? "Working..." : "Resume Parent Closeout"}
                          </button>
                        ) : null}
                      </div>

                      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                        <div>
                          <p className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">Mailbox Messages</p>
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
                            <p className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">Mailbox Note</p>
                            <textarea
                              data-testid={`mailbox-note-${handoff.id}`}
                              value={noteValue}
                              onChange={(event) =>
                                setNotes((current) => ({ ...current, [handoff.id]: event.target.value }))
                              }
                              disabled={!canMutate}
                              className="mt-3 min-h-[120px] w-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3 text-sm"
                              placeholder="comment / blocked 时请写清楚上下文；complete 时可补收口说明。"
                            />
                            <label className="mt-3 block space-y-2">
                              <span className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">
                                Comment As
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
                                  busyKey === `${handoff.id}:${action}` ||
                                  (action === "comment" && !noteValue.trim())
                                }
                                onClick={() => void handleAdvance(handoff, action)}
                                className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.16em] disabled:opacity-50"
                              >
                                {busyKey === `${handoff.id}:${action}` ? "Working..." : formatActionLabel(action)}
                              </button>
                            ))}
                            {canComplete ? (
                              <button
                                type="button"
                                data-testid={`mailbox-action-completed-continue-${handoff.id}`}
                                disabled={!canMutate || busyKey === `${handoff.id}:completed:continue`}
                                onClick={() => void handleAdvance(handoff, "completed", { continueGovernedRoute: true })}
                                className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-ink)] px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.16em] text-white disabled:opacity-50"
                              >
                                {busyKey === `${handoff.id}:completed:continue` ? "Working..." : "Complete + Auto-Advance"}
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
              })
            )}
          </div>
        </div>
      )}
    </OpenShockShell>
  );
}
