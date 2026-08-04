import { useEffect, useRef, useState } from "react";

/**
 * Eases a displayed number toward a moving target on every animation frame.
 *
 * Throughput samples arrive every ~150ms and are inherently bursty, so binding
 * a gauge straight to them makes it lurch. CSS transitions can't solve this
 * for an SVG arc (the `d` attribute isn't animatable), so instead we smooth
 * the *value* and redraw at frame rate — needle and arc then move together.
 *
 * The approach is exponential, not a fixed-duration tween: each frame closes a
 * proportion of the remaining distance, so a new target mid-flight is absorbed
 * without restarting an animation or overshooting.
 */
export function useAnimatedNumber(target: number, timeConstantMs = 220): number {
  const [display, setDisplay] = useState(target);
  const state = useRef({ current: target, target });

  state.current.target = target;

  useEffect(() => {
    let frame = 0;
    let lastFrameAt = performance.now();

    const tick = (now: number) => {
      const dt = now - lastFrameAt;
      lastFrameAt = now;

      const s = state.current;
      // Frame-rate independent: the fraction closed depends on elapsed time,
      // so the motion looks identical at 60Hz and 120Hz.
      const k = 1 - Math.exp(-dt / timeConstantMs);
      s.current += (s.target - s.current) * k;

      // Snap once the gap is imperceptible, so we don't render forever.
      if (Math.abs(s.target - s.current) < 0.005) s.current = s.target;

      setDisplay(s.current);
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [timeConstantMs]);

  return display;
}
