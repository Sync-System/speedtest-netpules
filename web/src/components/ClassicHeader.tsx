import { Gauge as GaugeIcon, Moon, Sun } from "lucide-react";
import { useTheme } from "../lib/useTheme";

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const next = theme === "dark" ? "light" : "dark";

  return (
    <button
      onClick={toggle}
      // The icon alone carries the meaning, so it needs a real accessible name.
      // It names the ACTION ("switch to dark mode") rather than the state, since
      // that's what pressing it does — and aria-pressed would be wrong here:
      // this isn't a toggle stuck on/off, it's a switch between two peers.
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
    >
      {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}

export function ClassicHeader() {
  return (
    <header className="border-b border-border bg-card px-6 py-4">
      <div className="mx-auto flex max-w-4xl items-center justify-between">
        <div className="flex items-center gap-2">
          <GaugeIcon size={22} className="text-primary" />
          <span className="font-heading text-lg font-extrabold tracking-tight">
            Speedtest<span className="text-primary">4u</span>
          </span>
        </div>
        {/* Previously three plain <span>s styled like nav links but wired to
            nothing — clicking "History" or "About" did nothing, which is
            both a broken-UX bug and the kind of non-functional navigation
            Google Ads landing-page review flags. Real anchors to real
            same-page sections now. */}
        {/* The toggle sits outside the nav and stays visible below sm — the
            links collapse on small screens, but theme is a preference people
            reach for most on a phone at night. */}
        <div className="flex items-center gap-4">
          <nav className="hidden gap-6 text-sm font-medium text-muted-foreground sm:flex">
            <a href="#top" className="text-foreground">
              Speed Test
            </a>
            <a href="#history" className="hover:text-foreground">
              History
            </a>
            <a href="#about" className="hover:text-foreground">
              About
            </a>
          </nav>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
