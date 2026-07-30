/**
 * levels/math.ts — Pure panel-run layout math for chamber construction.
 *
 * All functions are stateless and engine-agnostic; they operate on meters,
 * panel counts, and booleans so they can be unit-tested in Node.
 */
import type { ChamberDefinition, SurfaceOverride, WallId, Vec3 } from '../core/types';

export const PANEL = {
  /** Internal shorthand; canonical source remains CONFIG.levels.panelSize. */
  size: 2.0,
  thickness: 0.25,
} as const;

type Portalability = 'portalable' | 'non-portalable' | 'hole';

export interface WallInfo {
  wall: WallId;
  normal: Vec3;
  /** Horizontal panel-axis as seen from inside the chamber. */
  u: Vec3;
  /** Vertical/second axis on the wall. */
  v: Vec3;
  cols: number;
  rows: number;
  /** World-space origin at the bottom-left of the wall. */
  origin: Vec3;
}

export interface PanelRun {
  /** Filled in by `partitionWall` after the grid is decomposed. */
  wall?: WallId;
  startCol: number;
  startRow: number;
  cols: number;
  rows: number;
  portalable: boolean;
}

function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function wallInfo(wall: WallId, size: ChamberDefinition['size'], panelSize: number): WallInfo {
  const { width, height, depth } = size;
  const w2 = width / 2;
  const d2 = depth / 2;
  switch (wall) {
    case 'north':
      return {
        wall,
        normal: vec3(0, 0, -1),
        v: vec3(0, 1, 0),
        u: vec3(1, 0, 0),
        cols: Math.round(width / panelSize),
        rows: Math.round(height / panelSize),
        origin: vec3(-w2, 0, d2),
      };
    case 'south':
      return {
        wall,
        normal: vec3(0, 0, 1),
        v: vec3(0, 1, 0),
        u: vec3(-1, 0, 0),
        cols: Math.round(width / panelSize),
        rows: Math.round(height / panelSize),
        origin: vec3(w2, 0, -d2),
      };
    case 'east':
      return {
        wall,
        normal: vec3(-1, 0, 0),
        v: vec3(0, 1, 0),
        u: vec3(0, 0, -1),
        cols: Math.round(depth / panelSize),
        rows: Math.round(height / panelSize),
        origin: vec3(w2, 0, d2),
      };
    case 'west':
      return {
        wall,
        normal: vec3(1, 0, 0),
        v: vec3(0, 1, 0),
        u: vec3(0, 0, 1),
        cols: Math.round(depth / panelSize),
        rows: Math.round(height / panelSize),
        origin: vec3(-w2, 0, -d2),
      };
    case 'floor':
      return {
        wall,
        normal: vec3(0, 1, 0),
        v: vec3(0, 0, 1),
        u: vec3(1, 0, 0),
        cols: Math.round(width / panelSize),
        rows: Math.round(depth / panelSize),
        origin: vec3(-w2, 0, -d2),
      };
    case 'ceiling':
      return {
        wall,
        normal: vec3(0, -1, 0),
        v: vec3(0, 0, -1),
        u: vec3(1, 0, 0),
        cols: Math.round(width / panelSize),
        rows: Math.round(depth / panelSize),
        origin: vec3(-w2, height, d2),
      };
    default:
      throw new Error(`unknown wall: ${wall}`);
  }
}

/**
 * Return the run center and world half-extents for a single wall run.
 * The box is sized in local axes: width along u, height along v, depth along the normal.
 */
export function runCenter(info: WallInfo, run: PanelRun, panelSize: number): Vec3 {
  const u = info.u;
  const v = info.v;
  const cx = info.origin.x + (run.startCol + run.cols / 2) * panelSize * u.x + (run.startRow + run.rows / 2) * panelSize * v.x;
  const cy = info.origin.y + (run.startCol + run.cols / 2) * panelSize * u.y + (run.startRow + run.rows / 2) * panelSize * v.y;
  const cz = info.origin.z + (run.startCol + run.cols / 2) * panelSize * u.z + (run.startRow + run.rows / 2) * panelSize * v.z;
  return { x: cx, y: cy, z: cz };
}

function cloneGrid(grid: Portalability[][]): Portalability[][] {
  return grid.map((row) => [...row]);
}

export function buildWallGrid(info: WallInfo, portalableDefault: boolean): Portalability[][] {
  const rows = info.rows;
  const cols = info.cols;
  const value: Portalability = portalableDefault ? 'portalable' : 'non-portalable';
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => value));
}

/** Mark the cells covered by a surface override. Returns a *new* grid. */
export function applySurfaceOverride(grid: Portalability[][], override: SurfaceOverride): Portalability[][] {
  const next = cloneGrid(grid);
  const value: Portalability = override.portalable ? 'portalable' : 'non-portalable';
  for (let r = override.row; r < override.row + override.rows; r++) {
    if (!next[r]) continue;
    for (let c = override.col; c < override.col + override.cols; c++) {
      next[r][c] = value;
    }
  }
  return next;
}

/** Carve goo element footprints out of the floor grid, returning a new grid. */
export function carveGooHoles(grid: Portalability[][], info: WallInfo, def: ChamberDefinition, panelSize: number): Portalability[][] {
  if (info.wall !== 'floor') return grid;
  const next = cloneGrid(grid);
  for (const el of def.elements) {
    if (el.type !== 'goo') continue;
    const gx = el.position.x;
    const gz = el.position.z;
    const halfW = el.size.width / 2;
    const halfD = el.size.depth / 2;
    for (let r = 0; r < info.rows; r++) {
      for (let c = 0; c < info.cols; c++) {
        const cellCenter = cellWorldCenter(info, c, r, panelSize);
        if (cellCenter.x >= gx - halfW && cellCenter.x <= gx + halfW && cellCenter.z >= gz - halfD && cellCenter.z <= gz + halfD) {
          next[r][c] = 'hole';
        }
      }
    }
  }
  return next;
}

/** World center of an individual panel cell. */
export function cellWorldCenter(info: WallInfo, col: number, row: number, panelSize: number): Vec3 {
  return {
    x: info.origin.x + (col + 0.5) * panelSize * info.u.x + (row + 0.5) * panelSize * info.v.x,
    y: info.origin.y + (col + 0.5) * panelSize * info.u.y + (row + 0.5) * panelSize * info.v.y,
    z: info.origin.z + (col + 0.5) * panelSize * info.u.z + (row + 0.5) * panelSize * info.v.z,
  };
}

/** Greedy decomposition of a wall grid into same-portability rectangles. */
export function* partitionGrid(grid: Portalability[][]): Generator<PanelRun> {
  const rows = grid.length;
  if (rows === 0) return;
  const cols = grid[0].length;
  const visited = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const value = grid[r][c];
      if (value === 'hole' || visited[r][c]) continue;

      let maxCol = c;
      while (maxCol < cols && grid[r][maxCol] === value && !visited[r][maxCol]) {
        maxCol++;
      }

      let maxRow = r + 1;
      expandRows: for (; maxRow < rows; maxRow++) {
        for (let cc = c; cc < maxCol; cc++) {
          if (grid[maxRow][cc] !== value || visited[maxRow][cc]) {
            break expandRows;
          }
        }
      }

      for (let rr = r; rr < maxRow; rr++) {
        for (let cc = c; cc < maxCol; cc++) {
          visited[rr][cc] = true;
        }
      }

      yield {
        startCol: c,
        startRow: r,
        cols: maxCol - c,
        rows: maxRow - r,
        portalable: value === 'portalable',
      };
    }
  }
}

/** Attach owning wall id to every generated run. */
export function partitionWall(grid: Portalability[][], wall: WallId): PanelRun[] {
  const runs: PanelRun[] = [];
  for (const run of partitionGrid(grid)) {
    runs.push({ ...run, wall });
  }
  return runs;
}

/** Surface area of a run in square meters. */
export function runArea(run: PanelRun, panelSize: number): number {
  return run.cols * run.rows * panelSize * panelSize;
}
