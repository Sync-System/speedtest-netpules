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
        <FooterSection title="About Speedtest4u">
          <p>
            Speedtest4u is a free, self-hosted internet speed test. It measures your
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

        {/* Real, load-bearing content, not filler: this is close to the only
            indexable body text on a page that's otherwise a single interactive
            tool. It also answers exactly what a confused "Under load: 40ms" or
            "unstable 2-9 Mbps" reading raises for a non-technical visitor —
            useful in its own right regardless of any search-traffic benefit.
            Mirrored word-for-word in the FAQPage JSON-LD in index.html:
            Google requires visible content to match structured data, and
            a mismatch risks a manual action against the rich-result
            eligibility rather than just losing it quietly. */}
        <FooterSection title="Frequently Asked Questions" defaultOpen>
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold text-foreground">What is a good download speed?</h3>
              <p className="mt-1">
                Roughly: 25 Mbps covers one HD stream comfortably, 100+ Mbps handles
                several 4K streams or a busy household, and gigabit (900+ Mbps) mainly
                matters for large file transfers rather than everyday browsing or
                video calls.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Why does upload speed matter?</h3>
              <p className="mt-1">
                Upload is what limits video calls, cloud backups, and livestreaming —
                it's typically far lower than download on most home connections, which
                is normal and expected, not a fault.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-foreground">What is ping (latency)?</h3>
              <p className="mt-1">
                How long a signal takes to reach our server and back, in milliseconds.
                Lower is better — it's the number that determines whether a game or
                video call feels instant or laggy, independent of your Mbps.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-foreground">What is jitter?</h3>
              <p className="mt-1">
                How much your ping varies from one moment to the next. A connection
                with low ping but high jitter can still cause choppy calls, because
                packets arrive unevenly even though the average delay looks fine.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-foreground">What does "Under load" (bufferbloat) mean?</h3>
              <p className="mt-1">
                Your ping measured while the connection is busy downloading or
                uploading, instead of idle. A big jump — say 20ms idle to 400ms
                loaded — means your router is queuing data instead of sending it, and
                is why calls can lag specifically while something else is
                downloading in the background.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Why do my results change each time I test?</h3>
              <p className="mt-1">
                Server load, Wi-Fi interference, other devices on your network, and
                your ISP's own peak-hour congestion all shift the number run to run —
                true of every speed test, not just this one. Treat one result as a
                data point, and the History section below as the more honest picture.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Is Speedtest4u free? Do I need an account?</h3>
              <p className="mt-1">
                Yes, and no. No sign-up, no app install, no payment — open the page
                and press GO.
              </p>
            </div>
          </div>
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
        © {new Date().getFullYear()} Speedtest4u. Free to use, no account required.
      </div>
    </footer>
  );
}
