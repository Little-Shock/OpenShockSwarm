import assert from "node:assert/strict";
import test from "node:test";

import type { AuthSession, WorkspaceSnapshot } from "./phase-zero-types";

const { buildFirstStartJourney } = (await import(
  new URL("./first-start-journey.ts", import.meta.url).href
)) as typeof import("./first-start-journey");

function buildWorkspace(overrides: Partial<WorkspaceSnapshot["onboarding"]> = {}): WorkspaceSnapshot {
  return {
    name: "OpenShock",
    repo: "",
    repoUrl: "",
    branch: "",
    repoProvider: "github",
    repoBindingStatus: "pending",
    repoAuthMode: "local-git-origin",
    plan: "Fresh Workspace",
    pairedRuntime: "",
    pairedRuntimeUrl: "",
    pairingStatus: "unpaired",
    deviceAuth: "browser-approved",
    lastPairedAt: "",
    browserPush: "只推高优先级",
    memoryMode: "MEMORY.md + notes/",
    sandbox: {
      profile: "trusted",
    },
    repoBinding: {
      repo: "",
      repoUrl: "",
      branch: "",
      provider: "github",
      bindingStatus: "pending",
      authMode: "local-git-origin",
    },
    githubInstallation: {
      provider: "github",
      connectionReady: false,
      appConfigured: false,
      appInstalled: false,
    },
    onboarding: {
      status: "in_progress",
      templateId: "dev-team",
      currentStep: "account",
      completedSteps: ["workspace-created", "template-selected"],
      resumeUrl: "/onboarding",
      materialization: {
        label: "开发团队",
        channels: [],
        roles: [],
        agents: [],
        notificationPolicy: "",
        notes: [],
      },
      ...overrides,
    },
    governance: {
      templateId: "dev-team",
      label: "开发团队协作流",
      summary: "",
      deliveryDelegationMode: "formal-handoff",
      teamTopology: [],
      handoffRules: [],
      routingPolicy: {
        status: "pending",
        summary: "",
        defaultRoute: "",
        suggestedHandoff: {
          status: "pending",
          reason: "",
        },
      },
      escalationSla: {
        status: "ready",
        summary: "",
        timeoutMinutes: 20,
        retryBudget: 2,
        activeEscalations: 0,
        breachedEscalations: 0,
        nextEscalation: "",
      },
      notificationPolicy: {
        status: "ready",
        summary: "",
        browserPush: "",
        targets: [],
        escalationChannel: "",
      },
      responseAggregation: {
        status: "pending",
        summary: "",
        sources: [],
        finalResponse: "",
        aggregator: "",
        decisionPath: [],
        overrideTrace: [],
        auditTrail: [],
      },
      humanOverride: {
        status: "idle",
        summary: "",
        href: "",
      },
      walkthrough: [],
      stats: {
        openHandoffs: 0,
        blockedEscalations: 0,
        reviewGates: 0,
        humanOverrideGates: 0,
        slaBreaches: 0,
        aggregationSources: 0,
      },
    },
  } as unknown as WorkspaceSnapshot;
}

function buildSession(overrides: Partial<AuthSession> = {}): AuthSession {
  return {
    id: "session-owner",
    memberId: "member-owner",
    email: "owner@openshock.local",
    status: "active",
    role: "owner",
    permissions: [],
    authMethod: "local-bootstrap",
    emailVerificationStatus: "verified",
    deviceAuthStatus: "authorized",
    preferences: {
      startRoute: "/chat/all",
    },
    ...overrides,
  } as unknown as AuthSession;
}

test("buildFirstStartJourney sends signed-out users to access first", () => {
  const journey = buildFirstStartJourney(
    buildWorkspace(),
    buildSession({ status: "signed_out", emailVerificationStatus: "pending", deviceAuthStatus: "pending" })
  );

  assert.equal(journey.nextHref, "/access");
  assert.equal(journey.nextLabel, "先登录");
  assert.equal(journey.steps[0]?.status, "active");
  assert.equal(journey.steps[1]?.status, "pending");
});

test("buildFirstStartJourney keeps unverified identity on access before setup", () => {
  const journey = buildFirstStartJourney(buildWorkspace(), buildSession({ deviceAuthStatus: "pending" }));

  assert.equal(journey.nextHref, "/access");
  assert.equal(journey.nextLabel, "确认邮箱和设备");
  assert.equal(journey.steps[1]?.status, "active");
  assert.equal(journey.steps[2]?.status, "pending");
});

test("buildFirstStartJourney uses plain template label when setup is next", () => {
  const journey = buildFirstStartJourney(buildWorkspace(), buildSession());

  assert.equal(journey.nextHref, "/onboarding");
  assert.equal(journey.nextLabel, "继续引导");
  assert.match(journey.steps[2]?.summary ?? "", /开发团队/);
  assert.doesNotMatch(journey.steps[2]?.summary ?? "", /dev-team/);
});

test("buildFirstStartJourney launches chat after onboarding is done", () => {
  const journey = buildFirstStartJourney(
    buildWorkspace({ status: "done", resumeUrl: "/chat/all" }),
    buildSession({ preferences: { startRoute: "/rooms" } })
  );

  assert.equal(journey.nextHref, "/rooms");
  assert.equal(journey.nextLabel, "进入聊天");
  assert.equal(journey.steps[2]?.status, "ready");
});

test("buildFirstStartJourney still requires access when onboarding is done but session is signed out", () => {
  const journey = buildFirstStartJourney(
    buildWorkspace({ status: "done", currentStep: "bootstrap-finished", resumeUrl: "/chat/all" }),
    buildSession({ status: "signed_out", emailVerificationStatus: "pending", deviceAuthStatus: "pending" })
  );

  assert.equal(journey.nextHref, "/access");
  assert.equal(journey.nextLabel, "先登录");
  assert.equal(journey.steps[0]?.status, "active");
});

test("buildFirstStartJourney treats bootstrap-finished as launch-ready once identity is ready", () => {
  const journey = buildFirstStartJourney(
    buildWorkspace({
      status: "ready",
      currentStep: "bootstrap-finished",
      completedSteps: ["template-selected", "repo-bound", "github-ready", "runtime-paired", "bootstrap-finished"],
      resumeUrl: "/onboarding?template=dev-team",
    }),
    buildSession({ preferences: { startRoute: "/rooms" } })
  );

  assert.equal(journey.nextHref, "/rooms");
  assert.equal(journey.nextLabel, "进入聊天");
  assert.equal(journey.steps[2]?.status, "ready");
});

test("buildFirstStartJourney treats bootstrap-finished onboarding as launchable even before status is normalized", () => {
  const journey = buildFirstStartJourney(
    buildWorkspace({
      status: "ready",
      currentStep: "bootstrap-finished",
      completedSteps: ["workspace-created", "template-selected", "bootstrap-finished"],
      resumeUrl: "/onboarding?template=dev-team",
    }),
    buildSession()
  );

  assert.equal(journey.nextHref, "/chat/all");
  assert.equal(journey.nextLabel, "进入聊天");
  assert.equal(journey.steps[2]?.status, "ready");
});
