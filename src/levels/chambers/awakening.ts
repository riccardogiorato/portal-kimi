import type { ChamberDefinition } from '../../core/types';

const V = (x: number, y: number, z: number) => ({ x, y, z });

/**
 * Chamber 00 — teach portals.
 * A full-width goo pit splits the chamber; the only way across is a portal
 * pair (all walls portalable). Spawn strip z∈[-6,-4], exit strip z∈[4,6].
 */
export const CHAMBER_AWAKENING: ChamberDefinition = {
  id: '00-awakening',
  name: 'Test Chamber 00',
  tagline: 'Just remember: the portal gun is not a toy.',
  size: { width: 10, height: 6, depth: 12 },
  spawn: { position: V(0, 1.8, -5), yawDegrees: 0 },
  mood: 'clean',
  introLines: [
    'Welcome to the Aperture Science computer-aided enrichment activity.',
    'Please proceed to the chamberlock. Mind the gap.',
  ],
  hint: 'Fire one portal on the near wall, one on the far side, then walk through.',
  elements: [
    // Off-center and flush with the north wall: the far-wall center stays
    // clear for the tutorial's "shoot the far wall" portal.
    { id: 'exit-elevator', type: 'exit-elevator', position: V(2.5, 0, 5.2) },
    { id: 'pit-goo', type: 'goo', position: V(0, 0, 0), size: { width: 10, depth: 8 } },
  ],
  surfaceOverrides: [],
};
