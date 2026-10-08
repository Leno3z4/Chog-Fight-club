export const ACTIONS = {
  ATTACK: "attack",
  GUARD: "guard",
  ABILITY: "ability",
};

// Counter relationships are about play patterns, not raw elemental superiority.
const COUNTERS = {
  burst: { defense: 0.85, control: 1.08 },
  control: { mobility: 0.85, sustain: 1.08 },
  mobility: { burst: 0.9, disruption: 1.08 },
  defense: { burst: 1.15, disruption: 0.92 },
  sustain: { defense: 0.92, disruption: 1.1 },
  disruption: { sustain: 1.15, control: 0.92 },
  balanced: {},
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function getCounterMultiplier(attackerStyle, defenderStyle) {
  return COUNTERS[attackerStyle]?.[defenderStyle] ?? 1;
}

export function createCombatant(dna) {
  return {
    dna,
    hp: dna.stats.hp,
    maxHp: dna.stats.hp,
    energy: dna.stats.energy,
    shield: 0,
    statuses: {},
    guarding: false,
    defeated: false,
  };
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
    if (combatant.statuses.slowTurns <= 0) delete combatant.statuses.slow;
  }

  combatant.defeated = combatant.hp <= 0;
}

function dealDamage(target, amount) {
  const absorbed = Math.min(target.shield, amount);
  target.shield -= absorbed;
  const damage = Math.max(0, amount - absorbed);
  target.hp = Math.max(0, target.hp - damage);
  target.defeated = target.hp <= 0;
  return { damage, absorbed };
}

export function resolveAttack(attacker, defender) {
  const attackStyle = "burst";
  const defenderStyle = defender.dna.abilitySet.backgroundStyle;
  const counter = getCounterMultiplier(attackStyle, defenderStyle);
  const guarded = defender.guarding ? 0.5 : 1;
  const damage = Math.max(1, Math.round((attacker.dna.stats.attack * counter) - defender.dna.stats.defense * 0.35));
  const result = dealDamage(defender, damage * guarded);
  return { action: ACTIONS.ATTACK, ...result, multiplier: counter };
}

export function resolveGuard(combatant) {
  combatant.guarding = true;
  combatant.shield = Math.max(combatant.shield, Math.round(combatant.dna.stats.defense * 0.8));
  return { action: ACTIONS.GUARD, shield: combatant.shield };
}

export function resolveAbility(attacker, defender, abilityId) {
  const ability = attacker.dna.abilitySet.abilities.find((entry) => entry.id === abilityId);
  if (!ability) throw new Error(`Unknown ability: ${abilityId}`);
  if (attacker.energy < ability.cost) throw new Error("Not enough energy");

  attacker.energy -= ability.cost;
  const defenderStyle = defender.dna.abilitySet.backgroundStyle;
  const counter = getCounterMultiplier(ability.type, defenderStyle);
  let result = { action: ACTIONS.ABILITY, abilityId: ability.id, multiplier: counter };

  if (ability.type === "defense") {
    attacker.shield = Math.max(attacker.shield, Math.round(attacker.dna.stats.defense * 1.5 * counter));
    result.shield = attacker.shield;
    return result;
  }

  if (ability.type === "sustain") {
    attacker.hp = clamp(attacker.hp + Math.round(ability.power * counter), 0, attacker.maxHp);
    result.heal = Math.round(ability.power * counter);
    return result;
  }

  const rawDamage = Math.max(1, ability.power + attacker.dna.stats.attack * 0.45 - defender.dna.stats.defense * 0.25);
  const damageResult = dealDamage(defender, rawDamage * counter * (defender.guarding ? 0.5 : 1));
  result = { ...result, ...damageResult };

  if (ability.status === "burn") {
    defender.statuses.burn = Math.max(defender.statuses.burn ?? 0, 5);
    defender.statuses.burnTurns = 2;
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

export { COUNTERS };
