"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

import { OpenShockShell } from "@/components/open-shock-shell";
import { DetailRail, Panel } from "@/components/phase-zero-views";
import { useBrowserNotificationSurface } from "@/lib/browser-notifications";
import {
  type NotificationCenter,
  type NotificationChannel,
  type NotificationDelivery,
  type NotificationFanoutReceipt,
  type NotificationPreference,
  type NotificationSubscriberStatus,
  type WorkspaceNotificationPolicy,
  useLiveNotifications,
} from "@/lib/live-notifications";
import { usePhaseZeroState } from "@/lib/live-phase0";
import { formatSandboxList, sandboxPolicyDraft, sandboxPolicySummary, sandboxProfileLabel } from "@/lib/sandbox-policy";
import type {
  AgentStatus,
  ApprovalCenterItem,
  CredentialProfile,
  PhaseZeroState,
  SandboxProfile,
  WorkspaceGovernanceLaneConfig,
  WorkspaceMember,
} from "@/lib/phase-zero-types";

type LiveNotificationsModel = ReturnType<typeof useLiveNotifications>;

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function valueOrPlaceholder(value: string | undefined, fallback: string) {
  return value && value.trim() ? value : fallback;
}

function formatCount(value?: number) {
  return typeof value === "number" ? value.toLocaleString("zh-CN") : "未返回";
}

function quotaStatusLabel(status?: string) {
  switch (status) {
    case "near_limit":
      return "逼近上限";
    case "watch":
      return "进入观察";
    case "healthy":
      return "健康";
    default:
      return "待同步";
  }
}

function quotaStatusTone(status?: string): "white" | "yellow" | "lime" | "pink" {
  switch (status) {
    case "near_limit":
      return "pink";
    case "watch":
      return "yellow";
    case "healthy":
      return "lime";
    default:
      return "white";
  }
}

function quotaCounterTone(used?: number, limit?: number): "white" | "yellow" | "lime" | "pink" {
  if (typeof used !== "number" || typeof limit !== "number" || limit <= 0) {
    return "white";
  }
  const ratio = used / limit;
  if (ratio >= 0.9) {
    return "pink";
  }
  if (ratio >= 0.7) {
    return "yellow";
  }
  return "lime";
}

function formatQuotaCounter(used?: number, limit?: number, label?: string) {
  if (typeof used !== "number" || typeof limit !== "number" || limit <= 0) {
    return "未返回";
  }
  return `${used}/${limit}${label ? ` ${label}` : ""}`;
}

function formatRetentionSummary(quota?: {
  messageHistoryDays?: number;
  runLogDays?: number;
  memoryDraftDays?: number;
}) {
  if (!quota) {
    return "未返回";
  }
  return `${quota.messageHistoryDays ?? 0}d 消息 / ${quota.runLogDays ?? 0}d Run / ${quota.memoryDraftDays ?? 0}d 草稿`;
}

function formatWorkspaceUsageWindow(usage?: { totalTokens?: number; windowLabel?: string }) {
  if (!usage) {
    return "未返回";
  }
  return `${formatCount(usage.totalTokens)} tokens / ${valueOrPlaceholder(usage.windowLabel, "窗口未返回")}`;
}

const WORKSPACE_POLICY_OPTIONS: WorkspaceNotificationPolicy[] = ["critical", "all", "mute"];
const SUBSCRIBER_PREFERENCE_OPTIONS: NotificationPreference[] = ["inherit", "critical", "all", "mute"];
const ONBOARDING_STATUS_OPTIONS = [
  { value: "not_started", label: "未开始" },
  { value: "in_progress", label: "进行中" },
  { value: "ready", label: "待收口" },
  { value: "done", label: "已完成" },
] as const;
const START_ROUTE_OPTIONS = ["/chat/all", "/rooms", "/inbox", "/mailbox", "/setup", "/board", "/settings", "/access"] as const;
type GovernanceLaneDraft = WorkspaceGovernanceLaneConfig;

type DeliveryDelegationMode = "formal-handoff" | "signal-only" | "auto-complete";

const DELIVERY_DELEGATION_MODE_OPTIONS: Array<{
  mode: DeliveryDelegationMode;
  value: string;
  label: string;
}> = [
  {
    mode: "formal-handoff",
    value: "formal-handoff",
    label: "final lane closeout 后自动创建 delegated closeout handoff，并把最后一棒继续挂进 Mailbox / Inbox ledger。",
  },
  {
    mode: "signal-only",
    value: "signal-only",
    label: "final lane closeout 只派 delivery delegation signal；是否起 formal closeout handoff 由人类按 signal 决定。",
  },
  {
    mode: "auto-complete",
    value: "auto-complete",
    label: "final lane closeout 后直接把 delivery delegate 收口为 done，不额外创建 delegated closeout handoff，适合明确要自动收尾的团队。",
  },
];

function inboxKindLabel(kind: ApprovalCenterItem["kind"]) {
  switch (kind) {
    case "approval":
      return "需要批准";
    case "blocked":
      return "阻塞";
    case "review":
      return "评审";
    default:
      return "状态";
  }
}

function inboxKindTone(kind: ApprovalCenterItem["kind"]) {
  switch (kind) {
    case "approval":
      return "bg-[var(--shock-yellow)]";
    case "blocked":
      return "bg-[var(--shock-pink)] text-white";
    case "review":
      return "bg-[var(--shock-lime)]";
    default:
      return "bg-white";
  }
}

function permissionLabel(permission: NotificationPermission | "unsupported") {
  switch (permission) {
    case "granted":
      return "已授权";
    case "denied":
      return "已拒绝";
    case "default":
      return "待确认";
    default:
      return "浏览器不支持";
  }
}

function registrationLabel(state: "idle" | "registering" | "ready" | "blocked" | "error") {
  switch (state) {
    case "registering":
      return "注册中";
    case "ready":
      return "已注册";
    case "blocked":
      return "不可注册";
    case "error":
      return "注册失败";
    default:
      return "未注册";
  }
}

function preferenceLabel(preference: NotificationPreference | WorkspaceNotificationPolicy) {
  switch (preference) {
    case "all":
      return "全部 live 事件";
    case "critical":
      return "仅高优先级";
    case "mute":
      return "静默";
    default:
      return "继承工作区默认值";
  }
}

function channelLabel(channel: NotificationChannel) {
  return channel === "browser_push" ? "Browser Push" : "Email";
}

function subscriberStatusLabel(status: NotificationSubscriberStatus) {
  switch (status) {
    case "ready":
      return "已就绪";
    case "blocked":
      return "阻塞";
    default:
      return "待激活";
  }
}

function deliveryStatusLabel(status: NotificationDelivery["status"] | NotificationFanoutReceipt["status"]) {
  switch (status) {
    case "ready":
      return "待发送";
    case "suppressed":
      return "被策略抑制";
    case "blocked":
      return "被订阅者状态阻塞";
    case "unrouted":
      return "未路由";
    case "sent":
      return "已送达";
    case "failed":
      return "发送失败";
    default:
      return status;
  }
}

function currentBrowserSubscriberStatus(surface: {
  permission: NotificationPermission | "unsupported";
  registrationState: "idle" | "registering" | "ready" | "blocked" | "error";
}): NotificationSubscriberStatus {
  if (surface.permission === "denied" || surface.registrationState === "blocked" || surface.registrationState === "error") {
    return "blocked";
  }
  if (surface.permission === "granted" && surface.registrationState === "ready") {
    return "ready";
  }
  return "pending";
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

function toneForSubscriberStatus(status: NotificationSubscriberStatus) {
  switch (status) {
    case "ready":
      return "lime";
    case "blocked":
      return "pink";
    default:
      return "yellow";
  }
}

function toneForDeliveryStatus(status: NotificationDelivery["status"] | NotificationFanoutReceipt["status"]) {
  switch (status) {
    case "ready":
    case "sent":
      return "lime";
    case "blocked":
    case "failed":
      return "pink";
    case "suppressed":
      return "yellow";
    default:
      return "white";
  }
}

function onboardingStatusLabel(status: string) {
  switch (status) {
    case "not_started":
      return "未开始";
    case "in_progress":
      return "进行中";
    case "ready":
      return "待收口";
    case "done":
      return "已完成";
    default:
      return status || "未声明";
  }
}

function findSettingsMember(sessionMemberID: string | undefined, members: WorkspaceMember[]) {
  return members.find((member) => member.id === sessionMemberID) ?? members.find((member) => member.role === "owner") ?? null;
}

function agentLabel(agentID: string | undefined, agents: AgentStatus[]) {
  if (!agentID) {
    return "未绑定";
  }
  return agents.find((agent) => agent.id === agentID)?.name ?? agentID;
}

function governanceLaneDrafts(workspace: PhaseZeroState["workspace"]): GovernanceLaneDraft[] {
  const configured = workspace.governance.configuredTopology ?? [];
  if (configured.length > 0) {
    return configured.map((lane) => ({
      id: lane.id,
      label: lane.label,
      role: lane.role,
      defaultAgent: lane.defaultAgent ?? "",
      lane: lane.lane ?? "",
    }));
  }

  return workspace.governance.teamTopology.map((lane) => ({
    id: lane.id,
    label: lane.label,
    role: lane.role,
    defaultAgent: lane.defaultAgent ?? "",
    lane: lane.lane ?? "",
  }));
}

function nextGovernanceLaneId(lanes: GovernanceLaneDraft[]) {
  let index = lanes.length + 1;
  while (lanes.some((lane) => lane.id === `lane-${index}`)) {
    index += 1;
  }
  return `lane-${index}`;
}

function normalizeDeliveryDelegationMode(value?: string): DeliveryDelegationMode {
  if (value === "signal-only") {
    return "signal-only";
  }
  if (value === "auto-complete") {
    return "auto-complete";
  }
  return "formal-handoff";
}

function deliveryDelegationModeLabel(mode: DeliveryDelegationMode) {
  if (mode === "signal-only") {
    return "signal only";
  }
  if (mode === "auto-complete") {
    return "auto complete";
  }
  return "formal handoff";
}

function hasWorkspaceManagePermission(state: PhaseZeroState) {
  return state.auth.session.permissions.includes("workspace.manage");
}

function credentialStatusLabel(status: string | undefined) {
  switch (status) {
    case "configured":
      return "已加密保管";
    default:
      return "待写入";
  }
}

function credentialUsageSummary(profile: CredentialProfile, state: PhaseZeroState) {
  const agentCount = state.agents.filter((agent) => (agent.credentialProfileIds ?? []).includes(profile.id)).length;
  const runCount = state.runs.filter((run) => (run.credentialProfileIds ?? []).includes(profile.id)).length;
  return `${profile.workspaceDefault ? "workspace default" : "non-default"} · ${agentCount} agent · ${runCount} run`;
}

function FactTile({
  label,
  value,
  testID,
}: {
  label: string;
  value: string;
  testID?: string;
}) {
  return (
    <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3" data-testid={testID}>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">{label}</p>
      <p className="mt-2 font-display text-xl font-semibold">{value}</p>
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

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-[20px] border-2 border-dashed border-[var(--shock-ink)] bg-white px-5 py-5">
      <p className="font-display text-2xl font-bold">{title}</p>
      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{message}</p>
    </div>
  );
}

function PolicyButton({
  active,
  onClick,
  label,
  value,
  testID,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  value: string;
  testID?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testID}
      className={cn(
        "rounded-[20px] border-2 border-[var(--shock-ink)] px-4 py-4 text-left transition-transform hover:-translate-y-0.5",
        active ? "bg-[var(--shock-yellow)] shadow-[4px_4px_0_0_var(--shock-ink)]" : "bg-white"
      )}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.18em]">{value}</p>
      <p className="mt-2 text-sm leading-6">{label}</p>
    </button>
  );
}

function findCurrentBrowserSubscriber(center: NotificationCenter, target: string) {
  return center.subscribers.find((subscriber) => subscriber.channel === "browser_push" && subscriber.target === target) ?? null;
}

function findPrimaryEmailSubscriber(center: NotificationCenter, preferredEmail: string) {
  const normalizedEmail = preferredEmail.trim().toLowerCase();
  if (normalizedEmail) {
    const exact = center.subscribers.find(
      (subscriber) => subscriber.channel === "email" && subscriber.target.trim().toLowerCase() === normalizedEmail
    );
    if (exact) {
      return exact;
    }
  }
  return center.subscribers.find((subscriber) => subscriber.channel === "email") ?? null;
}

function isIdentityTemplate(templateID?: string) {
  return Boolean(templateID && templateID.startsWith("auth_"));
}

function notificationTemplateLabel(templateID: string | undefined, fallback?: string) {
  if (fallback) {
    return fallback;
  }
  switch (templateID) {
    case "auth_invite":
      return "Invite";
    case "auth_verify_email":
      return "Verify Email";
    case "auth_password_reset":
      return "Password Reset";
    case "auth_blocked_recovery":
      return "Blocked Recovery Escalation";
    default:
      return valueOrPlaceholder(templateID, "未命名模板");
  }
}

function buildIdentityTemplateSummaries(
  signals: ApprovalCenterItem[],
  deliveries: NotificationDelivery[],
  receipts: NotificationFanoutReceipt[]
) {
  const templates = new Map<
    string,
    {
      id: string;
      label: string;
      signalCount: number;
      readyCount: number;
      blockedCount: number;
      lastAttempt: string;
      lastStatus: string;
    }
  >();

  const ensureTemplate = (templateID?: string, templateLabel?: string) => {
    const id = valueOrPlaceholder(templateID, "untyped");
    const existing = templates.get(id);
    if (existing) {
      return existing;
    }
    const next = {
      id,
      label: notificationTemplateLabel(templateID, templateLabel),
      signalCount: 0,
      readyCount: 0,
      blockedCount: 0,
      lastAttempt: "",
      lastStatus: "尚未执行",
    };
    templates.set(id, next);
    return next;
  };

  for (const signal of signals) {
    const template = ensureTemplate(signal.templateId, signal.templateLabel);
    template.signalCount += 1;
  }

  for (const delivery of deliveries) {
    const template = ensureTemplate(delivery.templateId, delivery.templateLabel);
    if (delivery.status === "ready") {
      template.readyCount += 1;
    }
    if (delivery.status === "blocked") {
      template.blockedCount += 1;
    }
  }

  for (const receipt of receipts) {
    const template = ensureTemplate(receipt.templateId, receipt.templateLabel);
    if (receipt.attemptedAt > template.lastAttempt) {
      template.lastAttempt = receipt.attemptedAt;
      template.lastStatus = deliveryStatusLabel(receipt.status);
    }
  }

  return Array.from(templates.values());
}

function LiveSettingsContextRail({ notifications }: { notifications: LiveNotificationsModel }) {
  const { state, loading: stateLoading, error: stateError } = usePhaseZeroState();
  const { center, loading, error } = notifications;
  const member = findSettingsMember(state.auth.session.memberId, state.auth.members);
  const workspace = state.workspace;
  return (
    <DetailRail
      label="Config Truth"
      items={[
        {
          label: "Onboarding",
          value: stateLoading
            ? "同步中"
            : stateError
              ? "读取失败"
              : `${valueOrPlaceholder(state.workspace.onboarding.templateId, "未选模板")} / ${onboardingStatusLabel(state.workspace.onboarding.status)}`,
        },
        {
          label: "Identity",
          value: stateLoading
            ? "同步中"
            : stateError
              ? "读取失败"
              : `${agentLabel(member?.preferences.preferredAgentId, state.agents)} / ${valueOrPlaceholder(member?.githubIdentity?.handle, "未绑 GitHub")}`,
        },
        {
          label: "Plan",
          value: stateLoading
            ? "同步中"
            : stateError
              ? "读取失败"
              : `${valueOrPlaceholder(workspace.plan, "未声明")} / ${quotaStatusLabel(workspace.quota?.status)} / ${formatQuotaCounter(workspace.quota?.usedAgents, workspace.quota?.maxAgents, "agents")}`,
        },
        {
          label: "Retention",
          value: stateLoading ? "同步中" : stateError ? "读取失败" : formatRetentionSummary(workspace.quota),
        },
        {
          label: "Usage",
          value: stateLoading
            ? "同步中"
            : stateError
              ? "读取失败"
              : `${formatWorkspaceUsageWindow(workspace.usage)} / ${formatCount(workspace.usage?.messageCount)} msgs`,
        },
        {
          label: "Worker",
          value: loading
            ? "同步中"
            : error
              ? "读取失败"
              : center.worker.ranAt
                ? `${center.worker.delivered}/${center.worker.attempted} sent`
                : "未执行",
        },
      ]}
    />
  );
}

function WorkspacePlanObservabilityPanel() {
  const { state, loading, error } = usePhaseZeroState();
  const workspace = state.workspace;
  const quota = workspace.quota;
  const usage = workspace.usage;
  const loadingValue = loading ? "同步中" : error ? "读取失败" : null;
  const metricValue = (value: string) => loadingValue ?? value;
  const metricTone = (tone: "white" | "yellow" | "lime" | "pink") => (loadingValue ? "white" : tone);
  const quotaTone = quotaStatusTone(quota?.status);
  const usageTone = typeof usage?.totalTokens === "number" && usage.totalTokens >= 14000 ? "pink" : "yellow";

  return (
    <Panel tone="ink" className="shadow-[6px_6px_0_0_var(--shock-yellow)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/72">工作区额度</p>
          <h2 className="mt-2 font-display text-3xl font-bold">当前套餐、保留期和使用情况</h2>
        </div>
        <span
          data-testid="settings-workspace-quota-status"
          className={cn(
            "rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]",
            quotaTone === "pink"
              ? "bg-[var(--shock-pink)] text-white"
              : quotaTone === "yellow"
                ? "bg-[var(--shock-yellow)]"
                : quotaTone === "lime"
                  ? "bg-[var(--shock-lime)]"
                  : "bg-white text-[var(--shock-ink)]"
          )}
        >
          {metricValue(quotaStatusLabel(quota?.status))}
        </span>
      </div>
      <p className="mt-3 max-w-4xl text-sm leading-6 text-white/84">
        这里集中展示工作区的额度、保留期和最近使用情况。
      </p>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FactTile label="Plan" value={metricValue(valueOrPlaceholder(workspace.plan, "未声明"))} testID="settings-workspace-plan-value" />
        <FactTile
          label="Usage Window"
          value={metricValue(formatWorkspaceUsageWindow(usage))}
          testID="settings-workspace-usage-window"
        />
        <FactTile label="Retention" value={metricValue(formatRetentionSummary(quota))} testID="settings-workspace-retention" />
        <FactTile
          label="Usage Detail"
          value={metricValue(`${formatCount(usage?.runCount)} runs / ${formatCount(usage?.messageCount)} msgs`)}
          testID="settings-workspace-usage-detail"
        />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_0.92fr]">
        <div className="grid gap-3">
          <StatusRow
            label="Machines"
            value={metricValue(formatQuotaCounter(quota?.usedMachines, quota?.maxMachines, "machines"))}
            tone={metricTone(quotaCounterTone(quota?.usedMachines, quota?.maxMachines))}
            testID="settings-workspace-machines"
          />
          <StatusRow
            label="Agents"
            value={metricValue(formatQuotaCounter(quota?.usedAgents, quota?.maxAgents, "agents"))}
            tone={metricTone(quotaCounterTone(quota?.usedAgents, quota?.maxAgents))}
            testID="settings-workspace-agents"
          />
          <StatusRow
            label="Channels"
            value={metricValue(formatQuotaCounter(quota?.usedChannels, quota?.maxChannels, "channels"))}
            tone={metricTone(quotaCounterTone(quota?.usedChannels, quota?.maxChannels))}
            testID="settings-workspace-channels"
          />
          <StatusRow
            label="Rooms"
            value={metricValue(formatQuotaCounter(quota?.usedRooms, quota?.maxRooms, "rooms"))}
            tone={metricTone(quotaCounterTone(quota?.usedRooms, quota?.maxRooms))}
            testID="settings-workspace-rooms"
          />
        </div>

        <div className="grid gap-3">
          <StatusRow
            label="Workspace Usage"
            value={metricValue(`${formatCount(usage?.totalTokens)} tokens / ${formatCount(usage?.runCount)} runs / ${formatCount(usage?.messageCount)} msgs`)}
            tone={metricTone(usageTone)}
            testID="settings-workspace-usage-summary"
          />
          <StatusRow
            label="Last Refresh"
            value={metricValue(formatTimestamp(usage?.refreshedAt))}
            tone="white"
            testID="settings-workspace-usage-refresh"
          />
          <StatusRow
            label="Quota Warning"
            value={metricValue(valueOrPlaceholder(quota?.warning, "当前还没有 quota warning。"))}
            tone={metricTone(quotaTone)}
            testID="settings-workspace-quota-warning"
          />
          <StatusRow
            label="Usage Warning"
            value={metricValue(valueOrPlaceholder(usage?.warning, "当前还没有 usage warning。"))}
            tone={metricTone(usageTone)}
            testID="settings-workspace-usage-warning"
          />
        </div>
      </div>
    </Panel>
  );
}

function WorkspaceDurableConfigPanel() {
  const { state, updateWorkspaceConfig } = usePhaseZeroState();
  const workspace = state.workspace;
  const [templateId, setTemplateId] = useState("");
  const [status, setStatus] = useState("in_progress");
  const [currentStep, setCurrentStep] = useState("");
  const [completedSteps, setCompletedSteps] = useState("");
  const [resumeUrl, setResumeUrl] = useState("");
  const [browserPush, setBrowserPush] = useState("");
  const [memoryMode, setMemoryMode] = useState("");
  const [sandboxProfile, setSandboxProfile] = useState<SandboxProfile>("trusted");
  const [allowedHosts, setAllowedHosts] = useState("");
  const [allowedCommands, setAllowedCommands] = useState("");
  const [allowedTools, setAllowedTools] = useState("");
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (dirty) {
      return;
    }
    setTemplateId(workspace.onboarding.templateId ?? "");
    setStatus(workspace.onboarding.status || "in_progress");
    setCurrentStep(workspace.onboarding.currentStep ?? "");
    setCompletedSteps((workspace.onboarding.completedSteps ?? []).join(", "));
    setResumeUrl(workspace.onboarding.resumeUrl ?? "");
    setBrowserPush(workspace.browserPush ?? "");
    setMemoryMode(workspace.memoryMode ?? "");
    setSandboxProfile((workspace.sandbox.profile || "trusted") as SandboxProfile);
    setAllowedHosts(formatSandboxList(workspace.sandbox.allowedHosts));
    setAllowedCommands(formatSandboxList(workspace.sandbox.allowedCommands));
    setAllowedTools(formatSandboxList(workspace.sandbox.allowedTools));
  }, [dirty, workspace]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      await updateWorkspaceConfig({
        plan: workspace.plan,
        browserPush,
        memoryMode,
        sandbox: sandboxPolicyDraft(sandboxProfile, {
          allowedHosts,
          allowedCommands,
          allowedTools,
        }),
        onboarding: {
          status,
          templateId,
          currentStep,
          completedSteps: completedSteps
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          resumeUrl,
        },
      });
      setDirty(false);
      setSuccess("工作区设置已保存。");
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "workspace config update failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel tone="yellow">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">工作区基础设置</p>
          <h2 className="mt-2 font-display text-3xl font-bold">启动、仓库和安全设置</h2>
        </div>
        <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
          {onboardingStatusLabel(workspace.onboarding.status)}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
        这里管理工作区模板、启动进度、仓库绑定、浏览器入口和安全范围。
      </p>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FactTile label="模板" value={valueOrPlaceholder(workspace.onboarding.templateId, "未选模板")} testID="settings-workspace-template-value" />
        <p className="hidden" data-testid="settings-workspace-template-text">{valueOrPlaceholder(workspace.onboarding.templateId, "未选模板")}</p>
        <FactTile label="继续地址" value={valueOrPlaceholder(workspace.onboarding.resumeUrl, "未设置")} />
        <FactTile label="仓库同步" value={valueOrPlaceholder(workspace.repoBinding.syncedAt, "未回写")} />
        <FactTile label="安装状态" value={workspace.githubInstallation.connectionReady ? "已连接" : "待完成"} />
        <FactTile label="安全模式" value={sandboxProfileLabel(workspace.sandbox.profile)} testID="settings-workspace-sandbox-profile-value" />
        <FactTile label="规则" value={sandboxPolicySummary(workspace.sandbox)} testID="settings-workspace-sandbox-summary" />
      </div>

      <form onSubmit={handleSubmit} className="mt-5 grid gap-3 rounded-[24px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-2 text-sm">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">模板</span>
            <input
              data-testid="settings-workspace-template"
              value={templateId}
              onChange={(event) => {
                setTemplateId(event.target.value);
                setDirty(true);
              }}
              className="rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3"
            />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">引导状态</span>
            <select
              data-testid="settings-workspace-onboarding-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setDirty(true);
              }}
              className="rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3"
            >
              {ONBOARDING_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">当前步骤</span>
            <input
              data-testid="settings-workspace-current-step"
              value={currentStep}
              onChange={(event) => {
                setCurrentStep(event.target.value);
                setDirty(true);
              }}
              className="rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3"
            />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">继续地址</span>
            <input
              data-testid="settings-workspace-resume-url"
              value={resumeUrl}
              onChange={(event) => {
                setResumeUrl(event.target.value);
                setDirty(true);
              }}
              className="rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3"
            />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">已完成步骤</span>
            <input
              data-testid="settings-workspace-completed-steps"
              value={completedSteps}
              onChange={(event) => {
                setCompletedSteps(event.target.value);
                setDirty(true);
              }}
              className="rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3"
            />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">浏览器提醒</span>
            <input
              data-testid="settings-workspace-browser-push"
              value={browserPush}
              onChange={(event) => {
                setBrowserPush(event.target.value);
                setDirty(true);
              }}
              className="rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3"
            />
          </label>
          <label className="grid gap-2 text-sm md:col-span-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">记忆模式</span>
            <input
              data-testid="settings-workspace-memory-mode"
              value={memoryMode}
              onChange={(event) => {
                setMemoryMode(event.target.value);
                setDirty(true);
              }}
              className="rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3"
            />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">sandbox profile</span>
            <select
              data-testid="settings-workspace-sandbox-profile"
              value={sandboxProfile}
              onChange={(event) => {
                setSandboxProfile(event.target.value as SandboxProfile);
                setDirty(true);
              }}
              className="rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3"
            >
              <option value="trusted">trusted</option>
              <option value="restricted">restricted</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">allowed hosts</span>
            <input
              data-testid="settings-workspace-sandbox-allowed-hosts"
              value={allowedHosts}
              onChange={(event) => {
                setAllowedHosts(event.target.value);
                setDirty(true);
              }}
              className="rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3"
              placeholder="github.com, api.openai.com"
            />
          </label>
          <label className="grid gap-2 text-sm md:col-span-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">allowed commands</span>
            <input
              data-testid="settings-workspace-sandbox-allowed-commands"
              value={allowedCommands}
              onChange={(event) => {
                setAllowedCommands(event.target.value);
                setDirty(true);
              }}
              className="rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3"
              placeholder="git status, pnpm test"
            />
          </label>
          <label className="grid gap-2 text-sm md:col-span-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">allowed tools</span>
            <input
              data-testid="settings-workspace-sandbox-allowed-tools"
              value={allowedTools}
              onChange={(event) => {
                setAllowedTools(event.target.value);
                setDirty(true);
              }}
              className="rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3"
              placeholder="read_file, rg"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p data-testid="settings-workspace-onboarding-value" className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
            {onboardingStatusLabel(workspace.onboarding.status)} / {valueOrPlaceholder(workspace.onboarding.currentStep, "未声明 current step")}
          </p>
          <button
            data-testid="settings-workspace-save"
            type="submit"
            disabled={pending}
            className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "写回中..." : "写回 Workspace Truth"}
          </button>
        </div>

        {error ? (
          <p data-testid="settings-workspace-error" className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 text-sm text-white">
            {error}
          </p>
        ) : null}
        {success ? (
          <p data-testid="settings-workspace-success" className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-4 py-3 text-sm">
            {success}
          </p>
        ) : null}
      </form>
    </Panel>
  );
}

function GovernanceTopologyPanel() {
  const { state, updateWorkspaceConfig } = usePhaseZeroState();
  const workspace = state.workspace;
  const canManage = hasWorkspaceManagePermission(state);
  const [lanes, setLanes] = useState<GovernanceLaneDraft[]>([]);
  const [deliveryDelegationMode, setDeliveryDelegationMode] = useState<DeliveryDelegationMode>("formal-handoff");
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (dirty) {
      return;
    }
    setLanes(governanceLaneDrafts(workspace));
    setDeliveryDelegationMode(normalizeDeliveryDelegationMode(workspace.governance.deliveryDelegationMode));
  }, [dirty, workspace]);

  function updateLane(index: number, patch: Partial<GovernanceLaneDraft>) {
    setLanes((current) =>
      current.map((lane, laneIndex) => (laneIndex === index ? { ...lane, ...patch } : lane))
    );
    setDirty(true);
  }

  function addLane() {
    setLanes((current) => [
      ...current,
      {
        id: nextGovernanceLaneId(current),
        label: `New Lane ${current.length + 1}`,
        role: "新职责",
        defaultAgent: "",
        lane: "",
      },
    ]);
    setDirty(true);
  }

  function removeLane(index: number) {
    setLanes((current) => current.filter((_, laneIndex) => laneIndex !== index));
    setDirty(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      await updateWorkspaceConfig({
        plan: workspace.plan,
        browserPush: workspace.browserPush,
        memoryMode: workspace.memoryMode,
        sandbox: workspace.sandbox,
        onboarding: {
          status: workspace.onboarding.status,
          templateId: workspace.onboarding.templateId ?? "",
          currentStep: workspace.onboarding.currentStep ?? "",
          completedSteps: workspace.onboarding.completedSteps ?? [],
          resumeUrl: workspace.onboarding.resumeUrl ?? "",
        },
        governance: {
          deliveryDelegationMode,
          teamTopology: lanes.map((lane) => ({
            id: lane.id.trim(),
            label: lane.label.trim(),
            role: lane.role.trim(),
            defaultAgent: lane.defaultAgent?.trim() ?? "",
            lane: lane.lane?.trim() ?? "",
          })),
        },
      });
      setDirty(false);
      setSuccess("团队协作流程已保存。");
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "workspace governance topology update failed");
    } finally {
      setPending(false);
    }
  }

  async function handleResetTemplate() {
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      await updateWorkspaceConfig({
        plan: workspace.plan,
        browserPush: workspace.browserPush,
        memoryMode: workspace.memoryMode,
        sandbox: workspace.sandbox,
        onboarding: {
          status: workspace.onboarding.status,
          templateId: workspace.onboarding.templateId ?? "",
          currentStep: workspace.onboarding.currentStep ?? "",
          completedSteps: workspace.onboarding.completedSteps ?? [],
          resumeUrl: workspace.onboarding.resumeUrl ?? "",
        },
        governance: {
          deliveryDelegationMode: "formal-handoff",
          teamTopology: [],
        },
      });
      setDirty(false);
      setSuccess("已恢复为模板默认设置。");
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "workspace governance topology reset failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel tone="paper">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">团队分工</p>
          <h2 className="mt-2 font-display text-3xl font-bold">配置团队角色和接力顺序</h2>
        </div>
        <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
          {valueOrPlaceholder(workspace.governance.templateId, "blank-custom")}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
        在这里调整团队模板、角色名称、默认 Agent 和交接方式。
      </p>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <FactTile label="Template" value={valueOrPlaceholder(workspace.governance.label, "未命名治理链")} />
        <FactTile label="已配置角色" value={String(lanes.length)} testID="settings-governance-topology-count" />
        <FactTile
          label="当前顺序"
          value={lanes.length > 0 ? lanes.map((lane) => lane.label || lane.id).join(" -> ") : "未声明"}
          testID="settings-governance-route-preview"
        />
        <FactTile
          label="交接方式"
          value={deliveryDelegationModeLabel(deliveryDelegationMode)}
          testID="settings-governance-delivery-policy"
        />
      </div>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4 rounded-[24px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
        <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">交接方式</p>
              <p className="mt-1 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                选择任务完成后如何继续交接，或者是否自动收尾。
              </p>
            </div>
            <span className="rounded-full border border-[var(--shock-ink)] bg-white px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em]">
              {deliveryDelegationModeLabel(deliveryDelegationMode)}
            </span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {DELIVERY_DELEGATION_MODE_OPTIONS.map((option) => (
              <PolicyButton
                key={option.mode}
                active={deliveryDelegationMode === option.mode}
                onClick={() => {
                  setDeliveryDelegationMode(option.mode);
                  setDirty(true);
                }}
                value={option.value}
                label={option.label}
                testID={`settings-governance-delivery-mode-${option.mode}`}
              />
            ))}
          </div>
        </div>
        <div className="space-y-3">
          {lanes.map((lane, index) => (
            <div
              key={`${lane.id || "lane"}-${index}`}
              data-testid={`settings-governance-lane-row-${index}`}
              className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">角色 {index + 1}</p>
                  <p className="mt-1 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">可以调整名称、职责、默认 Agent 和显示顺序。</p>
                </div>
                <button
                  type="button"
                  data-testid={`settings-governance-remove-lane-${index}`}
                  onClick={() => removeLane(index)}
                  disabled={pending || !canManage || lanes.length <= 2}
                  className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  删除角色
                </button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <label className="grid gap-2 text-sm">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em]">ID</span>
                  <input
                    data-testid={`settings-governance-lane-id-${index}`}
                    value={lane.id}
                    onChange={(event) => updateLane(index, { id: event.target.value })}
                    className="rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3"
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em]">名称</span>
                  <input
                    data-testid={`settings-governance-lane-label-${index}`}
                    value={lane.label}
                    onChange={(event) => updateLane(index, { label: event.target.value })}
                    className="rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3"
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em]">职责</span>
                  <input
                    data-testid={`settings-governance-lane-role-${index}`}
                    value={lane.role}
                    onChange={(event) => updateLane(index, { role: event.target.value })}
                    className="rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3"
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em]">默认 Agent</span>
                  <input
                    data-testid={`settings-governance-lane-default-agent-${index}`}
                    value={lane.defaultAgent ?? ""}
                    onChange={(event) => updateLane(index, { defaultAgent: event.target.value })}
                    className="rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3"
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em]">路径</span>
                  <input
                    data-testid={`settings-governance-lane-path-${index}`}
                    value={lane.lane ?? ""}
                    onChange={(event) => updateLane(index, { lane: event.target.value })}
                    className="rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3"
                  />
                </label>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
            修改后会同步到 Setup、交接和 Agent 页面。
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              data-testid="settings-governance-add-lane"
              onClick={addLane}
              disabled={pending || !canManage}
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:opacity-60"
            >
              添加角色
            </button>
            <button
              type="button"
              data-testid="settings-governance-reset-template"
              onClick={() => {
                void handleResetTemplate();
              }}
              disabled={pending || !canManage}
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:opacity-60"
            >
              恢复模板
            </button>
            <button
              type="submit"
              data-testid="settings-governance-save"
              disabled={pending || !canManage}
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "保存中..." : "保存团队设置"}
            </button>
          </div>
        </div>

        {!canManage ? (
          <p className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 text-sm">
            当前账号没有 `workspace.manage` 权限，所以这里只能查看、不能写回。
          </p>
        ) : null}
        {error ? (
          <p data-testid="settings-governance-error" className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 text-sm text-white">
            {error}
          </p>
        ) : null}
        {success ? (
          <p data-testid="settings-governance-success" className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-4 py-3 text-sm">
            {success}
          </p>
        ) : null}
      </form>
    </Panel>
  );
}

function MemberPreferencePanel() {
  const { state, updateWorkspaceMemberPreferences } = usePhaseZeroState();
  const member = findSettingsMember(state.auth.session.memberId, state.auth.members);
  const [preferredAgentId, setPreferredAgentId] = useState("");
  const [startRoute, setStartRoute] = useState("/chat/all");
  const [githubHandle, setGitHubHandle] = useState("");
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!member || dirty) {
      return;
    }
    setPreferredAgentId(member.preferences.preferredAgentId ?? "");
    setStartRoute(member.preferences.startRoute ?? "/chat/all");
    setGitHubHandle(member.githubIdentity?.handle ?? "");
  }, [dirty, member]);

  if (!member) {
    return (
      <Panel tone="paper">
        <p className="font-display text-3xl font-bold">当前没有可写的成员真值</p>
        <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">先建立 active session，再写回 preferred agent / github identity / start route。</p>
      </Panel>
    );
  }
  const currentMember = member;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      await updateWorkspaceMemberPreferences(currentMember.id, {
        preferredAgentId,
        startRoute,
        githubHandle,
      });
      setDirty(false);
      setSuccess("member preference truth 已写回 server，换设备后会继续读到同一份对象。");
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "member preference update failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel tone="paper">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">member durable truth</p>
          <h2 className="mt-2 font-display text-3xl font-bold">把 preferred agent / start route / github identity 绑回当前成员</h2>
        </div>
        <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
          {currentMember.email}
        </span>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <FactTile
          label="Preferred Agent"
          value={agentLabel(currentMember.preferences.preferredAgentId, state.agents)}
          testID="settings-member-preferred-agent-value"
        />
        <p className="hidden" data-testid="settings-member-preferred-agent-text">{agentLabel(currentMember.preferences.preferredAgentId, state.agents)}</p>
        <FactTile label="Start Route" value={valueOrPlaceholder(currentMember.preferences.startRoute, "未声明")} testID="settings-member-start-route-value" />
        <p className="hidden" data-testid="settings-member-start-route-text">{valueOrPlaceholder(currentMember.preferences.startRoute, "未声明")}</p>
        <FactTile label="GitHub" value={valueOrPlaceholder(currentMember.githubIdentity?.handle, "未绑定")} testID="settings-member-github-handle-value" />
        <p className="hidden" data-testid="settings-member-github-handle-text">{valueOrPlaceholder(currentMember.githubIdentity?.handle, "未绑定")}</p>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 grid gap-3 rounded-[24px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="grid gap-2 text-sm">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">preferred agent</span>
            <select
              data-testid="settings-member-preferred-agent"
              value={preferredAgentId}
              onChange={(event) => {
                setPreferredAgentId(event.target.value);
                setDirty(true);
              }}
              className="rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3"
            >
              <option value="">未绑定</option>
              {state.agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">start route</span>
            <select
              data-testid="settings-member-start-route"
              value={startRoute}
              onChange={(event) => {
                setStartRoute(event.target.value);
                setDirty(true);
              }}
              className="rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3"
            >
              {START_ROUTE_OPTIONS.map((route) => (
                <option key={route} value={route}>
                  {route}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">github handle</span>
            <input
              data-testid="settings-member-github-handle"
              value={githubHandle}
              onChange={(event) => {
                setGitHubHandle(event.target.value);
                setDirty(true);
              }}
              className="rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3"
            />
          </label>
        </div>

        <div className="flex justify-end">
          <button
            data-testid="settings-member-save"
            type="submit"
            disabled={pending}
            className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "写回中..." : "写回 Member Truth"}
          </button>
        </div>

        {error ? (
          <p data-testid="settings-member-error" className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 text-sm text-white">
            {error}
          </p>
        ) : null}
        {success ? (
          <p data-testid="settings-member-success" className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-4 py-3 text-sm">
            {success}
          </p>
        ) : null}
      </form>
    </Panel>
  );
}

function CredentialProfileCard({
  profile,
  state,
  canEdit,
  onUpdate,
}: {
  profile: CredentialProfile;
  state: PhaseZeroState;
  canEdit: boolean;
  onUpdate: (credentialId: string, input: {
    label: string;
    summary: string;
    secretKind: string;
    secretValue: string;
    workspaceDefault: boolean;
  }) => Promise<void>;
}) {
  const [label, setLabel] = useState(profile.label);
  const [summary, setSummary] = useState(profile.summary);
  const [secretKind, setSecretKind] = useState(profile.secretKind);
  const [secretValue, setSecretValue] = useState("");
  const [workspaceDefault, setWorkspaceDefault] = useState(profile.workspaceDefault);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (dirty) {
      return;
    }
    setLabel(profile.label);
    setSummary(profile.summary);
    setSecretKind(profile.secretKind);
    setSecretValue("");
    setWorkspaceDefault(profile.workspaceDefault);
  }, [dirty, profile]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      await onUpdate(profile.id, {
        label,
        summary,
        secretKind,
        secretValue,
        workspaceDefault,
      });
      setDirty(false);
      setSecretValue("");
      setSuccess(secretValue.trim() ? "credential metadata 与 rotated secret 已写回。" : "credential metadata 已写回。");
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "credential profile update failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel tone="paper" className="shadow-[6px_6px_0_0_var(--shock-yellow)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">{profile.secretKind}</p>
          <h3 className="mt-2 font-display text-2xl font-bold">{profile.label}</h3>
        </div>
        <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
          {credentialStatusLabel(profile.secretStatus)}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <FactTile label="Scope" value={profile.workspaceDefault ? "workspace default" : "scoped only"} testID={`settings-credential-workspace-default-${profile.id}`} />
        <FactTile label="Bindings" value={credentialUsageSummary(profile, state)} testID={`settings-credential-usage-${profile.id}`} />
        <FactTile label="Rotated" value={valueOrPlaceholder(formatTimestamp(profile.lastRotatedAt), "尚未写入")} />
        <FactTile label="Last Used" value={valueOrPlaceholder(formatTimestamp(profile.lastUsedAt), "尚未消费")} />
      </div>

      <p className="mt-4 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">
        {valueOrPlaceholder(profile.summary, "当前 credential 还没补完整摘要。")} 当前只暴露 metadata；secret plaintext 不会回到 `/v1/state`。
      </p>

      <form onSubmit={handleSubmit} className="mt-4 grid gap-3 rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-2 text-sm">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">label</span>
            <input
              data-testid={`settings-credential-label-${profile.id}`}
              value={label}
              onChange={(event) => {
                setLabel(event.target.value);
                setDirty(true);
              }}
              disabled={!canEdit || pending}
              className="rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3"
            />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">secret kind</span>
            <input
              data-testid={`settings-credential-secret-kind-${profile.id}`}
              value={secretKind}
              onChange={(event) => {
                setSecretKind(event.target.value);
                setDirty(true);
              }}
              disabled={!canEdit || pending}
              className="rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3"
            />
          </label>
          <label className="grid gap-2 text-sm md:col-span-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">summary</span>
            <textarea
              value={summary}
              onChange={(event) => {
                setSummary(event.target.value);
                setDirty(true);
              }}
              disabled={!canEdit || pending}
              className="min-h-[84px] rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3"
            />
          </label>
          <label className="grid gap-2 text-sm md:col-span-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">rotate secret</span>
            <textarea
              data-testid={`settings-credential-rotate-secret-${profile.id}`}
              value={secretValue}
              onChange={(event) => {
                setSecretValue(event.target.value);
                setDirty(true);
              }}
              disabled={!canEdit || pending}
              placeholder="留空表示只改 metadata；填写则触发 secret rotate。"
              className="min-h-[84px] rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3 font-mono text-sm"
            />
          </label>
        </div>

        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={workspaceDefault}
            onChange={(event) => {
              setWorkspaceDefault(event.target.checked);
              setDirty(true);
            }}
            disabled={!canEdit || pending}
          />
          <span>设为 workspace default，让所有 run 至少继承这条 credential。</span>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            data-testid={`settings-credential-save-${profile.id}`}
            disabled={!canEdit || pending}
            className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "写回中..." : "更新 Credential"}
          </button>
          {success ? <span className="text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">{success}</span> : null}
          {error ? <span className="text-sm leading-6 text-[color:rgba(163,37,28,0.92)]">{error}</span> : null}
        </div>
      </form>
    </Panel>
  );
}

function CredentialProfilesPanel() {
  const { state, createCredentialProfile, updateCredentialProfile } = usePhaseZeroState();
  const canEdit = hasWorkspaceManagePermission(state);
  const [label, setLabel] = useState("");
  const [summary, setSummary] = useState("");
  const [secretKind, setSecretKind] = useState("api-token");
  const [secretValue, setSecretValue] = useState("");
  const [workspaceDefault, setWorkspaceDefault] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      await createCredentialProfile({
        label,
        summary,
        secretKind,
        secretValue,
        workspaceDefault,
      });
      setLabel("");
      setSummary("");
      setSecretKind("api-token");
      setSecretValue("");
      setWorkspaceDefault(false);
      setSuccess("新 credential profile 已加密落库，并同步到 workspace / agent / run surfaces。");
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "credential profile create failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <Panel tone="ink" className="shadow-[6px_6px_0_0_var(--shock-lime)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/72">credential profile / encrypted vault</p>
            <h2 className="mt-2 font-display text-3xl font-bold">把 secret 从隐性环境依赖拉回可审计的 workspace truth</h2>
          </div>
          <span className="rounded-full border-2 border-white/70 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
            {state.credentials.length} profiles
          </span>
        </div>
        <p className="mt-3 text-sm leading-6 text-white/80">
          `#153` 当前只把 secret metadata 暴露到 settings / profile / run surfaces；payload 单独进 encrypted vault，不会经由 `/v1/state`、SSR 或 browser report 泄漏。
        </p>
      </Panel>

      <Panel tone="yellow">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">new credential profile</p>
            <h3 className="mt-2 font-display text-3xl font-bold">新增一个可绑定到 workspace / agent / run 的 secret 轮廓</h3>
          </div>
          <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
            {canEdit ? "workspace.manage" : "read only"}
          </span>
        </div>

        <form onSubmit={handleCreate} className="mt-5 grid gap-3 rounded-[24px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em]">label</span>
              <input
                data-testid="settings-credential-create-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                disabled={!canEdit || pending}
                className="rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em]">secret kind</span>
              <input
                data-testid="settings-credential-create-secret-kind"
                value={secretKind}
                onChange={(event) => setSecretKind(event.target.value)}
                disabled={!canEdit || pending}
                className="rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3"
              />
            </label>
            <label className="grid gap-2 text-sm md:col-span-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em]">summary</span>
              <textarea
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                disabled={!canEdit || pending}
                className="min-h-[84px] rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3"
              />
            </label>
            <label className="grid gap-2 text-sm md:col-span-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em]">secret value</span>
              <textarea
                data-testid="settings-credential-create-secret"
                value={secretValue}
                onChange={(event) => setSecretValue(event.target.value)}
                disabled={!canEdit || pending}
                className="min-h-[96px] rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3 font-mono text-sm"
              />
            </label>
          </div>

          <label className="flex items-center gap-3 text-sm">
            <input
              data-testid="settings-credential-create-workspace-default"
              type="checkbox"
              checked={workspaceDefault}
              onChange={(event) => setWorkspaceDefault(event.target.checked)}
              disabled={!canEdit || pending}
            />
            <span>创建后立即作为 workspace default 生效。</span>
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button
              data-testid="settings-credential-create-save"
              type="submit"
              disabled={!canEdit || pending}
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "加密写入中..." : "Create Credential"}
            </button>
            {success ? <span className="text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">{success}</span> : null}
            {error ? <span className="text-sm leading-6 text-[color:rgba(163,37,28,0.92)]">{error}</span> : null}
          </div>
        </form>
      </Panel>

      {state.credentials.length === 0 ? (
        <EmptyState title="还没有 credential profile" message="先在这里创建第一条 encrypted secret，再去 Agent Profile 和 Run Detail 绑定实际作用域。" />
      ) : (
        state.credentials.map((profile) => (
          <CredentialProfileCard
            key={profile.id}
            profile={profile}
            state={state}
            canEdit={canEdit}
            onUpdate={async (credentialId, input) => {
              await updateCredentialProfile(credentialId, input);
            }}
          />
        ))
      )}
    </div>
  );
}

function SettingsDisclosureSection({
  title,
  summary,
  testId,
  tone = "white",
  defaultOpen = false,
  children,
}: {
  title: string;
  summary: string;
  testId: string;
  tone?: "white" | "paper" | "yellow" | "lime" | "ink" | "pink";
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Panel tone={tone}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Advanced</p>
          <h2 className="mt-3 font-display text-3xl font-bold">{title}</h2>
          <p className="mt-3 text-sm leading-6 opacity-80">{summary}</p>
        </div>
        <button
          type="button"
          data-testid={`settings-advanced-${testId}-toggle`}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className={cn(
            "rounded-2xl border-2 border-[var(--shock-ink)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] shadow-[var(--shock-shadow-sm)]",
            tone === "ink" ? "bg-white text-[var(--shock-ink)]" : "bg-[var(--shock-yellow)] text-[var(--shock-ink)]"
          )}
        >
          {open ? "收起高级配置" : "展开高级配置"}
        </button>
      </div>
      {open ? <div data-testid={`settings-advanced-${testId}-content`} className="mt-5 space-y-4">{children}</div> : null}
    </Panel>
  );
}

function LiveSettingsView({ notifications }: { notifications: LiveNotificationsModel }) {
  const { center, loading: notificationLoading, error: notificationError } = notifications;
  const { state, error: stateError } = usePhaseZeroState();
  const {
    preference,
    setPreference,
    surface,
    requestPermission,
    registerBrowserSurface,
    sendTestNotification,
    showDeliveredNotifications,
    subscriberLabel,
    subscriberTarget,
  } = useBrowserNotificationSurface();
  const [browserPolicyDraft, setBrowserPolicyDraft] = useState<WorkspaceNotificationPolicy>("critical");
  const [emailPolicyDraft, setEmailPolicyDraft] = useState<WorkspaceNotificationPolicy>("critical");
  const [policyDirty, setPolicyDirty] = useState(false);
  const [emailTargetDraft, setEmailTargetDraft] = useState("");
  const [emailPreferenceDraft, setEmailPreferenceDraft] = useState<NotificationPreference>("critical");
  const [emailDirty, setEmailDirty] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const browserSubscriber = useMemo(() => findCurrentBrowserSubscriber(center, subscriberTarget), [center, subscriberTarget]);
  const fallbackEmail = state.auth.session.email || state.auth.members.find((member) => member.role === "owner")?.email || "ops@openshock.dev";
  const emailSubscriber = useMemo(() => findPrimaryEmailSubscriber(center, fallbackEmail), [center, fallbackEmail]);
  const routedSignals = useMemo(
    () => [...center.approvalCenter.signals, ...center.approvalCenter.recent],
    [center.approvalCenter.recent, center.approvalCenter.signals]
  );
  const identitySignals = useMemo(
    () => routedSignals.filter((signal) => isIdentityTemplate(signal.templateId)),
    [routedSignals]
  );
  const identityDeliveries = useMemo(
    () => center.deliveries.filter((delivery) => isIdentityTemplate(delivery.templateId)),
    [center.deliveries]
  );

  useEffect(() => {
    if (!policyDirty) {
      setBrowserPolicyDraft(center.policy.browserPush);
      setEmailPolicyDraft(center.policy.email);
    }
  }, [center.policy, policyDirty]);

  useEffect(() => {
    if (!emailDirty) {
      setEmailTargetDraft(emailSubscriber?.target || fallbackEmail);
      setEmailPreferenceDraft(emailSubscriber?.preference || "critical");
    }
  }, [emailDirty, emailSubscriber, fallbackEmail]);

  useEffect(() => {
    if (browserSubscriber?.preference && browserSubscriber.preference !== preference) {
      setPreference(browserSubscriber.preference);
    }
  }, [browserSubscriber?.preference, preference, setPreference]);

  const readyDeliveries = center.deliveries.filter((delivery) => delivery.status === "ready").length;
  const suppressedDeliveries = center.deliveries.filter((delivery) => delivery.status === "suppressed").length;
  const browserDeliveryCount = center.deliveries.filter((delivery) => delivery.channel === "browser_push" && delivery.status === "ready").length;
  const emailDeliveryCount = center.deliveries.filter((delivery) => delivery.channel === "email" && delivery.status === "ready").length;
  const workerReceipts = useMemo(() => center.worker.receipts ?? [], [center.worker.receipts]);
  const identityReceipts = useMemo(
    () => workerReceipts.filter((receipt) => isIdentityTemplate(receipt.templateId)),
    [workerReceipts]
  );
  const identityTemplateSummaries = useMemo(
    () => buildIdentityTemplateSummaries(identitySignals, identityDeliveries, identityReceipts),
    [identityDeliveries, identityReceipts, identitySignals]
  );
  const browserSubscriberState = browserSubscriber?.status ?? currentBrowserSubscriberStatus(surface);
  const workerSummary = center.worker.ranAt
    ? `${center.worker.delivered}/${center.worker.attempted} sent · ${center.worker.failed} failed`
    : "尚未执行";
  const identityWorkerSummary = identityReceipts.length
    ? `${identityReceipts.filter((receipt) => receipt.status === "sent").length}/${identityReceipts.length} sent`
    : "尚未执行";

  async function runAction(action: string, runner: () => Promise<void>) {
    setBusyAction(action);
    try {
      await runner();
    } catch (currentError) {
      setActionMessage(currentError instanceof Error ? currentError.message : "通知动作失败");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSaveWorkspacePolicy() {
    await runAction("save-policy", async () => {
      await notifications.updatePolicy({
        browserPush: browserPolicyDraft,
        email: emailPolicyDraft,
      });
      setPolicyDirty(false);
      setActionMessage("工作区 browser push / email 默认策略已写回 server。");
    });
  }

  async function handleConnectBrowserSubscriber() {
    await runAction("connect-browser", async () => {
      const payload = await notifications.upsertSubscriber({
        id: browserSubscriber?.id,
        channel: "browser_push",
        target: subscriberTarget,
        label: subscriberLabel,
        preference,
        status: currentBrowserSubscriberStatus(surface),
        source: "browser-registration",
      });
      const nextSubscriber =
        payload.notifications.subscribers.find((subscriber) => subscriber.id === payload.subscriber.id) ?? payload.subscriber;
      setActionMessage(
        `当前浏览器 subscriber 已同步：${subscriberStatusLabel(nextSubscriber.status)} · ${preferenceLabel(nextSubscriber.effectivePreference)}。`
      );
    });
  }

  async function handleSaveEmailSubscriber() {
    await runAction("save-email", async () => {
      const payload = await notifications.upsertSubscriber({
        id: emailSubscriber?.id,
        channel: "email",
        target: emailTargetDraft.trim(),
        label: state.auth.session.email && emailTargetDraft.trim() === state.auth.session.email ? "Current Session Email" : "Workspace Email",
        preference: emailPreferenceDraft,
        status: "ready",
        source: "workspace-email",
      });
      setEmailDirty(false);
      setActionMessage(
        `邮箱 subscriber 已同步：${payload.subscriber.target} · ${preferenceLabel(payload.subscriber.effectivePreference)}。`
      );
    });
  }

  async function handleDispatchFanout() {
    await runAction("fanout", async () => {
      const payload = await notifications.dispatchFanout();
      const latestBrowserSubscriber = findCurrentBrowserSubscriber(payload.notifications, subscriberTarget);
      const shown = await showDeliveredNotifications(
        payload.worker.receipts,
        payload.notifications.deliveries,
        latestBrowserSubscriber?.id
      );
      setActionMessage(
        shown > 0
          ? `fanout 已执行：${payload.worker.delivered}/${payload.worker.attempted} sent，并在当前浏览器展示 ${shown} 条通知。`
          : `fanout 已执行：${payload.worker.delivered}/${payload.worker.attempted} sent，失败 ${payload.worker.failed}。`
      );
    });
  }

  return (
    <div className="space-y-4">
      {notificationError ? (
        <Panel tone="pink">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Notification Contract Failed</p>
          <p className="mt-3 text-base leading-7">当前 `/v1/notifications` 拉取失败：{notificationError}</p>
        </Panel>
      ) : null}

      {stateError ? (
        <Panel tone="pink">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">State Sync Failed</p>
          <p className="mt-3 text-base leading-7">通知面还能继续改 policy / subscriber，但 `/v1/state` 当前拉取失败：{stateError}</p>
        </Panel>
      ) : null}

      <WorkspacePlanObservabilityPanel />
      <Panel tone="paper">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Core Settings</p>
        <h2 className="mt-3 font-display text-4xl font-bold">先把 workspace 和当前成员的高频配置收在眼前</h2>
        <p className="mt-3 max-w-3xl text-base leading-7">
          这一页默认只直出 plan / quota、onboarding / sandbox、preferred agent / start route。
          治理拓扑、凭据与通知投递继续保留，但收进高级区，避免第一次进入就像 admin console。
        </p>
      </Panel>

      <WorkspaceDurableConfigPanel />
      <MemberPreferencePanel />

      <SettingsDisclosureSection
        title="Governance Topology"
        summary="团队 lane、delivery delegation policy 和跨页治理回放仍保留完整能力，但默认不抢占日常配置入口。"
        testId="governance"
        tone="paper"
      >
        <GovernanceTopologyPanel />
      </SettingsDisclosureSection>

      <SettingsDisclosureSection
        title="Credential Profiles"
        summary="运行时 secret / scope / default profile 继续保留在这里，但默认折叠，避免把所有人都带进高风险配置面。"
        testId="credentials"
      >
        <CredentialProfilesPanel />
      </SettingsDisclosureSection>

      <SettingsDisclosureSection
        title="Notifications And Delivery"
        summary="browser push、email subscriber、identity template chain 和 latest receipts 仍然完整保留，只是不再默认把整页变成通知工作台。"
        testId="notifications"
        tone="yellow"
      >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_0.92fr]">
        <Panel tone="yellow">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Notification Sidecar</p>
          <h2 className="mt-3 font-display text-4xl font-bold">通知策略继续作为 durable config 的旁路能力存在</h2>
          <p className="mt-3 max-w-3xl text-base leading-7">
            `#126` 把 workspace/member durable truth 拉回当前页之后，通知策略仍继续直接消费 `/v1/notifications`。它现在是 config contract 的一部分，但不再是假装代表整页主语义。
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <FactTile label="Subscribers" value={notificationLoading ? "同步中" : String(center.subscribers.length)} testID="notification-subscribers-count" />
            <FactTile label="Ready Deliveries" value={notificationLoading ? "同步中" : String(readyDeliveries)} testID="notification-delivery-ready-count" />
            <FactTile label="Suppressed" value={notificationLoading ? "同步中" : String(suppressedDeliveries)} testID="notification-delivery-suppressed-count" />
            <FactTile label="Worker" value={notificationLoading ? "同步中" : workerSummary} testID="notification-worker-summary" />
          </div>
        </Panel>

        <Panel tone="ink" className="shadow-[6px_6px_0_0_var(--shock-pink)]">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Current Split</p>
          <h2 className="mt-3 font-display text-3xl font-bold">默认策略、当前浏览器与 fanout 最新真值</h2>
          <div className="mt-4 space-y-3 text-sm leading-6 text-white/82">
            <p>browser push / email 默认值已经不再只是静态文案，而是 server policy。</p>
            <p>fanout 最近一拍的 attempted / delivered / failed 与 explicit receipts 也都直接从 contract surface 读取。</p>
          </div>
          <div className="mt-5 grid gap-3">
            <StatusRow label="Workspace Browser Push" value={preferenceLabel(center.policy.browserPush)} tone="white" testID="notification-workspace-browser-policy" />
            <StatusRow label="Workspace Email" value={preferenceLabel(center.policy.email)} tone="yellow" testID="notification-workspace-email-policy" />
            <StatusRow label="Current Browser" value={`${subscriberStatusLabel(browserSubscriberState)} · ${preferenceLabel(browserSubscriber?.effectivePreference || preference)}`} tone="lime" testID="notification-current-browser-subscriber" />
            <StatusRow label="Last Fanout" value={`${workerSummary} · ${formatTimestamp(center.worker.ranAt)}`} tone={center.worker.failed > 0 ? "pink" : center.worker.delivered > 0 ? "lime" : "white"} testID="notification-last-fanout" />
          </div>
        </Panel>
      </div>

      <Panel tone="ink" className="shadow-[6px_6px_0_0_var(--shock-yellow)]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Identity Template Chain</p>
            <h2 className="mt-3 font-display text-3xl font-bold">invite / verify / reset / blocked recovery 现在走同一套通知模板</h2>
          </div>
          <Link
            href="/access"
            className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--shock-ink)]"
          >
            打开 Access
          </Link>
        </div>
        <p className="mt-3 max-w-4xl text-sm leading-6 text-white/84">
          身份恢复链不再停在 auth mutation 自己的局部成功。当前 `/v1/notifications` 会把 invite、邮箱验证、密码重置和跨设备 blocked
          escalation 一起折进同一条 template / delivery truth，并把最新 fanout 回写到这里。
        </p>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <FactTile label="Templates" value={String(identityTemplateSummaries.length)} testID="notification-identity-template-count" />
          <FactTile label="Signals" value={String(identitySignals.length)} testID="notification-identity-signal-count" />
          <FactTile label="Ready Deliveries" value={String(identityDeliveries.filter((delivery) => delivery.status === "ready").length)} testID="notification-identity-ready-count" />
          <FactTile label="Latest Fanout" value={identityWorkerSummary} testID="notification-identity-worker-summary" />
        </div>
        <div className="mt-5 space-y-3">
          {identityTemplateSummaries.length === 0 ? (
            <EmptyState
              title="当前没有 identity template signal"
              message="先在 /access 触发 invite、邮箱验证、密码重置或跨设备恢复阻塞，再回这里看统一 delivery truth。"
            />
          ) : (
            identityTemplateSummaries.map((template) => (
              <article
                key={template.id}
                data-testid={`notification-identity-template-${template.id}`}
                className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4 text-[var(--shock-ink)] shadow-[4px_4px_0_0_var(--shock-ink)]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
                    {template.label}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">{template.id}</span>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <StatusRow label="Signals" value={String(template.signalCount)} tone="white" />
                  <StatusRow label="Ready" value={String(template.readyCount)} tone={template.readyCount > 0 ? "lime" : "white"} />
                  <StatusRow label="Blocked" value={String(template.blockedCount)} tone={template.blockedCount > 0 ? "pink" : "white"} />
                  <StatusRow label="Last Worker Result" value={template.lastStatus} tone={template.lastStatus === "已送达" ? "lime" : template.lastStatus === "发送失败" ? "pink" : "yellow"} />
                </div>
                <p className="mt-4 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                  latest worker attempt: {formatTimestamp(template.lastAttempt)}
                </p>
              </article>
            ))
          )}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_1fr]">
        <Panel tone="paper">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Workspace Defaults</p>
          <h3 className="mt-3 font-display text-3xl font-bold">通知默认策略</h3>
          <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
            browser push 与 email 的默认偏好现在都会写回 server。subscriber 若仍为 `inherit`，这里就是它们的真实 effective preference。
          </p>
          <div className="mt-5 space-y-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Browser Push</p>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {WORKSPACE_POLICY_OPTIONS.map((option) => (
                  <PolicyButton
                    key={`browser-${option}`}
                    active={browserPolicyDraft === option}
                    onClick={() => {
                      setBrowserPolicyDraft(option);
                      setPolicyDirty(true);
                    }}
                    value={option}
                    label={preferenceLabel(option)}
                    testID={`notification-browser-policy-${option}`}
                  />
                ))}
              </div>
            </div>

            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Email</p>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {WORKSPACE_POLICY_OPTIONS.map((option) => (
                  <PolicyButton
                    key={`email-${option}`}
                    active={emailPolicyDraft === option}
                    onClick={() => {
                      setEmailPolicyDraft(option);
                      setPolicyDirty(true);
                    }}
                    value={option}
                    label={preferenceLabel(option)}
                    testID={`notification-email-policy-${option}`}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              data-testid="notification-save-policy"
              disabled={busyAction !== null || !policyDirty}
              onClick={() => void handleSaveWorkspacePolicy()}
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
            >
              {busyAction === "save-policy" ? "写入中..." : "保存默认值"}
            </button>
            <StatusRow label="Policy Updated At" value={formatTimestamp(center.policy.updatedAt)} tone="white" />
          </div>
        </Panel>

        <Panel tone="lime">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Current Browser</p>
          <h3 className="mt-3 font-display text-3xl font-bold">把当前浏览器接进 subscriber contract</h3>
          <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
            这里不再停在 permission / registration 展示层。当前浏览器现在有稳定 subscriber target，可接入 fanout，并把 sent receipts 直接显示成本地通知。
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <StatusRow label="Permission" value={permissionLabel(surface.permission)} tone={surface.permission === "granted" ? "lime" : surface.permission === "denied" ? "pink" : "white"} testID="notification-browser-permission" />
            <StatusRow label="Registration" value={surface.registrationScope ? `${registrationLabel(surface.registrationState)} · ${surface.registrationScope}` : registrationLabel(surface.registrationState)} tone={surface.registrationState === "ready" ? "lime" : surface.registrationState === "error" || surface.registrationState === "blocked" ? "pink" : "white"} testID="notification-browser-registration" />
            <StatusRow label="Subscriber Target" value={subscriberTarget} tone="white" testID="notification-browser-target" />
            <StatusRow label="Subscriber Status" value={subscriberStatusLabel(browserSubscriberState)} tone={toneForSubscriberStatus(browserSubscriberState)} testID="notification-browser-subscriber-status" />
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {SUBSCRIBER_PREFERENCE_OPTIONS.map((option) => (
              <PolicyButton
                key={`browser-preference-${option}`}
                active={preference === option}
                onClick={() => setPreference(option)}
                value={option}
                label={preferenceLabel(option)}
                testID={`notification-browser-preference-${option}`}
              />
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              data-testid="notification-request-permission"
              disabled={busyAction !== null || surface.permission === "denied" || !surface.supported}
              onClick={() =>
                void runAction("permission", async () => {
                  await requestPermission();
                  setActionMessage("浏览器通知权限状态已刷新。");
                })
              }
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
            >
              {busyAction === "permission" ? "请求中..." : "请求权限"}
            </button>
            <button
              type="button"
              data-testid="notification-register-browser"
              disabled={busyAction !== null || !surface.serviceWorkerSupported || !surface.secureContext}
              onClick={() =>
                void runAction("register", async () => {
                  await registerBrowserSurface();
                  setActionMessage("当前浏览器 service worker 已注册。");
                })
              }
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
            >
              {busyAction === "register" ? "注册中..." : "注册接收面"}
            </button>
            <button
              type="button"
              data-testid="notification-connect-browser"
              disabled={busyAction !== null}
              onClick={() => void handleConnectBrowserSubscriber()}
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
            >
              {busyAction === "connect-browser" ? "同步中..." : "同步当前浏览器"}
            </button>
            <button
              type="button"
              data-testid="notification-local-smoke"
              disabled={busyAction !== null || surface.permission !== "granted"}
              onClick={() =>
                void runAction("browser-smoke", async () => {
                  await sendTestNotification();
                  setActionMessage("本地 smoke notification 已发出。");
                })
              }
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
            >
              {busyAction === "browser-smoke" ? "发送中..." : "本地 smoke"}
            </button>
          </div>
          {surface.registrationError ? <p className="mt-4 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">{surface.registrationError}</p> : null}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.96fr)_1.04fr]">
        <Panel tone="white">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Email Delivery</p>
          <h3 className="mt-3 font-display text-3xl font-bold">邮箱订阅者与 retry contract</h3>
          <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
            这里直接写入 email subscriber。invalid target 会显式失败，修正后可在同一 contract 面上看到 retry 转绿。
          </p>
          <label className="mt-5 block">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Email Target</span>
            <input
              data-testid="notification-email-target-input"
              value={emailTargetDraft}
              onChange={(event) => {
                setEmailTargetDraft(event.target.value);
                setEmailDirty(true);
              }}
              className="mt-3 w-full rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3 text-sm outline-none"
              placeholder="ops@openshock.dev"
            />
          </label>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {SUBSCRIBER_PREFERENCE_OPTIONS.map((option) => (
              <PolicyButton
                key={`email-preference-${option}`}
                active={emailPreferenceDraft === option}
                onClick={() => {
                  setEmailPreferenceDraft(option);
                  setEmailDirty(true);
                }}
                value={option}
                label={preferenceLabel(option)}
                testID={`notification-email-preference-${option}`}
              />
            ))}
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <StatusRow label="Subscriber Status" value={emailSubscriber ? subscriberStatusLabel(emailSubscriber.status) : "未创建"} tone={emailSubscriber ? toneForSubscriberStatus(emailSubscriber.status) : "white"} testID="notification-email-subscriber-status" />
            <StatusRow label="Effective Preference" value={emailSubscriber ? preferenceLabel(emailSubscriber.effectivePreference) : preferenceLabel(emailPreferenceDraft)} tone="yellow" testID="notification-email-effective-preference" />
            <StatusRow label="Last Delivered" value={formatTimestamp(emailSubscriber?.lastDeliveredAt)} tone="white" testID="notification-email-last-delivered" />
            <StatusRow label="Last Error" value={emailSubscriber?.lastError || "无"} tone={emailSubscriber?.lastError ? "pink" : "lime"} testID="notification-email-last-error" />
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              data-testid="notification-save-email"
              disabled={busyAction !== null || !emailTargetDraft.trim()}
              onClick={() => void handleSaveEmailSubscriber()}
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
            >
              {busyAction === "save-email" ? "保存中..." : "保存邮箱订阅者"}
            </button>
            <button
              type="button"
              data-testid="notification-run-fanout"
              disabled={busyAction !== null}
              onClick={() => void handleDispatchFanout()}
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
            >
              {busyAction === "fanout" ? "发送中..." : "执行 fanout"}
            </button>
          </div>
        </Panel>

        <Panel tone="paper">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Subscriber Roster</p>
              <h3 className="mt-3 font-display text-3xl font-bold">谁会收到哪类通知</h3>
            </div>
            <span className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em]" data-testid="notification-roster-summary">
              browser {browserDeliveryCount} · email {emailDeliveryCount} ready
            </span>
          </div>
          <div className="mt-5 space-y-3">
            {notificationLoading ? (
              <EmptyState title="正在同步 subscriber truth" message="等待 `/v1/notifications` 返回 policy、subscribers、deliveries 与 worker last-run。" />
            ) : center.subscribers.length === 0 ? (
              <EmptyState title="当前还没有 subscriber" message="先接入当前浏览器或保存邮箱订阅者，再执行 fanout。" />
            ) : (
              center.subscribers.map((subscriber) => {
                const subscriberDeliveries = center.deliveries.filter((delivery) => delivery.subscriberId === subscriber.id);
                const readyForSubscriber = subscriberDeliveries.filter((delivery) => delivery.status === "ready").length;
                return (
                  <article
                    key={subscriber.id}
                    data-testid={`notification-subscriber-${subscriber.id}`}
                    className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4 shadow-[4px_4px_0_0_var(--shock-ink)]"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
                        {channelLabel(subscriber.channel)}
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">{subscriber.label}</span>
                    </div>
                    <p className="mt-3 break-all text-sm leading-6">{subscriber.target}</p>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <StatusRow label="Status" value={subscriberStatusLabel(subscriber.status)} tone={toneForSubscriberStatus(subscriber.status)} />
                      <StatusRow label="Effective Preference" value={preferenceLabel(subscriber.effectivePreference)} tone="yellow" />
                      <StatusRow label="Ready Deliveries" value={String(readyForSubscriber)} tone="lime" />
                      <StatusRow label="Last Delivered" value={formatTimestamp(subscriber.lastDeliveredAt)} tone="white" />
                    </div>
                    {subscriber.lastError ? (
                      <p className="mt-4 rounded-[16px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 text-sm leading-6 text-white">
                        last error: {subscriber.lastError}
                      </p>
                    ) : null}
                  </article>
                );
              })
            )}
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.04fr)_0.96fr]">
        <Panel tone="white">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Latest Receipts</p>
              <h3 className="mt-3 font-display text-3xl font-bold">fanout 最近一拍</h3>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <FactTile label="Attempted" value={String(center.worker.attempted)} testID="notification-worker-attempted" />
              <FactTile label="Delivered" value={String(center.worker.delivered)} testID="notification-worker-delivered" />
              <FactTile label="Failed" value={String(center.worker.failed)} testID="notification-worker-failed" />
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {workerReceipts.length === 0 ? (
              <EmptyState title="还没有 worker receipts" message="执行一次 fanout 后，这里会直接显示 sent / failed、payload path 和 retry 后的最新结果。" />
            ) : (
              workerReceipts.map((receipt) => {
                const delivery = center.deliveries.find((item) => item.id === receipt.deliveryId);
                const subscriber = center.subscribers.find((item) => item.id === receipt.subscriberId);
                return (
                  <article
                    key={receipt.id}
                    data-testid={`notification-receipt-${receipt.id}`}
                    className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4 shadow-[4px_4px_0_0_var(--shock-ink)]"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full border-2 border-[var(--shock-ink)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]",
                          toneForDeliveryStatus(receipt.status) === "lime" && "bg-[var(--shock-lime)]",
                          toneForDeliveryStatus(receipt.status) === "pink" && "bg-[var(--shock-pink)] text-white",
                          toneForDeliveryStatus(receipt.status) === "yellow" && "bg-[var(--shock-yellow)]",
                          toneForDeliveryStatus(receipt.status) === "white" && "bg-white"
                        )}
                      >
                        {deliveryStatusLabel(receipt.status)}
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">{channelLabel(receipt.channel)}</span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">{formatTimestamp(receipt.attemptedAt)}</span>
                    </div>
                    <h4 className="mt-3 font-display text-2xl font-bold">{delivery?.title || receipt.deliveryId}</h4>
                    <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">{delivery?.body || subscriber?.target || "通知 payload"}</p>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <StatusRow label="Subscriber" value={subscriber?.label || receipt.subscriberId} tone="white" />
                      <StatusRow label="Target" value={subscriber?.target || "n/a"} tone="white" />
                      <StatusRow label="Template" value={delivery?.templateLabel || receipt.templateLabel || "未命名模板"} tone="yellow" />
                      <StatusRow label="Signal" value={delivery?.signalKind || receipt.signalKind || receipt.inboxItemId} tone="yellow" />
                      <StatusRow label="Href" value={delivery?.href || receipt.href || "n/a"} tone="white" />
                    </div>
                    {receipt.payloadPath ? (
                      <p className="mt-4 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">payload: {receipt.payloadPath}</p>
                    ) : null}
                    {receipt.error ? (
                      <p className="mt-4 rounded-[16px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 text-sm leading-6 text-white">
                        error: {receipt.error}
                      </p>
                    ) : null}
                  </article>
                );
              })
            )}
          </div>
        </Panel>

        <Panel tone="paper">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Source Signals</p>
              <h3 className="mt-3 font-display text-3xl font-bold">当前会被路由的 signal truth</h3>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/inbox"
                className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em]"
              >
                打开 Inbox
              </Link>
              <Link
                href="/access"
                className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em]"
              >
                打开 Access
              </Link>
            </div>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <FactTile label="Approvals" value={String(center.approvalCenter.approvalCount)} />
            <FactTile label="Reviews" value={String(center.approvalCenter.reviewCount)} />
            <FactTile label="Blocks" value={String(center.approvalCenter.blockedCount)} />
          </div>
          <div className="mt-5 space-y-3">
            {routedSignals.length === 0 ? (
              <EmptyState title="当前没有待路由信号" message="这表示没有新的 approval / review / identity recovery signal 需要触达。" />
            ) : (
              routedSignals.map((item) => (
                <article
                  key={item.id}
                  className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4"
                  data-testid={`notification-source-${item.id}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full border-2 border-[var(--shock-ink)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]",
                        inboxKindTone(item.kind)
                      )}
                    >
                      {inboxKindLabel(item.kind)}
                    </span>
                    {item.templateLabel ? (
                      <span className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
                        {item.templateLabel}
                      </span>
                    ) : null}
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">{item.room}</span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">{item.time}</span>
                  </div>
                  <h4 className="mt-3 font-display text-2xl font-bold">{item.title}</h4>
                  <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">{item.summary}</p>
                </article>
              ))
            )}
          </div>
        </Panel>
      </div>

        {actionMessage ? (
          <Panel tone="yellow">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em]">最近操作</p>
            <p className="mt-3 text-base leading-7" data-testid="notification-action-message">
              {actionMessage}
            </p>
            <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
              这里会显示最近一次通知相关操作的结果。
            </p>
          </Panel>
        ) : null}
      </SettingsDisclosureSection>
    </div>
  );
}

export function LiveSettingsRoute() {
  const notifications = useLiveNotifications();

  return (
    <OpenShockShell
      view="settings"
      eyebrow="设置"
      title="工作区设置"
      description="先处理启动、仓库和常用偏好；更深的团队协作和通知配置收在后面。"
      contextTitle="设置概览"
      contextDescription="这里集中管理工作区额度、启动过程、默认入口和团队协作方式。"
      contextBody={<LiveSettingsContextRail notifications={notifications} />}
    >
      <LiveSettingsView notifications={notifications} />
    </OpenShockShell>
  );
}
