import { useState } from "react";
import { ChevronDown } from "lucide-react";

interface FooterSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function FooterSection({ title, children, defaultOpen = false }: FooterSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border py-4 last:border-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
      >
        <span className="font-heading text-base font-semibold">{title}</span>
        <ChevronDown
          size={18}
          className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {/* Content stays in the DOM regardless of `open` — collapsed via CSS,
          not omitted from render. A search crawler (and the Google Ads
          landing-page reviewer) reads the actual markup, not post-click
          state, so the real disclosure text needs to exist on the page
          whether or not a visitor happens to expand it. */}
      <div className={`grid text-sm leading-relaxed text-muted-foreground ${open ? "mt-3 grid-rows-[1fr]" : "grid-rows-[0fr]"} overflow-hidden transition-[grid-template-rows] duration-200`}>
        <div className="min-h-0 space-y-2">{children}</div>
      </div>
    </div>
  );
}

export function Footer() {
  return (
    <footer id="about" className="mt-8 w-full scroll-mt-20 border-t border-border bg-card">
      <div className="mx-auto w-full max-w-3xl px-6 py-6">
        <FooterSection title="About NetPulse">
          <p>
            NetPulse is a free, self-hosted internet speed test. It measures your
            connection's download and upload throughput, ping, jitter, and how much
            latency your connection adds once it's saturated (bufferbloat) — run
            entirely in your browser against this site's own test server.
          </p>
          <p>
            Speed results vary by server distance, network congestion, and the
            device you're testing from, the same as any speed test — treat a single
            run as one data point, not a certified measurement of your plan speed.
          </p>
        </FooterSection>

        <FooterSection title="Privacy Policy">
          <p>
            <strong className="text-foreground">What we collect:</strong> when you
            load this page or run a test, our server sees your IP address (needed
            to serve the test itself) and looks it up against third-party
            geolocation services to show your approximate ISP and location back to
            you. That lookup is the only place your IP is sent outside this site.
          </p>
          <p>
            <strong className="text-foreground">What we store:</strong> your last 3
            test results are saved in your browser's local storage, on your device
            only. We do not have a server-side database, and results are never sent
            to us, sold, or shared.
          </p>
          <p>
            <strong className="text-foreground">Cookies:</strong> this site does not
            set tracking or advertising cookies.
          </p>
          <p>
            <strong className="text-foreground">Third parties:</strong> browser
            fonts are self-hosted (not loaded from Google Fonts or similar), so
            your visit isn't reported to a font CDN. IP geolocation for the ISP/
            location display is provided by ipapi.co and ip-api.com.
          </p>
        </FooterSection>
      </div>
      <div className="border-t border-border px-6 py-4 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} NetPulse. Free to use, no account required.
      </div>
    </footer>
  );
}
