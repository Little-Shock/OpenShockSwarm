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
import {
  buildSettingsNotificationSummary,
  currentBrowserSubscriberStatus,
  deriveBrowserConnectReadiness,
} from "@/lib/settings-notification-ux";
import { START_ROUTE_OPTIONS, startRouteLabel } from "@/lib/start-route";
import { formatSandboxList, sandboxPolicyDraft, sandboxPolicySummary, sandboxProfileLabel } from "@/lib/sandbox-policy";
import { permissionBoundaryCopy } from "@/lib/session-authz";
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
      return "观察中";
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
  return `${quota.messageHistoryDays ?? 0} 天消息 / ${quota.runLogDays ?? 0} 天运行记录 / ${quota.memoryDraftDays ?? 0} 天草稿`;
}

function formatWorkspaceUsageWindow(usage?: { totalTokens?: number; windowLabel?: string }) {
  if (!usage) {
    return "未返回";
  }
  return `${formatCount(usage.totalTokens)} 令牌 / ${valueOrPlaceholder(usage.windowLabel, "时间范围未返回")}`;
}

const WORKSPACE_POLICY_OPTIONS: WorkspaceNotificationPolicy[] = ["critical", "all", "mute"];
const SUBSCRIBER_PREFERENCE_OPTIONS: NotificationPreference[] = ["inherit", "critical", "all", "mute"];
const ONBOARDING_STATUS_OPTIONS = [
  { value: "not_started", label: "未开始" },
  { value: "in_progress", label: "进行中" },
  { value: "ready", label: "待收口" },
  { value: "done", label: "已完成" },
] as const;
type GovernanceLaneDraft = WorkspaceGovernanceLaneConfig;
type SettingsRouteMode = "primary" | "advanced";

type DeliveryDelegationMode = "formal-handoff" | "signal-only" | "auto-complete";

const DELIVERY_DELEGATION_MODE_OPTIONS: Array<{
  mode: DeliveryDelegationMode;
  value: string;
  label: string;
}> = [
  {
    mode: "formal-handoff",
    value: "formal-handoff",
    label: "完成收尾后自动建交接，并放进交接箱和收件箱。",
  },
  {
    mode: "signal-only",
    value: "signal-only",
    label: "完成收尾后只发提醒，不自动建交接。",
  },
  {
    mode: "auto-complete",
    value: "auto-complete",
    label: "完成收尾后直接结束，不再额外建交接。",
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
      return "全部通知";
    case "critical":
      return "仅高优先级";
    case "mute":
      return "静默";
    default:
      return "继承工作区默认值";
  }
}

function channelLabel(channel: NotificationChannel) {
  return channel === "browser_push" ? "浏览器通知" : "邮件";
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

function workspacePairingStatusLabel(status?: string) {
  switch (status) {
    case "paired":
      return "已配对";
    case "degraded":
      return "配对降级";
    default:
      return "未配对";
  }
}

function memoryBenefitSummary(memoryMode?: string) {
  if (!memoryMode || !memoryMode.trim()) {
    return "未配置记忆模式，先到下方启动与安全补齐。";
  }
  return `${memoryMode}，后续任务可直接续上。`;
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
    return "仅提醒";
  }
  if (mode === "auto-complete") {
    return "自动结束";
  }
  return "创建交接";
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
  return `${profile.workspaceDefault ? "工作区默认" : "单独绑定"} · ${agentCount} 个智能体 · ${runCount} 次运行`;
}

function nextSettingsAction(state: PhaseZeroState, member: WorkspaceMember | null) {
  const workspace = state.workspace;
  const currentStep = valueOrPlaceholder(workspace.onboarding.currentStep, "继续剩余步骤");
  const startRoute = member?.preferences.startRoute ?? "/chat/all";

  if (workspace.onboarding.status !== "done") {
    if (workspace.repoBindingStatus !== "bound") {
      return {
        href: "/setup",
        title: "继续连接仓库",
        detail: "先把仓库名、地址和默认分支连上，工作区才能继续推进。",
        cta: "去连接仓库",
      };
    }

    if (!workspace.githubInstallation.connectionReady) {
      return {
        href: "/setup",
        title: "继续连接 GitHub",
        detail: "仓库已写入工作区，但 GitHub 连接还没确认完成。",
        cta: "去连接 GitHub",
      };
    }

    if (workspace.pairingStatus !== "paired") {
      return {
        href: "/setup",
        title: "继续连接机器",
        detail: "先把当前机器配对好，执行和恢复才会稳定。",
        cta: "去连接机器",
      };
    }

    return {
      href: "/setup",
      title: "继续完成首次设置",
      detail: `当前进度 ${onboardingStatusLabel(workspace.onboarding.status)} · ${currentStep}。剩余设置可以继续在启动页收口。`,
      cta: "继续启动设置",
    };
  }

  if (!workspace.githubInstallation.connectionReady) {
    return {
      href: "/setup",
      title: "继续连接 GitHub",
      detail: "工作区已经可用，但 GitHub 连接还没确认完成。",
      cta: "去连接 GitHub",
    };
  }

  if (!member?.githubIdentity?.handle) {
    return {
      href: "/access",
      title: "绑定 GitHub 账号",
      detail: "补上代码身份后，交付记录会直接带上你的 GitHub 账号。",
      cta: "去绑定 GitHub",
    };
  }

  return {
    href: startRoute,
    title: "设置已就绪，回到工作台",
    detail: `${startRouteLabel(startRoute)} 已设为默认入口，${agentLabel(member.preferences.preferredAgentId, state.agents)} 会作为常用智能体。`,
    cta: `回到${startRouteLabel(startRoute)}`,
  };
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
      return "邀请加入";
    case "auth_verify_email":
      return "邮箱验证";
    case "auth_password_reset":
      return "重置密码";
    case "auth_blocked_recovery":
      return "恢复受阻升级";
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
    const id = valueOrPlaceholder(templateID, "未分类");
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

function LiveSettingsContextRail() {
  const { state, loading: stateLoading, error: stateError } = usePhaseZeroState();
  const member = findSettingsMember(state.auth.session.memberId, state.auth.members);
  const workspace = state.workspace;
  return (
    <DetailRail
      label="设置状态"
      items={[
        {
          label: "GitHub",
          value: stateLoading
            ? "同步中"
            : stateError
              ? "读取失败"
              : `${workspace.githubInstallation.connectionReady ? "已连接" : "待连接"} / ${valueOrPlaceholder(member?.githubIdentity?.handle, "未绑 GitHub")}`,
        },
        {
          label: "机器",
          value: stateLoading
            ? "同步中"
            : stateError
              ? "读取失败"
              : `${workspacePairingStatusLabel(workspace.pairingStatus)} / ${valueOrPlaceholder(workspace.pairedRuntime, "未选机器")}`,
        },
        {
          label: "记忆",
          value: stateLoading
            ? "同步中"
            : stateError
              ? "读取失败"
              : memoryBenefitSummary(workspace.memoryMode),
        },
        {
          label: "计划",
          value: stateLoading
            ? "同步中"
            : stateError
              ? "读取失败"
              : `${valueOrPlaceholder(workspace.plan, "未声明")} / ${quotaStatusLabel(workspace.quota?.status)}`,
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
  const pairingTone = workspace.pairingStatus === "paired" ? "lime" : workspace.pairingStatus === "degraded" ? "yellow" : "pink";
  const memoryTone = workspace.memoryMode?.trim() ? "lime" : "yellow";
  const quotaTone = quotaStatusTone(quota?.status);
  const usageTone = typeof usage?.totalTokens === "number" && usage.totalTokens >= 14000 ? "pink" : "yellow";

  return (
    <Panel tone="ink" className="shadow-[6px_6px_0_0_var(--shock-yellow)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/72">机器与记忆</p>
          <h2 className="mt-2 font-display text-3xl font-bold">先把机器连好，让记忆持续可用</h2>
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
        机器配对后任务不断线，记忆会带着上下文继续。额度和用量细项放在下面。
      </p>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <StatusRow
          label="机器配对"
          value={metricValue(
            `${workspacePairingStatusLabel(workspace.pairingStatus)} · ${valueOrPlaceholder(workspace.pairedRuntime, "未选机器")}`
          )}
          tone={metricTone(pairingTone)}
          testID="settings-workspace-pairing-status"
        />
        <StatusRow
          label="记忆收益"
          value={metricValue(memoryBenefitSummary(workspace.memoryMode))}
          tone={metricTone(memoryTone)}
          testID="settings-workspace-memory-benefit"
        />
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FactTile label="当前计划" value={metricValue(valueOrPlaceholder(workspace.plan, "未声明"))} testID="settings-workspace-plan-value" />
        <FactTile label="统计范围" value={metricValue(formatWorkspaceUsageWindow(usage))} testID="settings-workspace-usage-window" />
        <FactTile label="保留周期" value={metricValue(formatRetentionSummary(quota))} testID="settings-workspace-retention" />
      </div>

      <StatusRow
        label="配额提醒"
        value={metricValue(valueOrPlaceholder(quota?.warning, "目前没有配额提醒。"))}
        tone={metricTone(quotaTone)}
        testID="settings-workspace-quota-warning"
      />
      <StatusRow
        label="使用提醒"
        value={metricValue(valueOrPlaceholder(usage?.warning, "目前没有使用提醒。"))}
        tone={metricTone(usageTone)}
        testID="settings-workspace-usage-warning"
      />

      <details className="mt-5 rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4" data-testid="settings-workspace-quota-details">
        <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--shock-ink)]">额度明细</summary>
        <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.08fr)_0.92fr]">
          <div className="grid gap-3">
            <StatusRow
              label="机器"
              value={metricValue(formatQuotaCounter(quota?.usedMachines, quota?.maxMachines, "台"))}
              tone={metricTone(quotaCounterTone(quota?.usedMachines, quota?.maxMachines))}
              testID="settings-workspace-machines"
            />
            <StatusRow
              label="智能体"
              value={metricValue(formatQuotaCounter(quota?.usedAgents, quota?.maxAgents, "个"))}
              tone={metricTone(quotaCounterTone(quota?.usedAgents, quota?.maxAgents))}
              testID="settings-workspace-agents"
            />
            <StatusRow
              label="频道"
              value={metricValue(formatQuotaCounter(quota?.usedChannels, quota?.maxChannels, "个"))}
              tone={metricTone(quotaCounterTone(quota?.usedChannels, quota?.maxChannels))}
              testID="settings-workspace-channels"
            />
            <StatusRow
              label="讨论间"
              value={metricValue(formatQuotaCounter(quota?.usedRooms, quota?.maxRooms, "个"))}
              tone={metricTone(quotaCounterTone(quota?.usedRooms, quota?.maxRooms))}
              testID="settings-workspace-rooms"
            />
          </div>

          <div className="grid gap-3">
            <StatusRow
              label="最近使用"
              value={metricValue(`${formatCount(usage?.runCount)} 次执行 / ${formatCount(usage?.messageCount)} 条消息`)}
              tone="white"
              testID="settings-workspace-usage-detail"
            />
            <StatusRow
              label="工作区使用量"
              value={metricValue(`${formatCount(usage?.totalTokens)} 令牌 / ${formatCount(usage?.runCount)} 次执行 / ${formatCount(usage?.messageCount)} 条消息`)}
              tone={metricTone(usageTone)}
              testID="settings-workspace-usage-summary"
            />
            <StatusRow
              label="最近刷新"
              value={metricValue(formatTimestamp(usage?.refreshedAt))}
              tone="white"
              testID="settings-workspace-usage-refresh"
            />
          </div>
        </div>
      </details>
    </Panel>
  );
}

function SettingsOverviewPanel() {
  const { state, loading, error } = usePhaseZeroState();
  const workspace = state.workspace;
  const member = findSettingsMember(state.auth.session.memberId, state.auth.members);
  const nextAction = nextSettingsAction(state, member);
  const loadingValue = loading ? "同步中" : error ? "读取失败" : null;
  const metricValue = (value: string) => loadingValue ?? value;

  return (
    <Panel tone="paper">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[color:rgba(24,20,14,0.62)]">现在先做什么</p>
          <h2 className="mt-3 font-display text-4xl font-bold">{metricValue(nextAction.title)}</h2>
          <p className="mt-3 text-base leading-7 text-[color:rgba(24,20,14,0.78)]" data-testid="settings-next-action-summary">
            {metricValue(nextAction.detail)}
          </p>
        </div>
        <Link
          href={nextAction.href}
          data-testid="settings-next-action-link"
          className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em]"
        >
          {metricValue(nextAction.cta)}
        </Link>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <FactTile
          label="启动状态"
          value={metricValue(`${onboardingStatusLabel(workspace.onboarding.status)} · ${valueOrPlaceholder(workspace.onboarding.currentStep, "未声明当前步骤")}`)}
          testID="settings-overview-onboarding"
        />
        <FactTile
          label="默认入口"
          value={metricValue(member ? startRouteLabel(member.preferences.startRoute) : "未建立当前成员")}
          testID="settings-overview-start-route"
        />
        <FactTile
          label="GitHub"
          value={metricValue(member ? valueOrPlaceholder(member.githubIdentity?.handle, "未绑定") : "未建立当前成员")}
          testID="settings-overview-github"
        />
      </div>

      <details
        data-testid="settings-overview-support-details"
        className="mt-5 rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4"
      >
        <summary
          data-testid="settings-overview-support-toggle"
          className="cursor-pointer list-none font-mono text-[11px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.72)]"
        >
          查看工作区摘要
        </summary>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <FactTile
            label="当前模板"
            value={metricValue(valueOrPlaceholder(workspace.onboarding.templateId, "未选模板"))}
            testID="settings-overview-template"
          />
          <FactTile
            label="安全范围"
            value={metricValue(sandboxProfileLabel(workspace.sandbox.profile))}
            testID="settings-overview-sandbox"
          />
          <FactTile
            label="常用智能体"
            value={metricValue(member ? agentLabel(member.preferences.preferredAgentId, state.agents) : "未建立当前成员")}
            testID="settings-overview-preferred-agent"
          />
        </div>
      </details>
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
      setError(mutationError instanceof Error ? mutationError.message : "工作区设置保存失败");
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
        模板、进度、仓库、入口和安全范围。
      </p>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FactTile label="模板" value={valueOrPlaceholder(workspace.onboarding.templateId, "未选模板")} testID="settings-workspace-template-value" />
        <p className="hidden" data-testid="settings-workspace-template-text">{valueOrPlaceholder(workspace.onboarding.templateId, "未选模板")}</p>
        <FactTile label="回跳地址" value={valueOrPlaceholder(workspace.onboarding.resumeUrl, "未设置")} />
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
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">回跳地址</span>
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
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">安全级别</span>
            <select
              data-testid="settings-workspace-sandbox-profile"
              value={sandboxProfile}
              onChange={(event) => {
                setSandboxProfile(event.target.value as SandboxProfile);
                setDirty(true);
              }}
              className="rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3"
            >
              <option value="trusted">完全访问</option>
              <option value="restricted">受限访问</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">允许访问域名</span>
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
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">允许命令</span>
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
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">允许工具</span>
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
            {onboardingStatusLabel(workspace.onboarding.status)} / {valueOrPlaceholder(workspace.onboarding.currentStep, "未声明当前步骤")}
          </p>
          <button
            data-testid="settings-workspace-save"
            type="submit"
            disabled={pending}
            className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "保存中..." : "保存工作区设置"}
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
      setError(mutationError instanceof Error ? mutationError.message : "团队协作流程保存失败");
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
      setError(mutationError instanceof Error ? mutationError.message : "恢复默认团队模板失败");
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
          {valueOrPlaceholder(workspace.governance.templateId, "未选择模板")}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
        调整团队模板、角色名称、默认 Agent 和交接方式。
      </p>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <FactTile label="治理名称" value={valueOrPlaceholder(workspace.governance.label, "未命名治理链")} />
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
                选择任务完成后如何接续，或是否自动收尾。
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
            {permissionBoundaryCopy(state.auth.session, "workspace.manage")}
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
        <p className="font-display text-3xl font-bold">还不能保存个人偏好</p>
        <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">先建立当前会话，再保存常用智能体、默认入口和 GitHub 身份。</p>
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
      setSuccess("成员偏好已保存。");
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "成员偏好保存失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel tone="paper">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">成员偏好</p>
          <h2 className="mt-2 font-display text-3xl font-bold">设置当前成员的常用智能体、默认入口和 GitHub 身份</h2>
        </div>
        <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
          {currentMember.email}
        </span>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <FactTile
          label="常用智能体"
          value={agentLabel(currentMember.preferences.preferredAgentId, state.agents)}
          testID="settings-member-preferred-agent-value"
        />
        <p className="hidden" data-testid="settings-member-preferred-agent-text">{agentLabel(currentMember.preferences.preferredAgentId, state.agents)}</p>
        <FactTile label="默认入口" value={startRouteLabel(currentMember.preferences.startRoute)} testID="settings-member-start-route-value" />
        <p className="hidden" data-testid="settings-member-start-route-text">{valueOrPlaceholder(currentMember.preferences.startRoute, "未声明")}</p>
        <FactTile label="GitHub" value={valueOrPlaceholder(currentMember.githubIdentity?.handle, "未绑定")} testID="settings-member-github-handle-value" />
        <p className="hidden" data-testid="settings-member-github-handle-text">{valueOrPlaceholder(currentMember.githubIdentity?.handle, "未绑定")}</p>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 grid gap-3 rounded-[24px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="grid gap-2 text-sm">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">常用智能体</span>
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
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">默认入口</span>
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
                  {startRouteLabel(route)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">GitHub 账号</span>
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
            {pending ? "保存中..." : "保存成员设置"}
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
      setSuccess(secretValue.trim() ? "凭证已更新。" : "说明已更新。");
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "凭据保存失败");
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
        <FactTile label="默认范围" value={profile.workspaceDefault ? "工作区默认" : "单独绑定"} testID={`settings-credential-workspace-default-${profile.id}`} />
        <FactTile label="绑定位置" value={credentialUsageSummary(profile, state)} testID={`settings-credential-usage-${profile.id}`} />
        <FactTile label="最近轮换" value={valueOrPlaceholder(formatTimestamp(profile.lastRotatedAt), "尚未写入")} />
        <FactTile label="最近使用" value={valueOrPlaceholder(formatTimestamp(profile.lastUsedAt), "尚未使用")} />
      </div>

      <p className="mt-4 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">
        {valueOrPlaceholder(profile.summary, "这条凭证还没写用途。")} 密钥明文不回显。
      </p>

      <form onSubmit={handleSubmit} className="mt-4 grid gap-3 rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-2 text-sm">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">名称</span>
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
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">凭证类型</span>
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
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">说明</span>
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
            <span className="font-mono text-[10px] uppercase tracking-[0.18em]">更新密钥</span>
            <textarea
              data-testid={`settings-credential-rotate-secret-${profile.id}`}
              value={secretValue}
              onChange={(event) => {
                setSecretValue(event.target.value);
                setDirty(true);
              }}
              disabled={!canEdit || pending}
              placeholder="留空只改说明；填写后换新密钥。"
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
          <span>设为工作区默认值，让后续执行默认继承。</span>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            data-testid={`settings-credential-save-${profile.id}`}
            disabled={!canEdit || pending}
            className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "保存中..." : "保存凭证"}
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
      setSuccess("新凭证已保存，可继续绑定。");
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "新凭据创建失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <Panel tone="ink" className="shadow-[6px_6px_0_0_var(--shock-lime)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/72">凭证</p>
            <h2 className="mt-2 font-display text-3xl font-bold">工作区凭证</h2>
          </div>
          <span className="rounded-full border-2 border-white/70 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
            {state.credentials.length} 条凭证
          </span>
        </div>
        <p className="mt-3 text-sm leading-6 text-white/80">
          只显示摘要和状态。密钥单独加密保存，不会通过 `/v1/state` 或页面回显。
        </p>
      </Panel>

      <Panel tone="yellow">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">新增凭证</p>
            <h3 className="mt-2 font-display text-3xl font-bold">新增凭证</h3>
          </div>
          <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
            {canEdit ? "可编辑" : "只读"}
          </span>
        </div>

        <form onSubmit={handleCreate} className="mt-5 grid gap-3 rounded-[24px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em]">名称</span>
              <input
                data-testid="settings-credential-create-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                disabled={!canEdit || pending}
                className="rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em]">凭证类型</span>
              <input
                data-testid="settings-credential-create-secret-kind"
                value={secretKind}
                onChange={(event) => setSecretKind(event.target.value)}
                disabled={!canEdit || pending}
                className="rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3"
              />
            </label>
            <label className="grid gap-2 text-sm md:col-span-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em]">说明</span>
              <textarea
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                disabled={!canEdit || pending}
                className="min-h-[84px] rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3"
              />
            </label>
            <label className="grid gap-2 text-sm md:col-span-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em]">密钥内容</span>
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
            <span>创建后设为工作区默认值。</span>
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button
              data-testid="settings-credential-create-save"
              type="submit"
              disabled={!canEdit || pending}
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "加密保存中..." : "创建凭证"}
            </button>
            {success ? <span className="text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">{success}</span> : null}
            {error ? <span className="text-sm leading-6 text-[color:rgba(163,37,28,0.92)]">{error}</span> : null}
          </div>
        </form>
      </Panel>

      {state.credentials.length === 0 ? (
        <EmptyState title="暂无凭证" message="先创建第一条凭证。" />
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

function SettingsAdvancedEntryPanel({
  governanceSummary,
  credentialSummary,
  notificationSummary,
}: {
  governanceSummary: string;
  credentialSummary: string;
  notificationSummary: string;
}) {
  return (
    <Panel tone="ink" className="shadow-[6px_6px_0_0_var(--shock-yellow)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-white/72">不常改的设置</p>
          <h2 className="mt-3 font-display text-4xl font-bold">管理不常改的设置</h2>
          <p className="mt-3 text-base leading-7 text-white/84">
            团队规则、凭据和通知都放到单独一页，需要时再进入。
          </p>
        </div>
        <Link
          href="/settings/advanced"
          data-testid="settings-advanced-link"
          className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--shock-ink)]"
        >
          打开高级设置
        </Link>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <FactTile label="治理编排" value={governanceSummary} testID="settings-advanced-governance-summary" />
        <FactTile label="凭据配置" value={credentialSummary} testID="settings-advanced-credential-summary" />
        <FactTile label="通知送达" value={notificationSummary} testID="settings-advanced-notification-summary" />
      </div>
    </Panel>
  );
}

function SettingsAdvancedOverviewPanel({
  governanceSummary,
  credentialSummary,
  notificationSummary,
}: {
  governanceSummary: string;
  credentialSummary: string;
  notificationSummary: string;
}) {
  return (
    <Panel tone="paper">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[color:rgba(24,20,14,0.62)]">高级设置</p>
          <h2 className="mt-3 font-display text-4xl font-bold">治理、凭据与通知</h2>
          <p className="mt-3 text-base leading-7 text-[color:rgba(24,20,14,0.78)]">
            这里保留少用但重要的配置。常用的启动、身份和机器设置已经放回主设置页。
          </p>
        </div>
        <Link
          href="/settings"
          data-testid="settings-primary-link"
          className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em]"
        >
          返回主设置
        </Link>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <FactTile label="治理编排" value={governanceSummary} testID="settings-advanced-page-governance-summary" />
        <FactTile label="凭据配置" value={credentialSummary} testID="settings-advanced-page-credential-summary" />
        <FactTile label="通知送达" value={notificationSummary} testID="settings-advanced-page-notification-summary" />
      </div>
    </Panel>
  );
}

function SettingsDisclosureSection({
  title,
  summary,
  testId,
  tone = "white",
  defaultOpen = false,
  eyebrow = "高级设置",
  collapsedLabel = "展开高级配置",
  expandedLabel = "收起高级配置",
  children,
}: {
  title: string;
  summary: string;
  testId: string;
  tone?: "white" | "paper" | "yellow" | "lime" | "ink" | "pink";
  defaultOpen?: boolean;
  eyebrow?: string;
  collapsedLabel?: string;
  expandedLabel?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Panel tone={tone}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">{eyebrow}</p>
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
          {open ? expandedLabel : collapsedLabel}
        </button>
      </div>
      {open ? <div data-testid={`settings-advanced-${testId}-content`} className="mt-5 space-y-4">{children}</div> : null}
    </Panel>
  );
}

function LiveSettingsView({
  notifications,
  mode = "primary",
}: {
  notifications: LiveNotificationsModel;
  mode?: SettingsRouteMode;
}) {
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
    ? `${center.worker.delivered}/${center.worker.attempted} 已送达 · ${center.worker.failed} 失败`
    : "尚未执行";
  const identityWorkerSummary = identityReceipts.length
    ? `${identityReceipts.filter((receipt) => receipt.status === "sent").length}/${identityReceipts.length} 已送达`
    : "尚未执行";
  const governanceSummary = `${state.workspace.governance.teamTopology.length} 个角色 · ${deliveryDelegationModeLabel(normalizeDeliveryDelegationMode(state.workspace.governance.deliveryDelegationMode))}`;
  const credentialDefaultCount = state.credentials.filter((profile) => profile.workspaceDefault).length;
  const credentialSummary = `${state.credentials.length} 条凭证 · ${credentialDefaultCount} 条默认`;
  const notificationSummary = buildSettingsNotificationSummary({
    loading: notificationLoading,
    error: notificationError,
    subscriberCount: center.subscribers.length,
    readyDeliveries,
    suppressedDeliveries,
  });
  const browserConnectReadiness = deriveBrowserConnectReadiness(surface);
  const advancedMode = mode === "advanced";

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
      setActionMessage("工作区通知默认值已保存。");
    });
  }

  async function handleConnectBrowserSubscriber() {
    await runAction("connect-browser", async () => {
      if (!browserConnectReadiness.canConnect) {
        throw new Error(browserConnectReadiness.hint);
      }
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
        nextSubscriber.status === "ready"
          ? `当前浏览器已接入通知：${subscriberStatusLabel(nextSubscriber.status)} · ${preferenceLabel(nextSubscriber.effectivePreference)}。`
          : `当前浏览器已记录为接收端，但还不能接收通知：${subscriberStatusLabel(nextSubscriber.status)} · ${preferenceLabel(nextSubscriber.effectivePreference)}。`
      );
    });
  }

  async function handleSaveEmailSubscriber() {
    await runAction("save-email", async () => {
      const payload = await notifications.upsertSubscriber({
        id: emailSubscriber?.id,
        channel: "email",
        target: emailTargetDraft.trim(),
        label: state.auth.session.email && emailTargetDraft.trim() === state.auth.session.email ? "当前账号邮箱" : "工作区邮箱",
        preference: emailPreferenceDraft,
        status: "ready",
        source: "workspace-email",
      });
      setEmailDirty(false);
      setActionMessage(
        `邮箱通知已保存：${payload.subscriber.target} · ${preferenceLabel(payload.subscriber.effectivePreference)}。`
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
          ? `通知已发送：${payload.worker.delivered}/${payload.worker.attempted} 条送达，并在当前浏览器展示 ${shown} 条通知。`
          : `通知已发送：${payload.worker.delivered}/${payload.worker.attempted} 条送达，失败 ${payload.worker.failed} 条。`
      );
    });
  }

  return (
    <div className="space-y-4">
      {advancedMode && notificationError ? (
        <Panel tone="pink">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">通知加载失败</p>
          <p className="mt-3 text-base leading-7">当前 `/v1/notifications` 拉取失败：{notificationError}</p>
        </Panel>
      ) : null}

      {stateError ? (
        <Panel tone="pink">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">状态同步失败</p>
          <p className="mt-3 text-base leading-7">设置页部分内容暂时无法同步：{stateError}</p>
        </Panel>
      ) : null}

      {advancedMode ? (
        <SettingsAdvancedOverviewPanel
          governanceSummary={governanceSummary}
          credentialSummary={credentialSummary}
          notificationSummary={notificationSummary}
        />
      ) : (
        <>
          <SettingsOverviewPanel />
          <WorkspacePlanObservabilityPanel />

          <SettingsDisclosureSection
            title="启动与安全"
            summary="模板、恢复入口、记忆模式和执行范围。"
            testId="workspace"
            tone="yellow"
            eyebrow="工作区设置"
            collapsedLabel="展开编辑"
            expandedLabel="收起编辑"
          >
            <WorkspaceDurableConfigPanel />
          </SettingsDisclosureSection>

          <SettingsDisclosureSection
            title="个人偏好"
            summary="常用智能体、默认入口和 GitHub 身份。"
            testId="member"
            tone="paper"
            eyebrow="成员设置"
            collapsedLabel="展开编辑"
            expandedLabel="收起编辑"
          >
            <MemberPreferencePanel />
          </SettingsDisclosureSection>

          <SettingsAdvancedEntryPanel
            governanceSummary={governanceSummary}
            credentialSummary={credentialSummary}
            notificationSummary={notificationSummary}
          />
        </>
      )}

      {advancedMode ? (
        <SettingsDisclosureSection
          title="治理编排"
          summary={governanceSummary}
          testId="governance"
          tone="paper"
          defaultOpen={true}
          eyebrow="团队治理"
          collapsedLabel="展开治理设置"
          expandedLabel="收起治理设置"
        >
          <GovernanceTopologyPanel />
        </SettingsDisclosureSection>
      ) : null}

      {advancedMode ? (
        <SettingsDisclosureSection
          title="凭据配置"
          summary={credentialSummary}
          testId="credentials"
          defaultOpen={true}
          eyebrow="工作区凭据"
          collapsedLabel="展开凭据设置"
          expandedLabel="收起凭据设置"
        >
          <CredentialProfilesPanel />
        </SettingsDisclosureSection>
      ) : null}

      {advancedMode ? (
        <SettingsDisclosureSection
          title="通知与送达"
          summary={notificationSummary}
          testId="notifications"
          tone="yellow"
          defaultOpen={true}
          eyebrow="通知中心"
          collapsedLabel="展开通知设置"
          expandedLabel="收起通知设置"
        >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_0.92fr]">
        <Panel tone="yellow">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">通知状态</p>
          <h2 className="mt-3 font-display text-4xl font-bold">通知送达</h2>
          <p className="mt-3 max-w-3xl text-base leading-7">
            浏览器、邮件和最近发送放在一起，直接看谁会收到、哪里还卡着。
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <FactTile label="接收端" value={notificationLoading ? "同步中" : String(center.subscribers.length)} testID="notification-subscribers-count" />
            <FactTile label="待发送" value={notificationLoading ? "同步中" : String(readyDeliveries)} testID="notification-delivery-ready-count" />
            <FactTile label="已静默" value={notificationLoading ? "同步中" : String(suppressedDeliveries)} testID="notification-delivery-suppressed-count" />
            <FactTile label="发送结果" value={notificationLoading ? "同步中" : workerSummary} testID="notification-worker-summary" />
          </div>
        </Panel>

        <Panel tone="ink" className="shadow-[6px_6px_0_0_var(--shock-pink)]">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">当前状态</p>
          <h2 className="mt-3 font-display text-3xl font-bold">默认规则与当前接收端</h2>
          <div className="mt-4 space-y-3 text-sm leading-6 text-white/82">
            <p>默认规则、当前浏览器和最近发送共用同一份状态。</p>
          </div>
          <div className="mt-5 grid gap-3">
            <StatusRow label="工作区浏览器通知" value={preferenceLabel(center.policy.browserPush)} tone="white" testID="notification-workspace-browser-policy" />
            <StatusRow label="工作区邮件通知" value={preferenceLabel(center.policy.email)} tone="yellow" testID="notification-workspace-email-policy" />
            <StatusRow label="当前浏览器" value={`${subscriberStatusLabel(browserSubscriberState)} · ${preferenceLabel(browserSubscriber?.effectivePreference || preference)}`} tone="lime" testID="notification-current-browser-subscriber" />
            <StatusRow label="最近发送" value={`${workerSummary} · ${formatTimestamp(center.worker.ranAt)}`} tone={center.worker.failed > 0 ? "pink" : center.worker.delivered > 0 ? "lime" : "white"} testID="notification-last-fanout" />
          </div>
        </Panel>
      </div>

      <Panel tone="ink" className="shadow-[6px_6px_0_0_var(--shock-yellow)]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.24em]">身份通知模板</p>
            <h2 className="mt-3 font-display text-3xl font-bold">邀请、验证、重置、恢复共用一套模板</h2>
          </div>
          <Link
            href="/access"
            className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--shock-ink)]"
          >
            账号中心
          </Link>
        </div>
        <p className="mt-3 max-w-4xl text-sm leading-6 text-white/84">
          邀请、邮箱验证、密码重置和跨设备恢复共用同一条发送状态。
        </p>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <FactTile label="模板数" value={String(identityTemplateSummaries.length)} testID="notification-identity-template-count" />
          <FactTile label="信号数" value={String(identitySignals.length)} testID="notification-identity-signal-count" />
          <FactTile label="待发送" value={String(identityDeliveries.filter((delivery) => delivery.status === "ready").length)} testID="notification-identity-ready-count" />
          <FactTile label="最近发送" value={identityWorkerSummary} testID="notification-identity-worker-summary" />
        </div>
        <div className="mt-5 space-y-3">
          {identityTemplateSummaries.length === 0 ? (
            <EmptyState
              title="暂无身份通知记录"
              message="触发一次身份流程后就会出现。"
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
                  <StatusRow label="信号数" value={String(template.signalCount)} tone="white" />
                  <StatusRow label="待发送" value={String(template.readyCount)} tone={template.readyCount > 0 ? "lime" : "white"} />
                  <StatusRow label="阻塞" value={String(template.blockedCount)} tone={template.blockedCount > 0 ? "pink" : "white"} />
                  <StatusRow label="最近结果" value={template.lastStatus} tone={template.lastStatus === "已送达" ? "lime" : template.lastStatus === "发送失败" ? "pink" : "yellow"} />
                </div>
                <p className="mt-4 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                  最近发送：{formatTimestamp(template.lastAttempt)}
                </p>
              </article>
            ))
          )}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_1fr]">
        <Panel tone="paper">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">默认通知</p>
          <h3 className="mt-3 font-display text-3xl font-bold">默认策略</h3>
          <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
            接收端选择继承时，会使用这组默认值。
          </p>
          <div className="mt-5 space-y-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">浏览器通知</p>
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
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">邮件通知</p>
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
            <StatusRow label="最近更新时间" value={formatTimestamp(center.policy.updatedAt)} tone="white" />
          </div>
        </Panel>

        <Panel tone="lime">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">当前浏览器</p>
          <h3 className="mt-3 font-display text-3xl font-bold">当前浏览器接收</h3>
          <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
            授权后，发到当前浏览器的消息会变成本地通知。
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <StatusRow label="权限" value={permissionLabel(surface.permission)} tone={surface.permission === "granted" ? "lime" : surface.permission === "denied" ? "pink" : "white"} testID="notification-browser-permission" />
            <StatusRow label="注册状态" value={surface.registrationScope ? `${registrationLabel(surface.registrationState)} · ${surface.registrationScope}` : registrationLabel(surface.registrationState)} tone={surface.registrationState === "ready" ? "lime" : surface.registrationState === "error" || surface.registrationState === "blocked" ? "pink" : "white"} testID="notification-browser-registration" />
            <StatusRow label="接收目标" value={subscriberTarget} tone="white" testID="notification-browser-target" />
            <StatusRow label="接入状态" value={subscriberStatusLabel(browserSubscriberState)} tone={toneForSubscriberStatus(browserSubscriberState)} testID="notification-browser-subscriber-status" />
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
                  setActionMessage("当前浏览器通知接收已启用。");
                })
              }
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
            >
              {busyAction === "register" ? "启用中..." : "启用浏览器接收"}
            </button>
            <button
              type="button"
              data-testid="notification-connect-browser"
              disabled={busyAction !== null || !browserConnectReadiness.canConnect}
              onClick={() => void handleConnectBrowserSubscriber()}
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
            >
              {busyAction === "connect-browser" ? "接入中..." : "接入当前浏览器"}
            </button>
            <button
              type="button"
              data-testid="notification-local-smoke"
              disabled={busyAction !== null || surface.permission !== "granted"}
              onClick={() =>
                void runAction("browser-smoke", async () => {
                  await sendTestNotification();
                  setActionMessage("本地测试通知已发出。");
                })
              }
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
            >
              {busyAction === "browser-smoke" ? "发送中..." : "本地试发"}
            </button>
          </div>
          {!browserConnectReadiness.canConnect ? (
            <p className="mt-4 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]" data-testid="notification-connect-browser-hint">
              {browserConnectReadiness.hint}
            </p>
          ) : null}
          {surface.registrationError ? <p className="mt-4 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">{surface.registrationError}</p> : null}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.96fr)_1.04fr]">
        <Panel tone="white">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">邮件通知</p>
          <h3 className="mt-3 font-display text-3xl font-bold">邮件接收</h3>
          <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
            保存接收邮箱，地址无效会直接报错。
          </p>
          <label className="mt-5 block">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">邮箱地址</span>
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
            <StatusRow label="接入状态" value={emailSubscriber ? subscriberStatusLabel(emailSubscriber.status) : "未创建"} tone={emailSubscriber ? toneForSubscriberStatus(emailSubscriber.status) : "white"} testID="notification-email-subscriber-status" />
            <StatusRow label="当前生效" value={emailSubscriber ? preferenceLabel(emailSubscriber.effectivePreference) : preferenceLabel(emailPreferenceDraft)} tone="yellow" testID="notification-email-effective-preference" />
            <StatusRow label="最近送达" value={formatTimestamp(emailSubscriber?.lastDeliveredAt)} tone="white" testID="notification-email-last-delivered" />
            <StatusRow label="最近错误" value={emailSubscriber?.lastError || "无"} tone={emailSubscriber?.lastError ? "pink" : "lime"} testID="notification-email-last-error" />
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              data-testid="notification-save-email"
              disabled={busyAction !== null || !emailTargetDraft.trim()}
              onClick={() => void handleSaveEmailSubscriber()}
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
            >
              {busyAction === "save-email" ? "保存中..." : "保存邮箱地址"}
            </button>
            <button
              type="button"
              data-testid="notification-run-fanout"
              disabled={busyAction !== null}
              onClick={() => void handleDispatchFanout()}
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
            >
              {busyAction === "fanout" ? "发送中..." : "立即发送通知"}
            </button>
          </div>
        </Panel>

        <Panel tone="paper">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em]">接收列表</p>
              <h3 className="mt-3 font-display text-3xl font-bold">接收端列表</h3>
            </div>
            <span className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em]" data-testid="notification-roster-summary">
              浏览器 {browserDeliveryCount} · 邮件 {emailDeliveryCount} 待发送
            </span>
          </div>
          <div className="mt-5 space-y-3">
            {notificationLoading ? (
              <EmptyState title="正在同步通知状态" message="正在读取接收端和最近发送结果。" />
            ) : center.subscribers.length === 0 ? (
              <EmptyState title="暂无接收端" message="先接入浏览器或邮箱。" />
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
                      <StatusRow label="状态" value={subscriberStatusLabel(subscriber.status)} tone={toneForSubscriberStatus(subscriber.status)} />
                      <StatusRow label="当前生效" value={preferenceLabel(subscriber.effectivePreference)} tone="yellow" />
                      <StatusRow label="待发送" value={String(readyForSubscriber)} tone="lime" />
                      <StatusRow label="最近送达" value={formatTimestamp(subscriber.lastDeliveredAt)} tone="white" />
                    </div>
                    {subscriber.lastError ? (
                      <p className="mt-4 rounded-[16px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 text-sm leading-6 text-white">
                        最近错误：{subscriber.lastError}
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
              <p className="font-mono text-[11px] uppercase tracking-[0.24em]">最近发送结果</p>
              <h3 className="mt-3 font-display text-3xl font-bold">最近一次发送</h3>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <FactTile label="尝试" value={String(center.worker.attempted)} testID="notification-worker-attempted" />
              <FactTile label="送达" value={String(center.worker.delivered)} testID="notification-worker-delivered" />
              <FactTile label="失败" value={String(center.worker.failed)} testID="notification-worker-failed" />
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {workerReceipts.length === 0 ? (
              <EmptyState title="暂无发送记录" message="先发一次通知。" />
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
                    <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">{delivery?.body || subscriber?.target || "通知内容"}</p>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <StatusRow label="接收端" value={subscriber?.label || receipt.subscriberId} tone="white" />
                      <StatusRow label="目标" value={subscriber?.target || "无"} tone="white" />
                      <StatusRow label="模板" value={delivery?.templateLabel || receipt.templateLabel || "未命名模板"} tone="yellow" />
                      <StatusRow label="信号" value={delivery?.signalKind || receipt.signalKind || receipt.inboxItemId} tone="yellow" />
                      <StatusRow label="链接" value={delivery?.href || receipt.href || "无"} tone="white" />
                    </div>
                    {receipt.payloadPath ? (
                      <p className="mt-4 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">记录文件：{receipt.payloadPath}</p>
                    ) : null}
                    {receipt.error ? (
                      <p className="mt-4 rounded-[16px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 text-sm leading-6 text-white">
                        错误：{receipt.error}
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
              <p className="font-mono text-[11px] uppercase tracking-[0.24em]">来源信号</p>
              <h3 className="mt-3 font-display text-3xl font-bold">待发送来源</h3>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/access"
                className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em]"
              >
                账号中心
              </Link>
            </div>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <FactTile label="待批准" value={String(center.approvalCenter.approvalCount)} />
            <FactTile label="待评审" value={String(center.approvalCenter.reviewCount)} />
            <FactTile label="阻塞" value={String(center.approvalCenter.blockedCount)} />
          </div>
          <div className="mt-5 space-y-3">
            {routedSignals.length === 0 ? (
              <EmptyState title="当前没有待发送信号" message="没有新的批准、评审或恢复通知。" />
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
            <p className="font-mono text-[11px] uppercase tracking-[0.24em]">最近操作结果</p>
            <p className="mt-3 text-base leading-7" data-testid="notification-action-message">
              {actionMessage}
            </p>
          </Panel>
        ) : null}
      </SettingsDisclosureSection>
      ) : null}
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
      description="先看下一步和默认入口，不常改的设置放到高级页。"
      contextTitle="设置状态"
      contextDescription="机器、身份和计划状态；细项按需展开。"
      contextBody={<LiveSettingsContextRail />}
    >
      <LiveSettingsView notifications={notifications} mode="primary" />
    </OpenShockShell>
  );
}

export function LiveSettingsAdvancedRoute() {
  const notifications = useLiveNotifications();

  return (
    <OpenShockShell
      view="settings"
      eyebrow="高级设置"
      title="治理、凭据与通知"
      description="把少用但重要的配置收在这里，主设置页保持轻量。"
      contextTitle="高级设置"
      contextDescription="团队治理、凭据存储和通知送达状态。"
      contextBody={<LiveSettingsContextRail />}
    >
      <LiveSettingsView notifications={notifications} mode="advanced" />
    </OpenShockShell>
  );
}
