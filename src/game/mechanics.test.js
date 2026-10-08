import assert from "node:assert/strict";
import { buildBattleDNA } from "./battleDNA.js";
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
assert.equal(first.identity.tier, "Legendary");
assert.ok(first.abilitySet.abilities.length >= 2);

const water = buildBattleDNA(waterChog);
assert.equal(water.groups.auraFamily, "water");
assert.equal(water.groups.backgroundStyle, "control");

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
