/**
 * Stop only movement that is carrying a fighter into their opponent.
 * Unlike positional correction, this never pushes or teleports either fighter.
 */
export function stopMovementTowardOpponent(playerX, opponentX, velocityX, minDistance = 150) {
  const player = Number(playerX);
  const opponent = Number(opponentX);
  const velocity = Number(velocityX);
  const distance = opponent - player;
  const minimum = Math.max(0, Number(minDistance));

  if (![player, opponent, velocity, minimum].every(Number.isFinite)) return velocityX;
  if (Math.abs(distance) > minimum) return velocityX;

  if ((distance > 0 && velocity > 0) || (distance < 0 && velocity < 0)) return 0;
  return velocityX;
}
