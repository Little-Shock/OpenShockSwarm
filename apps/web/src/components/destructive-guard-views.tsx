import Link from "next/link";

import type { DestructiveGuard } from "@/lib/mock-data";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function guardStatusLabel(status: DestructiveGuard["status"]) {
  switch (status) {
    case "approval_required":
      return "approval required";
    case "blocked":
      return "blocked";
    default:
      return "ready";
  }
}

function guardStatusTone(status: DestructiveGuard["status"]) {
  switch (status) {
    case "approval_required":
      return "bg-[var(--shock-pink)] text-white";
    case "blocked":
      return "bg-[var(--shock-yellow)]";
    default:
      return "bg-[var(--shock-lime)]";
  }
}

function guardRiskLabel(risk: DestructiveGuard["risk"]) {
  switch (risk) {
    case "destructive_git":
      return "destructive git";
    case "filesystem_write":
      return "filesystem boundary";
    default:
      return "secret scope";
  }
}

export function DestructiveGuardCard({
  guard,
  contextHref,
  compact = false,
  testIdPrefix = "guard-card",
}: {
  guard: DestructiveGuard;
  contextHref?: string | null;
  compact?: boolean;
  testIdPrefix?: string;
}) {
  return (
    <div
      data-testid={`${testIdPrefix}-${guard.id}`}
      className={cn(
        "rounded-[20px] border-2 border-[var(--shock-ink)] bg-white",
        compact ? "px-3 py-3" : "px-4 py-4"
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          data-testid={`${testIdPrefix}-status-${guard.id}`}
          className={cn("rounded-full border border-[var(--shock-ink)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]", guardStatusTone(guard.status))}
        >
          {guardStatusLabel(guard.status)}
        </span>
        <span className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em]">
          {guardRiskLabel(guard.risk)}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.52)]">{guard.scope}</span>
      </div>
      <h3 className={cn("mt-2 font-display font-bold leading-6", compact ? "text-[18px]" : "text-[20px]")}>{guard.title}</h3>
      <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.72)]">{guard.summary}</p>
      <div className={cn("mt-3 grid gap-2", compact ? "md:grid-cols-1" : "md:grid-cols-3")}>
        {guard.boundaries.map((boundary) => (
          <div key={`${guard.id}-${boundary.label}`} className="border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2.5">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">{boundary.label}</p>
            <p className="mt-1.5 text-[12px] leading-5 text-[color:rgba(24,20,14,0.76)]">{boundary.value}</p>
          </div>
        ))}
      </div>
      {contextHref ? (
        <div className="mt-3">
          <Link
            href={contextHref}
            className="inline-flex border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
          >
            Open Guard Context
          </Link>
        </div>
      ) : null}
    </div>
  );
}
