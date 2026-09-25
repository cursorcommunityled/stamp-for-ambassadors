"use client";

import { useTheme } from "@/components/theme-provider";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="inline-flex size-8 items-center justify-center text-mute hover:text-ink"
    >
      <Moon className="size-3.5 dark:hidden" />
      <Sun className="hidden size-3.5 dark:block" />
    </button>
  );
}
