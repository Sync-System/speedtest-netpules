import { useState } from "react";
import type { TestResult } from "../lib/speedTest";

interface HistoryProps {
  history: TestResult[];
}

export function History({ history }: HistoryProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    // Anchor target for the header's "History" link — previously that nav
    // item was a styled <span> that did nothing when clicked.
    <section id="history" className="mx-auto mt-5 w-full max-w-3xl scroll-mt-20">
      <div className="flex items-center justify-between gap-3">
        <div>
          {/* Not text-muted-foreground: this eyebrow sits directly on the page
              background (no --card wrapper here), where muted-foreground
              measures ~4.39:1 in light mode — just under the 4.5:1 floor for
              text this small (verified against the real rendered page, the
              same gap found and fixed in AdSlot's "Advertisement" label).
              This dedicated shade clears ~5.7:1 light / ~7.8:1 dark there. */}
          <p className="text-xs tracking-wider" style={{ color: "light-dark(#54627a, #9aabbd)" }}>
            HISTORY
          </p>
          {/* Says only what's true: these are this browser's own recent runs,
              held in localStorage. The previous copy claimed "verified" tests —
              nothing verifies them, and overstating provenance is corrosive in
              a tool whose entire value is that its numbers can be trusted. */}
          <h2 className="font-heading text-lg font-semibold">
            {history.length === 0
              ? "No tests run yet on this device"
              : `Last ${history.length === 1 ? "test" : `${history.length} tests`} on this device`}
          </h2>
        </div>
        {history.length > 0 && (
          <button
            className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium text-primary"
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? "Hide details" : "Show details"}
          </button>
        )}
      </div>

      {expanded && (
        <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
          {history.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No tests run yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="p-3 font-normal">Time</th>
                  <th className="p-3 font-normal">Ping</th>
                  <th className="p-3 font-normal">Download</th>
                  <th className="p-3 font-normal">Upload</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => (
                  <tr key={entry.timestamp} className="border-b border-border last:border-0">
                    <td className="p-3 text-muted-foreground">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </td>
                    {/* tabular-nums IS right here: these figures stack in
                        columns, so equal-width digits keep them aligned. */}
                    <td className="p-3 font-mono tabular-nums">{entry.pingMs.toFixed(0)} ms</td>
                    <td className="p-3 font-mono tabular-nums">{entry.downloadMbps.toFixed(1)} Mbps</td>
                    <td className="p-3 font-mono tabular-nums">{entry.uploadMbps.toFixed(1)} Mbps</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
