import { cn } from "@/lib/utils";

/** Already-engraved art. Do not run event-photo on it. The lines are the image. */
export function Plate({
  src,
  alt,
  className,
  eager,
}: {
  src: string;
  alt: string;
  className?: string;
  eager?: boolean;
}) {
  return (
    <div className={cn("overflow-hidden bg-paper", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        className="size-full object-cover"
      />
    </div>
  );
}
