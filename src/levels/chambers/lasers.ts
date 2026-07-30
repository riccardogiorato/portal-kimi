import type { ChamberDefinition } from '../../core/types';

const V = (x: number, y: number, z: number) => ({ x, y, z });

/**
 * Chamber 04 — lasers through portals.
 *
 * Solution: the emitter fires +Z into the far wall (z=+7 at x=-5, portalable).
 * The player places one portal there and the other on the west wall
 * (x=-7, z=0, portalable). The beam enters head-on, so it exits head-on
 * along the west wall's +X normal — traveling the y=5 line through the relay
 * (0,5,0), through the glass pane (lasers pass glass), into the receiver
 * (6,5,0). Receiver powers the exit door.
 */
export const CHAMBER_LASERS: ChamberDefinition = {
  id: '04-lasers',
  name: 'Test Chamber 04',
  tagline: 'Thermal discouragement redirection course.',
  size: { width: 14, height: 8, depth: 14 },
  spawn: { position: V(0, 1.8, -5), yawDegrees: 0 },
  mood: 'damaged',
  introLines: [
    'This next test uses thermal discouragement beams and portals.',
    'Do not look directly at the operational end of the device.',
  ],
  hint: 'Portals can carry more than test subjects. Put one where the beam hits the wall, and one on the west wall at beam height.',
  elements: [
    { id: 'laser-emitter', type: 'laser-emitter', position: V(-5, 5, -6), direction: V(0, 0, 1) },
    { id: 'laser-relay', type: 'laser-relay', position: V(0, 5, 0) },
    { id: 'glass-window', type: 'glass', position: V(3, 4.5, 0), size: { width: 2, height: 4 }, orientation: 'x' },
    { id: 'laser-receiver', type: 'laser-receiver', position: V(6, 5, 0), links: [{ targetId: 'exit-door' }] },
    { id: 'exit-door', type: 'door', position: V(0, 0, 5), orientation: 'x', startsOpen: false, require: 'all' },
    { id: 'exit-elevator', type: 'exit-elevator', position: V(0, 0, 6.2) },
  ],
  surfaceOverrides: [],
};
