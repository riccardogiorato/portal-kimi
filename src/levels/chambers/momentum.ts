import type { ChamberDefinition } from '../../core/types';

const V = (x: number, y: number, z: number) => ({ x, y, z });

/**
 * Chamber 02 — momentum fling.
 *
 * A full-width goo lake (z∈[-2,4]) splits the chamber. The only portalable
 * surfaces are the south wall, the south floor strip, and the ceiling, so
 * the ONLY way across is the intended fling: floor portal below the spawn
 * platform, high portal on the south wall, drop in, launch north over the
 * goo (6m fall ≈ 15.3 m/s; from a y≈9 exit the arc lands on the z∈[4,9]
 * strip with margin). Direct portal-walks are impossible: north/east/west
 * walls and the exit-strip floor are non-portalable.
 */
export const CHAMBER_MOMENTUM: ChamberDefinition = {
  id: '02-momentum',
  name: 'Test Chamber 02',
  tagline: 'Speedy thing goes in, speedy thing comes out.',
  size: { width: 12, height: 12, depth: 18 },
  spawn: { position: V(0, 7.5, -6), yawDegrees: 0 },
  mood: 'clean',
  introLines: [
    'In this next test, no amount of leg strength will help you.',
    'Use momentum, not muscle, to cross the hazardous surface.',
  ],
  hint: 'Place a portal on the floor below the platform, then one high on the wall behind you. Gravity does the rest.',
  elements: [
    { id: 'spawn-platform', type: 'platform', position: V(0, 6, -6), path: [V(0, 6, -6), V(0, 6, -6)], startsActive: true, speed: 0 },
    { id: 'pit-goo', type: 'goo', position: V(0, 0, 1), size: { width: 12, depth: 6 } },
    { id: 'exit-elevator', type: 'exit-elevator', position: V(0, 0, 8.2) },
  ],
  surfaceOverrides: [
    // North wall (z=+9): fully non-portalable.
    { wall: 'north', col: 0, row: 0, cols: 6, rows: 6, portalable: false },
    // East/west walls: fully non-portalable.
    { wall: 'east', col: 0, row: 0, cols: 9, rows: 6, portalable: false },
    { wall: 'west', col: 0, row: 0, cols: 9, rows: 6, portalable: false },
    // Exit-strip floor (z∈[4,9] → rows 6..8): non-portalable.
    { wall: 'floor', col: 0, row: 6, cols: 6, rows: 3, portalable: false },
  ],
};
