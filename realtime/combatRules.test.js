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
const baseStart = Date.now();
room._attack(state, "challenger", "base");
assert.equal(state.players.opponent.hp, hpBeforeProjectile, "a base move does not deal instant damage");
assert.equal(state.projectiles.length, 0, "a base projectile waits for its wind-up to finish");
assert.equal(state.players.challenger.pendingAttack.slot, "base", "the base attack is pending release during its wind-up");
assert.equal(state.players.challenger.energy, 90, "base attack spends 10 MP at startup");
assert.equal(state.players.challenger.nextBaseAt > baseStart, true, "base attack has a cooldown");
room._step(state, baseStart + 320);
assert.equal(state.projectiles.length, 1, "the base projectile launches after its wind-up");

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


const interruptNow = Date.now();
const interruptState = {
  status: "IN_BATTLE", phase: "IN_BATTLE", lastTick: interruptNow, roundStartedAt: interruptNow - 1000,
  round: 1, roundWins: { challenger: 0, opponent: 0 }, timeRemainingMs: 59000, projectiles: [], log: [],
  players: {
    challenger: { username: "Charge", role: "challenger", x: 280, y: 270, facing: 1, hp: 100, maxHp: 100, energy: 100, maxEnergy: 100, attack: 30, defense: 5, speed: 14, nextAttackAt: 0, nextBaseAt: 0, nextSpecialAt: 0, nextDashAt: 0, nextJumpAt: 0, jumpStartedAt: 0, jumpUntil: 0, jumpHeight: 0, input: { x: 0, y: 0 }, action: "idle", actionStartedAt: 0, actionUntil: 0, pendingAttack: null, landedPunchWindows: [] },
    opponent: { username: "Interrupt", role: "opponent", x: 415, y: 270, facing: -1, hp: 100, maxHp: 100, energy: 100, maxEnergy: 100, attack: 20, defense: 5, speed: 14, nextAttackAt: 0, nextBaseAt: 0, nextSpecialAt: 0, nextDashAt: 0, nextJumpAt: 0, jumpStartedAt: 0, jumpUntil: 0, jumpHeight: 0, input: { x: 0, y: 0 }, action: "idle", actionStartedAt: 0, actionUntil: 0, pendingAttack: null, landedPunchWindows: [] },
  },
};
const interruptRoom = new ArenaRoom({}, {});
interruptRoom._attack(interruptState, "challenger", "special");
assert.equal(interruptState.players.challenger.energy, 65, "special MP is spent when charging begins");
assert.equal(interruptState.players.challenger.pendingAttack.slot, "special");
interruptRoom._applyDamage(interruptState, "opponent", "basic", interruptNow + 100);
assert.equal(interruptState.players.challenger.hp < 100, true, "the interrupting hit still deals damage");
assert.equal(interruptState.players.challenger.pendingAttack, null, "a hit cancels a special before release");
assert.equal(interruptState.players.challenger.energy, 65, "interrupted special MP is not refunded");
interruptRoom._step(interruptState, interruptNow + 500);
assert.equal(interruptState.projectiles.length, 0, "an interrupted special never launches");

const airborne = interruptState.players.challenger;
airborne.hp = 100;
airborne.action = "jump";
airborne.jumpStartedAt = interruptNow;
airborne.jumpUntil = interruptNow + 600;
airborne.jumpHeight = 35;
interruptRoom._applyDamage(interruptState, "opponent", "basic", interruptNow + 120);
assert.equal(airborne.jumpUntil, interruptNow + 120, "a hit ends the jump immediately");
assert.equal(airborne.jumpHeight, 0, "a hit forces an airborne fighter straight to the ground");
assert.equal(airborne.action, "hitstun", "the landing hit transitions into hitstun");

const makeFacingPlayer = (role, x, facing, inputX = 0) => ({
  username: role, role, x, y: 270, facing, vx: 0, vy: 0,
  hp: 100, maxHp: 100, energy: 100, maxEnergy: 100, attack: 20, defense: 10, speed: 14,
  input: { x: inputX, y: 0 }, nextAttackAt: 0, nextBaseAt: 0, nextSpecialAt: 0, nextDashAt: 0, nextJumpAt: 0,
  jumpStartedAt: 0, jumpUntil: 0, jumpHeight: 0, landedPunchWindows: [],
  action: "idle", actionStartedAt: 0, actionUntil: 0, pendingAttack: null,
});
const facingRoom = new ArenaRoom({}, {});
const backstepAt = Date.now();
const backstepState = {
  status: "IN_BATTLE", phase: "IN_BATTLE", lastTick: backstepAt, roundStartedAt: backstepAt - 1000,
  timeRemainingMs: 59000, projectiles: [], log: [],
  players: {
    challenger: makeFacingPlayer("challenger", 300, 1, -1),
    opponent: makeFacingPlayer("opponent", 520, -1, 0),
  },
};
facingRoom._step(backstepState, backstepAt + 50);
assert.ok(backstepState.players.challenger.x < 300, "opposite horizontal input should move the fighter backward");
assert.equal(backstepState.players.challenger.facing, 1, "backstepping keeps the opponent-facing guard");

const turnAt = Date.now();
const turnState = {
  status: "IN_BATTLE", phase: "IN_BATTLE", lastTick: turnAt, roundStartedAt: turnAt - 1000,
  timeRemainingMs: 59000, projectiles: [], log: [],
  players: {
    challenger: makeFacingPlayer("challenger", 500, 1, 0),
    opponent: makeFacingPlayer("opponent", 320, 1, 0),
  },
};
facingRoom._step(turnState, turnAt + 16);
assert.equal(turnState.players.challenger.facing, -1, "if the rival is behind, the fighter turns toward them");

const gapAt = Date.now();
const gapState = {
  status: "IN_BATTLE", phase: "IN_BATTLE", lastTick: gapAt, roundStartedAt: gapAt - 1000,
  timeRemainingMs: 59000, projectiles: [], log: [],
  players: {
    challenger: makeFacingPlayer("challenger", 500, 1, 0),
    opponent: makeFacingPlayer("opponent", 620, -1, 0),
  },
};
facingRoom._step(gapState, gapAt + 16);
assert.ok(Math.hypot(
  gapState.players.challenger.x - gapState.players.opponent.x,
  gapState.players.challenger.y - gapState.players.opponent.y,
) >= 150 - 1e-6, "fighters should keep the updated minimum separation");

console.log("Multiplayer hitbox, wind-up interruption, air knockdown, combo cooldown and three-round checks passed.");


// Regression test: down/up input cannot drag the side-view fighters below the platform.
const groundRoom = new ArenaRoom({}, {});
const groundNow = Date.now();
const groundPlayer = (role, x, facing, inputY) => ({
  username: role, role, x, y: 270, facing, vx: 0, vy: 0,
  hp: 100, maxHp: 100, energy: 100, maxEnergy: 100, attack: 20, defense: 10, speed: 14,
  input: { x: 0, y: inputY }, nextAttackAt: 0, nextBaseAt: 0, nextSpecialAt: 0, nextDashAt: 0, nextJumpAt: 0,
  jumpStartedAt: 0, jumpUntil: 0, jumpHeight: 0, landedPunchWindows: [],
  action: "idle", actionStartedAt: 0, actionUntil: 0, pendingAttack: null,
  guarding: false, defendRequested: false, guardStartedAt: 0, guardCooldownUntil: 0, defenseRequiresRelease: false,
});
const groundState = {
  status: "IN_BATTLE", phase: "IN_BATTLE", lastTick: groundNow - 50,
  projectiles: [], log: [], roundStartedAt: groundNow - 1000, timeRemainingMs: 59000,
  players: {
    challenger: groundPlayer("challenger", 280, 1, 1),
    opponent: groundPlayer("opponent", 680, -1, -1),
  },
};
groundRoom._step(groundState, groundNow);
assert.equal(groundState.players.challenger.y, 324, "down input cannot sink the challenger below the floor lane");
assert.equal(groundState.players.opponent.y, 324, "up input cannot float the opponent off the floor lane");
