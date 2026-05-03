import { closestPointOnSegment, distance, length, normalize, radialPoint } from "./math";
import { damageThreatByImpact, explodeCore, planetDamage } from "./threats/effects";
import { CHAIN_KNOCK_SPEED, MINI_BOSS_HIT_COOLDOWN, PUNCH_KNOCK_SPEED } from "./threats/config";
import { applyTractorPull, updateThreat } from "./threats/update";
import { spawnScheduledMiniBoss, spawnThreat } from "./threats/spawn";
import {
  defeatBonusForThreat,
  hasMiniBossForWave,
  rollSpawnIntervalForWave,
  scoreForThreat
} from "./threats/waveConfig";
import type {
  HitSpark,
  Meteor,
  Punch,
  SimulationEvents,
  SimulationSnapshot,
  Vec2
} from "./types";
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
    this.cooldown = PUNCH_COOLDOWN;
    return { fired: true, charged };
  }

  public cancelFire(): void {
    this.fireHeld = false;
    this.chargeTimer = 0;
    this.chargeActive = false;
    this.chargeCanceled = false;
  }

  private createPunch(charged: boolean): void {
    const speedMultiplier = charged ? CHARGE_PUNCH_SPEED_MULTIPLIER : 1;
    const damageMultiplier = charged ? CHARGE_PUNCH_DAMAGE_MULTIPLIER : 1;
    const origin = radialPoint(this.playerAngle, ORBIT_RADIUS + 21);
    const direction = normalize({ x: origin.x - CENTER.x, y: origin.y - CENTER.y });
    this.punches.push({
      id: nextId++,
      origin,
      pos: origin,
      vel: {
        x: direction.x * PUNCH_EXTEND_SPEED * speedMultiplier,
        y: direction.y * PUNCH_EXTEND_SPEED * speedMultiplier
      },
      direction,
      chainPoints: Array.from({ length: PUNCH_CHAIN_SEGMENTS }, () => ({ ...origin })),
      chainTime: 0,
      radius: 18,
      distance: 0,
      maxDistance: PUNCH_RANGE,
      hold: PUNCH_HOLD_TIME,
      life: 1,
      maxLife: 1,
      extendSpeed: PUNCH_EXTEND_SPEED * speedMultiplier,
      returnSpeed: PUNCH_RETURN_SPEED * speedMultiplier,
      damageMultiplier,
      knockSpeedMultiplier: speedMultiplier,
      charged,
      phase: "extending"
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
      PLAYER_ORBIT_SPEED * (isCharging ? CHARGE_ORBIT_SPEED_MULTIPLIER : 1);
    this.playerAngle += orbitSpeed * dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.satelliteInvulnerability = Math.max(0, this.satelliteInvulnerability - dt);
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
      cooldownMax: this.cooldown > PUNCH_COOLDOWN ? SATELLITE_HIT_LOCKOUT : PUNCH_COOLDOWN,
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
    const currentOrigin = radialPoint(this.playerAngle, ORBIT_RADIUS + 21);

    for (const punch of this.punches) {
      punch.origin = { ...currentOrigin };
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
          punch.vel.x +=
            (toOrigin.x * spring + returnDirection.x * reelAcceleration - punch.vel.x * damping) *
            dt;
          punch.vel.y +=
            (toOrigin.y * spring + returnDirection.y * reelAcceleration - punch.vel.y * damping) *
            dt;
          this.limitPunchSpeed(punch, punch.returnSpeed * 1.9);
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
      for (const meteor of this.meteors) {
        if (!meteor.alive || meteor.knocked) {
          continue;
        }

        if (distance(punch.pos, meteor.pos) <= punch.radius + meteor.radius) {
          this.hitThreat(meteor, punch);
          punch.phase = "returning";
          events.hit = true;
          continue;
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
        this.hitThreat(
          meteor,
          punch,
          length(contactDirection) > 0.001 ? contactDirection : fallbackDirection
        );
        punch.phase = "returning";
        events.hit = true;
      }
    }
  }

  private hitThreat(meteor: Meteor, punch: Punch, direction?: Vec2): void {
    const outward = normalize({ x: meteor.pos.x - CENTER.x, y: meteor.pos.y - CENTER.y });
    const hitDirection = direction ?? outward;
    if (meteor.kind === "miniBoss") {
      this.damageMiniBoss(
        meteor,
        punch.damageMultiplier,
        55 + this.wave * 12,
        MINI_BOSS_HIT_COOLDOWN
      );
      punch.phase = "returning";
      return;
    }

    this.knockMeteor(
      meteor,
      hitDirection,
      (PUNCH_KNOCK_SPEED + this.wave * 18) * punch.knockSpeedMultiplier
    );
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

        const minDistance = first.radius + second.radius;
        const actualDistance = distance(first.pos, second.pos);
        if (actualDistance > minDistance) {
          continue;
        }

        const explosive = this.pickExplosiveCore(first, second);
        if (explosive) {
          this.applyExplosion(explosive, events, Math.max(2, first.chain, second.chain));
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
          events.chainHits.push({
            pos: this.impactPoint(source, target, normal),
            count: chainCount,
            shieldRecovery
          });
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
      }
    );
    this.defeated = result.defeated;
    this.score = result.score;
    this.updateWave(result.wave);
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
        this.cancelCharge();
        this.damageMiniBoss(meteor, 1, 45 + this.wave * 10, MINI_BOSS_HIT_COOLDOWN);
        this.cooldown = Math.max(this.cooldown, SATELLITE_HIT_LOCKOUT);
        this.satelliteInvulnerability = SATELLITE_INVULNERABILITY;
        events.hit = true;
        events.satelliteHit = true;
        continue;
      }

      const overlap = SATELLITE_RADIUS + meteor.radius - distance(meteor.pos, playerPos) + 0.1;
      this.cancelCharge();
      meteor.pos.x += knockDirection.x * overlap;
      meteor.pos.y += knockDirection.y * overlap;
      this.deflectMeteor(meteor, knockDirection, SATELLITE_KNOCK_SPEED + this.wave * 14);
      this.cooldown = Math.max(this.cooldown, SATELLITE_HIT_LOCKOUT);
      this.satelliteInvulnerability = SATELLITE_INVULNERABILITY;
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
  ): void {
    if ((meteor.hitCooldown ?? 0) > 0) {
      return;
    }

    meteor.hp -= damage;
    meteor.hitCooldown = cooldown;
    this.score += score;
    this.sparks.push({ pos: { ...meteor.pos }, life: 0.2, maxLife: 0.2 });

    if (meteor.hp <= 0) {
      this.defeatMiniBoss(meteor, defeatScoreBonus);
    }
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

    const recovery = Math.min(MAX_CHAIN_SHIELD_RECOVERY, CHAIN_SHIELD_RECOVERY + chain);
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
