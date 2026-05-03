import type { ThreatKind } from "../types";
import waveConfigData from "../data/threat-waves.json";

type ThreatWeights = Record<ThreatKind, number>;

type NumericRange = {
  base: number;
  wave: number;
  random: number;
};

type ScoreConfig = {
  base: number;
  wave: number;
  defeatBonus: number;
};

type SpawnAngleConfig = {
  centerRadians: number;
  spreadRadians: number;
};

export type ThreatSpawnConfig = {
  score: ScoreConfig;
  radius: NumericRange;
  speed: NumericRange;
  aimRadius: NumericRange;
  spawnRadiusOffset: NumericRange;
  spawnAngle: SpawnAngleConfig;
  orbitRadius: NumericRange;
  orbitSpeed: NumericRange;
  hp: NumericRange;
};

type WaveModifiers = {
  score: number;
  radius: number;
  speed: number;
  aimRadius: number;
  spawnAngleSpread: number;
  spawnInterval: NumericRange;
};

type WaveThreatConfig = {
  wave: number;
  modifiers: WaveModifiers;
  spawnWeights: ThreatWeights;
};

const THREAT_KINDS: ThreatKind[] = [
  "meteor",
  "explosiveCore",
  "orbitalSatellite",
  "tractorDrone",
  "miniBoss"
];

const FALLBACK_WAVES: WaveThreatConfig[] = [
  {
    wave: 1,
    modifiers: {
      score: 1,
      radius: 1,
      speed: 1,
      aimRadius: 1,
      spawnAngleSpread: 1,
      spawnInterval: { base: 1.17, wave: 0, random: 0.45 }
    },
    spawnWeights: {
      meteor: 100,
      explosiveCore: 0,
      orbitalSatellite: 0,
      tractorDrone: 0,
      miniBoss: 0
    }
  }
];

const ZERO_RANGE: NumericRange = { base: 0, wave: 0, random: 0 };

const FALLBACK_THREAT_PARAMS: Record<ThreatKind, ThreatSpawnConfig> = {
  meteor: {
    score: { base: 100, wave: 15, defeatBonus: 0 },
    radius: { base: 25, wave: 0, random: 7 },
    speed: { base: 34, wave: 10, random: 16 },
    aimRadius: { base: 168, wave: 0, random: 0 },
    spawnRadiusOffset: ZERO_RANGE,
    spawnAngle: { centerRadians: 0, spreadRadians: Math.PI * 2 },
    orbitRadius: ZERO_RANGE,
    orbitSpeed: ZERO_RANGE,
    hp: { base: 1, wave: 0, random: 0 }
  },
  explosiveCore: {
    score: { base: 210, wave: 22, defeatBonus: 0 },
    radius: { base: 22, wave: 0, random: 0 },
    speed: { base: 34, wave: 8, random: 12 },
    aimRadius: { base: 132, wave: 0, random: 0 },
    spawnRadiusOffset: ZERO_RANGE,
    spawnAngle: { centerRadians: 0, spreadRadians: Math.PI * 2 },
    orbitRadius: ZERO_RANGE,
    orbitSpeed: ZERO_RANGE,
    hp: { base: 1, wave: 0, random: 0 }
  },
  orbitalSatellite: {
    score: { base: 100, wave: 15, defeatBonus: 0 },
    radius: { base: 20, wave: 0, random: 0 },
    speed: { base: 34, wave: 8, random: 14 },
    aimRadius: { base: 96, wave: 0, random: 0 },
    spawnRadiusOffset: ZERO_RANGE,
    spawnAngle: { centerRadians: 0, spreadRadians: Math.PI * 2 },
    orbitRadius: { base: 196, wave: 0, random: 34 },
    orbitSpeed: { base: 0.66, wave: 0.035, random: 0 },
    hp: { base: 1, wave: 0, random: 0 }
  },
  tractorDrone: {
    score: { base: 100, wave: 15, defeatBonus: 0 },
    radius: { base: 23, wave: 0, random: 0 },
    speed: { base: 25.16, wave: 7, random: 10 },
    aimRadius: { base: 188, wave: 0, random: 0 },
    spawnRadiusOffset: ZERO_RANGE,
    spawnAngle: { centerRadians: 0, spreadRadians: Math.PI * 2 },
    orbitRadius: ZERO_RANGE,
    orbitSpeed: ZERO_RANGE,
    hp: { base: 1, wave: 0, random: 0 }
  },
  miniBoss: {
    score: { base: 100, wave: 15, defeatBonus: 520 },
    radius: { base: 42, wave: 0, random: 0 },
    speed: { base: 19.72, wave: 4, random: 0 },
    aimRadius: { base: 72, wave: 0, random: 0 },
    spawnRadiusOffset: { base: 24, wave: 0, random: 0 },
    spawnAngle: { centerRadians: 0, spreadRadians: Math.PI * 2 },
    orbitRadius: ZERO_RANGE,
    orbitSpeed: ZERO_RANGE,
    hp: { base: 4, wave: 0, random: 0 }
  }
};

const sanitizeWeight = (weight: unknown): number => {
  if (typeof weight !== "number" || !Number.isFinite(weight)) {
    return 0;
  }
  return Math.max(0, weight);
};

const sanitizeNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const sanitizePositiveMultiplier = (value: unknown): number => {
  const sanitized = sanitizeNumber(value, 1);
  return sanitized > 0 ? sanitized : 1;
};

const sanitizeRange = (config: unknown, fallback: NumericRange): NumericRange => {
  const item = config as Partial<NumericRange> | undefined;
  return {
    base: sanitizeNumber(item?.base, fallback.base),
    wave: sanitizeNumber(item?.wave, fallback.wave),
    random: Math.max(0, sanitizeNumber(item?.random, fallback.random))
  };
};

const sanitizeScore = (config: unknown, fallback: ScoreConfig): ScoreConfig => {
  const item = config as Partial<ScoreConfig> | undefined;
  return {
    base: sanitizeNumber(item?.base, fallback.base),
    wave: sanitizeNumber(item?.wave, fallback.wave),
    defeatBonus: sanitizeNumber(item?.defeatBonus, fallback.defeatBonus)
  };
};

const sanitizeSpawnAngle = (config: unknown, fallback: SpawnAngleConfig): SpawnAngleConfig => {
  const item = config as { centerDegrees?: unknown; spreadDegrees?: unknown } | undefined;
  const fallbackCenter = (fallback.centerRadians * 180) / Math.PI;
  const fallbackSpread = (fallback.spreadRadians * 180) / Math.PI;
  const centerDegrees = sanitizeNumber(item?.centerDegrees, fallbackCenter);
  const spreadDegrees = Math.max(
    0,
    Math.min(360, sanitizeNumber(item?.spreadDegrees, fallbackSpread))
  );

  return {
    centerRadians: (centerDegrees * Math.PI) / 180,
    spreadRadians: (spreadDegrees * Math.PI) / 180
  };
};

const normalizeThreatParams = (config: unknown): Record<ThreatKind, ThreatSpawnConfig> => {
  const source = config as Partial<Record<ThreatKind, unknown>> | undefined;
  return THREAT_KINDS.reduce<Record<ThreatKind, ThreatSpawnConfig>>(
    (params, kind) => {
      const fallback = FALLBACK_THREAT_PARAMS[kind];
      const item = source?.[kind] as Partial<ThreatSpawnConfig> | undefined;
      params[kind] = {
        score: sanitizeScore(item?.score, fallback.score),
        radius: sanitizeRange(item?.radius, fallback.radius),
        speed: sanitizeRange(item?.speed, fallback.speed),
        aimRadius: sanitizeRange(item?.aimRadius, fallback.aimRadius),
        spawnRadiusOffset: sanitizeRange(item?.spawnRadiusOffset, fallback.spawnRadiusOffset),
        spawnAngle: sanitizeSpawnAngle(item?.spawnAngle, fallback.spawnAngle),
        orbitRadius: sanitizeRange(item?.orbitRadius, fallback.orbitRadius),
        orbitSpeed: sanitizeRange(item?.orbitSpeed, fallback.orbitSpeed),
        hp: sanitizeRange(item?.hp, fallback.hp)
      };
      return params;
    },
    { ...FALLBACK_THREAT_PARAMS }
  );
};

const normalizeWaveModifiers = (config: unknown): WaveModifiers => {
  const item = config as Partial<WaveModifiers> | undefined;
  return {
    score: sanitizePositiveMultiplier(item?.score),
    radius: sanitizePositiveMultiplier(item?.radius),
    speed: sanitizePositiveMultiplier(item?.speed),
    aimRadius: sanitizePositiveMultiplier(item?.aimRadius),
    spawnAngleSpread: sanitizePositiveMultiplier(item?.spawnAngleSpread),
    spawnInterval: sanitizeRange(item?.spawnInterval, FALLBACK_WAVES[0].modifiers.spawnInterval)
  };
};

const normalizeWaveConfig = (config: unknown, index: number): WaveThreatConfig => {
  const item = config as Partial<WaveThreatConfig> | undefined;
  const rawWeights = item?.spawnWeights as Partial<ThreatWeights> | undefined;
  const spawnWeights = THREAT_KINDS.reduce<ThreatWeights>(
    (weights, kind) => ({
      ...weights,
      [kind]: sanitizeWeight(rawWeights?.[kind])
    }),
    {
      meteor: 0,
      explosiveCore: 0,
      orbitalSatellite: 0,
      tractorDrone: 0,
      miniBoss: 0
    }
  );

  return {
    wave: typeof item?.wave === "number" && Number.isFinite(item.wave) ? item.wave : index + 1,
    modifiers: normalizeWaveModifiers(item?.modifiers),
    spawnWeights
  };
};

const loadWaveConfigs = (): WaveThreatConfig[] => {
  const source = waveConfigData as { waves?: unknown[] };
  const waves = Array.isArray(source.waves)
    ? source.waves.map((wave, index) => normalizeWaveConfig(wave, index))
    : [];

  return waves.some((wave) => totalWeight(wave.spawnWeights) > 0) ? waves : FALLBACK_WAVES;
};

const totalWeight = (weights: ThreatWeights): number =>
  THREAT_KINDS.reduce((total, kind) => total + weights[kind], 0);

const rollRange = (range: NumericRange, wave: number): number =>
  range.base + Math.max(0, wave) * range.wave + Math.random() * range.random;

const waveConfigs = loadWaveConfigs();
const threatParams = normalizeThreatParams((waveConfigData as { threatParams?: unknown }).threatParams);

const getWaveConfigForWave = (wave: number): WaveThreatConfig => {
  const index = (((Math.max(1, Math.floor(wave)) - 1) % waveConfigs.length) + waveConfigs.length) %
    waveConfigs.length;
  return waveConfigs[index];
};

export const getThreatWeightsForWave = (wave: number): ThreatWeights => {
  const config = getWaveConfigForWave(wave);

  if (totalWeight(config.spawnWeights) <= 0) {
    return FALLBACK_WAVES[0].spawnWeights;
  }

  return config.spawnWeights;
};

export const pickWeightedThreatKind = (
  wave: number,
  canSpawnMiniBoss: boolean
): ThreatKind => {
  const weights = { ...getThreatWeightsForWave(wave) };
  if (!canSpawnMiniBoss) {
    weights.miniBoss = 0;
  }

  const total = totalWeight(weights);
  if (total <= 0) {
    return "meteor";
  }

  let roll = Math.random() * total;
  for (const kind of THREAT_KINDS) {
    roll -= weights[kind];
    if (roll < 0) {
      return kind;
    }
  }

  return "meteor";
};

export const hasMiniBossForWave = (wave: number): boolean =>
  getThreatWeightsForWave(wave).miniBoss > 0;

export const rollThreatSpawnConfig = (kind: ThreatKind, wave: number) => {
  const params = threatParams[kind];
  const modifiers = getWaveConfigForWave(wave).modifiers;
  const angleSpread = Math.min(
    Math.PI * 2,
    params.spawnAngle.spreadRadians * modifiers.spawnAngleSpread
  );

  return {
    radius: rollRange(params.radius, wave) * modifiers.radius,
    speed: rollRange(params.speed, wave) * modifiers.speed,
    aimRadius: rollRange(params.aimRadius, wave) * modifiers.aimRadius,
    spawnRadiusOffset: rollRange(params.spawnRadiusOffset, wave),
    spawnAngle: params.spawnAngle.centerRadians + (Math.random() - 0.5) * angleSpread,
    orbitRadius: rollRange(params.orbitRadius, wave),
    orbitSpeed: rollRange(params.orbitSpeed, wave),
    hp: Math.max(1, Math.round(rollRange(params.hp, wave)))
  };
};

export const scoreForThreat = (kind: ThreatKind, wave: number, extraBonus = 0): number => {
  const params = threatParams[kind].score;
  const modifier = getWaveConfigForWave(wave).modifiers.score;
  return Math.round((params.base + Math.max(0, wave) * params.wave) * modifier + extraBonus);
};

export const defeatBonusForThreat = (kind: ThreatKind, wave: number): number => {
  const modifier = getWaveConfigForWave(wave).modifiers.score;
  return Math.round(threatParams[kind].score.defeatBonus * modifier);
};

export const rollSpawnIntervalForWave = (wave: number): number => {
  const interval = getWaveConfigForWave(wave).modifiers.spawnInterval;
  return Math.max(0.1, rollRange(interval, 0));
};
