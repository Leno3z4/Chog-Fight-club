import test from "node:test";
import assert from "node:assert/strict";
import { buildCombatDNA } from "./battle.js";

test("combat DNA uses rarity and visible Chog traits for stats", () => {
  const dna = buildCombatDNA({
    name: "Fire Chog",
    Tier: "Legendary",
    Body: "Toad",
    Eyes: "Angry",
    Skin: "Red",
    Aura: "Fire",
  });
  assert.equal(dna.name, "Fire Chog");
  assert.equal(dna.tier, "Legendary");
  assert.equal(dna.ability, "Ember Strike");
  assert.deepEqual(dna.stats, { maxHp: 124, attack: 33, defense: 22, speed: 18 });
});

test("unknown rarity safely falls back to Common battle stats", () => {
  const dna = buildCombatDNA({});
  assert.equal(dna.tier, "Common");
  assert.equal(dna.ability, "Focused Strike");
  assert.deepEqual(dna.stats, { maxHp: 100, attack: 20, defense: 14, speed: 14 });
});
