import { describe, expect, it } from 'vitest';
import type { ChamberDefinition } from '../core/types';
import { CAMPAIGN } from './chambers';
import { validateChamber, type ValidationError } from './validateChamber';

describe('validateChamber', () => {
  it('accepts every authored campaign chamber', () => {
    const failures = CAMPAIGN.flatMap((def) => validateChamber(def).map((e) => `${def.id}: ${e.path}: ${e.message}`));
    expect(failures).toEqual([]);
  });

  it('reports dimension and spawn problems', () => {
    const bad: ChamberDefinition = {
      id: 'bad',
      name: 'Bad Chamber',
      size: { width: 3, height: 6, depth: 8 },
      spawn: { position: { x: 0, y: 1.8, z: 0 }, yawDegrees: 0 },
      elements: [
        { id: 'exit', type: 'exit-elevator', position: { x: 0, y: 0, z: 0 } },
      ],
    };
    const errs = validateChamber(bad);
    expect(errs.some((e) => e.path === 'size.width')).toBe(true);
  });

  it('reports duplicate ids and broken links', () => {
    const bad: ChamberDefinition = {
      id: 'links',
      name: 'Bad Links',
      size: { width: 8, height: 6, depth: 8 },
      spawn: { position: { x: 0, y: 1.8, z: 0 }, yawDegrees: 0 },
      elements: [
        { id: 'exit', type: 'exit-elevator', position: { x: 0, y: 0, z: 0 } },
        { id: 'exit', type: 'button-floor', position: { x: 1, y: 0, z: 1 }, links: [{ targetId: 'missing' }] },
      ],
    };
    const errs = validateChamber(bad);
    expect(errs.some((e) => e.message.includes('duplicate'))).toBe(true);
    expect(errs.some((e) => e.message.includes('does not exist'))).toBe(true);
    expect(errs.length).toBeGreaterThanOrEqual(2);
  });

  it('reports out-of-range surface overrides', () => {
    const bad: ChamberDefinition = {
      id: 'override',
      name: 'Bad Override',
      size: { width: 8, height: 6, depth: 8 },
      spawn: { position: { x: 0, y: 1.8, z: 0 }, yawDegrees: 0 },
      surfaceOverrides: [{ wall: 'north', col: 0, row: 0, cols: 10, rows: 1, portalable: false }],
      elements: [{ id: 'exit', type: 'exit-elevator', position: { x: 0, y: 0, z: 0 } }],
    };
    const errs = validateChamber(bad);
    expect(errs.some((e) => e.path.startsWith('surfaceOverrides'))).toBe(true);
  });
});

describe('campaign chamber catalog', () => {
  it('contains exactly six chambers', () => {
    expect(CAMPAIGN).toHaveLength(6);
  });

  it('has sequential ids from 00-awakening to 05-funnels', () => {
    expect(CAMPAIGN.map((c) => c.id)).toEqual([
      '00-awakening',
      '01-cubes',
      '02-momentum',
      '03-faith',
      '04-lasers',
      '05-funnels',
    ]);
  });
});

describe('ValidationError shape', () => {
  it('has a path and a message', () => {
    const error: ValidationError = { path: 'test.path', message: 'test message' };
    expect(error.path).toBe('test.path');
    expect(error.message).toBe('test message');
  });
});
