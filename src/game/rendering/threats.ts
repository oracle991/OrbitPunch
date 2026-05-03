import Phaser from "phaser";
import type { Meteor, SimulationSnapshot } from "../types";
import { TRACTOR_RANGE } from "../threats/config";
import { palette } from "./palette";
import { fillRotatedEllipse } from "./primitives";

export const drawThreats = (
  graphics: Phaser.GameObjects.Graphics,
  snapshot: SimulationSnapshot
): void => {
  drawTractorLinks(graphics, snapshot);

  for (const meteor of snapshot.meteors) {
    if (meteor.kind === "orbitalSatellite") {
      drawOrbitalSatellite(graphics, meteor);
      continue;
    }
    if (meteor.kind === "explosiveCore") {
      drawExplosiveCore(graphics, meteor);
      continue;
    }
    if (meteor.kind === "tractorDrone") {
      drawTractorDrone(graphics, meteor);
      continue;
    }
    if (meteor.kind === "miniBoss") {
      drawMiniBoss(graphics, meteor);
      continue;
    }
    drawMeteor(graphics, meteor);
  }
};

const drawMeteor = (graphics: Phaser.GameObjects.Graphics, meteor: Meteor): void => {
  graphics.fillStyle(meteor.knocked ? palette.punch : palette.meteorEdge, 0.28);
  graphics.fillCircle(meteor.pos.x, meteor.pos.y, meteor.radius + 4);
  graphics.fillStyle(meteor.knocked ? 0x6bdff0 : palette.meteor, 1);
  graphics.fillCircle(meteor.pos.x, meteor.pos.y, meteor.radius);
  graphics.fillStyle(0x4b342c, 0.7);
  graphics.fillCircle(
    meteor.pos.x + Math.cos(meteor.spin) * meteor.radius * 0.32,
    meteor.pos.y + Math.sin(meteor.spin) * meteor.radius * 0.3,
    meteor.radius * 0.24
  );
};

const drawOrbitalSatellite = (graphics: Phaser.GameObjects.Graphics, meteor: Meteor): void => {
  const angle = meteor.spin;
  const panelX = Math.cos(angle + Math.PI / 2);
  const panelY = Math.sin(angle + Math.PI / 2);

  graphics.fillStyle(meteor.knocked ? palette.punch : palette.orbitalSatellite, 1);
  graphics.fillCircle(meteor.pos.x, meteor.pos.y, meteor.radius * 0.72);
  graphics.fillStyle(palette.orbitalPanel, meteor.knocked ? 0.5 : 0.92);
  fillRotatedEllipse(
    graphics,
    meteor.pos.x + panelX * meteor.radius,
    meteor.pos.y + panelY * meteor.radius,
    meteor.radius * 1.2,
    meteor.radius * 0.42,
    angle
  );
  fillRotatedEllipse(
    graphics,
    meteor.pos.x - panelX * meteor.radius,
    meteor.pos.y - panelY * meteor.radius,
    meteor.radius * 1.2,
    meteor.radius * 0.42,
    angle
  );
  graphics.fillStyle(0xffffff, 0.75);
  graphics.fillCircle(meteor.pos.x, meteor.pos.y, meteor.radius * 0.28);
};

const drawExplosiveCore = (graphics: Phaser.GameObjects.Graphics, meteor: Meteor): void => {
  const pulse = 0.5 + Math.sin(meteor.spin * 2.4) * 0.5;
  graphics.fillStyle(palette.explosiveGlow, 0.18 + pulse * 0.18);
  graphics.fillCircle(meteor.pos.x, meteor.pos.y, meteor.radius + 13 + pulse * 5);
  graphics.lineStyle(2, meteor.knocked ? palette.punch : palette.explosiveCore, 0.52);
  graphics.strokeCircle(meteor.pos.x, meteor.pos.y, meteor.radius + 8);
  graphics.fillStyle(meteor.knocked ? palette.punch : palette.explosiveCore, 1);
  graphics.fillCircle(meteor.pos.x, meteor.pos.y, meteor.radius);
  graphics.fillStyle(palette.explosiveGlow, 0.95);
  graphics.fillCircle(meteor.pos.x, meteor.pos.y, meteor.radius * 0.45);

  graphics.lineStyle(3, 0xffffff, 0.62);
  for (let i = 0; i < 3; i += 1) {
    const angle = meteor.spin + (i * Math.PI * 2) / 3;
    graphics.beginPath();
    graphics.moveTo(meteor.pos.x, meteor.pos.y);
    graphics.lineTo(
      meteor.pos.x + Math.cos(angle) * meteor.radius * 0.9,
      meteor.pos.y + Math.sin(angle) * meteor.radius * 0.9
    );
    graphics.strokePath();
  }
};

const drawTractorDrone = (graphics: Phaser.GameObjects.Graphics, meteor: Meteor): void => {
  graphics.lineStyle(2, meteor.knocked ? palette.punch : palette.tractorDrone, 0.45);
  graphics.strokeCircle(meteor.pos.x, meteor.pos.y, meteor.radius + 6);
  graphics.fillStyle(meteor.knocked ? palette.punch : palette.tractorDrone, 1);
  fillRotatedEllipse(
    graphics,
    meteor.pos.x,
    meteor.pos.y,
    meteor.radius * 1.55,
    meteor.radius * 1.05,
    meteor.spin
  );
  graphics.fillStyle(0x112814, 0.82);
  graphics.fillCircle(meteor.pos.x, meteor.pos.y, meteor.radius * 0.42);
  graphics.fillStyle(palette.tractorBeam, 0.95);
  graphics.fillCircle(meteor.pos.x, meteor.pos.y, meteor.radius * 0.22);
};

const drawMiniBoss = (graphics: Phaser.GameObjects.Graphics, meteor: Meteor): void => {
  const hpRatio = Math.max(0, meteor.hp / meteor.maxHp);
  graphics.fillStyle(palette.miniBoss, 0.18);
  graphics.fillCircle(meteor.pos.x, meteor.pos.y, meteor.radius + 13);
  graphics.lineStyle(3, palette.miniBoss, meteor.knocked ? 0.22 : 0.68);
  graphics.strokeCircle(meteor.pos.x, meteor.pos.y, meteor.radius + 8);

  graphics.fillStyle(meteor.knocked ? palette.punch : palette.miniBoss, 1);
  fillRotatedEllipse(
    graphics,
    meteor.pos.x,
    meteor.pos.y,
    meteor.radius * 1.9,
    meteor.radius * 1.26,
    meteor.spin * 0.45
  );
  graphics.fillStyle(palette.miniBossCore, 0.96);
  graphics.fillCircle(meteor.pos.x, meteor.pos.y, meteor.radius * 0.42);

  graphics.lineStyle(5, 0x25143f, 0.82);
  graphics.beginPath();
  graphics.arc(meteor.pos.x, meteor.pos.y, meteor.radius + 15, -Math.PI / 2, Math.PI * 1.5);
  graphics.strokePath();

  graphics.lineStyle(5, palette.miniBossCore, 0.95);
  graphics.beginPath();
  graphics.arc(
    meteor.pos.x,
    meteor.pos.y,
    meteor.radius + 15,
    -Math.PI / 2,
    -Math.PI / 2 + Math.PI * 2 * hpRatio
  );
  graphics.strokePath();
};

const drawTractorLinks = (
  graphics: Phaser.GameObjects.Graphics,
  snapshot: SimulationSnapshot
): void => {
  for (const drone of snapshot.meteors) {
    if (!drone.alive || drone.knocked || drone.kind !== "tractorDrone") {
      continue;
    }

    graphics.lineStyle(1, palette.tractorBeam, 0.12);
    graphics.strokeCircle(drone.pos.x, drone.pos.y, TRACTOR_RANGE);

    for (const target of snapshot.meteors) {
      if (target === drone || !target.alive || target.knocked || target.kind === "miniBoss") {
        continue;
      }
      const distanceToTarget = Phaser.Math.Distance.Between(
        drone.pos.x,
        drone.pos.y,
        target.pos.x,
        target.pos.y
      );
      if (distanceToTarget > TRACTOR_RANGE) {
        continue;
      }
      const alpha = 0.34 * (1 - distanceToTarget / TRACTOR_RANGE);

      graphics.lineStyle(1, palette.tractorBeam, alpha * 0.55);
      graphics.beginPath();
      graphics.moveTo(drone.pos.x, drone.pos.y);
      graphics.lineTo(target.pos.x, target.pos.y);
      graphics.strokePath();
    }
  }
};
