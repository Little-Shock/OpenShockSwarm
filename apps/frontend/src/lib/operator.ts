export const DEFAULT_OPERATOR_NAME = "Sarah";
export const OPERATOR_NAME_COOKIE = "openshock_operator_name";
export const OPERATOR_NAME_STORAGE_KEY = "openshock.operator_name";

const OPERATOR_NAME_MAX_LENGTH = 48;

export function normalizeOperatorName(value?: string | null) {
  const normalized = (value ?? "").trim().replace(/\s+/g, " ");

  if (!normalized) {
    return DEFAULT_OPERATOR_NAME;
  }

  return normalized.slice(0, OPERATOR_NAME_MAX_LENGTH);
}

export function buildOperatorCookieValue(value: string) {
  return `${OPERATOR_NAME_COOKIE}=${encodeURIComponent(normalizeOperatorName(value))}; path=/; max-age=31536000; samesite=lax`;
}

