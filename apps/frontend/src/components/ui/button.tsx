import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "tint";
type ButtonSize = "sm" | "md";

type UIButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
};

const variantClassName: Record<ButtonVariant, string> = {
  primary: "border-[var(--accent-blue)] bg-[var(--accent-blue)] text-white",
  secondary: "bg-white text-black/72",
  ghost: "border-transparent bg-transparent text-black/60 hover:bg-black/[0.03]",
  tint: "border-[var(--accent-blue)]/12 bg-[var(--accent-blue-soft)] text-[var(--accent-blue)]",
};

const sizeClassName: Record<ButtonSize, string> = {
  sm: "rounded-[8px] px-2.25 py-[0.34rem] text-[10px] font-medium leading-none",
  md: "action-pill",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...props
}: UIButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap border disabled:cursor-not-allowed disabled:opacity-50",
        variantClassName[variant],
        sizeClassName[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
