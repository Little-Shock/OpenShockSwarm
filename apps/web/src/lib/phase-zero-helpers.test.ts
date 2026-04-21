import assert from "node:assert/strict";
import test from "node:test";

import type { PhaseZeroState } from "./phase-zero-types";

const { sanitizePhaseZeroState } = (await import(new URL("./phase-zero-helpers.ts", import.meta.url).href)) as typeof import("./phase-zero-helpers");

function buildState(): PhaseZeroState {
  return {
    workspace: {
      name: "OpenShock",
      repo: "Larkspur-Wang/OpenShock",
      repoUrl: "https://github.com/Larkspur-Wang/OpenShock",
      branch: "tff",
      repoProvider: "GitHub",
      repoBindingStatus: "ready",
      repoAuthMode: "app",
      plan: "网站交付",
      pairedRuntime: "shock-main",
      pairedRuntimeUrl: "http://127.0.0.1:44454",
      pairingStatus: "paired",
      deviceAuth: "trusted",
      lastPairedAt: "2026-04-21T00:00:00Z",
      browserPush: "selected-events",
      memoryMode: "governed",
      sandbox: {
        profile: "trusted",
      },
      repoBinding: {
        repo: "Larkspur-Wang/OpenShock",
        repoUrl: "https://github.com/Larkspur-Wang/OpenShock",
        branch: "tff",
        provider: "GitHub",
        bindingStatus: "ready",
        authMode: "app",
      },
      githubInstallation: {
        provider: "GitHub",
        connectionReady: true,
        appConfigured: true,
        appInstalled: true,
      },
      onboarding: {
        status: "ready",
        materialization: {
          agents: ["Codex Dockmaster", "Build Pilot", "Review Runner", "Memory Clerk"],
        },
      },
      governance: {
        templateId: "dev-team",
        label: "Website Delivery",
        summary: "四个 lane 前滚到交付。",
        configuredTopology: [
          {
            id: "architect",
            label: "Architect",
            role: "拆解与边界",
            defaultAgent: "Codex Dockmaster",
            lane: "shape / split",
          },
        ],
        deliveryDelegationMode: "formal-handoff",
        teamTopology: [
          {
            id: "architect",
            label: "Architect",
            role: "拆解与边界",
            defaultAgent: "Codex Dockmaster",
            lane: "shape / split",
            status: "ready",
            summary: "架构 lane 已待命。",
          },
          {
            id: "developer",
            label: "Developer",
            role: "实现与分支推进",
            defaultAgent: "Build Pilot",
            lane: "issue -> branch",
            status: "ready",
            summary: "开发 lane 已待命。",
          },
        ],
        handoffRules: [],
        routingPolicy: {
          status: "ready",
          summary: "按默认链路推进。",
          defaultRoute: "architect -> developer",
          rules: [],
          suggestedHandoff: {
            status: "idle",
            reason: "",
          },
        },
        escalationSla: {
          status: "ready",
          summary: "暂无升级。",
          timeoutMinutes: 30,
          retryBudget: 2,
          activeEscalations: 0,
          breachedEscalations: 0,
          nextEscalation: "",
          queue: [],
          rollup: [],
        },
        notificationPolicy: {
          status: "ready",
          summary: "只推关键提醒。",
          browserPush: "selected-events",
          targets: [],
          escalationChannel: "",
        },
        responseAggregation: {
          status: "ready",
          summary: "等待最终收口。",
          sources: [],
          finalResponse: "",
          aggregator: "",
          decisionPath: [],
          overrideTrace: [],
          auditTrail: [],
        },
        humanOverride: {
          status: "idle",
          summary: "暂无人工接管。",
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
    },
    auth: {
      session: {
        id: "session-owner",
        status: "active",
        preferences: {},
        permissions: [],
      },
      roles: [],
      members: [],
      devices: [],
    },
    channels: [],
    channelMessages: {},
    directMessages: [],
    directMessageMessages: {},
    followedThreads: [],
    savedLaterItems: [],
    quickSearchEntries: [],
    issues: [
      {
        id: "issue-website",
        key: "OPS-200",
        title: "Website delivery",
        summary: "ship website",
        state: "queued",
        priority: "high",
        owner: "Codex Dockmaster",
        roomId: "room-website",
        runId: "run-website",
        pullRequest: "PR-200",
        checklist: [],
      },
    ],
    rooms: [],
    roomMessages: {},
    runs: [],
    agents: [
      {
        id: "agent-codex-dockmaster",
        name: "Codex Dockmaster",
        description: "Lead agent",
        mood: "focused",
        state: "running",
        lane: "architect",
        role: "拆解与边界",
        avatar: "CD",
        prompt: "Architect lane prompt",
        operatingInstructions: "Stay on architect lane",
        provider: "Codex CLI",
        providerPreference: "",
        modelPreference: "",
        runtimePreference: "shock-main",
        recallPolicy: "workspace",
        memorySpaces: [],
        credentialProfileIds: [],
        sandbox: {
          profile: "trusted",
        },
        recentRunIds: [],
        profileAudit: [],
      },
    ],
    machines: [],
    runtimes: [],
    inbox: [],
    mailbox: [],
    roomAgentWaits: [],
    pullRequests: [],
    sessions: [],
    runtimeLeases: [],
    runtimeScheduler: {
      selectedRuntime: "",
      preferredRuntime: "",
      assignedRuntime: "",
      assignedMachine: "",
      strategy: "unavailable",
      summary: "",
      candidates: [],
    },
    guards: [],
    memory: [],
    credentials: [],
  } as unknown as PhaseZeroState;
}

test("sanitizePhaseZeroState preserves live agent names in governance and ownership surfaces", () => {
  const state = sanitizePhaseZeroState(buildState());

  assert.equal(state.workspace.governance.configuredTopology?.[0]?.defaultAgent, "Codex Dockmaster");
  assert.equal(state.workspace.governance.teamTopology[0]?.defaultAgent, "Codex Dockmaster");
  assert.equal(state.workspace.governance.teamTopology[1]?.defaultAgent, "Build Pilot");
  assert.equal(state.issues[0]?.owner, "Codex Dockmaster");
  assert.equal(state.agents[0]?.name, "Codex Dockmaster");
});

test("sanitizePhaseZeroState still simplifies onboarding template agent labels", () => {
  const state = sanitizePhaseZeroState(buildState());

  assert.deepEqual(state.workspace.onboarding.materialization?.agents, ["需求智能体", "开发智能体", "评审智能体", "测试智能体"]);
});
