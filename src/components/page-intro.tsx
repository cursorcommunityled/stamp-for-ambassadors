import { cn } from "@/lib/utils";

export function PageIntro({
  eyebrow,
  title,
  description,
  size = "display",
  className,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  size?: "display" | "page";
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("max-w-2xl animate-in-fast", className)}>
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h1
        className={cn(
          "font-display tracking-heading text-ink",
          size === "page"
            ? "text-[2rem] leading-[1.08] md:text-[2.75rem]"
            : "text-[2.5rem] leading-[1.05] md:text-6xl",
          eyebrow && "mt-4",
        )}
      >
        {title}
      </h1>
      {description ? (
        <p className="mt-4 max-w-md text-[15px] leading-7 text-mute">
          {description}
        </p>
      ) : null}
      {children}
    </div>
  );
}
