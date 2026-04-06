"use client";

import { useEffect, useState } from "react";

export type NotificationPreference = "inherit" | "all" | "critical" | "mute";
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
  const [preference, setPreference] = useState<NotificationPreference>(() => {
    if (typeof window === "undefined") {
      return "inherit";
    }

    const stored = window.localStorage.getItem(LOCAL_PREFERENCE_KEY);
    return isNotificationPreference(stored) ? stored : "inherit";
  });
  const [surface, setSurface] = useState<BrowserNotificationSurface>(INITIAL_SURFACE);

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LOCAL_PREFERENCE_KEY, preference);
  }, [preference]);

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
    const body = "浏览器权限和 registration surface 已就绪，真实 delivery fanout 仍待 #56 / #58 接上。";

    if (registration) {
      await registration.showNotification(title, {
        body,
        tag: "openshock-notify-smoke",
      });
      return;
    }

    new Notification(title, { body });
  }

  return {
    preference,
    setPreference,
    surface,
    refreshSurface,
    requestPermission,
    registerBrowserSurface,
    sendTestNotification,
  };
}
