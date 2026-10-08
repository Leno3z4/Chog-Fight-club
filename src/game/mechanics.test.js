import assert from "node:assert/strict";
import { buildBattleDNA } from "./battleDNA.js";
import { AURA_GROUPS, BACKGROUND_GROUPS, resolveTraitGroups } from "./traitGroups.js";
import {
  createCombatant,
  getCounterMultiplier,
  resolveAbility,
  resolveAttack,
  resolveGuard,
  startTurn,
} from "./combatEngine.js";

const flameChog = {
  tokenId: 561,
  name: "Blaze",
  Tier: "Legendary",
  Base: "1:1",
  Form: "Chog",
  Skin: "Red",
  Body: "Tuxedo",
  Eyes: "Angry",
  Head: "Crown",
  Aura: "Burning Aura",
  Background: "Blood Red",
  Mouth: "Smile",
  Side: "Left",
  Naked: "No",
};

const waterChog = {
  tokenId: 973,
  name: "Test Water",
  Tier: "Common",
  Base: "Origin",
  Form: "Chog",
  Skin: "Blue",
  Body: "Stripes",
  Eyes: "Happy",
  Head: "Wizard Hat",
  Aura: "Aqua Aura",
  Background: "Aqua",
  Mouth: "Smile",
  Side: "Right",
  Naked: "No",
};

const first = buildBattleDNA(flameChog);
const second = buildBattleDNA(flameChog);
assert.deepEqual(first, second, "same metadata must resolve to the same Battle DNA");
assert.equal(first.groups.auraFamily, "flame");
assert.equal(first.groups.backgroundStyle, "burst");
assert.equal(first.groups.expression, "ignition");
assert.equal(first.identity.tier, "Legendary");
assert.ok(first.abilitySet.abilities.length >= 2);

const water = buildBattleDNA(waterChog);
assert.equal(water.groups.auraFamily, "water");
assert.equal(water.groups.backgroundStyle, "control");
assert.equal(water.groups.expression, "tidal-bind");

// Coverage derived from the supplied collection: every observed Aura and
// Background value must resolve to a non-neutral combat family/style.
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
const hpBefore = defender.hp;
resolveAttack(attacker, defender);
assert.ok(defender.hp < hpBefore, "basic attack must deal damage");

resolveGuard(defender);
assert.ok(defender.shield > 0, "guard must create shield");

startTurn(attacker);
const ability = attacker.dna.abilitySet.abilities[0];
const energyBefore = attacker.energy;
resolveAbility(attacker, defender, ability.id);
assert.ok(attacker.energy < energyBefore, "ability must consume energy");

console.log("Chog mechanics sanity checks passed.");
