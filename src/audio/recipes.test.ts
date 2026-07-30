/**
 * audio/recipes.test.ts — Every canonical sound id must have a recipe.
 */
import { describe, expect, it } from 'vitest';
import { SOUND } from '../core/soundIds';
import { createFakeAudioContext } from './audioTestUtils';
import { getLoopRecipe, getRecipe, getRecipeIds, getLoopRecipeIds } from './recipes';

const SOUND_IDS = Object.values(SOUND);

describe('recipe coverage', () => {
  it('has a production recipe or loop recipe for every SOUND id', () => {
    for (const id of SOUND_IDS) {
      const hasRecipe = getRecipe(id) !== undefined;
      const hasLoop = getLoopRecipe(id) !== undefined;
      expect(hasRecipe || hasLoop, `missing recipe for ${id}`).toBe(true);
    }
  });

  it('returns all canonical ids across tables', () => {
    const covered = new Set([...getRecipeIds(), ...getLoopRecipeIds()]);
    expect(covered.size).toBeGreaterThan(0);
    for (const id of SOUND_IDS) {
      expect(covered.has(id), `${id} should be registered`).toBe(true);
    }
  });
});

describe('recipe building', () => {
  const ctx = createFakeAudioContext('running');
  const out = ctx.createGain();

  it('can instantiate every one-shot recipe', () => {
    for (const id of getRecipeIds()) {
      const recipe = getRecipe(id)!;
      const voice = recipe({ ctx, out, now: 0 }, {});
      expect(voice).toBeDefined();
      expect(voice.duration).toBeGreaterThan(0);
    }
  });

  it('can instantiate every loop recipe', () => {
    for (const id of getLoopRecipeIds()) {
      const recipe = getLoopRecipe(id)!;
      const voice = recipe({ ctx, out, now: 0 });
      expect(voice).toBeDefined();
    }
  });

  it('passes volume and pitch through one-shot recipes', () => {
    const recipe = getRecipe(SOUND.uiClick)!;
    const voice = recipe({ ctx, out, now: 0 }, { volume: 0.5, pitch: 2 });
    expect(voice).toBeDefined();
    expect(voice.duration).toBeGreaterThan(0);
  });

  it('disconnects every managed node and source after voice.dispose()', () => {
    for (const id of getRecipeIds()) {
      const recipe = getRecipe(id)!;
      const voice = recipe({ ctx, out, now: 0 }, {});
      voice.dispose();
      const nodes = [
        ...((voice as unknown as { managedNodes: { disconnected: boolean }[] }).managedNodes ?? []),
        ...((voice as unknown as { sources: { disconnected: boolean }[] }).sources ?? []),
        ...((voice as unknown as { extraSources: { disconnected: boolean }[] }).extraSources ?? []),
      ];
      for (const node of nodes) {
        expect(node.disconnected, `${id}: managed node/source not disconnected`).toBe(true);
      }
    }
  });

  it('disconnects every loop-managed node and source after loop.dispose()', () => {
    for (const id of getLoopRecipeIds()) {
      const recipe = getLoopRecipe(id)!;
      const loop = recipe({ ctx, out, now: 0 });
      loop.dispose();
      const nodes = [
        ...((loop as unknown as { managedNodes: { disconnected: boolean }[] }).managedNodes ?? []),
        ...((loop as unknown as { sources: { disconnected: boolean }[] }).sources ?? []),
      ];
      for (const node of nodes) {
        expect(node.disconnected, `${id}: loop node/source not disconnected`).toBe(true);
      }
    }
  });
});
