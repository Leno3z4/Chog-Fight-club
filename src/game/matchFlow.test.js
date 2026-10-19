import assert from "node:assert/strict";
import { createMatchState, finishRound, getRoundLabel, isMatchOver, startRound, updateMatch } from "./matchFlow.js";

const match = createMatchState({ roundsToWin: 2, roundTimeMs: 1000 });
assert.equal(match.phase, "intro");
assert.equal(startRound(match), true);
assert.equal(match.phase, "fighting");
assert.equal(match.round, 1);
assert.equal(getRoundLabel(match), "ROUND 1");

const player = { hp: 100, defeated: false };
const opponent = { hp: 0, defeated: true };
updateMatch(match, 16, { player, opponent });
assert.equal(match.phase, "round-over");
assert.equal(match.lastWinner, "player");
assert.equal(match.wins.player, 1);
assert.equal(isMatchOver(match), false);

assert.equal(startRound(match), true);
finishRound(match, "player");
assert.equal(match.phase, "match-over");
assert.equal(match.matchWinner, "player");
assert.equal(isMatchOver(match), true);

const timed = createMatchState({ roundsToWin: 2, roundTimeMs: 1000 });
startRound(timed);
updateMatch(timed, 1000, { player: { hp: 70, defeated: false }, opponent: { hp: 40, defeated: false } });
assert.equal(timed.lastWinner, "player");

console.log("Match flow sanity checks passed.");
