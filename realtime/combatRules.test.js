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
state.players.challenger.energy = 100;
room._attack(state, "challenger", "base");
assert.equal(state.players.opponent.hp, hpBeforeProjectile, "a base move travels as a projectile instead of dealing instant damage");
assert.equal(state.projectiles.length, 1, "the server creates a physical projectile");
assert.equal(state.players.challenger.energy, 90, "base projectile spends 10 MP");
assert.equal(state.players.challenger.nextBaseAt > Date.now(), true, "base projectile has a cooldown");

const now = Date.now();
const punchState = {
  status: "IN_BATTLE",
  phase: "IN_BATTLE",
  lastTick: now,
  roundStartedAt: now - 1000,
  round: 1,
  roundWins: { challenger: 0, opponent: 0 },
  timeRemainingMs: 59000,
  projectiles: [],
  log: [],
  players: {
    challenger: { username: "C", role: "challenger", x: 280, y: 270, facing: 1, hp: 100, maxHp: 100, energy: 100, maxEnergy: 100, attack: 30, defense: 5, speed: 14, nextAttackAt: 0, input: { x: 0, y: 0 }, action: "idle", actionStartedAt: 0, actionUntil: 0, jumpHeight: 0, landedPunchWindows: [] },
    opponent: { username: "O", role: "opponent", x: 415, y: 270, facing: -1, hp: 100, maxHp: 100, energy: 100, maxEnergy: 100, attack: 20, defense: 5, speed: 14, nextAttackAt: 0, input: { x: 0, y: 0 }, action: "idle", actionStartedAt: 0, actionUntil: 0, jumpHeight: 0, landedPunchWindows: [] },
  },
};
const liveRoom = new ArenaRoom({}, {});
const startingHp = punchState.players.opponent.hp;
liveRoom._attack(punchState, "challenger", "doubleAttack");
assert.equal(punchState.players.opponent.hp, startingHp, "double tap starts an animation, not instant damage");
assert.equal(punchState.players.challenger.nextAttackAt > now, true, "double punch has a one-second cooldown");
liveRoom._step(punchState, now + 100);
assert.equal(punchState.players.opponent.hp < startingHp, true, "first punch damages only inside its hit window and hitbox");
const hpAfterJab = punchState.players.opponent.hp;
liveRoom._step(punchState, now + 280);
assert.equal(punchState.players.opponent.hp < hpAfterJab, true, "the rear cross can land during the second hit window");

const dbUpdates = [];
const dbStub = {
  prepare(sql) {
    return {
      bind(...args) {
        return {
          async run() {
            dbUpdates.push({ sql, args });
            return { success: true };
          },
        };
      },
    };
  },
};
const roundRoom = new ArenaRoom({}, { CHOG_DB: dbStub });
const makePlayer = (role, id, x, facing) => ({
  discordId: id, username: role, role, x, y: 270, facing, vx: 0, vy: 0,
  hp: 100, maxHp: 100, energy: 100, maxEnergy: 100, attack: 20, defense: 10, speed: 14,
  input: { x: 0, y: 0 }, nextAttackAt: 0, nextBaseAt: 0, nextSpecialAt: 0, nextDashAt: 0, nextJumpAt: 0,
  jumpStartedAt: 0, jumpUntil: 0, jumpHeight: 0, landedPunchWindows: [], action: "idle", actionStartedAt: 0, actionUntil: 0, flashUntil: 0,
});
const matchState = {
  inviteId: "round-flow-test",
  phase: "IN_BATTLE",
  status: "IN_BATTLE",
  round: 1,
  totalRounds: 3,
  roundTimeMs: 60_000,
  roundStartedAt: now - 5_000,
  timeRemainingMs: 55_000,
  roundWins: { challenger: 0, opponent: 0 },
  roundWinnerRole: null,
  roundResultUntil: 0,
  koRole: null,
  matchDraw: false,
  winnerDiscordId: null,
  projectiles: [],
  log: [],
  players: {
    challenger: makePlayer("challenger", "challenger-id", 280, 1),
    opponent: makePlayer("opponent", "opponent-id", 680, -1),
  },
};
await roundRoom._resolveMatch(matchState, now);
assert.equal(matchState.phase, "IN_BATTLE", "a healthy round keeps fighting");
matchState.players.opponent.hp = 0;
await roundRoom._resolveMatch(matchState, now + 1);
assert.equal(matchState.phase, "ROUND_OVER");
assert.equal(matchState.roundWins.challenger, 1);
await roundRoom._resolveMatch(matchState, matchState.roundResultUntil + 1);
assert.equal(matchState.round, 2);
assert.equal(matchState.players.opponent.hp, 100, "next round restores each fighter to full HP");
matchState.players.challenger.hp = 0;
await roundRoom._resolveMatch(matchState, matchState.roundStartedAt + 1);
assert.equal(matchState.roundWins.opponent, 1);
await roundRoom._resolveMatch(matchState, matchState.roundResultUntil + 1);
assert.equal(matchState.round, 3);
matchState.players.opponent.hp = 0;
await roundRoom._resolveMatch(matchState, matchState.roundStartedAt + 1);
assert.equal(matchState.roundWins.challenger, 2);
await roundRoom._resolveMatch(matchState, matchState.roundResultUntil + 1);
assert.equal(matchState.phase, "FINISHED");
assert.equal(matchState.status, "FINISHED");
assert.equal(matchState.winnerDiscordId, "challenger-id", "most round wins determines the winner");
assert.equal(dbUpdates.length, 2, "the final result updates the battle and invite records");

console.log("Multiplayer hitbox, projectile, combo cooldown and three-round checks passed.");
