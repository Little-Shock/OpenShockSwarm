"use client";

import { OpenShockShell } from "@/components/open-shock-shell";
import {
  DetailRail,
  IssueDetailView,
  IssuesListView,
  RunDetailView,
} from "@/components/phase-zero-views";
import { usePhaseZeroState } from "@/lib/live-phase0";
import { fallbackState, type Issue } from "@/lib/mock-data";

function priorityLabel(priority: Issue["priority"]) {
  switch (priority) {
    case "critical":
      return "关键";
    case "high":
      return "高";
    default:
      return "中";
  }
}

function getResolvedState<T>(items: T[], fallbackItems: T[]) {
  return items.length > 0 ? items : fallbackItems;
}

export function LiveIssuesListView() {
  const { state } = usePhaseZeroState();
  const issues = getResolvedState(state.issues, fallbackState.issues);

  return <IssuesListView issues={issues} />;
}

export function LiveIssuePageContent({ issueKey }: { issueKey: string }) {
  const { state } = usePhaseZeroState();
  const issues = getResolvedState(state.issues, fallbackState.issues);
  const rooms = getResolvedState(state.rooms, fallbackState.rooms);
  const runs = getResolvedState(state.runs, fallbackState.runs);
  const issue =
    issues.find((candidate) => candidate.key.toLowerCase() === issueKey.toLowerCase()) ??
    fallbackState.issues.find((candidate) => candidate.key.toLowerCase() === issueKey.toLowerCase());

  if (!issue) {
    return (
      <OpenShockShell
        view="issues"
        eyebrow="Issue 详情"
        title="未找到需求"
        description="这个 Issue 可能已经被移除，或者本地状态还没有同步到前端。"
        contextTitle="State Sync"
        contextDescription="刷新一下本地服务或重新从任务板进入。"
      >
        <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-6 py-6 text-base">
          当前找不到 `{issueKey}` 对应的 Issue。
        </div>
      </OpenShockShell>
    );
  }

  const run = runs.find((candidate) => candidate.id === issue.runId);
  const room = rooms.find((candidate) => candidate.id === issue.roomId);

  return (
    <OpenShockShell
      view="issues"
      eyebrow="Issue 详情"
      title={issue.key}
      description={issue.summary}
      selectedRoomId={issue.roomId}
      contextTitle={issue.owner}
      contextDescription="对用户来说，耐久对象仍然是 Issue，但真正谈执行、谈协商、谈闭环的地方已经变成讨论间。"
      contextBody={
        <DetailRail
          label="Issue 链接"
          items={[
            { label: "讨论间", value: room?.title ?? issue.roomId },
            { label: "Run", value: run?.id ?? issue.runId },
            { label: "PR", value: issue.pullRequest },
            { label: "优先级", value: priorityLabel(issue.priority) },
          ]}
        />
      }
    >
      <IssueDetailView issue={issue} run={run} roomTitle={room?.title} />
    </OpenShockShell>
  );
}

export function LiveRunPageContent({
  roomId,
  runId,
}: {
  roomId: string;
  runId: string;
}) {
  const { state } = usePhaseZeroState();
  const rooms = getResolvedState(state.rooms, fallbackState.rooms);
  const runs = getResolvedState(state.runs, fallbackState.runs);
  const room = rooms.find((candidate) => candidate.id === roomId);
  const run = runs.find((candidate) => candidate.id === runId && candidate.roomId === roomId);

  if (!room || !run) {
    return (
      <OpenShockShell
        view="rooms"
        eyebrow="Run 详情"
        title="未找到 Run"
        description="这个 Run 可能还没同步，或者对应房间已经变化。"
        selectedRoomId={roomId}
        contextTitle="Run Sync"
        contextDescription="从讨论间重新进入通常就能拿到最新状态。"
      >
        <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-6 py-6 text-base">
          当前找不到 `{runId}` 的执行详情。
        </div>
      </OpenShockShell>
    );
  }

  return (
    <OpenShockShell
      view="rooms"
      eyebrow="Run 详情"
      title={run.id}
      description="Run 详情就是执行真相面：runtime、分支、worktree、日志、工具调用、审批状态和收口目标都在这里。"
      selectedRoomId={room.id}
      contextTitle={run.issueKey}
      contextDescription="每个活跃 Topic 都应该产出一个可见 Run。人类需要在 30 秒内定位问题落点。"
      contextBody={
        <DetailRail
          label="执行泳道"
          items={[
            { label: "负责人", value: run.owner },
            { label: "Provider", value: run.provider },
            { label: "开始时间", value: run.startedAt },
            { label: "时长", value: run.duration },
          ]}
        />
      }
    >
      <RunDetailView run={run} />
    </OpenShockShell>
  );
}
