import { cn } from "@/lib/utils";

export function StampMark({
  className,
  size = 28,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      className={cn("text-brand", className)}
    >
      <path
        d="M5 1.5h25.5V27"
        stroke="currentColor"
        strokeWidth="0.9"
        opacity="0.4"
      />
      <rect
        x="2.5"
        y="2.5"
        width="27"
        height="27"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path
        fill="currentColor"
        d="M7 7h18v2H7zm0 4h13v2H7zm0 4h18v2H7zm5 4h13v2H12zm-5 4h18v2H7z"
      />
    </svg>
  );
}
