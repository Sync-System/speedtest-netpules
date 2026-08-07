/**
 * A single ad position.
 *
 * Three rules are baked in here rather than left to each call site, because
 * getting any of them wrong costs more than the slot earns:
 *
 * 1. The height is RESERVED before anything loads. An ad that appears and
 *    shoves the page down is a Cumulative Layout Shift hit, and CLS feeds
 *    Google's page-experience signal — so a sloppy slot can quietly cost you
 *    ranking on the very searches that bring people here.
 * 2. Every slot is labelled "Advertisement". Google requires ads to be
 *    distinguishable from content, and on a measurement tool the cost of
 *    looking like we're dressing an ad up as a result is the whole site's
 *    credibility.
 * 3. Nothing animates. The gauge is the only thing on this page allowed to
 *    move; an ad competing with it for attention during a test is exactly the
 *    failure mode to avoid.
 */

interface HouseAd {
  title: string;
  body: string;
  cta: string;
  href: string;
}

/**
 * Self-served ads. Replace these with real creative, or swap the body of
 * <AdSlot> for an AdSense unit once approved — the reserved sizes below are
 * standard IAB formats (728x90 and 300x250) precisely so that swap is a
 * drop-in and the layout doesn't move when it happens.
 *
 * Empty array renders nothing at all rather than an empty grey box: shipping
 * visible dead space to users costs goodwill and earns zero.
 */
const HOUSE_ADS: Record<string, HouseAd[]> = {
  results: [
    {
      title: "Bookmark Speedtest4u",
      body: "Free, instant, no signup. Test download, upload, ping, jitter and packet loss any time.",
      cta: "Add to bookmarks",
      href: "#top",
    },
  ],
  footer: [
    {
      title: "Slow result? Check these first",
      body: "Wi-Fi distance, router age and peak-hour congestion explain most slow tests before your plan does.",
      cta: "Read the guide",
      href: "#about",
    },
  ],
};

type AdFormat = "leaderboard" | "rectangle";

/** Reserved boxes match IAB standards so an AdSense unit drops straight in. */
const RESERVED: Record<AdFormat, string> = {
  // 320x100 on phones, 728x90 from sm up.
  leaderboard: "min-h-[100px] sm:min-h-[90px]",
  // 300x250 — the best-performing display size, and short enough that it
  // doesn't push the history section off a phone screen.
  rectangle: "min-h-[250px]",
};

interface AdSlotProps {
  /** Which HOUSE_ADS bucket to draw from. */
  id: keyof typeof HOUSE_ADS;
  format: AdFormat;
  className?: string;
}

export function AdSlot({ id, format, className = "" }: AdSlotProps) {
  const pool = HOUSE_ADS[id] ?? [];
  if (pool.length === 0) return null;
  // Chosen per render rather than per session: with one creative it's a no-op,
  // and with several it spreads impressions without needing any state.
  const ad = pool[Math.floor(Math.random() * pool.length)];

  return (
    <aside
      // "complementary", not a bare div: it tells a screen reader this is set
      // apart from the page's actual purpose, so it can be skipped.
      aria-label="Advertisement"
      className={`flex w-full max-w-3xl flex-col items-center ${className}`}
    >
      <span className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
        Advertisement
      </span>
      <a
        href={ad.href}
        className={`flex w-full flex-col items-center justify-center rounded-xl border border-border bg-card px-5 py-4 text-center transition-colors hover:border-primary ${RESERVED[format]}`}
      >
        <p className="font-heading text-base font-bold text-foreground">{ad.title}</p>
        <p className="mt-1 max-w-md text-sm leading-snug text-muted-foreground">{ad.body}</p>
        <span className="mt-2.5 text-sm font-semibold text-primary">{ad.cta} →</span>
      </a>
    </aside>
  );
}
