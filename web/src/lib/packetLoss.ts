import SpeedTestEngine from "@cloudflare/speedtest";

/** Same base the rest of the client uses; empty means same-origin. */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

/**
 * Packet loss, measured with Cloudflare's open-source engine (MIT).
 *
 * This is the one metric we deliberately don't build ourselves. Loss can't be
 * observed over TCP from a browser — TCP retransmits silently, so a lossy link
 * shows up as "slower", never as "lossy". Measuring it needs unreliable
 * transport, which in a browser means WebRTC over a TURN server. That's a real
 * piece of infrastructure, and Cloudflare already runs it.
 *
 * Bandwidth still runs on our own engine against our own Worker — this borrows
 * only the loss probe, which is a few hundred tiny packets rather than bulk
 * transfer, so it isn't leaning on someone else's capacity to move real data.
 */

/** Ratio 0–1, or null when the probe couldn't run (blocked UDP, no TURN, etc). */
export type PacketLossResult = number | null;

const PROBE_TIMEOUT_MS = 12_000;

export async function measurePacketLoss(signal?: AbortSignal): Promise<PacketLossResult> {
  if (signal?.aborted) return null;

  return new Promise<PacketLossResult>((resolve) => {
    let settled = false;
    const finish = (value: PacketLossResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      try {
        engine.pause();
      } catch {
        /* already stopped */
      }
      resolve(value);
    };

    // Loss is a bonus metric on top of a test that has already produced its
    // headline numbers. It must never be the reason a run appears to hang, so
    // it gets a hard ceiling regardless of what the engine is doing.
    const timer = setTimeout(() => finish(null), PROBE_TIMEOUT_MS);
    const onAbort = () => finish(null);
    signal?.addEventListener("abort", onAbort);

    const engine = new SpeedTestEngine({
      autoStart: false,
      // Only the loss probe. Download/upload/latency stay on our own engine
      // against our own Worker — running theirs too would double the bandwidth
      // per test and halve how many tests fit in the Workers free tier.
      // 500 packets in batches of 10, ~500ms of sending, then 3s for stragglers.
      // Sent in batches rather than all at once so the probe doesn't itself
      // burst hard enough to cause the loss it's trying to observe.
      measurements: [
        {
          type: "packetLoss",
          numPackets: 500,
          batchSize: 10,
          batchWaitTime: 10,
          responsesWaitTime: 3000,
          connectionTimeout: 5000,
        },
      ],
      // OFF, deliberately. Both default to Cloudflare endpoints, so leaving
      // them alone would ship every visitor's test results to a third party
      // without disclosure — which would make our own privacy policy false and
      // is exactly the kind of undisclosed data sharing Google Ads polices.
      logAimApiUrl: null,
      logMeasurementApiUrl: null,
      // Our Worker, not Cloudflare's. Theirs (speed.cloudflare.com/turn-creds)
      // answers 403 to anyone off their own domain, so the default path can
      // never work for us — verified, not assumed. Ours returns 501 until a
      // TURN key is configured, which surfaces here as onError and reports
      // loss as unknown.
      turnServerCredsApiUrl: `${API_BASE}/api/turn-creds`,
    });

    engine.onFinish = (results) => {
      const loss = results.getPacketLoss();
      finish(typeof loss === "number" && Number.isFinite(loss) ? loss : null);
    };
    // UDP is blocked on plenty of corporate and mobile networks, so failure
    // here is ordinary rather than exceptional — report "unknown", not an error.
    engine.onError = () => finish(null);

    try {
      engine.play();
    } catch {
      finish(null);
    }
  });
}
