import assert from "node:assert/strict";
import { buildBattleDNA } from "./battleDNA.js";
import {
  createCombatant,
  grantCounterWindow,
  jump,
  resolveBasicAttack,
  resolveDefenseAbility,
  resolveIncomingAttack,
  updateCombatant,
} from "./combatEngine.js";

const attackerDNA = buildBattleDNA({
  tokenId: 561, name: "Blaze", Tier: "Legendary", Base: "1:1", Form: "Chog", Skin: "Red",
  Body: "Tuxedo", Eyes: "Angry", Head: "Crown", Aura: "Burning Aura", Background: "Blood Red",
});
const defenderDNA = buildBattleDNA({
  tokenId: 973, name: "Test Water", Tier: "Common", Base: "Origin", Form: "Chog", Skin: "Blue",
  Body: "Stripes", Eyes: "Happy", Head: "Wizard Hat", Aura: "Aqua Aura", Background: "Aqua",
});

const ordinaryAttacker = createCombatant(attackerDNA);
const ordinaryDefender = createCombatant(defenderDNA);
const ordinaryHit = resolveBasicAttack(ordinaryAttacker, ordinaryDefender);
assert.equal(ordinaryHit.damage, 4, "ordinary basic damage is unchanged");
assert.equal(ordinaryHit.counter, false);

const counterAttacker = createCombatant(attackerDNA);
const counterDefender = createCombatant(defenderDNA);
assert.equal(grantCounterWindow(counterAttacker), 1200);
const counterHit = resolveBasicAttack(counterAttacker, counterDefender);
assert.equal(counterHit.damage, 6, "a 1.5x counter turns a 4 damage basic into 6 damage");
assert.equal(counterHit.counter, true);
assert.equal(counterHit.damageMultiplier, 1.5);
assert.equal(counterAttacker.counterWindowMs, 0, "a confirmed hit consumes the counter window");

const expiring = createCombatant(attackerDNA);
grantCounterWindow(expiring, 1200);
updateCombatant(expiring, 500);
assert.equal(expiring.counterWindowMs, 700);
updateCombatant(expiring, 700);
assert.equal(expiring.counterWindowMs, 0, "the opportunity expires if the player does not punish");

const parrier = createCombatant(defenderDNA);
resolveDefenseAbility(parrier);
const parry = resolveIncomingAttack(createCombatant(attackerDNA), parrier, {
  action: "opponent-special",
  slot: "special",
  damageClass: "special",
  canBeEvaded: false,
  perfectParry: true,
});
assert.equal(parry.parried, true);
assert.equal(parry.evaded, true);
assert.equal(parry.damage, 0);
assert.equal(parrier.guarding, false, "a perfect parry consumes the active defense");

const abilityAttacker = createCombatant(attackerDNA);
const abilityTarget = createCombatant(defenderDNA);
const baseAbilityHit = resolveIncomingAttack(abilityAttacker, abilityTarget, {
  action: "opponent-base",
  slot: "base",
  damageClass: "base",
  canBeEvaded: true,
});
assert.equal(baseAbilityHit.damage, 6);
assert.equal(baseAbilityHit.abilityId, attackerDNA.abilitySet.base.id, "the opponent's move resolves from its own Battle DNA");

const jumper = createCombatant(defenderDNA);
jump(jumper);
const signatureAttacker = createCombatant(attackerDNA);
const signatureMove = resolveIncomingAttack(signatureAttacker, jumper, {
  action: "opponent-special",
  slot: "special",
  damageClass: "special",
  canBeEvaded: false,
});
assert.equal(signatureMove.evaded, undefined, "a signposted control special cannot be bypassed by jumping");
assert.equal(signatureMove.damage, 10);
assert.equal(signatureMove.abilityId, attackerDNA.abilitySet.special.id);

console.log("Counter mechanics regression checks passed.");
