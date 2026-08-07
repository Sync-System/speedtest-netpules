import { useCallback, useEffect, useState } from "react";

/**
 * Dark is the product's default, not an inherited OS preference — so this is
 * two states rather than three. An earlier version tracked a "system" choice
 * via prefers-color-scheme; that's the right call for a site with no opinion,
 * but it directly contradicts having a default of our own, and carrying both
 * meant "default" silently meant different things on different machines.
 *
 * The default is expressed in CSS (`color-scheme: dark` on :root), not here.
 * This hook therefore only ever writes an attribute to OVERRIDE that, which is
 * what keeps the common case free of both JavaScript and a flash: a first-time
 * visitor paints dark before this module has even run.
 */
export type Theme = "dark" | "light";

const DEFAULT_THEME: Theme = "dark";
const STORAGE_KEY = "speedtest4u.theme";

function readStored(): Theme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === "light" || raw === "dark" ? raw : DEFAULT_THEME;
  } catch {
    // Private browsing and blocked-storage modes throw on access rather than
    // returning null, so this needs catching, not a null check.
    return DEFAULT_THEME;
  }
}

/**
 * Applied outside React so the override lands during module evaluation, before
 * the first render — rather than in an effect, which runs after the browser has
 * already had a chance to paint the default.
 */
export function applyStoredTheme() {
  const theme = readStored();
  const root = document.documentElement;
  if (theme === DEFAULT_THEME) {
    // No attribute at all in the default case: the CSS default already covers
    // it, and writing one would only invite the two to drift apart.
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readStored);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === DEFAULT_THEME) root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);

    try {
      if (theme === DEFAULT_THEME) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* storage unavailable; the choice still holds for this session */
    }
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggle };
}
