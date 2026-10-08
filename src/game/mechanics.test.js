import assert from "node:assert/strict";
import { buildBattleDNA } from "./battleDNA.js";
import { AURA_GROUPS, BACKGROUND_GROUPS, resolveTraitGroups } from "./traitGroups.js";
import {
  canEvadeIncomingAttack,
  createCombatant,
  getCounterMultiplier,
  jump,
  move,
  resolveBaseAbility,
  resolveBasicAttack,
  resolveDefenseAbility,
  resolveIncomingAttack,
  resolveSpecialAbility,
  startTurn,
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

const hpBefore = defender.hp;
const basicResult = resolveBasicAttack(attacker, defender);
assert.ok(basicResult.damage > 0, "basic attack must deal damage");
assert.ok(basicResult.damage <= 12, "basic attack must stay within its damage budget");
assert.equal(defender.hp, hpBefore - basicResult.damage, "damage must drain HP by the reported amount");

const baseEnergy = attacker.energy;
const baseResult = resolveBaseAbility(attacker, defender);
assert.ok(attacker.energy < baseEnergy, "base ability must consume energy");
assert.ok(baseResult.damage <= 16, "base ability must stay within its damage budget");

startTurn(attacker);
const specialEnergy = attacker.energy;
const specialResult = resolveSpecialAbility(attacker, defender);
assert.ok(attacker.energy < specialEnergy, "special ability must consume energy");
assert.ok(specialResult.damage <= 22, "special ability must stay within its damage budget");

const defense = createCombatant(first);
const defenseResult = resolveDefenseAbility(defense);
assert.ok(defenseResult.shield > 0, "defense ability must create shield");
assert.ok(defenseResult.shield <= 24, "shield must stay within its balance cap");

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

console.log("Chog mechanics sanity checks passed.");
