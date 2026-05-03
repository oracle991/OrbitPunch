import upgradeData from "./data/upgrades.json";

export type UpgradeId =
  | "orbitalAcceleration"
  | "longArm"
  | "quickPunch"
  | "recoverySystem"
  | "homingKnockback"
  | "chainMagnet"
  | "shieldSiphon"
  | "explosiveCoreResonance"
  | "wideGlove"
  | "perfectTiming"
  | "orbitalShield"
  | "emergencyBoost"
  | "planetRepair"
  | "twinPunch"
  | "overdrive"
  | "starburst"
  | "punchReload";

export type UpgradeKind = "multi" | "single" | "instant";

export type UpgradeEffect = Record<string, number>;

export type UpgradeDefinition = {
  id: UpgradeId;
  name: string;
  kind: UpgradeKind;
  maxLevel: number;
  descriptions: string[];
  effects?: UpgradeEffect[];
  effect?: UpgradeEffect;
};

export type UpgradeChoice = {
  id: UpgradeId;
  name: string;
  title: string;
  description: string;
  kind: UpgradeKind;
  level: number;
  maxLevel: number;
};

export type UpgradeConfig = {
  selectionCount: number;
  upgrades: UpgradeDefinition[];
};

export const upgradeConfig = upgradeData as UpgradeConfig;
export const upgradeDefinitions = upgradeConfig.upgrades;

export const createUpgradeLevels = (): Record<UpgradeId, number> => {
  return Object.fromEntries(upgradeDefinitions.map((definition) => [definition.id, 0])) as Record<
    UpgradeId,
    number
  >;
};

export const upgradeDefinitionById = (id: UpgradeId): UpgradeDefinition | undefined => {
  return upgradeDefinitions.find((definition) => definition.id === id);
};

export const romanLevel = (level: number): string => {
  return ["I", "II", "III", "IV", "V"][level - 1] ?? String(level);
};
