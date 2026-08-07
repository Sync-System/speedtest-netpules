import { Gauge as GaugeIcon } from "lucide-react";

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
      </div>
    </header>
  );
}
