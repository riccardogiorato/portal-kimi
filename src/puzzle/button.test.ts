/**
 * puzzle/button.test.ts — floor and pedestal button state machines.
 */
import { describe, expect, it } from 'vitest';
import { ButtonState } from './elements/ButtonFloor';

describe('ButtonState momentary', () => {
  it('activates while pressed and releases immediately when holdSeconds is 0', () => {
    const b = new ButtonState('momentary', 0);
    b.update(true, 0.016);
    expect(b.active).toBe(true);
    b.update(false, 0.016);
    expect(b.active).toBe(false);
  });

  it('stays active for holdSeconds after release', () => {
    const b = new ButtonState('momentary', 0.5);
    b.update(true, 0.016);
    b.update(false, 0.2);
    expect(b.active).toBe(true);
    b.update(false, 0.35);
    expect(b.active).toBe(false);
  });

  it('resets hold timer when re-pressed', () => {
    const b = new ButtonState('momentary', 0.5);
    b.update(true, 0.016);
    b.update(false, 0.4);
    b.update(true, 0.016);
    expect(b.active).toBe(true);
    b.update(false, 0.4);
    expect(b.active).toBe(true);
    b.update(false, 0.15);
    expect(b.active).toBe(false);
  });
});

describe('ButtonState latching', () => {
  it('toggles active on the first press edge and stays active', () => {
    const b = new ButtonState('latching', 0);
    b.update(false, 0.016);
    b.update(true, 0.016);
    expect(b.active).toBe(true);
    b.update(false, 0.016);
    expect(b.active).toBe(true);
  });

  it('toggles off on the next press edge', () => {
    const b = new ButtonState('latching', 0);
    b.update(true, 0.016);
    b.update(false, 0.1);
    b.update(true, 0.016);
    expect(b.active).toBe(false);
    b.update(false, 0.1);
    expect(b.active).toBe(false);
  });

  it('does not toggle while continuously held', () => {
    const b = new ButtonState('latching', 0);
    b.update(true, 0.016);
    b.update(true, 0.016);
    b.update(true, 0.016);
    expect(b.active).toBe(true);
  });
});
