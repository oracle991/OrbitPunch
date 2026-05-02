export type Vec2 = {
  x: number;
  y: number;
};

export type ThreatKind =
  | "meteor"
  | "orbitalSatellite"
  | "explosiveCore"
  | "tractorDrone"
  | "miniBoss";

export type Meteor = {
  id: number;
  kind: ThreatKind;
  pos: Vec2;
  vel: Vec2;
  radius: number;
  alive: boolean;
  knocked: boolean;
  chain: number;
  spin: number;
  hp: number;
  maxHp: number;
  orbitAngle?: number;
  orbitRadius?: number;
  orbitSpeed?: number;
  hitCooldown?: number;
};

export type Punch = {
  id: number;
  origin: Vec2;
  pos: Vec2;
  direction: Vec2;
  radius: number;
  distance: number;
  maxDistance: number;
  hold: number;
  life: number;
  maxLife: number;
  phase: "extending" | "holding" | "returning";
};

export type HitSpark = {
  pos: Vec2;
  life: number;
  maxLife: number;
};

export type ChainHit = {
  pos: Vec2;
  count: number;
};

export type SimulationSnapshot = {
  playerAngle: number;
  playerPos: Vec2;
  meteors: Meteor[];
  punches: Punch[];
  sparks: HitSpark[];
  score: number;
  wave: number;
  planetHp: number;
  maxPlanetHp: number;
  cooldown: number;
  cooldownMax: number;
  gameOver: boolean;
};

export type SimulationEvents = {
  hit: boolean;
  satelliteHit: boolean;
  planetHit: boolean;
  gameOver: boolean;
  chainHits: ChainHit[];
};

const WORLD_WIDTH = 960;
const WORLD_HEIGHT = 640;
const CENTER: Vec2 = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
const PLANET_RADIUS = 62;
const ORBIT_RADIUS = 136;
const OUTER_RADIUS = 500;
const SATELLITE_RADIUS = 16;

const PLAYER_ORBIT_SPEED = 1.95;
const PUNCH_EXTEND_SPEED = 480;
const PUNCH_RETURN_SPEED = 560;
const PUNCH_RANGE = 120;
const PUNCH_HOLD_TIME = 0.24;
const PUNCH_COOLDOWN = 0.56;
const PUNCH_RETURN_EPSILON = 6;
const METEOR_BASE_SPEED = 34;
const PUNCH_KNOCK_SPEED = 280;
const SATELLITE_KNOCK_SPEED = 250;
const SATELLITE_HIT_LOCKOUT = 1.35;
const CHAIN_KNOCK_SPEED = 238;
const PUNCH_CHAIN_RADIUS = 9;
const SPAWN_BASE_INTERVAL = 1.25;
const ORBITAL_SATELLITE_RADIUS = 196;
const TRACTOR_RANGE = 172;
const TRACTOR_PULL = 38;
const EXPLOSION_RADIUS = 118;
const MINI_BOSS_HIT_COOLDOWN = 0.28;

let nextId = 1;

const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

const radialPoint = (angle: number, radius: number): Vec2 => ({
  x: CENTER.x + Math.cos(angle) * radius,
  y: CENTER.y + Math.sin(angle) * radius
});

const normalize = (v: Vec2): Vec2 => {
  const length = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / length, y: v.y / length };
};

const length = (v: Vec2): number => Math.hypot(v.x, v.y);

const closestPointOnSegment = (point: Vec2, start: Vec2, end: Vec2): Vec2 => {
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

export class OrbitPunchSimulation {
  private playerAngle = -Math.PI / 2;
  private meteors: Meteor[] = [];
  private punches: Punch[] = [];
  private sparks: HitSpark[] = [];
  private spawnTimer = 0.85;
  private cooldown = 0;
  private score = 0;
  private wave = 1;
  private defeated = 0;
  private miniBossWave = 0;
  private planetHp = 100;
  private gameOver = true;

  public start(): void {
    this.playerAngle = -Math.PI / 2;
    this.meteors = [];
    this.punches = [];
    this.sparks = [];
    this.spawnTimer = 0.55;
    this.cooldown = 0;
    this.score = 0;
    this.wave = 1;
    this.defeated = 0;
    this.miniBossWave = 0;
    this.planetHp = 100;
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
    const events = {
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
    this.spawnTimer -= dt;

    if (this.spawnTimer <= 0) {
      this.spawnThreat();
      const pace = Math.max(0.48, SPAWN_BASE_INTERVAL - this.wave * 0.08);
      this.spawnTimer = pace + Math.random() * 0.45;
    }

    this.updatePunches(dt);
    this.applyTractorPull(dt);

    for (const meteor of this.meteors) {
      this.updateThreat(meteor, dt);
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
      maxPlanetHp: 100,
      cooldown: this.cooldown,
      cooldownMax: this.cooldown > PUNCH_COOLDOWN ? SATELLITE_HIT_LOCKOUT : PUNCH_COOLDOWN,
      gameOver: this.gameOver
    };
  }

  private spawnThreat(): void {
    const kind = this.pickThreatKind();
    if (kind === "orbitalSatellite") {
      this.spawnOrbitalSatellite();
      return;
    }
    if (kind === "explosiveCore") {
      this.spawnExplosiveCore();
      return;
    }
    if (kind === "tractorDrone") {
      this.spawnTractorDrone();
      return;
    }
    if (kind === "miniBoss") {
      this.spawnMiniBoss();
      return;
    }
    this.spawnMeteor();
  }

  private pickThreatKind(): ThreatKind {
    const roll = Math.random();
    if (this.wave >= 5 && this.miniBossWave !== this.wave) {
      return "miniBoss";
    }
    if (this.wave >= 4 && roll < 0.26) {
      return "tractorDrone";
    }
    if (this.wave >= 3 && roll < 0.48) {
      return "orbitalSatellite";
    }
    if (this.wave >= 2 && roll < 0.56) {
      return "explosiveCore";
    }
    return "meteor";
  }

  private spawnMeteor(): void {
    const angle = Math.random() * Math.PI * 2;
    const spawn = radialPoint(angle, OUTER_RADIUS);
    const inward = normalize({ x: CENTER.x - spawn.x, y: CENTER.y - spawn.y });
    const speed = METEOR_BASE_SPEED + this.wave * 10 + Math.random() * 16;
    this.meteors.push({
      id: nextId++,
      kind: "meteor",
      pos: spawn,
      vel: { x: inward.x * speed, y: inward.y * speed },
      radius: 25 + Math.random() * 7,
      alive: true,
      knocked: false,
      chain: 0,
      spin: Math.random() * Math.PI * 2,
      hp: 1,
      maxHp: 1
    });
  }

  private spawnExplosiveCore(): void {
    const angle = Math.random() * Math.PI * 2;
    const spawn = radialPoint(angle, OUTER_RADIUS);
    const inward = normalize({ x: CENTER.x - spawn.x, y: CENTER.y - spawn.y });
    const speed = METEOR_BASE_SPEED + this.wave * 8 + Math.random() * 12;
    this.meteors.push({
      id: nextId++,
      kind: "explosiveCore",
      pos: spawn,
      vel: { x: inward.x * speed, y: inward.y * speed },
      radius: 22,
      alive: true,
      knocked: false,
      chain: 0,
      spin: Math.random() * Math.PI * 2,
      hp: 1,
      maxHp: 1
    });
  }

  private spawnTractorDrone(): void {
    const angle = Math.random() * Math.PI * 2;
    const spawn = radialPoint(angle, OUTER_RADIUS);
    const inward = normalize({ x: CENTER.x - spawn.x, y: CENTER.y - spawn.y });
    const speed = METEOR_BASE_SPEED * 0.74 + this.wave * 7 + Math.random() * 10;
    this.meteors.push({
      id: nextId++,
      kind: "tractorDrone",
      pos: spawn,
      vel: { x: inward.x * speed, y: inward.y * speed },
      radius: 23,
      alive: true,
      knocked: false,
      chain: 0,
      spin: Math.random() * Math.PI * 2,
      hp: 1,
      maxHp: 1
    });
  }

  private spawnOrbitalSatellite(): void {
    const angle = Math.random() * Math.PI * 2;
    const spawn = radialPoint(angle, OUTER_RADIUS);
    const inward = normalize({ x: CENTER.x - spawn.x, y: CENTER.y - spawn.y });
    const speed = METEOR_BASE_SPEED + this.wave * 8 + Math.random() * 14;
    this.meteors.push({
      id: nextId++,
      kind: "orbitalSatellite",
      pos: spawn,
      vel: { x: inward.x * speed, y: inward.y * speed },
      radius: 20,
      alive: true,
      knocked: false,
      chain: 0,
      spin: Math.random() * Math.PI * 2,
      hp: 1,
      maxHp: 1,
      orbitAngle: angle,
      orbitRadius: ORBITAL_SATELLITE_RADIUS + Math.random() * 34,
      orbitSpeed: (Math.random() < 0.5 ? -1 : 1) * (0.72 + this.wave * 0.04)
    });
  }

  private spawnMiniBoss(): void {
    this.miniBossWave = this.wave;
    const angle = Math.random() * Math.PI * 2;
    const spawn = radialPoint(angle, OUTER_RADIUS + 24);
    const inward = normalize({ x: CENTER.x - spawn.x, y: CENTER.y - spawn.y });
    const speed = METEOR_BASE_SPEED * 0.58 + this.wave * 4;
    this.meteors.push({
      id: nextId++,
      kind: "miniBoss",
      pos: spawn,
      vel: { x: inward.x * speed, y: inward.y * speed },
      radius: 42,
      alive: true,
      knocked: false,
      chain: 0,
      spin: Math.random() * Math.PI * 2,
      hp: 4,
      maxHp: 4,
      hitCooldown: 0
    });
  }

  private updateThreat(meteor: Meteor, dt: number): void {
    if (
      meteor.kind === "orbitalSatellite" &&
      !meteor.knocked &&
      meteor.orbitRadius !== undefined &&
      meteor.orbitAngle !== undefined &&
      meteor.orbitSpeed !== undefined &&
      distance(meteor.pos, CENTER) <= meteor.orbitRadius
    ) {
      meteor.orbitAngle += meteor.orbitSpeed * dt;
      meteor.pos = radialPoint(meteor.orbitAngle, meteor.orbitRadius);
      meteor.vel = {
        x: -Math.sin(meteor.orbitAngle) * meteor.orbitSpeed * meteor.orbitRadius,
        y: Math.cos(meteor.orbitAngle) * meteor.orbitSpeed * meteor.orbitRadius
      };
      return;
    }

    meteor.pos.x += meteor.vel.x * dt;
    meteor.pos.y += meteor.vel.y * dt;
  }

  private applyTractorPull(dt: number): void {
    for (const drone of this.meteors) {
      if (!drone.alive || drone.knocked || drone.kind !== "tractorDrone") {
        continue;
      }

      for (const target of this.meteors) {
        if (!target.alive || target.knocked || target === drone || target.kind === "miniBoss") {
          continue;
        }

        const pullDistance = distance(drone.pos, target.pos);
        if (pullDistance > TRACTOR_RANGE || pullDistance < 8) {
          continue;
        }

        const direction = normalize({ x: drone.pos.x - target.pos.x, y: drone.pos.y - target.pos.y });
        const strength = (1 - pullDistance / TRACTOR_RANGE) * (TRACTOR_PULL + this.wave * 3);
        target.vel.x += direction.x * strength * dt;
        target.vel.y += direction.y * strength * dt;
      }
    }
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
        this.hitThreat(meteor, punch, length(contactDirection) > 0.001 ? contactDirection : fallbackDirection);
        punch.phase = "returning";
        events.hit = true;
      }
    }
  }

  private hitThreat(meteor: Meteor, punch: Punch, direction?: Vec2): void {
    const outward = normalize({ x: meteor.pos.x - CENTER.x, y: meteor.pos.y - CENTER.y });
    const hitDirection = direction ?? outward;
    if (meteor.kind === "miniBoss") {
      if ((meteor.hitCooldown ?? 0) > 0) {
        return;
      }
      meteor.hp -= 1;
      meteor.hitCooldown = MINI_BOSS_HIT_COOLDOWN;
      meteor.pos.x += outward.x * 9;
      meteor.pos.y += outward.y * 9;
      meteor.vel.x = outward.x * (70 + this.wave * 6);
      meteor.vel.y = outward.y * (70 + this.wave * 6);
      this.score += 55 + this.wave * 12;
      this.sparks.push({ pos: { ...meteor.pos }, life: 0.2, maxLife: 0.2 });

      if (meteor.hp <= 0) {
        this.knockMeteor(meteor, hitDirection, PUNCH_KNOCK_SPEED + this.wave * 16, 520, 2);
      }
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
          this.explodeCore(explosive, events, Math.max(2, first.chain, second.chain));
          events.hit = true;
          continue;
        }

        const source = this.pickImpactSource(first, second);
        const target = source === first ? second : first;
        const normal = this.impactNormal(source, target);
        const overlap = minDistance - actualDistance + 0.1;
        source.pos.x -= normal.x * overlap * 0.35;
        source.pos.y -= normal.y * overlap * 0.35;
        target.pos.x += normal.x * overlap * 0.65;
        target.pos.y += normal.y * overlap * 0.65;

        if (!target.knocked) {
          const chainCount = Math.max(1, source.chain) + 1;
          const transferredSpeed = Math.max(
            CHAIN_KNOCK_SPEED + this.wave * 12,
            length(source.vel) * 0.82
          );
          this.damageThreatByImpact(target, normal, transferredSpeed, 140, chainCount);
          events.chainHits.push({
            pos: this.impactPoint(source, target, normal),
            count: chainCount
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

  private damageThreatByImpact(
    meteor: Meteor,
    direction: Vec2,
    speed: number,
    scoreBonus: number,
    chain: number
  ): void {
    if (meteor.kind !== "miniBoss") {
      this.knockMeteor(meteor, direction, speed, scoreBonus, chain);
      return;
    }

    meteor.hp -= 2;
    meteor.hitCooldown = MINI_BOSS_HIT_COOLDOWN;
    this.score += 95 + this.wave * 18 + scoreBonus;
    this.sparks.push({ pos: { ...meteor.pos }, life: 0.24, maxLife: 0.24 });
    if (meteor.hp <= 0) {
      this.knockMeteor(meteor, direction, speed, 580, chain);
    } else {
      meteor.pos.x += direction.x * 12;
      meteor.pos.y += direction.y * 12;
      meteor.vel.x = direction.x * Math.max(95, speed * 0.35);
      meteor.vel.y = direction.y * Math.max(95, speed * 0.35);
    }
  }

  private explodeCore(core: Meteor, events: SimulationEvents, chain: number): void {
    if (!core.alive) {
      return;
    }

    core.alive = false;
    this.defeated += 1;
    this.score += 210 + this.wave * 22;
    this.sparks.push({ pos: { ...core.pos }, life: 0.36, maxLife: 0.36 });

    for (const target of this.meteors) {
      if (!target.alive || target === core) {
        continue;
      }

      const blastDistance = distance(core.pos, target.pos);
      if (blastDistance > EXPLOSION_RADIUS + target.radius) {
        continue;
      }

      const direction = normalize({ x: target.pos.x - core.pos.x, y: target.pos.y - core.pos.y });
      const blastSpeed = PUNCH_KNOCK_SPEED + 70 + Math.max(0, EXPLOSION_RADIUS - blastDistance) * 0.7;
      if (target.knocked) {
        target.vel.x += direction.x * blastSpeed * 0.38;
        target.vel.y += direction.y * blastSpeed * 0.38;
      } else {
        this.damageThreatByImpact(target, direction, blastSpeed, 240, chain + 1);
      }
      events.chainHits.push({
        pos: { ...target.pos },
        count: chain + 1
      });
    }

    this.wave = 1 + Math.floor(this.defeated / 8);
  }

  private resolveSatelliteImpacts(events: SimulationEvents): void {
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
      const overlap = SATELLITE_RADIUS + meteor.radius - distance(meteor.pos, playerPos) + 0.1;
      meteor.pos.x += knockDirection.x * overlap;
      meteor.pos.y += knockDirection.y * overlap;
      this.deflectMeteor(meteor, knockDirection, SATELLITE_KNOCK_SPEED + this.wave * 14);
      this.cooldown = Math.max(this.cooldown, SATELLITE_HIT_LOCKOUT);
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
    chain = 1
  ): void {
    this.deflectMeteor(meteor, direction, speed, chain);
    this.defeated += 1;
    this.score += 100 + this.wave * 15 + scoreBonus;
    this.wave = 1 + Math.floor(this.defeated / 8);
  }

  private deflectMeteor(meteor: Meteor, direction: Vec2, speed: number, chain = 1): void {
    meteor.vel.x = direction.x * speed;
    meteor.vel.y = direction.y * speed;
    meteor.knocked = true;
    meteor.chain = chain;
    this.sparks.push({ pos: { ...meteor.pos }, life: 0.22, maxLife: 0.22 });
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
        this.explodeCore(meteor, events, 1);
        this.planetHp -= 32;
      } else {
        meteor.alive = false;
        this.planetHp -= this.planetDamage(meteor);
      }
      this.sparks.push({ pos: { ...meteor.pos }, life: 0.3, maxLife: 0.3 });
      events.planetHit = true;
    }
  }

  private planetDamage(meteor: Meteor): number {
    if (meteor.kind === "miniBoss") {
      return 38;
    }
    if (meteor.kind === "tractorDrone") {
      return 20;
    }
    if (meteor.kind === "orbitalSatellite") {
      return 16;
    }
    return 18;
  }
}

export const world = {
  width: WORLD_WIDTH,
  height: WORLD_HEIGHT,
  center: CENTER,
  planetRadius: PLANET_RADIUS,
  orbitRadius: ORBIT_RADIUS,
  outerRadius: OUTER_RADIUS
};
