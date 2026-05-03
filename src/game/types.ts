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
  chainRootId?: number;
  spin: number;
  hp: number;
  maxHp: number;
  orbitAngle?: number;
  orbitRadius?: number;
  orbitSpeed?: number;
  orbitPhase?: number;
  orbitMajorRadius?: number;
  orbitMinorRadius?: number;
  orbitDirection?: number;
  spiralAngle?: number;
  spiralRadius?: number;
  spiralRadialSpeed?: number;
  spiralAngularSpeed?: number;
  spiralDirection?: number;
  hitCooldown?: number;
};

export type Punch = {
  id: number;
  orbitAngleOffset: number;
  origin: Vec2;
  pos: Vec2;
  vel: Vec2;
  direction: Vec2;
  chainPoints: Vec2[];
  chainTime: number;
  radius: number;
  distance: number;
  maxDistance: number;
  hold: number;
  life: number;
  maxLife: number;
  extendSpeed: number;
  returnSpeed: number;
  damageMultiplier: number;
  knockSpeedMultiplier: number;
  charged: boolean;
  hasHit: boolean;
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
  shieldRecovery?: number;
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
  charge: {
    held: boolean;
    active: boolean;
    canceled: boolean;
    progress: number;
  };
  satelliteInvulnerability: number;
  gameOver: boolean;
};

export type SimulationEvents = {
  hit: boolean;
  satelliteHit: boolean;
  planetHit: boolean;
  gameOver: boolean;
  waveAdvanced?: {
    from: number;
    to: number;
  };
  chainHits: ChainHit[];
};
