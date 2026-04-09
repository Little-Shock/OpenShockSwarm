"use client";

import { startTransition, useCallback, useEffect, useState } from "react";

import type { MemoryGovernance } from "@/lib/phase-zero-types";

const API_BASE = process.env.NEXT_PUBLIC_OPENSHOCK_API_BASE ?? "/api/control";

export type MemoryArtifactVersion = {
  version: number;
  summary: string;
  updatedAt: string;
  source: string;
  actor: string;
  digest?: string;
  sizeBytes?: number;
  content?: string;
};

export type MemoryArtifactDetail = {
  artifact: {
    id: string;
    scope: string;
    kind: string;
    path: string;
    summary: string;
    updatedAt: string;
    version?: number;
    latestWrite?: string;
    latestSource?: string;
    latestActor?: string;
    digest?: string;
    sizeBytes?: number;
    correctionCount?: number;
    lastCorrectionAt?: string;
    lastCorrectionBy?: string;
    lastCorrectionNote?: string;
    forgotten?: boolean;
    forgottenAt?: string;
    forgottenBy?: string;
    forgetReason?: string;
    governance?: MemoryGovernance;
  };
  content?: string;
  versions: MemoryArtifactVersion[];
};

export type MemoryPolicyMode = "balanced" | "governed-first";
export type MemoryPromotionKind = "skill" | "policy";
export type MemoryPromotionStatus = "pending_review" | "approved" | "rejected";

export type MemoryInjectionPolicy = {
  mode: MemoryPolicyMode;
  includeRoomNotes: boolean;
  includeDecisionLedger: boolean;
  includeAgentMemory: boolean;
  includePromotedArtifacts: boolean;
  maxItems: number;
  updatedAt: string;
  updatedBy: string;
};

export type MemoryInjectionPreviewItem = {
  artifactId: string;
  path: string;
  scope: string;
  kind: string;
  version: number;
  summary: string;
  latestWrite?: string;
  reason: string;
  snippet?: string;
  required: boolean;
  governance: MemoryGovernance;
};

export type MemoryInjectionPreview = {
  id: string;
  sessionId: string;
  runId: string;
  roomId: string;
  issueKey: string;
  title: string;
  recallPolicy: string;
  promptSummary: string;
  files: string[];
  tools: string[];
  items: MemoryInjectionPreviewItem[];
};

export type MemoryPromotion = {
  id: string;
  memoryId: string;
  sourcePath: string;
  sourceScope: string;
  sourceVersion: number;
  sourceSummary: string;
  excerpt?: string;
  kind: MemoryPromotionKind;
  title: string;
  rationale: string;
  status: MemoryPromotionStatus;
  targetPath: string;
  targetMemoryId?: string;
  proposedBy: string;
  proposedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
};

export type MemoryCenter = {
  policy: MemoryInjectionPolicy;
  previews: MemoryInjectionPreview[];
  promotions: MemoryPromotion[];
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
};

export type MemoryPolicyInput = {
  mode: MemoryPolicyMode;
  includeRoomNotes: boolean;
  includeDecisionLedger: boolean;
  includeAgentMemory: boolean;
  includePromotedArtifacts: boolean;
  maxItems: number;
};

export type MemoryPromotionInput = {
  memoryId: string;
  sourceVersion?: number;
  kind: MemoryPromotionKind;
  title: string;
  rationale: string;
};

export type MemoryPromotionReviewInput = {
  status: Extract<MemoryPromotionStatus, "approved" | "rejected">;
  reviewNote?: string;
};

export type MemoryFeedbackInput = {
  sourceVersion?: number;
  summary: string;
  note: string;
};

export type MemoryForgetInput = {
  sourceVersion?: number;
  reason: string;
};

type MemoryPolicyResponse = {
  policy: MemoryInjectionPolicy;
  center: MemoryCenter;
};

type MemoryPromotionResponse = {
  promotion: MemoryPromotion;
  center: MemoryCenter;
};

type MemoryArtifactMutationResponse = {
  detail: MemoryArtifactDetail;
  center: MemoryCenter;
};

type MutationErrorPayload = {
  error?: string;
};

const EMPTY_MEMORY_CENTER: MemoryCenter = {
  policy: {
    mode: "governed-first",
    includeRoomNotes: true,
    includeDecisionLedger: true,
    includeAgentMemory: false,
    includePromotedArtifacts: true,
    maxItems: 6,
    updatedAt: "",
    updatedBy: "",
  },
  previews: [],
  promotions: [],
  pendingCount: 0,
  approvedCount: 0,
  rejectedCount: 0,
};

class MemoryMutationError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "MemoryMutationError";
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
    throw new MemoryMutationError(payload.error || `memory request failed: ${response.status}`, response.status);
  }
  return payload;
}

export function useLiveMemoryCenter() {
  const [center, setCenter] = useState<MemoryCenter>(EMPTY_MEMORY_CENTER);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const commitCenter = useCallback((next: MemoryCenter) => {
    startTransition(() => {
      setCenter(next);
      setError(null);
      setLoading(false);
    });
  }, []);

  const commitError = useCallback((nextError: unknown) => {
    setError(nextError instanceof Error ? nextError.message : "memory center fetch failed");
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await requestJSON<MemoryCenter>("/v1/memory-center");
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
    async (input: MemoryPolicyInput) => {
      const payload = await requestJSON<MemoryPolicyResponse>("/v1/memory-center/policy", {
        method: "POST",
        body: JSON.stringify(input),
      });
      commitCenter(payload.center);
      return payload;
    },
    [commitCenter]
  );

  const createPromotion = useCallback(
    async (input: MemoryPromotionInput) => {
      const payload = await requestJSON<MemoryPromotionResponse>("/v1/memory-center/promotions", {
        method: "POST",
        body: JSON.stringify(input),
      });
      commitCenter(payload.center);
      return payload;
    },
    [commitCenter]
  );

  const reviewPromotion = useCallback(
    async (promotionId: string, input: MemoryPromotionReviewInput) => {
      const payload = await requestJSON<MemoryPromotionResponse>(`/v1/memory-center/promotions/${promotionId}/review`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      commitCenter(payload.center);
      return payload;
    },
    [commitCenter]
  );

  const submitFeedback = useCallback(
    async (memoryId: string, input: MemoryFeedbackInput) => {
      const payload = await requestJSON<MemoryArtifactMutationResponse>(`/v1/memory/${memoryId}/feedback`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      commitCenter(payload.center);
      return payload;
    },
    [commitCenter]
  );

  const forgetMemory = useCallback(
    async (memoryId: string, input: MemoryForgetInput) => {
      const payload = await requestJSON<MemoryArtifactMutationResponse>(`/v1/memory/${memoryId}/forget`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      commitCenter(payload.center);
      return payload;
    },
    [commitCenter]
  );

  return {
    center,
    loading,
    error,
    refresh,
    updatePolicy,
    createPromotion,
    reviewPromotion,
    submitFeedback,
    forgetMemory,
  };
}
