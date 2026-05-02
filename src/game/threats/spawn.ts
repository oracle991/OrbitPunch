import { normalize, radialPoint } from "../math";
import type { Meteor, ThreatKind } from "../types";
import { CENTER, OUTER_RADIUS } from "../world";
import { METEOR_BASE_SPEED, ORBITAL_SATELLITE_RADIUS } from "./config";
import { pickWeightedThreatKind } from "./waveConfig";

export type ThreatSpawnState = {
  wave: number;
  defeated: number;
  miniBossWave: number;
  nextId: () => number;
};

export type ThreatSpawnResult = {
  threat: Meteor;
  miniBossWave?: number;
};

export const pickThreatKind = (wave: number, miniBossWave: number): ThreatKind => {
  return pickWeightedThreatKind(wave, miniBossWave !== wave);
};

export const spawnThreat = (state: ThreatSpawnState): ThreatSpawnResult => {
  const kind = pickThreatKind(state.wave, state.miniBossWave);
  if (kind === "orbitalSatellite") {
    return { threat: spawnOrbitalSatellite(state) };
  }
  if (kind === "explosiveCore") {
    return { threat: spawnExplosiveCore(state) };
  }
  if (kind === "tractorDrone") {
    return { threat: spawnTractorDrone(state) };
  }
  if (kind === "miniBoss") {
    return { threat: spawnMiniBoss(state), miniBossWave: state.wave };
  }
  return { threat: spawnMeteor(state) };
};

const spawnMeteor = (state: ThreatSpawnState): Meteor => {
  const angle = Math.random() * Math.PI * 2;
  const spawn = radialPoint(angle, OUTER_RADIUS);
  const inward = randomInboundDirection(spawn, 168);
  const speed = METEOR_BASE_SPEED + state.wave * 10 + Math.random() * 16;
  return createThreat(state.nextId(), "meteor", spawn, inward, speed, 25 + Math.random() * 7);
};

const spawnExplosiveCore = (state: ThreatSpawnState): Meteor => {
  const angle = Math.random() * Math.PI * 2;
  const spawn = radialPoint(angle, OUTER_RADIUS);
  const inward = randomInboundDirection(spawn, 132);
  const speed = METEOR_BASE_SPEED + state.wave * 8 + Math.random() * 12;
  return createThreat(state.nextId(), "explosiveCore", spawn, inward, speed, 22);
};

const spawnTractorDrone = (state: ThreatSpawnState): Meteor => {
  const angle = Math.random() * Math.PI * 2;
  const spawn = radialPoint(angle, OUTER_RADIUS);
  const inward = randomInboundDirection(spawn, 188);
  const speed = METEOR_BASE_SPEED * 0.74 + state.wave * 7 + Math.random() * 10;
  return createThreat(state.nextId(), "tractorDrone", spawn, inward, speed, 23);
};

const spawnOrbitalSatellite = (state: ThreatSpawnState): Meteor => {
  const angle = Math.random() * Math.PI * 2;
  const spawn = radialPoint(angle, OUTER_RADIUS);
  const inward = randomInboundDirection(spawn, 96);
  const speed = METEOR_BASE_SPEED + state.wave * 8 + Math.random() * 14;
  const orbitRadius = ORBITAL_SATELLITE_RADIUS + Math.random() * 34;
  return {
    ...createThreat(state.nextId(), "orbitalSatellite", spawn, inward, speed, 20),
    orbitAngle: angle,
    orbitRadius,
    orbitSpeed: 0.66 + state.wave * 0.035,
    orbitPhase: 0,
    orbitMajorRadius: OUTER_RADIUS,
    orbitMinorRadius: orbitRadius,
    orbitDirection: Math.random() < 0.5 ? -1 : 1
  };
};

const spawnMiniBoss = (state: ThreatSpawnState): Meteor => {
  const angle = Math.random() * Math.PI * 2;
  const spawn = radialPoint(angle, OUTER_RADIUS + 24);
  const inward = randomInboundDirection(spawn, 72);
  const speed = METEOR_BASE_SPEED * 0.58 + state.wave * 4;
  return {
    ...createThreat(state.nextId(), "miniBoss", spawn, inward, speed, 42),
    hp: 4,
    maxHp: 4,
    hitCooldown: 0
  };
};

const createThreat = (
  id: number,
  kind: ThreatKind,
  pos: Meteor["pos"],
  direction: Meteor["vel"],
  speed: number,
  radius: number
): Meteor => ({
  id,
  kind,
  pos,
  vel: { x: direction.x * speed, y: direction.y * speed },
  radius,
  alive: true,
  knocked: false,
  chain: 0,
  spin: Math.random() * Math.PI * 2,
  hp: 1,
  maxHp: 1
});

const randomInboundDirection = (spawn: Meteor["pos"], targetRadius: number): Meteor["vel"] => {
  const targetAngle = Math.random() * Math.PI * 2;
  const targetDistance = Math.sqrt(Math.random()) * targetRadius;
  const target = {
    x: CENTER.x + Math.cos(targetAngle) * targetDistance,
    y: CENTER.y + Math.sin(targetAngle) * targetDistance
  };

  return normalize({ x: target.x - spawn.x, y: target.y - spawn.y });
};
