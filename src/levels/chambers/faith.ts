import type { ChamberDefinition } from '../../core/types';

const V = (x: number, y: number, z: number) => ({ x, y, z });

/**
 * Chamber 03 — faith plates + light bridge.
 *
 * Flow: faith plate → landing platform (0,4,-1) → portal west to the button
 * ledge (-5,3.8,-1) → press → bridge powers on (z∈[1,7] at y=4.5) → portal
 * back → 2m hop onto the bridge start → cross → 1m hop to the end platform →
 * elevator. All walls portalable so the portal hops work from either side.
 */
export const CHAMBER_FAITH: ChamberDefinition = {
  id: '03-faith',
  name: 'Test Chamber 03',
  tagline: 'Please prepare for aerial faith-plate maneuvers.',
  size: { width: 16, height: 8, depth: 16 },
  spawn: { position: V(0, 1.8, -6), yawDegrees: 0 },
  mood: 'damaged',
  introLines: [
    'This next test requires use of aerial faith plates.',
    'Remember: portals are provided as a courtesy, not a crutch.',
  ],
  hint: 'Ride the faith plate to the ledge, portal over to the pedestal button, then cross the bridge.',
  elements: [
    { id: 'start-plate', type: 'faith-plate', position: V(0, 0, -4), target: V(0, 4, -1), power: 14 },
    { id: 'landing-platform', type: 'platform', position: V(0, 4, -1), path: [V(0, 4, -1), V(0, 4, -1)], startsActive: true, speed: 0 },
    { id: 'button-ledge', type: 'platform', position: V(-5, 3.8, -1), path: [V(-5, 3.8, -1), V(-5, 3.8, -1)], startsActive: true, speed: 0 },
    { id: 'bridge-button', type: 'button-pedestal', position: V(-5, 4, -1), mode: 'latching', links: [{ targetId: 'bridge' }] },
    { id: 'bridge', type: 'light-bridge', position: V(0, 4.5, 1), direction: V(0, 0, 1), length: 6, startsActive: false },
    { id: 'end-platform', type: 'platform', position: V(0, 4, 8), path: [V(0, 4, 8), V(0, 4, 8)], startsActive: true, speed: 0 },
    { id: 'exit-elevator', type: 'exit-elevator', position: V(0, 4, 7.2) },
  ],
  surfaceOverrides: [],
};
