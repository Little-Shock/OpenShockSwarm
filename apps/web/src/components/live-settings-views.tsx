"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { OpenShockShell } from "@/components/open-shock-shell";
import { DetailRail, Panel } from "@/components/phase-zero-views";
import { useBrowserNotificationSurface } from "@/lib/browser-notifications";
import {
  type NotificationCenter,
  type NotificationChannel,
  type NotificationDelivery,
  type NotificationFanoutReceipt,
  type NotificationPreference,
  type NotificationSubscriberStatus,
  type WorkspaceNotificationPolicy,
  useLiveNotifications,
} from "@/lib/live-notifications";
import { usePhaseZeroState } from "@/lib/live-phase0";
import type { InboxItem } from "@/lib/mock-data";

type LiveNotificationsModel = ReturnType<typeof useLiveNotifications>;

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const WORKSPACE_POLICY_OPTIONS: WorkspaceNotificationPolicy[] = ["critical", "all", "mute"];
const SUBSCRIBER_PREFERENCE_OPTIONS: NotificationPreference[] = ["inherit", "critical", "all", "mute"];

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

function preferenceLabel(preference: NotificationPreference | WorkspaceNotificationPolicy) {
  switch (preference) {
    case "all":
      return "全部 live 事件";
    case "critical":
      return "仅高优先级";
    case "mute":
      return "静默";
    default:
      return "继承工作区默认值";
  }
}

function channelLabel(channel: NotificationChannel) {
  return channel === "browser_push" ? "Browser Push" : "Email";
}

function subscriberStatusLabel(status: NotificationSubscriberStatus) {
  switch (status) {
    case "ready":
      return "已就绪";
    case "blocked":
      return "阻塞";
    default:
      return "待激活";
  }
}

function deliveryStatusLabel(status: NotificationDelivery["status"] | NotificationFanoutReceipt["status"]) {
  switch (status) {
    case "ready":
      return "待发送";
    case "suppressed":
      return "被策略抑制";
    case "blocked":
      return "被订阅者状态阻塞";
    case "unrouted":
      return "未路由";
    case "sent":
      return "已送达";
    case "failed":
      return "发送失败";
    default:
      return status;
  }
}

function currentBrowserSubscriberStatus(surface: {
  permission: NotificationPermission | "unsupported";
  registrationState: "idle" | "registering" | "ready" | "blocked" | "error";
}): NotificationSubscriberStatus {
  if (surface.permission === "denied" || surface.registrationState === "blocked" || surface.registrationState === "error") {
    return "blocked";
  }
  if (surface.permission === "granted" && surface.registrationState === "ready") {
    return "ready";
  }
  return "pending";
}

function formatTimestamp(value?: string) {
  if (!value) {
    return "尚未发生";
  }

  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function toneForSubscriberStatus(status: NotificationSubscriberStatus) {
  switch (status) {
    case "ready":
      return "lime";
    case "blocked":
      return "pink";
    default:
      return "yellow";
  }
}

function toneForDeliveryStatus(status: NotificationDelivery["status"] | NotificationFanoutReceipt["status"]) {
  switch (status) {
    case "ready":
    case "sent":
      return "lime";
    case "blocked":
    case "failed":
      return "pink";
    case "suppressed":
      return "yellow";
    default:
      return "white";
  }
}

function FactTile({
  label,
  value,
  testID,
}: {
  label: string;
  value: string;
  testID?: string;
}) {
  return (
    <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3" data-testid={testID}>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">{label}</p>
      <p className="mt-2 font-display text-xl font-semibold">{value}</p>
    </div>
  );
}

function StatusRow({
  label,
  value,
  tone = "white",
  testID,
}: {
  label: string;
  value: string;
  tone?: "white" | "yellow" | "lime" | "pink";
  testID?: string;
}) {
  return (
    <div
      data-testid={testID}
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

function PolicyButton({
  active,
  onClick,
  label,
  value,
  testID,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  value: string;
  testID?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testID}
      className={cn(
        "rounded-[20px] border-2 border-[var(--shock-ink)] px-4 py-4 text-left transition-transform hover:-translate-y-0.5",
        active ? "bg-[var(--shock-yellow)] shadow-[4px_4px_0_0_var(--shock-ink)]" : "bg-white"
      )}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.18em]">{value}</p>
      <p className="mt-2 text-sm leading-6">{label}</p>
    </button>
  );
}

function findCurrentBrowserSubscriber(center: NotificationCenter, target: string) {
  return center.subscribers.find((subscriber) => subscriber.channel === "browser_push" && subscriber.target === target) ?? null;
}

function findPrimaryEmailSubscriber(center: NotificationCenter, preferredEmail: string) {
  const normalizedEmail = preferredEmail.trim().toLowerCase();
  if (normalizedEmail) {
    const exact = center.subscribers.find(
      (subscriber) => subscriber.channel === "email" && subscriber.target.trim().toLowerCase() === normalizedEmail
    );
    if (exact) {
      return exact;
    }
  }
  return center.subscribers.find((subscriber) => subscriber.channel === "email") ?? null;
}

function LiveSettingsContextRail({ notifications }: { notifications: LiveNotificationsModel }) {
  const { center, loading, error } = notifications;
  return (
    <DetailRail
      label="Notify Truth"
      items={[
        {
          label: "Subscribers",
          value: loading ? "同步中" : error ? "读取失败" : `${center.subscribers.length} live`,
        },
        {
          label: "Browser",
          value: loading ? "同步中" : error ? "读取失败" : preferenceLabel(center.policy.browserPush),
        },
        {
          label: "Email",
          value: loading ? "同步中" : error ? "读取失败" : preferenceLabel(center.policy.email),
        },
        {
          label: "Worker",
          value: loading
            ? "同步中"
            : error
              ? "读取失败"
              : center.worker.ranAt
                ? `${center.worker.delivered}/${center.worker.attempted} sent`
                : "未执行",
        },
      ]}
    />
  );
}

function LiveSettingsView({ notifications }: { notifications: LiveNotificationsModel }) {
  const { center, loading: notificationLoading, error: notificationError } = notifications;
  const { state, error: stateError } = usePhaseZeroState();
  const {
    preference,
    setPreference,
    surface,
    requestPermission,
    registerBrowserSurface,
    sendTestNotification,
    showDeliveredNotifications,
    subscriberLabel,
    subscriberTarget,
  } = useBrowserNotificationSurface();
  const [browserPolicyDraft, setBrowserPolicyDraft] = useState<WorkspaceNotificationPolicy>("critical");
  const [emailPolicyDraft, setEmailPolicyDraft] = useState<WorkspaceNotificationPolicy>("critical");
  const [policyDirty, setPolicyDirty] = useState(false);
  const [emailTargetDraft, setEmailTargetDraft] = useState("");
  const [emailPreferenceDraft, setEmailPreferenceDraft] = useState<NotificationPreference>("critical");
  const [emailDirty, setEmailDirty] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const inboxItems = state.inbox;
  const browserSubscriber = useMemo(() => findCurrentBrowserSubscriber(center, subscriberTarget), [center, subscriberTarget]);
  const fallbackEmail = state.auth.session.email || state.auth.members.find((member) => member.role === "owner")?.email || "ops@openshock.dev";
  const emailSubscriber = useMemo(() => findPrimaryEmailSubscriber(center, fallbackEmail), [center, fallbackEmail]);

  useEffect(() => {
    if (!policyDirty) {
      setBrowserPolicyDraft(center.policy.browserPush);
      setEmailPolicyDraft(center.policy.email);
    }
  }, [center.policy, policyDirty]);

  useEffect(() => {
    if (!emailDirty) {
      setEmailTargetDraft(emailSubscriber?.target || fallbackEmail);
      setEmailPreferenceDraft(emailSubscriber?.preference || "critical");
    }
  }, [emailDirty, emailSubscriber, fallbackEmail]);

  useEffect(() => {
    if (browserSubscriber?.preference && browserSubscriber.preference !== preference) {
      setPreference(browserSubscriber.preference);
    }
  }, [browserSubscriber?.preference, preference, setPreference]);

  const readyDeliveries = center.deliveries.filter((delivery) => delivery.status === "ready").length;
  const suppressedDeliveries = center.deliveries.filter((delivery) => delivery.status === "suppressed").length;
  const browserDeliveryCount = center.deliveries.filter((delivery) => delivery.channel === "browser_push" && delivery.status === "ready").length;
  const emailDeliveryCount = center.deliveries.filter((delivery) => delivery.channel === "email" && delivery.status === "ready").length;
  const workerReceipts = center.worker.receipts ?? [];
  const browserSubscriberState = browserSubscriber?.status ?? currentBrowserSubscriberStatus(surface);
  const workerSummary = center.worker.ranAt
    ? `${center.worker.delivered}/${center.worker.attempted} sent · ${center.worker.failed} failed`
    : "尚未执行";

  async function runAction(action: string, runner: () => Promise<void>) {
    setBusyAction(action);
    try {
      await runner();
    } catch (currentError) {
      setActionMessage(currentError instanceof Error ? currentError.message : "通知动作失败");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSaveWorkspacePolicy() {
    await runAction("save-policy", async () => {
      await notifications.updatePolicy({
        browserPush: browserPolicyDraft,
        email: emailPolicyDraft,
      });
      setPolicyDirty(false);
      setActionMessage("工作区 browser push / email 默认策略已写回 server。");
    });
  }

  async function handleConnectBrowserSubscriber() {
    await runAction("connect-browser", async () => {
      const payload = await notifications.upsertSubscriber({
        id: browserSubscriber?.id,
        channel: "browser_push",
        target: subscriberTarget,
        label: subscriberLabel,
        preference,
        status: currentBrowserSubscriberStatus(surface),
        source: "browser-registration",
      });
      const nextSubscriber =
        payload.notifications.subscribers.find((subscriber) => subscriber.id === payload.subscriber.id) ?? payload.subscriber;
      setActionMessage(
        `当前浏览器 subscriber 已同步：${subscriberStatusLabel(nextSubscriber.status)} · ${preferenceLabel(nextSubscriber.effectivePreference)}。`
      );
    });
  }

  async function handleSaveEmailSubscriber() {
    await runAction("save-email", async () => {
      const payload = await notifications.upsertSubscriber({
        id: emailSubscriber?.id,
        channel: "email",
        target: emailTargetDraft.trim(),
        label: state.auth.session.email && emailTargetDraft.trim() === state.auth.session.email ? "Current Session Email" : "Workspace Email",
        preference: emailPreferenceDraft,
        status: "ready",
        source: "workspace-email",
      });
      setEmailDirty(false);
      setActionMessage(
        `邮箱 subscriber 已同步：${payload.subscriber.target} · ${preferenceLabel(payload.subscriber.effectivePreference)}。`
      );
    });
  }

  async function handleDispatchFanout() {
    await runAction("fanout", async () => {
      const payload = await notifications.dispatchFanout();
      const latestBrowserSubscriber = findCurrentBrowserSubscriber(payload.notifications, subscriberTarget);
      const shown = await showDeliveredNotifications(
        payload.worker.receipts,
        payload.notifications.deliveries,
        latestBrowserSubscriber?.id
      );
      setActionMessage(
        shown > 0
          ? `fanout 已执行：${payload.worker.delivered}/${payload.worker.attempted} sent，并在当前浏览器展示 ${shown} 条通知。`
          : `fanout 已执行：${payload.worker.delivered}/${payload.worker.attempted} sent，失败 ${payload.worker.failed}。`
      );
    });
  }

  return (
    <div className="space-y-4">
      {notificationError ? (
        <Panel tone="pink">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Notification Contract Failed</p>
          <p className="mt-3 text-base leading-7">当前 `/v1/notifications` 拉取失败：{notificationError}</p>
        </Panel>
      ) : null}

      {stateError ? (
        <Panel tone="pink">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">State Sync Failed</p>
          <p className="mt-3 text-base leading-7">通知面还能继续改 policy / subscriber，但 `/v1/state` 当前拉取失败：{stateError}</p>
        </Panel>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_0.92fr]">
        <Panel tone="yellow">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Delivery Truth</p>
          <h2 className="mt-3 font-display text-4xl font-bold">把通知偏好、订阅者和 fanout receipts 摆上桌</h2>
          <p className="mt-3 max-w-3xl text-base leading-7">
            这页现在直接消费 `/v1/notifications`。`TC-017` 只看 browser push / email delivery 能否把 approval、blocked、review 信号主动推出去，并把失败 / retry 状态明面化。
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <FactTile label="Subscribers" value={notificationLoading ? "同步中" : String(center.subscribers.length)} testID="notification-subscribers-count" />
            <FactTile label="Ready Deliveries" value={notificationLoading ? "同步中" : String(readyDeliveries)} testID="notification-delivery-ready-count" />
            <FactTile label="Suppressed" value={notificationLoading ? "同步中" : String(suppressedDeliveries)} testID="notification-delivery-suppressed-count" />
            <FactTile label="Worker" value={notificationLoading ? "同步中" : workerSummary} testID="notification-worker-summary" />
          </div>
        </Panel>

        <Panel tone="ink" className="shadow-[6px_6px_0_0_var(--shock-pink)]">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Current Split</p>
          <h2 className="mt-3 font-display text-3xl font-bold">默认策略、当前浏览器与 fanout 最新真值</h2>
          <div className="mt-4 space-y-3 text-sm leading-6 text-white/82">
            <p>browser push / email 默认值已经不再是文案占位，而是 server policy。</p>
            <p>fanout 最近一拍的 attempted / delivered / failed 与 explicit receipts 也都直接从 contract surface 读取。</p>
          </div>
          <div className="mt-5 grid gap-3">
            <StatusRow label="Workspace Browser Push" value={preferenceLabel(center.policy.browserPush)} tone="white" testID="notification-workspace-browser-policy" />
            <StatusRow label="Workspace Email" value={preferenceLabel(center.policy.email)} tone="yellow" testID="notification-workspace-email-policy" />
            <StatusRow label="Current Browser" value={`${subscriberStatusLabel(browserSubscriberState)} · ${preferenceLabel(browserSubscriber?.effectivePreference || preference)}`} tone="lime" testID="notification-current-browser-subscriber" />
            <StatusRow label="Last Fanout" value={`${workerSummary} · ${formatTimestamp(center.worker.ranAt)}`} tone={center.worker.failed > 0 ? "pink" : center.worker.delivered > 0 ? "lime" : "white"} testID="notification-last-fanout" />
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_1fr]">
        <Panel tone="paper">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Workspace Defaults</p>
          <h3 className="mt-3 font-display text-3xl font-bold">通知默认策略</h3>
          <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
            browser push 与 email 的默认偏好现在都会写回 server。subscriber 若仍为 `inherit`，这里就是它们的真实 effective preference。
          </p>
          <div className="mt-5 space-y-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Browser Push</p>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {WORKSPACE_POLICY_OPTIONS.map((option) => (
                  <PolicyButton
                    key={`browser-${option}`}
                    active={browserPolicyDraft === option}
                    onClick={() => {
                      setBrowserPolicyDraft(option);
                      setPolicyDirty(true);
                    }}
                    value={option}
                    label={preferenceLabel(option)}
                    testID={`notification-browser-policy-${option}`}
                  />
                ))}
              </div>
            </div>

            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Email</p>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {WORKSPACE_POLICY_OPTIONS.map((option) => (
                  <PolicyButton
                    key={`email-${option}`}
                    active={emailPolicyDraft === option}
                    onClick={() => {
                      setEmailPolicyDraft(option);
                      setPolicyDirty(true);
                    }}
                    value={option}
                    label={preferenceLabel(option)}
                    testID={`notification-email-policy-${option}`}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              data-testid="notification-save-policy"
              disabled={busyAction !== null || !policyDirty}
              onClick={() => void handleSaveWorkspacePolicy()}
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
            >
              {busyAction === "save-policy" ? "写入中..." : "保存默认值"}
            </button>
            <StatusRow label="Policy Updated At" value={formatTimestamp(center.policy.updatedAt)} tone="white" />
          </div>
        </Panel>

        <Panel tone="lime">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Current Browser</p>
          <h3 className="mt-3 font-display text-3xl font-bold">把当前浏览器接进 subscriber contract</h3>
          <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
            这里不再停在 permission / registration 展示层。当前浏览器现在有稳定 subscriber target，可接入 fanout，并把 sent receipts 直接显示成本地通知。
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <StatusRow label="Permission" value={permissionLabel(surface.permission)} tone={surface.permission === "granted" ? "lime" : surface.permission === "denied" ? "pink" : "white"} testID="notification-browser-permission" />
            <StatusRow label="Registration" value={surface.registrationScope ? `${registrationLabel(surface.registrationState)} · ${surface.registrationScope}` : registrationLabel(surface.registrationState)} tone={surface.registrationState === "ready" ? "lime" : surface.registrationState === "error" || surface.registrationState === "blocked" ? "pink" : "white"} testID="notification-browser-registration" />
            <StatusRow label="Subscriber Target" value={subscriberTarget} tone="white" testID="notification-browser-target" />
            <StatusRow label="Subscriber Status" value={subscriberStatusLabel(browserSubscriberState)} tone={toneForSubscriberStatus(browserSubscriberState)} testID="notification-browser-subscriber-status" />
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {SUBSCRIBER_PREFERENCE_OPTIONS.map((option) => (
              <PolicyButton
                key={`browser-preference-${option}`}
                active={preference === option}
                onClick={() => setPreference(option)}
                value={option}
                label={preferenceLabel(option)}
                testID={`notification-browser-preference-${option}`}
              />
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              data-testid="notification-request-permission"
              disabled={busyAction !== null || surface.permission === "denied" || !surface.supported}
              onClick={() =>
                void runAction("permission", async () => {
                  await requestPermission();
                  setActionMessage("浏览器通知权限状态已刷新。");
                })
              }
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
            >
              {busyAction === "permission" ? "请求中..." : "请求权限"}
            </button>
            <button
              type="button"
              data-testid="notification-register-browser"
              disabled={busyAction !== null || !surface.serviceWorkerSupported || !surface.secureContext}
              onClick={() =>
                void runAction("register", async () => {
                  await registerBrowserSurface();
                  setActionMessage("当前浏览器 service worker 已注册。");
                })
              }
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
            >
              {busyAction === "register" ? "注册中..." : "注册接收面"}
            </button>
            <button
              type="button"
              data-testid="notification-connect-browser"
              disabled={busyAction !== null}
              onClick={() => void handleConnectBrowserSubscriber()}
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
            >
              {busyAction === "connect-browser" ? "同步中..." : "同步当前浏览器"}
            </button>
            <button
              type="button"
              data-testid="notification-local-smoke"
              disabled={busyAction !== null || surface.permission !== "granted"}
              onClick={() =>
                void runAction("browser-smoke", async () => {
                  await sendTestNotification();
                  setActionMessage("本地 smoke notification 已发出。");
                })
              }
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
            >
              {busyAction === "browser-smoke" ? "发送中..." : "本地 smoke"}
            </button>
          </div>
          {surface.registrationError ? <p className="mt-4 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">{surface.registrationError}</p> : null}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.96fr)_1.04fr]">
        <Panel tone="white">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Email Delivery</p>
          <h3 className="mt-3 font-display text-3xl font-bold">邮箱订阅者与 retry contract</h3>
          <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
            这里直接写入 email subscriber。invalid target 会显式失败，修正后可在同一 contract 面上看到 retry 转绿。
          </p>
          <label className="mt-5 block">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Email Target</span>
            <input
              data-testid="notification-email-target-input"
              value={emailTargetDraft}
              onChange={(event) => {
                setEmailTargetDraft(event.target.value);
                setEmailDirty(true);
              }}
              className="mt-3 w-full rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3 text-sm outline-none"
              placeholder="ops@openshock.dev"
            />
          </label>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {SUBSCRIBER_PREFERENCE_OPTIONS.map((option) => (
              <PolicyButton
                key={`email-preference-${option}`}
                active={emailPreferenceDraft === option}
                onClick={() => {
                  setEmailPreferenceDraft(option);
                  setEmailDirty(true);
                }}
                value={option}
                label={preferenceLabel(option)}
                testID={`notification-email-preference-${option}`}
              />
            ))}
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <StatusRow label="Subscriber Status" value={emailSubscriber ? subscriberStatusLabel(emailSubscriber.status) : "未创建"} tone={emailSubscriber ? toneForSubscriberStatus(emailSubscriber.status) : "white"} testID="notification-email-subscriber-status" />
            <StatusRow label="Effective Preference" value={emailSubscriber ? preferenceLabel(emailSubscriber.effectivePreference) : preferenceLabel(emailPreferenceDraft)} tone="yellow" testID="notification-email-effective-preference" />
            <StatusRow label="Last Delivered" value={formatTimestamp(emailSubscriber?.lastDeliveredAt)} tone="white" testID="notification-email-last-delivered" />
            <StatusRow label="Last Error" value={emailSubscriber?.lastError || "无"} tone={emailSubscriber?.lastError ? "pink" : "lime"} testID="notification-email-last-error" />
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              data-testid="notification-save-email"
              disabled={busyAction !== null || !emailTargetDraft.trim()}
              onClick={() => void handleSaveEmailSubscriber()}
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
            >
              {busyAction === "save-email" ? "保存中..." : "保存邮箱订阅者"}
            </button>
            <button
              type="button"
              data-testid="notification-run-fanout"
              disabled={busyAction !== null}
              onClick={() => void handleDispatchFanout()}
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
            >
              {busyAction === "fanout" ? "发送中..." : "执行 fanout"}
            </button>
          </div>
        </Panel>

        <Panel tone="paper">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Subscriber Roster</p>
              <h3 className="mt-3 font-display text-3xl font-bold">谁会收到哪类通知</h3>
            </div>
            <span className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em]" data-testid="notification-roster-summary">
              browser {browserDeliveryCount} · email {emailDeliveryCount} ready
            </span>
          </div>
          <div className="mt-5 space-y-3">
            {notificationLoading ? (
              <EmptyState title="正在同步 subscriber truth" message="等待 `/v1/notifications` 返回 policy、subscribers、deliveries 与 worker last-run。" />
            ) : center.subscribers.length === 0 ? (
              <EmptyState title="当前还没有 subscriber" message="先接入当前浏览器或保存邮箱订阅者，再执行 fanout。" />
            ) : (
              center.subscribers.map((subscriber) => {
                const subscriberDeliveries = center.deliveries.filter((delivery) => delivery.subscriberId === subscriber.id);
                const readyForSubscriber = subscriberDeliveries.filter((delivery) => delivery.status === "ready").length;
                return (
                  <article
                    key={subscriber.id}
                    data-testid={`notification-subscriber-${subscriber.id}`}
                    className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4 shadow-[4px_4px_0_0_var(--shock-ink)]"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
                        {channelLabel(subscriber.channel)}
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">{subscriber.label}</span>
                    </div>
                    <p className="mt-3 break-all text-sm leading-6">{subscriber.target}</p>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <StatusRow label="Status" value={subscriberStatusLabel(subscriber.status)} tone={toneForSubscriberStatus(subscriber.status)} />
                      <StatusRow label="Effective Preference" value={preferenceLabel(subscriber.effectivePreference)} tone="yellow" />
                      <StatusRow label="Ready Deliveries" value={String(readyForSubscriber)} tone="lime" />
                      <StatusRow label="Last Delivered" value={formatTimestamp(subscriber.lastDeliveredAt)} tone="white" />
                    </div>
                    {subscriber.lastError ? (
                      <p className="mt-4 rounded-[16px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 text-sm leading-6 text-white">
                        last error: {subscriber.lastError}
                      </p>
                    ) : null}
                  </article>
                );
              })
            )}
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.04fr)_0.96fr]">
        <Panel tone="white">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Latest Receipts</p>
              <h3 className="mt-3 font-display text-3xl font-bold">fanout 最近一拍</h3>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <FactTile label="Attempted" value={String(center.worker.attempted)} testID="notification-worker-attempted" />
              <FactTile label="Delivered" value={String(center.worker.delivered)} testID="notification-worker-delivered" />
              <FactTile label="Failed" value={String(center.worker.failed)} testID="notification-worker-failed" />
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {workerReceipts.length === 0 ? (
              <EmptyState title="还没有 worker receipts" message="执行一次 fanout 后，这里会直接显示 sent / failed、payload path 和 retry 后的最新结果。" />
            ) : (
              workerReceipts.map((receipt) => {
                const delivery = center.deliveries.find((item) => item.id === receipt.deliveryId);
                const subscriber = center.subscribers.find((item) => item.id === receipt.subscriberId);
                return (
                  <article
                    key={receipt.id}
                    data-testid={`notification-receipt-${receipt.id}`}
                    className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4 shadow-[4px_4px_0_0_var(--shock-ink)]"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full border-2 border-[var(--shock-ink)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]",
                          toneForDeliveryStatus(receipt.status) === "lime" && "bg-[var(--shock-lime)]",
                          toneForDeliveryStatus(receipt.status) === "pink" && "bg-[var(--shock-pink)] text-white",
                          toneForDeliveryStatus(receipt.status) === "yellow" && "bg-[var(--shock-yellow)]",
                          toneForDeliveryStatus(receipt.status) === "white" && "bg-white"
                        )}
                      >
                        {deliveryStatusLabel(receipt.status)}
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">{channelLabel(receipt.channel)}</span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">{formatTimestamp(receipt.attemptedAt)}</span>
                    </div>
                    <h4 className="mt-3 font-display text-2xl font-bold">{delivery?.title || receipt.deliveryId}</h4>
                    <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">{delivery?.body || subscriber?.target || "通知 payload"}</p>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <StatusRow label="Subscriber" value={subscriber?.label || receipt.subscriberId} tone="white" />
                      <StatusRow label="Target" value={subscriber?.target || "n/a"} tone="white" />
                      <StatusRow label="Signal" value={delivery?.signalKind || receipt.inboxItemId} tone="yellow" />
                      <StatusRow label="Href" value={delivery?.href || "n/a"} tone="white" />
                    </div>
                    {receipt.payloadPath ? (
                      <p className="mt-4 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">payload: {receipt.payloadPath}</p>
                    ) : null}
                    {receipt.error ? (
                      <p className="mt-4 rounded-[16px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 text-sm leading-6 text-white">
                        error: {receipt.error}
                      </p>
                    ) : null}
                  </article>
                );
              })
            )}
          </div>
        </Panel>

        <Panel tone="paper">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Source Signals</p>
              <h3 className="mt-3 font-display text-3xl font-bold">当前会被路由的 inbox 信号</h3>
            </div>
            <Link
              href="/inbox"
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em]"
            >
              打开 Inbox
            </Link>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <FactTile label="Approvals" value={String(center.approvalCenter.approvalCount)} />
            <FactTile label="Reviews" value={String(center.approvalCenter.reviewCount)} />
            <FactTile label="Blocks" value={String(center.approvalCenter.blockedCount)} />
          </div>
          <div className="mt-5 space-y-3">
            {inboxItems.length === 0 ? (
              <EmptyState title="当前没有待路由信号" message="这表示没有新的 approval / review / blocked 事件需要触达。" />
            ) : (
              inboxItems.map((item) => (
                <article
                  key={item.id}
                  className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4"
                  data-testid={`notification-source-${item.id}`}
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
                </article>
              ))
            )}
          </div>
        </Panel>
      </div>

      {actionMessage ? (
        <Panel tone="yellow">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Latest Action</p>
          <p className="mt-3 text-base leading-7" data-testid="notification-action-message">
            {actionMessage}
          </p>
          <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
            这轮边界只收 `TC-017` 的 notification preference / subscriber / fanout delivery；invite / verify / reset password 继续留在后续身份链路范围。
          </p>
        </Panel>
      ) : null}
    </div>
  );
}

export function LiveSettingsRoute() {
  const notifications = useLiveNotifications();

  return (
    <OpenShockShell
      view="settings"
      eyebrow="Phase 5 通知"
      title="把提醒系统从对象层推进到可交付 delivery loop"
      description="这里直接消费 `/v1/notifications`，把 workspace policy、subscriber contract、browser push / email fanout 与 explicit retry receipts 收成同一页真值。"
      contextTitle="通知真值在线"
      contextDescription="当前页只收 `TC-017`：高时效事件能主动触达，失败 / 重试有显式状态。"
      contextBody={<LiveSettingsContextRail notifications={notifications} />}
    >
      <LiveSettingsView notifications={notifications} />
    </OpenShockShell>
  );
}
