"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { NotificationDelivery, NotificationFanoutReceipt, NotificationPreference } from "@/lib/live-notifications";

export type BrowserPermissionState = NotificationPermission | "unsupported";
export type BrowserRegistrationState = "idle" | "registering" | "ready" | "blocked" | "error";

type BrowserNotificationSurface = {
  supported: boolean;
  secureContext: boolean;
  serviceWorkerSupported: boolean;
  pushManagerSupported: boolean;
  permission: BrowserPermissionState;
  registrationState: BrowserRegistrationState;
  registrationScope: string | null;
  registrationError: string | null;
};

const LOCAL_PREFERENCE_KEY = "openshock.notification.preference";
const DEVICE_ID_KEY = "openshock.notification.device-id";
const LOCAL_NOTIFICATION_STATE_EVENT = "openshock:notification-local-state";
const SERVICE_WORKER_PATH = "/openshock-notify-sw.js";

const INITIAL_SURFACE: BrowserNotificationSurface = {
  supported: false,
  secureContext: false,
  serviceWorkerSupported: false,
  pushManagerSupported: false,
  permission: "unsupported",
  registrationState: "idle",
  registrationScope: null,
  registrationError: null,
};

function isNotificationPreference(value: string | null): value is NotificationPreference {
  return value === "inherit" || value === "all" || value === "critical" || value === "mute";
}

function createLocalDeviceID() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `browser-${crypto.randomUUID()}`;
  }
  return `browser-${Math.random().toString(36).slice(2, 10)}`;
}

function readOrCreateDeviceID() {
  if (typeof window === "undefined") {
    return "browser-server-render";
  }

  const current = window.localStorage.getItem(DEVICE_ID_KEY);
  if (current) {
    return current;
  }

  const next = createLocalDeviceID();
  window.localStorage.setItem(DEVICE_ID_KEY, next);
  return next;
}

function buildBrowserSubscriberTarget(deviceID: string) {
  return `https://browser.push.local/devices/${deviceID}`;
}

function buildBrowserSubscriberLabel(deviceID: string) {
  return `Current Browser · ${deviceID.slice(-8)}`;
}

function subscribeLocalNotificationState(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleChange = () => {
    onStoreChange();
  };
  window.addEventListener("storage", handleChange);
  window.addEventListener(LOCAL_NOTIFICATION_STATE_EVENT, handleChange);
  return () => {
    window.removeEventListener("storage", handleChange);
    window.removeEventListener(LOCAL_NOTIFICATION_STATE_EVENT, handleChange);
  };
}

function emitLocalNotificationStateChange() {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(LOCAL_NOTIFICATION_STATE_EVENT));
}

function readPreferenceSnapshot() {
  if (typeof window === "undefined") {
    return "inherit" as NotificationPreference;
  }
  const stored = window.localStorage.getItem(LOCAL_PREFERENCE_KEY);
  return isNotificationPreference(stored) ? stored : "inherit";
}

function readDeviceSnapshot() {
  if (typeof window === "undefined") {
    return "";
  }
  return readOrCreateDeviceID();
}

function readPermission(): BrowserPermissionState {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }

  return Notification.permission;
}

function runtimeSupport() {
  return {
    supported: typeof window !== "undefined" && "Notification" in window,
    secureContext: typeof window !== "undefined" ? window.isSecureContext : false,
    serviceWorkerSupported: typeof navigator !== "undefined" && "serviceWorker" in navigator,
    pushManagerSupported: typeof window !== "undefined" && "PushManager" in window,
  };
}

async function findNotificationRegistration() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }

  const registrations = await navigator.serviceWorker.getRegistrations();
  return (
    registrations.find((registration) =>
      [registration.installing, registration.waiting, registration.active].some((worker) =>
        worker?.scriptURL.includes("openshock-notify-sw.js")
      )
    ) ?? null
  );
}

async function readSurfaceSnapshot(): Promise<BrowserNotificationSurface> {
  const support = runtimeSupport();
  const permission = readPermission();

  if (!support.serviceWorkerSupported) {
    return {
      ...support,
      permission,
      registrationState: "blocked",
      registrationScope: null,
      registrationError: "当前浏览器不支持 service worker，无法注册浏览器通知面。",
    };
  }

  if (!support.secureContext) {
    return {
      ...support,
      permission,
      registrationState: "blocked",
      registrationScope: null,
      registrationError: "当前上下文不是安全环境，浏览器 push registration 不可用。",
    };
  }

  try {
    const registration = await findNotificationRegistration();
    if (!registration) {
      return {
        ...support,
        permission,
        registrationState: "idle",
        registrationScope: null,
        registrationError: null,
      };
    }

    return {
      ...support,
      permission,
      registrationState: "ready",
      registrationScope: registration.scope,
      registrationError: null,
    };
  } catch (error) {
    return {
      ...support,
      permission,
      registrationState: "error",
      registrationScope: null,
      registrationError: error instanceof Error ? error.message : "读取浏览器通知状态失败",
    };
  }
}

export function useBrowserNotificationSurface() {
  const deviceID = useSyncExternalStore(subscribeLocalNotificationState, readDeviceSnapshot, () => "");
  const preference = useSyncExternalStore(
    subscribeLocalNotificationState,
    readPreferenceSnapshot,
    () => "inherit" as NotificationPreference
  );
  const [surface, setSurface] = useState<BrowserNotificationSurface>(INITIAL_SURFACE);
  const deliveredReceiptsRef = useRef(new Set<string>());

  async function refreshSurface() {
    const next = await readSurfaceSnapshot();
    setSurface(next);
    return next;
  }

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;
    void readSurfaceSnapshot().then((next) => {
      if (!cancelled) {
        setSurface(next);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback((nextPreference: NotificationPreference) => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(LOCAL_PREFERENCE_KEY, nextPreference);
    emitLocalNotificationStateChange();
  }, []);

  async function requestPermission() {
    if (typeof window === "undefined" || !("Notification" in window)) {
      throw new Error("当前浏览器不支持通知权限请求。");
    }

    const permission = await Notification.requestPermission();
    await refreshSurface();
    return permission;
  }

  async function registerBrowserSurface() {
    const support = runtimeSupport();
    if (!support.serviceWorkerSupported) {
      throw new Error("当前浏览器不支持 service worker。");
    }

    if (!support.secureContext) {
      throw new Error("当前上下文不是安全环境，无法注册浏览器通知面。");
    }

    setSurface((current) => ({
      ...current,
      ...support,
      permission: readPermission(),
      registrationState: "registering",
      registrationError: null,
    }));

    try {
      const registration = await navigator.serviceWorker.register(SERVICE_WORKER_PATH, { scope: "/" });
      await navigator.serviceWorker.ready;
      const next = await refreshSurface();
      return next.registrationScope ?? registration.scope;
    } catch (error) {
      const message = error instanceof Error ? error.message : "注册浏览器通知面失败";
      setSurface({
        ...support,
        permission: readPermission(),
        registrationState: "error",
        registrationScope: null,
        registrationError: message,
      });
      throw new Error(message);
    }
  }

  async function sendTestNotification() {
    if (typeof window === "undefined" || !("Notification" in window)) {
      throw new Error("当前浏览器不支持本地通知。");
    }

    if (Notification.permission !== "granted") {
      throw new Error("需要先授予浏览器通知权限。");
    }

    const registration = await findNotificationRegistration();
    const title = "OpenShock 通知面在线";
    const body = "浏览器权限、service worker 和 subscriber target 已就绪，可以接收 notification fanout。";

    if (registration) {
      await registration.showNotification(title, {
        body,
        tag: "openshock-notify-smoke",
        data: { href: "/settings" },
      });
      return;
    }

    new Notification(title, { body });
  }

  async function showDeliveredNotifications(
    receipts: NotificationFanoutReceipt[],
    deliveries: NotificationDelivery[],
    subscriberID?: string
  ) {
    if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") {
      return 0;
    }

    const deliveriesByID = new Map(deliveries.map((delivery) => [delivery.id, delivery]));
    const registration = await findNotificationRegistration();
    let shown = 0;

    for (const receipt of receipts) {
      if (receipt.channel !== "browser_push" || receipt.status !== "sent") {
        continue;
      }
      if (subscriberID && receipt.subscriberId !== subscriberID) {
        continue;
      }
      if (deliveredReceiptsRef.current.has(receipt.id)) {
        continue;
      }

      const delivery = deliveriesByID.get(receipt.deliveryId);
      if (!delivery) {
        continue;
      }

      if (registration) {
        await registration.showNotification(delivery.title, {
          body: delivery.body,
          tag: receipt.deliveryId,
          data: { href: delivery.href },
        });
      } else {
        new Notification(delivery.title, {
          body: delivery.body,
        });
      }
      deliveredReceiptsRef.current.add(receipt.id);
      shown += 1;
    }

    return shown;
  }

  return {
    deviceID,
    subscriberTarget: deviceID ? buildBrowserSubscriberTarget(deviceID) : "等待当前浏览器标识…",
    subscriberLabel: deviceID ? buildBrowserSubscriberLabel(deviceID) : "Current Browser",
    preference,
    setPreference,
    surface,
    refreshSurface,
    requestPermission,
    registerBrowserSurface,
    sendTestNotification,
    showDeliveredNotifications,
  };
}
