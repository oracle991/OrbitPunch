import Phaser from "phaser";
import {
  OrbitPunchSimulation,
  type ChainHit,
  type ExplosionBlast,
  type SimulationSnapshot,
  type UpgradeChoice,
  type UpgradeId
} from "./simulation";
import { palette } from "./rendering/palette";
import { TRACTOR_RANGE } from "./threats/config";
import type { Meteor, Punch, ThreatKind, Vec2 } from "./types";
import { world } from "./world";

const PLANET_TEXTURE_KEY = "planet-topdown";
const PLAYER_TEXTURE_KEY = "player-topdown";
const PUNCH_TEXTURE_KEY = "punch-topdown";
const CHAIN_TEXTURE_KEY = "chain-link-topdown";
const THREAT_TEXTURE_KEYS: Record<ThreatKind, string> = {
  meteor: "threat-meteor-topdown",
  orbitalSatellite: "threat-orbital-satellite-topdown",
  explosiveCore: "threat-explosive-core-topdown",
  tractorDrone: "threat-tractor-drone-topdown",
  miniBoss: "threat-mini-boss-topdown"
};

const PLANET_TEXTURE_URL = new URL("../../img/planet-topdown.png", import.meta.url).href;
const PLAYER_TEXTURE_URL = new URL("../../img/player-topdown.png", import.meta.url).href;
const PUNCH_TEXTURE_URL = new URL("../../img/punch-topdown.png", import.meta.url).href;
const CHAIN_TEXTURE_URL = new URL("../../img/chain-link-topdown.png", import.meta.url).href;
const THREAT_TEXTURE_URLS: Record<ThreatKind, string> = {
  meteor: new URL("../../img/threat-meteor-topdown.png", import.meta.url).href,
  orbitalSatellite: new URL("../../img/threat-orbital-satellite-topdown.png", import.meta.url).href,
  explosiveCore: new URL("../../img/threat-explosive-core-topdown.png", import.meta.url).href,
  tractorDrone: new URL("../../img/threat-tractor-drone-topdown.png", import.meta.url).href,
  miniBoss: new URL("../../img/threat-mini-boss-topdown.png", import.meta.url).href
};
const UPGRADE_ART_URLS: Record<UpgradeId, string> = {
  orbitalAcceleration: new URL("../../img/upgrade/orbitalAcceleration.png", import.meta.url).href,
  longArm: new URL("../../img/upgrade/longArm.png", import.meta.url).href,
  quickPunch: new URL("../../img/upgrade/quickPunch.png", import.meta.url).href,
  recoverySystem: new URL("../../img/upgrade/recoverySystem.png", import.meta.url).href,
  homingKnockback: new URL("../../img/upgrade/homingKnockback.png", import.meta.url).href,
  chainMagnet: new URL("../../img/upgrade/chainMagnet.png", import.meta.url).href,
  shieldSiphon: new URL("../../img/upgrade/shieldSiphon.png", import.meta.url).href,
  explosiveCoreResonance: new URL("../../img/upgrade/explosiveCoreResonance.png", import.meta.url).href,
  wideGlove: new URL("../../img/upgrade/wideGlove.png", import.meta.url).href,
  perfectTiming: new URL("../../img/upgrade/perfectTiming.png", import.meta.url).href,
  orbitalShield: new URL("../../img/upgrade/orbitalShield.png", import.meta.url).href,
  emergencyBoost: new URL("../../img/upgrade/emergencyBoost.png", import.meta.url).href,
  planetRepair: new URL("../../img/upgrade/planetRepair.png", import.meta.url).href,
  twinPunch: new URL("../../img/upgrade/twinPunch.png", import.meta.url).href,
  overdrive: new URL("../../img/upgrade/overdrive.png", import.meta.url).href,
  starburst: new URL("../../img/upgrade/starburst.png", import.meta.url).href,
  punchReload: new URL("../../img/upgrade/punchReload.png", import.meta.url).href
};

const PLANET_VISIBLE_WIDTH_RATIO = 147 / 192;
const PLAYER_DISPLAY_SIZE = 72;
const PUNCH_VISIBLE_WIDTH_RATIO = 99 / 128;
const CHAIN_LINK_HEIGHT = 18;
const CHAIN_LINK_PADDING = 18;
const STAR_COUNT = 96;
const THREAT_VISIBLE_WIDTH_RATIOS: Record<ThreatKind, number> = {
  meteor: 70 / 96,
  orbitalSatellite: 84 / 96,
  explosiveCore: 69 / 96,
  tractorDrone: 81 / 96,
  miniBoss: 142 / 160
};

type HudElements = {
  hpBar: HTMLElement;
  score: HTMLElement;
  wave: HTMLElement;
  cooldown: HTMLElement;
  overlay: HTMLElement;
  tutorialButton: HTMLButtonElement;
  startButton: HTMLButtonElement;
};

type BackgroundStar = {
  x: number;
  y: number;
  radius: number;
  alpha: number;
};

type ActiveExplosionRing = ExplosionBlast & {
  life: number;
  maxLife: number;
};

const EXPLOSION_RING_LIFE = 0.54;

export class GameScene extends Phaser.Scene {
  private readonly sim = new OrbitPunchSimulation();
  private readonly hud: HudElements;
  private readonly stars = this.createStarfield();
  private graphics!: Phaser.GameObjects.Graphics;
  private overlayGraphics!: Phaser.GameObjects.Graphics;
  private planetImage!: Phaser.GameObjects.Image;
  private playerImage!: Phaser.GameObjects.Image;
  private threatImages: Phaser.GameObjects.Image[] = [];
  private punchImages: Phaser.GameObjects.Image[] = [];
  private chainImages: Phaser.GameObjects.Image[] = [];
  private shakeTime = 0;
  private hitStop = 0;
  private hitLabels: Phaser.GameObjects.Text[] = [];
  private explosionRings: ActiveExplosionRing[] = [];
  private overlayAction: (() => void) | undefined;

  public constructor(hud: HudElements) {
    super("game");
    this.hud = hud;
  }

  private createStarfield(): BackgroundStar[] {
    return Array.from({ length: STAR_COUNT }, () => ({
      x: Math.random() * world.width,
      y: Math.random() * world.height,
      radius: Phaser.Math.FloatBetween(0.55, 1.9),
      alpha: Phaser.Math.FloatBetween(0.16, 0.4)
    }));
  }

  public preload(): void {
    this.load.image(PLANET_TEXTURE_KEY, PLANET_TEXTURE_URL);
    this.load.image(PLAYER_TEXTURE_KEY, PLAYER_TEXTURE_URL);
    this.load.image(PUNCH_TEXTURE_KEY, PUNCH_TEXTURE_URL);
    this.load.image(CHAIN_TEXTURE_KEY, CHAIN_TEXTURE_URL);
    for (const [kind, url] of Object.entries(THREAT_TEXTURE_URLS) as Array<[ThreatKind, string]>) {
      this.load.image(THREAT_TEXTURE_KEYS[kind], url);
    }
  }

  public create(): void {
    this.graphics = this.add.graphics();
    this.overlayGraphics = this.add.graphics().setDepth(6);
    this.planetImage = this.add
      .image(0, 0, PLANET_TEXTURE_KEY)
      .setOrigin(0.5)
      .setDepth(1)
      .setVisible(false);
    this.playerImage = this.add
      .image(0, 0, PLAYER_TEXTURE_KEY)
      .setOrigin(0.5)
      .setDepth(5)
      .setVisible(false);

    this.input.keyboard?.on("keydown-SPACE", (event: KeyboardEvent) => {
      if (!event.repeat) {
        this.pressFire();
      }
    });
    this.input.keyboard?.on("keyup-SPACE", () => this.releaseFire());
    this.input.keyboard?.on("keydown-ESC", () => {
      if (!this.sim.snapshot().gameOver) {
        this.cancelFire();
        if (this.scene.isPaused()) {
          this.hideOverlay();
          this.scene.resume();
          return;
        }
        this.scene.pause();
        this.showOverlay("Paused", "Press Esc to resume.", "Resume", () => {
          this.hideOverlay();
          this.scene.resume();
        });
      }
    });
    this.input.on("pointerdown", () => this.pressFire());
    this.input.on("pointerup", () => this.releaseFire());
    this.input.on("pointerupoutside", () => this.releaseFire());

    this.hud.startButton.addEventListener("click", () => {
      this.handleOverlayAction();
    });
    this.hud.tutorialButton.addEventListener("click", () => this.showTutorialOverlay());

    this.showOverlay("Orbit Punch", "Space / Click / Tap to punch outward.", "Start", () =>
      this.startGame()
    );
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
    for (const explosion of events.explosions) {
      this.spawnExplosionRing(explosion);
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
        "Retry",
        () => this.startGame()
      );
    } else if (events.waveAdvanced) {
      this.showUpgradeOverlay(events.waveAdvanced.to);
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
    this.explosionRings = [];
    this.cameras.main.setScroll(0, 0);
    this.hideOverlay();
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

  private showOverlay(
    title: string,
    summary: string,
    button: string,
    action: () => void
  ): void {
    const panel = this.hud.overlay.querySelector(".panel");
    if (panel) {
      panel.classList.remove("upgrade-panel");
      panel.classList.remove("tutorial-panel");
      panel.innerHTML = `
        <p class="kicker">Orbit Punch Prototype</p>
        <h1>${title}</h1>
        <p class="summary">${summary}</p>
        <button id="start-button" type="button">${button}</button>
      `;
      this.hud.startButton = panel.querySelector("#start-button") as HTMLButtonElement;
      this.hud.startButton.addEventListener("click", () => this.handleOverlayAction());
    }
    this.overlayAction = action;
    this.hud.overlay.classList.remove("hidden");
  }

  private showTutorialOverlay(): void {
    const snapshot = this.sim.snapshot();
    if (snapshot.gameOver) {
      return;
    }
    const shouldPauseGame = !snapshot.gameOver && !this.scene.isPaused();
    this.cancelFire();
    if (shouldPauseGame) {
      this.scene.pause();
    }

    const panel = this.hud.overlay.querySelector(".panel");
    if (panel) {
      panel.classList.remove("upgrade-panel");
      panel.classList.add("tutorial-panel");
      panel.innerHTML = `
        <p class="kicker">Tutorial</p>
        <h1>チュートリアル</h1>
        <div class="tutorial-content">
          <section class="tutorial-section" aria-labelledby="tutorial-controls">
            <h2 id="tutorial-controls">操作方法</h2>
            <ul>
              <li><strong>Space / Click / Tap</strong> で外向きパンチを構え、離すと発射します。</li>
              <li>長押しするとチャージパンチになり、威力と速度が上がります。</li>
              <li>衛星は惑星の周りを自動で回ります。正面に脅威が来るタイミングで撃ちましょう。</li>
              <li><strong>Esc</strong> でポーズできます。脅威同士をぶつけるとチェーンが伸び、惑星HPが少し回復します。</li>
            </ul>
          </section>
          <section class="tutorial-section" aria-labelledby="tutorial-gameover">
            <h2 id="tutorial-gameover">ゲームオーバー</h2>
            <p>脅威が惑星に衝突すると PLANET が減ります。PLANET が 0 になるとゲームオーバーです。衛星本体にぶつかった脅威は弾けますが、パンチのクールダウンと短い無敵時間が発生します。</p>
          </section>
          <section class="tutorial-section" aria-labelledby="tutorial-threats">
            <h2 id="tutorial-threats">脅威</h2>
            <div class="threat-guide" role="list">
              ${this.threatGuideHtml()}
            </div>
          </section>
        </div>
        <button id="start-button" type="button">Close</button>
      `;
      this.hud.startButton = panel.querySelector("#start-button") as HTMLButtonElement;
      this.hud.startButton.addEventListener("click", () => this.handleOverlayAction());
    }

    this.overlayAction = () => {
      this.hideOverlay();
      if (shouldPauseGame) {
        this.scene.resume();
      }
    };
    this.hud.overlay.classList.remove("hidden");
  }

  private threatGuideHtml(): string {
    const threats = [
      {
        name: "Meteor",
        image: THREAT_TEXTURE_URLS.meteor,
        damage: "18",
        text: "まっすぐ惑星へ向かう基本脅威。パンチで外へ弾き返し、別の脅威へ当てるチェーンの起点にしやすい相手です。"
      },
      {
        name: "Orbital Satellite",
        image: THREAT_TEXTURE_URLS.orbitalSatellite,
        damage: "16",
        text: "惑星の周辺を横切る人工衛星。軌道がずれるので、接近角度を見て早めにパンチを合わせる必要があります。"
      },
      {
        name: "Explosive Core",
        image: THREAT_TEXTURE_URLS.explosiveCore,
        damage: "32",
        text: "破壊時に爆発し、周囲の脅威を巻き込みます。うまく使うと大きなチェーンと回復につながります。"
      },
      {
        name: "Tractor Drone",
        image: THREAT_TEXTURE_URLS.tractorDrone,
        damage: "20",
        text: "牽引ビームで周囲の脅威の進行方向を惑星側へ曲げます。残すほど盤面が崩れやすくなります。"
      },
      {
        name: "Mini Boss",
        image: THREAT_TEXTURE_URLS.miniBoss,
        damage: "38",
        text: "HPを持つ大型脅威。パンチやチェーン衝突を複数回当てて倒します。衝突ダメージが高いので優先して対処しましょう。"
      }
    ];

    return threats
      .map(
        (threat) => `
          <article class="threat-card" role="listitem">
            <span class="threat-art" aria-hidden="true">
              <img src="${threat.image}" alt="" loading="eager" />
            </span>
            <h3>${threat.name}</h3>
            <span class="threat-damage">Planet damage ${threat.damage}</span>
            <p>${threat.text}</p>
          </article>
        `
      )
      .join("");
  }

  private handleOverlayAction(): void {
    this.overlayAction?.();
  }

  private hideOverlay(): void {
    this.hud.overlay.classList.add("hidden");
    this.overlayAction = undefined;
  }

  private showUpgradeOverlay(wave: number): void {
    this.cancelFire();
    this.scene.pause();

    const panel = this.hud.overlay.querySelector(".panel");
    if (panel) {
      const choices = this.sim.upgradeChoices(3);
      const gridClass =
        choices.length === 1 ? "upgrade-grid upgrade-grid-single" : "upgrade-grid";
      panel.classList.add("upgrade-panel");
      panel.innerHTML = `
        <p class="kicker">Satellite Upgrade</p>
        <h1>Wave ${wave}</h1>
        <p class="summary">Choose one upgrade to continue.</p>
        <div class="${gridClass}" role="list" aria-label="Upgrade choices">
          ${choices.map((choice) => this.upgradeChoiceHtml(choice)).join("")}
        </div>
      `;

      for (const button of panel.querySelectorAll<HTMLButtonElement>("[data-upgrade-id]")) {
        button.addEventListener("click", () => {
          this.sim.applyUpgrade(button.dataset.upgradeId as UpgradeId);
          this.render(this.sim.snapshot(), 0);
          this.hideOverlay();
          this.scene.resume();
        });
      }
    }
    this.overlayAction = undefined;
    this.hud.overlay.classList.remove("hidden");
  }

  private upgradeChoiceHtml(choice: UpgradeChoice): string {
    return `
      <button class="upgrade-choice" type="button" data-upgrade-id="${choice.id}" role="listitem">
        <span class="upgrade-art" aria-hidden="true">
          <img src="${UPGRADE_ART_URLS[choice.id]}" alt="" loading="eager" />
        </span>
        <span class="upgrade-name">${choice.title}</span>
        <span class="upgrade-description">${choice.description}</span>
      </button>
    `;
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

  private spawnExplosionRing(explosion: ExplosionBlast): void {
    this.explosionRings.push({
      pos: { ...explosion.pos },
      radius: explosion.radius,
      life: EXPLOSION_RING_LIFE,
      maxLife: EXPLOSION_RING_LIFE
    });
  }

  private render(snapshot: SimulationSnapshot, dt: number): void {
    this.updateHud(snapshot);
    this.updateCamera(dt);

    this.graphics.clear();
    this.overlayGraphics.clear();
    this.drawStarfield();
    this.drawOrbit(snapshot);
    this.drawPlanet(snapshot);
    this.drawPunches(snapshot);
    this.drawThreats(snapshot);
    this.drawExplosionRings(dt);
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

    for (const star of this.stars) {
      this.graphics.fillStyle(palette.star, star.alpha);
      this.graphics.fillCircle(star.x, star.y, star.radius);
    }
  }

  private drawOrbit(snapshot: SimulationSnapshot): void {
    this.graphics.lineStyle(2, palette.orbit, 0.24);
    this.graphics.strokeCircle(world.center.x, world.center.y, world.orbitRadius);

    this.graphics.lineStyle(1, palette.orbit, 0.12);
    this.graphics.strokeCircle(world.center.x, world.center.y, snapshot.punchReachRadius);

  }

  private drawPlanet(snapshot: SimulationSnapshot): void {
    const hpRatio = snapshot.planetHp / snapshot.maxPlanetHp;
    this.graphics.fillStyle(palette.shield, 0.1 + hpRatio * 0.16);
    this.graphics.fillCircle(world.center.x, world.center.y, world.planetRadius + 16);
    this.graphics.lineStyle(2, palette.shield, 0.18 + hpRatio * 0.44);
    this.graphics.strokeCircle(world.center.x, world.center.y, world.planetRadius + 15);

    const planetDisplaySize = (world.planetRadius * 2) / PLANET_VISIBLE_WIDTH_RATIO;
    this.planetImage
      .setVisible(true)
      .setPosition(world.center.x, world.center.y)
      .setDisplaySize(planetDisplaySize, planetDisplaySize);

    if (hpRatio < 0.35) {
      this.overlayGraphics.lineStyle(2, palette.danger, 0.5);
      this.overlayGraphics.beginPath();
      this.overlayGraphics.moveTo(world.center.x - 24, world.center.y - 18);
      this.overlayGraphics.lineTo(world.center.x + 12, world.center.y + 5);
      this.overlayGraphics.lineTo(world.center.x - 8, world.center.y + 33);
      this.overlayGraphics.strokePath();
    }
  }

  private drawThreats(snapshot: SimulationSnapshot): void {
    this.drawTractorLinks(snapshot);
    this.ensureImagePool(
      this.threatImages,
      snapshot.meteors.length,
      THREAT_TEXTURE_KEYS.meteor,
      2
    );
    this.hideImagePool(this.threatImages);

    for (let i = 0; i < snapshot.meteors.length; i += 1) {
      const meteor = snapshot.meteors[i];
      if (!meteor.alive) {
        continue;
      }

      this.drawThreatBackgroundEffects(meteor);
      const image = this.threatImages[i];
      image
        .setVisible(true)
        .setTexture(THREAT_TEXTURE_KEYS[meteor.kind])
        .setPosition(meteor.pos.x, meteor.pos.y)
        .setRotation(this.threatRotation(meteor))
        .setDisplaySize(this.threatDisplaySize(meteor), this.threatDisplaySize(meteor))
        .setAlpha(1);
      this.applyThreatTint(image, meteor);
      this.drawThreatForegroundEffects(meteor);
    }
  }

  private drawThreatBackgroundEffects(meteor: Meteor): void {
    if (meteor.kind === "meteor") {
      this.graphics.fillStyle(meteor.knocked ? palette.punch : palette.meteorEdge, 0.22);
      this.graphics.fillCircle(meteor.pos.x, meteor.pos.y, meteor.radius + 4);
      return;
    }

    if (meteor.kind === "orbitalSatellite") {
      return;
    }

    if (meteor.kind === "explosiveCore") {
      const pulse = 0.5 + Math.sin(meteor.spin * 2.4) * 0.5;
      this.graphics.fillStyle(palette.explosiveGlow, 0.18 + pulse * 0.18);
      this.graphics.fillCircle(meteor.pos.x, meteor.pos.y, meteor.radius + 13 + pulse * 5);
      this.graphics.lineStyle(2, meteor.knocked ? palette.punch : palette.explosiveCore, 0.52);
      this.graphics.strokeCircle(meteor.pos.x, meteor.pos.y, meteor.radius + 8);
      return;
    }

    if (meteor.kind === "tractorDrone") {
      this.graphics.lineStyle(2, meteor.knocked ? palette.punch : palette.tractorDrone, 0.45);
      this.graphics.strokeCircle(meteor.pos.x, meteor.pos.y, meteor.radius + 6);
      return;
    }

    const hpRatio = Math.max(0, meteor.hp / meteor.maxHp);
    this.graphics.fillStyle(palette.miniBoss, 0.18);
    this.graphics.fillCircle(meteor.pos.x, meteor.pos.y, meteor.radius + 13);
    this.graphics.lineStyle(3, palette.miniBoss, meteor.knocked ? 0.22 : 0.68);
    this.graphics.strokeCircle(meteor.pos.x, meteor.pos.y, meteor.radius + 8);

    this.overlayGraphics.lineStyle(5, 0x25143f, 0.82);
    this.overlayGraphics.beginPath();
    this.overlayGraphics.arc(meteor.pos.x, meteor.pos.y, meteor.radius + 15, -Math.PI / 2, Math.PI * 1.5);
    this.overlayGraphics.strokePath();

    this.overlayGraphics.lineStyle(5, palette.miniBossCore, 0.95);
    this.overlayGraphics.beginPath();
    this.overlayGraphics.arc(
      meteor.pos.x,
      meteor.pos.y,
      meteor.radius + 15,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * hpRatio
    );
    this.overlayGraphics.strokePath();
  }

  private drawThreatForegroundEffects(meteor: Meteor): void {
    if (meteor.kind !== "explosiveCore") {
      return;
    }

    this.overlayGraphics.lineStyle(3, 0xffffff, 0.5);
    for (let i = 0; i < 3; i += 1) {
      const angle = meteor.spin + (i * Math.PI * 2) / 3;
      this.overlayGraphics.beginPath();
      this.overlayGraphics.moveTo(meteor.pos.x, meteor.pos.y);
      this.overlayGraphics.lineTo(
        meteor.pos.x + Math.cos(angle) * meteor.radius * 0.9,
        meteor.pos.y + Math.sin(angle) * meteor.radius * 0.9
      );
      this.overlayGraphics.strokePath();
    }
  }

  private drawTractorLinks(snapshot: SimulationSnapshot): void {
    for (const drone of snapshot.meteors) {
      if (!drone.alive || drone.knocked || drone.kind !== "tractorDrone") {
        continue;
      }

      this.graphics.lineStyle(1, palette.tractorBeam, 0.12);
      this.graphics.strokeCircle(drone.pos.x, drone.pos.y, TRACTOR_RANGE);

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
        this.graphics.lineStyle(1, palette.tractorBeam, alpha * 0.55);
        this.graphics.beginPath();
        this.graphics.moveTo(drone.pos.x, drone.pos.y);
        this.graphics.lineTo(target.pos.x, target.pos.y);
        this.graphics.strokePath();
      }
    }
  }

  private threatDisplaySize(meteor: Meteor): number {
    const visibleWidth =
      meteor.kind === "meteor"
        ? (meteor.radius + 4) * 2
        : meteor.kind === "orbitalSatellite"
          ? meteor.radius * 3.2
          : meteor.kind === "explosiveCore"
            ? (meteor.radius + 18) * 2
            : meteor.kind === "tractorDrone"
              ? (meteor.radius + 10) * 2
              : (meteor.radius + 15) * 2;
    return visibleWidth / THREAT_VISIBLE_WIDTH_RATIOS[meteor.kind];
  }

  private threatRotation(meteor: Meteor): number {
    return meteor.kind === "miniBoss" ? meteor.spin * 0.45 : meteor.spin;
  }

  private applyThreatTint(image: Phaser.GameObjects.Image, meteor: Meteor): void {
    if (!meteor.knocked) {
      image.clearTint();
      return;
    }

    image.setTint(palette.punch);
  }

  private drawPlayer(snapshot: SimulationSnapshot): void {
    const pos = snapshot.playerPos;
    const angle = snapshot.playerAngle;
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

    this.playerImage
      .setVisible(true)
      .setPosition(pos.x, pos.y)
      .setRotation(angle)
      .setDisplaySize(PLAYER_DISPLAY_SIZE, PLAYER_DISPLAY_SIZE)
      .setAlpha(blinkAlpha);
  }

  private drawPunches(snapshot: SimulationSnapshot): void {
    this.ensureImagePool(this.punchImages, snapshot.punches.length, PUNCH_TEXTURE_KEY, 4);
    this.hideImagePool(this.punchImages);

    const chainSegmentCount = snapshot.punches.reduce(
      (count, punch) => count + Math.max(0, this.punchChainPoints(punch).length - 1),
      0
    );
    this.ensureImagePool(this.chainImages, chainSegmentCount, CHAIN_TEXTURE_KEY, 3);
    this.hideImagePool(this.chainImages);

    let chainImageIndex = 0;
    for (let punchIndex = 0; punchIndex < snapshot.punches.length; punchIndex += 1) {
      const punch = snapshot.punches[punchIndex];
      const alpha = Math.max(0, punch.life / punch.maxLife);
      const angle = Math.atan2(punch.direction.y, punch.direction.x);
      const chainPoints = this.punchChainPoints(punch);

      for (let i = 0; i < chainPoints.length - 1; i += 1) {
        const from = chainPoints[i];
        const to = chainPoints[i + 1];
        const segmentLength = Phaser.Math.Distance.Between(from.x, from.y, to.x, to.y);
        const segmentAngle = Math.atan2(to.y - from.y, to.x - from.x);
        const chainImage = this.chainImages[chainImageIndex];
        chainImageIndex += 1;
        chainImage
          .setVisible(true)
          .setPosition((from.x + to.x) * 0.5, (from.y + to.y) * 0.5)
          .setRotation(segmentAngle)
          .setDisplaySize(Math.max(24, segmentLength + CHAIN_LINK_PADDING), CHAIN_LINK_HEIGHT)
          .setAlpha(0.88 * alpha);
      }

      const targetVisibleWidth = punch.radius * 1.95;
      const punchDisplaySize = targetVisibleWidth / PUNCH_VISIBLE_WIDTH_RATIO;
      this.punchImages[punchIndex]
        .setVisible(true)
        .setPosition(punch.pos.x, punch.pos.y)
        .setRotation(angle)
        .setDisplaySize(punchDisplaySize, punchDisplaySize)
        .setAlpha(alpha);

      if (punch.phase === "holding") {
        this.overlayGraphics.lineStyle(punch.charged ? 4 : 2, 0xffffff, punch.charged ? 0.58 : 0.34);
        this.overlayGraphics.strokeCircle(
          punch.pos.x,
          punch.pos.y,
          punch.radius + (punch.charged ? 16 : 11)
        );
      }
    }
  }

  private punchChainPoints(punch: Punch): Vec2[] {
    if (punch.chainPoints.length >= 2) {
      return punch.chainPoints;
    }

    return [
      punch.origin,
      {
        x: punch.pos.x - punch.direction.x * 20,
        y: punch.pos.y - punch.direction.y * 20
      }
    ];
  }

  private ensureImagePool(
    pool: Phaser.GameObjects.Image[],
    count: number,
    textureKey: string,
    depth: number
  ): void {
    for (const image of pool) {
      image.setDepth(depth);
    }

    while (pool.length < count) {
      pool.push(this.add.image(0, 0, textureKey).setOrigin(0.5).setDepth(depth).setVisible(false));
    }
  }

  private hideImagePool(pool: Phaser.GameObjects.Image[]): void {
    for (const image of pool) {
      image.setVisible(false);
    }
  }

  private drawExplosionRings(dt: number): void {
    for (const ring of this.explosionRings) {
      const progress = 1 - ring.life / ring.maxLife;
      const alpha = Phaser.Math.Clamp(ring.life / ring.maxLife, 0, 1);
      const shockRadius = Phaser.Math.Linear(ring.radius * 0.18, ring.radius, progress);
      const boundaryAlpha = 0.18 + alpha * 0.46;

      this.graphics.fillStyle(palette.explosiveGlow, 0.05 * alpha);
      this.graphics.fillCircle(ring.pos.x, ring.pos.y, ring.radius);

      this.overlayGraphics.lineStyle(5, palette.explosiveCore, boundaryAlpha);
      this.overlayGraphics.strokeCircle(ring.pos.x, ring.pos.y, ring.radius);
      this.overlayGraphics.lineStyle(2, 0xffffff, 0.24 * alpha);
      this.overlayGraphics.strokeCircle(ring.pos.x, ring.pos.y, ring.radius + 3);

      this.overlayGraphics.lineStyle(3, palette.explosiveGlow, 0.62 * alpha);
      this.overlayGraphics.strokeCircle(ring.pos.x, ring.pos.y, shockRadius);

      const tickLength = 12;
      this.overlayGraphics.lineStyle(3, 0xffffff, 0.28 * alpha);
      for (let i = 0; i < 8; i += 1) {
        const angle = (i * Math.PI * 2) / 8;
        const innerRadius = ring.radius - tickLength;
        const outerRadius = ring.radius + tickLength * 0.35;
        this.overlayGraphics.beginPath();
        this.overlayGraphics.moveTo(
          ring.pos.x + Math.cos(angle) * innerRadius,
          ring.pos.y + Math.sin(angle) * innerRadius
        );
        this.overlayGraphics.lineTo(
          ring.pos.x + Math.cos(angle) * outerRadius,
          ring.pos.y + Math.sin(angle) * outerRadius
        );
        this.overlayGraphics.strokePath();
      }

      ring.life -= dt;
    }

    this.explosionRings = this.explosionRings.filter((ring) => ring.life > 0);
  }

  private drawSparks(snapshot: SimulationSnapshot): void {
    for (const spark of snapshot.sparks) {
      const alpha = Math.max(0, spark.life / spark.maxLife);
      this.overlayGraphics.lineStyle(3, palette.player, alpha);
      this.overlayGraphics.strokeCircle(spark.pos.x, spark.pos.y, 34 * (1 - alpha) + 6);
      this.overlayGraphics.fillStyle(0xffffff, alpha);
      this.overlayGraphics.fillCircle(spark.pos.x, spark.pos.y, 4 + 12 * (1 - alpha));
    }
  }
}
