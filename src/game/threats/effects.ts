import { distance, normalize } from "../math";
import type { HitSpark, Meteor, SimulationEvents, Vec2 } from "../types";
import { EXPLOSION_RADIUS, MINI_BOSS_HIT_COOLDOWN, PUNCH_KNOCK_SPEED } from "./config";
import { defeatBonusForThreat, scoreForThreat } from "./waveConfig";

export type ThreatEffectState = {
  wave: number;
  defeated: number;
  score: number;
  sparks: HitSpark[];
};

export type ThreatEffectResult = {
  defeated: number;
  score: number;
  wave: number;
};

export const planetDamage = (meteor: Meteor): number => {
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
};

export const damageThreatByImpact = (
  meteor: Meteor,
  direction: Vec2,
  speed: number,
  scoreBonus: number,
  chain: number,
  state: ThreatEffectState,
  knockMeteor: (
    meteor: Meteor,
    direction: Vec2,
    speed: number,
    scoreBonus: number,
    chain: number
  ) => void
): void => {
  if (meteor.kind !== "miniBoss") {
    knockMeteor(meteor, direction, speed, scoreBonus, chain);
    return;
  }

  meteor.hp -= 2;
  meteor.hitCooldown = MINI_BOSS_HIT_COOLDOWN;
  state.score += 95 + state.wave * 18 + scoreBonus;
  state.sparks.push({ pos: { ...meteor.pos }, life: 0.24, maxLife: 0.24 });
  if (meteor.hp <= 0) {
    meteor.alive = false;
    state.defeated += 1;
    state.score += scoreForThreat(
      meteor.kind,
      state.wave,
      scoreBonus + defeatBonusForThreat(meteor.kind, state.wave)
    );
    state.sparks.push({ pos: { ...meteor.pos }, life: 0.3, maxLife: 0.3 });
  }
};

export const explodeCore = (
  core: Meteor,
  meteors: Meteor[],
  events: SimulationEvents,
  chain: number,
  state: ThreatEffectState,
  damageByImpact: (
    meteor: Meteor,
    direction: Vec2,
    speed: number,
    scoreBonus: number,
    chain: number
  ) => void,
  recoverShield: (chain: number) => number = () => 0
): ThreatEffectResult => {
  if (!core.alive) {
    return finish(state);
  }

  core.alive = false;
  state.defeated += 1;
  state.score += scoreForThreat(core.kind, state.wave);
  state.sparks.push({ pos: { ...core.pos }, life: 0.36, maxLife: 0.36 });

  for (const target of meteors) {
    if (!target.alive || target === core) {
      continue;
    }

    const blastDistance = distance(core.pos, target.pos);
    if (blastDistance > EXPLOSION_RADIUS + target.radius) {
      continue;
    }

    const direction = normalize({ x: target.pos.x - core.pos.x, y: target.pos.y - core.pos.y });
    const blastSpeed = PUNCH_KNOCK_SPEED + 70 + Math.max(0, EXPLOSION_RADIUS - blastDistance) * 0.7;
    const nextChain = chain + 1;
    let shieldRecovery = 0;
    if (target.knocked) {
      target.vel.x += direction.x * blastSpeed * 0.38;
      target.vel.y += direction.y * blastSpeed * 0.38;
    } else {
      damageByImpact(target, direction, blastSpeed, 240, nextChain);
      shieldRecovery = recoverShield(nextChain);
    }
    events.chainHits.push({
      pos: { ...target.pos },
      count: nextChain,
      shieldRecovery
    });
  }

  return finish(state);
};

const finish = (state: ThreatEffectState): ThreatEffectResult => ({
  defeated: state.defeated,
  score: state.score,
  wave: 1 + Math.floor(state.defeated / 8)
});
