// Choose the soundtrack from authoritative match score/state.
// Current game rules are best-of-three rounds; the 1-1 tied deciding third
// round gets the same intensity cue. The exact 2-2 branch supports best-of-five
// or series modes without changing the current three-round rules.
export function chooseBattleMusicMode({
  playerWins = 0,
  opponentWins = 0,
  round = 1,
  totalRounds = 3,
  gameOver = false,
} = {}) {
  if (gameOver) return "stop";

  const leftWins = Math.max(0, Math.floor(Number(playerWins) || 0));
  const rightWins = Math.max(0, Math.floor(Number(opponentWins) || 0));
  const currentRound = Math.max(0, Number(round) || 0);
  const roundsInMatch = Math.max(0, Number(totalRounds) || 0);
  const isLastGame = roundsInMatch > 0 && currentRound >= roundsInMatch;
  const tiedAtTwoAll = leftWins === 2 && rightWins === 2 && isLastGame;
  const tiedDecider = isLastGame && leftWins === rightWins && leftWins > 0;

  return tiedAtTwoAll || tiedDecider ? "bossfight" : "fight";
}
