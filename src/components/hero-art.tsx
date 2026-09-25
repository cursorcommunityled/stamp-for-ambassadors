"use client";

import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";

const EngravingCanvas = dynamic(
  () =>
    import("@/components/engraving-canvas").then(
      (module) => module.EngravingCanvas,
    ),
  {
    ssr: false,
    loading: () => null,
  },
);

export function HeroArt({ className }: { className?: string }) {
  return (
    <div
      className={cn("kinetic-art", className)}
      role="img"
      aria-label="A field of flowing engraved ink lines"
    >
      <EngravingCanvas />
    </div>
  );
}
