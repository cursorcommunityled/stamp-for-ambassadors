import { cn } from "@/lib/utils";

export function StampCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("stamp-card", className)}>{children}</div>;
}
