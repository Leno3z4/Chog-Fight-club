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

export function createCombatant(dna) {
  const maxHp = combatData.health.maxHp;
  return {
    dna,
    hp: maxHp,
    maxHp,
    energy: dna.stats.energy,
    shield: 0,
    statuses: {},
    guarding: false,
    defeated: false,
    movement: { direction: "idle", velocityX: 0 },
    airborne: false,
    jumpTime: 0,
    evadeWindow: 0,
  };
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
  return resolveDamageAttack(attacker, defender, attack?.damageClass ?? "basic", attack?.type ?? "burst");
}

export function startTurn(combatant) {
  combatant.energy = clamp(combatant.energy + 1, 0, 10);
  combatant.guarding = false;

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
  const rounded = Math.max(0, Math.round(amount));
  const absorbed = Math.min(target.shield, rounded);
  target.shield -= absorbed;
  const damage = Math.max(0, rounded - absorbed);
  target.hp = Math.max(0, target.hp - damage);
  target.defeated = target.hp <= 0;
  return { damage, absorbed };
}

function getDamageProfile(kind) {
  return combatData.health[kind] ?? combatData.health.basic;
}

function resolveDamageAttack(attacker, defender, damageClass, type) {
  const profile = getDamageProfile(damageClass);
  const defenderStyle = defender.dna.abilitySet.backgroundStyle;
  const counter = getCounterMultiplier(type, defenderStyle);
  const guarded = defender.guarding ? combatData.health.guardMultiplier : 1;
  const raw = profile.base + attacker.dna.stats.attack * profile.attackScale - defender.dna.stats.defense * profile.defenseScale;
  const damage = clamp(Math.round(raw * counter * guarded), combatData.health.minDamage, profile.max);
  const result = dealDamage(defender, damage);
  return { action: damageClass === "special" ? ACTIONS.SPECIAL : damageClass === "base" ? ACTIONS.BASE : ACTIONS.BASIC, ...result, multiplier: counter };
}

export function resolveBasicAttack(attacker, defender) {
  return resolveDamageAttack(attacker, defender, "basic", "burst");
}

export function resolveAttack(attacker, defender) {
  return resolveBasicAttack(attacker, defender);
}

export function resolveGuard(combatant) {
  return resolveDefenseAbility(combatant);
}

export function resolveAbility(attacker, defender, slot = "base") {
  const ability = attacker.dna.abilitySet[slot];
  if (!ability) throw new Error(`Unknown ability slot: ${slot}`);
  return resolveAbilityAction(attacker, defender, ability, slot);
}

export function resolveBaseAbility(attacker, defender) {
  return resolveAbility(attacker, defender, "base");
}

export function resolveSpecialAbility(attacker, defender) {
  return resolveAbility(attacker, defender, "special");
}

export function resolveDefenseAbility(combatant) {
  const ability = combatant.dna.abilitySet.defense;
  if (!ability) throw new Error("Defense ability unavailable");
  if (combatant.energy < ability.cost) throw new Error("Not enough energy");
  combatant.energy -= ability.cost;
  combatant.guarding = true;
  combatant.shield = Math.min(combatData.shield.max, Math.max(combatant.shield, Math.round(combatant.dna.stats.defense * combatData.shield.defenseMultiplier)));
  return { action: ACTIONS.DEFENSE, abilityId: ability.id, shield: combatant.shield };
}

function resolveAbilityAction(attacker, defender, ability, slot) {
  if (attacker.energy < ability.cost) throw new Error("Not enough energy");
  attacker.energy -= ability.cost;

  if (ability.type === "defense") return resolveDefenseAbilityWithCostAlreadyPaid(attacker, ability);

  const defenderStyle = defender.dna.abilitySet.backgroundStyle;
  const counter = getCounterMultiplier(ability.type, defenderStyle);
  let result = { action: slot === "special" ? ACTIONS.SPECIAL : ACTIONS.BASE, abilityId: ability.id, multiplier: counter };

  if (ability.type === "mobility") {
    jump(attacker);
    result.evadeWindow = attacker.evadeWindow;
    return result;
  }

  const damageClass = slot === "special" ? "special" : "base";
  const profile = getDamageProfile(damageClass);
  const guarded = defender.guarding ? combatData.health.guardMultiplier : 1;
  const raw = profile.base + attacker.dna.stats.attack * profile.attackScale - defender.dna.stats.defense * profile.defenseScale;
  const damage = clamp(Math.round(raw * counter * guarded), combatData.health.minDamage, profile.max);
  const damageResult = dealDamage(defender, damage);
  result = { ...result, ...damageResult };

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

  return result;
}

function resolveDefenseAbilityWithCostAlreadyPaid(combatant, ability) {
  combatant.guarding = true;
  combatant.shield = Math.min(combatData.shield.max, Math.max(combatant.shield, Math.round(combatant.dna.stats.defense * combatData.shield.defenseMultiplier)));
  return { action: ACTIONS.DEFENSE, abilityId: ability.id, shield: combatant.shield };
}

export { COUNTERS, MOVEMENT, JUMP };
