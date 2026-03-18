import { describe, it, expect } from 'vitest';
import { createTimingState, advanceTiming } from '../timing-engine/index.js';

describe('TimingEngine', () => {
  it('starts with flash phase true', () => {
    const state = createTimingState();
    expect(state.flashPhase).toBe(true);
    expect(state.elapsed).toBe(0);
  });

  it('flash toggles at 500ms intervals', () => {
    let state = createTimingState();
    // At 0ms: phase=true
    expect(state.flashPhase).toBe(true);

    // At 400ms: still true
    state = advanceTiming(state, 400);
    expect(state.flashPhase).toBe(true);

    // At 500ms: toggles to false
    state = advanceTiming(state, 100);
    expect(state.flashPhase).toBe(false);

    // At 999ms: still false
    state = advanceTiming(state, 499);
    expect(state.flashPhase).toBe(false);

    // At 1000ms: back to true
    state = advanceTiming(state, 1);
    expect(state.flashPhase).toBe(true);
  });

  it('does not mutate input state', () => {
    const state = createTimingState();
    const next = advanceTiming(state, 600);
    expect(state.elapsed).toBe(0);
    expect(next.elapsed).toBe(600);
  });
});
