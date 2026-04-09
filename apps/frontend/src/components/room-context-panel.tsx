"use client";

import { useState } from "react";
import { AgentObservabilityDrawer } from "@/components/agent-observability-drawer";
import { DeliveryPRAction } from "@/components/delivery-pr-action";
import { RoomSystemPanel } from "@/components/room-system-panel";
import { TaskCreateDialog } from "@/components/task-create-dialog";
import { TaskStatusControl } from "@/components/task-status-control";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { InfoHint } from "@/components/ui/info-hint";
import { WorkspaceRepoBinding } from "@/components/workspace-repo-binding";
import type {
  Agent,
  AgentSession,
  AgentTurn,
  AgentWait,
  DeliveryPR,
  HandoffRecord,
  IntegrationBranch,
  Issue,
  Run,
  Runtime,
  Task,
  Workspace,
} from "@/lib/types";

type RoomContextPanelProps = {
  workspace: Workspace;
  issue?: Issue;
  agents: Agent[];
  runtimes: Runtime[];
  sessions: AgentSession[];
  turns: AgentTurn[];
  waits: AgentWait[];
  handoffs: HandoffRecord[];
  tasks: Task[];
  runs: Run[];
  integrationBranch?: IntegrationBranch;
  deliveryPr: DeliveryPR | null;
  messageCount: number;
};

type RoomTab = "issue" | "tasks" | "system";

function statusTone(value: string): BadgeTone {
  switch (value) {
    case "completed":
    case "done":
    case "integrated":
    case "ready_for_delivery":
      return "green";
    case "running":
    case "in_progress":
    case "collecting":
    case "integrating":
      return "blue";
    case "blocked":
    case "approval_required":
    case "failed":
    case "conflicted":
      return "orange";
    default:
      return "neutral";
  }
}

function agentName(agentId: string, agents: Agent[]) {
  return agents.find((agent) => agent.id === agentId)?.name ?? agentId;
}

function TaskList({
  tasks,
  agents,
}: {
  tasks: Task[];
  agents: Agent[];
}) {
  return (
    <div className="divide-y divide-[var(--border)] rounded-[12px] border border-[var(--border)] bg-white">
      {tasks.map((task) => (
        <div key={task.id} className="px-3 py-2.5">
          <div className="mb-1.5 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="display-font text-[13px] font-black">{task.title}</div>
              <div className="mt-0.5 text-[11px] text-black/55">
                {agentName(task.assigneeAgentId, agents)} · {task.branchName}
              </div>
            </div>
            <TaskStatusControl
              taskId={task.id}
              taskTitle={task.title}
              status={task.status}
            />
          </div>
          {task.description ? (
            <p className="text-[12px] leading-4.5 text-black/68">{task.description}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function RoomContextPanel({
  workspace,
  issue,
  agents,
  runtimes,
  sessions,
  turns,
  waits,
  handoffs,
  tasks,
  runs,
  integrationBranch,
  deliveryPr,
  messageCount,
}: RoomContextPanelProps) {
  const tabOrder: RoomTab[] = issue ? ["issue", "tasks", "system"] : ["system"];
  const [activeTab, setActiveTab] = useState<RoomTab>(tabOrder[0]);
  const defaultRepoBinding = workspace.repoBindings.find((binding) => binding.isDefault);
  const mergedCount = integrationBranch?.mergedTaskIds.length ?? 0;
  const mergeProgress = tasks.length > 0 ? Math.round((mergedCount / tasks.length) * 100) : 0;
  const activeRuns = runs.filter((run) =>
    ["queued", "running", "approval_required", "blocked"].includes(run.status),
  );
  const roomAgentIdSet = new Set<string>();
  for (const session of sessions) {
    roomAgentIdSet.add(session.agentId);
  }
  for (const turn of turns) {
    roomAgentIdSet.add(turn.agentId);
  }
  for (const wait of waits) {
    roomAgentIdSet.add(wait.agentId);
  }
  for (const handoff of handoffs) {
    roomAgentIdSet.add(handoff.fromAgentId);
    roomAgentIdSet.add(handoff.toAgentId);
  }
  for (const task of tasks) {
    if (task.assigneeAgentId) {
      roomAgentIdSet.add(task.assigneeAgentId);
    }
  }
  for (const run of runs) {
    if (run.agentId) {
      roomAgentIdSet.add(run.agentId);
    }
  }
  const roomAgentIds = Array.from(roomAgentIdSet);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border)] bg-white">
        <div className="flex h-12 items-center px-3">
          <Eyebrow className="text-black/50">Context</Eyebrow>
        </div>
        <div className="flex h-10 items-center gap-1.5 px-3">
          {tabOrder.map((tab) => {
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`control-pill transition ${
                  active
                    ? "bg-[var(--accent-blue-soft)] text-[var(--accent-blue)]"
                    : "bg-[var(--surface-muted)] text-black/55 hover:bg-white"
                }`}
              >
                {tab}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {activeTab === "issue" && issue ? (
          <div className="space-y-2.5">
            <Card className="rounded-[12px] px-3 py-2.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <Eyebrow>Issue</Eyebrow>
                <Badge tone={statusTone(issue.status)}>{issue.status.replaceAll("_", " ")}</Badge>
              </div>
              <div className="display-font text-sm font-black">{issue.title}</div>
              <p className="mt-1 text-[12px] leading-4.5 text-black/68">{issue.summary}</p>
            </Card>

            <Card className="rounded-[12px] px-3 py-2.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <Eyebrow>Workspace Repo</Eyebrow>
                <Badge tone={defaultRepoBinding ? "green" : "orange"}>
                  {defaultRepoBinding ? "default" : "required"}
                </Badge>
              </div>
              <WorkspaceRepoBinding workspaceId={workspace.id} bindings={workspace.repoBindings} />
            </Card>

            <Card className="rounded-[12px] px-3 py-2.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <Eyebrow>Integration</Eyebrow>
                {integrationBranch ? (
                  <Badge tone={statusTone(integrationBranch.status)}>
                    {integrationBranch.status.replaceAll("_", " ")}
                  </Badge>
                ) : null}
              </div>
              <div className="display-font text-2xl font-black">{mergeProgress}%</div>
              <div className="mt-0.5 text-[12px] text-black/65">
                {mergedCount} / {tasks.length} tasks integrated
              </div>
            </Card>

            <Card className="rounded-[12px] px-3 py-2.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <Eyebrow>Delivery</Eyebrow>
                <Badge tone={deliveryPr ? statusTone(deliveryPr.status) : "neutral"}>
                  {deliveryPr ? deliveryPr.status.replaceAll("_", " ") : "not created"}
                </Badge>
              </div>
              <DeliveryPRAction
                issueId={issue.id}
                integrationStatus={integrationBranch?.status ?? "collecting"}
                existingDeliveryPRId={deliveryPr?.id ?? null}
              />
            </Card>
          </div>
        ) : null}

        {activeTab === "tasks" && issue ? (
          <div className="space-y-2.5">
            <Card className="rounded-[12px] px-3 py-2.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <Eyebrow>Task Actions</Eyebrow>
                <Badge tone="blue-soft">{tasks.length} total</Badge>
              </div>
              <div className="space-y-3">
                <div className="rounded-[16px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(247,248,250,0.96),rgba(255,255,255,0.98))] px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="action-card-title">Add to current issue</div>
                        <InfoHint label="在当前 issue 下新建任务，并直接分配给对应 agent。" />
                      </div>
                    </div>
                    <TaskCreateDialog
                      issueId={issue.id}
                      agents={agents}
                      buttonLabel="New Task"
                      buttonVariant="primary"
                      buttonSize="sm"
                    />
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-[12px] border border-[var(--border)] bg-white px-3 py-2.5">
                      <div className="action-card-label">Current issue</div>
                      <div className="action-card-value mt-1">{issue.id.replace("_", "#")}</div>
                    </div>
                    <div className="rounded-[12px] border border-[var(--border)] bg-white px-3 py-2.5">
                      <div className="action-card-label">Agent pool</div>
                      <div className="action-card-value mt-1">{agents.length} available</div>
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="rounded-[12px] px-3 py-2.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <Eyebrow>Tasks</Eyebrow>
                <Badge tone="dark">{tasks.length}</Badge>
              </div>
              {tasks.length > 0 ? (
                <TaskList tasks={tasks} agents={agents} />
              ) : (
                <p className="text-[12px] text-black/60">No tasks yet.</p>
              )}
            </Card>

            <Card className="rounded-[12px] px-3 py-2.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <Eyebrow>Runs</Eyebrow>
                <Badge tone="blue-soft">{activeRuns.length} active</Badge>
              </div>
              <div className="space-y-1.5">
                {runs.length > 0 ? (
                  runs.map((run) => (
                    <div
                      key={run.id}
                      className="flex items-center justify-between rounded-[10px] border border-[var(--border)] bg-white px-2.5 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-medium">{run.title}</div>
                        <div className="text-[10px] uppercase tracking-[0.12em] text-black/45">
                          {run.id}
                        </div>
                      </div>
                      <Badge tone={statusTone(run.status)}>{run.status.replaceAll("_", " ")}</Badge>
                    </div>
                  ))
                ) : (
                  <p className="text-[12px] text-black/60">No runs yet.</p>
                )}
              </div>
            </Card>
          </div>
        ) : null}

        {activeTab === "system" ? (
          <div className="space-y-2.5">
            <RoomSystemPanel
              agents={agents}
              runtimes={runtimes}
              sessions={sessions}
              turns={turns}
              waits={waits}
              handoffs={handoffs}
              messageCount={messageCount}
            />
            <AgentObservabilityDrawer
              agents={agents}
              sessions={sessions}
              turns={turns}
              waits={waits}
              handoffs={handoffs}
              candidateAgentIds={roomAgentIds}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
