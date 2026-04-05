import { notFound } from "next/navigation";

import { OpenShockShell } from "@/components/open-shock-shell";
import { DetailRail, IssueDetailView } from "@/components/phase-zero-views";
import { getIssueByKey } from "@/lib/mock-data";

export default async function IssuePage({
  params,
}: {
  params: Promise<{ issueKey: string }>;
}) {
  const { issueKey } = await params;
  const issue = getIssueByKey(issueKey);

  if (!issue) notFound();

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
            { label: "讨论间", value: issue.roomId },
            { label: "Run", value: issue.runId },
            { label: "PR", value: issue.pullRequest },
            { label: "优先级", value: issue.priority === "critical" ? "关键" : issue.priority === "high" ? "高" : "中" },
          ]}
        />
      }
    >
      <IssueDetailView issue={issue} />
    </OpenShockShell>
  );
}
