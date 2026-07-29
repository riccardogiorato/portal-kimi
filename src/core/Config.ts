/**
 * core/Config.ts — Central tuning. Every magic number that defines game feel
 * lives here so balancing touches one file. Values are meters/seconds/radians
 * unless noted.
 */
import type { QualityLevel } from './types';

export const CONFIG = {
  player: {
    height: 1.8,
    crouchHeight: 1.25,
    radius: 0.35,
    eyeOffsetFromTop: 0.1,
    walkSpeed: 4.6,
    sprintSpeed: 7.2,
    crouchSpeed: 2.2,
    acceleration: 42,
    airAcceleration: 10,
    friction: 11,
    jumpVelocity: 5.6,
    gravity: 19.6, // game-tuned, ~2x earth: snappy arcs, Portal-like weight
    stepHeight: 0.45,
    maxSlopeDegrees: 50,
    interactDistance: 3.4,
    carryDistance: 2.6,
    carryLerp: 14, // exponential follow rate for held objects
    throwImpulse: 6,
    mouseBaseSensitivity: 0.0022, // radians per pixel at sensitivity 1
    pitchLimitDegrees: 89,
    headBobFrequency: 9.5,
    headBobAmplitude: 0.035,
    landShakeThreshold: 6, // impact speed that triggers camera kick
  },

  portals: {
    width: 1.3,
    height: 2.2,
    /** Surface inset so the portal frame floats just off the wall. */
    surfaceOffset: 0.02,
    maxFireDistance: 200,
    fireCooldownSeconds: 0.3,
    /** Minimum panel area (m²) that accepts a portal. */
    minSurfaceWidth: 1.35,
    minSurfaceHeight: 2.25,
    /** Seconds an entity must wait before it can teleport again. */
    teleportCooldownSeconds: 0.08,
    /** Extra push applied along the exit normal after teleporting. */
    exitNudge: 0.06,
    colors: {
      blue: { r: 0.12, g: 0.55, b: 1.0 },
      orange: { r: 1.0, g: 0.45, b: 0.08 },
    },
    rttSize: { low: 256, medium: 512, high: 1024, ultra: 1024 },
    recursionPasses: { low: 1, medium: 1, high: 2, ultra: 2 },
  },

  physics: {
    timeStep: 1 / 60,
    gravityY: -19.6,
    cubeSize: 0.62,
    cubeMass: 18,
    cubeLinearDamping: 0.05,
    cubeAngularDamping: 0.4,
    /** Bodies asleep longer than this are skipped by portal teleport scans. */
    sleepTeleportThresholdSeconds: 0.5,
  },

  puzzle: {
    buttonPressDepth: 0.06,
    buttonTriggerMass: 5, // min mass that holds a floor button
    doorOpenSeconds: 0.9,
    doorSize: { width: 1.4, height: 2.4, thickness: 0.18 },
    laserDamagePerSecond: 60,
    faithPlateDefaultPower: 14,
    funnelSpeed: 2.4,
    funnelRadius: 0.9,
    lightBridgeThickness: 0.12,
    platformDefaultSpeed: 1.6,
    gooKillDepth: 0.25,
  },

  levels: {
    /** Wall panels are square tiles of this size; portalability is per-panel. */
    panelSize: 2.0,
    panelThickness: 0.25,
    elevatorRideSeconds: 4,
    respawnFadeSeconds: 0.5,
    /** Idle time before the chamber hint appears. */
    hintDelaySeconds: 75,
  },

  rendering: {
    fovDegreesDefault: 75,
    shadowMapSize: { low: 0, medium: 1024, high: 2048, ultra: 2048 },
    bloomWeight: 0.25,
    bloomThreshold: 0.72,
    exposure: 1.15,
    contrast: 1.18,
    vignetteWeight: 1.6,
    grainIntensity: 6,
    msaaSamples: { low: 1, medium: 2, high: 4, ultra: 4 },
  },

  audio: {
    masterBusGain: 0.9,
    maxDistance: 60,
    refDistance: 2,
    rolloff: 1.6,
  },
} as const;

export type GameConfig = typeof CONFIG;

export function qualityRank(level: QualityLevel): number {
  switch (level) {
    case 'low':
      return 0;
    case 'medium':
      return 1;
    case 'high':
      return 2;
    case 'ultra':
      return 3;
  }
}
