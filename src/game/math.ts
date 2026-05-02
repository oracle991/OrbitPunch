import { CENTER } from "./world";
import type { Vec2 } from "./types";

export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export const radialPoint = (angle: number, radius: number): Vec2 => ({
  x: CENTER.x + Math.cos(angle) * radius,
  y: CENTER.y + Math.sin(angle) * radius
});

export const normalize = (v: Vec2): Vec2 => {
  const vectorLength = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / vectorLength, y: v.y / vectorLength };
};

export const length = (v: Vec2): number => Math.hypot(v.x, v.y);

export const closestPointOnSegment = (point: Vec2, start: Vec2, end: Vec2): Vec2 => {
  const segment = { x: end.x - start.x, y: end.y - start.y };
  const segmentLengthSq = segment.x * segment.x + segment.y * segment.y;
  if (segmentLengthSq <= 0.001) {
    return { ...start };
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * segment.x + (point.y - start.y) * segment.y) / segmentLengthSq
    )
  );
  return {
    x: start.x + segment.x * t,
    y: start.y + segment.y * t
  };
};
