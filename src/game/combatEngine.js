import combatData from "./data/combat.json";

export const ACTIONS = {
  BASIC: "basic",
  BASE: "base",
  SPECIAL: "special",
  DEFENSE: "defense",
  JUMP: "jump",
  MOVE: "move",
};

const COUNTERS = {
  burst: { defense: 0.85, control: 1.08 },
  control: { mobility: 0.85, sustain: 1.08 },
  mobility: { burst: 0.9, disruption: 1.08 },
  defense: { burst: 1.15, disruption: 0.92 },
  sustain: { defense: 0.92, disruption: 1.1 },
  disruption: { sustain: 1.15, control: 0.92 },
  balanced: {},
};

const MOVEMENT = { left: -1, right: 1, idle: 0 };
const JUMP = { velocity: -620, duration: combatData.movement.jumpEvadeWindowMs / 1000 };

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function getCounterMultiplier(attackerStyle, defenderStyle) {
  return clamp(COUNTERS[attackerStyle]?.[defenderStyle] ?? 1, combatData.health.counterCap.min, combatData.health.counterCap.max);
}

export function getDefenseBlockPercent(combatant) {
  const tier = combatant.dna?.identity?.tier ?? combatant.dna?.traits?.Tier ?? "Common";
  return combatData.health.defense.blockPercentByTier[tier] ?? combatData.health.defense.blockPercentByTier.Common;
}

export function createCombatant(dna) {
  const maxHp = combatData.health.maxHp;
  return {
    dna,
    hp: maxHp,
    maxHp,
    energy: combatData.energy.start,
    maxEnergy: combatData.energy.max,
    energyRegenPerSecond: combatData.energy.regenPerSecond,
    statuses: {},
    guarding: false,
    guardTimeRemaining: 0,
    defeated: false,
    cooldowns: { basic: 0, base: 0, special: 0 },
    movement: { direction: "idle", velocityX: 0 },
    airborne: false,
    jumpTime: 0,
    evadeWindow: 0,
  };
}

export function updateCombatant(combatant, deltaMs) {
  const deltaSeconds = Math.max(0, deltaMs) / 1000;
  combatant.energy = clamp(combatant.energy + combatant.energyRegenPerSecond * deltaSeconds, 0, combatant.maxEnergy);

  for (const action of Object.keys(combatant.cooldowns)) {
    combatant.cooldowns[action] = Math.max(0, combatant.cooldowns[action] - deltaMs);
  }

  if (combatant.guarding) {
    combatant.guardTimeRemaining = Math.max(0, combatant.guardTimeRemaining - deltaMs);
    if (combatant.guardTimeRemaining === 0) combatant.guarding = false;
  }
}

export function updateCooldowns(combatant, deltaMs) {
  updateCombatant(combatant, deltaMs);
}

export function isActionReady(combatant, action) {
  return (combatant.cooldowns[action] ?? 0) <= 0;
}

export function getCooldownRemaining(combatant, action) {
  return Math.max(0, combatant.cooldowns[action] ?? 0);
}

function startCooldown(combatant, action) {
  combatant.cooldowns[action] = combatData.cooldowns[action] ?? 0;
}

function getEnergyCost(action) {
  return combatData.energy.costPercent[action] ?? 0;
}

export function canUseOffensiveAction(combatant, action) {
  return isActionReady(combatant, action) && combatant.energy >= getEnergyCost(action);
}

export function beginOffensiveAction(combatant, action) {
  if (!isActionReady(combatant, action)) throw new Error(`${action.toUpperCase()} RELOADING`);
  const cost = getEnergyCost(action);
  if (combatant.energy < cost) throw new Error("NOT ENOUGH ENERGY");
  combatant.energy = clamp(combatant.energy - cost, 0, combatant.maxEnergy);
  startCooldown(combatant, action);
  return { energyCost: cost, cooldownMs: combatData.cooldowns[action] };
}

export function move(combatant, direction) {
  if (!(direction in MOVEMENT)) throw new Error("Unknown movement direction");
  combatant.movement.direction = direction;
  combatant.movement.velocityX = MOVEMENT[direction] * combatant.dna.stats.speed;
  return { action: ACTIONS.MOVE, direction, velocityX: combatant.movement.velocityX };
}

export function jump(combatant) {
  if (combatant.airborne) return { action: ACTIONS.JUMP, started: false };
  combatant.airborne = true;
  combatant.jumpTime = JUMP.duration;
  combatant.evadeWindow = JUMP.duration;
  return { action: ACTIONS.JUMP, started: true, velocityY: JUMP.velocity, evadeWindow: JUMP.duration };
}

export function updateMovement(combatant, deltaSeconds) {
  if (!combatant.airborne) return;
  combatant.jumpTime = Math.max(0, combatant.jumpTime - deltaSeconds);
  combatant.evadeWindow = Math.max(0, combatant.evadeWindow - deltaSeconds);
  if (combatant.jumpTime === 0) combatant.airborne = false;
}

export function canEvadeIncomingAttack(combatant, attack) {
  return Boolean(combatant.airborne && combatant.evadeWindow > 0 && attack?.canBeEvaded !== false);
}

export function resolveIncomingAttack(attacker, defender, attack) {
  if (canEvadeIncomingAttack(defender, attack)) {
    return { action: attack.action ?? ACTIONS.BASIC, evaded: true, damage: 0 };
  }
  return resolveDamageAttack(attacker, defender, attack?.damageClass ?? "basic");
}

export function startTurn(combatant) {
  combatant.guarding = false;
  combatant.guardTimeRemaining = 0;

  if (combatant.statuses.burn) {
    combatant.hp = Math.max(0, combatant.hp - combatant.statuses.burn);
    combatant.statuses.burnTurns = Math.max(0, (combatant.statuses.burnTurns ?? 1) - 1);
    if (!combatant.statuses.burnTurns) delete combatant.statuses.burn;
  }

  if (combatant.statuses.slowTurns) {
    combatant.statuses.slowTurns -= 1;
    if (combatant.statuses.slowTurns <= 0) {
      delete combatant.statuses.slow;
      delete combatant.statuses.slowTurns;
    }
  }

  combatant.defeated = combatant.hp <= 0;
}

function dealDamage(target, amount) {
  const incoming = Math.max(0, Math.round(amount));
  const blockPercent = target.guarding ? getDefenseBlockPercent(target) : 0;
  const blocked = Math.round(incoming * (blockPercent / 100));
  const damage = Math.max(0, incoming - blocked);

  target.hp = Math.max(0, target.hp - damage);
  target.defeated = target.hp <= 0;

  if (target.guarding) {
    target.guarding = false;
    target.guardTimeRemaining = 0;
  }

  return { damage, blocked, blockPercent };
}

function getDamageProfile(kind) {
  return combatData.health.damage[kind] ?? combatData.health.damage.basic;
}

function resolveDamageAttack(attacker, defender, damageClass) {
  const incomingDamage = getDamageProfile(damageClass);
  const result = dealDamage(defender, incomingDamage);
  return {
    action: damageClass === "special" ? ACTIONS.SPECIAL : damageClass === "base" ? ACTIONS.BASE : ACTIONS.BASIC,
    ...result,
    incomingDamage,
  };
}

export function resolveBasicAttack(attacker, defender, resourceAlreadySpent = false) {
  const resource = resourceAlreadySpent ? { energyCost: getEnergyCost("basic"), cooldownMs: combatData.cooldowns.basic } : beginOffensiveAction(attacker, "basic");
  return { ...resolveDamageAttack(attacker, defender, "basic"), ...resource };
}

export function resolveAttack(attacker, defender) {
  return resolveBasicAttack(attacker, defender);
}

export function resolveGuard(combatant) {
  return resolveDefenseAbility(combatant);
}

export function resolveAbility(attacker, defender, slot = "base", resourceAlreadySpent = false) {
  const ability = attacker.dna.abilitySet[slot];
  if (!ability) throw new Error(`Unknown ability slot: ${slot}`);
  return resolveAbilityAction(attacker, defender, ability, slot, resourceAlreadySpent);
}

export function resolveBaseAbility(attacker, defender, resourceAlreadySpent = false) {
  return resolveAbility(attacker, defender, "base", resourceAlreadySpent);
}

export function resolveSpecialAbility(attacker, defender, resourceAlreadySpent = false) {
  return resolveAbility(attacker, defender, "special", resourceAlreadySpent);
}

export function resolveDefenseAbility(combatant) {
  const ability = combatant.dna.abilitySet.defense;
  if (!ability) throw new Error("Defense ability unavailable");
  combatant.guarding = true;
  combatant.guardTimeRemaining = combatData.health.defense.windowMs;
  const blockPercent = getDefenseBlockPercent(combatant);
  return {
    action: ACTIONS.DEFENSE,
    abilityId: ability.id,
    blockPercent,
    energyCost: 0,
    windowMs: combatData.health.defense.windowMs,
  };
}

function resolveAbilityAction(attacker, defender, ability, slot, resourceAlreadySpent) {
  const resource = resourceAlreadySpent ? { energyCost: getEnergyCost(slot), cooldownMs: combatData.cooldowns[slot] } : beginOffensiveAction(attacker, slot);
  const damageClass = slot === "special" ? "special" : "base";
  const result = resolveDamageAttack(attacker, defender, damageClass);

  if (ability.status === "burn") {
    defender.statuses.burn = combatData.health.statusDamage.burn;
    defender.statuses.burnTurns = combatData.health.statusDamage.burnTurns;
  } else if (ability.status === "slow") {
    defender.statuses.slow = true;
    defender.statuses.slowTurns = 2;
  } else if (ability.status === "stun") {
    defender.statuses.stun = true;
  } else if (ability.status === "weaken") {
    defender.statuses.weaken = 0.8;
  }

  if (ability.type === "mobility") jump(attacker);

  return {
    ...result,
    action: slot === "special" ? ACTIONS.SPECIAL : ACTIONS.BASE,
    abilityId: ability.id,
    ...resource,
  };
}

export { COUNTERS, MOVEMENT, JUMP };
