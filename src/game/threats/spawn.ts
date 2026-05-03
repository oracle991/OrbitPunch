import { normalize, radialPoint } from "../math";
import type { Meteor, ThreatKind } from "../types";
import { CENTER, OUTER_RADIUS } from "../world";
import { pickWeightedThreatKind, rollThreatSpawnConfig } from "./waveConfig";

export type ThreatSpawnState = {
  wave: number;
  defeated: number;
  nextId: () => number;
};

export type ThreatSpawnResult = {
  threat: Meteor;
};

export const pickThreatKind = (wave: number): ThreatKind => {
  return pickWeightedThreatKind(wave, false);
};

export const spawnThreat = (state: ThreatSpawnState): ThreatSpawnResult => {
  const kind = pickThreatKind(state.wave);
  if (kind === "orbitalSatellite") {
    return { threat: spawnOrbitalSatellite(state) };
  }
  if (kind === "explosiveCore") {
    return { threat: spawnExplosiveCore(state) };
  }
  if (kind === "tractorDrone") {
    return { threat: spawnTractorDrone(state) };
  }
  return { threat: spawnMeteor(state) };
};

export const spawnScheduledMiniBoss = (state: ThreatSpawnState): ThreatSpawnResult => ({
  threat: spawnMiniBoss(state)
});

const spawnMeteor = (state: ThreatSpawnState): Meteor => {
  const params = rollThreatSpawnConfig("meteor", state.wave);
  const spawn = radialPoint(params.spawnAngle, OUTER_RADIUS + params.spawnRadiusOffset);
  const inward = randomInboundDirection(spawn, params.aimRadius);
  return createThreat(state.nextId(), "meteor", spawn, inward, params.speed, params.radius);
};

const spawnExplosiveCore = (state: ThreatSpawnState): Meteor => {
  const params = rollThreatSpawnConfig("explosiveCore", state.wave);
  const spawn = radialPoint(params.spawnAngle, OUTER_RADIUS + params.spawnRadiusOffset);
  const inward = randomInboundDirection(spawn, params.aimRadius);
  return createThreat(state.nextId(), "explosiveCore", spawn, inward, params.speed, params.radius);
};

const spawnTractorDrone = (state: ThreatSpawnState): Meteor => {
  const params = rollThreatSpawnConfig("tractorDrone", state.wave);
  const spawn = radialPoint(params.spawnAngle, OUTER_RADIUS + params.spawnRadiusOffset);
  const inward = randomInboundDirection(spawn, params.aimRadius);
  return createThreat(state.nextId(), "tractorDrone", spawn, inward, params.speed, params.radius);
};

const spawnOrbitalSatellite = (state: ThreatSpawnState): Meteor => {
  const params = rollThreatSpawnConfig("orbitalSatellite", state.wave);
  const spawn = radialPoint(params.spawnAngle, OUTER_RADIUS + params.spawnRadiusOffset);
  const inward = randomInboundDirection(spawn, params.aimRadius);
  return {
    ...createThreat(state.nextId(), "orbitalSatellite", spawn, inward, params.speed, params.radius),
    orbitAngle: params.spawnAngle,
    orbitRadius: params.orbitRadius,
    orbitSpeed: params.orbitSpeed,
    orbitPhase: 0,
    orbitMajorRadius: OUTER_RADIUS,
    orbitMinorRadius: params.orbitRadius,
    orbitDirection: Math.random() < 0.5 ? -1 : 1
  };
};

const spawnMiniBoss = (state: ThreatSpawnState): Meteor => {
  const params = rollThreatSpawnConfig("miniBoss", state.wave);
  const spawn = radialPoint(params.spawnAngle, OUTER_RADIUS + params.spawnRadiusOffset);
  const inward = randomInboundDirection(spawn, params.aimRadius);
  return {
    ...createThreat(state.nextId(), "miniBoss", spawn, inward, params.speed, params.radius),
    hp: params.hp,
    maxHp: params.hp,
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
