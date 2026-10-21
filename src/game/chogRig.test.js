import assert from "node:assert/strict";
import { applyChogPose, clampChogPose, CHOG_POSE_LIMITS, createChogKnockoutPose, createChogVisual, setChogRearCrossLayer } from "./chogRig.js";

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
  createBitmapMask() { return { source: this }; }
  setMask(mask) { this.mask = mask; return this; }
  setTintFill(color) { this.tint = color; return this; }
  clearTint() { this.tint = null; return this; }
}

class FakeContainer extends FakeObject {
  constructor(x, y) { super(x, y); this.list = []; }
  add(child) { this.list.push(child); return this; }
  moveTo(child, index) {
    const current = this.list.indexOf(child);
    if (current < 0) return this;
    this.list.splice(current, 1);
    this.list.splice(Math.max(0, Math.min(index, this.list.length)), 0, child);
    return this;
  }
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
const layerNames = visual.list.slice(1).map((layer) => layer.texture.replace("chog-", ""));
const bodyLayer = layerNames.indexOf("body");
assert.ok(layerNames.indexOf("left-upper-arm") < bodyLayer, "the rear upper arm should stay behind the torso to hide shoulder seams");
assert.ok(layerNames.indexOf("left-lower-arm") < bodyLayer, "the rear forearm should stay behind the torso in guard");
assert.ok(layerNames.indexOf("left-hand") < bodyLayer, "the rear glove should stay behind the torso and lead glove at rest");
assert.ok(layerNames.indexOf("right-upper-arm") > bodyLayer, "the lead upper arm should render in front of the torso");
assert.ok(layerNames.indexOf("right-lower-arm") > bodyLayer, "the lead forearm should render in front of the torso");
assert.ok(layerNames.indexOf("right-hand") > layerNames.indexOf("right-lower-arm"), "the lead glove should render above its forearm");
assert.ok(layerNames.indexOf("right-hand") > layerNames.indexOf("left-hand"), "the lead glove should be in front of the rear glove at rest");
assert.ok(layerNames.indexOf("right-hand") < layerNames.indexOf("head"), "the lead glove should remain behind the head");
assert.equal(
  rig.parts["left-upper-arm"].image.mask?.source,
  rig.parts.body.image,
  "the rear upper arm should be clipped to the torso alpha silhouette",
);

// Rear crosses temporarily advance only the rear forearm and glove. The upper
// arm remains tucked behind the torso and the hands stay below the head.
rig.defaultLayerOrder = [...visual.list];
setChogRearCrossLayer(visual, true);
const crossLayers = visual.list.slice(1).map((layer) => layer.texture.replace("chog-", ""));
assert.ok(crossLayers.indexOf("left-upper-arm") < crossLayers.indexOf("body"), "the rear upper arm must remain behind the torso during a cross");
assert.ok(crossLayers.indexOf("left-lower-arm") > crossLayers.indexOf("right-lower-arm"), "the rear forearm should advance for the cross");
assert.ok(crossLayers.indexOf("left-hand") > crossLayers.indexOf("left-lower-arm"), "the rear glove should follow its forearm during the cross");
assert.ok(crossLayers.indexOf("left-hand") < crossLayers.indexOf("right-hand"), "the lead glove should still remain in front of the rear glove");
assert.ok(crossLayers.indexOf("left-hand") < crossLayers.indexOf("head"), "the rear glove must not jump in front of the head");
setChogRearCrossLayer(visual, false);
assert.deepEqual(visual.list, rig.defaultLayerOrder, "the default rear-arm order should restore after the cross");
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
  Math.abs(rig.parts["left-lower-arm"].image.rotation - (-0.1 - 2.42)) < 1e-8,
  "forearm should follow the rear upper arm without inventing an elbow bend",
);
assert.equal(
  rig.parts["left-hand"].image.rotation,
  rig.parts["left-lower-arm"].image.rotation,
  "hand should follow forearm rotation",
);
assert.ok(
  Math.abs(rig.parts["left-foot"].image.rotation - rig.parts["left-lower-leg"].image.rotation * 0.35) < 1e-9,
  "foot should follow only 35% of the lower-leg angle to keep the sole flatter",
);

const transform = (point, origin, angle, offsetX = 0, offsetY = 0) => {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  return {
    x: origin.x + dx * Math.cos(angle) - dy * Math.sin(angle) + offsetX,
    y: origin.y + dx * Math.sin(angle) + dy * Math.cos(angle) + offsetY,
  };
};
const rotateVector = (x, y, angle) => ({
  x: x * Math.cos(angle) - y * Math.sin(angle),
  y: x * Math.sin(angle) + y * Math.cos(angle),
});

const elbowLocal = transform(rig.joints.left.elbow, rig.parts["left-upper-arm"].rest, -2.42);
const elbowWorld = transform(elbowLocal, rig.rest.torso, -0.1, 4, -3);
const wristVector = rotateVector(
  rig.joints.left.wrist.x - rig.joints.left.elbow.x,
  rig.joints.left.wrist.y - rig.joints.left.elbow.y,
  -0.1 - 2.42,
);
assert.ok(
  Math.abs(rig.parts["left-hand"].image.x - elbowWorld.x - wristVector.x) < 1e-9
  && Math.abs(rig.parts["left-hand"].image.y - elbowWorld.y - wristVector.y) < 1e-9,
  "wrist should extend from the transformed elbow, not drift from the original joint",
);

const kneeLocal = transform(rig.joints.left.knee, rig.parts["left-upper-leg"].rest, -0.2);
const kneeWorld = transform(kneeLocal, rig.rest.torso, -0.1, 4, -3);
const ankleVector = rotateVector(
  rig.joints.left.ankle.x - rig.joints.left.knee.x,
  rig.joints.left.ankle.y - rig.joints.left.knee.y,
  -0.1 - 0.2,
);
assert.ok(
  Math.abs(rig.parts["left-foot"].image.x - kneeWorld.x - ankleVector.x) < 1e-9
  && Math.abs(rig.parts["left-foot"].image.y - kneeWorld.y - ankleVector.y) < 1e-9,
  "ankle should extend from the transformed knee, not drift from the original joint",
);

const origin = rig.rest.torso;
const joint = rig.rest.leadArm;
const dx = joint.x - origin.x;
const dy = joint.y - origin.y;
const expectedX = origin.x + (dx * Math.cos(-0.1)) - (dy * Math.sin(-0.1)) + 4;
const expectedY = origin.y + (dx * Math.sin(-0.1)) + (dy * Math.cos(-0.1)) - 3;
assert.ok(Math.abs(rig.leadArm.x - expectedX) < 1e-9, "shoulder joint should follow torso rotation and translation");
assert.ok(Math.abs(rig.leadArm.y - expectedY) < 1e-9, "shoulder joint should follow torso rotation and translation");

// The punch reference finishes with the lead forearm almost level with the
// shoulder. The lower-arm angle must be explicit so its wrist does not curl
// upward when the upper arm rotates forward.
const jabRig = createChogVisual(scene, 0, 0, false).rig;
applyChogPose(jabRig, {
  leadArmRotation: -1.47,
  leadArmLowerRotation: 0.86,
});
const jabElbow = jabRig.parts["right-lower-arm"].image;
const jabFist = jabRig.parts["right-hand"].image;
assert.ok(jabFist.x > jabElbow.x, "the lead fist should extend in front of the elbow for a jab");
assert.ok(Math.abs(jabFist.y - jabElbow.y) < 3, "the lead forearm should finish almost level for a jab");

// Compare the airborne reference pose to the resting lower-body anchors. A
// jump tucks both knees upward; it must not leave two straight legs spread
// beneath the torso.
const restRig = createChogVisual(scene, 0, 0, false).rig;
applyChogPose(restRig, { leadLegRotation: -0.08, rearLegRotation: 0.1 });
const jumpRig = createChogVisual(scene, 0, 0, false).rig;
applyChogPose(jumpRig, {
  leadLegRotation: -1,
  leadLegLowerRotation: 1,
  rearLegRotation: 0.85,
  rearLegLowerRotation: -1.4,
  leadLegY: -5,
  rearLegY: -4,
});
assert.ok(
  jumpRig.parts["right-lower-leg"].image.y < restRig.parts["right-lower-leg"].image.y - 12
  && jumpRig.parts["left-lower-leg"].image.y < restRig.parts["left-lower-leg"].image.y - 8,
  "the jump pose should raise both knees into a tucked silhouette",
);

console.log("Separated Chog asset alignment and segmented rig checks passed.");


// Pose-space limits apply at the shared rig boundary, protecting both solo and
// online rendering while leaving normal authored animation values untouched.
const boundedPose = clampChogPose({
  leadArmRotation: -999,
  rearArmRotation: 999,
  leadArmLowerRotation: -999,
  leadLegRotation: 999,
  rearLegLowerRotation: -999,
  torsoRotation: 999,
  headRotation: -999,
  leadArmX: 999,
  leadLegY: -999,
  torsoX: 999,
  headY: -999,
  rearArmY: Number.NaN,
});
for (const [key, range] of Object.entries(CHOG_POSE_LIMITS)) {
  if (!(key in boundedPose)) continue;
  assert.ok(boundedPose[key] >= range.min && boundedPose[key] <= range.max, `${key} should stay inside its rig-space limit`);
  assert.ok(Number.isFinite(boundedPose[key]), `${key} should never produce a non-finite transform`);
}
assert.equal(boundedPose.leadArmRotation, CHOG_POSE_LIMITS.leadArmRotation.min);
assert.equal(boundedPose.rearArmRotation, CHOG_POSE_LIMITS.rearArmRotation.max);
assert.equal(boundedPose.torsoRotation, CHOG_POSE_LIMITS.torsoRotation.max);
assert.equal(boundedPose.rearArmY, 0, "non-finite pose inputs should fall back to neutral");

const limitedRig = createChogVisual(scene, 0, 0, false).rig;
applyChogPose(limitedRig, {
  leadArmRotation: 500,
  leadArmLowerRotation: -500,
  leadLegRotation: -500,
  rearLegLowerRotation: 500,
  torsoRotation: 500,
  headRotation: -500,
  torsoX: 500,
});
assert.equal(limitedRig.parts["right-upper-arm"].image.rotation, CHOG_POSE_LIMITS.torsoRotation.max + CHOG_POSE_LIMITS.leadArmRotation.max);
assert.equal(limitedRig.parts["right-lower-arm"].image.rotation,
  CHOG_POSE_LIMITS.torsoRotation.max + CHOG_POSE_LIMITS.leadArmRotation.max + CHOG_POSE_LIMITS.leadArmLowerRotation.min);
assert.equal(limitedRig.torso.rotation, CHOG_POSE_LIMITS.torsoRotation.max);
assert.equal(limitedRig.torso.x - limitedRig.rest.torso.x, CHOG_POSE_LIMITS.torsoX.max);
assert.ok(Number.isFinite(limitedRig.parts["left-foot"].image.x) && Number.isFinite(limitedRig.parts["left-foot"].image.y), "clamped poses should keep foot transforms numeric");

const normalPose = clampChogPose({
  leadArmRotation: -0.82,
  leadArmLowerRotation: -0.75,
  leadLegRotation: -0.08,
  rearLegRotation: 0.1,
  torsoRotation: 0,
  headRotation: 0,
  leadArmX: 3,
});
assert.deepEqual(normalPose, {
  leadArmRotation: -0.82,
  leadArmLowerRotation: -0.75,
  leadLegRotation: -0.08,
  rearLegRotation: 0.1,
  torsoRotation: 0,
  headRotation: 0,
  leadArmX: 3,
}, "typical authored poses should remain unchanged");


// Solo and online modes share one staged KO pose arc. The start should be
// controlled but not instantly collapsed; later frames settle into the final
// pose, and all returned values remain inside the same rig bounds.
const koStart = createChogKnockoutPose(normalPose, 0);
const koMid = createChogKnockoutPose(normalPose, 210);
const koSettled = createChogKnockoutPose(normalPose, 1200);
assert.equal(koStart.torsoRotation, 0.22);
assert.ok(koMid.torsoRotation > koStart.torsoRotation, "KO should develop a visible fall rather than jump to the final pose");
assert.ok(koSettled.torsoRotation > koMid.torsoRotation, "KO should complete its fall arc");
const limitedKoRig = createChogVisual(scene, 0, 0, false).rig;
applyChogPose(limitedKoRig, koSettled);
assert.ok(Number.isFinite(limitedKoRig.parts["right-hand"].image.x));
assert.ok(Number.isFinite(limitedKoRig.parts["left-foot"].image.y));


// The revised, looser guard values should pass through the rig limits unchanged.
assert.deepEqual(
  clampChogPose({
    leadArmRotation: -0.04,
    leadArmLowerRotation: -1.14,
    rearArmRotation: -1.1,
    rearArmLowerRotation: -1.3,
    rearArmX: 2,
  }),
  {
    leadArmRotation: -0.04,
    leadArmLowerRotation: -1.14,
    rearArmRotation: -1.1,
    rearArmLowerRotation: -1.3,
    rearArmX: 2,
  },
  "the relaxed guard and rear-shoulder tuck should remain within pose limits",
);

// This is a pivot-based sprite rig, not a weighted mesh. Every pose must keep
// the segment distances fixed while the elbow/wrist and knee/ankle follow their
// parent joints through guard, jab and jump poses.
const segmentRig = createChogVisual(scene, 0, 0, false).rig;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const guardPose = {
  leadArmRotation: -0.04, leadArmLowerRotation: -1.14,
  rearArmRotation: -1.1, rearArmLowerRotation: -1.3, rearArmX: 2,
  leadLegRotation: -0.14, leadLegLowerRotation: 0.0,
  rearLegRotation: -0.5, rearLegLowerRotation: 0.68,
};
applyChogPose(segmentRig, guardPose);
assert.ok(segmentRig.parts["right-hand"].image.y >= 6 && segmentRig.parts["right-hand"].image.y <= 16,
  "default right/lead fist should sit in the chin guard");
assert.ok(
  segmentRig.parts["left-hand"].image.y >= segmentRig.parts["right-hand"].image.y + 6
    && segmentRig.parts["left-hand"].image.y <= segmentRig.parts["right-hand"].image.y + 15,
  "the rear glove should sit noticeably below, but still near, the lead glove",
);
assert.ok(
  segmentRig.parts["left-hand"].image.x < segmentRig.parts["right-hand"].image.x - 16,
  "the rear glove should remain clearly behind the lead glove",
);
assert.ok(segmentRig.parts["right-foot"].image.y >= 85 && segmentRig.parts["right-foot"].image.y <= 92,
  "lead foot should stay close to the floor line in the wider guard");
assert.ok(segmentRig.parts["left-foot"].image.y >= 88 && segmentRig.parts["left-foot"].image.y <= 92,
  "rear foot should be on the floor line in the narrow guard");
assert.ok(
  Math.abs(segmentRig.parts["right-foot"].image.x - segmentRig.parts["left-foot"].image.x) >= 60
    && Math.abs(segmentRig.parts["right-foot"].image.x - segmentRig.parts["left-foot"].image.x) <= 70,
  "the widened guard stance should keep the feet about 65px apart",
);
const fixedLengths = {
  rightUpperArm: distance(segmentRig.parts["right-upper-arm"].image, segmentRig.joints.right.elbow),
  rightForearm: Math.hypot(
    segmentRig.joints.right.wrist.x - segmentRig.joints.right.elbow.x,
    segmentRig.joints.right.wrist.y - segmentRig.joints.right.elbow.y,
  ),
  rightThigh: Math.hypot(
    segmentRig.joints.right.knee.x - segmentRig.parts["right-upper-leg"].rest.x,
    segmentRig.joints.right.knee.y - segmentRig.parts["right-upper-leg"].rest.y,
  ),
  rightShin: Math.hypot(
    segmentRig.joints.right.ankle.x - segmentRig.joints.right.knee.x,
    segmentRig.joints.right.ankle.y - segmentRig.joints.right.knee.y,
  ),
};
const articulationPoses = [
  {
    leadArmRotation: -0.04, leadArmLowerRotation: -1.14,
    rearArmRotation: -1.1, rearArmLowerRotation: -1.3, rearArmX: 2,
    leadLegRotation: -0.14, leadLegLowerRotation: 0.0,
    rearLegRotation: -0.5, rearLegLowerRotation: 0.68,
  },
  {
    leadArmRotation: -1.47, leadArmLowerRotation: 0.90,
    rearArmRotation: -1.0, rearArmLowerRotation: -2.0,
    leadLegRotation: -0.04, leadLegLowerRotation: 0.40,
    rearLegRotation: -0.64, rearLegLowerRotation: 0.56,
    torsoRotation: 0.025, torsoX: -1, torsoY: 1,
  },
  {
    leadArmRotation: -0.04, leadArmLowerRotation: -1.14,
    rearArmRotation: -1.1, rearArmLowerRotation: -1.3, rearArmX: 2,
    leadLegRotation: -0.8, leadLegLowerRotation: 1.66,
    rearLegRotation: -1.1, rearLegLowerRotation: 1.02,
    leadLegY: -4, rearLegY: -3, torsoRotation: -0.02, torsoY: -3,
  },
];
for (const pose of articulationPoses) {
  applyChogPose(segmentRig, pose);
  const elbow = segmentRig.parts["right-lower-arm"].image;
  const wrist = segmentRig.parts["right-hand"].image;
  const knee = segmentRig.parts["right-lower-leg"].image;
  const ankle = segmentRig.parts["right-foot"].image;
  assert.ok(Number.isFinite(elbow.x) && Number.isFinite(wrist.y), "arm joints remain finite across pose transitions");
  assert.ok(Number.isFinite(knee.x) && Number.isFinite(ankle.y), "leg joints remain finite across pose transitions");
  const upperArmLength = distance(segmentRig.parts["right-upper-arm"].image, elbow);
  const forearmLength = distance(elbow, wrist);
  const thighLength = distance(segmentRig.parts["right-upper-leg"].image, knee);
  const shinLength = distance(knee, ankle);
  assert.ok(Math.abs(upperArmLength - fixedLengths.rightUpperArm) < 1e-8, "shoulder-to-elbow distance must not stretch");
  assert.ok(Math.abs(forearmLength - fixedLengths.rightForearm) < 1e-8, "forearm-to-wrist distance must not stretch");
  assert.ok(Math.abs(thighLength - fixedLengths.rightThigh) < 1e-8, "hip-to-knee distance must not stretch");
  assert.ok(Math.abs(shinLength - fixedLengths.rightShin) < 1e-8, "knee-to-ankle distance must not stretch");
  assert.ok(
    Math.abs(segmentRig.parts["right-foot"].image.rotation - segmentRig.parts["right-lower-leg"].image.rotation * 0.35) < 1e-9,
    "lead foot stays flatter than the shin during guard, jab and jump poses",
  );
}


// Guard silhouette regression: the rear shoulder and elbow anchors must stay
// inside this conservative torso envelope in both facing directions. The
// exact outside-the-silhouette pixels are clipped with the body alpha mask.
const torsoGuardEnvelope = [
  { x: -26, y: -14 },
  { x: 17, y: -14 },
  { x: 23, y: -2 },
  { x: 25, y: 15 },
  { x: 22, y: 33 },
  { x: 12, y: 48 },
  { x: -14, y: 48 },
  { x: -26, y: 32 },
  { x: -29, y: 10 },
  { x: -28, y: -2 },
];
function isInsidePolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const crossesY = (a.y > point.y) !== (b.y > point.y);
    const intersectionX = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || 1e-9) + a.x;
    if (crossesY && point.x < intersectionX) inside = !inside;
  }
  return inside;
}
for (const mirrored of [false, true]) {
  const facingRig = createChogVisual(scene, 0, 0, mirrored).rig;
  const facing = mirrored ? -1 : 1;
  applyChogPose(facingRig, guardPose);

  const shoulder = facingRig.parts["left-upper-arm"].image;
  const elbow = facingRig.parts["left-lower-arm"].image;
  const rearGlove = facingRig.parts["left-hand"].image;
  const leadGlove = facingRig.parts["right-hand"].image;

  // Mirror the x-coordinate into screen space and project it along the
  // fighter's facing direction so the same front/back assertion works twice.
  const screenX = (x) => x * facing;
  const fighterForwardX = (x) => screenX(x) * facing;
  for (const [jointName, point] of [["rear shoulder", shoulder], ["rear elbow", elbow]]) {
    assert.ok(
      isInsidePolygon({ x: fighterForwardX(point.x), y: point.y }, torsoGuardEnvelope),
      `the ${jointName} should stay within the torso guard envelope when mirrored=${mirrored}`,
    );
  }
  assert.ok(
    fighterForwardX(rearGlove.x) < fighterForwardX(leadGlove.x) - 16,
    `the rear glove should stay behind the lead glove when mirrored=${mirrored}`,
  );
  assert.ok(
    rearGlove.y >= leadGlove.y + 6 && rearGlove.y <= leadGlove.y + 15,
    `the rear glove should stay below the lead glove when mirrored=${mirrored}`,
  );
  assert.equal(
    facingRig.parts["left-upper-arm"].image.mask?.source,
    facingRig.parts.body.image,
    `the rear upper arm should use the torso alpha mask when mirrored=${mirrored}`,
  );
}
