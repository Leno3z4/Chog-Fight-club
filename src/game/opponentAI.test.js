import assert from "node:assert/strict";
import { getOpponentAttackPattern } from "./opponentAI.js";

const abilitySet = {
  base: { id: "pressure-wave", name: "Pressure Wave", type: "control", auraFamily: "water" },
  special: { id: "tidal-bind", name: "Tidal Bind", type: "control", auraFamily: "water" },
};

const basic = getOpponentAttackPattern(0, abilitySet);
const base = getOpponentAttackPattern(1, abilitySet);
const special = getOpponentAttackPattern(2, abilitySet);

assert.equal(basic.id, "basic");
assert.equal(basic.damageClass, "basic");
assert.equal(basic.canBeEvaded, true);
assert.equal(basic.cue, "BASIC ATTACK: JUMP OR DEFEND");
assert.equal(basic.timing.startup + basic.timing.active + basic.timing.recovery, basic.telegraphMs);
assert.equal(base.id, "base");
assert.equal(base.ability.id, abilitySet.base.id);
assert.equal(base.cue, "PRESSURE WAVE: JUMP OR DEFEND");
assert.equal(base.timing.startup + base.timing.active + base.timing.recovery, base.telegraphMs);
assert.equal(special.id, "special");
assert.equal(special.ability.id, abilitySet.special.id);
assert.equal(special.heavy, true);
assert.equal(special.damageClass, "special");
assert.equal(special.canBeEvaded, false, "a control field requires defense rather than a jump");
assert.equal(special.cue, "TIDAL BIND: DEFEND");
assert.equal(special.timing.startup + special.timing.active + special.timing.recovery, special.telegraphMs);
assert.equal(getOpponentAttackPattern(3, abilitySet).id, basic.id, "the pattern loops predictably");
assert.equal(getOpponentAttackPattern(-1, abilitySet).id, special.id, "negative indexes wrap safely");

const first = getOpponentAttackPattern(0, abilitySet);
first.timing.startup = 0;
assert.equal(getOpponentAttackPattern(0, abilitySet).timing.startup, 330, "callers cannot mutate stored pattern timing");

console.log("Opponent pattern regression checks passed.");
