import { distance, length, normalize } from "../math";
import type { Meteor } from "../types";
import { CENTER, WORLD_HEIGHT, WORLD_WIDTH } from "../world";
import {
  TRACTOR_KNOCKED_PULL_ACCELERATION,
  TRACTOR_KNOCKED_PULL_RANGE,
  TRACTOR_RANGE,
  TRACTOR_TURN_RATE
} from "./config";

export const updateThreat = (meteor: Meteor, dt: number): void => {
  if (
    meteor.kind === "miniBoss" &&
    meteor.spiralAngle !== undefined &&
    meteor.spiralRadius !== undefined &&
    meteor.spiralRadialSpeed !== undefined &&
    meteor.spiralAngularSpeed !== undefined &&
    meteor.spiralDirection !== undefined
  ) {
    updateMiniBossSpiral(meteor, dt);
    return;
  }

  if (
    meteor.kind === "orbitalSatellite" &&
    !meteor.knocked &&
    meteor.orbitAngle !== undefined &&
    meteor.orbitSpeed !== undefined &&
    meteor.orbitPhase !== undefined &&
    meteor.orbitMajorRadius !== undefined &&
    meteor.orbitMinorRadius !== undefined &&
    meteor.orbitDirection !== undefined
  ) {
    updateOrbitalSatellite(meteor, dt);
    return;
  }

  meteor.pos.x += meteor.vel.x * dt;
  meteor.pos.y += meteor.vel.y * dt;
};

const updateMiniBossSpiral = (meteor: Meteor, dt: number): void => {
  const previous = { ...meteor.pos };
  meteor.spiralAngle =
    (meteor.spiralAngle ?? 0) +
    (meteor.spiralAngularSpeed ?? 0) * (meteor.spiralDirection ?? 1) * dt;
  meteor.spiralRadius = Math.max(
    0,
    (meteor.spiralRadius ?? 0) - (meteor.spiralRadialSpeed ?? 0) * dt
  );
  meteor.pos = spiralPoint(meteor);

  if (dt > 0) {
    meteor.vel = {
      x: (meteor.pos.x - previous.x) / dt,
      y: (meteor.pos.y - previous.y) / dt
    };
  }
};

const spiralPoint = (meteor: Meteor): Meteor["pos"] => {
  const angle = meteor.spiralAngle ?? 0;
  const radius = meteor.spiralRadius ?? 0;

  return {
    x: CENTER.x + Math.cos(angle) * radius,
    y: CENTER.y + Math.sin(angle) * radius
  };
};

const updateOrbitalSatellite = (meteor: Meteor, dt: number): void => {
  if ((meteor.orbitPhase ?? 0) >= Math.PI) {
    updateOrbitalSatelliteExit(meteor, dt);
    return;
  }

  const previous = { ...meteor.pos };
  meteor.orbitPhase = Math.min(Math.PI, (meteor.orbitPhase ?? 0) + (meteor.orbitSpeed ?? 0) * dt);
  meteor.pos = ellipticalOrbitPoint(meteor);

  if (dt > 0) {
    meteor.vel = {
      x: (meteor.pos.x - previous.x) / dt,
      y: (meteor.pos.y - previous.y) / dt
    };
  }

  if (meteor.orbitPhase >= Math.PI) {
    ensureOrbitalSatelliteExitVelocity(meteor);
  }
};

const updateOrbitalSatelliteExit = (meteor: Meteor, dt: number): void => {
  ensureOrbitalSatelliteExitVelocity(meteor);
  meteor.pos.x += meteor.vel.x * dt;
  meteor.pos.y += meteor.vel.y * dt;

  if (isOrbitalSatelliteFullyOffscreen(meteor)) {
    meteor.alive = false;
  }
};

const ensureOrbitalSatelliteExitVelocity = (meteor: Meteor): void => {
  if (length(meteor.vel) > 0.001) {
    return;
  }

  const speed = Math.max(1, (meteor.orbitMinorRadius ?? meteor.radius) * (meteor.orbitSpeed ?? 0));
  const direction = orbitalSatelliteExitDirection(meteor);
  meteor.vel = {
    x: direction.x * speed,
    y: direction.y * speed
  };
};

const orbitalSatelliteExitDirection = (meteor: Meteor): Meteor["vel"] => {
  const angle = meteor.orbitAngle ?? 0;
  const direction = meteor.orbitDirection ?? 1;
  const tangent = {
    x: -Math.sin(angle) * direction,
    y: Math.cos(angle) * direction
  };

  return normalize({ x: -tangent.x, y: -tangent.y });
};

export const isOrbitalSatelliteFullyOffscreen = (meteor: Meteor): boolean => {
  const padding = meteor.radius * 2;
  return (
    meteor.pos.x < -padding ||
    meteor.pos.x > WORLD_WIDTH + padding ||
    meteor.pos.y < -padding ||
    meteor.pos.y > WORLD_HEIGHT + padding
  );
};

const ellipticalOrbitPoint = (meteor: Meteor): Meteor["pos"] => {
  const angle = meteor.orbitAngle ?? 0;
  const phase = meteor.orbitPhase ?? 0;
  const majorRadius = meteor.orbitMajorRadius ?? 0;
  const minorRadius = meteor.orbitMinorRadius ?? 0;
  const direction = meteor.orbitDirection ?? 1;
  const radial = { x: Math.cos(angle), y: Math.sin(angle) };
  const tangent = {
    x: -Math.sin(angle) * direction,
    y: Math.cos(angle) * direction
  };

  return {
    x: CENTER.x + radial.x * Math.cos(phase) * majorRadius + tangent.x * Math.sin(phase) * minorRadius,
    y: CENTER.y + radial.y * Math.cos(phase) * majorRadius + tangent.y * Math.sin(phase) * minorRadius
  };
};

export const applyTractorPull = (meteors: Meteor[], wave: number, dt: number): void => {
  for (const drone of meteors) {
    if (!drone.alive || drone.knocked || drone.kind !== "tractorDrone") {
      continue;
    }

    for (const target of meteors) {
      if (!target.alive || target === drone || target.kind === "miniBoss") {
        continue;
      }

      const pullDistance = distance(drone.pos, target.pos);
      if (pullDistance < 8) {
        continue;
      }

      if (target.knocked) {
        if (pullDistance <= TRACTOR_KNOCKED_PULL_RANGE) {
          pullKnockedThreatTowardDrone(target, drone, pullDistance, wave, dt);
        }
        continue;
      }

      if (pullDistance <= TRACTOR_RANGE) {
        bendThreatTowardPlanet(target, pullDistance, wave, dt);
      }
    }
  }
};

const bendThreatTowardPlanet = (
  target: Meteor,
  tractorDistance: number,
  wave: number,
  dt: number
): void => {
  const speed = length(target.vel);
  if (speed <= 0.001) {
    return;
  }

  const current = normalize(target.vel);
  const desired = normalize({ x: CENTER.x - target.pos.x, y: CENTER.y - target.pos.y });
  const delta = Math.atan2(
    current.x * desired.y - current.y * desired.x,
    current.x * desired.x + current.y * desired.y
  );
  const rangeInfluence = 1 - tractorDistance / TRACTOR_RANGE;
  const maxTurn = rangeInfluence * (TRACTOR_TURN_RATE + wave * 0.08) * dt;
  const turn = Math.max(-maxTurn, Math.min(maxTurn, delta));
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  target.vel.x = (current.x * cos - current.y * sin) * speed;
  target.vel.y = (current.x * sin + current.y * cos) * speed;
};

const pullKnockedThreatTowardDrone = (
  target: Meteor,
  drone: Meteor,
  tractorDistance: number,
  wave: number,
  dt: number
): void => {
  const direction = normalize({
    x: drone.pos.x - target.pos.x,
    y: drone.pos.y - target.pos.y
  });
  const rangeInfluence = 1 - tractorDistance / TRACTOR_KNOCKED_PULL_RANGE;
  const acceleration =
    (TRACTOR_KNOCKED_PULL_ACCELERATION + wave * 24) * (0.32 + rangeInfluence * 0.68);
  target.vel.x += direction.x * acceleration * dt;
  target.vel.y += direction.y * acceleration * dt;
};
