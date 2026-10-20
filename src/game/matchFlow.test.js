import assert from "node:assert/strict";
import {
  createMatchState,
  finishRound,
  getRoundLabel,
  isMatchOver,
  startRound,
  updateMatch,
} from "./matchFlow.js";

const match = createMatchState();
assert.equal(match.phase, "intro");
assert.equal(match.totalRounds, 3);
assert.equal(match.roundTimeMs, 60_000);
assert.equal(startRound(match), true);
assert.equal(match.phase, "fighting");
assert.equal(match.round, 1);
assert.equal(getRoundLabel(match), "ROUND 1/3");

updateMatch(match, 16, {
  player: { hp: 100, defeated: false },
  opponent: { hp: 0, defeated: true },
});
assert.equal(match.phase, "round-over");
assert.equal(match.lastWinner, "player");
assert.equal(match.wins.player, 1);
assert.equal(isMatchOver(match), false);

assert.equal(startRound(match), true);
finishRound(match, "opponent");
assert.equal(match.phase, "round-over", "a 1-1 score must still play round 3");
assert.equal(match.matchWinner, null);

assert.equal(startRound(match), true);
finishRound(match, "player");
assert.equal(match.phase, "match-over");
assert.equal(match.matchWinner, "player");
assert.equal(match.matchDraw, false);
assert.equal(match.wins.player, 2);
assert.equal(isMatchOver(match), true);
assert.equal(startRound(match), false);

const timed = createMatchState({ roundTimeMs: 1000 });
startRound(timed);
updateMatch(timed, 1000, {
  player: { hp: 70, defeated: false },
  opponent: { hp: 40, defeated: false },
});
assert.equal(timed.lastWinner, "player", "round timer chooses the higher remaining HP");

const tied = createMatchState({ totalRounds: 1, roundTimeMs: 1000 });
startRound(tied);
finishRound(tied, null);
assert.equal(tied.phase, "match-over");
assert.equal(tied.matchDraw, true);
assert.equal(tied.matchWinner, null);
assert.equal(getRoundLabel(tied), "MATCH DRAW");

const bothKOs = createMatchState({ totalRounds: 1 });
startRound(bothKOs);
updateMatch(bothKOs, 16, {
  player: { hp: 0, defeated: true },
  opponent: { hp: 0, defeated: true },
});
assert.equal(bothKOs.lastWinner, null, "simultaneous KOs draw the round");

console.log("Three-round match flow checks passed.");
