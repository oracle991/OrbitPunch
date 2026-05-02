import { distance, normalize } from "../math";
import type { Meteor } from "../types";
import { CENTER } from "../world";
import { TRACTOR_PULL, TRACTOR_RANGE } from "./config";

export const updateThreat = (meteor: Meteor, dt: number): void => {
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

const updateOrbitalSatellite = (meteor: Meteor, dt: number): void => {
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
    meteor.alive = false;
  }
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
      if (!target.alive || target.knocked || target === drone || target.kind === "miniBoss") {
        continue;
      }

      const pullDistance = distance(drone.pos, target.pos);
      if (pullDistance > TRACTOR_RANGE || pullDistance < 8) {
        continue;
      }

      const direction = normalize({ x: drone.pos.x - target.pos.x, y: drone.pos.y - target.pos.y });
      const strength = (1 - pullDistance / TRACTOR_RANGE) * (TRACTOR_PULL + wave * 3);
      target.vel.x += direction.x * strength * dt;
      target.vel.y += direction.y * strength * dt;
    }
  }
};
