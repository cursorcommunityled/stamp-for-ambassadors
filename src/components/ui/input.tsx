import * as React from "react";
import { cn } from "@/lib/utils";

const fieldControl =
  "w-full bg-transparent text-sm text-ink placeholder:text-mute/80 focus-visible:border-ink focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        fieldControl,
        "h-11 border-x-0 border-t-0 border-b border-ink/25 px-0",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        fieldControl,
        "border border-ink/20 px-3 py-2.5 leading-6",
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  // Wrapping the control is what ties the words to it for screen readers and
  // makes the label clickable; the hint stays outside so it is not read as
  // part of the field's name.
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label className="flex flex-col gap-2">
        <span className="text-[10px] uppercase tracking-[0.14em] text-mute select-none">
          {label}
        </span>
        {children}
      </label>
      {hint ? <p className="text-xs leading-5 text-mute">{hint}</p> : null}
    </div>
  );
}
