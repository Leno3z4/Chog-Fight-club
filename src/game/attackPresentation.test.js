import assert from "node:assert/strict";
import { getAttackCue, getAttackPresentation } from "./attackPresentation.js";

const ember = { id: "ember-burst", name: "Ember Burst", type: "burst", auraFamily: "flame" };
const waterField = { id: "tidal-bind", name: "Tidal Bind", type: "control", auraFamily: "water" };

const basic = getAttackPresentation({ slot: "basic", auraFamily: "flame" });
const base = getAttackPresentation({ slot: "base", ability: ember });
const special = getAttackPresentation({ slot: "special", ability: waterField });

assert.equal(basic.family, "flame", "basic attacks still retain the fighter's Battle DNA identity");
assert.equal(basic.hasAuraVfx, false, "basic physical hits do not use Aura VFX");
assert.equal(basic.particleCount, 0, "basic physical hits do not spawn particles");
assert.equal(base.abilityId, "ember-burst");
assert.equal(base.hasAuraVfx, true, "base abilities keep their Aura effects");
assert.equal(base.shape, "burst");
assert.equal(special.shape, "wave");
assert.equal(special.hasAuraVfx, true, "signature abilities keep their Aura effects");
assert.ok(special.scale > base.scale, "special ability feedback is stronger than base ability feedback");
assert.ok(special.particleCount > base.particleCount, "special ability uses a larger impact burst");
assert.equal(getAttackCue({ slot: "base", ability: ember }), "EMBER BURST: JUMP OR DEFEND");
assert.equal(getAttackCue({ slot: "special", ability: waterField, canBeEvaded: false }), "TIDAL BIND: DEFEND");

console.log("Ability presentation regression checks passed.");
