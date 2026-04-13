export type PhaseZeroStreamDecision =
  | {
      kind: "apply";
      nextSequence: number;
    }
  | {
      kind: "ignore";
      nextSequence: number;
    }
  | {
      kind: "refresh";
      nextSequence: number;
    };

function normalizePositiveSequence(sequence: number | null | undefined): number | null {
  if (typeof sequence !== "number" || !Number.isFinite(sequence) || sequence <= 0) {
    return null;
  }
  return Math.trunc(sequence);
}

function advanceSequence(currentSequence: number, nextSequence: number | null): number {
  if (nextSequence === null) {
    return currentSequence;
  }
  return Math.max(currentSequence, nextSequence);
}

export function buildPhaseZeroStateStreamURL(apiBase: string, stateStreamPath: string, lastSequence: number): string {
  const baseURL = `${apiBase}${stateStreamPath}`;
  const since = normalizePositiveSequence(lastSequence);
  if (since === null) {
    return baseURL;
  }
  return `${baseURL}?since=${since}`;
}

export function resolvePhaseZeroSnapshotDecision(
  currentSequence: number,
  payloadSequence?: number | null,
): PhaseZeroStreamDecision {
  const nextSequence = normalizePositiveSequence(payloadSequence);
  if (nextSequence !== null && nextSequence <= currentSequence) {
    return { kind: "ignore", nextSequence: currentSequence };
  }
  return { kind: "apply", nextSequence: advanceSequence(currentSequence, nextSequence) };
}

export function resolvePhaseZeroDeltaDecision(
  currentSequence: number,
  payloadSequence?: number | null,
): PhaseZeroStreamDecision {
  const nextSequence = normalizePositiveSequence(payloadSequence);
  if (nextSequence !== null && nextSequence <= currentSequence) {
    return { kind: "ignore", nextSequence: currentSequence };
  }
  if (nextSequence !== null && currentSequence > 0 && nextSequence > currentSequence + 1) {
    return { kind: "refresh", nextSequence: advanceSequence(currentSequence, nextSequence) };
  }
  return { kind: "apply", nextSequence: advanceSequence(currentSequence, nextSequence) };
}

export function resolvePhaseZeroResyncDecision(
  currentSequence: number,
  payloadSequence?: number | null,
): PhaseZeroStreamDecision {
  const nextSequence = normalizePositiveSequence(payloadSequence);
  return { kind: "refresh", nextSequence: advanceSequence(currentSequence, nextSequence) };
}
