"use client";

import { startTransition, useCallback, useEffect, useState } from "react";

import type { ApprovalCenterState } from "@/lib/mock-data";

const API_BASE = process.env.NEXT_PUBLIC_OPENSHOCK_API_BASE ?? "http://127.0.0.1:8080";

export type NotificationPreference = "inherit" | "all" | "critical" | "mute";
export type WorkspaceNotificationPolicy = Exclude<NotificationPreference, "inherit">;
export type NotificationChannel = "browser_push" | "email";
export type NotificationSubscriberStatus = "ready" | "pending" | "blocked";
export type NotificationDeliveryStatus = "ready" | "suppressed" | "blocked" | "unrouted";
export type NotificationReceiptStatus = "sent" | "failed";

export type NotificationPolicy = {
  browserPush: WorkspaceNotificationPolicy;
  email: WorkspaceNotificationPolicy;
  updatedAt: string;
};

export type NotificationSubscriber = {
  id: string;
  channel: NotificationChannel;
  target: string;
  label: string;
  preference: NotificationPreference;
  effectivePreference: WorkspaceNotificationPolicy;
  status: NotificationSubscriberStatus;
  source: string;
  createdAt: string;
  updatedAt: string;
  lastDeliveredAt?: string;
  lastError?: string;
};

export type NotificationDelivery = {
  id: string;
  inboxItemId: string;
  signalKind: string;
  priority: "critical" | "high" | "info";
  channel: NotificationChannel;
  subscriberId: string;
  status: NotificationDeliveryStatus;
  reason: string;
  title: string;
  body: string;
  href: string;
  createdAt: string;
};

export type NotificationFanoutReceipt = {
  id: string;
  deliveryId: string;
  inboxItemId: string;
  subscriberId: string;
  channel: NotificationChannel;
  status: NotificationReceiptStatus;
  attemptedAt: string;
  deliveredAt?: string;
  payloadPath?: string;
  error?: string;
};

export type NotificationFanoutRun = {
  ranAt: string;
  attempted: number;
  delivered: number;
  failed: number;
  receipts: NotificationFanoutReceipt[];
};

export type NotificationCenter = {
  policy: NotificationPolicy;
  subscribers: NotificationSubscriber[];
  deliveries: NotificationDelivery[];
  approvalCenter: ApprovalCenterState;
  worker: NotificationFanoutRun;
};

export type NotificationPolicyInput = {
  browserPush?: WorkspaceNotificationPolicy;
  email?: WorkspaceNotificationPolicy;
};

export type NotificationSubscriberInput = {
  id?: string;
  channel: NotificationChannel;
  target: string;
  label?: string;
  preference?: NotificationPreference;
  status?: NotificationSubscriberStatus;
  source?: string;
};

type NotificationPolicyResponse = {
  policy: NotificationPolicy;
  notifications: NotificationCenter;
};

type NotificationSubscriberResponse = {
  subscriber: NotificationSubscriber;
  notifications: NotificationCenter;
};

type NotificationFanoutResponse = {
  worker: NotificationFanoutRun;
  notifications: NotificationCenter;
};

type MutationErrorPayload = {
  error?: string;
};

const EMPTY_NOTIFICATION_CENTER: NotificationCenter = {
  policy: {
    browserPush: "critical",
    email: "critical",
    updatedAt: "",
  },
  subscribers: [],
  deliveries: [],
  approvalCenter: {
    openCount: 0,
    approvalCount: 0,
    blockedCount: 0,
    reviewCount: 0,
    unreadCount: 0,
    recentCount: 0,
    signals: [],
    recent: [],
  },
  worker: {
    ranAt: "",
    attempted: 0,
    delivered: 0,
    failed: 0,
    receipts: [],
  },
};

class NotificationMutationError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "NotificationMutationError";
    this.status = status;
  }
}

async function requestJSON<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const payload = (await response.json()) as T & MutationErrorPayload;
  if (!response.ok) {
    throw new NotificationMutationError(payload.error || `notification request failed: ${response.status}`, response.status);
  }
  return payload;
}

export function useLiveNotifications() {
  const [center, setCenter] = useState<NotificationCenter>(EMPTY_NOTIFICATION_CENTER);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const commitCenter = useCallback((next: NotificationCenter) => {
    startTransition(() => {
      setCenter(next);
      setError(null);
      setLoading(false);
    });
  }, []);

  const commitError = useCallback((nextError: unknown) => {
    setError(nextError instanceof Error ? nextError.message : "notification fetch failed");
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await requestJSON<NotificationCenter>("/v1/notifications");
      commitCenter(next);
      return next;
    } catch (fetchError) {
      commitError(fetchError);
      throw fetchError;
    }
  }, [commitCenter, commitError]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [refresh]);

  const updatePolicy = useCallback(
    async (input: NotificationPolicyInput) => {
      const payload = await requestJSON<NotificationPolicyResponse>("/v1/notifications/policy", {
        method: "POST",
        body: JSON.stringify(input),
      });
      commitCenter(payload.notifications);
      return payload;
    },
    [commitCenter]
  );

  const upsertSubscriber = useCallback(
    async (input: NotificationSubscriberInput) => {
      const payload = await requestJSON<NotificationSubscriberResponse>("/v1/notifications/subscribers", {
        method: "POST",
        body: JSON.stringify(input),
      });
      commitCenter(payload.notifications);
      return payload;
    },
    [commitCenter]
  );

  const dispatchFanout = useCallback(async () => {
    const payload = await requestJSON<NotificationFanoutResponse>("/v1/notifications/fanout", {
      method: "POST",
      body: JSON.stringify({}),
    });
    commitCenter(payload.notifications);
    return payload;
  }, [commitCenter]);

  return {
    center,
    loading,
    error,
    refresh,
    updatePolicy,
    upsertSubscriber,
    dispatchFanout,
  };
}
