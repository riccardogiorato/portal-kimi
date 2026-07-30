/**
 * core/soundIds.ts — Canonical sound registry. The audio system implements
 * exactly these ids; puzzle/ui/levels call them by name. Adding a new sound
 * means adding it HERE first so both sides stay in sync.
 */
export const SOUND = {
  portalFireBlue: 'portal.fire.blue',
  portalFireOrange: 'portal.fire.orange',
  portalOpen: 'portal.open',
  portalClose: 'portal.close',
  portalEnter: 'portal.enter',
  portalExit: 'portal.exit',
  portalFizzle: 'portal.fizzle',
  objectTeleport: 'object.teleport',

  uiClick: 'ui.click',
  uiHover: 'ui.hover',

  buttonPress: 'button.press',
  buttonRelease: 'button.release',
  doorOpen: 'door.open',
  doorClose: 'door.close',

  cubePickup: 'cube.pickup',
  cubeDrop: 'cube.drop',
  cubeBounce: 'cube.bounce',
  cubeFizzle: 'cube.fizzle',
  dispenserDrop: 'dispenser.drop',

  laserHum: 'laser.hum', // loop
  laserKill: 'laser.kill',
  funnelLoop: 'funnel.loop', // loop
  bridgeLoop: 'bridge.loop', // loop
  faithPlateLaunch: 'faithplate.launch',
  platformMove: 'platform.move', // loop

  gooDeath: 'goo.death',
  playerStep: 'player.step',
  playerJump: 'player.jump',
  playerLand: 'player.land',

  elevatorLoop: 'elevator.loop', // loop
  chamberComplete: 'chamber.complete',
  ambientHum: 'ambient.hum', // loop
} as const;

export type SoundId = (typeof SOUND)[keyof typeof SOUND];
