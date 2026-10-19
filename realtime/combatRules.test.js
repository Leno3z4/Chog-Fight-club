import assert from "node:assert/strict";
import { isTargetInFront } from "./combatRules.js";
import { ArenaRoom } from "./worker.js";

assert.equal(isTargetInFront(100, 140, 1), true, "right-facing attacks can hit a target to the right");
assert.equal(isTargetInFront(100, 60, 1), false, "right-facing attacks cannot hit a target behind");
assert.equal(isTargetInFront(100, 60, -1), true, "left-facing attacks can hit a target to the left");
assert.equal(isTargetInFront(100, 140, -1), false, "left-facing attacks cannot hit a target behind");
assert.equal(isTargetInFront(100, 140, 0), false, "a fighter with no facing cannot hit");

const room = new ArenaRoom({}, {});
const state = {
  log: [],
  players: {
    challenger: { username: "A", x: 100, y: 250, facing: 1, hp: 100, attack: 30, nextAttackAt: 0 },
    opponent: { username: "B", x: 50, y: 250, hp: 100, defense: 10 },
  },
};
room._attack(state, "challenger", false);
assert.equal(state.players.opponent.hp, 100, "the realtime server must not damage a fighter behind the attacker");
assert.match(state.log.at(-1).text, /attacked away from their opponent/);
console.log("Front-facing combat checks passed.");
