import type { ChamberDefinition } from '../../core/types';

const V = (x: number, y: number, z: number) => ({ x, y, z });

export const CHAMBER_CUBES: ChamberDefinition = {
  id: '01-cubes',
  name: 'Test Chamber 01',
  tagline: 'Great news: the weighted companion cube is here to help.',
  size: { width: 12, height: 6, depth: 12 },
  spawn: { position: V(-3, 1.8, -4), yawDegrees: 0 },
  mood: 'clean',
  introLines: [
    'The enrichment center reminds you that the weighted companion cube cannot speak.',
    'Place the cube on the heavy-duty super-colliding super button to continue.',
  ],
  hint: 'Take the cube from the dispenser and set it on the round floor button.',
  elements: [
    { id: 'dispenser', type: 'cube-dispenser', position: V(-4, 3, -2), initialDrop: true },
    { id: 'cube', type: 'cube', kind: 'weighted', position: V(-4, 0.4, 0) },
    { id: 'button', type: 'button-floor', position: V(3, 0, 1), mode: 'latching', links: [{ targetId: 'door' }] },
    { id: 'door', type: 'door', position: V(0, 0, 3), orientation: 'x', startsOpen: false },
    { id: 'exit-elevator', type: 'exit-elevator', position: V(0, 0, 5) },
  ],
  surfaceOverrides: [],
};
