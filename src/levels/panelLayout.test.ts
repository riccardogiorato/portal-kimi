import { describe, expect, it } from 'vitest';
import {
  buildWallGrid,
  carveGooHoles,
  partitionWall,
  runArea,
  runCenter,
  type WallInfo,
} from './math';

import type { ChamberDefinition } from '../core/types';

const PANEL = 2.0;

function runSizes(
  wall: WallInfo,
  panelSize: number,
): { total: number; largest: number; count: number; allPositive: boolean } {
  const grid = buildWallGrid(wall, true);
  const runs = partitionWall(grid, wall.wall);
  let total = 0;
  let largest = 0;
  for (const run of runs) {
    total += runArea(run, panelSize);
    largest = Math.max(largest, runArea(run, panelSize));
  }
  return { total, largest, count: runs.length, allPositive: runs.every((r) => r.cols > 0 && r.rows > 0) };
}

describe('panel layout math', () => {
  it('partitions a clean wall into a single rectangle matching the wall size', () => {
    const wall: WallInfo = {
      wall: 'north',
      normal: { x: 0, y: 0, z: -1 },
      u: { x: 1, y: 0, z: 0 },
      v: { x: 0, y: 1, z: 0 },
      cols: 5,
      rows: 3,
      origin: { x: -5, y: 0, z: 6 },
    };
    const runs = partitionWall(buildWallGrid(wall, true), wall.wall);
    expect(runs).toHaveLength(1);
    expect(runArea(runs[0], PANEL)).toBeCloseTo(wall.cols * wall.rows * PANEL * PANEL);
    expect(runs[0].portalable).toBe(true);
  });

  it('places the run center on the expected wall plane', () => {
    const wall: WallInfo = {
      wall: 'north',
      normal: { x: 0, y: 0, z: -1 },
      u: { x: 1, y: 0, z: 0 },
      v: { x: 0, y: 1, z: 0 },
      cols: 4,
      rows: 2,
      origin: { x: -4, y: 0, z: 4 },
    };
    const run = partitionWall(buildWallGrid(wall, true), wall.wall)[0];
    const center = runCenter(wall, run, PANEL);
    expect(center.z).toBeCloseTo(4, 5);
    expect(center.x).toBeCloseTo(0, 5);
    expect(center.y).toBeCloseTo(2, 5);
  });

  it('partitions a wall with mixed portalability into separate runs', () => {
    const wall: WallInfo = {
      wall: 'east',
      normal: { x: -1, y: 0, z: 0 },
      u: { x: 0, y: 0, z: -1 },
      v: { x: 0, y: 1, z: 0 },
      cols: 4,
      rows: 3,
      origin: { x: 4, y: 0, z: 4 },
    };
    let grid = buildWallGrid(wall, true);
    // Mark a 2x3 vertical strip on the left as non-portalable.
    grid = grid.map((row) => row.map((value, c) => (c < 2 ? 'non-portalable' : value)));
    const runs = partitionWall(grid, wall.wall);
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs.some((r) => r.portalable)).toBe(true);
    expect(runs.some((r) => !r.portalable)).toBe(true);
    const totalArea = runs.reduce((sum, r) => sum + runArea(r, PANEL), 0);
    expect(totalArea).toBeCloseTo(wall.cols * wall.rows * PANEL * PANEL);
  });

  it('carves goo footprints into the floor grid as holes', () => {
    const floor: WallInfo = {
      wall: 'floor',
      normal: { x: 0, y: 1, z: 0 },
      u: { x: 1, y: 0, z: 0 },
      v: { x: 0, y: 0, z: 1 },
      cols: 6,
      rows: 6,
      origin: { x: -6, y: 0, z: -6 },
    };
    const def: ChamberDefinition = {
      id: 'goo-test',
      name: 'Goo Test',
      size: { width: 12, height: 6, depth: 12 },
      spawn: { position: { x: 0, y: 1.8, z: 0 }, yawDegrees: 0 },
      elements: [{ id: 'pit', type: 'goo', position: { x: 0, y: -6, z: 0 }, size: { width: 6, depth: 6 } }],
    };
    const grid = carveGooHoles(buildWallGrid(floor, true), floor, def, PANEL);
    const holeCount = grid.flat().filter((v) => v === 'hole').length;
    expect(holeCount).toBeGreaterThan(0);
    const runs = partitionWall(grid, floor.wall);
    expect(runs.every((r) => r.portalable)).toBe(true);
  });

  it('covers a whole chamber shell with no negative or zero-area runs', () => {
    const size = { width: 12, height: 6, depth: 12 };
    const w2 = size.width / 2;
    const d2 = size.depth / 2;
    const walls: WallInfo[] = [
      { wall: 'north', normal: { x: 0, y: 0, z: -1 }, u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 1, z: 0 }, cols: 6, rows: 3, origin: { x: -w2, y: 0, z: d2 } },
      { wall: 'south', normal: { x: 0, y: 0, z: 1 }, u: { x: -1, y: 0, z: 0 }, v: { x: 0, y: 1, z: 0 }, cols: 6, rows: 3, origin: { x: w2, y: 0, z: -d2 } },
      { wall: 'east', normal: { x: -1, y: 0, z: 0 }, u: { x: 0, y: 0, z: -1 }, v: { x: 0, y: 1, z: 0 }, cols: 6, rows: 3, origin: { x: w2, y: 0, z: d2 } },
      { wall: 'west', normal: { x: 1, y: 0, z: 0 }, u: { x: 0, y: 0, z: 1 }, v: { x: 0, y: 1, z: 0 }, cols: 6, rows: 3, origin: { x: -w2, y: 0, z: -d2 } },
      { wall: 'floor', normal: { x: 0, y: 1, z: 0 }, u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 0, z: 1 }, cols: 6, rows: 6, origin: { x: -w2, y: 0, z: -d2 } },
      { wall: 'ceiling', normal: { x: 0, y: -1, z: 0 }, u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 0, z: -1 }, cols: 6, rows: 6, origin: { x: -w2, y: size.height, z: d2 } },
    ];

    for (const wall of walls) {
      const { total, allPositive, largest } = runSizes(wall, PANEL);
      expect(allPositive).toBe(true);
      expect(total).toBeCloseTo(wall.cols * wall.rows * PANEL * PANEL);
      expect(largest).toBeLessThanOrEqual(total);
    }
  });
});
