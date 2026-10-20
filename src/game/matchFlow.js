export const MATCH_PHASES = {
  INTRO: "intro",
  COUNTDOWN: "countdown",
  FIGHTING: "fighting",
  ROUND_OVER: "round-over",
  MATCH_OVER: "match-over",
};

export const MATCH_RULES = {
  totalRounds: 3,
  roundTimeMs: 60_000,
};

export function createMatchState({
  totalRounds = MATCH_RULES.totalRounds,
  roundTimeMs = MATCH_RULES.roundTimeMs,
} = {}) {
  return {
    phase: MATCH_PHASES.INTRO,
    round: 0,
    totalRounds,
    roundTimeMs,
    timeRemainingMs: roundTimeMs,
    wins: { player: 0, opponent: 0 },
    lastWinner: null,
    matchWinner: null,
    draw: false,
    matchDraw: false,
  };
}

export function startRound(match) {
  if (match.phase === MATCH_PHASES.MATCH_OVER || match.round >= match.totalRounds) return false;
  match.round += 1;
  match.phase = MATCH_PHASES.FIGHTING;
  match.timeRemainingMs = match.roundTimeMs;
  match.lastWinner = null;
  match.draw = false;
  return true;
}

export function updateMatch(match, deltaMs, combatants) {
  if (match.phase !== MATCH_PHASES.FIGHTING) return match;

  match.timeRemainingMs = Math.max(0, match.timeRemainingMs - Math.max(0, deltaMs));

  const playerDown = Boolean(combatants.player.defeated || combatants.player.hp <= 0);
  const opponentDown = Boolean(combatants.opponent.defeated || combatants.opponent.hp <= 0);
  if (playerDown || opponentDown) {
    finishRound(match, playerDown === opponentDown ? null : playerDown ? "opponent" : "player");
    return match;
  }

  if (match.timeRemainingMs === 0) {
    if (combatants.player.hp === combatants.opponent.hp) finishRound(match, null);
    else finishRound(match, combatants.player.hp > combatants.opponent.hp ? "player" : "opponent");
  }

  return match;
}

export function finishRound(match, winner) {
  if (match.phase !== MATCH_PHASES.FIGHTING) return match;
  match.phase = MATCH_PHASES.ROUND_OVER;
  match.lastWinner = winner;
  match.draw = winner === null;

  if (winner) match.wins[winner] += 1;

  // Play exactly three rounds. Do not end early when a player takes the first
  // two: the declared winner is whoever has the most round wins after round 3.
  if (match.round >= match.totalRounds) {
    const playerWins = match.wins.player;
    const opponentWins = match.wins.opponent;
    match.matchWinner = playerWins === opponentWins ? null : playerWins > opponentWins ? "player" : "opponent";
    match.matchDraw = match.matchWinner === null;
    match.phase = MATCH_PHASES.MATCH_OVER;
  }

  return match;
}

export function isMatchOver(match) {
  return match.phase === MATCH_PHASES.MATCH_OVER;
}

export function getRoundLabel(match) {
  if (match.phase === MATCH_PHASES.INTRO) return "READY";
  if (match.phase === MATCH_PHASES.MATCH_OVER) {
    return match.matchDraw ? "MATCH DRAW" : `MATCH OVER: ${match.matchWinner.toUpperCase()} WINS`;
  }
  if (match.phase === MATCH_PHASES.ROUND_OVER) {
    return match.draw ? `ROUND ${match.round} DRAW` : `${match.lastWinner.toUpperCase()} WINS ROUND ${match.round}`;
  }
  return `ROUND ${match.round}/${match.totalRounds}`;
}
