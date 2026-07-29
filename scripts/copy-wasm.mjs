// Copies the Havok physics WASM binary into public/ so Vite serves it as a
// static asset. Runs automatically before `vite dev` and `vite build`.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

let wasmPath;
try {
  // The package exports map exposes the wasm binary directly.
  wasmPath = require.resolve('@babylonjs/havok/lib/esm/HavokPhysics.wasm');
} catch {
  console.error('[copy-wasm] @babylonjs/havok is not installed. Run `npm install` first.');
  process.exit(1);
}

if (!existsSync(wasmPath)) {
  console.error(`[copy-wasm] WASM binary not found at ${wasmPath}`);
  process.exit(1);
}

const outDir = join(root, 'public');
mkdirSync(outDir, { recursive: true });
copyFileSync(wasmPath, join(outDir, 'HavokPhysics.wasm'));
console.log('[copy-wasm] HavokPhysics.wasm -> public/');
