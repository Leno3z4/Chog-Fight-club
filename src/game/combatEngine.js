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
const JUMP = { velocity: 12, duration: 0.9 };

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
  return {
    action: ACTIONS.MOVE,
    direction,
    velocityX: combatant.movement.velocityX,
  };
}

export function jump(combatant) {
  if (combatant.airborne) return { action: ACTIONS.JUMP, started: false };
  combatant.airborne = true;
  combatant.jumpTime = JUMP.duration;
  combatant.evadeWindow = JUMP.duration;
  return {
    action: ACTIONS.JUMP,
    started: true,
    velocityY: JUMP.velocity,
    evadeWindow: JUMP.duration,
  };
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
  return resolveDamageAttack(attacker, defender, attack?.power ?? attacker.dna.stats.attack, attack?.type ?? "burst");
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

function resolveDamageAttack(attacker, defender, power, type) {
  const defenderStyle = defender.dna.abilitySet.backgroundStyle;
  const counter = getCounterMultiplier(type, defenderStyle);
  const guarded = defender.guarding ? 0.5 : 1;
  const damage = Math.max(1, Math.round((power + attacker.dna.stats.attack * 0.45) * counter - defender.dna.stats.defense * 0.35));
  const result = dealDamage(defender, damage * guarded);
  return { action: ACTIONS.BASIC, ...result, multiplier: counter };
}

export function resolveBasicAttack(attacker, defender) {
  return resolveDamageAttack(attacker, defender, attacker.dna.stats.attack, "burst");
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
  return resolveAbilityAction(attacker, defender, ability);
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
  combatant.shield = Math.max(combatant.shield, Math.round(combatant.dna.stats.defense * 1.5));
  return { action: ACTIONS.DEFENSE, abilityId: ability.id, shield: combatant.shield };
}

function resolveAbilityAction(attacker, defender, ability) {
  if (attacker.energy < ability.cost) throw new Error("Not enough energy");
  attacker.energy -= ability.cost;

  if (ability.type === "defense") return resolveDefenseAbilityWithCostAlreadyPaid(attacker, ability);

  const defenderStyle = defender.dna.abilitySet.backgroundStyle;
  const counter = getCounterMultiplier(ability.type, defenderStyle);
  let result = { action: ability.type === "disruption" ? ACTIONS.SPECIAL : ACTIONS.BASE, abilityId: ability.id, multiplier: counter };

  if (ability.type === "mobility") {
    jump(attacker);
    result.evadeWindow = attacker.evadeWindow;
  } else {
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
  }

  return result;
}

function resolveDefenseAbilityWithCostAlreadyPaid(combatant, ability) {
  combatant.guarding = true;
  combatant.shield = Math.max(combatant.shield, Math.round(combatant.dna.stats.defense * 1.5));
  return { action: ACTIONS.DEFENSE, abilityId: ability.id, shield: combatant.shield };
}

export { COUNTERS, MOVEMENT, JUMP };
