"use client";

import Link from "next/link";
import { useState } from "react";

import { DetailRail, Panel } from "@/components/phase-zero-views";
import { buildFirstStartJourney, type FirstStartJourneyStepStatus } from "@/lib/first-start-journey";
import { usePhaseZeroState } from "@/lib/live-phase0";
import { useLiveRuntimeTruth } from "@/lib/live-runtime";
import { runtimeProviderHealthLabel, runtimeProviderHealthStatus, runtimeProviderHealthSummary, runtimeProviderHealthTone } from "@/lib/runtime-provider-health";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function valueOrPlaceholder(value: string | undefined, fallback: string) {
  return value && value.trim() ? value : fallback;
}

function formatHeartbeatCadence(interval?: number, timeout?: number) {
  if (!interval && !timeout) {
    return "心跳节奏未返回";
  }
  const intervalLabel = interval ? `${interval}s 一次` : "间隔未返回";
  const timeoutLabel = timeout ? `${timeout}s 超时` : "超时未返回";
  return `${intervalLabel} / ${timeoutLabel}`;
}

function statusTone(active: boolean) {
  return active ? "lime" : "paper";
}

function journeyTone(status: FirstStartJourneyStepStatus) {
  switch (status) {
    case "ready":
      return "lime";
    case "active":
      return "yellow";
    default:
      return "paper";
  }
}

function runtimeStatusLabel(state: string) {
  switch (state) {
    case "online":
      return "在线";
    case "busy":
      return "忙碌";
    case "stale":
      return "心跳陈旧";
    case "offline":
      return "离线";
    default:
      return state || "未知";
  }
}

function pairingStatusLabel(state: string) {
  switch (state) {
    case "paired":
      return "已配对";
    case "degraded":
      return "配对降级";
    case "unpaired":
      return "未配对";
    default:
      return state || "待同步";
  }
}

function pairingStateLabel(state: string) {
  switch (state) {
    case "paired":
      return "当前所选";
    case "available":
      return "可切换";
    default:
      return state || "待确认";
  }
}

function githubInstallLabel(ready: boolean, installed: boolean) {
  if (ready) {
    return "已接通";
  }
  if (installed) {
    return "已安装";
  }
  return "待处理";
}

function repoBindingStatusLabel(status?: string) {
  switch ((status ?? "").trim().toLowerCase()) {
    case "bound":
      return "已绑定";
    case "blocked":
      return "已阻塞";
    case "pending":
      return "处理中";
    default:
      return valueOrPlaceholder(status, "待绑定");
  }
}

function runtimeSchedulerStrategyLabel(strategy: string) {
  switch (strategy) {
    case "selected_runtime":
      return "沿用当前选择";
    case "agent_preference":
      return "按当前处理人偏好";
    case "least_loaded":
      return "按负载最轻";
    case "failover":
      return "自动兜底切换";
    default:
      return "待调度";
  }
}

function runtimeProviderInventoryLabel(
  providers: Array<{ label: string; models?: string[]; ready?: boolean; status?: string }>
) {
  return providers
    .map((provider) => {
      const models = (provider.models ?? []).length > 0 ? (provider.models ?? []).join(" / ") : "未上报模型";
      return `${provider.label} · ${runtimeProviderHealthLabel(runtimeProviderHealthStatus(provider))}: ${models}`;
    })
    .join(" · ");
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

function onboardingStatusLabel(status?: string) {
  switch ((status ?? "").trim()) {
    case "done":
      return "已完成";
    case "in_progress":
      return "进行中";
    case "ready":
      return "待收口";
    case "not_started":
      return "未开始";
    default:
      return valueOrPlaceholder(status, "未开始");
  }
}

function templateSurfaceLabel(templateId?: string) {
  const trimmed = templateId?.trim();
  if (!trimmed) {
    return "未选模板";
  }
  return onboardingTemplateDefinition(trimmed).label;
}

function onboardingStudioStepLabel(stepId?: string) {
  const matched = ONBOARDING_STUDIO_STEPS.find((step) => step.id === stepId);
  return matched?.label ?? valueOrPlaceholder(stepId, "待开始");
}

function governanceLaneStatusLabel(status?: string) {
  switch ((status ?? "").trim().toLowerCase()) {
    case "ready":
      return "已就绪";
    case "active":
      return "进行中";
    case "watch":
      return "观察中";
    case "blocked":
      return "已阻塞";
    default:
      return valueOrPlaceholder(status, "待同步");
  }
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
  return `${quota.messageHistoryDays ?? 0} 天消息 / ${quota.runLogDays ?? 0} 天执行记录 / ${quota.memoryDraftDays ?? 0} 天草稿`;
}

function formatWorkspaceUsageWindow(usage?: { totalTokens?: number; windowLabel?: string }) {
  if (!usage) {
    return "未返回";
  }
  return `${formatCount(usage.totalTokens)} 令牌 / ${valueOrPlaceholder(usage.windowLabel, "时间范围未返回")}`;
}

function runtimeLeaseIsActive(status?: string) {
  return Boolean(status && status.trim() && status !== "done");
}

function looksLikeRuntimeLeaseConflict(value?: string) {
  const text = value?.trim().toLowerCase() ?? "";
  return text.includes("runtime lease 冲突") || text.includes("runtime lease conflict");
}

function WorkspaceMetric({
  label,
  value,
  testId,
  testID,
}: {
  label: string;
  value: string;
  testId?: string;
  testID?: string;
}) {
  return (
    <div data-testid={testId} className="rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">{label}</p>
      <p data-testid={testID} className="mt-1.5 break-all font-display text-[17px] font-semibold leading-5">{value}</p>
    </div>
  );
}

function SetupStateNotice({
  title,
  message,
  tone = "white",
}: {
  title: string;
  message: string;
  tone?: "white" | "paper" | "yellow" | "lime" | "pink" | "ink";
}) {
  return (
    <Panel tone={tone} className="!p-3.5">
      <p className="font-display text-2xl font-bold">{title}</p>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">{message}</p>
    </Panel>
  );
}

function SetupCheckpointCard({
  title,
  summary,
  active,
}: {
  title: string;
  summary: string;
  active: boolean;
}) {
  return (
    <Panel tone={statusTone(active)} className="!p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
            {active ? "已接通" : "待补全"}
          </p>
          <h3 className="mt-1.5 font-display text-[20px] font-bold leading-6">{title}</h3>
        </div>
        <span
          className={cn(
            "rounded-full border-2 border-[var(--shock-ink)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em]",
            active ? "bg-[var(--shock-lime)]" : "bg-white"
          )}
        >
          {active ? "已接通" : "待补全"}
        </span>
      </div>
      <p className="mt-2 text-[13px] leading-5">{summary}</p>
    </Panel>
  );
}

type OnboardingTemplateDefinition = {
  id: string;
  label: string;
  eyebrow: string;
  description: string;
  defaultPlan: string;
  defaultBrowserPush: string;
  defaultMemoryMode: string;
  channels: string[];
  roles: string[];
  agents: string[];
  notificationPolicy: string;
  notes: string[];
};

const ONBOARDING_STUDIO_STEPS = [
  { id: "template-selected", label: "模板已选", description: "已保存当前团队模板。" },
  { id: "repo-bound", label: "仓库已绑定", description: "已确认当前仓库和分支。" },
  { id: "github-ready", label: "GitHub 已连接", description: "已完成 GitHub 连接检查。" },
  { id: "runtime-paired", label: "运行环境已连接", description: "已确认默认执行机器。" },
  { id: "bootstrap-finished", label: "设置已完成", description: "可以进入工作区开始使用。" },
] as const;

const ONBOARDING_TEMPLATE_DEFINITIONS: OnboardingTemplateDefinition[] = [
  {
    id: "dev-team",
    label: "开发团队",
    eyebrow: "偏交付",
    description: "适合产品、开发、评审和测试协作的交付流程。",
    defaultPlan: "开发团队启动",
    defaultBrowserPush: "阻塞 / 评审 / 发布门",
    defaultMemoryMode: "治理优先 / 交付笔记",
    channels: ["#all", "#shiproom", "#review-lane", "#ops-watch"],
    roles: ["目标", "边界", "实现", "评审", "验证"],
    agents: ["需求智能体", "开发智能体", "评审智能体", "测试智能体"],
    notificationPolicy: "优先推送阻塞、评审和发布门事件",
    notes: [
      "系统会创建默认协作入口、交付、评审和发布相关频道。",
      "适合需要多人协作推进需求和发布的团队。",
    ],
  },
  {
    id: "research-team",
    label: "研究团队",
    eyebrow: "偏研究",
    description: "适合资料收集、分析整理和结果复核。",
    defaultPlan: "研究团队启动",
    defaultBrowserPush: "证据就绪 / 综合阻塞 / 复核反馈",
    defaultMemoryMode: "证据优先 / 综合台账",
    channels: ["#intake", "#evidence", "#synthesis"],
    roles: ["方向", "采集", "归纳", "复核"],
    agents: ["总控智能体", "采集智能体", "归纳智能体", "评审智能体"],
    notificationPolicy: "优先推送证据就绪、综合阻塞和复核反馈",
    notes: [
      "系统会创建输入、资料和综合相关频道。",
      "适合研究、分析和结论整理类工作。",
      "支持续接。",
    ],
  },
  {
    id: "blank-custom",
    label: "空白自定义",
    eyebrow: "偏轻量",
    description: "提供最基础的协作配置，先完成仓库、GitHub 和运行环境连接。",
    defaultPlan: "自定义工作区启动",
    defaultBrowserPush: "仅高优先级与显式评审",
    defaultMemoryMode: "笔记优先 / 最小启动",
    channels: ["#all", "#roadmap", "#announcements"],
    roles: ["所有者", "成员", "访客"],
    agents: ["启动智能体", "评审智能体"],
    notificationPolicy: "只推高优先级与显式评审事件",
    notes: [
      "系统会先创建基础频道、角色和默认智能体。",
      "首次设置支持续接，后续可再补流程、角色和通知规则。",
      "适合从空白工作区开始搭建自己的协作方式。",
    ],
  },
];

function onboardingTemplateDefinition(templateId: string | undefined) {
  const normalized = templateId?.trim().toLowerCase();
  if (normalized === "delivery-ops") {
    return ONBOARDING_TEMPLATE_DEFINITIONS[0];
  }
  return (
    ONBOARDING_TEMPLATE_DEFINITIONS.find((item) => item.id === normalized) ??
    ONBOARDING_TEMPLATE_DEFINITIONS[2]
  );
}

function buildOnboardingStudioProgress(workspace: ReturnType<typeof usePhaseZeroState>["state"]["workspace"], templateId: string, finished = false) {
  const githubReady =
    workspace.repoBinding.authMode !== "github-app" ||
    workspace.repoAuthMode !== "github-app" ||
    workspace.githubInstallation.appInstalled ||
    workspace.githubInstallation.connectionReady;
  const completed = new Set<string>();
  completed.add("workspace-created");
  if (templateId.trim()) {
    completed.add("template-selected");
  }
  if ((workspace.repoBinding.bindingStatus || workspace.repoBindingStatus) === "bound") {
    completed.add("repo-bound");
  }
  if (githubReady) {
    completed.add("github-ready");
  }
  if (workspace.pairingStatus === "paired") {
    completed.add("runtime-paired");
  }
  if (finished) {
    completed.add("bootstrap-finished");
  }

  const completedSteps = ONBOARDING_STUDIO_STEPS.filter((step) => completed.has(step.id)).map((step) => step.id);
  const nextStep = ONBOARDING_STUDIO_STEPS.find((step) => !completed.has(step.id))?.id ?? "bootstrap-finished";

  let status = "not_started";
  if (completed.has("bootstrap-finished")) {
    status = "done";
  } else if (completed.has("template-selected") && completed.has("repo-bound") && completed.has("github-ready") && completed.has("runtime-paired")) {
    status = "ready";
  } else if (completed.size > 1) {
    status = "in_progress";
  }

  return {
    status,
    currentStep: nextStep,
    completedSteps,
    resumeUrl: finished ? "/chat/all" : `/onboarding?template=${templateId}`,
    canFinish:
      completed.has("template-selected") &&
      completed.has("repo-bound") &&
      completed.has("github-ready") &&
      completed.has("runtime-paired"),
  };
}

function stepTone(completed: boolean, active: boolean) {
  if (completed) {
    return "lime";
  }
  if (active) {
    return "yellow";
  }
  return "paper";
}

export function SetupFirstStartJourneyPanel() {
  const { state, loading, error } = usePhaseZeroState();

  if (loading) {
    return (
      <SetupStateNotice
        title="正在准备工作区"
        message="正在载入工作区信息，请稍候。"
        tone="yellow"
      />
    );
  }

  if (error) {
    return <SetupStateNotice title="暂时连不上工作区" message={error} tone="pink" />;
  }

  const journey = buildFirstStartJourney(state.workspace, state.auth.session);
  const onboardingLabel = onboardingStatusLabel(state.workspace.onboarding.status);

  return (
    <Panel tone={journey.onboardingDone ? "lime" : journey.accessReady ? "yellow" : "paper"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">下一步</p>
          <h2 className="mt-2 font-display text-[28px] font-bold leading-[1.15]">现在先做哪一步</h2>
        </div>
        <span
          className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]"
        >
          {journey.nextSurfaceLabel}
        </span>
        <span data-testid="setup-first-start-next-route" className="sr-only">{journey.nextHref}</span>
      </div>
      <p
        data-testid="setup-first-start-summary"
        className="mt-3 max-w-3xl text-sm leading-6 text-[color:rgba(24,20,14,0.78)]"
      >
        {journey.nextSummary}
      </p>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <WorkspaceMetric label="现在做什么" value={journey.nextLabel} testID="setup-first-start-next-label" />
        <WorkspaceMetric label="准备好后进入" value={journey.launchSurfaceLabel} />
        <p className="sr-only" data-testid="setup-first-start-launch-route">{journey.launchHref}</p>
        <WorkspaceMetric label="当前进度" value={onboardingLabel} testID="setup-first-start-onboarding-status" />
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {journey.steps.map((step) => (
          <Panel key={step.id} tone={journeyTone(step.status)} className="!p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-display text-[20px] font-bold leading-6">{step.label}</p>
                <p
                  data-testid={`setup-first-start-step-${step.id}-summary`}
                  className="mt-1.5 text-[13px] leading-5 text-[color:rgba(24,20,14,0.74)]"
                >
                  {step.summary}
                </p>
              </div>
              <span
                data-testid={`setup-first-start-step-${step.id}-status`}
                className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em]"
              >
                {step.status}
              </span>
            </div>
          </Panel>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link
          data-testid="setup-first-start-next-link"
          href={journey.nextHref}
          className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] shadow-[4px_4px_0_0_var(--shock-ink)] transition-transform hover:-translate-y-0.5"
        >
          {journey.nextLabel}
        </Link>
        <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
          完成后直接进入聊天。
        </p>
      </div>
    </Panel>
  );
}

export function OnboardingStudioPanel() {
  const { state, loading, error: stateError, updateWorkspaceConfig, updateWorkspaceMemberPreferences } = usePhaseZeroState();
  const workspace = state.workspace;
  const currentTemplate = onboardingTemplateDefinition(workspace.onboarding.templateId);
  const materialization = workspace.onboarding.materialization;
  const progress = buildOnboardingStudioProgress(workspace, currentTemplate.id, workspace.onboarding.status === "done");
  const sessionMember = state.auth.members.find((member) => member.id === state.auth.session.memberId);

  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (loading) {
    return (
      <SetupStateNotice
        title="正在载入起步设置"
        message="正在读取模板、分工和当前进度。"
        tone="yellow"
      />
    );
  }

  if (stateError) {
    return <SetupStateNotice title="起步设置暂时不可用" message={stateError} tone="pink" />;
  }

  async function persistTemplate(templateId: string, options?: { finished?: boolean; syncTemplateDefaults?: boolean }) {
    const finished = options?.finished ?? false;
    const syncTemplateDefaults = options?.syncTemplateDefaults ?? false;
    const definition = onboardingTemplateDefinition(templateId);
    const nextProgress = buildOnboardingStudioProgress(workspace, definition.id, finished);
    setPendingTemplateId(definition.id);
    setError(null);
    setSuccess(null);
    try {
      await updateWorkspaceConfig({
        plan: syncTemplateDefaults ? definition.defaultPlan : workspace.plan,
        browserPush: syncTemplateDefaults ? definition.defaultBrowserPush : workspace.browserPush,
        memoryMode: syncTemplateDefaults ? definition.defaultMemoryMode : workspace.memoryMode,
        sandbox: workspace.sandbox,
        onboarding: {
          status: nextProgress.status,
          templateId: definition.id,
          currentStep: nextProgress.currentStep,
          completedSteps: nextProgress.completedSteps,
          resumeUrl: nextProgress.resumeUrl,
        },
      });

      if (finished && sessionMember) {
        await updateWorkspaceMemberPreferences(sessionMember.id, {
          preferredAgentId: sessionMember.preferences.preferredAgentId ?? "",
          startRoute: "/chat/all",
          githubHandle: sessionMember.githubIdentity?.handle ?? "",
        });
      }

      setSuccess(
        finished
          ? "设置已完成，默认进入聊天。"
          : syncTemplateDefaults
            ? `${definition.label} 模板已保存。`
            : "当前进度已更新。"
      );
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "设置更新失败");
    } finally {
      setPendingTemplateId(null);
    }
  }

  return (
    <Panel tone="lime">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">起步模板</p>
          <h2 className="mt-2 font-display text-[28px] font-bold leading-[1.15]">先选一个起步方式</h2>
        </div>
        <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
          {onboardingStatusLabel(workspace.onboarding.status)}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
        可从开发、研究或空白开始，再补仓库和运行环境。
      </p>

      <div className="mt-5 grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-3">
          {ONBOARDING_TEMPLATE_DEFINITIONS.map((template) => {
            const active = currentTemplate.id === template.id;
            const busy = pendingTemplateId === template.id;
            return (
              <Panel key={template.id} tone={active ? "yellow" : "paper"} className="!p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">{template.eyebrow}</p>
                    <h3 className="mt-1.5 font-display text-[24px] font-bold leading-7">{template.label}</h3>
                  </div>
                  <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em]">
                    {active ? "当前使用" : "模板"}
                  </span>
                </div>
                <p className="mt-2.5 text-sm leading-6">{template.description}</p>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <WorkspaceMetric label="频道" value={template.channels.join(" / ")} />
                  <WorkspaceMetric label="通知" value={template.notificationPolicy} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {template.roles.map((role) => (
                    <span key={`${template.id}-${role}`} className="rounded-full border border-[var(--shock-ink)] bg-white px-3 py-1.5 font-mono text-[10px]">
                      {role}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">{template.notes[0]}</p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    data-testid={`setup-template-select-${template.id}`}
                    type="button"
                    disabled={Boolean(pendingTemplateId)}
                    onClick={() => void persistTemplate(template.id, { syncTemplateDefaults: true })}
                    className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busy ? "写回中..." : active ? "重新同步模板" : "选择模板"}
                  </button>
                </div>
              </Panel>
            );
          })}
        </div>

        <div className="space-y-3">
          <Panel tone="white" className="!p-3.5">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em]">当前启动包</p>
            <div className="mt-3 grid gap-2">
              <WorkspaceMetric label="模板" value={valueOrPlaceholder(materialization?.label || currentTemplate.label, currentTemplate.label)} testID="setup-onboarding-template-package" />
              <WorkspaceMetric label="回跳地址" value={valueOrPlaceholder(workspace.onboarding.resumeUrl, "/onboarding")} />
              <WorkspaceMetric label="通知策略" value={valueOrPlaceholder(materialization?.notificationPolicy, currentTemplate.notificationPolicy)} />
            </div>
            <div className="mt-3 space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">已落地频道</p>
              <p data-testid="setup-onboarding-materialized-channels" className="text-sm leading-6">
                {(materialization?.channels ?? currentTemplate.channels).join(" / ")}
              </p>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">已落地分工</p>
              <p data-testid="setup-onboarding-materialized-roles" className="text-sm leading-6">
                {(materialization?.roles ?? currentTemplate.roles).join(" · ")}
              </p>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">默认智能体</p>
              <p data-testid="setup-onboarding-materialized-agents" className="text-sm leading-6">
                {(materialization?.agents ?? currentTemplate.agents).join(" / ")}
              </p>
            </div>
            <div className="mt-3 space-y-2">
              {(materialization?.notes ?? currentTemplate.notes).map((note: string, index: number) => (
                <p key={`${currentTemplate.id}-note-${index}`} className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 text-sm leading-6">
                  {note}
                </p>
              ))}
            </div>
            <div className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em]">协作预览</p>
                  <p
                    data-testid="setup-governance-summary"
                    className="mt-2 max-w-2xl text-sm leading-6 text-[color:rgba(24,20,14,0.76)]"
                  >
                    {state.workspace.governance.summary}
                  </p>
                </div>
                <span
                  data-testid="setup-governance-template"
                  className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]"
                >
                  {state.workspace.governance.label}
                </span>
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                {state.workspace.governance.teamTopology.map((lane) => (
                  <div
                    key={lane.id}
                    data-testid={`setup-governance-lane-${lane.id}`}
                    className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-display text-lg font-semibold">{lane.label}</p>
                        <p className="mt-1 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{lane.role}</p>
                      </div>
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em]">{governanceLaneStatusLabel(lane.status)}</span>
                    </div>
                    <p
                      data-testid={`setup-governance-lane-${lane.id}-agent`}
                      className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]"
                    >
                      默认智能体：{valueOrPlaceholder(lane.defaultAgent, "未设置")}
                    </p>
                    <p className="mt-2 text-sm leading-6">{lane.summary}</p>
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          <Panel tone="paper" className="!p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em]">当前进度</p>
                <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">
                  步骤会随仓库、GitHub 和运行环境更新。
                </p>
              </div>
              <button
                data-testid="setup-onboarding-refresh-progress"
                type="button"
                disabled={Boolean(pendingTemplateId)}
                onClick={() => void persistTemplate(currentTemplate.id)}
                className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pendingTemplateId === currentTemplate.id ? "更新中..." : "刷新进度"}
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {ONBOARDING_STUDIO_STEPS.map((step) => {
                const completed = progress.completedSteps.includes(step.id);
                const active = progress.currentStep === step.id;
                return (
                  <Panel key={step.id} tone={stepTone(completed, active)} className="!p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-display text-lg font-semibold">{step.label}</p>
                        <p className="mt-1 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">{step.description}</p>
                      </div>
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em]">
                        {completed ? "已完成" : active ? "当前步骤" : "待开始"}
                      </span>
                    </div>
                  </Panel>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p data-testid="setup-onboarding-current-step" className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
                {onboardingStudioStepLabel(workspace.onboarding.currentStep || progress.currentStep)}
              </p>
              <button
                data-testid="setup-onboarding-finish"
                type="button"
                disabled={!progress.canFinish || Boolean(pendingTemplateId)}
                onClick={() => void persistTemplate(currentTemplate.id, { finished: true })}
                className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:opacity-60"
              >
                完成首次启动
              </button>
            </div>
          </Panel>

          {error ? (
            <p data-testid="setup-onboarding-error" className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 text-sm text-white">
              {error}
            </p>
          ) : null}
          {success ? (
            <p data-testid="setup-onboarding-success" className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3 text-sm">
              {success}
            </p>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

export function LiveSetupContextRail() {
  const { state, loading, error } = usePhaseZeroState();
  const {
    loading: runtimeLoading,
    error: runtimeError,
    pairing,
    runtimes,
    selectedRuntimeName,
  } = useLiveRuntimeTruth();
  const workspace = state.workspace;
  const registryRuntimes = state.runtimes.length > 0 ? state.runtimes : runtimes;
  const onlineRuntimes = registryRuntimes.filter((item) => item.state === "online").length;
  const staleRuntimes = registryRuntimes.filter((item) => item.state === "stale").length;

  return (
    <DetailRail
      label="开始前检查"
      items={[
        {
          label: "账号",
          value: loading
            ? "同步中"
            : error
              ? "未同步"
              : valueOrPlaceholder(workspace.deviceAuth, "待确认"),
        },
        {
          label: "仓库",
          value: loading
            ? "同步中"
            : error
              ? "未同步"
              : repoBindingStatusLabel(workspace.repoBindingStatus),
        },
        {
          label: "模板",
          value: loading
            ? "同步中"
            : error
              ? "未同步"
              : `${templateSurfaceLabel(workspace.onboarding.templateId)} / ${onboardingStatusLabel(workspace.onboarding.status)}`,
        },
        {
          label: "运行环境",
          value: loading || runtimeLoading
            ? "同步中"
            : error || runtimeError
              ? "未同步"
              : `${valueOrPlaceholder(selectedRuntimeName, "未选择")} / ${pairingStatusLabel(pairing?.pairingStatus || "")} / ${onlineRuntimes} 在线${staleRuntimes > 0 ? ` · ${staleRuntimes} 陈旧` : ""} / ${registryRuntimes.length} 台`,
        },
        {
          label: "拉取请求",
          value: loading
            ? "同步中"
            : error
              ? "未同步"
              : state.pullRequests.length > 0
                ? `${state.pullRequests.length} 条已同步`
                : "待产生",
        },
        {
          label: "配额",
          value: loading
            ? "同步中"
            : error
              ? "未同步"
              : `${valueOrPlaceholder(workspace.plan, "未命名计划")} / ${quotaStatusLabel(workspace.quota?.status)} / ${formatQuotaCounter(workspace.quota?.usedAgents, workspace.quota?.maxAgents, "个智能体")}`,
        },
      ]}
    />
  );
}

export function LiveSetupOverview() {
  const { state, loading, error } = usePhaseZeroState();
  const {
    loading: runtimeLoading,
    error: runtimeError,
    pairing,
    selection,
    leases,
    runtimes,
    scheduler,
    selectedRuntimeName,
    selectedRuntimeRecord,
  } = useLiveRuntimeTruth();
  const workspace = state.workspace;
  const registryRuntimes = state.runtimes.length > 0 ? state.runtimes : runtimes;
  const onlineRuntimes = registryRuntimes.filter((item) => item.state === "online").length;
  const staleRuntimes = registryRuntimes.filter((item) => item.state === "stale").length;
  const selectableRuntimes = registryRuntimes.filter((item) => item.state !== "offline" && item.daemonUrl).length;
  const runtimeMachines = selection?.runtimes ?? [];
  const pairingStatus = pairing?.pairingStatus || selection?.pairingStatus || workspace.pairingStatus;
  const selectedRuntimeLabel = valueOrPlaceholder(selectedRuntimeName, "未选择");
  const selectedRuntimeStateRecord =
    registryRuntimes.find((item) => item.machine === selectedRuntimeName || item.id === selectedRuntimeName) ?? null;
  const selectedRuntimeTruth = selectedRuntimeRecord ?? selectedRuntimeStateRecord;
  const selectedRuntimeCLI =
    selectedRuntimeTruth?.detectedCli.join(" + ") || selectedRuntimeTruth?.providers.map((item) => item.label).join(" / ");
  const selectedRuntimeInventory = runtimeProviderInventoryLabel(selectedRuntimeTruth?.providers ?? []);
  const selectedHeartbeatCadence = formatHeartbeatCadence(
    selectedRuntimeTruth?.heartbeatIntervalSeconds,
    selectedRuntimeTruth?.heartbeatTimeoutSeconds
  );
  const activeLeases = leases.filter((item) => runtimeLeaseIsActive(item.status));
  const assignedRuntimeLabel = valueOrPlaceholder(scheduler.assignedMachine || scheduler.assignedRuntime, "暂无");
  const blockedLeaseSession =
    state.sessions.find((item) => item.status === "blocked" && looksLikeRuntimeLeaseConflict(item.summary)) ?? null;
  const blockedLeaseInbox =
    state.inbox.find((item) => item.kind === "blocked" && looksLikeRuntimeLeaseConflict(item.summary)) ?? null;
  const leaseRecoveryNote = blockedLeaseSession?.controlNote?.trim() || blockedLeaseInbox?.summary?.trim() || "";

  if (loading || runtimeLoading) {
    return (
      <SetupStateNotice
        title="正在载入工作区"
        message="正在读取仓库、运行环境和模板状态。"
        tone="yellow"
      />
    );
  }

  if (error || runtimeError) {
    return (
      <SetupStateNotice
        title="工作区同步失败"
        message={error || runtimeError || "运行环境信息拉取失败"}
        tone="pink"
      />
    );
  }

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.05fr)_0.95fr]">
      <div className="grid gap-3 md:grid-cols-2">
        <SetupCheckpointCard
          title="仓库"
          summary={
            workspace.repoBindingStatus === "bound"
              ? `已连接到 ${valueOrPlaceholder(workspace.repoProvider, "代码平台")}，可以直接从聊天进入执行。`
              : "还没接通仓库，先把项目绑定好。"
          }
          active={workspace.repoBindingStatus === "bound"}
        />
        <SetupCheckpointCard
          title="运行环境"
          summary={
            registryRuntimes.length > 0
              ? `已发现 ${registryRuntimes.length} 台，其中 ${onlineRuntimes} 台在线${staleRuntimes > 0 ? `、${staleRuntimes} 台需要留意` : ""}；当前使用 ${selectedRuntimeLabel}。`
              : "先把运行环境接上，智能体才能真正开始干活。"
          }
          active={registryRuntimes.length > 0 && pairingStatus !== "unpaired"}
        />
        <SetupCheckpointCard
          title="协作主链"
          summary={
            state.rooms.length > 0 || state.pullRequests.length > 0
              ? `已有 ${state.rooms.length} 个讨论间、${state.pullRequests.length} 个拉取请求对象，主链已经可见。`
              : "讨论间和拉取请求对象还没出现，主链还在起步。"
          }
          active={state.rooms.length > 0 || state.pullRequests.length > 0}
        />
        <SetupCheckpointCard
          title="首次引导"
          summary={`模板 ${templateSurfaceLabel(workspace.onboarding.templateId)} · ${onboardingStatusLabel(workspace.onboarding.status)} · 回跳地址 ${valueOrPlaceholder(workspace.onboarding.resumeUrl, "/onboarding")}。`}
          active={workspace.onboarding.status !== "not_started"}
        />
      </div>

      <div className="space-y-3">
        <Panel tone="yellow" className="!p-3.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em]">工作区概览</p>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">先看仓库、运行环境和模板。</p>
            </div>
            <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
              {selectedRuntimeLabel} · {pairingStatusLabel(pairingStatus)}
            </span>
          </div>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            <WorkspaceMetric label="仓库" value={valueOrPlaceholder(workspace.repo, "仓库未返回")} />
            <WorkspaceMetric label="运行环境" value={`${selectedRuntimeLabel} / ${pairingStatusLabel(pairingStatus)}`} />
            <WorkspaceMetric label="模板" value={templateSurfaceLabel(workspace.onboarding.templateId)} testID="setup-onboarding-template" />
            <WorkspaceMetric label="引导状态" value={onboardingStatusLabel(workspace.onboarding.status)} testID="setup-onboarding-status" />
            <WorkspaceMetric label="GitHub" value={githubInstallLabel(workspace.githubInstallation.connectionReady, workspace.githubInstallation.appInstalled)} testID="setup-installation-status" />
          </dl>
          <details data-testid="setup-overview-technical-details" className="mt-3 rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3">
            <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
              展开更多技术细节
            </summary>
            <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
              已检测到 {state.runtimes.length} 条运行环境记录，有 {selectableRuntimes} 台可调度，默认使用 {selectedRuntimeLabel}
              {selectedRuntimeCLI ? `，CLI 为 ${selectedRuntimeCLI}` : ""}
              {selectedRuntimeInventory ? `，可用模型包括 ${selectedRuntimeInventory}` : ""}。
            </p>
            <dl className="mt-3 grid gap-2 sm:grid-cols-2">
              <WorkspaceMetric label="分支" value={valueOrPlaceholder(workspace.branch, "分支未返回")} />
              <WorkspaceMetric label="恢复入口" value={valueOrPlaceholder(workspace.onboarding.resumeUrl, "未声明")} testID="setup-onboarding-resume-url" />
              <WorkspaceMetric label="计划" value={valueOrPlaceholder(workspace.plan, "计划未返回")} />
              <WorkspaceMetric label="下一条执行线" value={assignedRuntimeLabel} />
              <WorkspaceMetric label="调度策略" value={runtimeSchedulerStrategyLabel(scheduler.strategy)} />
              <WorkspaceMetric label="心跳节奏" value={selectedHeartbeatCadence} />
              <WorkspaceMetric
                label="智能体配额"
                value={formatQuotaCounter(workspace.quota?.usedAgents, workspace.quota?.maxAgents, "个")}
              />
              <WorkspaceMetric
                label="讨论间 / 频道"
                value={`${formatQuotaCounter(workspace.quota?.usedRooms, workspace.quota?.maxRooms, "个讨论间")} · ${formatQuotaCounter(workspace.quota?.usedChannels, workspace.quota?.maxChannels, "个频道")}`}
              />
              <WorkspaceMetric label="保留期" value={formatRetentionSummary(workspace.quota)} />
              <WorkspaceMetric label="使用窗口" value={formatWorkspaceUsageWindow(workspace.usage)} />
              <WorkspaceMetric label="记忆模式" value={valueOrPlaceholder(workspace.memoryMode, "记忆模式未返回")} />
              <WorkspaceMetric
                label="命令壳"
                value={valueOrPlaceholder(selectedRuntimeTruth?.shell, "未返回")}
                testId="setup-selected-runtime-shell"
              />
            </dl>
            <p className="mt-3 rounded-[16px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2.5 text-sm leading-6">
              {scheduler.summary || "调度摘要还没同步。"}
            </p>
          </details>
          {workspace.usage?.warning || workspace.quota?.warning ? (
            <p className="mt-3 rounded-[16px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2.5 text-sm leading-6">
              {workspace.usage?.warning ?? workspace.quota?.warning}
            </p>
          ) : null}
        </Panel>
        {blockedLeaseSession ? (
          <Panel tone="pink" className="!p-3.5">
            <div data-testid="setup-runtime-lease-recovery">
              <p className="font-mono text-[11px] uppercase tracking-[0.24em]">运行环境恢复</p>
              <p className="mt-3 font-display text-2xl font-bold">当前有执行线被租约冲突挡住</p>
              <p className="mt-3 text-sm leading-6">{blockedLeaseSession.summary}</p>
              {leaseRecoveryNote ? (
                <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">{leaseRecoveryNote}</p>
              ) : null}
            </div>
          </Panel>
        ) : null}
        <details data-testid="setup-runtime-inventory-details" className="rounded-[28px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
          <summary className="cursor-pointer list-none font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">
            运行环境明细
          </summary>
          <div className="mt-3 space-y-2">
            {registryRuntimes.length === 0 ? (
              <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                还没注册运行环境。先完成本地桥接。
              </p>
            ) : (
              registryRuntimes.map((runtime) => {
                const selected = runtime.machine === selectedRuntimeName || runtime.id === selectedRuntimeName;
                const assigned = runtime.machine === scheduler.assignedMachine || runtime.id === scheduler.assignedRuntime;
                const machine = runtimeMachines.find((item) => item.name === runtime.machine || item.id === runtime.id);
                const candidate =
                  scheduler.candidates.find((item) => item.runtime === runtime.id || item.machine === runtime.machine) ?? null;
                const activeLeaseCount = activeLeases.filter(
                  (lease) => lease.runtime === runtime.id || lease.machine === runtime.machine
                ).length;
                return (
                  <div
                    key={runtime.id}
                    data-testid={`setup-runtime-card-${runtime.id}`}
                    className={cn(
                      "rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3",
                      assigned ? "bg-[var(--shock-lime)]" : selected ? "bg-[var(--shock-yellow)]" : "bg-white"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-display text-[18px] font-semibold leading-5">{runtime.machine}</p>
                        <p className="mt-1 text-sm text-[color:rgba(24,20,14,0.72)]">
                          {runtime.detectedCli.join(" + ") || machine?.cli || "未返回 CLI 标签"}
                        </p>
                      </div>
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em]">
                        {assigned ? "下一条执行线" : selected ? "当前所选" : runtimeStatusLabel(runtime.state)}
                      </span>
                    </div>
                    <div className="mt-3 space-y-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                      <p>{machine?.os || "本地"} / {machine?.lastHeartbeat || runtime.lastHeartbeatAt || "未返回心跳"}</p>
                      <p>{runtime.shell || machine?.shell || "命令壳未返回"}</p>
                      <p>{runtime.daemonUrl || "未配对本地桥"} / {pairingStateLabel(runtime.pairingState)}</p>
                      <p>{formatHeartbeatCadence(runtime.heartbeatIntervalSeconds, runtime.heartbeatTimeoutSeconds)}</p>
                      <p>活跃租约：{activeLeaseCount} / 可调度：{candidate?.schedulable ? "是" : "否"}</p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {runtime.providers.map((provider) => (
                        <span
                          key={`${runtime.id}-${provider.id}`}
                          className={cn(
                            "rounded-full border border-[var(--shock-ink)] px-3 py-1.5 font-mono text-[10px]",
                            runtimeProviderHealthTone(runtimeProviderHealthStatus(provider)) === "lime" && "bg-[var(--shock-lime)]",
                            runtimeProviderHealthTone(runtimeProviderHealthStatus(provider)) === "yellow" && "bg-[var(--shock-yellow)]",
                            runtimeProviderHealthTone(runtimeProviderHealthStatus(provider)) === "pink" && "bg-[var(--shock-pink)] text-white",
                            runtimeProviderHealthTone(runtimeProviderHealthStatus(provider)) === "paper" && "bg-[var(--shock-paper)]"
                          )}
                        >
                          {provider.label} · {runtimeProviderHealthLabel(runtimeProviderHealthStatus(provider))}
                        </span>
                      ))}
                    </div>
                    <div className="mt-2 space-y-1 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                      {runtime.providers.map((provider) => (
                        <p key={`${runtime.id}-${provider.id}-summary`}>
                          {runtimeProviderHealthSummary(provider)}
                        </p>
                      ))}
                    </div>
                    {candidate?.reason ? <p className="mt-2.5 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">{candidate.reason}</p> : null}
                  </div>
                );
              })
            )}
          </div>
        </details>
      </div>
    </div>
  );
}
