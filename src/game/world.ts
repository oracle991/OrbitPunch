import type { Vec2 } from "./types";

const WORLD_WIDTH = 960;
const WORLD_HEIGHT = 640;

export const CENTER: Vec2 = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
export const PLANET_RADIUS = 62;
export const ORBIT_RADIUS = 136;
export const OUTER_RADIUS = 500;
export const SATELLITE_RADIUS = 16;

export const world = {
  width: WORLD_WIDTH,
  height: WORLD_HEIGHT,
  center: CENTER,
  planetRadius: PLANET_RADIUS,
  orbitRadius: ORBIT_RADIUS,
  outerRadius: OUTER_RADIUS
};
