import assert from "node:assert/strict";
import { buildBattleDNA } from "./battleDNA.js";
import { AURA_GROUPS, BACKGROUND_GROUPS, resolveTraitGroups } from "./traitGroups.js";
import {
  canEvadeIncomingAttack,
  createCombatant,
  getCounterMultiplier,
  getDefenseBlockPercent,
  getCooldownRemaining,
  isActionReady,
  jump,
  move,
  resolveBaseAbility,
  resolveBasicAttack,
  resolveDefenseAbility,
  resolveIncomingAttack,
  resolveSpecialAbility,
  startTurn,
  updateCooldowns,
} from "./combatEngine.js";

const flameChog = {
  tokenId: 561, name: "Blaze", Tier: "Legendary", Base: "1:1", Form: "Chog", Skin: "Red",
  Body: "Tuxedo", Eyes: "Angry", Head: "Crown", Aura: "Burning Aura", Background: "Blood Red",
  Mouth: "Smile", Side: "Left", Naked: "No",
};

const waterChog = {
  tokenId: 973, name: "Test Water", Tier: "Common", Base: "Origin", Form: "Chog", Skin: "Blue",
  Body: "Stripes", Eyes: "Happy", Head: "Wizard Hat", Aura: "Aqua Aura", Background: "Aqua",
  Mouth: "Smile", Side: "Right", Naked: "No",
};

const first = buildBattleDNA(flameChog);
const second = buildBattleDNA(flameChog);
assert.deepEqual(first, second, "same metadata must resolve to the same Battle DNA");
assert.equal(first.groups.auraFamily, "flame");
assert.equal(first.groups.backgroundStyle, "burst");
assert.equal(first.groups.expression, "ignition");
assert.equal(first.identity.tier, "Legendary");
assert.ok(first.abilitySet.base);
assert.ok(first.abilitySet.special);
assert.ok(first.abilitySet.defense);
assert.equal(first.abilitySet.abilities.length, 3);

const water = buildBattleDNA(waterChog);
assert.equal(water.groups.auraFamily, "water");
assert.equal(water.groups.backgroundStyle, "control");
assert.equal(water.groups.expression, "tidal-bind");

const sourceAuras = [
  "Burning Aura", "Fiery Aura", "Aqua Aura", "Rose Aura", "Purple", "Mint",
  "Light Purple", "Wind", "Clean", "Royal Blue Aura", "Smoke", "Cool Aura",
  "Violet", "Yellow Aura", "Fire", "Royal Aura", "Green Aura", "Rose Scent",
  "Pink Mist", "Royal Blue", "Electric Shock", "White Aura",
];
const sourceBackgrounds = [
  "Light Purple", "Lemon", "Aqua", "Mon", "Sunlight", "Lemon Yellow", "Rosie",
  "Coral Pink", "Mint", "Peach Pink", "Light Magenta", "Soft Lavender", "Fresh Green",
  "Sky Blue", "Aqua Mint", "Rosy Pink", "Deep Aqua", "Lime Green", "Deep Blue",
  "Radioactive", "Deep Purple", "Gold", "Magenta", "Red Sky", "Bright Yellow",
  "Royal Blue", "Supreme Purple", "Afternoon Orange", "Aqua Blue", "Blood Red",
  "Noble Blue", "Rose Pink",
];

for (const value of sourceAuras) {
  const groups = resolveTraitGroups({ Aura: value, Background: "Light Purple" });
  assert.notEqual(groups.auraFamily, "neutral", `unmapped Aura: ${value}`);
}
for (const value of sourceBackgrounds) {
  const groups = resolveTraitGroups({ Aura: "Burning Aura", Background: value });
  assert.notEqual(groups.backgroundStyle, "neutral", `unmapped Background: ${value}`);
  assert.ok(groups.expression, `missing expression for Background: ${value}`);
}

const mappedAuras = Object.values(AURA_GROUPS).flat();
const mappedBackgrounds = Object.values(BACKGROUND_GROUPS).flat();
assert.equal(new Set(mappedAuras).size, sourceAuras.length, "Aura mappings must not duplicate values");
assert.equal(new Set(mappedBackgrounds).size, sourceBackgrounds.length, "Background mappings must not duplicate values");

assert.ok(getCounterMultiplier("burst", "defense") > 1);
assert.ok(getCounterMultiplier("defense", "burst") > 1);
assert.ok(getCounterMultiplier("control", "mobility") < 1);

const attacker = createCombatant(first);
const defender = createCombatant(water);
assert.equal(attacker.hp, 100, "every Chog starts with exactly 100 HP");
assert.equal(attacker.maxHp, 100, "every Chog has exactly 100 max HP");
assert.equal(defender.hp, 100, "every defender starts with exactly 100 HP");
assert.equal(attacker.energy, 100, "offensive energy starts full");
assert.equal(attacker.maxEnergy, 100);

const basicResult = resolveBasicAttack(attacker, defender);
assert.equal(basicResult.damage, 4, "basic attack must deal exactly 4 HP");
assert.equal(basicResult.energyCost, 5, "basic attack costs 5% energy");
assert.equal(attacker.energy, 95);
assert.equal(defender.hp, 96);
assert.equal(isActionReady(attacker, "basic"), false, "basic must enter cooldown");
assert.equal(getCooldownRemaining(attacker, "basic"), 500);
updateCooldowns(attacker, 499);
assert.equal(isActionReady(attacker, "basic"), false);
updateCooldowns(attacker, 1);
assert.equal(isActionReady(attacker, "basic"), true, "basic cooldown must be 0.5 seconds");

const baseAttacker = createCombatant(first);
const baseDefender = createCombatant(water);
const baseEnergy = baseAttacker.energy;
const baseResult = resolveBaseAbility(baseAttacker, baseDefender);
assert.equal(baseResult.damage, 6, "base ability must deal exactly 6 HP");
assert.equal(baseResult.energyCost, 10, "base ability costs 10% energy");
assert.equal(baseAttacker.energy, baseEnergy - 10);
assert.equal(getCooldownRemaining(baseAttacker, "base"), 5000);

const specialAttacker = createCombatant(first);
const specialDefender = createCombatant(water);
const specialEnergy = specialAttacker.energy;
const specialResult = resolveSpecialAbility(specialAttacker, specialDefender);
assert.equal(specialResult.damage, 10, "special must deal exactly 10 HP");
assert.equal(specialResult.energyCost, 35, "special costs 35% energy");
assert.equal(specialAttacker.energy, specialEnergy - 35);
assert.equal(getCooldownRemaining(specialAttacker, "special"), 30000);

const commonDefense = createCombatant(water);
assert.equal(getDefenseBlockPercent(commonDefense), 80);
const commonDefenseEnergy = commonDefense.energy;
resolveDefenseAbility(commonDefense);
assert.equal(commonDefense.energy, commonDefenseEnergy, "defense must not consume offensive energy");
const commonAttacker = createCombatant(first);
const commonHp = commonDefense.hp;
const commonHit = resolveBasicAttack(commonAttacker, commonDefense);
assert.equal(commonHit.damage, 1, "Common defense should leave only 20% of a 4 HP basic hit");
assert.equal(commonDefense.hp, commonHp - 1);
assert.equal(commonHit.blockPercent, 80);
assert.equal(commonDefense.guarding, false, "a defense window is consumed by the hit");

const legendaryDefense = createCombatant(first);
assert.equal(getDefenseBlockPercent(legendaryDefense), 100);
resolveDefenseAbility(legendaryDefense);
const legendaryAttacker = createCombatant(water);
const legendaryHp = legendaryDefense.hp;
const legendaryHit = resolveBasicAttack(legendaryAttacker, legendaryDefense);
assert.equal(legendaryHit.damage, 0, "Legendary defense should fully block damage");
assert.equal(legendaryDefense.hp, legendaryHp);
assert.equal(legendaryHit.blockPercent, 100);

const jumper = createCombatant(first);
const jumpResult = jump(jumper);
assert.equal(jumpResult.started, true);
assert.equal(canEvadeIncomingAttack(jumper, { canBeEvaded: true }), true);
const evasionResult = resolveIncomingAttack(defender, jumper, {
  action: "opponent-basic",
  damageClass: "basic",
  type: "burst",
  canBeEvaded: true,
});
assert.equal(evasionResult.evaded, true, "airborne defender must evade an evadable attack");

const mover = createCombatant(first);
move(mover, "left");
assert.ok(mover.movement.velocityX < 0);
move(mover, "right");
assert.ok(mover.movement.velocityX > 0);

startTurn(attacker);
console.log("Chog mechanics sanity checks passed.");
