import { useId } from "react";
import { cn } from "@/lib/cn";

type InfoHintProps = {
  label: string;
  className?: string;
};

export function InfoHint({ label, className }: InfoHintProps) {
  const tooltipId = useId();

  return (
    <span className={cn("group relative inline-flex", className)}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={tooltipId}
        className="info-hint"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="h-[12px] w-[12px]"
          fill="none"
        >
          <circle cx="8" cy="8" r="5.25" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="8" cy="4.9" r="0.8" fill="currentColor" />
          <path
            d="M8 7v4"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className="info-tooltip pointer-events-none hidden group-hover:block group-focus-within:block"
      >
        {label}
      </span>
    </span>
  );
}
