import type { ChamberDefinition } from '../../core/types';

const V = (x: number, y: number, z: number) => ({ x, y, z });

/**
 * Chamber 05 — excursion funnel finale.
 *
 * A full-width goo lake (z∈[-1,5]) splits the chamber. The funnel beam runs
 * z∈[-1,7] at y=1 (zero-G inside): the player picks up the cube on the south
 * strip, steps into the beam, rides it across the lake to the north strip,
 * and sets the cube on the floor button. Button powers the exit door.
 */
export const CHAMBER_FUNNELS: ChamberDefinition = {
  id: '05-funnels',
  name: 'Test Chamber 05',
  tagline: 'Aperture Science Excursion Funnel certification exam.',
  size: { width: 18, height: 10, depth: 22 },
  spawn: { position: V(0, 1.8, -9), yawDegrees: 0 },
  mood: 'dark',
  introLines: [
    'This final test certifies you in the Aperture Science Excursion Funnel.',
    'The funnel is perfectly safe. The liquid below it is not. Good luck.',
  ],
  hint: 'Carry the cube into the beam and ride it across. The funnel holds you up — the goo does not.',
  elements: [
    { id: 'goo-lake', type: 'goo', position: V(0, 0, 2), size: { width: 18, depth: 6 } },
    { id: 'cube-dispenser', type: 'cube-dispenser', position: V(-6, 3, -8), initialDrop: true },
    { id: 'weighted-cube', type: 'cube', kind: 'weighted', position: V(-6, 0.4, -6) },
    { id: 'funnel', type: 'funnel', position: V(0, 1, -1), direction: V(0, 0, 1), length: 8, polarity: 'push', startsActive: true },
    { id: 'floor-button', type: 'button-floor', position: V(4, 0, 7), mode: 'latching', links: [{ targetId: 'exit-door' }] },
    { id: 'exit-door', type: 'door', position: V(0, 0, 8), orientation: 'x', startsOpen: false, require: 'all' },
    { id: 'exit-elevator', type: 'exit-elevator', position: V(0, 0, 10) },
  ],
  surfaceOverrides: [],
};
