import { getAttackCue, getAttackPresentation } from "./attackPresentation.js";
import { canUseOffensiveAction, getCooldownRemaining } from "./combatEngine.js";

export const AI_ACTIONS = {
  APPROACH: "approach",
  RETREAT: "retreat",
  BASIC: "basic",
  BASE: "base",
  SPECIAL: "special",
  DEFENSE: "defense",
  JUMP: "jump",
};

const OPPONENT_ATTACK_PATTERNS = [
  {
    slot: "basic",
    telegraphMs: 550,
    nextDelayMs: 1900,
    timing: { startup: 330, active: 100, recovery: 120 },
  },
  {
    slot: "base",
    telegraphMs: 850,
    nextDelayMs: 1900,
    timing: { startup: 520, active: 110, recovery: 220 },
  },
  {
    slot: "special",
    telegraphMs: 700,
    nextDelayMs: 1650,
    timing: { startup: 420, active: 100, recovery: 180 },
  },
];

export function getOpponentAttackPattern(index = 0, abilitySet = {}) {
  const patternIndex = ((Math.floor(index) % OPPONENT_ATTACK_PATTERNS.length) + OPPONENT_ATTACK_PATTERNS.length)
    % OPPONENT_ATTACK_PATTERNS.length;
  const profile = OPPONENT_ATTACK_PATTERNS[patternIndex];
  const ability = abilitySet?.[profile.slot] ?? null;
  const canBeEvaded = profile.slot !== "special" || !["control", "disruption"].includes(ability?.type);
  const presentation = getAttackPresentation({ slot: profile.slot, ability });

  return {
    ...profile,
    id: profile.slot,
    slot: profile.slot,
    cue: getAttackCue({ slot: profile.slot, ability, canBeEvaded }),
    damageClass: profile.slot,
    canBeEvaded,
    timing: { ...profile.timing },
    animationSlot: profile.slot,
    motion: presentation.type,
    color: presentation.color,
    accentColor: presentation.accent,
    ability,
    auraFamily: presentation.family,
    heavy: profile.slot === "special",
  };
}

export function chooseOpponentAction({ self, target, distance, rng = Math.random }) {
  if (self.defeated) return { action: null, reason: "defeated" };

  if (distance > 310) {
    return { action: distance > 520 && rng() < 0.15 ? AI_ACTIONS.JUMP : AI_ACTIONS.APPROACH, reason: "close-distance" };
  }

  if (self.guarding && rng() < 0.7) return { action: AI_ACTIONS.RETREAT, reason: "recover-from-guard" };

  if (target.guarding && canUseOffensiveAction(self, "base") && rng() < 0.55) {
    return { action: AI_ACTIONS.BASE, reason: "pressure-defense" };
  }

  if (canUseOffensiveAction(self, "special") && getCooldownRemaining(self, "special") === 0 && self.energy >= 65 && rng() < 0.2) {
    return { action: AI_ACTIONS.SPECIAL, reason: "high-value-window" };
  }

  if (canUseOffensiveAction(self, "base") && rng() < 0.35) {
    return { action: AI_ACTIONS.BASE, reason: "base-pressure" };
  }

  if (canUseOffensiveAction(self, "basic")) {
    return { action: AI_ACTIONS.BASIC, reason: "basic-pressure" };
  }

  return { action: rng() < 0.35 ? AI_ACTIONS.DEFENSE : AI_ACTIONS.RETREAT, reason: "resource-recovery" };
}
