const SOURCE_SIZE = 1024;
const RENDER_SIZE = 250;
const SCALE = RENDER_SIZE / SOURCE_SIZE;

const LAYER_ORDER = [
  "right-upper-leg", "right-lower-leg", "right-foot",
  "left-upper-leg", "left-lower-leg", "left-foot",
  "right-upper-arm", "right-lower-arm", "right-hand",
  "body",
  "left-upper-arm", "left-lower-arm", "left-hand",
  "head", "eyes", "mouth",
];

// Each PNG is a full-size transparent canvas. Pivots are coordinates on
// that shared canvas; offsets close the small gaps left between cutout parts.
const PARTS = {
  body:             { pivot: [510, 640] },
  head:             { pivot: [505, 350], offset: [0, 80] },
  eyes:             { pivot: [505, 350], offset: [0, 80] },
  mouth:            { pivot: [505, 350], offset: [0, 80] },

  "left-upper-arm": { pivot: [405, 475] },
  "left-lower-arm": { pivot: [355, 600] },
  "left-hand":      { pivot: [280, 790], offset: [0, -85] },
  "right-upper-arm":{ pivot: [565, 480] },
  "right-lower-arm":{ pivot: [620, 610] },
  "right-hand":     { pivot: [690, 665], offset: [0, 35] },

  "left-upper-leg": { pivot: [455, 835], offset: [0, -42] },
  "left-lower-leg": { pivot: [405, 930], offset: [0, -42] },
  "left-foot":      { pivot: [430, 900], offset: [0, 40] },
  "right-upper-leg":{ pivot: [650, 735], offset: [-38, 42] },
  "right-lower-leg":{ pivot: [760, 890], offset: [-38, 42] },
  "right-foot":     { pivot: [790, 900], offset: [-38, 0] },
};

function canvasPoint(point, offset = [0, 0]) {
  return {
    x: (point[0] + offset[0] - SOURCE_SIZE / 2) * SCALE,
    y: (point[1] + offset[1] - SOURCE_SIZE / 2) * SCALE,
  };
}

function createPart(scene, root, name) {
  const spec = PARTS[name];
  const offset = spec.offset ?? [0, 0];
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

function placeArm(rig, side, pose, torsoOrigin, torsoAngle, torsoX, torsoY) {
  const upper = rig.parts[`${side}-upper-arm`];
  const lower = rig.parts[`${side}-lower-arm`];
  const hand = rig.parts[`${side}-hand`];
  const joints = rig.joints[side];
  const upperPoseKey = side === "left" ? "leadArm" : "rearArm";
  const upperAngle = pose[`${upperPoseKey}Rotation`] ?? 0;
  const lowerAngle = pose[`${upperPoseKey}LowerRotation`] ?? (upperAngle * 0.18);
  const upperX = pose[`${upperPoseKey}X`] ?? 0;
  const upperY = pose[`${upperPoseKey}Y`] ?? 0;

  const shoulder = worldJoint(upper.rest, torsoOrigin, torsoAngle, torsoX, torsoY);
  shoulder.x += upperX;
  shoulder.y += upperY;
  movePart(upper, shoulder, torsoAngle + upperAngle);

  // Transform the elbow with the upper arm, then extend the forearm from
  // that transformed elbow. The old code transformed the wrist from the
  // original elbow again, which made the hand drift away during movement.
  const elbowLocal = transformPoint(joints.elbow, upper.rest, upperAngle);
  const elbow = worldJoint(elbowLocal, torsoOrigin, torsoAngle, torsoX, torsoY);
  elbow.x += upperX;
  elbow.y += upperY;
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
}

function placeLeg(rig, side, pose, torsoOrigin, torsoAngle, torsoX, torsoY) {
  const upper = rig.parts[`${side}-upper-leg`];
  const lower = rig.parts[`${side}-lower-leg`];
  const foot = rig.parts[`${side}-foot`];
  const joints = rig.joints[side];
  const key = side === "left" ? "leadLeg" : "rearLeg";
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
  movePart(foot, ankle, lowerLegAngle);
}

export function createChogVisual(scene, x, y, mirrored = false) {
  const root = scene.add.container(x, y);
  const shadow = scene.add.ellipse(0, 119, 132, 20, 0x30452e, 0.22);
  root.add(shadow);

  const parts = {};
  for (const name of LAYER_ORDER) parts[name] = createPart(scene, root, name);

  const rest = {
    torso: parts.body.rest,
    head: parts.head.rest,
    leadArm: parts["left-upper-arm"].rest,
    rearArm: parts["right-upper-arm"].rest,
    leadLeg: parts["left-upper-leg"].rest,
    rearLeg: parts["right-upper-leg"].rest,
  };

  const rig = {
    root, shadow, parts,
    layers: Object.fromEntries(Object.entries(parts).map(([name, part]) => [name, part.image])),
    leadArm: parts["left-upper-arm"].image,
    rearArm: parts["right-upper-arm"].image,
    leadLeg: parts["left-upper-leg"].image,
    rearLeg: parts["right-upper-leg"].image,
    torso: parts.body.image,
    headParts: [parts.head.image, parts.eyes.image, parts.mouth.image],
    faceParts: [parts.head.image, parts.eyes.image, parts.mouth.image],
    tintLayers: Object.values(parts).map((part) => part.image),
    rest,
    joints: {
      left: {
        elbow: canvasPoint([355, 600]),
        wrist: canvasPoint([280, 705]),
        knee: canvasPoint([405, 888]),
        ankle: canvasPoint([430, 940]),
      },
      right: {
        elbow: canvasPoint([620, 610]),
        wrist: canvasPoint([690, 700]),
        knee: canvasPoint([722, 932]),
        ankle: canvasPoint([752, 930]),
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
  const torsoAngle = pose.torsoRotation ?? 0;
  const torsoX = pose.torsoX ?? 0;
  const torsoY = pose.torsoY ?? 0;
  const torsoOrigin = rig.rest.torso;

  movePart(rig.parts.body, {
    x: torsoOrigin.x + torsoX,
    y: torsoOrigin.y + torsoY,
  }, torsoAngle);

  placeArm(rig, "left", pose, torsoOrigin, torsoAngle, torsoX, torsoY);
  placeArm(rig, "right", pose, torsoOrigin, torsoAngle, torsoX, torsoY);
  placeLeg(rig, "left", pose, torsoOrigin, torsoAngle, torsoX, torsoY);
  placeLeg(rig, "right", pose, torsoOrigin, torsoAngle, torsoX, torsoY);

  const headAnchor = worldJoint(rig.rest.head, torsoOrigin, torsoAngle, torsoX, torsoY);
  for (const facePart of rig.faceParts) {
    facePart.x = headAnchor.x + (pose.headX ?? 0);
    facePart.y = headAnchor.y + (pose.headY ?? 0);
    facePart.rotation = torsoAngle + (pose.headRotation ?? 0);
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
