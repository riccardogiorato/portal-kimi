#!/usr/bin/env node
/**
 * tools/screenshot.mjs — Headless visual verification harness.
 *
 * Boots the game in headless Chrome (system Chrome + SwiftShader WebGL),
 * drives it through every chamber, and captures screenshots to shots/.
 * Reviewers then read the PNGs to judge visual quality.
 *
 * Usage:
 *   node tools/screenshot.mjs [--url http://localhost:5199] [--out shots]
 *                             [--levels 0,1,2] [--width 1600] [--height 900]
 *
 * The script spawns its own `vite` dev server unless --url is given.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Prefer purpose-built headless shells over the system browser (which can
// hang on profile/singleton issues). First existing candidate wins.
const HOME = process.env.HOME ?? '';
const CHROME_CANDIDATES = [
  `${HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
  `${HOME}/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  `${HOME}/Library/Caches/ms-playwright/chromium-1200/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const CHROME = CHROME_CANDIDATES.find((p) => existsSync(p)) ?? CHROME_CANDIDATES[CHROME_CANDIDATES.length - 1];

const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
}
const OUT_DIR = join(ROOT, opt('out', 'shots'));
const WIDTH = Number(opt('width', 1600));
const HEIGHT = Number(opt('height', 900));
const LEVELS = opt('levels', null)?.split(',').map(Number) ?? null;
let URL = opt('url', null);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch { /* retry */ }
    if (Date.now() - start > timeoutMs) throw new Error(`Timeout waiting for ${label}`);
    await sleep(250);
  }
}

let server = null;
async function ensureServer() {
  if (URL) return;
  URL = 'http://localhost:5199';
  server = spawn('bunx', ['vite', '--port', '5199', '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
  await waitFor(async () => {
    const res = await fetch(URL).catch(() => null);
    return res?.ok;
  }, 30_000, 'vite dev server');
  console.log('[shoot] dev server up at', URL);
}

/** In-page driver. Runs in the browser; uses runtime access to Game privates. */
function driver() {
  const g = window.__game;
  if (!g) return null;
  const ctx = g.ctx; // TS-private, runtime-accessible
  const systems = ctx.systems;
  return {
    state: () => g.currentState,
    levelCount: () => systems.levels.levelCount,
    loadLevel: async (i) => {
      systems.levels.loadLevel(i);
    },
    /** Position + yaw via placeAt; pitch via direct camera rotation with player frozen. */
    setView: (x, y, z, yawDeg, pitchDeg) => {
      systems.player.placeAt({ position: { x, y, z }, yawDegrees: yawDeg });
      systems.player.setActive(false);
      const cam = systems.player.camera;
      cam.rotation.y = (yawDeg * Math.PI) / 180;
      cam.rotation.x = (pitchDeg * Math.PI) / 180;
      cam.rotation.z = 0;
    },
    resume: () => systems.player.setActive(true),
    fire: (color) => systems.portals.fire(color),
    clearPortals: () => systems.portals.clearAll(),
    /** Stand `dist` meters back from a placed portal and look at its center. */
    lookAtPortal: (color, dist) => {
      const handle = systems.portals.getPortal(color);
      if (!handle) return false;
      const p = handle.position;
      const n = handle.normal;
      const ex = p.x + n.x * dist;
      const ey = p.y + n.y * dist;
      const ez = p.z + n.z * dist;
      // Yaw/pitch from the offset direction back toward the portal.
      const dx = p.x - ex, dy = p.y - ey, dz = p.z - ez;
      const yaw = (Math.atan2(dx, dz) * 180) / Math.PI;
      const pitch = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
      window.__drive.setView(ex, ey, ez, yaw, pitch);
      return true;
    },
    fps: () => Math.round(1000 / Math.max(1, g.engine?.getDeltaTime?.() ?? 16)),
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  await ensureServer();

  console.log('[shoot] browser:', CHROME);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      `--window-size=${WIDTH},${HEIGHT}`,
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      '--hide-scrollbars',
      '--mute-audio',
      '--no-first-run',
      '--disable-extensions',
    ],
    defaultViewport: { width: WIDTH, height: HEIGHT },
  });

  try {
    const page = await browser.newPage();
    page.on('console', (m) => {
      const t = m.type();
      if (t === 'error' || t === 'warning') console.log(`[page:${t}]`, m.text());
    });
    page.on('pageerror', (e) => console.log('[page:error]', e.message));

    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await waitFor(() => page.evaluate(() => Boolean(window.__game)), 60_000, 'game boot');
    console.log('[shoot] game booted');

    // Install the driver helper once.
    await page.evaluate(`window.__drive = (${driver.toString()})()`);

    const levelCount = await page.evaluate(() => window.__drive.levelCount());
    const levels = LEVELS ?? Array.from({ length: levelCount }, (_, i) => i);
    console.log(`[shoot] capturing levels: ${levels.join(', ')}`);

    for (const i of levels) {
      await page.evaluate((idx) => window.__drive.loadLevel(idx), i);
      await waitFor(
        () => page.evaluate(() => window.__drive.state() === 'playing'),
        30_000,
        `level ${i} to reach playing state`,
      );
      await sleep(1500); // let intro fades/particles settle

      // Shot A: spawn view (whatever the chamber defines).
      await page.screenshot({ path: join(OUT_DIR, `chamber-${i}-spawn.png`) });

      // Shot B: look back / alternate angle from spawn area.
      await page.evaluate(() => {
        const cam = window.__game.ctx.systems.player.camera;
        const p = window.__game.ctx.systems.player.position;
        window.__drive.setView(p.x, p.y, p.z, (cam.rotation.y * 180) / Math.PI + 140, -5);
      });
      await sleep(400);
      await page.screenshot({ path: join(OUT_DIR, `chamber-${i}-reverse.png`) });
      await page.evaluate(() => window.__drive.resume());

      // Shot C: portal see-through — fire blue at the current wall, rotate
      // ~180° and fire orange at the opposite wall, then look back at blue:
      // the frame should show the room THROUGH the blue ellipse.
      await page.evaluate(() => {
        const cam = window.__game.ctx.systems.player.camera;
        const p = window.__game.ctx.systems.player.position;
        const yaw = (cam.rotation.y * 180) / Math.PI;
        window.__drive.setView(p.x, p.y, p.z, yaw, 0);
        window.__drive.fire('blue');
        window.__drive.setView(p.x, p.y, p.z, yaw + 180, 0);
        window.__drive.fire('orange');
        window.__drive.setView(p.x, p.y, p.z, yaw, 0);
      });
      await sleep(800);
      // Back off 4m from the blue portal and look at it: verifies the
      // see-through RTT view (the room beyond should be visible INSIDE the
      // ellipse, not a flat wall).
      await page.evaluate(() => window.__drive.lookAtPortal('blue', 4));
      await sleep(500);
      await page.screenshot({ path: join(OUT_DIR, `chamber-${i}-portals.png`) });
      await page.evaluate(() => {
        window.__drive.clearPortals();
        window.__drive.resume();
      });

      const fps = await page.evaluate(() => window.__drive.fps());
      console.log(`[shoot] chamber ${i}: captured 3 shots (fps≈${fps} headless)`);
    }

    console.log('[shoot] done →', OUT_DIR);
  } finally {
    await browser.close();
    server?.kill();
  }
}

main().catch((e) => {
  console.error('[shoot] failed:', e);
  server?.kill();
  process.exit(1);
});
