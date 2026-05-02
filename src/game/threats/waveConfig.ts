import type { ThreatKind } from "../types";
import waveConfigData from "../data/threat-waves.json";

type ThreatWeights = Record<ThreatKind, number>;

type WaveThreatConfig = {
  wave: number;
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
    spawnWeights: {
      meteor: 100,
      explosiveCore: 0,
      orbitalSatellite: 0,
      tractorDrone: 0,
      miniBoss: 0
    }
  }
];

const sanitizeWeight = (weight: unknown): number => {
  if (typeof weight !== "number" || !Number.isFinite(weight)) {
    return 0;
  }
  return Math.max(0, weight);
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

const waveConfigs = loadWaveConfigs();

export const getThreatWeightsForWave = (wave: number): ThreatWeights => {
  const index = (((Math.max(1, Math.floor(wave)) - 1) % waveConfigs.length) + waveConfigs.length) %
    waveConfigs.length;
  const config = waveConfigs[index];

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
