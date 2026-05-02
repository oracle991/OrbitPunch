import Phaser from "phaser";
import { OrbitPunchSimulation, type SimulationSnapshot, world } from "./simulation";

type HudElements = {
  hpBar: HTMLElement;
  score: HTMLElement;
  wave: HTMLElement;
  cooldown: HTMLElement;
  overlay: HTMLElement;
  startButton: HTMLButtonElement;
};

const palette = {
  orbit: 0x92e7ff,
  planetOcean: 0x2ca7d8,
  planetLand: 0xa6d66b,
  shield: 0x74f1ff,
  player: 0xf8d45f,
  playerCore: 0xffffff,
  meteor: 0xb4836a,
  meteorEdge: 0xffb36f,
  punch: 0x8cf7ff,
  punchGlove: 0xffd56f,
  punchShadow: 0x1b5c78,
  danger: 0xff6b6b,
  star: 0xd9fbff
};

export class GameScene extends Phaser.Scene {
  private readonly sim = new OrbitPunchSimulation();
  private readonly hud: HudElements;
  private graphics!: Phaser.GameObjects.Graphics;
  private shakeTime = 0;
  private hitStop = 0;

  public constructor(hud: HudElements) {
    super("game");
    this.hud = hud;
  }

  public create(): void {
    this.graphics = this.add.graphics();

    this.input.keyboard?.on("keydown-SPACE", () => this.fire());
    this.input.keyboard?.on("keydown-ESC", () => {
      if (!this.sim.snapshot().gameOver) {
        this.scene.pause();
        this.showOverlay("Paused", "Esc で再開。惑星防衛は一時停止中。", "Resume");
      }
    });
    this.input.on("pointerdown", () => this.fire());

    this.hud.startButton.addEventListener("click", () => {
      if (this.scene.isPaused()) {
        this.scene.resume();
        this.hud.overlay.classList.add("hidden");
        return;
      }
      this.startGame();
    });

    this.showOverlay("軌道衛星パンチ", "Space / Click / Tap で外向きパンチ。惑星に隕石を近づけるな。", "Start");
    this.render(this.sim.snapshot(), 0);
  }

  public update(_time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.033);

    if (this.hitStop > 0) {
      this.hitStop -= dt;
      this.render(this.sim.snapshot(), dt);
      return;
    }

    const events = this.sim.update(dt);
    if (events.hit) {
      this.hitStop = 0.035;
      this.shakeTime = 0.16;
    }
    if (events.satelliteHit) {
      this.hitStop = 0.05;
      this.shakeTime = 0.22;
    }
    if (events.planetHit) {
      this.shakeTime = 0.25;
    }
    if (events.gameOver) {
      const snapshot = this.sim.snapshot();
      this.showOverlay(
        "Game Over",
        `Score ${snapshot.score.toLocaleString()} / Wave ${snapshot.wave}`,
        "Retry"
      );
    }

    this.render(this.sim.snapshot(), dt);
  }

  private startGame(): void {
    this.sim.start();
    this.hitStop = 0;
    this.shakeTime = 0;
    this.cameras.main.setScroll(0, 0);
    this.hud.overlay.classList.add("hidden");
  }

  private fire(): void {
    if (this.scene.isPaused()) {
      return;
    }
    if (this.sim.fire()) {
      this.shakeTime = Math.max(this.shakeTime, 0.05);
    }
  }

  private showOverlay(title: string, summary: string, button: string): void {
    const panel = this.hud.overlay.querySelector(".panel");
    if (panel) {
      panel.innerHTML = `
        <p class="kicker">Orbit Punch Prototype</p>
        <h1>${title}</h1>
        <p class="summary">${summary}</p>
        <button id="start-button" type="button">${button}</button>
      `;
      this.hud.startButton = panel.querySelector("#start-button") as HTMLButtonElement;
      this.hud.startButton.addEventListener("click", () => {
        if (this.scene.isPaused()) {
          this.scene.resume();
          this.hud.overlay.classList.add("hidden");
          return;
        }
        this.startGame();
      });
    }
    this.hud.overlay.classList.remove("hidden");
  }

  private render(snapshot: SimulationSnapshot, dt: number): void {
    this.updateHud(snapshot);
    this.updateCamera(dt);

    this.graphics.clear();
    this.drawStarfield();
    this.drawOrbit(snapshot);
    this.drawPlanet(snapshot);
    this.drawPunches(snapshot);
    this.drawMeteors(snapshot);
    this.drawPlayer(snapshot);
    this.drawSparks(snapshot);
  }

  private updateHud(snapshot: SimulationSnapshot): void {
    const hpRatio = snapshot.planetHp / snapshot.maxPlanetHp;
    this.hud.hpBar.style.width = `${Math.max(0, hpRatio * 100)}%`;
    this.hud.score.textContent = snapshot.score.toLocaleString();
    this.hud.wave.textContent = String(snapshot.wave);
    this.hud.cooldown.textContent =
      snapshot.cooldown <= 0 ? "OK" : `${Math.ceil((snapshot.cooldown / snapshot.cooldownMax) * 100)}%`;
  }

  private updateCamera(dt: number): void {
    if (this.shakeTime <= 0) {
      this.cameras.main.setScroll(0, 0);
      return;
    }

    this.shakeTime -= dt;
    const amount = 5 * (this.shakeTime / 0.25);
    this.cameras.main.setScroll(
      Phaser.Math.Between(-amount, amount),
      Phaser.Math.Between(-amount, amount)
    );
  }

  private drawStarfield(): void {
    this.graphics.fillStyle(0x07121a, 0.82);
    this.graphics.fillRect(0, 0, world.width, world.height);

    for (let i = 0; i < 80; i += 1) {
      const x = (i * 181) % world.width;
      const y = (i * 97) % world.height;
      const radius = 0.7 + ((i * 13) % 20) / 18;
      this.graphics.fillStyle(palette.star, 0.18 + ((i * 7) % 20) / 100);
      this.graphics.fillCircle(x, y, radius);
    }
  }

  private drawOrbit(snapshot: SimulationSnapshot): void {
    this.graphics.lineStyle(2, palette.orbit, 0.24);
    this.graphics.strokeCircle(world.center.x, world.center.y, world.orbitRadius);

    this.graphics.lineStyle(1, palette.orbit, 0.12);
    this.graphics.strokeCircle(world.center.x, world.center.y, world.outerRadius * 0.62);

    const playerDirection = snapshot.playerAngle;
    this.graphics.lineStyle(1, palette.player, 0.22);
    this.graphics.beginPath();
    this.graphics.moveTo(world.center.x, world.center.y);
    this.graphics.lineTo(
      world.center.x + Math.cos(playerDirection) * (world.orbitRadius + 54),
      world.center.y + Math.sin(playerDirection) * (world.orbitRadius + 54)
    );
    this.graphics.strokePath();
  }

  private drawPlanet(snapshot: SimulationSnapshot): void {
    const hpRatio = snapshot.planetHp / snapshot.maxPlanetHp;
    this.graphics.fillStyle(palette.shield, 0.1 + hpRatio * 0.16);
    this.graphics.fillCircle(world.center.x, world.center.y, world.planetRadius + 16);
    this.graphics.lineStyle(2, palette.shield, 0.18 + hpRatio * 0.44);
    this.graphics.strokeCircle(world.center.x, world.center.y, world.planetRadius + 15);

    this.graphics.fillStyle(palette.planetOcean, 1);
    this.graphics.fillCircle(world.center.x, world.center.y, world.planetRadius);
    this.graphics.fillStyle(palette.planetLand, 0.88);
    this.graphics.fillEllipse(world.center.x - 18, world.center.y - 12, 58, 28);
    this.graphics.fillEllipse(world.center.x + 23, world.center.y + 16, 46, 20);
    this.graphics.fillStyle(0xffffff, 0.16);
    this.graphics.fillCircle(world.center.x - 22, world.center.y - 24, 20);

    if (hpRatio < 0.35) {
      this.graphics.lineStyle(2, palette.danger, 0.5);
      this.graphics.beginPath();
      this.graphics.moveTo(world.center.x - 24, world.center.y - 18);
      this.graphics.lineTo(world.center.x + 12, world.center.y + 5);
      this.graphics.lineTo(world.center.x - 8, world.center.y + 33);
      this.graphics.strokePath();
    }
  }

  private drawPlayer(snapshot: SimulationSnapshot): void {
    const pos = snapshot.playerPos;
    const angle = snapshot.playerAngle;
    const noseX = pos.x + Math.cos(angle) * 22;
    const noseY = pos.y + Math.sin(angle) * 22;

    this.graphics.fillStyle(palette.player, 1);
    this.graphics.fillCircle(pos.x, pos.y, 15);
    this.graphics.fillStyle(palette.playerCore, 1);
    this.graphics.fillCircle(pos.x + Math.cos(angle) * 5, pos.y + Math.sin(angle) * 5, 5);
    this.graphics.lineStyle(4, palette.player, 0.82);
    this.graphics.beginPath();
    this.graphics.moveTo(pos.x, pos.y);
    this.graphics.lineTo(noseX, noseY);
    this.graphics.strokePath();
  }

  private drawPunches(snapshot: SimulationSnapshot): void {
    for (const punch of snapshot.punches) {
      const alpha = Math.max(0, punch.life / punch.maxLife);
      const angle = Math.atan2(punch.direction.y, punch.direction.x);
      const wristX = punch.pos.x - punch.direction.x * 20;
      const wristY = punch.pos.y - punch.direction.y * 20;
      const sideX = Math.cos(angle + Math.PI / 2);
      const sideY = Math.sin(angle + Math.PI / 2);

      this.graphics.lineStyle(24, palette.punchShadow, 0.24 * alpha);
      this.graphics.beginPath();
      this.graphics.moveTo(punch.origin.x, punch.origin.y);
      this.graphics.lineTo(wristX, wristY);
      this.graphics.strokePath();

      this.graphics.lineStyle(15, palette.punch, 0.82 * alpha);
      this.graphics.beginPath();
      this.graphics.moveTo(punch.origin.x, punch.origin.y);
      this.graphics.lineTo(wristX, wristY);
      this.graphics.strokePath();

      this.graphics.fillStyle(palette.punch, 0.9 * alpha);
      this.graphics.fillCircle(punch.origin.x, punch.origin.y, 9);
      this.graphics.fillCircle(wristX, wristY, 10);

      this.graphics.fillStyle(palette.punchGlove, 1 * alpha);
      this.fillRotatedEllipse(
        punch.pos.x,
        punch.pos.y,
        punch.radius * 1.55,
        punch.radius * 1.18,
        angle
      );
      this.graphics.fillCircle(
        punch.pos.x + punch.direction.x * 12,
        punch.pos.y + punch.direction.y * 2,
        punch.radius * 0.52
      );

      this.graphics.lineStyle(3, 0xfff6c4, 0.8 * alpha);
      this.graphics.beginPath();
      this.graphics.moveTo(
        punch.pos.x + sideX * 4 - punch.direction.x * 5,
        punch.pos.y + sideY * 4 - punch.direction.y * 5
      );
      this.graphics.lineTo(
        punch.pos.x + sideX * 12 + punch.direction.x * 7,
        punch.pos.y + sideY * 12 + punch.direction.y * 7
      );
      this.graphics.moveTo(
        punch.pos.x - sideX * 4 - punch.direction.x * 5,
        punch.pos.y - sideY * 4 - punch.direction.y * 5
      );
      this.graphics.lineTo(
        punch.pos.x - sideX * 12 + punch.direction.x * 7,
        punch.pos.y - sideY * 12 + punch.direction.y * 7
      );
      this.graphics.strokePath();

      if (punch.phase === "holding") {
        this.graphics.lineStyle(2, 0xffffff, 0.34);
        this.graphics.strokeCircle(punch.pos.x, punch.pos.y, punch.radius + 11);
      }
    }
  }

  private fillRotatedEllipse(
    x: number,
    y: number,
    width: number,
    height: number,
    rotation: number
  ): void {
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

    this.graphics.fillPoints(points, true);
  }

  private drawMeteors(snapshot: SimulationSnapshot): void {
    for (const meteor of snapshot.meteors) {
      const angle = Math.atan2(world.center.y - meteor.pos.y, world.center.x - meteor.pos.x);
      this.graphics.lineStyle(1, meteor.knocked ? palette.punch : palette.danger, 0.18);
      this.graphics.beginPath();
      this.graphics.moveTo(meteor.pos.x, meteor.pos.y);
      this.graphics.lineTo(
        meteor.pos.x + Math.cos(angle) * 46,
        meteor.pos.y + Math.sin(angle) * 46
      );
      this.graphics.strokePath();

      this.graphics.fillStyle(meteor.knocked ? palette.punch : palette.meteorEdge, 0.28);
      this.graphics.fillCircle(meteor.pos.x, meteor.pos.y, meteor.radius + 4);
      this.graphics.fillStyle(meteor.knocked ? 0x6bdff0 : palette.meteor, 1);
      this.graphics.fillCircle(meteor.pos.x, meteor.pos.y, meteor.radius);
      this.graphics.fillStyle(0x4b342c, 0.7);
      this.graphics.fillCircle(
        meteor.pos.x + Math.cos(meteor.spin) * meteor.radius * 0.32,
        meteor.pos.y + Math.sin(meteor.spin) * meteor.radius * 0.3,
        meteor.radius * 0.24
      );
    }
  }

  private drawSparks(snapshot: SimulationSnapshot): void {
    for (const spark of snapshot.sparks) {
      const alpha = Math.max(0, spark.life / spark.maxLife);
      this.graphics.lineStyle(3, palette.player, alpha);
      this.graphics.strokeCircle(spark.pos.x, spark.pos.y, 34 * (1 - alpha) + 6);
      this.graphics.fillStyle(0xffffff, alpha);
      this.graphics.fillCircle(spark.pos.x, spark.pos.y, 4 + 12 * (1 - alpha));
    }
  }
}
