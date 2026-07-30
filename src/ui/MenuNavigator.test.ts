import { describe, it, expect } from 'vitest';
import { MenuNavigator } from './MenuNavigator';

describe('MenuNavigator', () => {
  it('starts at index 0', () => {
    const nav = new MenuNavigator(['a', 'b', 'c']);
    expect(nav.index).toBe(0);
    expect(nav.current()).toBe('a');
  });

  it('wraps forward', () => {
    const nav = new MenuNavigator(['a', 'b']);
    nav.next();
    nav.next();
    expect(nav.index).toBe(0);
    expect(nav.current()).toBe('a');
  });

  it('wraps backward', () => {
    const nav = new MenuNavigator(['a', 'b', 'c']);
    nav.previous();
    expect(nav.index).toBe(2);
    expect(nav.current()).toBe('c');
  });

  it('selects only valid indices', () => {
    const nav = new MenuNavigator(['a', 'b']);
    expect(nav.select(5)).toBe(false);
    expect(nav.index).toBe(0);
    expect(nav.select(1)).toBe(true);
    expect(nav.index).toBe(1);
  });

  it('resets when items are replaced and clamps the index', () => {
    const nav = new MenuNavigator(['a', 'b', 'c']);
    nav.select(2);
    nav.setItems(['x', 'y']);
    expect(nav.index).toBe(1);
  });

  it('reports null for an empty list', () => {
    const nav = new MenuNavigator([]);
    expect(nav.index).toBe(-1);
    expect(nav.current()).toBeNull();
    expect(nav.next()).toBe(-1);
  });
});
