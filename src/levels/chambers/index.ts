import type { ChamberDefinition } from '../../core/types';
import { CHAMBER_AWAKENING } from './awakening';
import { CHAMBER_CUBES } from './cubes';
import { CHAMBER_MOMENTUM } from './momentum';
import { CHAMBER_FAITH } from './faith';
import { CHAMBER_LASERS } from './lasers';
import { CHAMBER_FUNNELS } from './funnels';

export const CAMPAIGN: readonly ChamberDefinition[] = [
  CHAMBER_AWAKENING,
  CHAMBER_CUBES,
  CHAMBER_MOMENTUM,
  CHAMBER_FAITH,
  CHAMBER_LASERS,
  CHAMBER_FUNNELS,
] satisfies ChamberDefinition[];
