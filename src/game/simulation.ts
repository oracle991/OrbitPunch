export type Vec2 = {
  x: number;
  y: number;
};

export type Meteor = {
  id: number;
  pos: Vec2;
  vel: Vec2;
  radius: number;
  alive: boolean;
  knocked: boolean;
  spin: number;
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
const METEOR_BASE_SPEED = 54;
const PUNCH_KNOCK_SPEED = 280;
const SATELLITE_KNOCK_SPEED = 250;
const SATELLITE_HIT_LOCKOUT = 1.35;
const CHAIN_KNOCK_SPEED = 238;
const PUNCH_CHAIN_RADIUS = 9;
const SPAWN_BASE_INTERVAL = 1.25;

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
    const events = { hit: false, satelliteHit: false, planetHit: false, gameOver: false };
    if (this.gameOver) {
      return events;
    }

    this.playerAngle += PLAYER_ORBIT_SPEED * dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.spawnTimer -= dt;

    if (this.spawnTimer <= 0) {
      this.spawnMeteor();
      const pace = Math.max(0.48, SPAWN_BASE_INTERVAL - this.wave * 0.08);
      this.spawnTimer = pace + Math.random() * 0.45;
    }

    this.updatePunches(dt);

    for (const meteor of this.meteors) {
      meteor.pos.x += meteor.vel.x * dt;
      meteor.pos.y += meteor.vel.y * dt;
      meteor.spin += dt * 4;
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

  private spawnMeteor(): void {
    const angle = Math.random() * Math.PI * 2;
    const spawn = radialPoint(angle, OUTER_RADIUS);
    const inward = normalize({ x: CENTER.x - spawn.x, y: CENTER.y - spawn.y });
    const speed = METEOR_BASE_SPEED + this.wave * 10 + Math.random() * 16;
    this.meteors.push({
      id: nextId++,
      pos: spawn,
      vel: { x: inward.x * speed, y: inward.y * speed },
      radius: 17 + Math.random() * 7,
      alive: true,
      knocked: false,
      spin: Math.random() * Math.PI * 2
    });
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
          const outward = normalize({ x: meteor.pos.x - CENTER.x, y: meteor.pos.y - CENTER.y });
          this.knockMeteor(meteor, outward, PUNCH_KNOCK_SPEED + this.wave * 18);
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
        this.knockMeteor(
          meteor,
          length(contactDirection) > 0.001 ? contactDirection : fallbackDirection,
          PUNCH_KNOCK_SPEED + this.wave * 18
        );
        punch.phase = "returning";
        events.hit = true;
      }
    }
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

        const source = this.pickImpactSource(first, second);
        const target = source === first ? second : first;
        const normal = this.impactNormal(source, target);
        const overlap = minDistance - actualDistance + 0.1;
        source.pos.x -= normal.x * overlap * 0.35;
        source.pos.y -= normal.y * overlap * 0.35;
        target.pos.x += normal.x * overlap * 0.65;
        target.pos.y += normal.y * overlap * 0.65;

        if (!target.knocked) {
          const transferredSpeed = Math.max(
            CHAIN_KNOCK_SPEED + this.wave * 12,
            length(source.vel) * 0.82
          );
          this.knockMeteor(target, normal, transferredSpeed, 140);
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

  private knockMeteor(meteor: Meteor, direction: Vec2, speed: number, scoreBonus = 0): void {
    this.deflectMeteor(meteor, direction, speed);
    this.defeated += 1;
    this.score += 100 + this.wave * 15 + scoreBonus;
    this.wave = 1 + Math.floor(this.defeated / 8);
  }

  private deflectMeteor(meteor: Meteor, direction: Vec2, speed: number): void {
    meteor.vel.x = direction.x * speed;
    meteor.vel.y = direction.y * speed;
    meteor.knocked = true;
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

      meteor.alive = false;
      this.planetHp -= 18;
      this.sparks.push({ pos: { ...meteor.pos }, life: 0.3, maxLife: 0.3 });
      events.planetHit = true;
    }
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
