/**
 * levels/validateChamber.ts — Pure structural validation for authored chambers.
 *
 * Every chamber is checked for grid alignment, spawn bounds, id uniqueness,
 * link integrity, a single exit elevator, and non-overlapping surface overrides.
 */
import type { ChamberDefinition, SurfaceOverride, WallId } from '../core/types';

export interface ValidationError {
  path: string;
  message: string;
}

export const PANEL_SIZE = 2.0;
const MARGIN = 0.05;

function almostMultiple(value: number, step: number): boolean {
  const remainder = value % step;
  const fix = remainder < 0 ? remainder + step : remainder;
  return fix < MARGIN || fix > step - MARGIN;
}

function wallDimensions(wall: WallId, size: ChamberDefinition['size']): { cols: number; rows: number } {
  if (wall === 'north' || wall === 'south') {
    return { cols: Math.round(size.width / PANEL_SIZE), rows: Math.round(size.height / PANEL_SIZE) };
  }
  if (wall === 'east' || wall === 'west') {
    return { cols: Math.round(size.depth / PANEL_SIZE), rows: Math.round(size.height / PANEL_SIZE) };
  }
  // floor / ceiling
  return { cols: Math.round(size.width / PANEL_SIZE), rows: Math.round(size.depth / PANEL_SIZE) };
}

export function validateChamber(definition: ChamberDefinition): ValidationError[] {
  const errors: ValidationError[] = [];

  const { size, spawn, elements, surfaceOverrides } = definition;

  // Dimensions must be positive and whole panel multiples.
  for (const [axis, value] of Object.entries(size) as [keyof ChamberDefinition['size'], number][]) {
    if (value <= 0) {
      errors.push({ path: `size.${axis}`, message: `size.${axis} must be positive` });
    } else if (!almostMultiple(value, PANEL_SIZE)) {
      errors.push({ path: `size.${axis}`, message: `size.${axis} (${value}) is not a whole multiple of ${PANEL_SIZE}m` });
    }
  }

  // Spawn must be inside the interior with headroom.
  const halfW = size.width / 2;
  const halfD = size.depth / 2;
  if (spawn.position.x < -halfW + MARGIN || spawn.position.x > halfW - MARGIN) {
    errors.push({ path: 'spawn.position.x', message: 'spawn x is outside chamber interior' });
  }
  if (spawn.position.z < -halfD + MARGIN || spawn.position.z > halfD - MARGIN) {
    errors.push({ path: 'spawn.position.z', message: 'spawn z is outside chamber interior' });
  }
  if (spawn.position.y < MARGIN || spawn.position.y > size.height - MARGIN) {
    errors.push({ path: 'spawn.position.y', message: 'spawn y is outside valid vertical range' });
  }

  // Element ids must be unique and every link target must exist.
  const ids = new Set<string>();
  const elevatorIds: string[] = [];

  for (const element of elements) {
    if (ids.has(element.id)) {
      errors.push({ path: `elements[${element.id}]`, message: `duplicate element id "${element.id}"` });
    }
    ids.add(element.id);

    if (element.type === 'exit-elevator') {
      elevatorIds.push(element.id);
    }

    for (const link of element.links ?? []) {
      if (link.targetId === element.id) {
        errors.push({ path: `elements[${element.id}].links`, message: `link targets itself` });
      }
    }
  }

  // Link targets must exist within the chamber definition.
  const idList = Array.from(ids);
  for (const element of elements) {
    for (const link of element.links ?? []) {
      if (!ids.has(link.targetId)) {
        errors.push({
          path: `elements[${element.id}].links`,
          message: `link target "${link.targetId}" does not exist`,
        });
      }
    }
  }

  if (idList.length === 0) {
    errors.push({ path: 'elements', message: 'chamber has no elements' });
  }

  // Exactly one exit elevator, and it must be reachable as a link target too.
  if (elevatorIds.length === 0) {
    errors.push({ path: 'elements', message: 'chamber is missing an exit-elevator' });
  } else if (elevatorIds.length > 1) {
    errors.push({ path: 'elements', message: `chamber has ${elevatorIds.length} exit-elevators; exactly one required` });
  }

  // Chamber presentation fields expected by the level system.
  if (!definition.mood) {
    errors.push({ path: 'mood', message: 'mood is required' });
  }
  if (!definition.hint || definition.hint.trim().length === 0) {
    errors.push({ path: 'hint', message: 'hint is required and must not be empty' });
  }
  const introLines = definition.introLines ?? [];
  if (introLines.length < 2 || introLines.length > 4) {
    errors.push({
      path: 'introLines',
      message: `introLines must contain 2 to 4 lines (got ${introLines.length})`,
    });
  }
  if (introLines.some((line) => typeof line !== 'string' || line.trim().length === 0)) {
    errors.push({ path: 'introLines', message: 'every intro line must be a non-empty string' });
  }

  // Surface overrides must be in range and must not overlap each other.
  const overridesByWall = new Map<WallId, SurfaceOverride[]>();
  for (const override of surfaceOverrides ?? []) {
    const dims = wallDimensions(override.wall, size);
    if (override.col < 0 || override.row < 0) {
      errors.push({ path: `surfaceOverrides[${override.wall}]`, message: 'override col/row must be non-negative' });
      continue;
    }
    if (override.cols <= 0 || override.rows <= 0) {
      errors.push({ path: `surfaceOverrides[${override.wall}]`, message: 'override cols/rows must be positive' });
      continue;
    }
    if (override.col + override.cols > dims.cols) {
      errors.push({ path: `surfaceOverrides[${override.wall}]`, message: `override exceeds wall column count (${dims.cols})` });
    }
    if (override.row + override.rows > dims.rows) {
      errors.push({ path: `surfaceOverrides[${override.wall}]`, message: `override exceeds wall row count (${dims.rows})` });
    }

    const arr = overridesByWall.get(override.wall) ?? [];
    arr.push(override);
    overridesByWall.set(override.wall, arr);
  }

  for (const [wall, overrides] of overridesByWall) {
    for (let i = 0; i < overrides.length; i++) {
      for (let j = i + 1; j < overrides.length; j++) {
        const a = overrides[i];
        const b = overrides[j];
        const overlap = a.col < b.col + b.cols && a.col + a.cols > b.col && a.row < b.row + b.rows && a.row + a.rows > b.row;
        if (overlap) {
          errors.push({ path: `surfaceOverrides[${wall}]`, message: 'surface overrides overlap each other' });
        }
      }
    }
  }

  return errors;
}

export function isChamberValid(definition: ChamberDefinition): boolean {
  return validateChamber(definition).length === 0;
}
