import type { AuthSession, WorkspaceSnapshot } from "@/lib/phase-zero-types";

export type FirstStartJourneyStepStatus = "pending" | "active" | "ready";

export type FirstStartJourneyStep = {
  id: "session" | "identity" | "setup";
  label: string;
  status: FirstStartJourneyStepStatus;
  summary: string;
  href: string;
};

export type FirstStartJourney = {
  accessReady: boolean;
  onboardingDone: boolean;
  onboardingStarted: boolean;
  nextHref: string;
  nextLabel: string;
  nextSummary: string;
  launchHref: string;
  steps: FirstStartJourneyStep[];
};

function normalized(value?: string) {
  return value?.trim().toLowerCase() ?? "";
}

function sessionIsActive(session: AuthSession) {
  return normalized(session.status) === "active";
}

function emailVerificationReady(session: AuthSession) {
  return normalized(session.emailVerificationStatus) !== "pending";
}

function deviceAuthorizationReady(session: AuthSession) {
  return normalized(session.deviceAuthStatus) !== "pending";
}

function onboardingIsDone(workspace: WorkspaceSnapshot) {
  return normalized(workspace.onboarding.status) === "done";
}

function onboardingIsStarted(workspace: WorkspaceSnapshot) {
  return normalized(workspace.onboarding.status) !== "not_started";
}

function setupResumeHref(workspace: WorkspaceSnapshot) {
  const resume = workspace.onboarding.resumeUrl?.trim();
  if (resume) {
    return resume;
  }
  const template = workspace.onboarding.templateId?.trim();
  if (template) {
    return `/setup?template=${template}`;
  }
  return "/setup";
}

function launchHref(session: AuthSession) {
  const preferred = session.preferences.startRoute?.trim();
  if (preferred && preferred !== "/access" && preferred !== "/setup") {
    return preferred;
  }
  return "/chat/all";
}

function accessSummary(session: AuthSession) {
  if (!sessionIsActive(session)) {
    return "当前还没有 active session；先在 `/access` 建立或恢复当前成员会话。";
  }
  return `当前 session 已接通：${session.email?.trim() || "当前成员"}。`;
}

function identitySummary(session: AuthSession) {
  if (!sessionIsActive(session)) {
    return "先建立 active session，邮箱验证和设备授权才有确定落点。";
  }
  if (!emailVerificationReady(session)) {
    return "邮箱还在 pending；先把 verify 链收平，再继续首次启动。";
  }
  if (!deviceAuthorizationReady(session)) {
    return "当前设备还在 pending；先在 `/access` 授权当前设备。";
  }
  return "邮箱验证和当前设备授权都已接通，不需要再来回猜 access recovery。";
}

function setupSummary(workspace: WorkspaceSnapshot) {
  if (onboardingIsDone(workspace)) {
    return `onboarding 已收口为 done；当前下一跳已经切到 ${setupResumeHref(workspace)}。`;
  }

  const template = workspace.onboarding.templateId?.trim() || "未选模板";
  const status = workspace.onboarding.status?.trim() || "not_started";
  const currentStep = workspace.onboarding.currentStep?.trim() || "template-selected";
  return `当前模板 ${template}，onboarding = ${status}，current step = ${currentStep}；继续沿 ${setupResumeHref(workspace)} 收平即可。`;
}

export function buildFirstStartJourney(workspace: WorkspaceSnapshot, session: AuthSession): FirstStartJourney {
  const activeSession = sessionIsActive(session);
  const identityReady = activeSession && emailVerificationReady(session) && deviceAuthorizationReady(session);
  const onboardingDone = onboardingIsDone(workspace);
  const onboardingStarted = onboardingIsStarted(workspace);
  const resumeHref = setupResumeHref(workspace);
  const finalLaunchHref = launchHref(session);

  let nextHref = "/access";
  let nextLabel = "先回 Access";
  let nextSummary = "当前还没把 active session / recovery truth 接通；先在 `/access` 把身份链收平。";

  if (!activeSession) {
    nextHref = "/access";
    nextLabel = "建立会话";
    nextSummary = "先登录或恢复当前成员会话，再继续首次启动。";
  } else if (!emailVerificationReady(session)) {
    nextHref = "/access";
    nextLabel = "完成邮箱验证";
    nextSummary = "邮箱还在 pending；先在 `/access` 把 verify 链走完。";
  } else if (!deviceAuthorizationReady(session)) {
    nextHref = "/access";
    nextLabel = "授权当前设备";
    nextSummary = "当前设备还没授权；先在 `/access` 收平 device approval。";
  } else if (!onboardingDone) {
    nextHref = resumeHref;
    nextLabel = onboardingStarted ? "继续首次启动" : "开始首次启动";
    nextSummary = `身份链已经接通；下一步直接沿 ${resumeHref} 继续模板 / repo / runtime / finish flow。`;
  } else {
    nextHref = finalLaunchHref;
    nextLabel = "进入主工作面";
    nextSummary = `首次启动已经完成；默认下一跳现在是 ${finalLaunchHref}。`;
  }

  const steps: FirstStartJourneyStep[] = [
    {
      id: "session",
      label: "建立会话",
      status: activeSession ? "ready" : "active",
      summary: accessSummary(session),
      href: "/access",
    },
    {
      id: "identity",
      label: "验证邮箱与设备",
      status: identityReady ? "ready" : activeSession ? "active" : "pending",
      summary: identitySummary(session),
      href: "/access",
    },
    {
      id: "setup",
      label: "完成首次启动",
      status: onboardingDone ? "ready" : identityReady ? "active" : "pending",
      summary: setupSummary(workspace),
      href: onboardingDone ? finalLaunchHref : resumeHref,
    },
  ];

  return {
    accessReady: identityReady,
    onboardingDone,
    onboardingStarted,
    nextHref,
    nextLabel,
    nextSummary,
    launchHref: finalLaunchHref,
    steps,
  };
}
