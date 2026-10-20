import assert from "node:assert/strict";
import {
  isTargetInFront,
  isWithinPunchHitbox,
  projectileOverlapsFighter,
  projectileIsDodgedByJump,
} from "./combatRules.js";
import { ArenaRoom } from "./worker.js";

assert.equal(isTargetInFront(100, 140, 1), true, "right-facing attacks can hit a target to the right");
assert.equal(isTargetInFront(100, 60, 1), false, "right-facing attacks cannot hit a target behind");
assert.equal(isTargetInFront(100, 60, -1), true, "left-facing attacks can hit a target to the left");
assert.equal(isTargetInFront(100, 140, -1), false, "left-facing attacks cannot hit a target behind");
assert.equal(isTargetInFront(100, 140, 0), false, "a fighter with no facing cannot hit");

const boxer = { x: 100, y: 250, facing: 1 };
assert.equal(isWithinPunchHitbox(boxer, { x: 130, y: 250 }), true, "a target in front of the punch hitbox can be hit");
assert.equal(isWithinPunchHitbox(boxer, { x: 300, y: 250 }), false, "punches cannot hit outside the physical hitbox");
assert.equal(isWithinPunchHitbox(boxer, { x: 130, y: 320 }), false, "punch hitboxes must also overlap vertically");
assert.equal(isWithinPunchHitbox(boxer, { x: 50, y: 250 }), false, "punches cannot hit behind the fighter");

const projectile = { x: 170, y: 250, radius: 10, height: 0 };
const groundedTarget = { x: 170, y: 250, jumpHeight: 0 };
assert.equal(projectileOverlapsFighter(projectile, groundedTarget), true, "projectile intersects the target");
assert.equal(projectileIsDodgedByJump(projectile, groundedTarget), false, "grounded target is hit by a colliding projectile");
assert.equal(projectileIsDodgedByJump(projectile, { ...groundedTarget, jumpHeight: 48 }), true, "jump only evades when the projectile crosses the target hitbox");
assert.equal(projectileOverlapsFighter(projectile, { ...groundedTarget, x: 250 }), false, "jumping or standing does not matter if the projectile misses");

const room = new ArenaRoom({}, {});
const state = {
  status: "IN_BATTLE",
  phase: "IN_BATTLE",
  projectiles: [],
  log: [],
  players: {
    challenger: { username: "A", role: "challenger", x: 100, y: 250, facing: 1, hp: 100, maxHp: 100, energy: 100, maxEnergy: 100, attack: 30, defense: 10, nextAttackAt: 0, input: { x: 0, y: 0 }, landedPunchWindows: [] },
    opponent: { username: "B", role: "opponent", x: 50, y: 250, facing: -1, hp: 100, maxHp: 100, energy: 100, maxEnergy: 100, attack: 20, defense: 10, nextAttackAt: 0, input: { x: 0, y: 0 }, landedPunchWindows: [] },
  },
};
room._attack(state, "challenger", "attack");
assert.equal(state.players.opponent.hp, 100, "a punch aimed behind the fighter must not deal damage");
assert.match(state.log.at(-1).text, /attacked away from their opponent/);

state.players.opponent.x = 240;
state.players.challenger.nextBaseAt = 0;
const hpBeforeProjectile = state.players.opponent.hp;
room._attack(state, "challenger", "base");
assert.equal(state.players.opponent.hp, hpBeforeProjectile, "a base move travels as a projectile instead of dealing instant damage");
assert.equal(state.projectiles.length, 1, "the server creates a physical projectile");
assert.equal(state.players.challenger.energy, 90, "base projectile spends 10 MP");
assert.equal(state.players.challenger.nextBaseAt > Date.now(), true, "base projectile has a cooldown");

console.log("Multiplayer hitbox, projectile and facing checks passed.");
