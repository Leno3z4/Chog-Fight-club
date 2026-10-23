import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFENSE_COOLDOWN_MS,
  DEFENSE_MAX_HOLD_MS,
  getGuardBlockPercent,
  updateHeldDefense,
} from "./defenseRules.js";

function fighter() {
  return { guarding: false, defendRequested: false, guardStartedAt: 0, guardCooldownUntil: 0, defenseRequiresRelease: false };
}

test("holding defense activates immediately and stays active for up to 10 seconds", () => {
  const p = fighter();
  assert.equal(updateHeldDefense(p, true, 100), true);
  assert.equal(p.guarding, true);
  assert.equal(p.guardStartedAt, 100);
  assert.equal(updateHeldDefense(p, true, 100 + DEFENSE_MAX_HOLD_MS - 1), true);
  assert.equal(p.guarding, true);
});

test("defense auto-deactivates at 10 seconds and starts a 2-second cooldown", () => {
  const p = fighter();
  updateHeldDefense(p, true, 1_000);
  assert.equal(updateHeldDefense(p, true, 1_000 + DEFENSE_MAX_HOLD_MS), false);
  assert.equal(p.guarding, false);
  assert.equal(p.guardCooldownUntil, 1_000 + DEFENSE_MAX_HOLD_MS + DEFENSE_COOLDOWN_MS);
  assert.equal(p.defenseRequiresRelease, true);
  assert.equal(updateHeldDefense(p, true, p.guardCooldownUntil + 1), false, "holding continuously must not auto-reactivate");
});

test("releasing defense ends it immediately and starts its cooldown", () => {
  const p = fighter();
  updateHeldDefense(p, true, 5_000);
  assert.equal(updateHeldDefense(p, false, 6_250), false);
  assert.equal(p.guarding, false);
  assert.equal(p.guardCooldownUntil, 6_250 + DEFENSE_COOLDOWN_MS);
  assert.equal(updateHeldDefense(p, true, 6_500), false);
  updateHeldDefense(p, false, 6_750);
  assert.equal(updateHeldDefense(p, true, 8_251), true);
});

test("guard damage reduction follows the fighter tier", () => {
  assert.equal(getGuardBlockPercent("Common"), 80);
  assert.equal(getGuardBlockPercent("Rare"), 90);
  assert.equal(getGuardBlockPercent("Legendary"), 100);
  assert.equal(getGuardBlockPercent("unknown"), 80);
});
