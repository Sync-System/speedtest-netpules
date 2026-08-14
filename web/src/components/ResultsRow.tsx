import { ArrowDown, ArrowUp, PackageX, Timer, Waves } from "lucide-react";
import type { RateSummary, Stability } from "../lib/speedTest";

interface ResultsRowProps {
  pingMs: number | null;
  jitterMs: number | null;
  loadedPingMs: number | null;
  /** True once the download-phase probe has run and returned zero samples —
   * distinct from loadedPingMs simply not being measured yet. */
  loadedPingFailed: boolean;
  /** Ratio 0–1, or null while probing / when the probe couldn't run. */
  packetLoss: number | null;
  downloadFinal: RateSummary | null;
  uploadFinal: RateSummary | null;
}

const STABILITY_LABEL: Record<Stability, string> = {
  "very-stable": "very steady",
  stable: "steady",
  variable: "fluctuating",
  unstable: "unstable",
};

/** Significant figures scaled to magnitude — "9.2" is meaningful, "912.4" is
 * not, since the trailing digit is far below the measurement's real spread. */
function formatRate(mbps: number): string {
  if (mbps >= 100) return mbps.toFixed(0);
  if (mbps >= 10) return mbps.toFixed(1);
  return mbps.toFixed(2);
}

function Metric({
  icon,
  label,
  value,
  detail,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  /** Colours the icon only. The value stays in ink — see note below. */
  accent?: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-border bg-card px-4 py-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <span style={accent ? { color: accent } : undefined}>{icon}</span>
        {label}
      </div>
      {/* Ink, not the series colour: the brand orange measures 2.77:1 against
          this card, which fails contrast even at large-text sizes. The tinted
          icon beside the label carries identity instead, so nothing is
          encoded by colour alone. Proportional figures (no tabular-nums) —
          equal-width digits read loose on a standalone number. */}
      <p className="mt-1.5 text-3xl font-bold text-foreground">{value}</p>
      <span className="mt-1 text-center text-xs leading-snug text-muted-foreground">{detail}</span>
    </div>
  );
}

function RateMetric({
  icon,
  label,
  summary,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  summary: RateSummary | null;
  accent: string;
}) {
  if (!summary) {
    return <Metric icon={icon} label={label} value="—" detail="Mbps" accent={accent} />;
  }

  // Collapse the range when the spread is too small to be meaningful —
  // showing "9.20–9.21" would imply precision rather than communicate it.
  const spread = summary.highMbps - summary.lowMbps;
  const showRange = spread > Math.max(summary.mbps * 0.04, 0.05);
  const shaky = summary.stability === "variable" || summary.stability === "unstable";
  const range = `${formatRate(summary.lowMbps)}–${formatRate(summary.highMbps)}`;

  // On a shaky link the range can legitimately reach near zero (the path
  // stalled outright for a moment). Naming the instability alongside it stops
  // that low end from reading as a broken measurement.
  const detail = !showRange
    ? `Mbps · ${STABILITY_LABEL[summary.stability]}`
    : shaky
      ? `Mbps · ${STABILITY_LABEL[summary.stability]} ${range}`
      : `Mbps · ${range}`;

  return (
    <Metric
      icon={icon}
      label={label}
      value={formatRate(summary.mbps)}
      detail={detail}
      accent={accent}
    />
  );
}

/**
 * Loss is reported at a precision the sample size can support. 500 packets
 * resolve to 0.2%, so "0.37%" would be inventing a digit; anything that did
 * arrive lossless is stated plainly as "None" rather than a decorative 0.00%.
 */
function formatLoss(ratio: number): { value: string; detail: string } {
  const pct = ratio * 100;
  if (pct <= 0) return { value: "None", detail: "no packets lost" };
  if (pct < 1) return { value: `${pct.toFixed(1)}%`, detail: "slight loss" };
  if (pct < 2.5) return { value: `${pct.toFixed(1)}%`, detail: "calls may stutter" };
  return { value: `${pct.toFixed(1)}%`, detail: "poor for calls & gaming" };
}

export function ResultsRow({
  pingMs,
  jitterMs,
  loadedPingMs,
  loadedPingFailed,
  packetLoss,
  downloadFinal,
  uploadFinal,
}: ResultsRowProps) {
  const loss = packetLoss != null ? formatLoss(packetLoss) : null;
  // How much latency the path adds once it's saturated. A large gap means an
  // over-buffered link: high Mbps but laggy calls during a download.
  const bloatMs = pingMs != null && loadedPingMs != null ? loadedPingMs - pingMs : null;
  // A negative delta doesn't mean the link got faster under load — it means
  // the idle baseline was noisy. Saying "+0ms" would imply we measured a real
  // zero, so report it as no detected increase instead.
  // loadedPingFailed means the probe ran but never got a single reply back
  // while the link was saturated — worth naming explicitly rather than
  // folding into the plain "ms" case, which reads as "not measured yet".
  const loadDetail = loadedPingFailed
    ? "no response while saturated"
    : bloatMs == null
      ? "ms"
      : bloatMs > 1
        ? `ms · +${bloatMs.toFixed(0)}ms loaded`
        : "ms · no added delay";

  return (
    // Order groups the metrics by what they measure, so same-unit figures sit
    // side by side and can actually be compared: the two Mbps throughput
    // numbers first (the pair users care about most, and the pair that shares
    // a scale), then the two ms latency numbers. In the previous order
    // download and upload landed diagonally opposite each other on the
    // two-column mobile layout, which is the one comparison that must be easy.
    // Five tiles don't divide into two columns, so the mobile layout goes to
    // three across once loss is in play rather than stranding a lone tile on a
    // final row. Below sm the grid only widens when there's actually a fifth
    // tile to place — with four, two columns still reads better.
    <div
      className={`grid w-full max-w-3xl grid-cols-2 gap-3 sm:gap-4 ${
        loss ? "grid-cols-3 sm:grid-cols-5" : "sm:grid-cols-4"
      }`}
    >
      <RateMetric
        icon={<ArrowDown size={15} />}
        label="Download"
        summary={downloadFinal}
        accent="var(--primary)"
      />
      <RateMetric
        icon={<ArrowUp size={15} />}
        label="Upload"
        summary={uploadFinal}
        accent="var(--tertiary)"
      />
      <Metric
        icon={<Timer size={15} />}
        label="Ping"
        value={pingMs != null ? pingMs.toFixed(0) : "—"}
        detail={jitterMs != null ? `ms · ${jitterMs.toFixed(0)}ms jitter` : "ms"}
      />
      <Metric
        icon={<Waves size={15} />}
        label="Under load"
        value={loadedPingMs != null ? loadedPingMs.toFixed(0) : loadedPingFailed ? "Severe" : "—"}
        detail={loadDetail}
      />
      {/* Only mounted once there's a real answer. Loss resolves a few seconds
          after the test reads "complete", and a tile sitting on "—" would look
          like a measurement that failed rather than one still arriving. */}
      {loss && (
        <Metric
          icon={<PackageX size={15} />}
          label="Packet loss"
          value={loss.value}
          detail={loss.detail}
        />
      )}
    </div>
  );
}
