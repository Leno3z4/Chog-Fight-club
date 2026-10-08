export const MATCH_PHASES = {
  INTRO: "intro",
  COUNTDOWN: "countdown",
  FIGHTING: "fighting",
  ROUND_OVER: "round-over",
  MATCH_OVER: "match-over",
};

export function createMatchState({ roundsToWin = 2, roundTimeMs = 99_000 } = {}) {
  return {
    phase: MATCH_PHASES.INTRO,
    round: 0,
    roundTimeMs,
    timeRemainingMs: roundTimeMs,
    roundsToWin,
    wins: { player: 0, opponent: 0 },
    lastWinner: null,
    matchWinner: null,
    draw: false,
  };
}

export function startRound(match) {
  if (match.matchWinner) return false;
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

  if (combatants.player.defeated || combatants.opponent.defeated) {
    const winner = combatants.player.defeated ? "opponent" : "player";
    finishRound(match, winner);
    return match;
  }

  if (match.timeRemainingMs === 0) {
    if (combatants.player.hp === combatants.opponent.hp) finishRound(match, null);
    else finishRound(match, combatants.player.hp > combatants.opponent.hp ? "player" : "opponent");
  }

  return match;
}

export function finishRound(match, winner) {
  match.phase = MATCH_PHASES.ROUND_OVER;
  match.lastWinner = winner;
  match.draw = winner === null;

  if (winner) match.wins[winner] += 1;
  if (winner && match.wins[winner] >= match.roundsToWin) {
    match.matchWinner = winner;
    match.phase = MATCH_PHASES.MATCH_OVER;
  }

  return match;
}

export function isMatchOver(match) {
  return match.phase === MATCH_PHASES.MATCH_OVER;
}

export function getRoundLabel(match) {
  if (match.phase === MATCH_PHASES.INTRO) return "READY";
  if (match.phase === MATCH_PHASES.MATCH_OVER) return `MATCH OVER — ${match.matchWinner.toUpperCase()} WINS`;
  if (match.phase === MATCH_PHASES.ROUND_OVER) return match.draw ? "DRAW" : `${match.lastWinner.toUpperCase()} WINS ROUND ${match.round}`;
  return `ROUND ${match.round}`;
}
