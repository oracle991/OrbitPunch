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

  public fire(): boolean {
    if (this.gameOver || this.cooldown > 0) {
      return false;
    }

    const origin = radialPoint(this.playerAngle, ORBIT_RADIUS + 21);
    const direction = normalize({ x: origin.x - CENTER.x, y: origin.y - CENTER.y });
    this.punches.push({
      id: nextId++,
      origin,
      pos: origin,
      direction,
      radius: 18,
      distance: 0,
      maxDistance: PUNCH_RANGE,
      hold: PUNCH_HOLD_TIME,
      life: 1,
      maxLife: 1,
      phase: "extending"
    });
    this.cooldown = PUNCH_COOLDOWN;
    return true;
  }

  public update(dt: number): SimulationEvents {
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

    this.playerAngle += PLAYER_ORBIT_SPEED * dt;
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
      satelliteInvulnerability: this.satelliteInvulnerability,
      gameOver: this.gameOver
    };
  }

  private updatePunches(dt: number): void {
    const currentOrigin = radialPoint(this.playerAngle, ORBIT_RADIUS + 21);

    for (const punch of this.punches) {
      punch.origin = { ...currentOrigin };

      if (punch.phase === "extending") {
        punch.distance = Math.min(punch.maxDistance, punch.distance + PUNCH_EXTEND_SPEED * dt);
        punch.pos.x = punch.origin.x + punch.direction.x * punch.distance;
        punch.pos.y = punch.origin.y + punch.direction.y * punch.distance;

        if (punch.distance >= punch.maxDistance) {
          punch.phase = "holding";
        }
      } else if (punch.phase === "holding") {
        punch.hold -= dt;
        punch.pos.x = punch.origin.x + punch.direction.x * punch.distance;
        punch.pos.y = punch.origin.y + punch.direction.y * punch.distance;

        if (punch.hold <= 0) {
          punch.phase = "returning";
        }
      } else {
        const toOrigin = {
          x: punch.origin.x - punch.pos.x,
          y: punch.origin.y - punch.pos.y
        };
        const remaining = Math.hypot(toOrigin.x, toOrigin.y);
        const step = PUNCH_RETURN_SPEED * dt;

        if (remaining <= step || remaining <= PUNCH_RETURN_EPSILON) {
          punch.pos = { ...punch.origin };
          punch.distance = 0;
        } else {
          punch.pos.x += (toOrigin.x / remaining) * step;
          punch.pos.y += (toOrigin.y / remaining) * step;
          punch.distance = distance(punch.pos, punch.origin);
          punch.direction = normalize({
            x: punch.pos.x - punch.origin.x,
            y: punch.pos.y - punch.origin.y
          });
        }
      }

      punch.life = punch.maxLife * Math.max(0.2, punch.distance / punch.maxDistance);
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

        const wrist = {
          x: punch.pos.x - punch.direction.x * 20,
          y: punch.pos.y - punch.direction.y * 20
        };
        const closest = closestPointOnSegment(meteor.pos, punch.origin, wrist);
        if (distance(closest, meteor.pos) > PUNCH_CHAIN_RADIUS + meteor.radius) {
          continue;
        }

        const contactDirection = normalize({
          x: meteor.pos.x - closest.x,
          y: meteor.pos.y - closest.y
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
      this.damageMiniBoss(meteor, 1, 55 + this.wave * 12, MINI_BOSS_HIT_COOLDOWN);
      punch.phase = "returning";
      return;
    }

    this.knockMeteor(meteor, hitDirection, PUNCH_KNOCK_SPEED + this.wave * 18);
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
        this.damageMiniBoss(meteor, 1, 45 + this.wave * 10, MINI_BOSS_HIT_COOLDOWN);
        this.cooldown = Math.max(this.cooldown, SATELLITE_HIT_LOCKOUT);
        this.satelliteInvulnerability = SATELLITE_INVULNERABILITY;
        events.hit = true;
        events.satelliteHit = true;
        continue;
      }

      const overlap = SATELLITE_RADIUS + meteor.radius - distance(meteor.pos, playerPos) + 0.1;
      meteor.pos.x += knockDirection.x * overlap;
      meteor.pos.y += knockDirection.y * overlap;
      this.deflectMeteor(meteor, knockDirection, SATELLITE_KNOCK_SPEED + this.wave * 14);
      this.cooldown = Math.max(this.cooldown, SATELLITE_HIT_LOCKOUT);
      this.satelliteInvulnerability = SATELLITE_INVULNERABILITY;
      events.hit = true;
      events.satelliteHit = true;
    }
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
        meteor.knocked ||
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
