/**
 * A single ad position, rendering real image creative.
 *
 * Four rules are baked in here rather than left to each call site, because
 * getting any of them wrong costs more than the slot earns:
 *
 * 1. Intrinsic width/height on every image, so the box is reserved before the
 *    file loads. An ad that pops in and shoves the page down is a Cumulative
 *    Layout Shift hit, and CLS feeds Google's page-experience signal — a sloppy
 *    slot quietly costs ranking on the searches that bring people here.
 * 2. Every slot is labelled "Advertisement". Policy requires ads be
 *    distinguishable from content, and on a measurement tool the cost of
 *    looking like we dressed an ad up as a result is the site's credibility.
 * 3. Nothing animates. The gauge is the only thing on this page allowed to
 *    move; an ad competing with it during a test is the failure mode to avoid.
 * 4. Creative is chosen from the visitor's own result — see pickCreative.
 *
 * The files are SVG on purpose: a few KB each, sharp on any display, no
 * external request (so `img-src 'self'` holds), and editable as text rather
 * than needing a design tool to change a price or a headline.
 */

interface Creative {
  src: string;
  /** Narrow-screen variant. Falls back to `src` when absent. */
  srcMobile?: string;
  width: number;
  height: number;
  mobileWidth?: number;
  mobileHeight?: number;
  /** Describes the OFFER — a screen reader user is deciding whether to care. */
  alt: string;
  href: string;
}

const ROUTER: Creative = {
  src: "/ads/router-300x250.svg",
  width: 300,
  height: 250,
  alt: "Slow Wi-Fi? Your router may be the bottleneck, not your plan. Compare mesh systems.",
  href: "#about",
};

const PLAN: Creative = {
  src: "/ads/plan-300x250.svg",
  width: 300,
  height: 250,
  alt: "Paying for speed you never see? Check what else is available to you. Compare plans.",
  href: "#about",
};

const GUIDE: Creative = {
  src: "/ads/guide-728x90.svg",
  srcMobile: "/ads/guide-320x100.svg",
  width: 728,
  height: 90,
  mobileWidth: 320,
  mobileHeight: 100,
  alt: "Slow result? Wi-Fi distance, router age and peak-hour congestion explain most slow tests. Read the guide.",
  href: "#about",
};

/**
 * Serve the creative that fits what we just measured.
 *
 * This is the whole revenue argument for putting ads on a speed test rather
 * than a blog: nowhere else does a visitor hand you a fresh, specific number
 * about a problem they're currently annoyed by. Someone who has just watched
 * 6 Mbps land on the gauge is in-market for a better plan in a way no
 * demographic guess could identify — so they get the plan comparison, and the
 * happy visitor gets a coverage offer instead of an irrelevant "fix your slow
 * internet" pitch they'll ignore.
 *
 * Worth being precise about what this is NOT: it reads a number already on
 * screen, in memory, for this render only. No profile, no cookie, no third
 * party, nothing stored or sent — so it stays true to the privacy policy and
 * needs no consent banner. Relevance without tracking.
 */
const SLOW_MBPS = 25;

function pickCreative(downloadMbps: number | null): Creative {
  if (downloadMbps == null) return ROUTER; // no result yet — neutral, fits either way
  return downloadMbps < SLOW_MBPS ? PLAN : ROUTER;
}

type AdFormat = "leaderboard" | "rectangle";

interface AdSlotProps {
  format: AdFormat;
  /** Measured download, when there is one, for creative selection. */
  downloadMbps?: number | null;
  className?: string;
}

export function AdSlot({ format, downloadMbps = null, className = "" }: AdSlotProps) {
  const creative = format === "leaderboard" ? GUIDE : pickCreative(downloadMbps);
  const hasMobile = Boolean(creative.srcMobile);

  return (
    <aside
      // "complementary", not a bare div: it tells a screen reader this sits
      // apart from the page's actual purpose, so it can be skipped.
      aria-label="Advertisement"
      className={`flex w-full flex-col items-center ${className}`}
    >
      {/* Not text-muted-foreground: this label sits directly on the page
          background here, not on a --card — and muted-foreground against
          --background measures only ~4.39:1 in light mode (verified against
          the actual rendered page, not assumed from a card context), just
          under the 4.5:1 floor for text this small. This dedicated shade
          measures ~5.7:1 light / ~7.8:1 dark against that real background,
          while staying close enough to muted-foreground's tone to still read
          as secondary to the ad itself. */}
      <span
        className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em]"
        style={{ color: "light-dark(#54627a, #9aabbd)" }}
      >
        Advertisement
      </span>
      <a href={creative.href} className="block max-w-full rounded-xl transition-opacity hover:opacity-90">
        <picture>
          {hasMobile && (
            <source
              media="(min-width: 640px)"
              srcSet={creative.src}
              width={creative.width}
              height={creative.height}
            />
          )}
          <img
            src={hasMobile ? creative.srcMobile : creative.src}
            width={hasMobile ? creative.mobileWidth : creative.width}
            height={hasMobile ? creative.mobileHeight : creative.height}
            alt={creative.alt}
            // Below the gauge in every case, so it is never what the visitor is
            // waiting on — but eager rather than lazy, because a slot that
            // resolves late is a slot that shifts late.
            decoding="async"
            className="h-auto max-w-full rounded-xl"
          />
        </picture>
      </a>
    </aside>
  );
}
