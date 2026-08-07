import { useEffect, useRef, useState } from "react";

/**
 * A one-time "power-on" sweep on first load: the needle races up toward the
 * top of the scale and eases back down to rest, the way a car's speedometer
 * or fuel gauge sweeps through its full range when you start the engine —
 * before you've touched anything, it silently says "this instrument works."
 *
 * Runs once per page load (not per visit — there's no point re-playing it on
 * every "Test again"), then hands off to the normal idle GO state.
 */
const RAMP_UP_MS = 750;
const HOLD_MS = 150;
const EASE_DOWN_MS = 550;
const PEAK_MBPS = 600;
const REST_MBPS = 0.5;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function useIntroSweep(): { active: boolean; value: number } {
  const [value, setValue] = useState(REST_MBPS);
  const [active, setActive] = useState(true);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    let frame: number;

    const tick = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      const elapsed = now - startRef.current;

      if (elapsed < RAMP_UP_MS) {
        setValue(REST_MBPS + easeOutCubic(elapsed / RAMP_UP_MS) * (PEAK_MBPS - REST_MBPS));
      } else if (elapsed < RAMP_UP_MS + HOLD_MS) {
        setValue(PEAK_MBPS);
      } else if (elapsed < RAMP_UP_MS + HOLD_MS + EASE_DOWN_MS) {
        const t = (elapsed - RAMP_UP_MS - HOLD_MS) / EASE_DOWN_MS;
        setValue(PEAK_MBPS - easeInOutCubic(t) * (PEAK_MBPS - REST_MBPS));
      } else {
        setValue(REST_MBPS);
        setActive(false);
        return; // stop the loop
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return { active, value };
}
