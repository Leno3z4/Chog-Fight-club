import test from "node:test";
import assert from "node:assert/strict";
import { chooseBattleMusicMode } from "./battleMusicState.js";

test("normal battle uses the looping fight track", () => {
  assert.equal(chooseBattleMusicMode(), "fight");
  assert.equal(chooseBattleMusicMode({ playerWins: 1, opponentWins: 0, round: 2, totalRounds: 3 }), "fight");
});

test("a tied final round in the current best-of-three format switches to bossfight", () => {
  assert.equal(chooseBattleMusicMode({ playerWins: 1, opponentWins: 1, round: 3, totalRounds: 3 }), "bossfight");
});

test("a tied 2-2 deciding game switches to bossfight in a five-game set", () => {
  assert.equal(chooseBattleMusicMode({ playerWins: 2, opponentWins: 2, round: 5, totalRounds: 5 }), "bossfight");
});

test("a 2-2 score before the final game keeps normal music", () => {
  assert.equal(chooseBattleMusicMode({ playerWins: 2, opponentWins: 2, round: 4, totalRounds: 5 }), "fight");
});

test("the intensity track does not trigger for an untied last round", () => {
  assert.equal(chooseBattleMusicMode({ playerWins: 2, opponentWins: 0, round: 3, totalRounds: 3 }), "fight");
});

test("music stops as soon as the match is over", () => {
  assert.equal(chooseBattleMusicMode({ playerWins: 2, opponentWins: 2, round: 5, totalRounds: 5, gameOver: true }), "stop");
});
