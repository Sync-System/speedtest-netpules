import { useEffect, useState } from "react";
import { ClassicHeader } from "./components/ClassicHeader";
import { SpeedDial } from "./components/SpeedDial";
import { ConnectionInfo } from "./components/ConnectionInfo";
import { ResultsRow } from "./components/ResultsRow";
import { History } from "./components/History";
import { Footer } from "./components/Footer";
import { useSpeedTest } from "./lib/useSpeedTest";
import { useIntroSweep } from "./lib/useIntroSweep";

const STATUS_TEXT: Record<string, string> = {
  idle: "Press GO to start",
  ping: "Measuring latency…",
  download: "Testing download speed…",
  upload: "Testing upload speed…",
  done: "Test complete",
};

function dialContent(phase: string, downloadMbps: number, uploadMbps: number) {
  if (phase === "download") return { value: downloadMbps, label: "DOWNLOAD", accent: "var(--primary)" };
  if (phase === "upload") return { value: uploadMbps, label: "UPLOAD", accent: "var(--tertiary)" };
  if (phase === "done") return { value: downloadMbps, label: "DOWNLOAD", accent: "var(--primary)" };
  if (phase === "ping") return { value: 0, label: "PING", accent: "var(--primary)" };
  return { value: 0, label: "MBPS", accent: "var(--primary)" };
}

/**
 * Staggered entrance: each section fades/lifts in a beat after the last,
 * rather than the whole page snapping into place at once. A few hundred
 * milliseconds of sequence reads as considered/crafted; everything arriving
 * in the same frame reads as a template. Cheap to build, disproportionately
 * felt in the first second of anyone's first visit.
 */
function useRevealDelay(ms: number): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setVisible(true), ms);
    return () => clearTimeout(id);
  }, [ms]);
  return visible;
}

function Reveal({ delay, children }: { delay: number; children: React.ReactNode }) {
  const visible = useRevealDelay(delay);
  return (
    <div
      className={`transition-all duration-500 ease-out ${
        visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      }`}
    >
      {children}
    </div>
  );
}

function App() {
  const {
    phase,
    clientInfo,
    device,
    pingMs,
    jitterMs,
    loadedPingMs,
    downloadMbps,
    downloadFinal,
    downloadFraction,
    uploadMbps,
    uploadFinal,
    uploadFraction,
    history,
    runTest,
  } = useSpeedTest();
  const intro = useIntroSweep();

  const showResults = phase === "done";
  // GO waits behind the power-on sweep — offering it mid-animation would
  // invite a click the gauge isn't ready to react to yet.
  const showGo = !intro.active && (phase === "idle" || showResults);
  const progress =
    phase === "download" ? downloadFraction : phase === "upload" ? uploadFraction : 0;

  // When a run finishes, GO returns to the centre but the dial keeps the
  // download result on its arc. Otherwise the largest element on the page
  // would sit empty while the numbers it just measured hide in small tiles.
  const dial = intro.active
    ? { value: intro.value, label: "", accent: "var(--primary)" }
    : dialContent(phase, showResults ? (downloadFinal?.mbps ?? 0) : downloadMbps, uploadMbps);
  const showArc = intro.active || phase !== "idle";

  return (
    <div id="top" className="min-h-screen w-full bg-background flex flex-col">
      <ClassicHeader />

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center gap-8 px-6 py-10">
        {/* The page had zero <h1> elements — a real SEO gap, since it's the
            strongest on-page signal for what a page is about. Visually
            hidden rather than shown: the header's "Speedtest4u" wordmark already
            carries the brand visually, and a second big heading fighting for
            attention above the gauge would be redundant chrome, not content
            people came to read. Search engines and screen readers still get
            the descriptive text either way. */}
        <h1 className="sr-only">Free Internet Speed Test — Download, Upload, Ping & Jitter</h1>

        <Reveal delay={0}>
          <ConnectionInfo clientInfo={clientInfo} device={device} />
        </Reveal>

        <Reveal delay={100}>
          <div className="flex flex-col items-center gap-4">
            <SpeedDial
              value={dial.value}
              showArc={showArc}
              accent={dial.accent}
              showGo={showGo}
              onGoClick={runTest}
              centerLabel={intro.active ? "" : phase === "ping" ? "PINGING" : dial.label}
              centerUnit="Mbps"
              progress={progress}
              settled={showResults}
              status={intro.active ? "" : STATUS_TEXT[phase]}
            />
          </div>
        </Reveal>

        {/* Mounted as soon as a run starts, not on completion: the tiles then
            fill in as each phase resolves instead of appearing all at once and
            shoving the page down. Each shows "—" until it has a real value. */}
        {phase !== "idle" && (
          <ResultsRow
            pingMs={pingMs}
            jitterMs={jitterMs}
            loadedPingMs={loadedPingMs}
            downloadFinal={downloadFinal}
            uploadFinal={uploadFinal}
          />
        )}

        <Reveal delay={200}>
          <History history={history} />
        </Reveal>
      </main>

      <Footer />
    </div>
  );
}

export default App;
