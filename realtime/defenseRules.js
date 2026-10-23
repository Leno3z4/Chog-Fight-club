export const DEFENSE_MAX_HOLD_MS = 10_000;
export const DEFENSE_COOLDOWN_MS = 2_000;

// Mutates the authoritative fighter state from the current held-key state.
// An automatic 10-second stop requires key release before another activation,
// so keeping the key down cannot bypass the cooldown.
export function updateHeldDefense(player, requested, now) {
  if (!player) return false;
  const held = Boolean(requested);
  player.defendRequested = held;
  player.guardCooldownUntil = Math.max(0, Number(player.guardCooldownUntil) || 0);
  player.guardStartedAt = Math.max(0, Number(player.guardStartedAt) || 0);
  player.defenseRequiresRelease = Boolean(player.defenseRequiresRelease);
  player.guarding = Boolean(player.guarding);

  if (!held) {
    if (player.guarding) {
      player.guarding = false;
      player.guardStartedAt = 0;
      player.guardCooldownUntil = now + DEFENSE_COOLDOWN_MS;
    }
    player.defenseRequiresRelease = false;
    return false;
  }

  if (player.guarding) {
    if (now - player.guardStartedAt >= DEFENSE_MAX_HOLD_MS) {
      player.guarding = false;
      player.guardStartedAt = 0;
      player.guardCooldownUntil = now + DEFENSE_COOLDOWN_MS;
      player.defenseRequiresRelease = true;
    }
    return player.guarding;
  }

  if (player.defenseRequiresRelease) return false;
  if (now < player.guardCooldownUntil) {
    player.defenseRequiresRelease = true;
    return false;
  }

  player.guarding = true;
  player.guardStartedAt = now;
  return true;
}

export function getGuardBlockPercent(tier) {
  return ({
    Common: 80,
    Uncommon: 85,
    Rare: 90,
    Epic: 90,
    Legendary: 100,
  })[tier] ?? 80;
}
