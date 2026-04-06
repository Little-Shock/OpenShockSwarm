"use client";

import Link from "next/link";
import { useState } from "react";

import { DetailRail, Panel } from "@/components/phase-zero-views";
import {
  type NotificationPreference,
  useBrowserNotificationSurface,
} from "@/lib/browser-notifications";
import { usePhaseZeroState } from "@/lib/live-phase0";
import type { InboxItem, Room } from "@/lib/mock-data";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function inboxKindLabel(kind: InboxItem["kind"]) {
  switch (kind) {
    case "approval":
      return "需要批准";
    case "blocked":
      return "阻塞";
    case "review":
      return "评审";
    default:
      return "状态";
  }
}

function inboxKindTone(kind: InboxItem["kind"]) {
  switch (kind) {
    case "approval":
      return "bg-[var(--shock-yellow)]";
    case "blocked":
      return "bg-[var(--shock-pink)] text-white";
    case "review":
      return "bg-[var(--shock-lime)]";
    default:
      return "bg-white";
  }
}

function permissionLabel(permission: NotificationPermission | "unsupported") {
  switch (permission) {
    case "granted":
      return "已授权";
    case "denied":
      return "已拒绝";
    case "default":
      return "待确认";
    default:
      return "浏览器不支持";
  }
}

function registrationLabel(state: "idle" | "registering" | "ready" | "blocked" | "error") {
  switch (state) {
    case "registering":
      return "注册中";
    case "ready":
      return "已注册";
    case "blocked":
      return "不可注册";
    case "error":
      return "注册失败";
    default:
      return "未注册";
  }
}

function preferenceLabel(preference: NotificationPreference) {
  switch (preference) {
    case "all":
      return "全部事件";
    case "critical":
      return "仅高信号";
    case "mute":
      return "静默";
    default:
      return "继承工作区默认值";
  }
}

function FactTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">{label}</p>
      <p className="mt-2 font-display text-xl font-semibold">{value}</p>
    </div>
  );
}

function StatusRow({
  label,
  value,
  tone = "white",
}: {
  label: string;
  value: string;
  tone?: "white" | "yellow" | "lime" | "pink";
}) {
  return (
    <div
      className={cn(
        "rounded-[18px] border-2 border-[var(--shock-ink)] px-4 py-3",
        tone === "yellow" && "bg-[var(--shock-yellow)]",
        tone === "lime" && "bg-[var(--shock-lime)]",
        tone === "pink" && "bg-[var(--shock-pink)] text-white",
        tone === "white" && "bg-white"
      )}
    >
      <p
        className={cn(
          "font-mono text-[10px] uppercase tracking-[0.18em]",
          tone === "pink" ? "text-white/78" : "text-[color:rgba(24,20,14,0.62)]"
        )}
      >
        {label}
      </p>
      <p className="mt-2 text-sm leading-6">{value}</p>
    </div>
  );
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-[20px] border-2 border-dashed border-[var(--shock-ink)] bg-white px-5 py-5">
      <p className="font-display text-2xl font-bold">{title}</p>
      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{message}</p>
    </div>
  );
}

function unreadRoomLabel(room: Room) {
  return `${room.title} · ${room.unread} unread`;
}

export function LiveSettingsContextRail() {
  const { state, loading, error } = usePhaseZeroState();
  const channelUnread = loading || error ? 0 : state.channels.reduce((sum, channel) => sum + channel.unread, 0);
  const roomUnread = loading || error ? 0 : state.rooms.reduce((sum, room) => sum + room.unread, 0);

  return (
    <DetailRail
      label="Notify Truth"
      items={[
        {
          label: "Inbox",
          value: loading ? "同步中" : error ? "读取失败" : `${state.inbox.length} signals`,
        },
        {
          label: "Unread",
          value: loading ? "同步中" : error ? "读取失败" : `${channelUnread + roomUnread} total`,
        },
        {
          label: "Browser Push",
          value: loading ? "同步中" : error ? "读取失败" : state.workspace.browserPush || "未设置",
        },
        {
          label: "Email",
          value: "#56 / #58 待接通",
        },
      ]}
    />
  );
}

export function LiveSettingsView() {
  const { state, loading, error } = usePhaseZeroState();
  const {
    preference,
    setPreference,
    surface,
    requestPermission,
    registerBrowserSurface,
    sendTestNotification,
  } = useBrowserNotificationSurface();
  const [busyAction, setBusyAction] = useState<"permission" | "register" | "test" | null>(null);
  const [surfaceMessage, setSurfaceMessage] = useState<string | null>(null);
  const serverTruthLabel = loading ? "同步中" : error ? "读取失败" : null;

  const inboxItems = loading || error ? [] : state.inbox;
  const unreadChannels = loading || error ? [] : state.channels.filter((channel) => channel.unread > 0);
  const unreadRooms = loading || error ? [] : state.rooms.filter((room) => room.unread > 0);
  const channelUnread = unreadChannels.reduce((sum, channel) => sum + channel.unread, 0);
  const roomUnread = unreadRooms.reduce((sum, room) => sum + room.unread, 0);
  const blockedCount = inboxItems.filter((item) => item.kind === "blocked").length;
  const approvalCount = inboxItems.filter((item) => item.kind === "approval").length;
  const reviewCount = inboxItems.filter((item) => item.kind === "review").length;
  const serverPolicy = serverTruthLabel ?? (state.workspace.browserPush || "未设置");
  const currentBrowserStrategy =
    preference === "inherit"
      ? loading
        ? "继承工作区默认值（同步中）"
        : error
          ? "继承链失联（server 默认值读取失败）"
          : "继承工作区默认值"
      : `${preferenceLabel(preference)}（本地 override）`;
  const effectivePreference = preference === "inherit" ? serverPolicy : preferenceLabel(preference);
  const inboxSignalValue = serverTruthLabel ?? String(inboxItems.length);
  const blockedCountValue = serverTruthLabel ?? String(blockedCount);
  const channelUnreadValue = serverTruthLabel ?? String(channelUnread);
  const roomUnreadValue = serverTruthLabel ?? String(roomUnread);
  const approvalCountValue = serverTruthLabel ?? String(approvalCount);
  const reviewCountValue = serverTruthLabel ?? String(reviewCount);

  async function runSurfaceAction(
    action: "permission" | "register" | "test",
    runner: () => Promise<unknown>,
    successMessage: string
  ) {
    setBusyAction(action);
    try {
      await runner();
      setSurfaceMessage(successMessage);
    } catch (surfaceError) {
      setSurfaceMessage(surfaceError instanceof Error ? surfaceError.message : "浏览器通知动作失败");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-4">
      {error ? (
        <Panel tone="pink">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">State Sync Failed</p>
          <p className="mt-3 text-base leading-7">
            设置页仍会保留本地浏览器通知面，但当前 `/v1/state` 拉取失败：{error}
          </p>
        </Panel>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_0.9fr]">
        <Panel tone="yellow">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Notification Center</p>
          <h2 className="mt-3 font-display text-4xl font-bold">把 live inbox 和 unread truth 收进设置页</h2>
          <p className="mt-3 max-w-3xl text-base leading-7">
            这一层不再只展示 Phase 0 静态默认值，而是直接读当前工作区的 inbox、频道未读、讨论间未读和浏览器通知状态。
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <FactTile label="Inbox Signals" value={inboxSignalValue} />
            <FactTile label="Critical Blocks" value={blockedCountValue} />
            <FactTile label="Channel Unread" value={channelUnreadValue} />
            <FactTile label="Room Unread" value={roomUnreadValue} />
          </div>
        </Panel>

        <Panel tone="ink" className="shadow-[6px_6px_0_0_var(--shock-pink)]">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Delivery Split</p>
          <h2 className="mt-3 font-display text-3xl font-bold">Web 面先把真值、偏好和注册态摆明</h2>
          <div className="mt-4 space-y-3 text-sm leading-6 text-white/82">
            <p>当前 web 已经能读 live inbox/unread，并把浏览器权限、service worker registration 和本地偏好摆到前台。</p>
            <p>邮件订阅者、审批中心状态模型和实际 browser push/email fanout 仍待 `#56 / #58` 接上。</p>
          </div>
          <div className="mt-5 grid gap-3">
            <StatusRow label="工作区默认值" value={serverPolicy} tone="white" />
            <StatusRow label="当前浏览器策略" value={currentBrowserStrategy} tone="yellow" />
            <StatusRow label="邮件投递链" value="pending server subscriber + worker fanout" tone="pink" />
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_1fr]">
        <Panel tone="paper">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Preference Surface</p>
          <h3 className="mt-3 font-display text-3xl font-bold">通知偏好</h3>
          <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
            server 现在只暴露工作区默认浏览器 Push 策略；这一票先把本地 override 和实际浏览器能力分开显示，不伪造 delivery ready。
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <StatusRow label="Workspace Browser Push" value={serverPolicy} tone="white" />
            <StatusRow label="Email Delivery" value="未上线，后续由 #56 / #58 接管" tone="white" />
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {([
              ["inherit", "继承服务端默认值"],
              ["critical", "只接关键通知"],
              ["all", "收全部 live 通知"],
              ["mute", "保持静默"],
            ] as const).map(([option, label]) => (
              <button
                key={option}
                type="button"
                onClick={() => setPreference(option)}
                className={cn(
                  "rounded-[20px] border-2 border-[var(--shock-ink)] px-4 py-4 text-left transition-transform hover:-translate-y-0.5",
                  preference === option ? "bg-[var(--shock-yellow)] shadow-[4px_4px_0_0_var(--shock-ink)]" : "bg-white"
                )}
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.18em]">{option}</p>
                <p className="mt-2 text-sm leading-6">{label}</p>
              </button>
            ))}
          </div>
          <div className="mt-5 rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Effective browser policy</p>
            <p className="mt-2 font-display text-2xl font-bold">{effectivePreference}</p>
            <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
              本地 override 只影响当前浏览器接收面，不会伪装成 server 已保存的 workspace 通知契约。
            </p>
          </div>
        </Panel>

        <Panel tone="lime">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Browser Push Surface</p>
          <h3 className="mt-3 font-display text-3xl font-bold">浏览器权限与 registration</h3>
          <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
            这里先完成 capability / permission / service worker registration surface。真实 subscriber、push payload 和 email fanout 仍由后续 server + worker 票接上。
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <StatusRow label="Browser Support" value={surface.supported ? "Notification API 可用" : "Notification API 不可用"} tone={surface.supported ? "lime" : "white"} />
            <StatusRow label="Permission" value={permissionLabel(surface.permission)} tone={surface.permission === "granted" ? "lime" : surface.permission === "denied" ? "pink" : "white"} />
            <StatusRow label="Secure Context" value={surface.secureContext ? "安全上下文可注册" : "当前环境不可注册"} tone={surface.secureContext ? "lime" : "pink"} />
            <StatusRow label="Push Manager" value={surface.pushManagerSupported ? "PushManager 可见" : "PushManager 不可用"} tone={surface.pushManagerSupported ? "lime" : "white"} />
            <StatusRow label="Service Worker" value={surface.serviceWorkerSupported ? "service worker 可用" : "service worker 不可用"} tone={surface.serviceWorkerSupported ? "lime" : "pink"} />
            <StatusRow
              label="Registration"
              value={surface.registrationScope ? `${registrationLabel(surface.registrationState)} · ${surface.registrationScope}` : registrationLabel(surface.registrationState)}
              tone={surface.registrationState === "ready" ? "lime" : surface.registrationState === "error" || surface.registrationState === "blocked" ? "pink" : "white"}
            />
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busyAction !== null || !surface.supported || surface.permission === "denied"}
              onClick={() =>
                void runSurfaceAction("permission", requestPermission, "浏览器权限状态已刷新。")
              }
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
            >
              {busyAction === "permission" ? "请求中..." : "请求权限"}
            </button>
            <button
              type="button"
              disabled={busyAction !== null || !surface.serviceWorkerSupported || !surface.secureContext}
              onClick={() =>
                void runSurfaceAction("register", registerBrowserSurface, "浏览器通知面已注册，可等待后续 delivery contract 接入。")
              }
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
            >
              {busyAction === "register" ? "注册中..." : "注册接收面"}
            </button>
            <button
              type="button"
              disabled={busyAction !== null || surface.permission !== "granted"}
              onClick={() =>
                void runSurfaceAction("test", sendTestNotification, "本地试通知已发出，可直接在浏览器里确认渲染。")
              }
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
            >
              {busyAction === "test" ? "发送中..." : "本地试通知"}
            </button>
          </div>
          {surface.registrationError ? (
            <p className="mt-4 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">{surface.registrationError}</p>
          ) : null}
          {surfaceMessage ? (
            <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">{surfaceMessage}</p>
          ) : null}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_0.92fr]">
        <Panel tone="white">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Live Notification Feed</p>
              <h3 className="mt-3 font-display text-3xl font-bold">通知中心</h3>
            </div>
            <Link
              href="/inbox"
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em]"
            >
              打开 Inbox
            </Link>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <FactTile label="Approvals" value={approvalCountValue} />
            <FactTile label="Reviews" value={reviewCountValue} />
            <FactTile label="Blocks" value={blockedCountValue} />
          </div>
          <div className="mt-5 space-y-3">
            {loading ? (
              <EmptyState title="正在同步通知中心" message="等待 `/v1/state` 返回当前 inbox / unread truth。" />
            ) : error ? (
              <EmptyState
                title="通知中心读取失败"
                message="当前无法从 `/v1/state` 读取 inbox truth，因此这里不会把 `0 条通知` 当成真实状态。"
              />
            ) : inboxItems.length === 0 ? (
              <EmptyState title="当前没有新的通知信号" message="这表示目前没有需要人类处理的 approval / review / blocked item。" />
            ) : (
              inboxItems.slice(0, 8).map((item) => (
                <article
                  key={item.id}
                  className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4 shadow-[4px_4px_0_0_var(--shock-ink)]"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full border-2 border-[var(--shock-ink)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]",
                        inboxKindTone(item.kind)
                      )}
                    >
                      {inboxKindLabel(item.kind)}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">{item.room}</span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">{item.time}</span>
                  </div>
                  <h4 className="mt-3 font-display text-2xl font-bold">{item.title}</h4>
                  <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">{item.summary}</p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Link
                      href={item.href}
                      className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em]"
                    >
                      打开原信号
                    </Link>
                    <span className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em]">
                      {item.action}
                    </span>
                  </div>
                </article>
              ))
            )}
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel tone="paper">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Unread Heatmap</p>
            <h3 className="mt-3 font-display text-3xl font-bold">未读热点</h3>
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-1">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.58)]">频道</p>
                <div className="mt-3 space-y-3">
                  {loading ? (
                    <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">同步中</p>
                  ) : error ? (
                    <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">当前无法读取频道未读真值。</p>
                  ) : unreadChannels.length === 0 ? (
                    <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">频道当前没有未读积压。</p>
                  ) : (
                    unreadChannels
                      .sort((left, right) => right.unread - left.unread)
                      .slice(0, 5)
                      .map((channel) => (
                        <Link
                          key={channel.id}
                          href={`/chat/${channel.id}`}
                          className="flex items-center justify-between rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3"
                        >
                          <span className="text-sm">{channel.name}</span>
                          <span className="font-mono text-[10px] uppercase tracking-[0.18em]">{channel.unread}</span>
                        </Link>
                      ))
                  )}
                </div>
              </div>

              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.58)]">讨论间</p>
                <div className="mt-3 space-y-3">
                  {loading ? (
                    <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">同步中</p>
                  ) : error ? (
                    <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">当前无法读取讨论间未读真值。</p>
                  ) : unreadRooms.length === 0 ? (
                    <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">讨论间当前没有未读积压。</p>
                  ) : (
                    unreadRooms
                      .sort((left, right) => right.unread - left.unread)
                      .slice(0, 5)
                      .map((room) => (
                        <Link
                          key={room.id}
                          href={`/rooms/${room.id}`}
                          className="flex items-center justify-between rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3"
                        >
                          <span className="text-sm">{unreadRoomLabel(room)}</span>
                          <span className="font-mono text-[10px] uppercase tracking-[0.18em]">{room.topic.status}</span>
                        </Link>
                      ))
                  )}
                </div>
              </div>
            </div>
          </Panel>

          <Panel tone="white">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Next Contracts</p>
            <h3 className="mt-3 font-display text-3xl font-bold">还没接上的部分</h3>
            <div className="mt-5 space-y-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
              <p>1. `#56` 负责 subscriber / approval center state model，让通知偏好真正写入后端契约。</p>
              <p>2. `#58` 负责 browser push / email fanout worker，让这页的 registration surface 接上真实投递链。</p>
              <p>3. 这页当前只消费 live state，并把本地浏览器 readiness 明面化，不假装 server 已经记录 push subscriber。</p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
