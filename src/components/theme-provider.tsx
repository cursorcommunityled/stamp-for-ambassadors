"use client";

import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react";

type Theme = "light" | "dark";

const ThemeContext = createContext<{
  resolvedTheme: Theme;
  setTheme: (theme: Theme) => void;
}>({
  resolvedTheme: "light",
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function apply(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function readTheme(): Theme {
  const theme: Theme = localStorage.getItem("theme") === "dark" ? "dark" : "light";
  apply(theme);
  return theme;
}

function subscribe(onChange: () => void) {
  window.addEventListener("stamp-theme", onChange);
  return () => window.removeEventListener("stamp-theme", onChange);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "light" as Theme);

  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem("theme", next);
    apply(next);
    window.dispatchEvent(new Event("stamp-theme"));
  }, []);

  return (
    <ThemeContext.Provider value={{ resolvedTheme: theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
