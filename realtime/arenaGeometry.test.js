import test from "node:test";
import assert from "node:assert/strict";
import { LIVE_ARENA_GROUND_Y } from "./arenaGeometry.js";

test("live fighters share the platform contact baseline", () => {
  assert.equal(LIVE_ARENA_GROUND_Y, 324);
  assert.ok(LIVE_ARENA_GROUND_Y > 0 && LIVE_ARENA_GROUND_Y < 540);
});
