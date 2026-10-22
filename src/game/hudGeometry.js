export function getHudPortraitGeometry(gameWidth) {
  const viewportWidth = gameWidth * 0.094;
  const viewportHeight = gameWidth * 0.078;
  return {
    viewportWidth,
    viewportHeight,
    imageSize: viewportWidth * 1.06,
    cornerRadius: viewportHeight * 0.18,
  };
}

// The platform surface in the supplied arena artwork sits at roughly 82%
// of the live-scene height. The rig is scaled to 0.66, giving the feet an
// approximately 19%-of-scene-height downward reach from its root.
export function getLiveGroundLineY(height = 540) {
  return height * 0.82;
}

export function getLiveMaximumRootY(height = 540) {
  return getLiveGroundLineY(height) - height * 0.19;
}

// A malicious/stale server snapshot, jump animation, or tween must never put
// the live fighter's visual root low enough for the feet to cross the floor.
export function clampLiveRootY(rootY, jumpHeight = 0, height = 540) {
  const y = Number.isFinite(Number(rootY)) ? Number(rootY) : getLiveMaximumRootY(height);
  const jump = Number.isFinite(Number(jumpHeight)) ? Math.max(0, Number(jumpHeight)) : 0;
  return Math.min(y, getLiveMaximumRootY(height) - jump);
}

// In solo mode the Phaser physics body is centered 60px above the ground when
// grounded. The rig's feet extend about 165px below the visual root; leave a
// small safety margin so no pose clips through the arena's visible floor.
export function getSoloVisualRootY(playerBodyY, floorY) {
  return Math.min(Number(playerBodyY) - 105, Number(floorY) - 170);
}
