import { closestPointOnSegment, distance, length, normalize, radialPoint } from "./math";
import { damageThreatByImpact, explodeCore, planetDamage } from "./threats/effects";
import {
  CHAIN_KNOCK_SPEED,
  EXPLOSION_RADIUS,
  MINI_BOSS_HIT_COOLDOWN,
  PUNCH_KNOCK_SPEED
} from "./threats/config";
import { applyTractorPull, updateThreat } from "./threats/update";
import { spawnScheduledMiniBoss, spawnThreat } from "./threats/spawn";
import {
  defeatBonusForThreat,
  hasMiniBossForWave,
  rollSpawnIntervalForWave,
  scoreForThreat
} from "./threats/waveConfig";
import type {
  ChainHit,
  HitSpark,
  Meteor,
  Punch,
  SimulationEvents,
  SimulationSnapshot,
  Vec2
} from "./types";
import {
  createUpgradeLevels,
  romanLevel,
  upgradeConfig,
  upgradeDefinitionById,
  upgradeDefinitions,
  type UpgradeChoice,
  type UpgradeEffect,
  type UpgradeId
} from "./upgrades";
import { CENTER, ORBIT_RADIUS, OUTER_RADIUS, PLANET_RADIUS, SATELLITE_RADIUS } from "./world";

export type {
  ChainHit,
  HitSpark,
  Meteor,
  Punch,
  SimulationEvents,
  SimulationSnapshot,
  ThreatKind,
  Vec2
} from "./types";
export type { UpgradeChoice, UpgradeId } from "./upgrades";
export { world } from "./world";

const PLAYER_ORBIT_SPEED = 1.95;
const PUNCH_EXTEND_SPEED = 480;
const PUNCH_RETURN_SPEED = 560;
const PUNCH_RANGE = 120;
const PUNCH_HOLD_TIME = 0.24;
const PUNCH_COOLDOWN = 0.56;
const PUNCH_RETURN_EPSILON = 6;
const PUNCH_CHAIN_SEGMENTS = 8;
const PUNCH_FIST_DRAG = 0.88;
const PUNCH_RETURN_SPRING = 42;
const PUNCH_RETURN_DAMPING = 8.5;
const PUNCH_RETURN_REEL_ACCELERATION = 2200;
const PUNCH_TETHER_REBOUND = 0.16;
const PUNCH_LAUNCH_GUIDE_TIME = 0.32;
const PUNCH_LAUNCH_GUIDE_STRENGTH = 18;
const PUNCH_LAUNCH_LATERAL_DAMPING = 0.72;
const CHARGE_START_THRESHOLD = 0.08;
const CHARGE_ORBIT_SPEED_MULTIPLIER = 0.5;
const CHARGE_PUNCH_SPEED_MULTIPLIER = 2;
const CHARGE_PUNCH_DAMAGE_MULTIPLIER = 2;
const SATELLITE_KNOCK_SPEED = 250;
const SATELLITE_HIT_LOCKOUT = 1.35;
const SATELLITE_INVULNERABILITY = 1.35;
const PUNCH_CHAIN_RADIUS = 9;
const MAX_PLANET_HP = 100;
const CHAIN_SHIELD_RECOVERY = 4;
const MAX_CHAIN_SHIELD_RECOVERY = 12;
const MINI_BOSS_ENTRY_DELAY = 10;

let nextId = 1;

export class OrbitPunchSimulation {
  private playerAngle = -Math.PI / 2;
  private meteors: Meteor[] = [];
  private punches: Punch[] = [];
  private sparks: HitSpark[] = [];
  private chainTreeSizes = new Map<number, number>();
  private spawnTimer = 0.85;
  private cooldown = 0;
  private fireHeld = false;
  private chargeTimer = 0;
  private chargeActive = false;
  private chargeCanceled = false;
  private satelliteInvulnerability = 0;
  private score = 0;
  private wave = 1;
  private defeated = 0;
  private miniBossWave = 0;
  private miniBossSpawnTimer = Number.POSITIVE_INFINITY;
  private miniBossScheduledWave = 0;
  private planetHp = MAX_PLANET_HP;
  private upgradeLevels = createUpgradeLevels();
  private orbitalShieldCooldown = 0;
  private overdriveTimer = 0;
  private starburstCooldown = 0;
  private twinPunchSide: -1 | 1 = 1;
  private gameOver = true;

  public start(): void {
    this.playerAngle = -Math.PI / 2;
    this.meteors = [];
    this.punches = [];
    this.sparks = [];
    this.chainTreeSizes = new Map();
    this.spawnTimer = 0.55;
    this.cooldown = 0;
    this.fireHeld = false;
    this.chargeTimer = 0;
    this.chargeActive = false;
    this.chargeCanceled = false;
    this.satelliteInvulnerability = 0;
    this.score = 0;
    this.wave = 1;
    this.defeated = 0;
    this.miniBossWave = 0;
    this.miniBossSpawnTimer = Number.POSITIVE_INFINITY;
    this.miniBossScheduledWave = 0;
    this.scheduleMiniBossForCurrentWave();
    this.planetHp = MAX_PLANET_HP;
    this.upgradeLevels = createUpgradeLevels();
    this.orbitalShieldCooldown = 0;
    this.overdriveTimer = 0;
    this.starburstCooldown = 0;
    this.twinPunchSide = 1;
    this.gameOver = false;
  }

  public pressFire(): boolean {
    if (this.gameOver || this.cooldown > 0 || this.fireHeld) {
      return false;
    }

    this.fireHeld = true;
    this.chargeTimer = 0;
    this.chargeActive = false;
    this.chargeCanceled = false;
    return true;
  }

  public releaseFire(): { fired: boolean; charged: boolean } {
    if (!this.fireHeld) {
      return { fired: false, charged: false };
    }

    const charged = this.chargeActive;
    const canFire = !this.gameOver && !this.chargeCanceled && this.cooldown <= 0;
    this.fireHeld = false;
    this.chargeTimer = 0;
    this.chargeActive = false;
    this.chargeCanceled = false;

    if (!canFire) {
      return { fired: false, charged: false };
    }

    this.createPunch(charged);
    this.createTwinPunch(charged);
    this.cooldown = this.currentPunchCooldown();
    return { fired: true, charged };
  }

  public cancelFire(): void {
    this.fireHeld = false;
    this.chargeTimer = 0;
    this.chargeActive = false;
    this.chargeCanceled = false;
  }

  public upgradeChoices(count = upgradeConfig.selectionCount): UpgradeChoice[] {
    return upgradeDefinitions
      .filter((definition) => this.canSelectUpgrade(definition.id))
      .map((definition, index) => ({
        definition,
        sort: this.upgradeSortValue(index)
      }))
      .sort((first, second) => first.sort - second.sort)
      .slice(0, count)
      .map(({ definition }) => this.toUpgradeChoice(definition.id));
  }

  public applyUpgrade(upgradeId: UpgradeId): { applied: boolean; recovered: number } {
    if (!this.canSelectUpgrade(upgradeId)) {
      return { applied: false, recovered: 0 };
    }

    const definition = upgradeDefinitionById(upgradeId);
    if (!definition) {
      return { applied: false, recovered: 0 };
    }

    if (definition.kind === "instant") {
      return {
        applied: true,
        recovered: this.recoverPlanetHp(this.effectValue(upgradeId, "recovery"))
      };
    }

    this.upgradeLevels[upgradeId] = Math.min(
      definition.maxLevel,
      this.upgradeLevels[upgradeId] + 1
    );
    return { applied: true, recovered: 0 };
  }

  private createPunch(
    charged: boolean,
    angle = this.playerAngle,
    options: {
      rangeMultiplier?: number;
      radiusMultiplier?: number;
      damageMultiplier?: number;
      knockSpeedMultiplier?: number;
    } = {}
  ): void {
    const speedMultiplier =
      (charged ? CHARGE_PUNCH_SPEED_MULTIPLIER : 1) * this.currentPunchSpeedMultiplier();
    const damageMultiplier =
      (charged ? CHARGE_PUNCH_DAMAGE_MULTIPLIER : 1) * (options.damageMultiplier ?? 1);
    const origin = radialPoint(angle, ORBIT_RADIUS + 21);
    const direction = normalize({ x: origin.x - CENTER.x, y: origin.y - CENTER.y });
    this.punches.push({
      id: nextId++,
      orbitAngleOffset: angle - this.playerAngle,
      origin,
      originVel: { x: 0, y: 0 },
      pos: origin,
      vel: {
        x: direction.x * PUNCH_EXTEND_SPEED * speedMultiplier,
        y: direction.y * PUNCH_EXTEND_SPEED * speedMultiplier
      },
      direction,
      chainPoints: Array.from({ length: PUNCH_CHAIN_SEGMENTS }, () => ({ ...origin })),
      chainTime: 0,
      radius: this.currentPunchRadius() * (options.radiusMultiplier ?? 1),
      distance: 0,
      maxDistance: this.currentPunchRange() * (options.rangeMultiplier ?? 1),
      hold: PUNCH_HOLD_TIME,
      life: 1,
      maxLife: 1,
      extendSpeed: PUNCH_EXTEND_SPEED * speedMultiplier,
      returnSpeed: PUNCH_RETURN_SPEED * speedMultiplier,
      damageMultiplier,
      knockSpeedMultiplier:
        speedMultiplier * this.currentKnockSpeedMultiplier() * (options.knockSpeedMultiplier ?? 1),
      charged,
      hasHit: false,
      phase: "extending"
    });
  }

  private createTwinPunch(charged: boolean): void {
    if (!this.hasUpgrade("twinPunch")) {
      return;
    }

    const effect = this.currentUpgradeEffect("twinPunch");
    const angleOffset =
      ((effect.angleOffsetDegrees ?? 0) * Math.PI * this.twinPunchSide) / 180;
    this.twinPunchSide = this.twinPunchSide === 1 ? -1 : 1;
    this.createPunch(charged, this.playerAngle + angleOffset, {
      rangeMultiplier: effect.rangeMultiplier,
      radiusMultiplier: effect.radiusMultiplier,
      damageMultiplier: effect.damageMultiplier,
      knockSpeedMultiplier: effect.knockSpeedMultiplier
    });
  }

  public update(dt: number): SimulationEvents {
    const startedWave = this.wave;
    const events: SimulationEvents = {
      hit: false,
      satelliteHit: false,
      planetHit: false,
      gameOver: false,
      chainHits: []
    };
    if (this.gameOver) {
      return events;
    }

    this.updateCharge(dt);
    const isCharging = this.chargeActive && !this.chargeCanceled;
    const orbitSpeed =
      PLAYER_ORBIT_SPEED *
      this.currentOrbitSpeedMultiplier() *
      (isCharging ? CHARGE_ORBIT_SPEED_MULTIPLIER : 1);
    this.playerAngle += orbitSpeed * dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.satelliteInvulnerability = Math.max(0, this.satelliteInvulnerability - dt);
    this.orbitalShieldCooldown = Math.max(0, this.orbitalShieldCooldown - dt);
    this.overdriveTimer = Math.max(0, this.overdriveTimer - dt);
    this.starburstCooldown = Math.max(0, this.starburstCooldown - dt);
    this.spawnTimer -= dt;
    this.miniBossSpawnTimer -= dt;

    if (this.spawnTimer <= 0) {
      const spawned = spawnThreat({
        wave: this.wave,
        defeated: this.defeated,
        nextId: () => nextId++
      });
      this.meteors.push(spawned.threat);
      this.spawnTimer = rollSpawnIntervalForWave(this.wave);
    }

    if (this.miniBossSpawnTimer <= 0 && this.miniBossScheduledWave === this.wave) {
      const spawned = spawnScheduledMiniBoss({
        wave: this.wave,
        defeated: this.defeated,
        nextId: () => nextId++
      });
      this.meteors.push(spawned.threat);
      this.miniBossWave = this.wave;
      this.miniBossSpawnTimer = Number.POSITIVE_INFINITY;
      this.miniBossScheduledWave = 0;
    }

    this.updatePunches(dt);
    applyTractorPull(this.meteors, this.wave, dt);

    for (const meteor of this.meteors) {
      updateThreat(meteor, dt);
      this.applyHomingKnockback(meteor, dt);
      meteor.spin += dt * 4;
      meteor.hitCooldown = Math.max(0, (meteor.hitCooldown ?? 0) - dt);
    }

    this.resolveHits(events);
    this.resolveSatelliteImpacts(events);
    this.resolveMeteorImpacts(events);
    this.resolvePlanetImpacts(events);

    this.punches = this.punches.filter(
      (punch) => punch.phase !== "returning" || punch.distance > PUNCH_RETURN_EPSILON
    );
    this.meteors = this.meteors.filter(
      (meteor) => meteor.alive && distance(meteor.pos, CENTER) < OUTER_RADIUS + 90
    );

    for (const spark of this.sparks) {
      spark.life -= dt;
    }
    this.sparks = this.sparks.filter((spark) => spark.life > 0);

    if (this.planetHp <= 0) {
      this.planetHp = 0;
      this.gameOver = true;
      events.gameOver = true;
    }

    if (!events.gameOver && this.wave > startedWave) {
      events.waveAdvanced = {
        from: startedWave,
        to: this.wave
      };
    }

    return events;
  }

  public snapshot(): SimulationSnapshot {
    return {
      playerAngle: this.playerAngle,
      playerPos: radialPoint(this.playerAngle, ORBIT_RADIUS),
      meteors: this.meteors,
      punches: this.punches,
      sparks: this.sparks,
      score: this.score,
      wave: this.wave,
      planetHp: this.planetHp,
      maxPlanetHp: MAX_PLANET_HP,
      cooldown: this.cooldown,
      cooldownMax:
        this.cooldown > this.currentPunchCooldown()
          ? this.currentSatelliteHitLockout()
          : this.currentPunchCooldown(),
      charge: {
        held: this.fireHeld,
        active: this.chargeActive,
        canceled: this.chargeCanceled,
        progress: Math.min(1, this.chargeTimer / CHARGE_START_THRESHOLD)
      },
      satelliteInvulnerability: this.satelliteInvulnerability,
      gameOver: this.gameOver
    };
  }

  private updateCharge(dt: number): void {
    if (!this.fireHeld || this.chargeCanceled) {
      return;
    }

    this.chargeTimer += dt;
    if (this.chargeTimer >= CHARGE_START_THRESHOLD) {
      this.chargeActive = true;
    }
  }

  private updatePunches(dt: number): void {
    for (const punch of this.punches) {
      const currentOrigin = radialPoint(
        this.playerAngle + punch.orbitAngleOffset,
        ORBIT_RADIUS + 21
      );
      const originVelocity =
        dt > 0
          ? {
              x: (currentOrigin.x - punch.origin.x) / dt,
              y: (currentOrigin.y - punch.origin.y) / dt
            }
          : { x: 0, y: 0 };
      punch.origin = { ...currentOrigin };
      punch.originVel = originVelocity;
      punch.chainTime += dt;

      if (punch.phase === "extending") {
        const frontDirection = normalize({
          x: punch.origin.x - CENTER.x,
          y: punch.origin.y - CENTER.y
        });
        const guideRatio = Math.max(0, 1 - punch.chainTime / PUNCH_LAUNCH_GUIDE_TIME);
        const thrust = punch.extendSpeed * 7.5;
        const thrustDirection = guideRatio > 0 ? frontDirection : punch.direction;
        punch.vel.x += thrustDirection.x * thrust * dt;
        punch.vel.y += thrustDirection.y * thrust * dt;
        this.limitPunchSpeed(punch, punch.extendSpeed * 1.28);
        this.applyPunchDrag(punch, dt, 0.2);
        punch.pos.x += punch.vel.x * dt;
        punch.pos.y += punch.vel.y * dt;
        if (guideRatio > 0) {
          this.guidePunchLaunch(punch, frontDirection, guideRatio, dt);
        }
        this.constrainPunchTether(punch);
        this.updatePunchDirection(punch);

        if (punch.distance >= punch.maxDistance - 1) {
          punch.phase = "holding";
        }
      } else if (punch.phase === "holding") {
        punch.hold -= dt;
        this.applyPunchDrag(punch, dt, 1.15);
        punch.pos.x += punch.vel.x * dt;
        punch.pos.y += punch.vel.y * dt;
        this.constrainPunchTether(punch);
        this.updatePunchDirection(punch);

        if (punch.hold <= 0) {
          punch.phase = "returning";
        }
      } else {
        const toOrigin = {
          x: punch.origin.x - punch.pos.x,
          y: punch.origin.y - punch.pos.y
        };
        const remaining = Math.hypot(toOrigin.x, toOrigin.y);

        if (remaining <= PUNCH_RETURN_EPSILON) {
          this.collectPunch(punch);
        } else {
          const spring = PUNCH_RETURN_SPRING * (punch.charged ? 1.16 : 1);
          const damping = PUNCH_RETURN_DAMPING * (punch.charged ? 1.08 : 1);
          const reelAcceleration = PUNCH_RETURN_REEL_ACCELERATION * (punch.charged ? 1.18 : 1);
          const returnDirection = normalize(toOrigin);
          const relativeVelocity = {
            x: punch.vel.x - punch.originVel.x,
            y: punch.vel.y - punch.originVel.y
          };
          punch.vel.x +=
            (toOrigin.x * spring +
              returnDirection.x * reelAcceleration -
              relativeVelocity.x * damping) *
            dt;
          punch.vel.y +=
            (toOrigin.y * spring +
              returnDirection.y * reelAcceleration -
              relativeVelocity.y * damping) *
            dt;
          this.limitPunchSpeedRelativeTo(punch, punch.returnSpeed * 1.9, punch.originVel);
          punch.pos.x += punch.vel.x * dt;
          punch.pos.y += punch.vel.y * dt;

          const nextToOrigin = {
            x: punch.origin.x - punch.pos.x,
            y: punch.origin.y - punch.pos.y
          };
          if (toOrigin.x * nextToOrigin.x + toOrigin.y * nextToOrigin.y <= 0) {
            this.collectPunch(punch);
          } else {
            this.updatePunchDirection(punch);
          }
        }
      }

      punch.life = punch.maxLife * Math.max(0.2, punch.distance / punch.maxDistance);
      this.updatePunchChain(punch);
    }
  }

  private applyPunchDrag(punch: Punch, dt: number, multiplier: number): void {
    const drag = Math.exp(-PUNCH_FIST_DRAG * multiplier * dt);
    punch.vel.x *= drag;
    punch.vel.y *= drag;
  }

  private limitPunchSpeed(punch: Punch, maxSpeed: number): void {
    const speed = length(punch.vel);
    if (speed <= maxSpeed || speed <= 0.001) {
      return;
    }

    const scale = maxSpeed / speed;
    punch.vel.x *= scale;
    punch.vel.y *= scale;
  }

  private limitPunchSpeedRelativeTo(punch: Punch, maxSpeed: number, referenceVelocity: Vec2): void {
    const relativeVelocity = {
      x: punch.vel.x - referenceVelocity.x,
      y: punch.vel.y - referenceVelocity.y
    };
    const speed = length(relativeVelocity);
    if (speed <= maxSpeed || speed <= 0.001) {
      return;
    }

    const scale = maxSpeed / speed;
    punch.vel.x = referenceVelocity.x + relativeVelocity.x * scale;
    punch.vel.y = referenceVelocity.y + relativeVelocity.y * scale;
  }

  private collectPunch(punch: Punch): void {
    punch.pos = { ...punch.origin };
    punch.vel = { x: 0, y: 0 };
    punch.distance = 0;
  }

  private guidePunchLaunch(
    punch: Punch,
    frontDirection: Vec2,
    guideRatio: number,
    dt: number
  ): void {
    const currentDistance = distance(punch.pos, punch.origin);
    const target = {
      x: punch.origin.x + frontDirection.x * currentDistance,
      y: punch.origin.y + frontDirection.y * currentDistance
    };
    const correction = Math.min(0.72, PUNCH_LAUNCH_GUIDE_STRENGTH * guideRatio * dt);
    punch.pos.x += (target.x - punch.pos.x) * correction;
    punch.pos.y += (target.y - punch.pos.y) * correction;

    const side = { x: -frontDirection.y, y: frontDirection.x };
    const lateralVelocity = punch.vel.x * side.x + punch.vel.y * side.y;
    punch.vel.x -= side.x * lateralVelocity * PUNCH_LAUNCH_LATERAL_DAMPING * guideRatio;
    punch.vel.y -= side.y * lateralVelocity * PUNCH_LAUNCH_LATERAL_DAMPING * guideRatio;
    punch.direction = frontDirection;
  }

  private constrainPunchTether(punch: Punch): void {
    const toFist = {
      x: punch.pos.x - punch.origin.x,
      y: punch.pos.y - punch.origin.y
    };
    const tetherDistance = length(toFist);
    if (tetherDistance <= punch.maxDistance || tetherDistance <= 0.001) {
      return;
    }

    const tetherNormal = normalize(toFist);
    punch.pos.x = punch.origin.x + tetherNormal.x * punch.maxDistance;
    punch.pos.y = punch.origin.y + tetherNormal.y * punch.maxDistance;

    const radialVelocity = punch.vel.x * tetherNormal.x + punch.vel.y * tetherNormal.y;
    if (radialVelocity > 0) {
      punch.vel.x -= tetherNormal.x * radialVelocity * (1 + PUNCH_TETHER_REBOUND);
      punch.vel.y -= tetherNormal.y * radialVelocity * (1 + PUNCH_TETHER_REBOUND);
    }
  }

  private updatePunchDirection(punch: Punch): void {
    const toFist = {
      x: punch.pos.x - punch.origin.x,
      y: punch.pos.y - punch.origin.y
    };
    punch.distance = length(toFist);
    if (punch.distance > 0.001) {
      punch.direction = normalize(toFist);
    }
  }

  private updatePunchChain(punch: Punch): void {
    if (punch.chainPoints.length !== PUNCH_CHAIN_SEGMENTS) {
      punch.chainPoints = Array.from({ length: PUNCH_CHAIN_SEGMENTS }, () => ({ ...punch.origin }));
    }

    const distanceRatio = Math.min(1, punch.distance / punch.maxDistance);
    const wristDistance = Math.min(20, punch.distance * 0.36);
    const wrist = {
      x: punch.pos.x - punch.direction.x * wristDistance,
      y: punch.pos.y - punch.direction.y * wristDistance
    };
    const side = { x: -punch.direction.y, y: punch.direction.x };
    const lateralVelocity = punch.vel.x * side.x + punch.vel.y * side.y;
    const slack = (1 - distanceRatio) * 18 + (punch.phase === "returning" ? 8 : 0);
    const velocityBow = Math.max(-20, Math.min(20, lateralVelocity * 0.035));

    for (let i = 0; i < punch.chainPoints.length; i += 1) {
      const t = i / (punch.chainPoints.length - 1);
      const linkSlack = Math.sin(t * Math.PI);
      const wave =
        linkSlack *
        (velocityBow + Math.sin(punch.chainTime * 15 + t * Math.PI * 2.2) * slack * 0.42);
      punch.chainPoints[i] = {
        x: punch.origin.x + (wrist.x - punch.origin.x) * t + side.x * wave,
        y: punch.origin.y + (wrist.y - punch.origin.y) * t + side.y * wave
      };
    }
  }

  private resolveHits(events: SimulationEvents): void {
    for (const punch of this.punches) {
      if (punch.hasHit) {
        continue;
      }

      for (const meteor of this.meteors) {
        if (!meteor.alive || meteor.knocked) {
          continue;
        }

        if (distance(punch.pos, meteor.pos) <= punch.radius + meteor.radius) {
          const hitApplied = this.hitThreat(meteor, punch);
          punch.hasHit = true;
          punch.phase = "returning";
          events.hit = events.hit || hitApplied;
          break;
        }

        let chainContact: Vec2 | undefined;
        const chainPoints =
          punch.chainPoints.length >= 2
            ? punch.chainPoints
            : [
                punch.origin,
                {
                  x: punch.pos.x - punch.direction.x * 20,
                  y: punch.pos.y - punch.direction.y * 20
                }
              ];
        for (let i = 0; i < chainPoints.length - 1; i += 1) {
          const closest = closestPointOnSegment(meteor.pos, chainPoints[i], chainPoints[i + 1]);
          if (distance(closest, meteor.pos) <= PUNCH_CHAIN_RADIUS + meteor.radius) {
            chainContact = closest;
            break;
          }
        }

        if (!chainContact) {
          continue;
        }

        const contactDirection = normalize({
          x: meteor.pos.x - chainContact.x,
          y: meteor.pos.y - chainContact.y
        });
        const fallbackDirection = normalize({
          x: meteor.pos.x - CENTER.x,
          y: meteor.pos.y - CENTER.y
        });
        const hitApplied = this.hitThreat(
          meteor,
          punch,
          length(contactDirection) > 0.001 ? contactDirection : fallbackDirection
        );
        punch.hasHit = true;
        punch.phase = "returning";
        events.hit = events.hit || hitApplied;
        break;
      }
    }
  }

  private hitThreat(meteor: Meteor, punch: Punch, direction?: Vec2): boolean {
    const outward = normalize({ x: meteor.pos.x - CENTER.x, y: meteor.pos.y - CENTER.y });
    const hitDirection = direction ?? outward;
    const perfectTiming = this.perfectTimingBonus(punch);
    if (meteor.kind === "miniBoss") {
      const damaged = this.damageMiniBoss(
        meteor,
        punch.damageMultiplier + perfectTiming.miniBossDamageBonus,
        55 + this.wave * 12 + perfectTiming.scoreBonus,
        MINI_BOSS_HIT_COOLDOWN
      );
      punch.phase = "returning";
      return damaged;
    }

    this.knockMeteor(
      meteor,
      hitDirection,
      (PUNCH_KNOCK_SPEED + this.wave * 18) *
        punch.knockSpeedMultiplier *
        perfectTiming.knockSpeedMultiplier,
      perfectTiming.scoreBonus
    );
    return true;
  }

  private resolveMeteorImpacts(events: SimulationEvents): void {
    for (let i = 0; i < this.meteors.length; i += 1) {
      const first = this.meteors[i];
      if (!first.alive) {
        continue;
      }

      for (let j = i + 1; j < this.meteors.length; j += 1) {
        const second = this.meteors[j];
        if (!second.alive || (!first.knocked && !second.knocked)) {
          continue;
        }

        const minDistance =
          first.radius +
          second.radius +
          (first.knocked || second.knocked
            ? this.effectValue("chainMagnet", "chainCollisionBonus")
            : 0);
        const actualDistance = distance(first.pos, second.pos);
        if (actualDistance > minDistance) {
          continue;
        }

        const explosive = this.pickExplosiveCore(first, second);
        if (explosive) {
          this.applyExplosion(explosive, events, Math.max(1, first.chain, second.chain));
          events.hit = true;
          continue;
        }

        const source = this.pickImpactSource(first, second);
        const target = source === first ? second : first;
        const normal = this.impactNormal(source, target);
        const overlap = minDistance - actualDistance + 0.1;
        if (source.kind !== "miniBoss") {
          source.pos.x -= normal.x * overlap * 0.35;
          source.pos.y -= normal.y * overlap * 0.35;
        }
        if (target.kind !== "miniBoss") {
          target.pos.x += normal.x * overlap * 0.65;
          target.pos.y += normal.y * overlap * 0.65;
        }

        if (!target.knocked) {
          const { chainCount, rootId } = this.extendChainTree(source);
          const transferredSpeed = Math.max(
            CHAIN_KNOCK_SPEED + this.wave * 12,
            length(source.vel) * 0.82
          );
          this.damageByImpact(target, normal, transferredSpeed, 140, chainCount, rootId);
          const shieldRecovery = this.recoverPlanetShield(chainCount);
          this.addChainHit(
            events,
            this.impactPoint(source, target, normal),
            chainCount,
            shieldRecovery
          );
          source.vel.x *= 0.9;
          source.vel.y *= 0.9;
          events.hit = true;
        } else {
          const sourceNormalVelocity = source.vel.x * normal.x + source.vel.y * normal.y;
          const targetNormalVelocity = target.vel.x * normal.x + target.vel.y * normal.y;
          const impulse = Math.max(0, sourceNormalVelocity - targetNormalVelocity) * 0.5;
          source.vel.x -= normal.x * impulse;
          source.vel.y -= normal.y * impulse;
          target.vel.x += normal.x * impulse;
          target.vel.y += normal.y * impulse;
        }
      }
    }
  }

  private pickExplosiveCore(first: Meteor, second: Meteor): Meteor | undefined {
    if (first.kind === "explosiveCore" && (first.knocked || second.knocked)) {
      return first;
    }
    if (second.kind === "explosiveCore" && (first.knocked || second.knocked)) {
      return second;
    }
    return undefined;
  }

  private damageByImpact(
    meteor: Meteor,
    direction: Vec2,
    speed: number,
    scoreBonus: number,
    chain: number,
    chainRootId?: number
  ): void {
    const state = this.effectState();
    damageThreatByImpact(
      meteor,
      direction,
      speed,
      scoreBonus,
      chain,
      state,
      (target, targetDirection, targetSpeed, targetScoreBonus, targetChain) =>
        this.knockMeteor(
          target,
          targetDirection,
          targetSpeed,
          targetScoreBonus,
          targetChain,
          chainRootId
        )
    );
    this.applyEffectState(state);
  }

  private applyExplosion(core: Meteor, events: SimulationEvents, chain: number): void {
    const state = this.effectState();
    const rootId = core.knocked ? this.chainRootIdFor(core) : core.id;
    const chainEventStart = events.chainHits.length;
    const resonance = this.currentUpgradeEffect("explosiveCoreResonance");
    this.chainTreeSizes.set(rootId, Math.max(this.chainTreeSizeForRoot(rootId), chain));
    const result = explodeCore(
      core,
      this.meteors,
      events,
      chain,
      state,
      (target, direction, speed, scoreBonus, chainCount, chainRootId) =>
        damageThreatByImpact(
          target,
          direction,
          speed,
          scoreBonus,
          chainCount,
          state,
          (...knockArgs) => this.knockMeteor(...knockArgs, chainRootId)
        ),
      (chainCount) => this.recoverPlanetShield(chainCount),
      () => {
        const chainCount = this.extendChainTreeFromRoot(rootId, chain);
        return { chainCount, rootId };
      },
      {
        radius: this.explosionRadius(resonance),
        speedBonus: resonance.explosionSpeedBonus
      }
    );
    this.defeated = result.defeated;
    this.score = result.score;
    this.updateWave(result.wave);
    for (const chainHit of events.chainHits.slice(chainEventStart)) {
      this.applyChainUpgradeTriggers(chainHit.pos, chainHit.count, events);
    }
  }

  private resolveSatelliteImpacts(events: SimulationEvents): void {
    if (this.satelliteInvulnerability > 0) {
      return;
    }

    const playerPos = radialPoint(this.playerAngle, ORBIT_RADIUS);

    for (const meteor of this.meteors) {
      if (
        !meteor.alive ||
        meteor.knocked ||
        distance(meteor.pos, playerPos) > SATELLITE_RADIUS + meteor.radius
      ) {
        continue;
      }

      const direction = normalize({
        x: meteor.pos.x - playerPos.x,
        y: meteor.pos.y - playerPos.y
      });
      const fallbackDirection = normalize({
        x: playerPos.x - CENTER.x,
        y: playerPos.y - CENTER.y
      });
      const knockDirection = length(direction) > 0.001 ? direction : fallbackDirection;
      if (meteor.kind === "miniBoss") {
        this.damageMiniBoss(meteor, 1, 45 + this.wave * 10, MINI_BOSS_HIT_COOLDOWN);
        this.applySatelliteContactPenalty(playerPos);
        events.hit = true;
        events.satelliteHit = true;
        continue;
      }

      const overlap = SATELLITE_RADIUS + meteor.radius - distance(meteor.pos, playerPos) + 0.1;
      this.cancelCharge();
      meteor.pos.x += knockDirection.x * overlap;
      meteor.pos.y += knockDirection.y * overlap;
      this.deflectMeteor(meteor, knockDirection, SATELLITE_KNOCK_SPEED + this.wave * 14);
      this.applySatelliteContactPenalty(playerPos);
      events.hit = true;
      events.satelliteHit = true;
    }
  }

  private cancelCharge(): void {
    if (!this.fireHeld) {
      return;
    }

    this.chargeActive = false;
    this.chargeCanceled = true;
    this.chargeTimer = 0;
  }

  private pickImpactSource(first: Meteor, second: Meteor): Meteor {
    if (first.knocked && !second.knocked) {
      return first;
    }
    if (second.knocked && !first.knocked) {
      return second;
    }
    return length(first.vel) >= length(second.vel) ? first : second;
  }

  private impactNormal(source: Meteor, target: Meteor): Vec2 {
    const between = { x: target.pos.x - source.pos.x, y: target.pos.y - source.pos.y };
    if (length(between) > 0.001) {
      return normalize(between);
    }
    return normalize({
      x: source.vel.x - target.vel.x,
      y: source.vel.y - target.vel.y
    });
  }

  private impactPoint(source: Meteor, target: Meteor, normal: Vec2): Vec2 {
    const sourceEdge = {
      x: source.pos.x + normal.x * source.radius,
      y: source.pos.y + normal.y * source.radius
    };
    const targetEdge = {
      x: target.pos.x - normal.x * target.radius,
      y: target.pos.y - normal.y * target.radius
    };
    return {
      x: (sourceEdge.x + targetEdge.x) * 0.5,
      y: (sourceEdge.y + targetEdge.y) * 0.5
    };
  }

  private knockMeteor(
    meteor: Meteor,
    direction: Vec2,
    speed: number,
    scoreBonus = 0,
    chain = 1,
    chainRootId = meteor.id
  ): void {
    this.deflectMeteor(meteor, direction, speed, chain, chainRootId);
    this.defeated += 1;
    this.score += scoreForThreat(meteor.kind, this.wave, scoreBonus);
    this.updateWaveFromDefeated();
  }

  private damageMiniBoss(
    meteor: Meteor,
    damage: number,
    score: number,
    cooldown: number,
    defeatScoreBonus = 0
  ): boolean {
    if ((meteor.hitCooldown ?? 0) > 0) {
      return false;
    }

    meteor.hp -= damage;
    meteor.hitCooldown = cooldown;
    this.score += score;
    this.sparks.push({ pos: { ...meteor.pos }, life: 0.2, maxLife: 0.2 });

    if (meteor.hp <= 0) {
      this.defeatMiniBoss(meteor, defeatScoreBonus);
    }

    return true;
  }

  private defeatMiniBoss(meteor: Meteor, scoreBonus = 0): void {
    meteor.alive = false;
    this.defeated += 1;
    this.score += scoreForThreat(
      meteor.kind,
      this.wave,
      scoreBonus + defeatBonusForThreat(meteor.kind, this.wave)
    );
    this.updateWaveFromDefeated();
    this.sparks.push({ pos: { ...meteor.pos }, life: 0.3, maxLife: 0.3 });
  }

  private deflectMeteor(
    meteor: Meteor,
    direction: Vec2,
    speed: number,
    chain = 1,
    chainRootId = meteor.id
  ): void {
    meteor.vel.x = direction.x * speed;
    meteor.vel.y = direction.y * speed;
    meteor.knocked = true;
    meteor.chain = chain;
    meteor.chainRootId = chainRootId;
    this.chainTreeSizes.set(chainRootId, Math.max(this.chainTreeSizeForRoot(chainRootId), chain));
    this.sparks.push({ pos: { ...meteor.pos }, life: 0.22, maxLife: 0.22 });
  }

  private chainRootIdFor(meteor: Meteor): number {
    return meteor.chainRootId ?? meteor.id;
  }

  private chainTreeSizeForRoot(rootId: number): number {
    return this.chainTreeSizes.get(rootId) ?? 0;
  }

  private chainTreeSizeFor(meteor: Meteor): number {
    return Math.max(1, meteor.chain, this.chainTreeSizeForRoot(this.chainRootIdFor(meteor)));
  }

  private extendChainTree(source: Meteor): { chainCount: number; rootId: number } {
    const rootId = this.chainRootIdFor(source);
    const chainCount = this.chainTreeSizeFor(source) + 1;
    this.chainTreeSizes.set(rootId, chainCount);
    return { chainCount, rootId };
  }

  private extendChainTreeFromRoot(rootId: number, minimumChainSize: number): number {
    const chainCount = Math.max(this.chainTreeSizeForRoot(rootId), minimumChainSize) + 1;
    this.chainTreeSizes.set(rootId, chainCount);
    return chainCount;
  }

  private recoverPlanetShield(chain: number): number {
    if (this.planetHp >= MAX_PLANET_HP) {
      return 0;
    }

    const recovery = Math.min(
      MAX_CHAIN_SHIELD_RECOVERY + this.effectValue("shieldSiphon", "chainRecoveryMaxBonus"),
      CHAIN_SHIELD_RECOVERY + chain + this.effectValue("shieldSiphon", "chainRecoveryBonus")
    );
    return this.recoverPlanetHp(recovery);
  }

  private recoverPlanetHp(recovery: number): number {
    if (this.planetHp >= MAX_PLANET_HP) {
      return 0;
    }

    const before = this.planetHp;
    this.planetHp = Math.min(MAX_PLANET_HP, this.planetHp + recovery);
    return this.planetHp - before;
  }

  private resolvePlanetImpacts(events: SimulationEvents): void {
    for (const meteor of this.meteors) {
      if (
        !meteor.alive ||
        distance(meteor.pos, CENTER) > PLANET_RADIUS + meteor.radius - 2
      ) {
        continue;
      }

      if (meteor.kind === "explosiveCore") {
        this.applyExplosion(meteor, events, 1);
        this.planetHp -= 32;
      } else {
        meteor.alive = false;
        this.planetHp -= planetDamage(meteor);
      }
      this.sparks.push({ pos: { ...meteor.pos }, life: 0.3, maxLife: 0.3 });
      events.planetHit = true;
    }
  }

  private canSelectUpgrade(upgradeId: UpgradeId): boolean {
    const definition = upgradeDefinitionById(upgradeId);
    if (!definition) {
      return false;
    }

    if (definition.kind === "instant") {
      return true;
    }

    return this.upgradeLevels[upgradeId] < definition.maxLevel;
  }

  private upgradeSortValue(index: number): number {
    const seed =
      Math.sin(
        (this.wave + 1) * 12.9898 +
          (this.defeated + 1) * 78.233 +
          (this.score + 1) * 0.00037 +
          index * 37.719
      ) * 43758.5453;
    return seed - Math.floor(seed);
  }

  private toUpgradeChoice(upgradeId: UpgradeId): UpgradeChoice {
    const definition = upgradeDefinitionById(upgradeId);
    if (!definition) {
      throw new Error(`Unknown upgrade: ${upgradeId}`);
    }

    const level =
      definition.kind === "multi"
        ? this.upgradeLevels[upgradeId] + 1
        : definition.kind === "single"
          ? 1
          : 0;
    const descriptionIndex = Math.max(0, level - 1);
    return {
      id: definition.id,
      name: definition.name,
      title:
        definition.kind === "multi"
          ? `${definition.name} ${romanLevel(level)}`
          : definition.name,
      description: definition.descriptions[descriptionIndex] ?? definition.descriptions[0] ?? "",
      kind: definition.kind,
      level,
      maxLevel: definition.maxLevel
    };
  }

  private currentUpgradeEffect(upgradeId: UpgradeId): UpgradeEffect {
    const definition = upgradeDefinitionById(upgradeId);
    if (!definition) {
      return {};
    }

    if (definition.kind === "instant") {
      return definition.effect ?? {};
    }

    const level = this.upgradeLevels[upgradeId];
    if (level <= 0) {
      return {};
    }

    if (definition.kind === "multi") {
      return definition.effects?.[level - 1] ?? {};
    }

    return definition.effect ?? {};
  }

  private effectValue(upgradeId: UpgradeId, key: string, fallback = 0): number {
    return this.currentUpgradeEffect(upgradeId)[key] ?? fallback;
  }

  private hasUpgrade(upgradeId: UpgradeId): boolean {
    return this.upgradeLevels[upgradeId] > 0;
  }

  private currentOrbitSpeedMultiplier(): number {
    return (
      this.effectValue("orbitalAcceleration", "orbitSpeedMultiplier", 1) *
      (this.isEmergencyBoostActive()
        ? this.effectValue("emergencyBoost", "orbitSpeedMultiplier", 1)
        : 1)
    );
  }

  private currentPunchCooldown(): number {
    return Math.max(
      0.16,
      PUNCH_COOLDOWN *
        this.effectValue("quickPunch", "cooldownMultiplier", 1) *
        (this.isEmergencyBoostActive()
          ? this.effectValue("emergencyBoost", "cooldownMultiplier", 1)
          : 1) *
        (this.isOverdriveActive() ? this.effectValue("overdrive", "cooldownMultiplier", 1) : 1)
    );
  }

  private currentPunchRange(): number {
    return (
      PUNCH_RANGE +
      this.effectValue("longArm", "punchRangeBonus") +
      (this.isEmergencyBoostActive() ? this.effectValue("emergencyBoost", "punchRangeBonus") : 0)
    );
  }

  private currentPunchRadius(): number {
    return (
      18 +
      this.effectValue("wideGlove", "punchRadiusBonus") +
      (this.isOverdriveActive() ? this.effectValue("overdrive", "punchRadiusBonus") : 0)
    );
  }

  private currentPunchSpeedMultiplier(): number {
    return (
      (this.isEmergencyBoostActive()
        ? this.effectValue("emergencyBoost", "punchSpeedMultiplier", 1)
        : 1) *
      (this.isOverdriveActive() ? this.effectValue("overdrive", "punchSpeedMultiplier", 1) : 1)
    );
  }

  private currentKnockSpeedMultiplier(): number {
    return this.isOverdriveActive() ? this.effectValue("overdrive", "knockSpeedMultiplier", 1) : 1;
  }

  private currentSatelliteHitLockout(): number {
    return (
      SATELLITE_HIT_LOCKOUT *
      this.effectValue("recoverySystem", "satelliteLockoutMultiplier", 1)
    );
  }

  private currentSatelliteInvulnerability(): number {
    return (
      SATELLITE_INVULNERABILITY *
      this.effectValue("recoverySystem", "satelliteInvulnerabilityMultiplier", 1)
    );
  }

  private isEmergencyBoostActive(): boolean {
    const threshold = this.effectValue("emergencyBoost", "hpThreshold");
    return this.hasUpgrade("emergencyBoost") && this.planetHp / MAX_PLANET_HP <= threshold;
  }

  private isOverdriveActive(): boolean {
    return this.overdriveTimer > 0;
  }

  private perfectTimingBonus(
    punch: Punch
  ): { knockSpeedMultiplier: number; scoreBonus: number; miniBossDamageBonus: number } {
    if (!this.hasUpgrade("perfectTiming")) {
      return { knockSpeedMultiplier: 1, scoreBonus: 0, miniBossDamageBonus: 0 };
    }

    const effect = this.currentUpgradeEffect("perfectTiming");
    const distanceRatio = punch.maxDistance > 0 ? punch.distance / punch.maxDistance : 0;
    if (distanceRatio < (effect.distanceThreshold ?? 1)) {
      return { knockSpeedMultiplier: 1, scoreBonus: 0, miniBossDamageBonus: 0 };
    }

    return {
      knockSpeedMultiplier: effect.knockSpeedMultiplier ?? 1,
      scoreBonus: effect.scoreBonus ?? 0,
      miniBossDamageBonus: effect.miniBossDamageBonus ?? 0
    };
  }

  private applySatelliteContactPenalty(playerPos: Vec2): void {
    const shieldReady = this.hasUpgrade("orbitalShield") && this.orbitalShieldCooldown <= 0;
    if (!shieldReady) {
      this.cancelCharge();
      this.cooldown = Math.max(this.cooldown, this.currentSatelliteHitLockout());
      this.satelliteInvulnerability = this.currentSatelliteInvulnerability();
      return;
    }

    const effect = this.currentUpgradeEffect("orbitalShield");
    this.orbitalShieldCooldown = effect.shieldCooldown ?? 0;
    this.cooldown = Math.max(this.cooldown, effect.lockoutWhenAbsorbed ?? 0);
    this.satelliteInvulnerability = Math.max(
      this.satelliteInvulnerability,
      effect.invulnerabilityWhenAbsorbed ?? 0
    );
    this.sparks.push({ pos: { ...playerPos }, life: 0.32, maxLife: 0.32 });
  }

  private applyHomingKnockback(meteor: Meteor, dt: number): void {
    if (!meteor.alive || !meteor.knocked || !this.hasUpgrade("homingKnockback")) {
      return;
    }

    const effect = this.currentUpgradeEffect("homingKnockback");
    const range = effect.homingRange ?? 0;
    const strength = effect.homingStrength ?? 0;
    const speed = length(meteor.vel);
    if (range <= 0 || strength <= 0 || speed <= 0.001) {
      return;
    }

    let nearest: Meteor | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const target of this.meteors) {
      if (!target.alive || target === meteor || target.knocked) {
        continue;
      }

      const targetDistance = distance(meteor.pos, target.pos);
      if (targetDistance <= range && targetDistance < nearestDistance) {
        nearest = target;
        nearestDistance = targetDistance;
      }
    }

    if (!nearest) {
      return;
    }

    const desired = normalize({
      x: nearest.pos.x - meteor.pos.x,
      y: nearest.pos.y - meteor.pos.y
    });
    const steer = Math.min(1, (strength * dt) / speed);
    const nextDirection = normalize({
      x: meteor.vel.x * (1 - steer) + desired.x * speed * steer,
      y: meteor.vel.y * (1 - steer) + desired.y * speed * steer
    });
    meteor.vel.x = nextDirection.x * speed;
    meteor.vel.y = nextDirection.y * speed;
  }

  private addChainHit(
    events: SimulationEvents,
    pos: Vec2,
    count: number,
    shieldRecovery?: number,
    allowStarburst = true
  ): void {
    const chainHit: ChainHit = { pos, count, shieldRecovery };
    events.chainHits.push(chainHit);
    this.applyChainUpgradeTriggers(pos, count, events, allowStarburst);
  }

  private applyChainUpgradeTriggers(
    pos: Vec2,
    chain: number,
    events: SimulationEvents,
    allowStarburst = true
  ): void {
    this.applyPunchReload();
    this.triggerOverdrive(chain);
    if (allowStarburst) {
      this.triggerStarburst(pos, chain, events);
    }
  }

  private applyPunchReload(): void {
    this.cooldown = Math.max(
      0,
      this.cooldown - this.effectValue("punchReload", "cooldownRecovery")
    );
  }

  private triggerOverdrive(chain: number): void {
    if (
      !this.hasUpgrade("overdrive") ||
      chain < this.effectValue("overdrive", "chainThreshold", Number.POSITIVE_INFINITY)
    ) {
      return;
    }

    this.overdriveTimer = Math.max(this.overdriveTimer, this.effectValue("overdrive", "duration"));
  }

  private triggerStarburst(pos: Vec2, chain: number, events: SimulationEvents): void {
    if (
      !this.hasUpgrade("starburst") ||
      this.starburstCooldown > 0 ||
      chain < this.effectValue("starburst", "chainThreshold", Number.POSITIVE_INFINITY)
    ) {
      return;
    }

    const effect = this.currentUpgradeEffect("starburst");
    const radius = effect.radius ?? 0;
    const knockSpeed = effect.knockSpeed ?? 0;
    if (radius <= 0 || knockSpeed <= 0) {
      return;
    }

    this.starburstCooldown = effect.cooldown ?? 0;
    this.sparks.push({ pos: { ...pos }, life: 0.38, maxLife: 0.38 });
    for (const meteor of this.meteors) {
      if (!meteor.alive || meteor.knocked || distance(pos, meteor.pos) > radius + meteor.radius) {
        continue;
      }

      const direction = normalize({
        x: meteor.pos.x - pos.x,
        y: meteor.pos.y - pos.y
      });
      const fallbackDirection = normalize({
        x: meteor.pos.x - CENTER.x,
        y: meteor.pos.y - CENTER.y
      });
      const nextChain = chain + 1;
      this.damageByImpact(
        meteor,
        length(direction) > 0.001 ? direction : fallbackDirection,
        knockSpeed,
        effect.scoreBonus ?? 0,
        nextChain,
        meteor.id
      );
      this.addChainHit(
        events,
        { ...meteor.pos },
        nextChain,
        this.recoverPlanetShield(nextChain),
        false
      );
      events.hit = true;
    }
  }

  private explosionRadius(effect: UpgradeEffect): number {
    return EXPLOSION_RADIUS + (effect.explosionRadiusBonus ?? 0);
  }

  private effectState() {
    return {
      wave: this.wave,
      defeated: this.defeated,
      score: this.score,
      sparks: this.sparks
    };
  }

  private applyEffectState(state: ReturnType<OrbitPunchSimulation["effectState"]>): void {
    this.defeated = state.defeated;
    this.score = state.score;
    this.updateWaveFromDefeated();
  }

  private updateWaveFromDefeated(): void {
    this.updateWave(1 + Math.floor(this.defeated / 8));
  }

  private updateWave(nextWave: number): void {
    if (nextWave === this.wave) {
      return;
    }

    this.wave = nextWave;
    this.scheduleMiniBossForCurrentWave();
  }

  private scheduleMiniBossForCurrentWave(): void {
    if (!hasMiniBossForWave(this.wave) || this.miniBossWave === this.wave) {
      this.miniBossSpawnTimer = Number.POSITIVE_INFINITY;
      this.miniBossScheduledWave = 0;
      return;
    }

    this.miniBossSpawnTimer = MINI_BOSS_ENTRY_DELAY;
    this.miniBossScheduledWave = this.wave;
  }
}
