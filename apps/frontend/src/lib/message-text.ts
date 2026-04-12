"use client";

export function restoreVisibleLineBreaks(value: string) {
  return value.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\r/g, "\r");
}
