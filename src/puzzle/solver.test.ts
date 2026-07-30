/**
 * puzzle/solver.test.ts — exhaustive AND/OR/invert link solver tests.
 */
import { describe, expect, it, vi } from 'vitest';
import { LinkSolver, evaluateTarget } from './solver';

describe('evaluateTarget', () => {
  it('vacuous AND returns default value', () => {
    expect(evaluateTarget([], 'all', false)).toBe(false);
    expect(evaluateTarget([], 'all', true)).toBe(true);
  });

  it('vacuous OR returns default value', () => {
    expect(evaluateTarget([], 'any', false)).toBe(false);
    expect(evaluateTarget([], 'any', true)).toBe(true);
  });

  it('AND requires every contribution true', () => {
    expect(evaluateTarget([true, true, true], 'all', false)).toBe(true);
    expect(evaluateTarget([true, false, true], 'all', false)).toBe(false);
    expect(evaluateTarget([false, false], 'all', false)).toBe(false);
  });

  it('OR requires any contribution true', () => {
    expect(evaluateTarget([false, false], 'any', false)).toBe(false);
    expect(evaluateTarget([false, true, false], 'any', false)).toBe(true);
    expect(evaluateTarget([true, true], 'any', false)).toBe(true);
  });

  it('treats inverted inputs directly as contribution booleans', () => {
    expect(evaluateTarget([true, false], 'all', false)).toBe(false);
    expect(evaluateTarget([false, true], 'all', false)).toBe(false);
  });
});

describe('LinkSolver', () => {
  it('propagates a simple source -> target activation', () => {
    const solver = new LinkSolver();
    solver.registerTarget('door', 'all');
    solver.addLink('button', 'door', false);
    const callback = vi.fn();
    solver.onActivationChange(callback);
    solver.reset();
    expect(callback).toHaveBeenLastCalledWith('door', false);

    solver.setSourceActive('button', true);
    expect(callback).toHaveBeenCalledWith('door', true);

    solver.setSourceActive('button', false);
    expect(callback).toHaveBeenCalledWith('door', false);
  });

  it('implements AND over multiple sources', () => {
    const solver = new LinkSolver();
    solver.registerTarget('door', 'all');
    solver.addLink('a', 'door');
    solver.addLink('b', 'door');
    const cb = vi.fn();
    solver.onActivationChange(cb);

    solver.setSourceActive('a', true);
    expect(cb).not.toHaveBeenCalledWith('door', true);
    solver.setSourceActive('b', true);
    expect(cb).toHaveBeenCalledWith('door', true);

    cb.mockClear();
    solver.setSourceActive('a', false);
    expect(cb).toHaveBeenCalledWith('door', false);
  });

  it('implements OR when configured', () => {
    const solver = new LinkSolver();
    solver.registerTarget('door', 'any');
    solver.addLink('a', 'door');
    solver.addLink('b', 'door');
    const cb = vi.fn();
    solver.onActivationChange(cb);

    solver.setSourceActive('a', true);
    expect(cb).toHaveBeenCalledWith('door', true);

    cb.mockClear();
    solver.setSourceActive('b', true);
    expect(cb).not.toHaveBeenCalled();

    solver.setSourceActive('a', false);
    expect(cb).not.toHaveBeenCalledWith('door', false);
    solver.setSourceActive('b', false);
    expect(cb).toHaveBeenCalledWith('door', false);
  });

  it('applies invert on a per-link basis', () => {
    const solver = new LinkSolver();
    solver.registerTarget('door', 'all', true);
    solver.addLink('button', 'door', true);
    const cb = vi.fn();
    solver.onActivationChange(cb);
    solver.reset();
    expect(cb).toHaveBeenLastCalledWith('door', true);

    solver.setSourceActive('button', true);
    expect(cb).toHaveBeenCalledWith('door', false);

    cb.mockClear();
    solver.setSourceActive('button', false);
    expect(cb).toHaveBeenCalledWith('door', true);
  });

  it('uses default active state when there are no links', () => {
    const solver = new LinkSolver();
    solver.registerTarget('always-open', 'all', true);
    const cb = vi.fn();
    solver.onActivationChange(cb);
    solver.reset();
    expect(cb).toHaveBeenCalledWith('always-open', true);
  });

  it('only fires callbacks when state changes', () => {
    const solver = new LinkSolver();
    solver.registerTarget('door', 'all');
    solver.addLink('b', 'door');
    const cb = vi.fn();
    solver.onActivationChange(cb);
    solver.reset();
    solver.setSourceActive('b', true);
    solver.setSourceActive('b', true);
    solver.setSourceActive('b', true);
    expect(cb.mock.calls.filter(([id, active]) => id === 'door' && active === true)).toHaveLength(1);
  });

  it('routes independent links to independent targets', () => {
    const solver = new LinkSolver();
    solver.registerTarget('d1', 'all');
    solver.registerTarget('d2', 'all');
    solver.addLink('button', 'd1');
    solver.addLink('button', 'd2');
    const cb = vi.fn();
    solver.onActivationChange(cb);

    solver.setSourceActive('button', true);
    expect(cb).toHaveBeenCalledWith('d1', true);
    expect(cb).toHaveBeenCalledWith('d2', true);
  });
});
