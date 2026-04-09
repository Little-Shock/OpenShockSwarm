"use client";

import Link from "next/link";
import { useState } from "react";

import { DetailRail, Panel } from "@/components/phase-zero-views";
import { buildFirstStartJourney, type FirstStartJourneyStepStatus } from "@/lib/first-start-journey";
import { usePhaseZeroState } from "@/lib/live-phase0";
import { useLiveRuntimeTruth } from "@/lib/live-runtime";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function valueOrPlaceholder(value: string | undefined, fallback: string) {
  return value && value.trim() ? value : fallback;
}

function formatHeartbeatCadence(interval?: number, timeout?: number) {
  if (!interval && !timeout) {
    return "未返回 cadence";
  }
  const intervalLabel = interval ? `${interval}s interval` : "interval 未返回";
  const timeoutLabel = timeout ? `${timeout}s timeout` : "timeout 未返回";
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
    return "ready";
  }
  if (installed) {
    return "installed";
  }
  return "pending";
}

function runtimeSchedulerStrategyLabel(strategy: string) {
  switch (strategy) {
    case "selected_runtime":
      return "沿用 Selection";
    case "agent_preference":
      return "按 Owner 偏好";
    case "least_loaded":
      return "按 Lease 压力";
    case "failover":
      return "自动 Failover";
    default:
      return "待调度";
  }
}

function runtimeProviderInventoryLabel(
  providers: Array<{ label: string; models?: string[] }>
) {
  return providers
    .map((provider) => {
      const models = (provider.models ?? []).length > 0 ? (provider.models ?? []).join(" / ") : "no models";
      return `${provider.label}: ${models}`;
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
      return "进入观察";
    case "healthy":
      return "健康";
    default:
      return "待同步";
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
  return `${quota.messageHistoryDays ?? 0}d 消息 / ${quota.runLogDays ?? 0}d Run / ${quota.memoryDraftDays ?? 0}d 草稿`;
}

function formatWorkspaceUsageWindow(usage?: { totalTokens?: number; windowLabel?: string }) {
  if (!usage) {
    return "未返回";
  }
  return `${formatCount(usage.totalTokens)} tokens / ${valueOrPlaceholder(usage.windowLabel, "窗口未返回")}`;
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
    <Panel tone={statusTone(active)} className="!p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
            {active ? "已接通" : "待补全"}
          </p>
          <h3 className="mt-1.5 font-display text-[24px] font-bold leading-7">{title}</h3>
        </div>
        <span
          className={cn(
            "rounded-full border-2 border-[var(--shock-ink)] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em]",
            active ? "bg-[var(--shock-lime)]" : "bg-white"
          )}
        >
          {active ? "live" : "pending"}
        </span>
      </div>
      <p className="mt-2.5 text-sm leading-6">{summary}</p>
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
  { id: "template-selected", label: "模板已选", description: "先把团队模板和 bootstrap package 收成 workspace truth。" },
  { id: "repo-bound", label: "Repo 已绑定", description: "首次启动继续沿 current repo binding truth 推进。" },
  { id: "github-ready", label: "GitHub 已接通", description: "GitHub install / connection truth 不再停在 setup 注释里。" },
  { id: "runtime-paired", label: "Runtime 已配对", description: "pairing 与 selection 已经站住，首次启动不再卡在本地桥接。 " },
  { id: "bootstrap-finished", label: "启动已完成", description: "workspace 可以从 `/setup` 正式切回主工作面。" },
] as const;

const ONBOARDING_TEMPLATE_DEFINITIONS: OnboardingTemplateDefinition[] = [
  {
    id: "dev-team",
    label: "开发团队",
    eyebrow: "Ship Fast",
    description: "把 shiproom、review lane 和 release 观察面先立住，适合产品/架构/开发/评审一起推进。",
    defaultPlan: "Dev Team Launch",
    defaultBrowserPush: "blocked / review / release gate",
    defaultMemoryMode: "governed-first / delivery notes",
    channels: ["#shiproom", "#review-lane", "#ops-watch"],
    roles: ["PM", "Architect", "Developer", "Reviewer", "QA"],
    agents: ["Spec Captain", "Build Pilot", "Review Runner", "QA Relay"],
    notificationPolicy: "blocked / review / release gate 优先推送",
    notes: [
      "默认先围 shiproom 收主线，再把 review / release 风险抬到 review-lane 与 ops-watch。",
      "模板现在会直接给出 PM / Architect / Developer / Reviewer / QA 的治理拓扑，并把 reviewer-tester loop 锚到同一份 workspace truth。",
    ],
  },
  {
    id: "research-team",
    label: "研究团队",
    eyebrow: "Evidence First",
    description: "把 intake、evidence、synthesis 三条线摆清，适合探索、归纳和 reviewer 收口。",
    defaultPlan: "Research Team Launch",
    defaultBrowserPush: "evidence ready / synthesis blocked / reviewer feedback",
    defaultMemoryMode: "evidence-first / synthesis ledger",
    channels: ["#intake", "#evidence", "#synthesis"],
    roles: ["Research Lead", "Collector", "Synthesizer", "Reviewer"],
    agents: ["Collector", "Synthesizer", "Review Runner"],
    notificationPolicy: "evidence ready / synthesis blocked / reviewer feedback 优先推送",
    notes: [
      "默认先把 intake -> evidence -> synthesis 三条线组织清楚，不让 board 抢回主导航。",
      "模板会把 evidence -> synthesis -> reviewer 的治理链直接铺成可见 topology，blocked escalation 不再只藏在 prompt 里。",
      "模板会保留 resumable progress，reload / restart 后继续回到 setup truth。",
    ],
  },
  {
    id: "blank-custom",
    label: "空白自定义",
    eyebrow: "Lean Start",
    description: "只给最小协作骨架，先把 repo / install / runtime 打通，再按团队自己的语言长出来。",
    defaultPlan: "Custom Workspace Bootstrap",
    defaultBrowserPush: "only high-priority + explicit review",
    defaultMemoryMode: "notes-first / bootstrap minimal",
    channels: ["#all", "#roadmap", "#announcements"],
    roles: ["Owner / Member / Viewer"],
    agents: ["Starter Agent", "Review Agent"],
    notificationPolicy: "只推高优先级与显式 review 事件",
    notes: [
      "这版只固化最小骨架，不静默替你生成更重的治理拓扑。",
      "即使是空白模板，也会保留最小 handoff / review / human-override 骨架，避免协作链完全失语。",
      "适合先验证 setup 主链，再逐步补齐团队自己的默认对象。",
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
    resumeUrl: finished ? "/chat/all" : `/setup?template=${templateId}`,
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
  const { state } = usePhaseZeroState();
  const journey = buildFirstStartJourney(state.workspace, state.auth.session);
  const onboardingLabel = valueOrPlaceholder(state.workspace.onboarding.status, "not_started");

  return (
    <Panel tone={journey.onboardingDone ? "lime" : journey.accessReady ? "yellow" : "paper"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">first-start bridge</p>
          <h2 className="mt-2 font-display text-3xl font-bold">Setup 现在直接镜像同一条首次启动路径，不再默认你已经收平了 `/access`</h2>
        </div>
        <span
          data-testid="setup-first-start-next-route"
          className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]"
        >
          {journey.nextHref}
        </span>
      </div>
      <p
        data-testid="setup-first-start-summary"
        className="mt-3 max-w-3xl text-sm leading-6 text-[color:rgba(24,20,14,0.78)]"
      >
        {journey.nextSummary}
      </p>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <WorkspaceMetric label="next action" value={journey.nextLabel} testID="setup-first-start-next-label" />
        <WorkspaceMetric label="launch route" value={journey.launchHref} testID="setup-first-start-launch-route" />
        <WorkspaceMetric label="onboarding" value={onboardingLabel} testID="setup-first-start-onboarding-status" />
      </div>
      <div className="mt-5 grid gap-3 xl:grid-cols-3">
        {journey.steps.map((step) => (
          <Panel key={step.id} tone={journeyTone(step.status)} className="!p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-display text-2xl font-bold">{step.label}</p>
                <p
                  data-testid={`setup-first-start-step-${step.id}-summary`}
                  className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]"
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
          access recovery 和 onboarding progress 现在读的是同一份 next-step truth；如果身份链没接通，这里会直接把你送回 `/access`，而不是让 setup 自己假装已经 ready。
        </p>
      </div>
    </Panel>
  );
}

export function OnboardingStudioPanel() {
  const { state, updateWorkspaceConfig, updateWorkspaceMemberPreferences } = usePhaseZeroState();
  const workspace = state.workspace;
  const currentTemplate = onboardingTemplateDefinition(workspace.onboarding.templateId);
  const materialization = workspace.onboarding.materialization;
  const progress = buildOnboardingStudioProgress(workspace, currentTemplate.id, workspace.onboarding.status === "done");
  const sessionMember = state.auth.members.find((member) => member.id === state.auth.session.memberId);

  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
          ? "onboarding studio 已收口为 done；workspace 会把 `/chat/all` 当成下一跳，而不是继续停在 setup。"
          : syncTemplateDefaults
            ? `${definition.label} 模板已经写回 workspace truth；reload / restart 后会继续从当前 setup step 恢复。`
            : "onboarding progress 已按当前 live truth 前滚；已有 workspace config 不会被模板默认值静默覆盖。"
      );
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "workspace onboarding update failed");
    } finally {
      setPendingTemplateId(null);
    }
  }

  return (
    <Panel tone="lime">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">onboarding studio</p>
          <h2 className="mt-2 font-display text-3xl font-bold">把模板选择、首次启动步骤和 bootstrap package 收成可恢复真值</h2>
        </div>
        <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
          {valueOrPlaceholder(workspace.onboarding.status, "未开始")}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
        `#127` 这层不再让 onboarding 只是 setup 页上的静态提示。模板选择、当前 step、恢复入口，以及 bootstrap package
        都要跟 workspace durable truth 同源；团队拓扑、reviewer-tester loop 和 human override 也会在这里直接预览出来。
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
                    {active ? "current" : "template"}
                  </span>
                </div>
                <p className="mt-2.5 text-sm leading-6">{template.description}</p>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <WorkspaceMetric label="channels" value={template.channels.join(" / ")} />
                  <WorkspaceMetric label="notify" value={template.notificationPolicy} />
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
            <p className="font-mono text-[11px] uppercase tracking-[0.22em]">当前 bootstrap package</p>
            <div className="mt-3 grid gap-2">
              <WorkspaceMetric label="template" value={valueOrPlaceholder(materialization?.label || currentTemplate.label, currentTemplate.label)} testID="setup-onboarding-template-package" />
              <WorkspaceMetric label="resume" value={valueOrPlaceholder(workspace.onboarding.resumeUrl, "/setup")} />
              <WorkspaceMetric label="notify" value={valueOrPlaceholder(materialization?.notificationPolicy, currentTemplate.notificationPolicy)} />
            </div>
            <div className="mt-3 space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">materialized channels</p>
              <p data-testid="setup-onboarding-materialized-channels" className="text-sm leading-6">
                {(materialization?.channels ?? currentTemplate.channels).join(" / ")}
              </p>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">materialized agent roles</p>
              <p data-testid="setup-onboarding-materialized-roles" className="text-sm leading-6">
                {(materialization?.roles ?? currentTemplate.roles).join(" · ")}
              </p>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">bootstrap agents</p>
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
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em]">governance preview</p>
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
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em]">{lane.status}</span>
                    </div>
                    <p className="mt-2 text-sm leading-6">{lane.summary}</p>
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          <Panel tone="paper" className="!p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em]">resumable steps</p>
                <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">
                  当前 step 由 live repo / GitHub / runtime truth 推导，不再靠浏览器局部状态猜。
                </p>
              </div>
              <button
                data-testid="setup-onboarding-refresh-progress"
                type="button"
                disabled={Boolean(pendingTemplateId)}
                onClick={() => void persistTemplate(currentTemplate.id)}
                className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pendingTemplateId === currentTemplate.id ? "同步中..." : "刷新进度"}
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
                        {completed ? "done" : active ? "next" : "pending"}
                      </span>
                    </div>
                  </Panel>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p data-testid="setup-onboarding-current-step" className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
                {valueOrPlaceholder(workspace.onboarding.currentStep, progress.currentStep)}
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
      label="配置检查点"
      items={[
        {
          label: "身份",
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
              : valueOrPlaceholder(workspace.repoBindingStatus, "待绑定"),
        },
        {
          label: "Onboarding",
          value: loading
            ? "同步中"
            : error
              ? "未同步"
              : `${valueOrPlaceholder(workspace.onboarding.templateId, "未选模板")} / ${valueOrPlaceholder(workspace.onboarding.status, "未声明")}`,
        },
        {
          label: "Runtime",
          value: loading || runtimeLoading
            ? "同步中"
            : error || runtimeError
              ? "未同步"
              : `${valueOrPlaceholder(selectedRuntimeName, "未选择")} / ${pairingStatusLabel(pairing?.pairingStatus || "")} / ${onlineRuntimes} 在线${staleRuntimes > 0 ? ` · ${staleRuntimes} 陈旧` : ""} / ${registryRuntimes.length} 台`,
        },
        {
          label: "PR 链路",
          value: loading
            ? "同步中"
            : error
              ? "未同步"
              : state.pullRequests.length > 0
                ? `${state.pullRequests.length} 条 live PR`
                : "待产生",
        },
        {
          label: "Quota",
          value: loading
            ? "同步中"
            : error
              ? "未同步"
              : `${valueOrPlaceholder(workspace.plan, "未命名计划")} / ${quotaStatusLabel(workspace.quota?.status)} / ${formatQuotaCounter(workspace.quota?.usedAgents, workspace.quota?.maxAgents, "agents")}`,
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
        title="正在同步工作区真值"
        message="等待 server 返回当前 repo binding、runtime registry、heartbeat 与 selection；这页不再先摆一套本地 seed workspace。"
        tone="yellow"
      />
    );
  }

  if (error || runtimeError) {
    return (
      <SetupStateNotice
        title="工作区同步失败"
        message={error || runtimeError || "runtime truth fetch failed"}
        tone="pink"
      />
    );
  }

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.05fr)_0.95fr]">
      <div className="grid gap-3 md:grid-cols-2">
        <SetupCheckpointCard
          title="仓库绑定"
          summary={
            workspace.repoBindingStatus === "bound"
              ? `当前仓库已绑定到 ${valueOrPlaceholder(workspace.repoProvider, "代码平台")}，可继续沿 live repo truth 推进。`
              : "当前工作区还没有把本地仓库真绑定到 OpenShock。"
          }
          active={workspace.repoBindingStatus === "bound"}
        />
        <SetupCheckpointCard
          title="Runtime 配对"
          summary={
            registryRuntimes.length > 0
              ? `runtime registry 当前已登记 ${registryRuntimes.length} 台，其中 ${onlineRuntimes} 台在线${staleRuntimes > 0 ? `、${staleRuntimes} 台心跳陈旧` : ""}；当前 selection 是 ${selectedRuntimeLabel}，配对状态为 ${pairingStatusLabel(pairingStatus)}，下一条 lane 目标是 ${assignedRuntimeLabel}。`
              : "当前还没有已登记的 runtime registry；先完成 daemon pairing，再继续验证 selection 与 bridge。"
          }
          active={registryRuntimes.length > 0 && pairingStatus !== "unpaired"}
        />
        <SetupCheckpointCard
          title="讨论间闭环"
          summary={
            state.rooms.length > 0
              ? `当前已有 ${state.rooms.length} 个 live room，Issue / Room / Run 链路已经可见。`
              : "当前还没有 live room，讨论间链路尚未显现。"
          }
          active={state.rooms.length > 0}
        />
        <SetupCheckpointCard
          title="PR 收口"
          summary={
            state.pullRequests.length > 0
              ? `当前已有 ${state.pullRequests.length} 个 live PR 对象，收口面不再停留在静态文案。`
              : "当前还没有 live PR 对象，收口链路仍待产生。"
          }
          active={state.pullRequests.length > 0}
        />
        <SetupCheckpointCard
          title="Onboarding 恢复"
          summary={`当前模板 ${valueOrPlaceholder(workspace.onboarding.templateId, "未声明")}，状态 ${valueOrPlaceholder(workspace.onboarding.status, "未声明")}，current step 为 ${valueOrPlaceholder(workspace.onboarding.currentStep, "未声明")}。reload / restart 后仍应回到 ${valueOrPlaceholder(workspace.onboarding.resumeUrl, "/setup")}。`}
          active={workspace.onboarding.status !== "not_started"}
        />
      </div>

      <div className="space-y-3">
        <Panel tone="yellow" className="!p-3.5">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">工作区在线状态</p>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            <WorkspaceMetric label="仓库" value={valueOrPlaceholder(workspace.repo, "当前未返回 repo")} />
            <WorkspaceMetric label="分支" value={valueOrPlaceholder(workspace.branch, "当前未返回 branch")} />
            <WorkspaceMetric label="计划" value={valueOrPlaceholder(workspace.plan, "当前未返回 plan")} />
            <WorkspaceMetric label="Runtime" value={`${selectedRuntimeLabel} / ${pairingStatusLabel(pairingStatus)}`} />
            <WorkspaceMetric
              label="Shell"
              value={valueOrPlaceholder(selectedRuntimeTruth?.shell, "未返回")}
              testId="setup-selected-runtime-shell"
            />
            <WorkspaceMetric label="下一条 Lane" value={assignedRuntimeLabel} />
            <WorkspaceMetric label="调度策略" value={runtimeSchedulerStrategyLabel(scheduler.strategy)} />
            <WorkspaceMetric label="心跳节奏" value={selectedHeartbeatCadence} />
            <WorkspaceMetric
              label="Quota"
              value={formatQuotaCounter(workspace.quota?.usedAgents, workspace.quota?.maxAgents, "agents")}
            />
            <WorkspaceMetric
              label="Room / Channel"
              value={`${formatQuotaCounter(workspace.quota?.usedRooms, workspace.quota?.maxRooms, "rooms")} · ${formatQuotaCounter(workspace.quota?.usedChannels, workspace.quota?.maxChannels, "channels")}`}
            />
            <WorkspaceMetric label="保留期" value={formatRetentionSummary(workspace.quota)} />
            <WorkspaceMetric label="Usage 窗口" value={formatWorkspaceUsageWindow(workspace.usage)} />
            <WorkspaceMetric label="记忆" value={valueOrPlaceholder(workspace.memoryMode, "当前未返回 memory mode")} />
            <WorkspaceMetric label="模板" value={valueOrPlaceholder(workspace.onboarding.templateId, "未选模板")} testID="setup-onboarding-template" />
            <WorkspaceMetric label="Onboarding" value={valueOrPlaceholder(workspace.onboarding.status, "未声明")} testID="setup-onboarding-status" />
            <WorkspaceMetric label="恢复入口" value={valueOrPlaceholder(workspace.onboarding.resumeUrl, "未声明")} testID="setup-onboarding-resume-url" />
            <WorkspaceMetric label="GitHub Install" value={githubInstallLabel(workspace.githubInstallation.connectionReady, workspace.githubInstallation.appInstalled)} testID="setup-installation-status" />
          </dl>
          <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
            当前 runtime control plane 已把 registry、selection 与 pairing 拆开：主状态里已收下 {state.runtimes.length} 条 runtime truth，
            当前有 {selectableRuntimes} 台可调度，默认指向 {selectedRuntimeLabel}
            {selectedRuntimeCLI ? `，CLI 为 ${selectedRuntimeCLI}` : ""}
            {selectedRuntimeInventory ? `，provider/model catalog 为 ${selectedRuntimeInventory}` : ""}。
          </p>
          {workspace.usage?.warning || workspace.quota?.warning ? (
            <p className="mt-3 rounded-[16px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2.5 text-sm leading-6">
              {workspace.usage?.warning ?? workspace.quota?.warning}
            </p>
          ) : null}
          <p className="mt-3 rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5 text-sm leading-6">
            {scheduler.summary || "当前还没有 scheduler truth。"}
          </p>
        </Panel>
        {blockedLeaseSession ? (
          <Panel tone="pink" className="!p-3.5">
            <div data-testid="setup-runtime-lease-recovery">
              <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Runtime Lease Recovery</p>
              <p className="mt-3 font-display text-2xl font-bold">当前有 lane 被 lease conflict 挡住</p>
              <p className="mt-3 text-sm leading-6">{blockedLeaseSession.summary}</p>
              {leaseRecoveryNote ? (
                <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">{leaseRecoveryNote}</p>
              ) : null}
            </div>
          </Panel>
        ) : null}
        <Panel tone="paper" className="!p-3.5">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">多 Runtime 真值</p>
          <div className="mt-3 space-y-2">
            {registryRuntimes.length === 0 ? (
              <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                当前还没有已注册 runtime。先完成 daemon 配对，再继续做 selection 和调度验证。
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
                        {assigned ? "next lane" : selected ? "selected" : runtimeStatusLabel(runtime.state)}
                      </span>
                    </div>
                    <div className="mt-3 space-y-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                      <p>{machine?.os || "Local"} / {machine?.lastHeartbeat || runtime.lastHeartbeatAt || "未返回心跳"}</p>
                      <p>{runtime.shell || machine?.shell || "shell 未返回"}</p>
                      <p>{runtime.daemonUrl || "未配对 daemon"} / {pairingStateLabel(runtime.pairingState)}</p>
                      <p>{formatHeartbeatCadence(runtime.heartbeatIntervalSeconds, runtime.heartbeatTimeoutSeconds)}</p>
                      <p>active leases: {activeLeaseCount} / schedulable: {candidate?.schedulable ? "yes" : "no"}</p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {runtime.providers.map((provider) => (
                        <span
                          key={`${runtime.id}-${provider.id}`}
                          className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1.5 font-mono text-[10px]"
                        >
                          {provider.label}: {(provider.models ?? []).join(" / ") || "no models"}
                        </span>
                      ))}
                    </div>
                    {candidate?.reason ? <p className="mt-2.5 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">{candidate.reason}</p> : null}
                  </div>
                );
              })
            )}
          </div>
        </Panel>
        <Panel tone="ink" className="!p-3.5 shadow-[6px_6px_0_0_var(--shock-pink)]">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">当前协作基线</p>
          <ol className="mt-3 space-y-2 text-sm leading-6 text-white/78">
            <li>1. Workspace 直接显示 live repo / branch / runtime selection 真值。</li>
            <li>2. Setup 不再把静态步骤卡当成当前环境状态。</li>
            <li>3. 当前工作区已有 {state.issues.length} 条 live issue、{state.runs.length} 条 live run。</li>
            <li>4. 当前已注册 {registryRuntimes.length} 台 runtime，selection 为 {selectedRuntimeLabel}，下一条 lane 指向 {assignedRuntimeLabel}，active lease 为 {activeLeases.length} 条。</li>
          </ol>
        </Panel>
      </div>
    </div>
  );
}
