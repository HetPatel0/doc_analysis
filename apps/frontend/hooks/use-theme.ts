"use client";

import { useCallback, useEffect, useState } from "react";

type Theme = "light" | "dark";

function readTheme(): Theme {
  const saved = window.localStorage.getItem("bookify-theme");
  if (saved === "dark" || saved === "light") {
    return saved;
  }

  // The inline script in the root layout already resolved the system theme.
  return window.document.documentElement.classList.contains("dark")
    ? "dark"
    : "light";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("light");
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Read what the pre-paint script applied instead of guessing, so the first
    // client render never toggles the class (which would look like a flash).
    const initial = readTheme();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(initial);
    setIsReady(true);
  }, []);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    const root = window.document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem("bookify-theme", theme);
  }, [isReady, theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggleTheme };
}
