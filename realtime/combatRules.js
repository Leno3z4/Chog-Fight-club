export function isTargetInFront(attackerX, targetX, facing) {
  const direction = Math.sign(Number(facing) || 0);
  if (!direction || !Number.isFinite(attackerX) || !Number.isFinite(targetX)) return false;
  return direction * (targetX - attackerX) >= 0;
}

export function isWithinPunchHitbox(attacker, target, { minReach = 24, maxReach = 154, verticalReach = 48 } = {}) {
  if (!attacker || !target) return false;
  const facing = Math.sign(Number(attacker.facing) || 0);
  if (!facing) return false;
  const forwardDistance = (Number(target.x) - Number(attacker.x)) * facing;
  const verticalDistance = Math.abs(Number(target.y) - Number(attacker.y));
  return forwardDistance >= minReach && forwardDistance <= maxReach && verticalDistance <= verticalReach;
}

export function projectileOverlapsFighter(projectile, target, targetRadius = 30) {
  if (!projectile || !target) return false;
  const dx = Number(projectile.x) - Number(target.x);
  const dy = Number(projectile.y) - Number(target.y);
  const combinedRadius = Math.max(0, Number(projectile.radius) || 0) + targetRadius;
  return dx * dx + dy * dy <= combinedRadius * combinedRadius;
}

export function projectileIsDodgedByJump(projectile, target, targetRadius = 30) {
  if (!projectileOverlapsFighter(projectile, target, targetRadius)) return false;
  const projectileHeight = Number(projectile.height) || 0;
  return Number(target.jumpHeight || 0) > projectileHeight + (Number(projectile.radius) || 0) + 8;
}
