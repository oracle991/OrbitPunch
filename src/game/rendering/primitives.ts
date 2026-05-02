import Phaser from "phaser";

export const fillRotatedEllipse = (
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number
): void => {
  const points: Phaser.Types.Math.Vector2Like[] = [];
  const radiusX = width / 2;
  const radiusY = height / 2;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  for (let i = 0; i < 18; i += 1) {
    const t = (i / 18) * Math.PI * 2;
    const px = Math.cos(t) * radiusX;
    const py = Math.sin(t) * radiusY;
    points.push({
      x: x + px * cos - py * sin,
      y: y + px * sin + py * cos
    });
  }

  graphics.fillPoints(points, true);
};
