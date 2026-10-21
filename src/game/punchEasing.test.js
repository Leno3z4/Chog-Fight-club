import assert from "node:assert/strict";
import { punchPulse, punchWindowPulse } from "./punchEasing.js";

assert.equal(punchPulse(0), 0, "a strike should start from guard");
assert.ok(punchPulse(0.15) > 0 && punchPulse(0.15) < 1, "the strike should extend smoothly");
assert.equal(punchPulse(0.3), 1, "the strike should reach full extension at the sine-out peak");
assert.ok(punchPulse(0.45) < 1 && punchPulse(0.45) > 0, "the recovery should move back toward guard");
assert.ok(punchPulse(0.7) < punchPulse(0.45), "quadratic recovery should keep returning toward guard");
assert.equal(punchPulse(0.85), 0, "the hand should return to guard before the action ends");
assert.equal(punchPulse(-1), 0, "progress below zero should clamp to guard");
assert.equal(punchPulse(2), 0, "progress after the strike should remain at guard");
assert.equal(punchPulse(Number.NaN), 0, "invalid progress should safely return to guard");

assert.equal(punchWindowPulse(0.1, 0.1, 0.25), 0, "a combo strike starts from guard");
assert.ok(punchWindowPulse(0.145, 0.1, 0.25) > 0.5, "a combo strike should snap forward inside its window");
assert.equal(punchWindowPulse(0.25, 0.1, 0.25), 0, "the first strike must stop at its window end");
assert.equal(punchWindowPulse(0.43, 0.44, 0.8), 0, "the next strike must not start early");
assert.ok(punchWindowPulse(0.52, 0.44, 0.8) > 0, "the second strike should animate inside its window");
assert.equal(punchWindowPulse(0.8, 0.44, 0.8), 0, "the second strike must stop at its window end");

console.log("Punch extension and recovery easing checks passed.");
