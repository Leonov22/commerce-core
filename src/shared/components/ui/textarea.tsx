import { type TextareaHTMLAttributes } from "react";
import { cn } from "@/core/lib/utils";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export function Textarea({ className, error, ...props }: TextareaProps) {
  return (
    <textarea
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
