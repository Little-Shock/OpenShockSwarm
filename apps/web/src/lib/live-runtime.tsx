"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

import { usePhaseZeroState } from "@/lib/live-phase0";
import type {
  RuntimeLeaseRecord,
  RuntimeProviderStatus,
  RuntimeRegistryRecord,
  RuntimeScheduler,
} from "@/lib/phase-zero-types";

const API_BASE = process.env.NEXT_PUBLIC_OPENSHOCK_API_BASE ?? "/api/control";

export type LiveRuntimeSnapshot = {
  runtimeId: string;
  daemonUrl: string;
  machine: string;
  detectedCli: string[];
  providers: RuntimeProviderStatus[] | null;
  shell: string;
  state: string;
  workspaceRoot: string;
  reportedAt: string;
  heartbeatIntervalSeconds?: number;
  heartbeatTimeoutSeconds?: number;
};

export type LiveRuntimeMachine = {
  id: string;
  name: string;
  state: string;
  daemonUrl: string;
  cli: string;
  shell: string;
  os: string;
  lastHeartbeat: string;
};

export type LiveRuntimePairing = {
  daemonUrl: string;
  pairedRuntime: string;
  pairingStatus: string;
  deviceAuth: string;
  lastPairedAt: string;
};

export type LiveRuntimeSelection = {
  selectedRuntime: string;
  selectedDaemonUrl: string;
  pairingStatus: string;
  runtimes: LiveRuntimeMachine[];
};

type RuntimeRegistryResponse = {
  pairedRuntime: string;
  pairingStatus: string;
  runtimes: RuntimeRegistryRecord[];
  leases: RuntimeLeaseRecord[];
  runtimeScheduler: RuntimeScheduler;
};

type RuntimeMutationPayload = {
  error?: string;
};

type LiveRuntimeContextValue = {
  loading: boolean;
  refreshing: boolean;
  runtimeActionLoading: boolean;
  error: string | null;
  pairing: LiveRuntimePairing | null;
  selection: LiveRuntimeSelection | null;
  registry: RuntimeRegistryResponse | null;
  runtime: LiveRuntimeSnapshot | null;
  runtimes: RuntimeRegistryRecord[];
  leases: RuntimeLeaseRecord[];
  scheduler: RuntimeScheduler;
  selectedRuntimeName: string;
  selectedRuntimeRecord: RuntimeRegistryRecord | null;
  pairedRuntimeRecord: RuntimeRegistryRecord | null;
  refresh: (machineOverride?: string) => Promise<void>;
  pairRuntime: (daemonUrl: string, runtimeId?: string) => Promise<void>;
  unpairRuntime: () => Promise<void>;
  selectRuntime: (machine: string) => Promise<void>;
};

const LiveRuntimeContext = createContext<LiveRuntimeContextValue | null>(null);

async function readRuntimeJSON<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const payload = (await response.json()) as T & RuntimeMutationPayload;
  if (!response.ok) {
    throw new Error(payload.error || `request failed: ${response.status}`);
  }

  return payload;
}

function matchesRuntimeName(runtimeName: string, ...candidates: Array<string | undefined>) {
  return candidates.some((candidate) => {
    const normalized = candidate?.trim();
    return Boolean(normalized) && normalized === runtimeName.trim();
  });
}

function statePairingTruth(state: ReturnType<typeof usePhaseZeroState>["state"]): LiveRuntimePairing {
  return {
    daemonUrl: state.workspace.pairedRuntimeUrl,
    pairedRuntime: state.workspace.pairedRuntime,
    pairingStatus: state.workspace.pairingStatus,
    deviceAuth: state.workspace.deviceAuth,
    lastPairedAt: state.workspace.lastPairedAt,
  };
}

function machineDaemonURL(
  state: ReturnType<typeof usePhaseZeroState>["state"],
  pairing: LiveRuntimePairing,
  machineName: string
) {
  const runtime =
    state.runtimes.find((item) => matchesRuntimeName(machineName, item.machine, item.id)) ?? null;
  if (runtime?.daemonUrl) {
    return runtime.daemonUrl;
  }
  if (matchesRuntimeName(machineName, pairing.pairedRuntime)) {
    return pairing.daemonUrl;
  }
  return "";
}

function stateSelectionTruth(
  state: ReturnType<typeof usePhaseZeroState>["state"],
  pairing: LiveRuntimePairing
): LiveRuntimeSelection {
  return {
    selectedRuntime: pairing.pairedRuntime,
    selectedDaemonUrl: pairing.daemonUrl,
    pairingStatus: pairing.pairingStatus,
    runtimes: state.machines.map((machine) => ({
      ...machine,
      daemonUrl: machineDaemonURL(state, pairing, machine.name),
    })),
  };
}

function stateRegistryTruth(
  state: ReturnType<typeof usePhaseZeroState>["state"],
  pairing: LiveRuntimePairing
): RuntimeRegistryResponse {
  return {
    pairedRuntime: pairing.pairedRuntime,
    pairingStatus: pairing.pairingStatus,
    runtimes: state.runtimes,
    leases: state.runtimeLeases,
    runtimeScheduler: state.runtimeScheduler,
  };
}

function resolveTargetRuntime(pairing: LiveRuntimePairing, selection: LiveRuntimeSelection, machineOverride?: string) {
  return machineOverride?.trim() || selection.selectedRuntime.trim() || pairing.pairedRuntime.trim();
}

function runtimeSnapshotFromRecord(record: RuntimeRegistryRecord): LiveRuntimeSnapshot {
  return {
    runtimeId: record.id,
    daemonUrl: record.daemonUrl,
    machine: record.machine,
    detectedCli: record.detectedCli,
    providers: record.providers,
    shell: record.shell,
    state: record.state,
    workspaceRoot: record.workspaceRoot,
    reportedAt: record.reportedAt,
    heartbeatIntervalSeconds: record.heartbeatIntervalSeconds,
    heartbeatTimeoutSeconds: record.heartbeatTimeoutSeconds,
  };
}

function findRuntimeRecord(registry: RuntimeRegistryResponse | null, runtimeName: string) {
  if (!registry || !runtimeName.trim()) {
    return null;
  }

  return registry.runtimes.find((item) => matchesRuntimeName(runtimeName, item.id, item.machine)) ?? null;
}

function currentRuntimeTruth(
  registry: RuntimeRegistryResponse | null,
  pairing: LiveRuntimePairing,
  selection: LiveRuntimeSelection,
  machineOverride?: string
) {
  const targetRuntime = resolveTargetRuntime(pairing, selection, machineOverride);
  if (!targetRuntime) {
    return null;
  }
  const record = findRuntimeRecord(registry, targetRuntime);
  return record ? runtimeSnapshotFromRecord(record) : null;
}

export function LiveRuntimeProvider({ children }: { children: ReactNode }) {
  const { state, loading, error: phaseZeroError, refresh: refreshPhaseState } = usePhaseZeroState();
  const [refreshing, setRefreshing] = useState(false);
  const [runtimeActionLoading, setRuntimeActionLoading] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  const pairing = statePairingTruth(state);
  const selection = stateSelectionTruth(state, pairing);
  const registry = stateRegistryTruth(state, pairing);
  const runtime = currentRuntimeTruth(registry, pairing, selection);

  async function refresh() {
    setRefreshing(true);
    try {
      await refreshPhaseState();
      setRuntimeError(null);
    } catch (refreshError) {
      setRuntimeError(refreshError instanceof Error ? refreshError.message : "runtime fetch failed");
      throw refreshError;
    } finally {
      setRefreshing(false);
    }
  }

  async function pairRuntime(daemonUrl: string, runtimeId?: string) {
    setRuntimeActionLoading(true);
    try {
      await readRuntimeJSON("/v1/runtime/pairing", {
        method: "POST",
        body: JSON.stringify({
          daemonUrl: daemonUrl.trim(),
          runtimeId: runtimeId?.trim() || undefined,
        }),
      });
      setRuntimeError(null);
      await refreshPhaseState();
    } catch (pairError) {
      setRuntimeError(pairError instanceof Error ? pairError.message : "runtime fetch failed");
      throw pairError;
    } finally {
      setRuntimeActionLoading(false);
    }
  }

  async function unpairRuntime() {
    setRuntimeActionLoading(true);
    try {
      await readRuntimeJSON("/v1/runtime/pairing", {
        method: "DELETE",
      });
      setRuntimeError(null);
      await refreshPhaseState();
    } catch (unpairError) {
      setRuntimeError(unpairError instanceof Error ? unpairError.message : "runtime fetch failed");
      throw unpairError;
    } finally {
      setRuntimeActionLoading(false);
    }
  }

  async function selectRuntime(machine: string) {
    setRuntimeActionLoading(true);
    try {
      await readRuntimeJSON("/v1/runtime/selection", {
        method: "POST",
        body: JSON.stringify({ machine }),
      });
      setRuntimeError(null);
      await refreshPhaseState();
    } catch (selectionError) {
      setRuntimeError(selectionError instanceof Error ? selectionError.message : "runtime fetch failed");
      throw selectionError;
    } finally {
      setRuntimeActionLoading(false);
    }
  }

  const selectedRuntimeName =
    selection.selectedRuntime?.trim() ||
    pairing.pairedRuntime?.trim() ||
    registry.runtimes[0]?.machine?.trim() ||
    registry.runtimes[0]?.id?.trim() ||
    "";
  const selectedRuntimeRecord = findRuntimeRecord(registry, selectedRuntimeName);
  const pairedRuntimeRecord = findRuntimeRecord(registry, pairing.pairedRuntime ?? "");

  return (
    <LiveRuntimeContext.Provider
      value={{
        loading,
        refreshing,
        runtimeActionLoading,
        error: runtimeError ?? phaseZeroError,
        pairing,
        selection,
        registry,
        runtime,
        runtimes: registry.runtimes,
        leases: registry.leases,
        scheduler: registry.runtimeScheduler,
        selectedRuntimeName,
        selectedRuntimeRecord,
        pairedRuntimeRecord,
        refresh,
        pairRuntime,
        unpairRuntime,
        selectRuntime,
      }}
    >
      {children}
    </LiveRuntimeContext.Provider>
  );
}

export function useLiveRuntimeTruth() {
  const value = useContext(LiveRuntimeContext);
  if (!value) {
    throw new Error("useLiveRuntimeTruth must be used within LiveRuntimeProvider");
  }
  return value;
}
