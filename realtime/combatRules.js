export function isTargetInFront(attackerX, targetX, facing) {
  const direction = Math.sign(Number(facing) || 0);
  if (!direction || !Number.isFinite(attackerX) || !Number.isFinite(targetX)) return false;
  return direction * (targetX - attackerX) >= 0;
}
