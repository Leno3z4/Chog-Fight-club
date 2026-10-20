import assert from "node:assert/strict";
import { applyChogPose, createChogVisual } from "./chogRig.js";

class FakeObject {
  constructor(x = 0, y = 0, texture = "") {
    this.x = x;
    this.y = y;
    this.texture = texture;
    this.rotation = 0;
    this.originX = 0.5;
    this.originY = 0.5;
    this.displayWidth = 0;
    this.displayHeight = 0;
  }

  setOrigin(x, y = x) { this.originX = x; this.originY = y; return this; }
  setDisplaySize(width, height) { this.displayWidth = width; this.displayHeight = height; return this; }
  setScale(x, y = x) { this.scaleX = x; this.scaleY = y; return this; }
  setPosition(x, y) { this.x = x; this.y = y; return this; }
  setTintFill(color) { this.tint = color; return this; }
  clearTint() { this.tint = null; return this; }
}

class FakeContainer extends FakeObject {
  constructor(x, y) { super(x, y); this.list = []; }
  add(child) { this.list.push(child); return this; }
}

const scene = {
  add: {
    container: (x, y) => new FakeContainer(x, y),
    ellipse: (x, y) => new FakeObject(x, y),
    image: (x, y, key) => new FakeObject(x, y, key),
  },
};

const visual = createChogVisual(scene, 320, 400, false);
const rig = visual.rig;
assert.equal(Object.keys(rig.parts).length, 16, "all separated Chog layers should be rigged");
for (const name of [
  "body", "head", "eyes", "mouth",
  "left-upper-arm", "left-lower-arm", "left-hand",
  "right-upper-arm", "right-lower-arm", "right-hand",
  "left-upper-leg", "left-lower-leg", "left-foot",
  "right-upper-leg", "right-lower-leg", "right-foot",
]) {
  assert.ok(rig.parts[name], `missing rig part: ${name}`);
}

for (const [name, part] of Object.entries(rig.parts)) {
  const offset = part.offset ?? [0, 0];
  const left = part.image.x - part.image.originX * part.image.displayWidth;
  const top = part.image.y - part.image.originY * part.image.displayHeight;
  const expectedLeft = (offset[0] - 512) * (250 / 1024);
  const expectedTop = (offset[1] - 512) * (250 / 1024);
  assert.ok(Math.abs(left - expectedLeft) < 1e-9, `${name} should preserve shared-canvas horizontal alignment`);
  assert.ok(Math.abs(top - expectedTop) < 1e-9, `${name} should preserve shared-canvas vertical alignment`);
}

applyChogPose(rig, {
  leadArmRotation: -1.58,
  rearArmRotation: -2.42,
  leadLegRotation: 0.2,
  rearLegRotation: -0.2,
  torsoRotation: -0.1,
  torsoX: 4,
  torsoY: -3,
  headRotation: 0.04,
});
assert.ok(Math.abs(rig.leadArm.rotation - (-1.58 - 0.1)) < 1e-9);
assert.ok(Math.abs(rig.rearArm.rotation - (-2.42 - 0.1)) < 1e-9);
assert.ok(Math.abs(rig.leadLeg.rotation - (0.2 - 0.1)) < 1e-9);
assert.ok(Math.abs(rig.rearLeg.rotation - (-0.2 - 0.1)) < 1e-9);
assert.equal(rig.torso.rotation, -0.1);
assert.ok(Math.abs(rig.torso.x - rig.rest.torso.x - 4) < 1e-9);
assert.ok(Math.abs(rig.torso.y - rig.rest.torso.y + 3) < 1e-9);
assert.deepEqual(
  rig.headParts.map((part) => Math.round(part.rotation * 1000) / 1000),
  [-0.06, -0.06, -0.06],
  "head, eyes, and mouth should stay aligned through torso and head motion",
);
assert.ok(
  Math.abs(rig.parts["left-lower-arm"].image.rotation - (rig.leadArm.rotation + (-1.58 * 0.18))) < 1e-9,
  "forearm should follow the upper arm while retaining a small bend",
);
assert.equal(
  rig.parts["left-hand"].image.rotation,
  rig.parts["left-lower-arm"].image.rotation,
  "hand should follow forearm rotation",
);
assert.equal(
  rig.parts["left-foot"].image.rotation,
  rig.parts["left-lower-leg"].image.rotation,
  "foot should follow lower leg rotation",
);

const origin = rig.rest.torso;
const joint = rig.rest.leadArm;
const dx = joint.x - origin.x;
const dy = joint.y - origin.y;
const expectedX = origin.x + (dx * Math.cos(-0.1)) - (dy * Math.sin(-0.1)) + 4;
const expectedY = origin.y + (dx * Math.sin(-0.1)) + (dy * Math.cos(-0.1)) - 3;
assert.ok(Math.abs(rig.leadArm.x - expectedX) < 1e-9, "shoulder joint should follow torso rotation and translation");
assert.ok(Math.abs(rig.leadArm.y - expectedY) < 1e-9, "shoulder joint should follow torso rotation and translation");

console.log("Separated Chog asset alignment and segmented rig checks passed.");
