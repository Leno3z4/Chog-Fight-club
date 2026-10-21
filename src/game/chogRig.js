const SOURCE_SIZE = 1024;
const RENDER_SIZE = 250;
const SCALE = RENDER_SIZE / SOURCE_SIZE;

/**
 * Defensive, stylized pose-space limits for this sprite rig.
 *
 * These values are animation tuning bounds (radians and local scene units),
 * not medical ranges of motion. The limits are intentionally wider than the
 * authored poses so a new animation can express itself without letting a bad
 * input or one-off keyframe fling a limb out of its socket.
 */
export const CHOG_POSE_LIMITS = Object.freeze({
  leadArmRotation: { min: -2.65, max: 1.05 },
  rearArmRotation: { min: -2.65, max: 1.05 },
  // Allow the forearms to fold inward far enough to keep both fists at the
  // chin in the boxer guard without exceeding the sprite rig's local limits.
  leadArmLowerRotation: { min: -2.8, max: 2.8 },
  rearArmLowerRotation: { min: -2.8, max: 2.8 },
  leadLegRotation: { min: -1.45, max: 1.35 },
  rearLegRotation: { min: -1.45, max: 1.35 },
  leadLegLowerRotation: { min: -1.7, max: 1.7 },
  rearLegLowerRotation: { min: -1.7, max: 1.7 },
  torsoRotation: { min: -0.48, max: 0.48 },
  headRotation: { min: -0.3, max: 0.3 },
  leadArmX: { min: -24, max: 24 },
  rearArmX: { min: -24, max: 24 },
  leadArmY: { min: -14, max: 14 },
  rearArmY: { min: -14, max: 14 },
  leadHandTargetX: { min: -90, max: 90 },
  leadHandTargetY: { min: -80, max: 70 },
  rearHandTargetX: { min: -90, max: 90 },
  rearHandTargetY: { min: -80, max: 70 },
  leadLegX: { min: -18, max: 18 },
  rearLegX: { min: -18, max: 18 },
  leadLegY: { min: -12, max: 12 },
  rearLegY: { min: -12, max: 12 },
  torsoX: { min: -20, max: 20 },
  torsoY: { min: -20, max: 20 },
  headX: { min: -10, max: 10 },
  headY: { min: -10, max: 10 },
});

// Wrist-pivot targets in the shared 250-unit Chog canvas. Root mirroring turns
// the same boxer guard and punches into the opposite-facing version.
export const CHOG_ARM_TARGETS = Object.freeze({
  // Keep the rear glove tucked high near the cheek instead of parked on the shoulder.
  guard: Object.freeze({ lead: Object.freeze([42, 0]), rear: Object.freeze([12, -12]) }),
  jab: Object.freeze({ lead: Object.freeze([64, -7]), rear: Object.freeze([12, -12]) }),
  cross: Object.freeze({ lead: Object.freeze([5, 11]), rear: Object.freeze([29, -7]) }),
  hit: Object.freeze({ lead: Object.freeze([27, 8]), rear: Object.freeze([12, -12]) }),
  block: Object.freeze({ lead: Object.freeze([36, -6]), rear: Object.freeze([12, -12]) }),
});

export function chogArmTargetPose(name) {
  const targets = CHOG_ARM_TARGETS[name];
  if (!targets) throw new RangeError(`Unknown Chog arm pose: ${name}`);
  return {
    leadHandTargetX: targets.lead[0],
    leadHandTargetY: targets.lead[1],
    rearHandTargetX: targets.rear[0],
    rearHandTargetY: targets.rear[1],
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Clamp authored local pose values once at the rig boundary. Both online and
 * solo modes use applyChogPose, so every pose gets the same safety constraints.
 */
export function clampChogPose(pose = {}) {
  const safePose = { ...pose };
  for (const [key, range] of Object.entries(CHOG_POSE_LIMITS)) {
    if (!(key in safePose)) continue;
    const value = Number(safePose[key]);
    safePose[key] = Number.isFinite(value)
      ? clamp(value, range.min, range.max)
      : 0;
  }
  return safePose;
}


/**
 * Shared knockout presentation for solo and live modes.
 * elapsedMs is presentation time only; the game/server still decides the KO.
 */
export function createChogKnockoutPose(basePose = {}, elapsedMs = 0) {
  const age = Math.max(0, Number.isFinite(Number(elapsedMs)) ? Number(elapsedMs) : 0);
  const progress = clamp(age / 420, 0, 1);
  const fall = 1 - ((1 - progress) ** 3);
  const settle = Math.exp(-Math.max(0, age - 420) / 240);
  return {
    ...basePose,
    leadArmRotation: -0.1 - fall * 0.10,
    rearArmRotation: 0.15 + fall * 0.11,
    leadArmLowerRotation: 0.35 + fall * 0.15,
    rearArmLowerRotation: -0.25 - fall * 0.15,
    leadLegRotation: -0.45 - fall * 0.06,
    rearLegRotation: 0.38 + fall * 0.05,
    leadLegLowerRotation: 0.65 + fall * 0.12,
    rearLegLowerRotation: -0.6 - fall * 0.12,
    torsoRotation: 0.22 + fall * 0.14,
    torsoX: -fall * 3,
    torsoY: 12 + fall * 4 - (1 - settle) * 1.5,
    headRotation: 0.16 + fall * 0.08,
    headX: fall * 1.5,
    headY: fall * 2,
  };
}

const LEG_LAYER_ORDER = [
  "right-upper-leg", "left-upper-leg",
  "right-lower-leg", "left-lower-leg",
  "right-foot", "left-foot",
];

const FACE_LAYER_ORDER = ["head", "eyes", "mouth"];

/**
 * Mirror the entire assembled sprite rig rather than swapping depth by facing.
 * The pose channels remain semantic (left = rear, right = lead); swapping only
 * their render order on a root flip makes the rear arm jump through the torso.
 *
 * The rear upper and lower arm segments sit behind the body, whose opaque pixels
 * cover their inner edges. Only the rear glove is rendered over the torso.
 */
export function getLayerOrder() {
  const armOrder = [
    "left-upper-arm", "left-lower-arm", "body", "left-hand",
    "right-upper-arm", "right-lower-arm", "right-hand",
  ];
  return [...LEG_LAYER_ORDER, ...armOrder, ...FACE_LAYER_ORDER];
}

// The PNGs have different pixel dimensions, but their artwork shares one normalized canvas.
const PARTS = {
  // All the source images represent the same 1024-unit character canvas,
  // even though some PNGs were exported at 768px or 3000px. Pivots therefore
  // stay in this normalized canvas coordinate system; don't add per-layer
  // offsets or the original artwork no longer lines up at rest.
  body:              { pivot: [500, 620] },
  head:              { pivot: [505, 450] },
  eyes:              { pivot: [505, 450] },
  mouth:             { pivot: [505, 450] },

  // Left arm is the rear arm when facing right; right arm is the lead arm.
  "left-upper-arm":  { pivot: [412, 485] },
  "left-lower-arm":  { pivot: [350, 610] },
  "left-hand":       { pivot: [270, 665] },
  "right-upper-arm": { pivot: [560, 485] },
  "right-lower-arm": { pivot: [620, 610] },
  "right-hand":      { pivot: [685, 665] },

  // Hip -> knee -> ankle pivots, positioned inside the overlap areas.
  "left-upper-leg":  { pivot: [420, 750] },
  "left-lower-leg":  { pivot: [405, 830] },
  "left-foot":       { pivot: [350, 890] },
  "right-upper-leg": { pivot: [600, 750] },
  "right-lower-leg": { pivot: [625, 820] },
  "right-foot":      { pivot: [630, 875] },
};

function canvasPoint(point, offset = [0, 0]) {
  return {
    x: (point[0] + offset[0] - SOURCE_SIZE / 2) * SCALE,
    y: (point[1] + offset[1] - SOURCE_SIZE / 2) * SCALE,
  };
}

function createPart(scene, root, name) {
  const spec = PARTS[name];
  const offset = [0, 0];
  const image = scene.add.image(0, 0, `chog-${name}`);
  image.setOrigin(spec.pivot[0] / SOURCE_SIZE, spec.pivot[1] / SOURCE_SIZE);
  image.setDisplaySize(RENDER_SIZE, RENDER_SIZE);
  const rest = canvasPoint(spec.pivot, offset);
  image.setPosition(rest.x, rest.y);
  root.add(image);
  return { image, rest, pivot: spec.pivot, offset };
}

function movePart(part, point, rotation) {
  part.image.setPosition(point.x, point.y);
  part.image.rotation = rotation;
}

function transformPoint(point, origin, angle, offsetX = 0, offsetY = 0) {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: origin.x + dx * cos - dy * sin + offsetX,
    y: origin.y + dx * sin + dy * cos + offsetY,
  };
}

function worldJoint(point, torsoOrigin, torsoAngle, torsoX, torsoY) {
  return transformPoint(point, torsoOrigin, torsoAngle, torsoX, torsoY);
}

function layeredJoint(point, parentPoint, localAngle) {
  return transformPoint(point, parentPoint, localAngle);
}

export function solveTwoBoneIK(shoulder, target, upperLength, lowerLength, bendDirection = 1) {
  const dx = target.x - shoulder.x;
  const dy = target.y - shoulder.y;
  const requestedDistance = Math.hypot(dx, dy);
  const minDistance = Math.abs(upperLength - lowerLength) + 1e-4;
  const maxDistance = upperLength + lowerLength - 1e-4;
  const distance = clamp(requestedDistance || minDistance, minDistance, maxDistance);
  const directionX = requestedDistance > 1e-8 ? dx / requestedDistance : 1;
  const directionY = requestedDistance > 1e-8 ? dy / requestedDistance : 0;
  const solvedTarget = {
    x: shoulder.x + directionX * distance,
    y: shoulder.y + directionY * distance,
  };
  const baseAngle = Math.atan2(solvedTarget.y - shoulder.y, solvedTarget.x - shoulder.x);
  const cosine = clamp(
    (upperLength ** 2 + distance ** 2 - lowerLength ** 2) / (2 * upperLength * distance),
    -1,
    1,
  );
  const elbowAngle = baseAngle + (bendDirection < 0 ? -1 : 1) * Math.acos(cosine);
  const elbow = {
    x: shoulder.x + Math.cos(elbowAngle) * upperLength,
    y: shoulder.y + Math.sin(elbowAngle) * upperLength,
  };
  return {
    shoulder: { x: shoulder.x, y: shoulder.y },
    elbow,
    wrist: solvedTarget,
    requestedTarget: { x: target.x, y: target.y },
    requestedDistance,
    upperLength,
    lowerLength,
  };
}

function placeArm(rig, side, pose, torsoOrigin, torsoAngle, torsoX, torsoY) {
  const upper = rig.parts[`${side}-upper-arm`];
  const lower = rig.parts[`${side}-lower-arm`];
  const hand = rig.parts[`${side}-hand`];
  const joints = rig.joints[side];
  const upperPoseKey = side === "right" ? "leadArm" : "rearArm";
  let upperAngle = pose[`${upperPoseKey}Rotation`] ?? 0;
  // Elbow articulation is authored by each pose.  Inferring a bend from the
  // shoulder angle made any pose that did not explicitly set this value curl
  // the forearm unpredictably, which is especially visible in a straight jab.
  let lowerAngle = pose[`${upperPoseKey}LowerRotation`] ?? 0;
  const upperX = pose[`${upperPoseKey}X`] ?? 0;
  const upperY = pose[`${upperPoseKey}Y`] ?? 0;

  // Apply the shoulder translation in the torso-local rest space so it rotates
  // with the body instead of being appended in screen space after the transform.
  const modifiedRest = {
    x: upper.rest.x + upperX,
    y: upper.rest.y + upperY,
  };
  const shoulder = worldJoint(modifiedRest, torsoOrigin, torsoAngle, torsoX, torsoY);

  const targetKey = side === "right" ? "leadHandTarget" : "rearHandTarget";
  const targetX = pose[`${targetKey}X`];
  const targetY = pose[`${targetKey}Y`];
  const hasTarget = Number.isFinite(targetX) && Number.isFinite(targetY);
  if (hasTarget) {
    const target = worldJoint({ x: targetX, y: targetY }, torsoOrigin, torsoAngle, torsoX, torsoY);
    const upperVector = {
      x: joints.elbow.x - upper.rest.x,
      y: joints.elbow.y - upper.rest.y,
    };
    const lowerVector = {
      x: joints.wrist.x - joints.elbow.x,
      y: joints.wrist.y - joints.elbow.y,
    };
    const solution = solveTwoBoneIK(
      shoulder,
      target,
      Math.hypot(upperVector.x, upperVector.y),
      Math.hypot(lowerVector.x, lowerVector.y),
      1,
    );
    const upperRestAngle = Math.atan2(upperVector.y, upperVector.x);
    const lowerRestAngle = Math.atan2(lowerVector.y, lowerVector.x);
    upperAngle = Math.atan2(solution.elbow.y - shoulder.y, solution.elbow.x - shoulder.x)
      - torsoAngle - upperRestAngle;
    lowerAngle = Math.atan2(solution.wrist.y - solution.elbow.y, solution.wrist.x - solution.elbow.x)
      - torsoAngle - upperAngle - lowerRestAngle;
  }

  movePart(upper, shoulder, torsoAngle + upperAngle);

  // Transform the elbow with the upper arm, then extend the forearm from
  // that transformed elbow. The old code transformed the wrist from the
  // original elbow again, which made the hand drift away during movement.
  const elbowLocal = transformPoint(joints.elbow, upper.rest, upperAngle);
  const modifiedElbowLocal = {
    x: elbowLocal.x + upperX,
    y: elbowLocal.y + upperY,
  };
  const elbow = worldJoint(modifiedElbowLocal, torsoOrigin, torsoAngle, torsoX, torsoY);
  movePart(lower, elbow, torsoAngle + upperAngle + lowerAngle);

  const forearmAngle = torsoAngle + upperAngle + lowerAngle;
  const wristVectorX = joints.wrist.x - joints.elbow.x;
  const wristVectorY = joints.wrist.y - joints.elbow.y;
  const cos = Math.cos(forearmAngle);
  const sin = Math.sin(forearmAngle);
  const wrist = {
    x: elbow.x + wristVectorX * cos - wristVectorY * sin,
    y: elbow.y + wristVectorX * sin + wristVectorY * cos,
  };
  movePart(hand, wrist, forearmAngle);

  // Root-local articulated anchors let tests verify the actual joints rather
  // than using sprite origins as a proxy for the elbow and wrist.
  rig.poseJoints[side] = {
    shoulder: { x: shoulder.x, y: shoulder.y },
    elbow: { x: elbow.x, y: elbow.y },
    wrist: { x: wrist.x, y: wrist.y },
    target: hasTarget ? worldJoint({ x: targetX, y: targetY }, torsoOrigin, torsoAngle, torsoX, torsoY) : null,
  };
}

function placeLeg(rig, side, pose, torsoOrigin, torsoAngle, torsoX, torsoY) {
  const upper = rig.parts[`${side}-upper-leg`];
  const lower = rig.parts[`${side}-lower-leg`];
  const foot = rig.parts[`${side}-foot`];
  const joints = rig.joints[side];
  const key = side === "right" ? "leadLeg" : "rearLeg";
  const upperAngle = pose[`${key}Rotation`] ?? 0;
  const lowerAngle = pose[`${key}LowerRotation`] ?? 0;
  const upperX = pose[`${key}X`] ?? 0;
  const upperY = pose[`${key}Y`] ?? 0;

  const hip = worldJoint(upper.rest, torsoOrigin, torsoAngle, torsoX, torsoY);
  hip.x += upperX;
  hip.y += upperY;
  movePart(upper, hip, torsoAngle + upperAngle);

  // The knee follows the hip rotation; the ankle is then extended from the
  // moved knee using the lower-leg angle. This keeps both joints connected.
  const kneeLocal = transformPoint(joints.knee, upper.rest, upperAngle);
  const knee = worldJoint(kneeLocal, torsoOrigin, torsoAngle, torsoX, torsoY);
  knee.x += upperX;
  knee.y += upperY;
  movePart(lower, knee, torsoAngle + upperAngle + lowerAngle);

  const lowerLegAngle = torsoAngle + upperAngle + lowerAngle;
  const ankleVectorX = joints.ankle.x - joints.knee.x;
  const ankleVectorY = joints.ankle.y - joints.knee.y;
  const cos = Math.cos(lowerLegAngle);
  const sin = Math.sin(lowerLegAngle);
  const ankle = {
    x: knee.x + ankleVectorX * cos - ankleVectorY * sin,
    y: knee.y + ankleVectorX * sin + ankleVectorY * cos,
  };
  // Keep the sole flatter than the shin through stance and jump poses.
  movePart(foot, ankle, lowerLegAngle * 0.35);
}

export function createChogVisual(scene, x, y, mirrored = false) {
  const root = scene.add.container(x, y);
  const shadow = scene.add.ellipse(0, 119, 132, 20, 0x30452e, 0.22);
  root.add(shadow);

  const parts = {};
  for (const name of getLayerOrder()) parts[name] = createPart(scene, root, name);

  const rest = {
    torso: parts.body.rest,
    head: parts.head.rest,
    leadArm: parts["right-upper-arm"].rest,
    rearArm: parts["left-upper-arm"].rest,
    leadLeg: parts["right-upper-leg"].rest,
    rearLeg: parts["left-upper-leg"].rest,
  };

  const rig = {
    root, shadow, parts,
    layers: Object.fromEntries(Object.entries(parts).map(([name, part]) => [name, part.image])),
    leadArm: parts["right-upper-arm"].image,
    rearArm: parts["left-upper-arm"].image,
    leadLeg: parts["right-upper-leg"].image,
    rearLeg: parts["left-upper-leg"].image,
    torso: parts.body.image,
    headParts: [parts.head.image, parts.eyes.image, parts.mouth.image],
    faceParts: [parts.head.image, parts.eyes.image, parts.mouth.image],
    tintLayers: Object.values(parts).map((part) => part.image),
    rest,
    poseJoints: { left: {}, right: {} },
    joints: {
      // A child pivot is the parent's next joint. Matching these coordinates
      // preserves the artist's original overlap with every pose at rest.
      left: {
        elbow: canvasPoint(PARTS["left-lower-arm"].pivot),
        wrist: canvasPoint(PARTS["left-hand"].pivot),
        knee: canvasPoint(PARTS["left-lower-leg"].pivot),
        ankle: canvasPoint(PARTS["left-foot"].pivot),
      },
      right: {
        elbow: canvasPoint(PARTS["right-lower-arm"].pivot),
        wrist: canvasPoint(PARTS["right-hand"].pivot),
        knee: canvasPoint(PARTS["right-lower-leg"].pivot),
        ankle: canvasPoint(PARTS["right-foot"].pivot),
      },
    },
    phase: mirrored ? 1.7 : 0,
    flashToken: 0,
    hitReactUntil: 0,
    landingUntil: 0,
  };

  root.rig = rig;
  root.setScale(mirrored ? -1 : 1, 1);
  return root;
}

export function applyChogPose(rig, pose) {
  if (!rig) return;

  const safePose = clampChogPose(pose);
  const torsoAngle = safePose.torsoRotation ?? 0;
  const torsoX = safePose.torsoX ?? 0;
  const torsoY = safePose.torsoY ?? 0;
  const torsoOrigin = rig.rest.torso;

  movePart(rig.parts.body, {
    x: torsoOrigin.x + torsoX,
    y: torsoOrigin.y + torsoY,
  }, torsoAngle);

  placeArm(rig, "left", safePose, torsoOrigin, torsoAngle, torsoX, torsoY);
  placeArm(rig, "right", safePose, torsoOrigin, torsoAngle, torsoX, torsoY);
  placeLeg(rig, "left", safePose, torsoOrigin, torsoAngle, torsoX, torsoY);
  placeLeg(rig, "right", safePose, torsoOrigin, torsoAngle, torsoX, torsoY);

  const headAnchor = worldJoint(rig.rest.head, torsoOrigin, torsoAngle, torsoX, torsoY);
  for (const facePart of rig.faceParts) {
    facePart.x = headAnchor.x + (safePose.headX ?? 0);
    facePart.y = headAnchor.y + (safePose.headY ?? 0);
    facePart.rotation = torsoAngle + (safePose.headRotation ?? 0);
  }
}

export function flashChog(scene, rig, color, duration = 90) {
  if (!rig) return;
  const flashToken = ++rig.flashToken;
  for (const layer of rig.tintLayers) layer.setTintFill(color);
  scene.time.delayedCall(duration, () => {
    if (rig.flashToken !== flashToken) return;
    for (const layer of rig.tintLayers) layer.clearTint();
  });
}
