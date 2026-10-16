import { type SelectHTMLAttributes } from "react";
import { cn } from "@/core/lib/utils";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

export function Select({ className, error, ...props }: SelectProps) {
  return (
    <select
      aria-invalid={error ? true : undefined}
      className={cn(
        "w-full rounded-md border bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        error
          ? "border-destructive focus-visible:ring-destructive"
          : "border-border focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}
