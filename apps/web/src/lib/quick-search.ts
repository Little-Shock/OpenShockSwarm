"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import type { PhaseZeroState, SearchResult as PhaseZeroSearchResult, SearchResultKind } from "@/lib/phase-zero-types";

export type QuickSearchEntryKind = SearchResultKind;

export type QuickSearchEntry = {
  id: string;
  kind: QuickSearchEntryKind;
  title: string;
  summary: string;
  meta: string;
  href: string;
};

type SearchEntry = PhaseZeroSearchResult;

function normalizeSearchText(...parts: Array<string | number | undefined>) {
  return parts
    .filter((part) => typeof part === "string" || typeof part === "number")
    .join(" ")
    .trim()
    .toLowerCase();
}

function buildQuickSearchEntries(state: PhaseZeroState): SearchEntry[] {
  if (state.quickSearchEntries.length > 0) {
    return state.quickSearchEntries;
  }

  const roomById = new Map(state.rooms.map((room) => [room.id, room]));
  const issueByKey = new Map(state.issues.map((issue) => [issue.key, issue]));

  function buildChannelWorkbenchHref(channelId: string, tab: "chat" | "followed" | "saved", threadId?: string) {
    const params = new URLSearchParams();
    if (tab !== "chat") {
      params.set("tab", tab);
    }
    if (threadId) {
      params.set("thread", threadId);
    }
    const query = params.toString();
    return query ? `/chat/${channelId}?${query}` : `/chat/${channelId}`;
  }

  return [
    ...state.channels.map((channel) => ({
      id: channel.id,
      kind: "channel" as const,
      title: `# ${channel.name}`,
      summary: channel.summary || channel.purpose || "频道入口",
      meta: `channel · unread ${channel.unread}`,
      href: `/chat/${channel.id}`,
      keywords: normalizeSearchText(channel.id, channel.name, channel.summary, channel.purpose, "channel"),
      order: 0,
    })),
    ...state.directMessages.map((dm) => ({
      id: dm.id,
      kind: "dm" as const,
      title: dm.name,
      summary: dm.summary || dm.purpose || "Direct message",
      meta: `dm · ${dm.presence} · unread ${dm.unread}`,
      href: buildChannelWorkbenchHref(dm.id, "chat"),
      keywords: normalizeSearchText(dm.id, dm.name, dm.summary, dm.purpose, dm.counterpart, dm.presence, "dm", "direct message"),
      order: 1,
    })),
    ...state.rooms.map((room) => ({
      id: room.id,
      kind: "room" as const,
      title: room.title,
      summary: room.summary || room.topic.summary || "讨论间工作台",
      meta: `room · ${room.issueKey} · ${room.topic.status}`,
      href: `/rooms/${room.id}`,
      keywords: normalizeSearchText(room.id, room.title, room.issueKey, room.summary, room.topic.title, room.topic.summary, room.topic.status, "room"),
      order: 2,
    })),
    ...state.issues.map((issue) => ({
      id: issue.id,
      kind: "issue" as const,
      title: issue.title,
      summary: `${issue.key} · ${issue.summary}`,
      meta: `issue · ${issue.priority} · ${issue.state}`,
      href: `/issues/${issue.key}`,
      keywords: normalizeSearchText(issue.id, issue.key, issue.title, issue.summary, issue.owner, issue.state, issue.priority, "issue"),
      order: 3,
    })),
    ...state.runs.map((run) => {
      const room = roomById.get(run.roomId);
      const issue = issueByKey.get(run.issueKey);

      return {
        id: run.id,
        kind: "run" as const,
        title: run.id,
        summary: `${run.issueKey} · ${issue?.title ?? room?.title ?? run.summary}`,
        meta: `run · ${run.status} · ${run.runtime} · ${run.machine}`,
        href: run.roomId ? `/rooms/${run.roomId}/runs/${run.id}` : `/runs/${run.id}`,
        keywords: normalizeSearchText(run.id, run.issueKey, run.summary, run.owner, run.runtime, run.machine, run.provider, run.status, room?.title, issue?.title, "run"),
        order: 4,
      };
    }),
    ...state.agents.map((agent) => ({
      id: agent.id,
      kind: "agent" as const,
      title: agent.name,
      summary: agent.description || `${agent.provider} · ${agent.runtimePreference}`,
      meta: `agent · ${agent.state} · ${agent.provider}`,
      href: `/agents/${agent.id}`,
      keywords: normalizeSearchText(agent.id, agent.name, agent.description, agent.state, agent.provider, agent.runtimePreference, agent.lane, ...agent.memorySpaces, "agent"),
      order: 5,
    })),
    ...state.followedThreads.map((item) => ({
      id: item.id,
      kind: "followed" as const,
      title: item.title,
      summary: item.summary,
      meta: `${item.channelLabel} · followed · unread ${item.unread}`,
      href: buildChannelWorkbenchHref(item.channelId, "followed", item.messageId),
      keywords: normalizeSearchText(item.id, item.channelId, item.messageId, item.channelLabel, item.title, item.summary, item.note, "followed", "thread"),
      order: 6,
    })),
    ...state.savedLaterItems.map((item) => ({
      id: item.id,
      kind: "saved" as const,
      title: item.title,
      summary: item.summary,
      meta: `${item.channelLabel} · later · unread ${item.unread}`,
      href: buildChannelWorkbenchHref(item.channelId, "saved", item.messageId),
      keywords: normalizeSearchText(item.id, item.channelId, item.messageId, item.channelLabel, item.title, item.summary, item.note, "saved", "later"),
      order: 7,
    })),
  ];
}

function filterQuickSearchEntries(entries: SearchEntry[], query: string) {
  const trimmedQuery = query.trim().toLowerCase();
  const terms = trimmedQuery.split(/\s+/).filter(Boolean);
  const visibleEntries = terms.length
    ? entries.filter((entry) => terms.every((term) => entry.keywords.includes(term)))
    : entries;

  return visibleEntries
    .sort((left, right) => {
      if (left.order !== right.order) {
        return left.order - right.order;
      }
      return left.title.localeCompare(right.title, "zh-Hans-CN");
    })
    .slice(0, 12)
    .map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      title: entry.title,
      summary: entry.summary,
      meta: entry.meta,
      href: entry.href,
    }));
}

export function useQuickSearchController(state: PhaseZeroState) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sessionKey, setSessionKey] = useState(0);
  const results = filterQuickSearchEntries(buildQuickSearchEntries(state), query);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSessionKey((current) => current + 1);
        setQuery("");
        setOpen(true);
        return;
      }

      if (event.key === "Escape" && open) {
        event.preventDefault();
        setOpen(false);
        setQuery("");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  function onOpenQuickSearch() {
    setSessionKey((current) => current + 1);
    setQuery("");
    setOpen(true);
  }

  function onCloseQuickSearch() {
    setOpen(false);
    setQuery("");
  }

  function onSelectQuickSearch(entry: QuickSearchEntry) {
    onCloseQuickSearch();
    router.push(entry.href);
  }

  return {
    open,
    query,
    results,
    sessionKey,
    onOpenQuickSearch,
    onCloseQuickSearch,
    onQueryChange: setQuery,
    onSelectQuickSearch,
  };
}
