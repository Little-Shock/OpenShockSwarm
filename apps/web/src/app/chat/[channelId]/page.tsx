import { notFound } from "next/navigation";

import { OpenShockShell } from "@/components/open-shock-shell";
import { ChatFeed, DetailRail } from "@/components/phase-zero-views";
import { getChannelById, getMessagesForChannel } from "@/lib/mock-data";

export default async function ChannelPage({
  params,
}: {
  params: Promise<{ channelId: string }>;
}) {
  const { channelId } = await params;
  const channel = getChannelById(channelId);

  if (!channel) notFound();

  return (
    <OpenShockShell
      view="chat"
      eyebrow="全局频道"
      title={channel.name}
      description={channel.purpose}
      selectedChannelId={channel.id}
      contextTitle="频道优先"
      contextDescription="全局频道保持轻松。一旦上下文开始涉及 owner、runtime 或 PR 真相，就应该升级进讨论间。"
      contextBody={
        <DetailRail
          label="频道约束"
          items={[
            { label: "用途", value: channel.summary },
            { label: "未读", value: String(channel.unread) },
            { label: "升级目标", value: "讨论间" },
            { label: "隐藏对象", value: "Session 不前台暴露" },
          ]}
        />
      }
    >
      <ChatFeed messages={getMessagesForChannel(channel.id)} />
    </OpenShockShell>
  );
}
