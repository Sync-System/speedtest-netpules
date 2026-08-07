import { useCallback, useEffect, useState } from "react";

/**
 * Three states, not two. "system" is a real choice and the default — it means
 * "follow the OS", so someone whose phone flips to dark at sunset gets that
 * without ever visiting the site again. Collapsing this to a light/dark boolean
 * would force us to guess an initial value and then permanently ignore the OS.
 *
 * Only an explicit override is stored or written to the DOM. With no override
 * there is no `data-theme` attribute at all, and the CSS `light-dark()` tokens
 * resolve from `prefers-color-scheme` on their own — before first paint, with
 * no flash and no blocking script.
 */
export type ThemeChoice = "system" | "light" | "dark";

const STORAGE_KEY = "speedtest4u.theme";

function readStored(): ThemeChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === "light" || raw === "dark" ? raw : "system";
  } catch {
    // Private browsing and blocked-storage modes throw on access rather than
    // returning null; falling back to "system" is correct and needs no storage.
    return "system";
  }
}

function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", choice);
  }
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(readStored);
  // What's actually on screen right now — the resolved answer, not the choice.
  // Needed so the toggle can show the icon for the theme in effect when the
  // user is on "system".
  const [resolved, setResolved] = useState<"light" | "dark">(() =>
    typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
  );

  useEffect(() => {
    apply(choice);
    try {
      if (choice === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      /* storage unavailable; the choice still applies for this session */
    }
  }, [choice]);

  // Track the OS preference for as long as we're deferring to it, so a system
  // theme change mid-session is reflected without a reload.
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setResolved(mq.matches ? "dark" : "light");
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const active: "light" | "dark" = choice === "system" ? resolved : choice;

  /** Flip to the opposite of what's currently on screen. */
  const toggle = useCallback(() => {
    setChoice(active === "dark" ? "light" : "dark");
  }, [active]);

  return { choice, active, toggle };
}
