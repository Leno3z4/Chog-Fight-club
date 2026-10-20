const SOURCE_SIZE = 500;
const RENDER_SIZE = 250;
const PIXEL_SCALE = RENDER_SIZE / SOURCE_SIZE;

const LAYER_ORDER = [
  "left-leg",
  "right-leg",
  "body",
  "left-arm",
  "right-arm",
  "head",
  "eyes",
  "mouth",
  "nose",
];

// Anchors are in the original 500x500 shared canvas, near each joint.
const PIVOTS = {
  "left-leg": [292, 366],
  "right-leg": [260, 366],
  body: [256, 376],
  "left-arm": [286, 238],
  "right-arm": [240, 238],
  head: [270, 222],
  eyes: [270, 222],
  mouth: [270, 222],
  nose: [270, 222],
};

export function createChogVisual(scene, x, y, mirrored = false) {
  const root = scene.add.container(x, y);
  const shadow = scene.add.ellipse(0, 119, 132, 20, 0x30452e, 0.22);
  root.add(shadow);

  const layers = {};
  let mouth = null;
  for (const layer of LAYER_ORDER) {
    const [pivotX, pivotY] = PIVOTS[layer];
    const image = scene.add.image(
      (pivotX - SOURCE_SIZE / 2) * PIXEL_SCALE,
      (pivotY - SOURCE_SIZE / 2) * PIXEL_SCALE,
      `chog-${layer}`,
    );
    image.setOrigin(pivotX / SOURCE_SIZE, pivotY / SOURCE_SIZE);
    image.setDisplaySize(RENDER_SIZE, RENDER_SIZE);
    root.add(image);

    // Keep the existing eight-part rig map stable while exposing the mouth
    // as a facial overlay with the same canvas alignment and head pivot.
    if (layer === "mouth") mouth = image;
    else layers[layer] = image;
  }

  const rest = {
    leadArm: { x: layers["left-arm"].x, y: layers["left-arm"].y },
    rearArm: { x: layers["right-arm"].x, y: layers["right-arm"].y },
    leadLeg: { x: layers["left-leg"].x, y: layers["left-leg"].y },
    rearLeg: { x: layers["right-leg"].x, y: layers["right-leg"].y },
    torso: { x: layers.body.x, y: layers.body.y },
    head: { x: layers.head.x, y: layers.head.y },
  };

  const headParts = [layers.head, layers.eyes, layers.nose];
  const faceParts = [layers.head, layers.eyes, mouth, layers.nose];
  root.rig = {
    root,
    shadow,
    layers,
    mouth,
    leadArm: layers["left-arm"],
    rearArm: layers["right-arm"],
    leadLeg: layers["left-leg"],
    rearLeg: layers["right-leg"],
    torso: layers.body,
    headParts,
    faceParts,
    tintLayers: [...Object.values(layers), mouth],
    rest,
    phase: mirrored ? 1.7 : 0,
    flashToken: 0,
    hitReactUntil: 0,
    landingUntil: 0,
  };

  root.setScale(mirrored ? -1 : 1, 1);
  return root;
}

export function applyChogPose(rig, pose) {
  if (!rig) return;
  const torsoAngle = pose.torsoRotation ?? 0;
  const torsoX = pose.torsoX ?? 0;
  const torsoY = pose.torsoY ?? 0;
  const torsoOrigin = rig.rest.torso;

  rig.torso.x = torsoOrigin.x + torsoX;
  rig.torso.y = torsoOrigin.y + torsoY;
  rig.torso.rotation = torsoAngle;

  applyPart(rig.leadArm, rig.rest.leadArm, pose, "leadArm", torsoOrigin, torsoAngle, torsoX, torsoY);
  applyPart(rig.rearArm, rig.rest.rearArm, pose, "rearArm", torsoOrigin, torsoAngle, torsoX, torsoY);
  applyPart(rig.leadLeg, rig.rest.leadLeg, pose, "leadLeg", torsoOrigin, torsoAngle, torsoX, torsoY);
  applyPart(rig.rearLeg, rig.rest.rearLeg, pose, "rearLeg", torsoOrigin, torsoAngle, torsoX, torsoY);

  const head = transformJoint(rig.rest.head, torsoOrigin, torsoAngle, torsoX, torsoY);
  for (const part of rig.faceParts ?? rig.headParts) {
    part.x = head.x + (pose.headX ?? 0);
    part.y = head.y + (pose.headY ?? 0);
    part.rotation = torsoAngle + (pose.headRotation ?? 0);
  }
}

function applyPart(part, rest, pose, name, torsoOrigin, torsoAngle, torsoX, torsoY) {
  const joint = transformJoint(rest, torsoOrigin, torsoAngle, torsoX, torsoY);
  part.x = joint.x + (pose[`${name}X`] ?? 0);
  part.y = joint.y + (pose[`${name}Y`] ?? 0);
  part.rotation = torsoAngle + (pose[`${name}Rotation`] ?? 0);
}

function transformJoint(point, origin, angle, offsetX, offsetY) {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: origin.x + (dx * cos) - (dy * sin) + offsetX,
    y: origin.y + (dx * sin) + (dy * cos) + offsetY,
  };
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
