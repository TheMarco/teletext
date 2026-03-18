/**
 * Timing engine for teletext flash and carousel.
 *
 * Per ETSI EN 300 706:
 * - Flash rate: ~1 Hz (approximately 500ms on, 500ms off)
 * - Carousel: pages broadcast cyclically
 */

export interface TimingState {
  flashPhase: boolean;
  elapsed: number; // ms since start
}

const FLASH_INTERVAL_MS = 1000; // full cycle: 500ms on + 500ms off

/**
 * Create initial timing state.
 */
export function createTimingState(): TimingState {
  return {
    flashPhase: true,
    elapsed: 0,
  };
}

/**
 * Advance the timing state by deltaMs milliseconds.
 * Returns updated state (does not mutate input).
 */
export function advanceTiming(state: TimingState, deltaMs: number): TimingState {
  const elapsed = state.elapsed + deltaMs;
  // Flash toggles every half-interval
  const flashPhase = Math.floor(elapsed / (FLASH_INTERVAL_MS / 2)) % 2 === 0;
  return { flashPhase, elapsed };
}
