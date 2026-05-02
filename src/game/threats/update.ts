import { distance, normalize, radialPoint } from "../math";
import type { Meteor } from "../types";
import { CENTER } from "../world";
import { TRACTOR_PULL, TRACTOR_RANGE } from "./config";

export const updateThreat = (meteor: Meteor, dt: number): void => {
  if (
    meteor.kind === "orbitalSatellite" &&
    !meteor.knocked &&
    meteor.orbitRadius !== undefined &&
    meteor.orbitAngle !== undefined &&
    meteor.orbitSpeed !== undefined &&
    distance(meteor.pos, CENTER) <= meteor.orbitRadius
  ) {
    meteor.orbitAngle += meteor.orbitSpeed * dt;
    meteor.pos = radialPoint(meteor.orbitAngle, meteor.orbitRadius);
    meteor.vel = {
      x: -Math.sin(meteor.orbitAngle) * meteor.orbitSpeed * meteor.orbitRadius,
      y: Math.cos(meteor.orbitAngle) * meteor.orbitSpeed * meteor.orbitRadius
    };
    return;
  }

  meteor.pos.x += meteor.vel.x * dt;
  meteor.pos.y += meteor.vel.y * dt;
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
