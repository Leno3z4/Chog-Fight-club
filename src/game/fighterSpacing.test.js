import assert from "node:assert/strict";
import { stopMovementTowardOpponent } from "./fighterSpacing.js";

assert.equal(
  stopMovementTowardOpponent(320, 500, 220, 150),
  220,
  "approach is allowed while fighters are outside the contact distance",
);
assert.equal(
  stopMovementTowardOpponent(349, 500, 220, 150),
  220,
  "approach is allowed just outside the minimum distance",
);
assert.equal(
  stopMovementTowardOpponent(350, 500, 220, 150),
  0,
  "movement toward a rival should stop at the minimum distance",
);
assert.equal(
  stopMovementTowardOpponent(650, 500, -220, 150),
  0,
  "movement toward a rival should stop from the opposite side too",
);
assert.equal(
  stopMovementTowardOpponent(350, 500, -220, 150),
  -220,
  "movement away from the rival should remain available at close range",
);
assert.equal(
  stopMovementTowardOpponent(500, 500, 220, 150),
  220,
  "the helper should not force a direction or teleport fighters when positions coincide",
);
console.log("Practice fighter spacing checks passed.");
