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
