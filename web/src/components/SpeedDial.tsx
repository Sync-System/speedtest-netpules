import { useAnimatedNumber } from "../lib/useAnimatedNumber";

// Viewport is wider than the gauge itself to leave a clear band outside the
// tick labels (which sit at RADIUS + 26) for the progress ring, so the two
// never overlap.
const SIZE = 400;
const CENTER = SIZE / 2;
const RADIUS = 150;
const PROGRESS_RADIUS = 192;
const STROKE = 14;
const START_ANGLE = -220; // degrees
const SWEEP = 260; // degrees, clockwise
const TICK_VALUES = [0, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];
const MIN_MBPS = 0.5;
const MAX_MBPS = 1000;

function polar(angleDeg: number, radius: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CENTER + radius * Math.cos(rad), y: CENTER + radius * Math.sin(rad) };
}

function arcPath(startDeg: number, endDeg: number, radius: number) {
  const start = polar(startDeg, radius);
  const end = polar(endDeg, radius);
  const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  const sweepFlag = endDeg > startDeg ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} ${sweepFlag} ${end.x} ${end.y}`;
}

function valueToAngle(mbps: number) {
  const clamped = Math.min(Math.max(mbps, MIN_MBPS), MAX_MBPS);
  const logMin = Math.log10(MIN_MBPS);
  const logMax = Math.log10(MAX_MBPS);
  const fraction = (Math.log10(clamped) - logMin) / (logMax - logMin);
  return START_ANGLE + fraction * SWEEP;
}

interface SpeedDialProps {
  value: number;
  /** Draw the arc + needle at `value`. Decoupled from `showGo` so a finished
   * test can keep its result on the dial while GO returns to the centre. */
  showArc: boolean;
  accent?: string;
  onGoClick?: () => void;
  showGo?: boolean;
  centerLabel: string;
  centerUnit?: string;
  /** 0–1 completion of the current phase; drives the outer progress ring. */
  progress?: number;
  /** Test finished: hide the progress ring, keep the result arc. */
  settled?: boolean;
  /** Phase caption, rendered in the gauge's open bottom segment. */
  status?: string;
}

export function SpeedDial({
  value,
  showArc,
  accent = "var(--primary)",
  onGoClick,
  showGo = false,
  centerLabel,
  centerUnit = "Mbps",
  progress = 0,
  settled = false,
  status,
}: SpeedDialProps) {
  // Both the needle and the arc read from this single eased value, so they
  // can never disagree or move at different rates.
  const animatedValue = useAnimatedNumber(showArc ? value : MIN_MBPS);
  const animatedProgress = useAnimatedNumber(progress, 160);

  const needleAngle = valueToAngle(animatedValue);
  const progressEnd = START_ANGLE + Math.min(Math.max(animatedProgress, 0), 1) * SWEEP;

  return (
    <div className="relative flex h-80 w-80 items-center justify-center sm:h-96 sm:w-96">
      {/* Decorative: every value the SVG conveys (reading, unit, phase) is
          also rendered as real text below, so a screen reader gets the
          content from that instead of trying to parse an animating vector
          gauge — hiding the redundant copy is more useful than describing it. */}
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        {/* Phase progress: a thin outer ring so the test never looks stalled,
            even when throughput is momentarily flat. */}
        {showArc && !settled && (
          <path
            d={arcPath(START_ANGLE, progressEnd, PROGRESS_RADIUS)}
            fill="none"
            stroke={accent}
            strokeWidth={3}
            strokeLinecap="round"
            opacity={0.35}
          />
        )}

        <path
          d={arcPath(START_ANGLE, START_ANGLE + SWEEP, RADIUS)}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={STROKE}
          strokeLinecap="round"
        />
        {showArc && (
          <path
            d={arcPath(START_ANGLE, needleAngle, RADIUS)}
            fill="none"
            stroke={accent}
            strokeWidth={STROKE}
            strokeLinecap="round"
          />
        )}

        {TICK_VALUES.map((tickValue) => {
          const angle = valueToAngle(Math.max(tickValue, MIN_MBPS));
          const inner = polar(angle, RADIUS - STROKE / 2 - 4);
          const outer = polar(angle, RADIUS + STROKE / 2 + 4);
          const labelPos = polar(angle, RADIUS + 26);
          return (
            <g key={tickValue}>
              <line
                x1={inner.x}
                y1={inner.y}
                x2={outer.x}
                y2={outer.y}
                stroke="var(--border)"
                strokeWidth={1.5}
              />
              <text
                x={labelPos.x}
                y={labelPos.y}
                fill="var(--muted-foreground)"
                fontFamily="var(--font-mono)"
                fontSize="11"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {tickValue}
              </text>
            </g>
          );
        })}

        {/* Needle — no CSS transition: the value itself is already eased, and
            layering a transition on top would add lag and overshoot. */}
        <g
          style={{
            transformOrigin: `${CENTER}px ${CENTER}px`,
            transform: `rotate(${needleAngle + 90}deg)`,
          }}
        >
          <polygon
            points={`${CENTER - 5},${CENTER} ${CENTER + 5},${CENTER} ${CENTER},${CENTER - RADIUS + 20}`}
            fill={showArc ? accent : "var(--border)"}
          />
          <circle cx={CENTER} cy={CENTER} r={10} fill={showArc ? accent : "var(--border)"} />
        </g>
      </svg>

      <div
        className="absolute rounded-full bg-card shadow-lg flex flex-col items-center justify-center text-center"
        style={{ inset: "4.5rem" }}
      >
        {showGo ? (
          <button
            onClick={onGoClick}
            className="flex h-28 w-28 items-center justify-center rounded-full bg-primary font-heading text-2xl font-extrabold tracking-wide text-primary-foreground shadow-md transition-transform hover:scale-105 active:scale-95"
          >
            GO
          </button>
        ) : (
          <>
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">
              {centerLabel}
            </span>
            {/* The page's hero figure, so it carries hero weight (~48px+).
                tabular-nums is kept HERE specifically because this value
                re-renders every animation frame — proportional digits would
                make the number shift horizontally as they change. Static
                figures elsewhere use proportional. */}
            <p className="mt-1.5 font-mono text-5xl font-bold tracking-tight text-foreground tabular-nums">
              {animatedValue > MIN_MBPS ? animatedValue.toFixed(1) : "0.0"}
            </p>
            <span className="mt-1 text-sm text-muted-foreground">{centerUnit}</span>
          </>
        )}
      </div>

      {/* The gauge sweeps 260°, leaving its bottom segment open — previously
          just dead space that pushed the results further down the page. The
          phase caption lives there instead, inside the instrument it
          describes. Fixed height so swapping captions never shifts layout.
          aria-live announces "Testing download speed…" → "Test complete" as
          they change; the Mbps figure above is deliberately NOT live —  it
          updates every animation frame, and a screen reader announcing 60
          numbers a second would be unusable. The phase change is the
          meaningful event to speak aloud; the final reading is read once,
          normally, from the result cards below. */}
      <p
        aria-live="polite"
        className="absolute bottom-0 left-0 right-0 flex h-5 items-center justify-center text-center text-sm font-medium text-muted-foreground"
      >
        {status}
      </p>
    </div>
  );
}
