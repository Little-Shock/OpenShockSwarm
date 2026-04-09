"use client";

import Link from "next/link";

import { OpenShockShell } from "@/components/open-shock-shell";
import { Panel } from "@/components/phase-zero-views";
import type { PullRequestConversationEntry, PullRequestDetail } from "@/lib/phase-zero-types";

function pullRequestStatusLabel(status?: string) {
  switch (status) {
    case "draft":
      return "草稿";
    case "open":
      return "已打开";
    case "in_review":
      return "评审中";
    case "changes_requested":
      return "待修改";
    case "merged":
      return "已合并";
    default:
      return "待同步";
  }
}

function conversationKindLabel(kind: PullRequestConversationEntry["kind"]) {
  switch (kind) {
    case "review":
      return "Review";
    case "review_comment":
      return "Review Comment";
    case "review_thread":
      return "Thread";
    default:
      return "Comment";
  }
}

function conversationTone(kind: PullRequestConversationEntry["kind"]) {
  switch (kind) {
    case "review":
      return "bg-[var(--shock-lime)]";
    case "review_thread":
      return "bg-[var(--shock-purple)] text-white";
    case "review_comment":
      return "bg-[var(--shock-yellow)]";
    default:
      return "bg-white";
  }
}

function SurfaceStateMessage({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <Panel tone="white">
      <p className="font-display text-[24px] font-bold leading-7">{title}</p>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{message}</p>
    </Panel>
  );
}

function FactTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5">
      <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">{label}</p>
      <p className="mt-1.5 font-display text-[18px] font-semibold">{value}</p>
    </div>
  );
}

export function PullRequestDetailView({
  detail,
  error,
}: {
  detail: PullRequestDetail | null;
  error?: string | null;
}) {
  const contextTitle = detail
    ? `${detail.pullRequest.label} · ${pullRequestStatusLabel(detail.pullRequest.status)}`
    : "Pull Request Detail";
  const contextDescription = detail
    ? detail.pullRequest.reviewSummary
    : "Review conversation、thread state 和 Room / Inbox / Remote PR back-links 会在这里收成单一真值。";

  return (
    <OpenShockShell
      view="runs"
      eyebrow="Review Conversation"
      title="Pull Request Detail"
      description="这页把 PR review、评论线程和相关 back-links 收成一个 detail surface，不再只剩房间里的 summary 文案。"
      contextTitle={contextTitle}
      contextDescription={contextDescription}
      contextBody={
        detail ? (
          <div className="grid gap-2 md:grid-cols-3">
            <FactTile label="Room" value={detail.room.title} />
            <FactTile label="Run" value={detail.run.id} />
            <FactTile label="Issue" value={detail.issue.key} />
          </div>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {error ? (
          <SurfaceStateMessage title="PR detail 同步失败" message={error} />
        ) : !detail ? (
          <SurfaceStateMessage
            title="当前没有 PR detail"
            message="这条 PR 可能已经不存在，或当前 detail payload 还没有准备好。"
          />
        ) : (
          <>
            <Panel tone="white">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">
                    {detail.pullRequest.label} / {pullRequestStatusLabel(detail.pullRequest.status)}
                  </p>
                  <h2 className="mt-2 font-display text-[30px] font-bold leading-8">{detail.pullRequest.title}</h2>
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                    {detail.pullRequest.reviewSummary}
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <FactTile label="Branch" value={detail.pullRequest.branch} />
                  <FactTile label="Base" value={detail.pullRequest.baseBranch ?? "待同步"} />
                  <FactTile label="Reviewer Truth" value={detail.pullRequest.reviewDecision || "REVIEW_REQUIRED"} />
                  <FactTile label="Updated" value={detail.pullRequest.updatedAt} />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/rooms/${detail.room.id}?tab=pr`}
                  className="border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                >
                  Room PR Tab
                </Link>
                <Link
                  href={`/rooms/${detail.room.id}?tab=run`}
                  className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                >
                  Run Context
                </Link>
                <Link
                  href="/inbox"
                  className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                >
                  Inbox Back-link
                </Link>
                {detail.pullRequest.url ? (
                  <Link
                    href={detail.pullRequest.url}
                    target="_blank"
                    rel="noreferrer"
                    className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                  >
                    Remote PR
                  </Link>
                ) : null}
              </div>
            </Panel>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <Panel tone="paper">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                      Review Conversation
                    </p>
                    <p className="mt-2 font-display text-[22px] font-bold">Comment / Thread Timeline</p>
                  </div>
                  <span className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                    {detail.conversation.length} entries
                  </span>
                </div>
                <div className="mt-4 space-y-3">
                  {detail.conversation.length === 0 ? (
                    <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                      当前还没有持久化 review/comment/thread ledger。后续 webhook replay 或 fresh webhook delivery 会把 exact conversation backfill 到这里。
                    </p>
                  ) : (
                    detail.conversation.map((entry) => (
                      <article
                        key={entry.id}
                        className="border-2 border-[var(--shock-ink)] bg-white px-4 py-4 shadow-[var(--shock-shadow-sm)]"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full border border-[var(--shock-ink)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] ${conversationTone(entry.kind)}`}
                          >
                            {conversationKindLabel(entry.kind)}
                          </span>
                          <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.56)]">{entry.author}</span>
                          <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.56)]">{entry.updatedAt || "刚刚"}</span>
                          {entry.threadStatus ? (
                            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                              {entry.threadStatus}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-3 text-sm leading-6">{entry.summary}</p>
                        {entry.body ? (
                          <p className="mt-3 rounded-[12px] border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                            {entry.body}
                          </p>
                        ) : null}
                        <div className="mt-3 flex flex-wrap gap-2">
                          {entry.path ? (
                            <span className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px]">
                              {entry.path}
                              {entry.line ? `:${entry.line}` : ""}
                            </span>
                          ) : null}
                          {entry.reviewDecision ? (
                            <span className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px]">
                              {entry.reviewDecision}
                            </span>
                          ) : null}
                          {entry.url ? (
                            <Link
                              href={entry.url}
                              target="_blank"
                              rel="noreferrer"
                              className="border border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-2 py-1 font-mono text-[10px]"
                            >
                              Remote Comment
                            </Link>
                          ) : null}
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </Panel>

              <div className="space-y-4">
                <Panel tone="yellow">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                    Related Inbox Signals
                  </p>
                  <div className="mt-4 space-y-3">
                    {detail.relatedInbox.length === 0 ? (
                      <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                        当前没有和这条 PR 直接关联的 inbox signal。
                      </p>
                    ) : (
                      detail.relatedInbox.map((item) => (
                        <div key={item.id} className="border-2 border-[var(--shock-ink)] bg-white px-3 py-3">
                          <p className="font-display text-[18px] font-bold">{item.title}</p>
                          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{item.summary}</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <span className="border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-2 py-1 font-mono text-[10px]">
                              {item.kind}
                            </span>
                            <Link
                              href={item.href}
                              className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px]"
                            >
                              Open Context
                            </Link>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </Panel>

                <Panel tone="white">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                    Context Back-links
                  </p>
                  <div className="mt-4 space-y-3">
                    <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3">
                      <p className="font-display text-[18px] font-bold">{detail.room.title}</p>
                      <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{detail.room.summary}</p>
                    </div>
                    <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3">
                      <p className="font-display text-[18px] font-bold">{detail.run.id}</p>
                      <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{detail.run.summary}</p>
                    </div>
                    <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3">
                      <p className="font-display text-[18px] font-bold">{detail.issue.key}</p>
                      <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{detail.issue.summary}</p>
                    </div>
                  </div>
                </Panel>
              </div>
            </div>
          </>
        )}
      </div>
    </OpenShockShell>
  );
}
