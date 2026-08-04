import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchClientInfo,
  loadHistory,
  measureDownload,
  measurePing,
  measureUpload,
  saveHistoryEntry,
  type ClientInfo,
  type Phase,
  type RateSummary,
  type TestResult,
} from "./speedTest";
import { detectDevice } from "./device";

/**
 * Weight given to each new throughput sample when updating the live readout.
 * TCP delivers in bursts, so consecutive 150ms samples can differ several-fold
 * on a perfectly healthy link. Feeding that raw signal to the gauge makes it
 * thrash and reads as a broken test, so the live figure is an exponential
 * moving average. This affects the DISPLAY only — the reported result comes
 * from the steady-state window measured in speedTest.ts and is untouched.
 */
const SAMPLE_SMOOTHING = 0.3;

function smooth(previous: number, sample: number): number {
  if (previous <= 0) return sample;
  return previous + SAMPLE_SMOOTHING * (sample - previous);
}

export function useSpeedTest() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null);
  const [device] = useState<string>(() => detectDevice());

  const [pingMs, setPingMs] = useState<number | null>(null);
  const [jitterMs, setJitterMs] = useState<number | null>(null);
  const [loadedPingMs, setLoadedPingMs] = useState<number | null>(null);

  const [downloadMbps, setDownloadMbps] = useState(0);
  const [downloadFinal, setDownloadFinal] = useState<RateSummary | null>(null);
  const [downloadFraction, setDownloadFraction] = useState(0);

  const [uploadMbps, setUploadMbps] = useState(0);
  const [uploadFinal, setUploadFinal] = useState<RateSummary | null>(null);
  const [uploadFraction, setUploadFraction] = useState(0);

  const [history, setHistory] = useState<TestResult[]>(() => loadHistory());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchClientInfo(controller.signal).then(setClientInfo);
    return () => controller.abort();
  }, []);

  const reset = useCallback(() => {
    setPingMs(null);
    setJitterMs(null);
    setLoadedPingMs(null);
    setDownloadMbps(0);
    setDownloadFinal(null);
    setDownloadFraction(0);
    setUploadMbps(0);
    setUploadFinal(null);
    setUploadFraction(0);
  }, []);

  const runTest = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    reset();
    // Refresh in the background; don't block the test on it.
    fetchClientInfo(controller.signal).then(setClientInfo).catch(() => {});

    try {
      setPhase("ping");
      const { pingMs: p, jitterMs: j } = await measurePing(undefined, controller.signal);
      setPingMs(p);
      setJitterMs(j);

      setPhase("download");
      const dl = await measureDownload((instant, fraction) => {
        setDownloadMbps((prev) => smooth(prev, instant));
        setDownloadFraction(fraction);
      }, controller.signal);
      setDownloadFinal(dl);
      setDownloadMbps(dl.mbps);

      // Median of the under-load probes, for the same outlier resistance as
      // the idle ping figure.
      let loaded: number | null = null;
      if (dl.loadedPings.length > 0) {
        const sorted = [...dl.loadedPings].sort((a, b) => a - b);
        loaded = sorted[Math.floor(sorted.length / 2)];
        setLoadedPingMs(loaded);
      }

      setPhase("upload");
      const ul = await measureUpload((instant, fraction) => {
        setUploadMbps((prev) => smooth(prev, instant));
        setUploadFraction(fraction);
      }, controller.signal);
      setUploadFinal(ul);
      setUploadMbps(ul.mbps);

      setPhase("done");
      setHistory(
        saveHistoryEntry({
          timestamp: Date.now(),
          pingMs: p,
          jitterMs: j,
          downloadMbps: dl.mbps,
          uploadMbps: ul.mbps,
          loadedPingMs: loaded,
        }),
      );
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        console.error("Speed test failed", err);
        setPhase("idle");
      }
    }
  }, [reset]);

  return {
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
    isRunning: phase !== "idle" && phase !== "done",
  };
}
