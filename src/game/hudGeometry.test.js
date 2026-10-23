import test from "node:test";
import assert from "node:assert/strict";
import {
  clampLiveRootY,
  getHudPortraitGeometry,
  getLiveGroundLineY,
  getLiveMaximumRootY,
  getSoloFloorLineY,
  getSoloVisualRootY,
} from "./hudGeometry.js";

test("portrait image overscans a wide rounded-rectangle viewport", () => {
  const geometry = getHudPortraitGeometry(1600);
  assert.ok(geometry.imageSize > geometry.viewportWidth);
  assert.ok(geometry.viewportWidth > geometry.viewportHeight);
  assert.ok(geometry.cornerRadius > 0);
  assert.equal(geometry.viewportWidth, 150.4);
  assert.equal(geometry.viewportHeight, 124.8);
});

test("solo rig ground anchor never places the grounded visual root below its floor-safe position", () => {
  const floorY = getSoloFloorLineY(720);
  assert.equal(floorY, 547);
  assert.equal(getSoloVisualRootY(floorY - 60, floorY), floorY - 170);
  assert.equal(getSoloVisualRootY(floorY + 10, floorY), floorY - 170);
  assert.ok(getSoloVisualRootY(floorY - 180, floorY) < floorY);
});

test("live root clamp keeps fighters above the floor line, including during a jump", () => {
  const floorY = getLiveGroundLineY(540);
  const maxRootY = getLiveMaximumRootY(540);
  assert.ok(Math.abs(floorY - 442.8) < 1e-9);
  assert.equal(clampLiveRootY(900, 0, 540), maxRootY);
  assert.equal(clampLiveRootY(900, 60, 540), maxRootY - 60);
  assert.equal(clampLiveRootY(120, 0, 540), 120);
  assert.ok(clampLiveRootY(900, 0, 540) + 540 * 0.19 <= floorY + 1e-9);
});
