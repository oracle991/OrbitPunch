import Phaser from "phaser";
import { OrbitPunchSimulation, type ChainHit, type SimulationSnapshot } from "./simulation";
import { palette } from "./rendering/palette";
import { fillRotatedEllipse } from "./rendering/primitives";
import { drawThreats } from "./rendering/threats";
import { world } from "./world";

type HudElements = {
  hpBar: HTMLElement;
  score: HTMLElement;
  wave: HTMLElement;
  cooldown: HTMLElement;
  overlay: HTMLElement;
  startButton: HTMLButtonElement;
};

export class GameScene extends Phaser.Scene {
  private readonly sim = new OrbitPunchSimulation();
  private readonly hud: HudElements;
  private graphics!: Phaser.GameObjects.Graphics;
  private shakeTime = 0;
  private hitStop = 0;
  private hitLabels: Phaser.GameObjects.Text[] = [];

  public constructor(hud: HudElements) {
    super("game");
    this.hud = hud;
  }

  public create(): void {
    this.graphics = this.add.graphics();

    this.input.keyboard?.on("keydown-SPACE", (event: KeyboardEvent) => {
      if (!event.repeat) {
        this.pressFire();
      }
    });
    this.input.keyboard?.on("keyup-SPACE", () => this.releaseFire());
    this.input.keyboard?.on("keydown-ESC", () => {
      if (!this.sim.snapshot().gameOver) {
        this.cancelFire();
        this.scene.pause();
        this.showOverlay("Paused", "Press Esc to resume.", "Resume");
      }
    });
    this.input.on("pointerdown", () => this.pressFire());
    this.input.on("pointerup", () => this.releaseFire());
    this.input.on("pointerupoutside", () => this.releaseFire());

    this.hud.startButton.addEventListener("click", () => {
      if (this.scene.isPaused()) {
        this.scene.resume();
        this.hud.overlay.classList.add("hidden");
        return;
      }
      this.startGame();
    });

    this.showOverlay("Orbit Punch", "Space / Click / Tap to punch outward.", "Start");
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
    for (const chainHit of events.chainHits) {
      this.spawnHitLabel(chainHit);
    }
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
    for (const label of this.hitLabels) {
      label.destroy();
    }
    this.hitLabels = [];
    this.cameras.main.setScroll(0, 0);
    this.hud.overlay.classList.add("hidden");
  }

  private pressFire(): void {
    if (this.scene.isPaused()) {
      return;
    }
    this.sim.pressFire();
  }

  private releaseFire(): void {
    if (this.scene.isPaused()) {
      this.cancelFire();
      return;
    }
    const result = this.sim.releaseFire();
    if (result.fired) {
      this.shakeTime = Math.max(this.shakeTime, result.charged ? 0.11 : 0.05);
    }
  }

  private cancelFire(): void {
    this.sim.cancelFire();
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

  private spawnHitLabel(chainHit: ChainHit): void {
    const outward = new Phaser.Math.Vector2(
      chainHit.pos.x - world.center.x,
      chainHit.pos.y - world.center.y
    ).normalize();
    const x = Phaser.Math.Clamp(chainHit.pos.x + outward.x * 14, 58, world.width - 58);
    const y = Phaser.Math.Clamp(chainHit.pos.y + outward.y * 14, 42, world.height - 42);
    const recoveryText =
      chainHit.shieldRecovery && chainHit.shieldRecovery > 0
        ? `\n+${chainHit.shieldRecovery} shield`
        : "";
    const label = this.add
      .text(x, y, `${chainHit.count} hits!${recoveryText}`, {
        color: "#fff6c4",
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: "23px",
        fontStyle: "900",
        stroke: "#102032",
        strokeThickness: 5,
        align: "center"
      })
      .setOrigin(0.5)
      .setDepth(20)
      .setAlpha(0);

    this.hitLabels.push(label);
    this.tweens.add({
      targets: label,
      alpha: { from: 0, to: 1 },
      y: y - 26,
      scale: { from: 0.82, to: 1.18 },
      duration: 150,
      ease: "Back.Out"
    });
    this.tweens.add({
      targets: label,
      alpha: 0,
      y: y - 52,
      scale: 1,
      delay: 360,
      duration: 260,
      ease: "Cubic.In",
      onComplete: () => {
        this.hitLabels = this.hitLabels.filter((item) => item !== label);
        label.destroy();
      }
    });
  }

  private render(snapshot: SimulationSnapshot, dt: number): void {
    this.updateHud(snapshot);
    this.updateCamera(dt);

    this.graphics.clear();
    this.drawStarfield();
    this.drawOrbit(snapshot);
    this.drawPlanet(snapshot);
    this.drawPunches(snapshot);
    drawThreats(this.graphics, snapshot);
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
    const invulnerable = snapshot.satelliteInvulnerability > 0;
    const blinkAlpha = invulnerable
      ? Phaser.Math.Linear(0.34, 0.78, Math.sin(snapshot.satelliteInvulnerability * 32) * 0.5 + 0.5)
      : 1;

    if (invulnerable) {
      this.graphics.lineStyle(2, palette.playerCore, 0.32);
      this.graphics.strokeCircle(pos.x, pos.y, 23);
    }

    if (snapshot.charge.held && !snapshot.charge.canceled) {
      const chargeAlpha = snapshot.charge.active ? 0.74 : 0.24 + snapshot.charge.progress * 0.34;
      const chargeRadius = 24 + snapshot.charge.progress * 10;
      this.graphics.lineStyle(
        3,
        snapshot.charge.active ? palette.punchGlove : palette.punch,
        chargeAlpha
      );
      this.graphics.strokeCircle(pos.x, pos.y, chargeRadius);
      this.graphics.fillStyle(palette.punch, 0.08 + snapshot.charge.progress * 0.12);
      this.graphics.fillCircle(pos.x, pos.y, chargeRadius + 3);
    }

    this.graphics.fillStyle(palette.player, blinkAlpha);
    this.graphics.fillCircle(pos.x, pos.y, 15);
    this.graphics.fillStyle(palette.playerCore, blinkAlpha);
    this.graphics.fillCircle(pos.x + Math.cos(angle) * 5, pos.y + Math.sin(angle) * 5, 5);
    this.graphics.lineStyle(4, palette.player, 0.82 * blinkAlpha);
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
      fillRotatedEllipse(
        this.graphics,
        punch.pos.x,
        punch.pos.y,
        punch.radius * (punch.charged ? 1.95 : 1.55),
        punch.radius * (punch.charged ? 1.42 : 1.18),
        angle
      );
      this.graphics.fillCircle(
        punch.pos.x + punch.direction.x * 12,
        punch.pos.y + punch.direction.y * 2,
        punch.radius * 0.52
      );

      this.graphics.lineStyle(punch.charged ? 5 : 3, 0xfff6c4, 0.8 * alpha);
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
        this.graphics.lineStyle(punch.charged ? 4 : 2, 0xffffff, punch.charged ? 0.58 : 0.34);
        this.graphics.strokeCircle(
          punch.pos.x,
          punch.pos.y,
          punch.radius + (punch.charged ? 16 : 11)
        );
      }
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
