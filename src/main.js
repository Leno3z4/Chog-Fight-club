import Phaser from "phaser";
import { BootScene } from "./bootScene.js";
import { readSelectedFighter } from "./nft/chogNft.js";
import { buildBattleDNA } from "./game/battleDNA.js";
import combatData from "./game/data/combat.json" with { type: "json" };
import { CHARACTER_STATES, createCharacterStates } from "./game/characterStates.js";
import { StateMachine } from "./game/stateMachine.js";
import { InputBuffer } from "./game/inputBuffer.js";
import { getOpponentAttackPattern } from "./game/opponentAI.js";
import { getAttackPresentation } from "./game/attackPresentation.js";
import { applyChogPose, chogArmTargetPose, createChogKnockoutPose, createChogVisual as buildChogVisual, flashChog } from "./game/chogRig.js";
import { stopMovementTowardOpponent } from "./game/fighterSpacing.js";
import { createMatchState, MATCH_PHASES, startRound, updateMatch } from "./game/matchFlow.js";
import {
  beginOffensiveAction,
  canUseOffensiveAction,
  createCombatant,
  grantCounterWindow,
  getCooldownRemaining,
  move as engineMove,
  resolveBaseAbility,
  resolveBasicAttack,
  resolveDefenseAbility,
  resolveIncomingAttack,
  canHitTargetInFront,
  resolveSpecialAbility,
  updateCombatant,
  updateMovement,
} from "./game/combatEngine.js";

const GAME_WIDTH = 1280;
const GAME_HEIGHT = 720;
const WORLD_WIDTH = 1600;
const FLOOR_Y = 610;

const DEFAULT_PLAYER_METADATA = {
  tokenId: 561, name: "Blaze", Tier: "Legendary", Base: "1:1", Form: "Chog", Skin: "Red",
  Body: "Tuxedo", Eyes: "Angry", Head: "Crown", Aura: "Burning Aura", Background: "Blood Red",
  Mouth: "Smile", Side: "Left", Naked: "No",
};

function getPracticeMetadata() {
  const selection = readSelectedFighter();
  const metadata = selection?.metadata;
  if (!metadata) return DEFAULT_PLAYER_METADATA;
  const tokenId = selection.tokenId ?? metadata.tokenId ?? metadata.token_id ?? null;
  return {
    ...metadata,
    tokenId,
    name: metadata.name ?? (tokenId ? `Chog #${tokenId}` : "Selected Chog"),
  };
}

const practiceTouchInput = { left: false, right: false, crouch: false };
const practiceTouchActions = new Set();

const OPPONENT_METADATA = {
  tokenId: 973, name: "Test Water", Tier: "Common", Base: "Origin", Form: "Chog", Skin: "Blue",
  Body: "Stripes", Eyes: "Happy", Head: "Wizard Hat", Aura: "Aqua Aura", Background: "Aqua",
  Mouth: "Smile", Side: "Right", Naked: "No",
};

const BASE_RIG_POSE = {
  // Relaxed boxer guard: right/lead hand is primary, left/rear hand stays home.
  leadArmRotation: -0.04,
  leadArmLowerRotation: -1.14,
  // Keep the rear elbow compact; the wrist target positions the glove at cheek height.
  rearArmRotation: -1.24,
  rearArmLowerRotation: -1.18,
  // Wider, less crouched stance while keeping both soles close to level.
  leadLegRotation: -0.14,
  leadLegLowerRotation: 0.0,
  rearLegRotation: -0.5,
  rearLegLowerRotation: 0.68,
  torsoRotation: 0,
  headRotation: 0,
  leadArmX: 0,
  leadArmY: 0,
  rearArmX: 0,
  rearArmY: 0,
  leadLegX: 0,
  leadLegY: 0,
  rearLegX: 0,
  rearLegY: 0,
  torsoX: 0,
  torsoY: 0,
  headX: 0,
  headY: 0,
};

const ATTACK_STATES = new Set([
  CHARACTER_STATES.ATTACK_STARTUP,
  CHARACTER_STATES.ATTACK_ACTIVE,
  CHARACTER_STATES.ATTACK_RECOVERY,
]);

function clamp01(value) {
  return Phaser.Math.Clamp(value, 0, 1);
}

function easeInOutCubic(value) {
  const t = clamp01(value);
  return t < 0.5 ? 4 * t * t * t : 1 - (((-2 * t + 2) ** 3) / 2);
}

function impactEnvelope(age, duration) {
  const rise = easeInOutCubic(age / 50);
  const recovery = 1 - easeInOutCubic((age - 70) / Math.max(1, duration - 70));
  return clamp01(rise * recovery);
}

function blendRigPose(from, to, progress) {
  const t = clamp01(progress);
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  return Object.fromEntries([...keys].map((key) => [
    key,
    Phaser.Math.Linear(from[key] ?? 0, to[key] ?? 0, t),
  ]));
}

function circleIntersectsHurtbox(x, y, radius, zone) {
  if (!zone) return false;
  const width = zone.body?.width ?? 100;
  const height = zone.body?.height ?? 115;
  const closestX = Phaser.Math.Clamp(x, zone.x - width / 2, zone.x + width / 2);
  const closestY = Phaser.Math.Clamp(y, zone.y - height / 2, zone.y + height / 2);
  return (x - closestX) ** 2 + (y - closestY) ** 2 <= radius ** 2;
}

function hitboxIntersectsHurtbox(hitbox, zone) {
  if (!hitbox || !zone) return false;
  const a = hitbox.body ?? hitbox;
  const b = zone.body ?? zone;
  return Math.abs(hitbox.x - zone.x) <= (a.width + b.width) / 2
    && Math.abs(hitbox.y - zone.y) <= (a.height + b.height) / 2;
}

class ArenaScene extends Phaser.Scene {
  constructor() {
    super("ArenaScene");
    this.FLOOR_Y = FLOOR_Y;
    this.arenaWidth = GAME_WIDTH;
    this.arenaHeight = GAME_HEIGHT;
    this.floorY = FLOOR_Y;
    this.healthBarWidth = 300;
    this.player = null;
    this.opponent = null;
    this.playerVisual = null;
    this.opponentVisual = null;
    this.playerFacing = 1;
    this.walkBlend = 0;
    this.strideDist = 0;
    this.walkDir = 1;
    this.walkDirBlend = 1;
    this.lastPlayerPose = { ...BASE_RIG_POSE };
    this.match = null;
    this.matchHudText = null;
    this.matchOverlay = null;
    this.matchOverlayTitle = null;
    this.matchOverlayDetail = null;
    this.roundIntermissionMs = 0;
    this.basicTapPendingAt = null;
    this.basicDoubleTapWindowMs = 260;
    this.projectiles = [];
    this.playerHurtbox = null;
    this.opponentHurtbox = null;
    this.cursors = null;
    this.keys = null;
    this.playerCombatant = null;
    this.opponentCombatant = null;
    this.playerCharacter = null;
    this.inputBuffer = new InputBuffer();
    this.playerHpText = null;
    this.playerEnergyText = null;
    this.playerCooldownText = null;
    this.playerEnergyBar = null;
    this.statusText = null;
    this.playerBar = null;
    this.playerGhostBar = null;
    this.opponentBar = null;
    this.opponentGhostBar = null;
    this.incomingAttack = null;
    this.nextOpponentAttack = 1800;
    this.opponentAttackIndex = 0;
    this.wasGrounded = true;
    this.ghostHp = { player: 100, opponent: 100 };
    this.ghostPending = { player: false, opponent: false };
  }

  create() {
    this.basicTapPendingAt = null;
    this.projectiles = [];
    this.match = createMatchState({ totalRounds: 3, roundTimeMs: 60_000 });
    startRound(this.match);
    this.arenaWidth = this.scale.width || GAME_WIDTH;
    this.arenaHeight = this.scale.height || GAME_HEIGHT;
    this.floorY = Math.round(this.arenaHeight * (FLOOR_Y / GAME_HEIGHT));
    this.createArena();
    this.playerBattleDNA = buildBattleDNA(getPracticeMetadata());
    this.opponentBattleDNA = buildBattleDNA(OPPONENT_METADATA);
    this.playerCombatant = createCombatant(this.playerBattleDNA);
    this.opponentCombatant = createCombatant(this.opponentBattleDNA);

    const spawnGap = Math.min(720, this.arenaWidth * 0.56);
    this.player = this.physics.add.sprite(this.arenaWidth / 2 - spawnGap / 2, this.floorY - 72, "chog-hitbox");
    this.player.setSize(96, 120).setOffset(16, 0).setGravityY(combatData.movement.gravity).setCollideWorldBounds(true);
    this.player.setDragX(900).setMaxVelocity(360, 900);

    this.opponent = this.physics.add.staticSprite(this.arenaWidth / 2 + spawnGap / 2, this.floorY - 72, "chog-hitbox");
    this.opponent.setVisible(false);

    this.playerVisual = this.createChogVisual(this.player.x, this.floorY - 120, false);
    this.opponentVisual = this.createChogVisual(this.opponent.x, this.floorY - 120, true);
    this.playerHurtbox = this.createHurtbox(this.player);
    this.opponentHurtbox = this.createHurtbox(this.opponent);

    this.floor = this.physics.add.staticImage(this.arenaWidth / 2, this.floorY + (this.arenaHeight - this.floorY) / 2, "floor");
    this.floor.setDisplaySize(this.arenaWidth, this.arenaHeight - this.floorY).refreshBody();
    this.floor.setAlpha(0); // Collider only; the arena graphics draw the visible ground.
    this.floorCollider = this.physics.add.collider(this.player, this.floor);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys({
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      jump: Phaser.Input.Keyboard.KeyCodes.SPACE,
      jumpW: Phaser.Input.Keyboard.KeyCodes.W,
      crouch: Phaser.Input.Keyboard.KeyCodes.S,
      basic: Phaser.Input.Keyboard.KeyCodes.F,
      base: Phaser.Input.Keyboard.KeyCodes.ONE,
      special: Phaser.Input.Keyboard.KeyCodes.TWO,
      defense: Phaser.Input.Keyboard.KeyCodes.THREE,
    });

    this.playerCharacter = {
      scene: this,
      combatant: this.playerCombatant,
      input: { left: false, right: false, crouch: false },
      attack: null,
      attackCooldown: 0,
      hitstunRemaining: 0,
      stateMachine: null,
    };
    this.playerCharacter.stateMachine = new StateMachine(this.playerCharacter);
    createCharacterStates(this.playerCharacter);
    this.playerCharacter.stateMachine.change(CHARACTER_STATES.IDLE);

    this.createHud();
    this.ghostHp.player = this.playerCombatant.hp;
    this.ghostHp.opponent = this.opponentCombatant.hp;
    this.updateHealthBars(true);
    this.cameras.main.setBounds(0, 0, this.arenaWidth, this.arenaHeight);
    this.cameras.main.centerOn(this.arenaWidth / 2, this.arenaHeight / 2);
    this.scale.on("resize", this.resizeArena, this);
  }

  update(time, delta) {
    if (!this.player || !this.match) return;

    if (this.match.phase === MATCH_PHASES.FIGHTING) {
      const previousPhase = this.match.phase;
      updateMatch(this.match, delta, {
        player: this.playerCombatant,
        opponent: this.opponentCombatant,
      });
      if (this.match.phase !== previousPhase) {
        this.handleRoundTransition(time);
        this.updateVisuals(time, delta);
        this.updateHealthBars();
        this.updateHud();
        return;
      }
    } else if (this.match.phase === MATCH_PHASES.ROUND_OVER) {
      this.roundIntermissionMs = Math.max(0, this.roundIntermissionMs - delta);
      if (this.roundIntermissionMs === 0) this.resetForNextRound();
      this.updateVisuals(time, delta);
      this.updateHealthBars();
      this.updateHud();
      return;
    } else if (this.match.phase === MATCH_PHASES.MATCH_OVER) {
      this.updateVisuals(time, delta);
      this.updateHealthBars();
      this.updateHud();
      return;
    }

    const dt = delta / 1000;
    updateCombatant(this.playerCombatant, delta);
    updateCombatant(this.opponentCombatant, delta);
    updateMovement(this.playerCombatant, dt);
    this.captureInput();
    this.applyMovement();
    this.playerCharacter.stateMachine.update(delta);
    this.processBufferedInput();
    this.updateIncomingAttack(delta);
    this.updateHurtboxes();
    this.updateProjectiles(delta);
    this.updateVisuals(time, delta);
    this.updateHealthBars();
    this.updateHud();
  }

  registerBasicTap(now = performance.now()) {
    if (this.basicTapPendingAt != null && now - this.basicTapPendingAt <= this.basicDoubleTapWindowMs) {
      this.basicTapPendingAt = null;
      this.inputBuffer.push("doubleBasic", now);
      return;
    }
    this.basicTapPendingAt = now;
  }

  flushPendingBasicTap(now = performance.now()) {
    if (this.basicTapPendingAt == null || now - this.basicTapPendingAt <= this.basicDoubleTapWindowMs) return;
    this.basicTapPendingAt = null;
    this.inputBuffer.push("basic", now);
  }

  handleRoundTransition(time) {
    this.basicTapPendingAt = null;
    this.inputBuffer.clear();
    this.incomingAttack?.visual?.destroy();
    this.incomingAttack = null;
    for (const projectile of this.projectiles) projectile.visual?.destroy();
    this.projectiles = [];
    this.player.setVelocity(0, 0);

    if (this.playerCombatant.hp <= 0) {
      this.playerCharacter.stateMachine.change(CHARACTER_STATES.DEFEATED);
    } else {
      this.playerCharacter.attack = null;
      this.playerCharacter.stateMachine.change(CHARACTER_STATES.IDLE);
    }

    const score = `YOU ${this.match.wins.player}  —  ${this.match.wins.opponent} BOT`;
    const wasKO = this.playerCombatant.hp <= 0 || this.opponentCombatant.hp <= 0;
    if (this.match.phase === MATCH_PHASES.MATCH_OVER) {
      this.matchOverlayTitle.setText(this.match.matchDraw
        ? (wasKO ? "DOUBLE K.O. · MATCH DRAW" : "MATCH DRAW")
        : wasKO ? "K.O.!" : "MATCH OVER");
      this.matchOverlayDetail.setText(this.match.matchDraw
        ? `THREE ROUNDS COMPLETE · ${score}`
        : `${this.match.matchWinner === "player" ? "YOU WIN" : "BOT WINS"} · FINAL SCORE ${score}`);
      this.matchOverlay.setVisible(true);
      this.roundIntermissionMs = 0;
      this.showStatus(this.match.matchDraw ? "MATCH DRAW" : (this.match.matchWinner === "player" ? "VICTORY" : "DEFEAT"), 1800, 250);
      return;
    }

    const roundText = this.match.draw ? `ROUND ${this.match.round} DRAW`
      : `${this.match.lastWinner === "player" ? "YOU" : "BOT"} WIN ROUND ${this.match.round}`;
    this.matchOverlayTitle.setText(wasKO ? "K.O.!" : "ROUND OVER");
    this.matchOverlayDetail.setText(`${roundText} · SCORE ${score}`);
    this.matchOverlay.setVisible(true);
    this.roundIntermissionMs = 2200;
    this.showStatus(wasKO ? "K.O.!" : roundText, 1600, 250);
  }

  resetForNextRound() {
    this.playerCombatant.hp = this.playerCombatant.maxHp;
    this.opponentCombatant.hp = this.opponentCombatant.maxHp;
    for (const combatant of [this.playerCombatant, this.opponentCombatant]) {
      combatant.energy = combatant.maxEnergy;
      combatant.statuses = {};
      combatant.guarding = false;
      combatant.guardTimeRemaining = 0;
      combatant.counterWindowMs = 0;
      combatant.cooldowns = { basic: 0, base: 0, special: 0 };
      combatant.airborne = false;
      combatant.jumpTime = 0;
      combatant.evadeWindow = 0;
      combatant.defeated = false;
      combatant.koAnnounced = false;
    }
    this.playerCharacter.attack = null;
    this.playerCharacter.hitstunRemaining = 0;
    this.playerCharacter.input = { left: false, right: false, crouch: false };
    this.playerCharacter.stateMachine.change(CHARACTER_STATES.IDLE);
    this.incomingAttack?.visual?.destroy();
    this.incomingAttack = null;
    this.projectiles.forEach((projectile) => projectile.visual?.destroy());
    this.projectiles = [];
    const spawnGap = Math.min(720, this.arenaWidth * 0.56);
    const playerX = this.arenaWidth / 2 - spawnGap / 2;
    const opponentX = this.arenaWidth / 2 + spawnGap / 2;
    this.player.setPosition(playerX, this.floorY - 72).setVelocity(0, 0);
    this.opponent.setPosition(opponentX, this.floorY - 72);
    this.opponent.refreshBody();
    this.player.body.updateFromGameObject();
    this.playerVisual.setPosition(this.player.x, this.player.y - 55);
    this.opponentVisual.setPosition(this.opponent.x, this.floorY - 120);
    this.playerVisual.setScale(1, 1);
    this.opponentVisual.setScale(-1, 1);
    this.playerFacing = 1;
    this.opponentAttackIndex = 0;
    this.nextOpponentAttack = 1200;
    this.walkBlend = 0;
    this.strideDist = 0;
    this.walkDir = 1;
    this.walkDirBlend = 1;
    this.ghostHp.player = this.playerCombatant.hp;
    this.ghostHp.opponent = this.opponentCombatant.hp;
    this.matchOverlay.setVisible(false);
    startRound(this.match);
    this.updateHealthBars(true);
    this.showStatus(`ROUND ${this.match.round} — FIGHT!`, 900, 250);
  }

  captureInput() {
    const left = this.cursors.left.isDown || this.keys.left.isDown || practiceTouchInput.left;
    const right = this.cursors.right.isDown || this.keys.right.isDown || practiceTouchInput.right;
    this.playerCharacter.input.left = left;
    this.playerCharacter.input.right = right;
    this.playerCharacter.input.crouch = this.cursors.down.isDown || this.keys.crouch.isDown || practiceTouchInput.crouch;

    if (Phaser.Input.Keyboard.JustDown(this.keys.basic) || practiceTouchActions.delete("basic")) this.registerBasicTap();
    this.flushPendingBasicTap();
    if (Phaser.Input.Keyboard.JustDown(this.keys.base) || practiceTouchActions.delete("base")) this.inputBuffer.push("base");
    if (Phaser.Input.Keyboard.JustDown(this.keys.special) || practiceTouchActions.delete("special")) this.inputBuffer.push("special");
    if (Phaser.Input.Keyboard.JustDown(this.keys.defense) || practiceTouchActions.delete("defense")) this.inputBuffer.push("defense");
    if (Phaser.Input.Keyboard.JustDown(this.cursors.up) || Phaser.Input.Keyboard.JustDown(this.keys.jump) || Phaser.Input.Keyboard.JustDown(this.keys.jumpW) || practiceTouchActions.delete("jump")) {
      this.inputBuffer.push("jump");
    }
  }

  applyMovement() {
    const state = this.playerCharacter.stateMachine.currentName;
    const grounded = this.player.body.blocked.down || this.player.body.touching.down;
    const canMove = [CHARACTER_STATES.IDLE, CHARACTER_STATES.WALK, CHARACTER_STATES.JUMP].includes(state);
    if (!canMove) {
      if (state === CHARACTER_STATES.ATTACK_ACTIVE) {
        this.player.setVelocityX(this.playerFacing * 120);
      } else if (state !== CHARACTER_STATES.HITSTUN) {
        this.player.setVelocityX(0);
      }
      return;
    }

    // Keep facing the rival, not the movement key. Moving away from a rival
    // already in front becomes a backstep; if the rival is behind, turn first.
    // Facing stays locked during attacks and while airborne.
    if (grounded && state !== CHARACTER_STATES.JUMP && !ATTACK_STATES.has(state)
      && state !== CHARACTER_STATES.HITSTUN && state !== CHARACTER_STATES.DEFEATED) {
      const opponentIsInFront = (this.opponent.x - this.player.x) * this.playerFacing >= 0;
      if (!opponentIsInFront) this.playerFacing = this.opponent.x >= this.player.x ? 1 : -1;
    }

    if (this.playerCharacter.input.left) {
      this.player.setVelocityX(-combatData.movement.walkSpeed);
      engineMove(this.playerCombatant, "left");
    } else if (this.playerCharacter.input.right) {
      this.player.setVelocityX(combatData.movement.walkSpeed);
      engineMove(this.playerCombatant, "right");
    } else if (state !== CHARACTER_STATES.JUMP) {
      this.player.setVelocityX(0);
      engineMove(this.playerCombatant, "idle");
    }
  }

  processBufferedInput() {
    const state = this.playerCharacter.stateMachine.currentName;
    const canAct = state === CHARACTER_STATES.IDLE || state === CHARACTER_STATES.WALK;
    if (!canAct || this.playerCharacter.hitstunRemaining > 0) return;

    const bufferedAttack = this.inputBuffer.consume(["special", "base", "doubleBasic", "basic"]);
    if (bufferedAttack) {
      if (bufferedAttack.action === "doubleBasic") this.startAttack("basic", { combo: true });
      else this.startAttack(bufferedAttack.action);
      return;
    }

    const defense = this.inputBuffer.consume("defense");
    if (defense) {
      this.useDefense();
      return;
    }

    const jump = this.inputBuffer.consume("jump");
    const grounded = this.player.body.blocked.down || this.player.body.touching.down;
    if (jump && grounded) {
      this.playerCharacter.stateMachine.change(CHARACTER_STATES.JUMP);
      this.playerVisual.scaleY = 1.12;
    }
  }

  startAttack(slot, { combo = false } = {}) {
    const state = this.playerCharacter.stateMachine.currentName;
    if (![CHARACTER_STATES.IDLE, CHARACTER_STATES.WALK].includes(state)) return;

    if (!canUseOffensiveAction(this.playerCombatant, slot)) {
      const cooldown = getCooldownRemaining(this.playerCombatant, slot);
      if (cooldown > 0) this.showStatus(`${slot.toUpperCase()} RELOADING: ${(cooldown / 1000).toFixed(1)}s`);
      else this.showStatus("ENERGY RECHARGING");
      return;
    }

    try {
      beginOffensiveAction(this.playerCombatant, slot);
    } catch (error) {
      this.showStatus(error.message);
      return;
    }

    const facing = this.playerFacing;
    const ability = slot === "basic" ? null : this.playerBattleDNA.abilitySet[slot];
    const auraFamily = ability?.auraFamily ?? this.playerBattleDNA.abilitySet.base?.auraFamily ?? "neutral";
    const moveName = getAttackPresentation({ slot, ability, auraFamily }).name;
    const timing = slot === "basic" && combo
      ? { ...combatData.timing.basic, startup: 100, active: 350, recovery: 350 }
      : combatData.timing[slot];
    this.playerCharacter.stateMachine.change(CHARACTER_STATES.ATTACK_STARTUP, {
      attack: {
        slot,
        hand: "lead", // Right-hand default; only the combo's second strike uses the left/rear arm.
        combo: Boolean(combo),
        landedComboHits: [],
        ability,
        auraFamily,
        moveName,
        facing,
        elapsed: 0,
        hit: false,
        hitbox: null,
        timing,
        animationFrameDriven: false,
        resourceCommitted: true,
      },
    });
  }

  checkPlayerHit(sequence) {
    if (!sequence.hitbox || !this.opponentHurtbox.active) return;
    let comboHitIndex = -1;
    if (sequence.combo && sequence.slot === "basic") {
      const elapsed = sequence.elapsed ?? 0;
      comboHitIndex = elapsed >= 25 && elapsed <= 110 ? 0
        : elapsed >= 200 && elapsed <= 285 ? 1
          : -1;
      if (comboHitIndex < 0 || sequence.landedComboHits?.includes(comboHitIndex)) return;
    } else if (sequence.hit) {
      return;
    }
    if (!canHitTargetInFront(this.player.x, this.opponent.x, sequence.facing)) return;
    if (!this.physics.overlap(sequence.hitbox, this.opponentHurtbox)) return;
    if (sequence.combo && sequence.slot === "basic") sequence.landedComboHits.push(comboHitIndex);
    else sequence.hit = true;

    let result;
    try {
      if (sequence.slot === "basic") result = resolveBasicAttack(this.playerCombatant, this.opponentCombatant, sequence.resourceCommitted);
      else if (sequence.slot === "base") result = resolveBaseAbility(this.playerCombatant, this.opponentCombatant, sequence.resourceCommitted);
      else result = resolveSpecialAbility(this.playerCombatant, this.opponentCombatant, sequence.resourceCommitted);
    } catch (error) {
      this.showStatus(error.message);
      return;
    }

    this.onHit({
      attacker: this.player,
      defender: this.opponent,
      defenderVisual: this.opponentVisual,
      result,
      attack: sequence,
      heavy: sequence.slot === "special",
    });
  }

  useDefense() {
    if (this.playerCharacter.stateMachine.currentName !== CHARACTER_STATES.IDLE && this.playerCharacter.stateMachine.currentName !== CHARACTER_STATES.WALK) return;
    try {
      const result = resolveDefenseAbility(this.playerCombatant);
      if (this.incomingAttack && this.incomingAttack.timeLeft <= combatData.timing.perfectDefenseWindowMs) {
        this.incomingAttack.perfectParry = true;
      }
      this.showStatus(`DEFENSE: ${result.blockPercent}% BLOCK`);
      this.flashDefense(this.playerVisual);
    } catch (error) {
      this.showStatus(error.message);
    }
  }

  markPerfectJump() {
    const attack = this.incomingAttack;
    if (attack?.canBeEvaded && attack.timeLeft <= combatData.timing.perfectDefenseWindowMs) {
      attack.perfectEvade = true;
    }
  }

  updateIncomingAttack(delta) {
    if (this.incomingAttack) {
      const attack = this.incomingAttack;
      attack.timeLeft -= delta;
      if (attack.timeLeft <= 0) {
        this.incomingAttack = null;
        attack.visual?.destroy();
        if (attack.slot === "base" || attack.slot === "special") {
          this.spawnProjectile("opponent", attack.slot, attack.ability, attack.facing, attack.auraFamily);
          return;
        }

        const melee = this.createAttackHitbox(attack.facing, "basic");
        melee.setPosition(this.opponent.x + attack.facing * 82, this.opponent.y - 50);
        melee.body.updateFromGameObject();
        const overlaps = hitboxIntersectsHurtbox(melee, this.playerHurtbox);
        melee.destroy();
        if (!overlaps) {
          this.showStatus(this.playerCombatant.airborne ? "PUNCH DODGED" : "PUNCH MISSED", 500, 250);
          return;
        }
        const result = resolveIncomingAttack(this.opponentCombatant, this.playerCombatant, { ...attack, canBeEvaded: false });
        if (result.evaded) {
          const perfect = Boolean(result.parried || attack.perfectEvade);
          if (perfect) {
            grantCounterWindow(this.playerCombatant);
            this.nextOpponentAttack += combatData.timing.counterRecoveryBonusMs;
            this.opponentVisual.rig.hitReactDuration = 420;
            this.opponentVisual.rig.hitReactUntil = this.time.now + 420;
            this.flashDefense(this.playerVisual);
            this.showStatus(
              result.parried ? "PERFECT PARRY: COUNTER READY" : "PERFECT DODGE: COUNTER READY",
              combatData.timing.counterWindowMs - 250,
              250,
            );
          } else {
            this.showStatus("EVADED: JUMP LATE TO PUNISH");
          }
          this.createDust(this.player.x, this.player.y + 55);
        } else {
          this.onHit({
            attacker: this.opponent,
            defender: this.player,
            defenderVisual: this.playerVisual,
            result,
            attack,
            heavy: attack.heavy,
          });
        }
      }
      return;
    }

    if ([CHARACTER_STATES.ATTACK_ACTIVE, CHARACTER_STATES.ATTACK_RECOVERY].includes(this.playerCharacter.stateMachine.currentName)) return;
    this.nextOpponentAttack -= delta;
    if (this.nextOpponentAttack <= 0) {
      const requestedPattern = getOpponentAttackPattern(this.opponentAttackIndex, this.opponentBattleDNA.abilitySet);
      this.opponentAttackIndex += 1;
      let pattern = requestedPattern;
      if (!canUseOffensiveAction(this.opponentCombatant, pattern.slot)) {
        pattern = getOpponentAttackPattern(0, this.opponentBattleDNA.abilitySet);
      }
      if (!canUseOffensiveAction(this.opponentCombatant, pattern.slot)) {
        this.nextOpponentAttack = 250;
        return;
      }
      beginOffensiveAction(this.opponentCombatant, pattern.slot);
      this.nextOpponentAttack = requestedPattern.nextDelayMs;
      const facing = this.opponent.x < this.player.x ? 1 : -1;
      const visual = pattern.slot === "basic"
        ? null
        : this.createAbilityMarker(this.opponent.x + facing * 64, this.opponent.y - 72, pattern);
      if (visual) {
        this.tweens.add({ targets: visual, scaleX: 1.22, scaleY: 1.22, alpha: 0.36, duration: pattern.telegraphMs, ease: "Sine.easeOut" });
      }
      this.incomingAttack = {
        ...pattern,
        facing,
        timeLeft: pattern.telegraphMs,
        visual,
        action: `opponent-${pattern.id}`,
        perfectEvade: false,
        perfectParry: false,
      };
      this.showStatus(`INCOMING: ${pattern.cue}`, pattern.telegraphMs + 100, 100);
    }
  }

  onHit({ attacker, defender, defenderVisual, result, attack = {}, heavy }) {
    const damage = Math.round(result.damage ?? 0);
    if (damage <= 0) return;
    const counter = Boolean(result.counter);
    this.showDamageNumber(defender.x, defender.y - 75, damage, counter);
    this.createHitSparks(defender.x, defender.y - 75, attack, counter);
    this.createImpactVFX(defender.x, defender.y - 75, attack, counter);
    this.flashHit(defenderVisual, counter);
    const direction = defender.x >= attacker.x ? 1 : -1;
    if (defenderVisual?.rig) {
      defenderVisual.rig.hitReactDuration = counter ? 460 : 180;
      defenderVisual.rig.hitReactUntil = this.time.now + defenderVisual.rig.hitReactDuration;
    }
    if (defender === this.player) {
      this.player.setVelocityX(direction * 180);
      const wasAirborne = this.playerCombatant.airborne
        || !(this.player.body.blocked.down || this.player.body.touching.down);
      if (wasAirborne) {
        // A confirmed hit interrupts the jump arc and drops the fighter onto
        // the arena floor immediately; gravity must not continue the old arc.
        this.player.setVelocityY(0);
        this.player.setY(this.floorY - 72);
        this.player.body.updateFromGameObject();
        this.playerCombatant.airborne = false;
        this.playerCombatant.jumpTime = 0;
        this.playerCombatant.evadeWindow = 0;
        this.createDust(this.player.x, this.floorY - 3);
      }
      this.playerCharacter.stateMachine.change(CHARACTER_STATES.HITSTUN);
    }
    this.cameras.main.shake(counter ? 120 : heavy ? 120 : 70, counter ? 0.006 : heavy ? 0.007 : 0.004);
    this.applyHitstop(counter ? 85 : heavy ? combatData.timing.hitstop.heavy : combatData.timing.hitstop.normal);
    this.showStatus(counter ? `COUNTER! ${damage} DAMAGE` : `HIT: ${damage} DAMAGE`, counter ? 900 : 650, counter ? 300 : 350);
    const defenderCombatant = defender === this.player ? this.playerCombatant : this.opponentCombatant;
    if (defenderCombatant.hp <= 0 && !defenderCombatant.koAnnounced) {
      defenderCombatant.koAnnounced = true;
      this.showStatus(defender === this.player ? "K.O. — YOU ARE DOWN" : "K.O. — OPPONENT DOWN", 1500, 200);
      if (defender === this.player) this.playerCharacter.stateMachine.change(CHARACTER_STATES.DEFEATED);
    }
  }

  startPlayerProjectile(attack) {
    if (!attack || attack.projectileLaunched || !["base", "special"].includes(attack.slot)) return;
    attack.projectileLaunched = true;
    this.spawnProjectile("player", attack.slot, attack.ability, attack.facing, attack.auraFamily);
  }

  spawnProjectile(ownerRole, slot, ability, facing, auraFamily = "neutral") {
    const attacker = ownerRole === "player" ? this.player : this.opponent;
    const direction = Number(facing) < 0 ? -1 : 1;
    const speed = slot === "special" ? 660 : 560;
    const radius = slot === "special" ? 17 : 12;
    const x = attacker.x + direction * 52;
    const y = attacker.y - 55;
    const visual = this.createAbilityMarker(x, y, { slot, ability, auraFamily }).setDepth(18);
    visual.setScale(slot === "special" ? 1.1 : 0.85);
    this.projectiles.push({
      ownerRole, slot, ability, auraFamily, facing: direction,
      x, y, vx: direction * speed, radius, visual,
    });
  }

  updateProjectiles(delta) {
    const dt = Math.max(0, delta) / 1000;
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.projectiles[index];
      projectile.x += projectile.vx * dt;
      projectile.visual.setPosition(projectile.x, projectile.y);
      const targetIsPlayer = projectile.ownerRole === "opponent";
      const target = targetIsPlayer ? this.player : this.opponent;
      const hurtbox = targetIsPlayer ? this.playerHurtbox : this.opponentHurtbox;
      if (!target || !hurtbox) continue;

      if (circleIntersectsHurtbox(projectile.x, projectile.y, projectile.radius, hurtbox)) {
        const attacker = projectile.ownerRole === "player" ? this.player : this.opponent;
        const defender = target;
        const attackerCombatant = projectile.ownerRole === "player" ? this.playerCombatant : this.opponentCombatant;
        const defenderCombatant = targetIsPlayer ? this.playerCombatant : this.opponentCombatant;
        let result;
        try {
          result = projectile.slot === "base"
            ? resolveBaseAbility(attackerCombatant, defenderCombatant, true)
            : resolveSpecialAbility(attackerCombatant, defenderCombatant, true);
          this.onHit({
            attacker, defender,
            defenderVisual: targetIsPlayer ? this.playerVisual : this.opponentVisual,
            result,
            attack: projectile,
            heavy: projectile.slot === "special",
          });
        } catch (error) {
          this.showStatus(error?.message || "Projectile impact failed.");
        }
        projectile.visual.destroy();
        this.projectiles.splice(index, 1);
        continue;
      }

      if (projectile.x < -80 || projectile.x > this.arenaWidth + 80) {
        projectile.visual.destroy();
        this.projectiles.splice(index, 1);
      }
    }
  }

  createAttackHitbox(facing, slot = "basic") {
    const width = slot === "special" ? 135 : slot === "base" ? 120 : 110;
    const height = slot === "special" ? 105 : 95;
    const zone = this.add.zone(this.player.x + facing * (slot === "special" ? 92 : 82), this.player.y - 50, width, height);
    this.physics.add.existing(zone);
    zone.body.setAllowGravity(false);
    zone.body.setImmovable(true);
    return zone;
  }

  createHurtbox(body) {
    const zone = this.add.zone(body.x, body.y - 50, 100, 115);
    this.physics.add.existing(zone, true);
    zone.body.setSize(100, 115);
    return zone;
  }

  updateHurtboxes() {
    this.playerHurtbox.setPosition(this.player.x, this.player.y - 50);
    this.opponentHurtbox.setPosition(this.opponent.x, this.opponent.y - 50);
    this.playerHurtbox.body.updateFromGameObject();
    this.opponentHurtbox.body.updateFromGameObject();
    if (this.playerCharacter?.attack?.hitbox) {
      const facing = this.playerCharacter.attack.facing;
      const offset = this.playerCharacter.attack.slot === "special" ? 92 : 82;
      this.playerCharacter.attack.hitbox.setPosition(this.player.x + facing * offset, this.player.y - 50);
    }
  }

  syncAttackAnimationFrame(frameIndex) {
    const attack = this.playerCharacter?.attack;
    if (!attack) return;
    attack.animationFrameDriven = true;
    if (frameIndex === attack.timing.activeFrame) this.playerCharacter.stateMachine.change(CHARACTER_STATES.ATTACK_ACTIVE);
    if (frameIndex === attack.timing.recoveryFrame) this.playerCharacter.stateMachine.change(CHARACTER_STATES.ATTACK_RECOVERY);
  }

  applyHitstop(durationMs) {
    if (this.physics.world.isPaused) return;
    this.physics.world.isPaused = true;
    this.time.delayedCall(durationMs, () => { this.physics.world.isPaused = false; });
  }

  flashHit(visual, counter = false) {
    flashChog(this, visual?.rig, counter ? 0xffe07a : 0xffffff, counter ? 130 : 90);
  }

  flashDefense(visual) {
    const ability = this.playerBattleDNA?.abilitySet?.defense;
    const auraFamily = ability?.auraFamily ?? this.playerBattleDNA?.abilitySet?.base?.auraFamily ?? "neutral";
    const presentation = getAttackPresentation({ slot: "defense", ability, auraFamily });
    flashChog(this, visual?.rig, presentation.accent, 140);
    if (!visual) return;
    const ward = this.add.rectangle(visual.x, visual.y - 54, 44, 58, 0, 0)
      .setStrokeStyle(2.5, presentation.color, 0.88)
      .setDepth(16);
    this.tweens.add({
      targets: ward,
      scaleX: 1.28,
      scaleY: 1.18,
      alpha: 0,
      duration: 210,
      ease: "Sine.easeOut",
      onComplete: () => ward.destroy(),
    });
  }

  showDamageNumber(x, y, damage, counter = false) {
    const text = this.add.text(x, y, `-${damage}`, {
      fontFamily: "system-ui, sans-serif", fontSize: "28px", fontStyle: "900",
      color: counter ? "#ffd166" : "#ff3366", stroke: "#111318", strokeThickness: 5,
    }).setOrigin(0.5).setDepth(20);
    this.tweens.add({ targets: text, y: y - 75, alpha: 0, scale: 1.35, duration: 600, ease: "Power2", onComplete: () => text.destroy() });
  }

  createHitSparks(x, y, attack = {}, counter = false) {
    const presentation = getAttackPresentation(attack);
    if (!presentation.hasAuraVfx && !counter) return;
    const color = counter ? 0xffd166 : presentation.color;
    const count = Math.max(3, presentation.particleCount);
    for (let index = 0; index < count; index += 1) {
      const isShard = index % 3 === 0;
      const spark = isShard
        ? this.add.rectangle(x, y, Phaser.Math.Between(3, 5), Phaser.Math.Between(8, 14), index % 2 ? presentation.accent : color, 1)
        : this.add.circle(x, y, Phaser.Math.Between(2, 5), index % 2 ? presentation.accent : color, 1);
      spark.setDepth(18);
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const distance = Phaser.Math.Between(24, 48) * presentation.scale;
      if (isShard) spark.setAngle(angle * 180 / Math.PI);
      this.tweens.add({
        targets: spark,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
        alpha: 0,
        scaleX: 0.18,
        scaleY: 0.18,
        duration: attack?.slot === "special" ? 320 : 240,
        ease: "Quad.easeOut",
        onComplete: () => spark.destroy(),
      });
    }
  }

  createDust(x, y) {
    for (let i = 0; i < 5; i += 1) {
      const dust = this.add.circle(x + Phaser.Math.Between(-25, 25), y, Phaser.Math.Between(5, 9), 0xffffff, 0.35).setDepth(4);
      this.tweens.add({ targets: dust, x: dust.x + Phaser.Math.Between(-30, 30), y: y - Phaser.Math.Between(8, 22), alpha: 0, scale: 1.4, duration: 280, onComplete: () => dust.destroy() });
    }
  }

  createAbilityMarker(x, y, attack) {
    const presentation = getAttackPresentation(attack);
    const marker = this.add.container(x, y).setDepth(6);
    const radius = 11 + presentation.scale * 4;
    marker.add(this.add.circle(0, 0, radius, presentation.color, 0.08).setStrokeStyle(2.5, presentation.color, 0.92));
    marker.add(this.add.circle(0, 0, 4, presentation.accent, 0.92));

    if (presentation.shape === "wave" || presentation.shape === "orbit") {
      marker.add(this.add.ellipse(0, 0, radius * 2.25, radius * 1.15, 0, 0).setStrokeStyle(2, presentation.accent, 0.78));
    } else if (presentation.shape === "dash") {
      marker.add(this.add.rectangle(-3, 0, radius * 2.4, 3, presentation.accent, 0.88).setAngle(14));
      marker.add(this.add.rectangle(-7, -5, radius * 1.3, 2, presentation.color, 0.78).setAngle(14));
    } else if (["glyph", "reversal", "ward"].includes(presentation.shape)) {
      marker.add(this.add.rectangle(0, 0, radius * 1.35, radius * 1.35, presentation.accent, 0.18).setStrokeStyle(2, presentation.accent, 0.86).setAngle(45));
    } else {
      for (let index = 0; index < 4; index += 1) {
        const angle = (Math.PI / 2) * index;
        const shard = this.add.rectangle(Math.cos(angle) * radius, Math.sin(angle) * radius, 4, 8, presentation.accent, 0.9);
        shard.setAngle((angle * 180 / Math.PI) + 45);
        marker.add(shard);
      }
    }
    return marker;
  }

  createAttackVFX(attack) {
    const presentation = getAttackPresentation(attack);
    if (!presentation.hasAuraVfx) return null;
    const x = this.player.x + attack.facing * 62;
    const y = this.player.y - 64;
    const effect = this.createAbilityMarker(x, y, attack).setDepth(16);
    const distance = attack.slot === "special" ? 88 : attack.slot === "base" ? 66 : 42;
    const scale = attack.slot === "special" ? 1.9 : attack.slot === "base" ? 1.5 : 1.15;
    this.tweens.add({
      targets: effect,
      x: x + attack.facing * distance,
      scaleX: scale,
      scaleY: scale,
      alpha: 0,
      duration: attack.slot === "special" ? 280 : 190,
      ease: "Quad.easeOut",
      onComplete: () => effect.destroy(),
    });
    return presentation;
  }

  createImpactVFX(x, y, attack, counter = false) {
    const presentation = getAttackPresentation(attack);
    if (!presentation.hasAuraVfx && !counter) return;
    const color = counter ? 0xffd166 : presentation.color;
    const accent = counter ? 0xffffff : presentation.accent;
    const radiusScale = presentation.scale;
    const duration = attack?.slot === "special" ? 340 : attack?.slot === "base" ? 250 : 175;
    const ring = this.add.circle(x, y, 7, color, 0).setStrokeStyle(attack?.slot === "special" ? 4 : 2.5, color, 0.94).setDepth(18);
    const ringScale = 2.2 + radiusScale;
    this.tweens.add({
      targets: ring,
      scaleX: ringScale,
      scaleY: ringScale * 0.78,
      alpha: 0,
      duration,
      ease: "Quad.easeOut",
      onComplete: () => ring.destroy(),
    });

    if (["wave", "orbit"].includes(presentation.shape) || attack?.slot === "special") {
      const ripple = this.add.ellipse(x, y, 18, 10, accent, 0).setStrokeStyle(2, accent, 0.82).setDepth(18);
      this.tweens.add({
        targets: ripple,
        scaleX: ringScale * 1.45,
        scaleY: ringScale * 0.9,
        alpha: 0,
        duration: duration + 45,
        ease: "Sine.easeOut",
        onComplete: () => ripple.destroy(),
      });
    }
  }


  updateVisuals(time, delta) {
    const grounded = this.player.body.blocked.down || this.player.body.touching.down;
    if (grounded) {
      const currentVelocityX = this.player.body.velocity.x;
      const nextVelocityX = stopMovementTowardOpponent(
        this.player.x,
        this.opponent.x,
        currentVelocityX,
        150,
      );
      // Stop forward movement at contact; never teleport the fighter away from the rival.
      if (nextVelocityX !== currentVelocityX) this.player.setVelocityX(nextVelocityX);
    }

    this.updateHurtboxes();
    this.playerVisual.x = this.player.x;
    this.playerVisual.y = this.player.y - 55;
    this.opponentVisual.x = this.opponent.x;
    this.opponentVisual.y = this.floorY - 120;
    const state = this.playerCharacter.stateMachine.currentName;
    const moving = grounded && state === CHARACTER_STATES.WALK && (this.playerCharacter.input.left || this.playerCharacter.input.right);
    if (moving) {
      this.strideDist += Math.abs(this.player.body.velocity.x) * (delta / 1000);
      const travelDirection = Math.sign(this.player.body.velocity.x) * this.playerFacing;
      if (travelDirection) this.walkDir = travelDirection;
    }
    this.walkDirBlend += (this.walkDir - this.walkDirBlend) * (1 - Math.exp(-delta / 85));
    const walkTarget = moving ? 1 : 0;
    const walkRate = moving ? 13 : 18;
    this.walkBlend = Phaser.Math.Linear(this.walkBlend, walkTarget, 1 - Math.exp(-walkRate * (delta / 1000)));
    if (!ATTACK_STATES.has(state)) {
      const targetMagnitude = grounded ? (moving ? 1.02 : 1) : 1.04;
      const targetY = grounded ? (moving ? 0.98 : 1) : 1.08;
      const blend = 1 - Math.exp(-12 * (delta / 1000));
      const newMagnitude = Phaser.Math.Linear(Math.abs(this.playerVisual.scaleX), targetMagnitude, blend);
      this.playerVisual.scaleX = newMagnitude * this.playerFacing;
      this.playerVisual.scaleY = Phaser.Math.Linear(this.playerVisual.scaleY, targetY, blend);
    }
    if (!this.wasGrounded && grounded) {
      this.createDust(this.player.x, this.floorY - 3);
      this.playerVisual.scaleY = 0.88;
      this.playerVisual.rig.landingUntil = time + 180;
      this.playerVisual.rig.landingFromPose = { ...this.lastPlayerPose };
    }
    this.wasGrounded = grounded;

    const playerPose = this.getPlayerRigPose(time, grounded, moving);
    applyChogPose(this.playerVisual.rig, playerPose);
    this.lastPlayerPose = { ...playerPose };
    applyChogPose(this.opponentVisual.rig, this.getOpponentRigPose(time));
  }

  getReadyPose(time, phase, moving = false, walkDir = 1) {
    const idleWave = Math.sin((time / 1000) * 2.2 + phase);
    if (!moving) {
      // Keep both gloves close to the chin; breathing is intentionally subtle.
      const weightShift = Math.sin((time / 1000) * 1.35 + phase);
      return {
        ...BASE_RIG_POSE,
        leadArmRotation: BASE_RIG_POSE.leadArmRotation + idleWave * 0.012 + weightShift * 0.006,
        rearArmRotation: BASE_RIG_POSE.rearArmRotation - idleWave * 0.010 - weightShift * 0.006,
        leadArmLowerRotation: BASE_RIG_POSE.leadArmLowerRotation + idleWave * 0.010,
        rearArmLowerRotation: BASE_RIG_POSE.rearArmLowerRotation - idleWave * 0.010,
        leadArmY: Math.max(0, idleWave) * 0.35,
        rearArmY: Math.max(0, -idleWave) * 0.35,
        leadLegRotation: BASE_RIG_POSE.leadLegRotation + weightShift * 0.008,
        rearLegRotation: BASE_RIG_POSE.rearLegRotation - weightShift * 0.008,
        torsoRotation: weightShift * 0.010,
        torsoX: weightShift * 0.4,
        torsoY: -Math.max(0, idleWave) * 0.5,
        headRotation: weightShift * 0.008,
        headX: weightShift * 0.25,
      };
    }

    // Distance-driven boxer shuffle. A backstep phase-shifts the feet so the
    // rear foot leads; the upper body stays compact and guarded.
    const SHUFFLE_DISTANCE = 56;
    const u = ((this.strideDist / SHUFFLE_DISTANCE) % 1 + 1) % 1;
    const directionPhase = (2 * Math.PI * u) + ((1 - walkDir) / 2) * Math.PI;
    const stride = Math.sin(directionPhase);
    const leadLift = Math.max(0, Math.cos(directionPhase)) ** 2;
    const rearLift = Math.max(0, -Math.cos(directionPhase)) ** 2;
    const bob = 0.5 - Math.cos(2 * directionPhase) * 0.5;
    const swing = 0.34;
    return {
      ...BASE_RIG_POSE,
      leadArmRotation: BASE_RIG_POSE.leadArmRotation + stride * 0.03,
      rearArmRotation: BASE_RIG_POSE.rearArmRotation - stride * 0.03,
      leadArmY: -leadLift * 1.0,
      rearArmY: -rearLift * 1.0,
      leadLegRotation: BASE_RIG_POSE.leadLegRotation - stride * swing,
      rearLegRotation: BASE_RIG_POSE.rearLegRotation + stride * swing,
      leadLegLowerRotation: BASE_RIG_POSE.leadLegLowerRotation + leadLift * 0.35,
      rearLegLowerRotation: BASE_RIG_POSE.rearLegLowerRotation + rearLift * 0.35,
      leadLegY: -leadLift * 4,
      rearLegY: -rearLift * 4 - (walkDir < 0 ? 1 : 0),
      torsoRotation: -0.03 * walkDir,
      torsoX: stride * 1.0,
      torsoY: -bob * 2,
      headRotation: stride * 0.012,
      headX: -stride * 0.5,
    };
  }

  getPlayerReadyPose(time, phase) {
    const locomotionPose = blendRigPose(
      BASE_RIG_POSE,
      this.getReadyPose(time, phase, true, this.walkDirBlend),
      this.walkBlend,
    );
    // Rotation-only walking poses used to drop the target fields and leave the
    // rear hand parked at the shoulder. Keep both gloves in guard while moving.
    return { ...locomotionPose, ...chogArmTargetPose("guard") };
  }

  getAttackPose(attack, state, time, phase, readyPose = BASE_RIG_POSE) {
    const abilityType = attack.ability?.type ?? attack.motion ?? "burst";
    const power = attack.slot === "special" ? 1 : attack.slot === "base" ? 0.72 : 0.42;
    const armAction = abilityType === "defense"
      ? "block"
      : attack.slot === "basic" && attack.hand === "rear" ? "cross" : "jab";
    const windUp = { ...readyPose, ...chogArmTargetPose("guard") };
    const action = { ...readyPose, ...chogArmTargetPose(armAction) };

    // Keep both fists set in the same authored guard while the existing
    // startup timing loads the torso and stance.
    windUp.torsoRotation -= 0.035 * power;
    windUp.torsoX = (windUp.torsoX ?? 0) - 1.5 - power * 2;
    windUp.torsoY -= 1.5 + power * 2;
    windUp.leadLegRotation -= 0.025 * power;
    windUp.rearLegRotation += 0.03 * power;
    windUp.headRotation += 0.018;

    if (attack.slot === "basic" && attack.combo) {
      // Double tap is a short jab-cross sequence: load, snap out the lead
      // hand, return to guard, then rotate through the rear shoulder and hip.
      const load = {
        ...readyPose,
        ...chogArmTargetPose("guard"),
        torsoRotation: (readyPose.torsoRotation ?? 0) + 0.04,
        torsoX: (readyPose.torsoX ?? 0) - 2,
        torsoY: (readyPose.torsoY ?? 0) + 1,
      };
      const jab = {
        ...readyPose,
        ...chogArmTargetPose("jab"),
        torsoRotation: -0.14,
        torsoX: 8,
        torsoY: -1,
        leadLegRotation: (readyPose.leadLegRotation ?? BASE_RIG_POSE.leadLegRotation) - 0.12,
        leadLegX: (readyPose.leadLegX ?? 0) + 8,
        rearLegRotation: (readyPose.rearLegRotation ?? BASE_RIG_POSE.rearLegRotation) + 0.08,
        headX: 2,
        headRotation: -0.03,
      };
      const resetGuard = {
        ...readyPose,
        ...chogArmTargetPose("guard"),
        torsoRotation: (readyPose.torsoRotation ?? 0) + 0.015,
      };
      const cross = {
        ...readyPose,
        ...chogArmTargetPose("cross"),
        torsoRotation: -0.22,
        torsoX: 13,
        torsoY: -2,
        rearLegRotation: 0.16,
        rearLegLowerRotation: -0.15,
        rearLegX: 6,
        leadLegRotation: -0.10,
        headX: 3,
        headRotation: -0.04,
      };

      if (state === CHARACTER_STATES.ATTACK_STARTUP) {
        return blendRigPose(readyPose, load, easeInOutCubic(
          attack.elapsed / Math.max(1, attack.timing?.startup ?? 100),
        ));
      }
      if (state === CHARACTER_STATES.ATTACK_ACTIVE) {
        const progress = clamp01(attack.elapsed / Math.max(1, attack.timing?.active ?? 350));
        if (progress < 0.28) return blendRigPose(load, jab, easeInOutCubic(progress / 0.20));
        if (progress < 0.48) return blendRigPose(jab, resetGuard, easeInOutCubic((progress - 0.28) / 0.20));
        if (progress < 0.82) return blendRigPose(resetGuard, cross, easeInOutCubic((progress - 0.48) / 0.28));
        return blendRigPose(cross, readyPose, easeInOutCubic((progress - 0.82) / 0.18));
      }
      if (state === CHARACTER_STATES.ATTACK_RECOVERY) return readyPose;
      return readyPose;
    }

    if (attack.slot === "basic") {
      // Basic single tap remains one right-hand jab; the left cross is only
      // used by the explicit double-tap combo.
      // Reset the generic ability wind-up before laying in the jab or cross.
      Object.assign(windUp, readyPose);

      if (attack.hand === "rear") {
        // Left-hand rear cross: load the rear side and rotate harder through
        // the torso before driving the rear fist across the center line.
        windUp.torsoRotation = (readyPose.torsoRotation ?? 0) + 0.07;
        windUp.torsoX = (readyPose.torsoX ?? 0) - 4;
        windUp.torsoY = (readyPose.torsoY ?? 0) + 1;
        windUp.rearLegRotation = (readyPose.rearLegRotation ?? 0) + 0.06;

        action.torsoRotation = -0.22;
        action.torsoX = 14;
        action.torsoY = -2;
        action.rearLegRotation = (readyPose.rearLegRotation ?? BASE_RIG_POSE.rearLegRotation) + 0.16;
        action.rearLegLowerRotation = (readyPose.rearLegLowerRotation ?? BASE_RIG_POSE.rearLegLowerRotation) - 0.15;
        action.rearLegX = (readyPose.rearLegX ?? 0) + 6;
        action.leadLegRotation = (readyPose.leadLegRotation ?? BASE_RIG_POSE.leadLegRotation) - 0.10;
        action.headX = 3;
        action.headRotation = -0.04;
      } else {
        // Right-hand lead jab: keep the rear fist at the chin and drive the
        // lead elbow out, followed by a small step through the lead leg.
        windUp.torsoRotation = (readyPose.torsoRotation ?? 0) + 0.03;
        windUp.torsoX = (readyPose.torsoX ?? 0) - 2;

        action.torsoRotation = -0.14;
        action.torsoX = 8;
        action.torsoY = -1;
        action.leadLegRotation = (readyPose.leadLegRotation ?? BASE_RIG_POSE.leadLegRotation) - 0.12;
        action.leadLegX = (readyPose.leadLegX ?? 0) + 8;
        action.rearLegRotation = (readyPose.rearLegRotation ?? BASE_RIG_POSE.rearLegRotation) + 0.08;
        action.headX = 2;
        action.headRotation = -0.03;
      }
    } else if (abilityType === "control" || abilityType === "disruption") {
      action.torsoRotation = -0.08 * power;
      action.torsoY -= 6 * power;
      action.leadLegRotation = (readyPose.leadLegRotation ?? BASE_RIG_POSE.leadLegRotation) - 0.08 * power;
      action.rearLegRotation = (readyPose.rearLegRotation ?? BASE_RIG_POSE.rearLegRotation) + 0.10 * power;
      action.leadLegX = (action.leadLegX ?? 0) + 4 * power;
      action.rearLegX = (action.rearLegX ?? 0) - 2 * power;
    } else if (abilityType === "mobility") {
      action.torsoRotation = -0.18 * power;
      action.torsoX = (action.torsoX ?? 0) + 10 * power;
      action.leadLegRotation = (readyPose.leadLegRotation ?? BASE_RIG_POSE.leadLegRotation) - 0.20 * power;
      action.rearLegRotation = (readyPose.rearLegRotation ?? BASE_RIG_POSE.rearLegRotation) + 0.14 * power;
      action.leadLegX = (action.leadLegX ?? 0) + 8 * power;
      action.rearLegX = (action.rearLegX ?? 0) - 5 * power;
    } else if (abilityType === "defense") {
      action.torsoY -= 3 * power;
    } else {
      action.torsoRotation = -0.13 * power;
      action.torsoX = (action.torsoX ?? 0) + 3 * power;
      action.leadLegRotation = (readyPose.leadLegRotation ?? BASE_RIG_POSE.leadLegRotation) - 0.13 * power;
      action.rearLegRotation = (readyPose.rearLegRotation ?? BASE_RIG_POSE.rearLegRotation) + 0.15 * power;
      action.leadLegX = (action.leadLegX ?? 0) + 8 * power;
      action.rearLegX = (action.rearLegX ?? 0) - 8 * power;
    }

    if (attack.slot !== "basic") {
      action.headRotation = (action.headRotation ?? 0) - 0.02;
      action.headX = (action.headX ?? 0) + 1.2 * power;
      action.torsoY -= 1 * power;
    }

    const timings = attack.timing ?? {};
    if (state === CHARACTER_STATES.ATTACK_STARTUP) {
      const startupProgress = attack.elapsed / Math.max(1, timings.startup ?? 150);
      const startupBlend = attack.slot === "basic"
        ? clamp01(startupProgress) ** 2
        : easeInOutCubic(startupProgress);
      return blendRigPose(readyPose, windUp, startupBlend);
    }
    if (state === CHARACTER_STATES.ATTACK_ACTIVE) {
      if (attack.slot === "basic") {
        const strikeProgress = clamp01(attack.elapsed / Math.max(1, Math.min(timings.active ?? 100, 70)));
        const strikeBlend = 1 - ((1 - strikeProgress) ** 3);
        return blendRigPose(windUp, action, strikeBlend);
      }
      const activeWindow = Math.min(timings.active ?? 100, 95);
      return blendRigPose(windUp, action, easeInOutCubic(attack.elapsed / Math.max(1, activeWindow)));
    }
    if (state === CHARACTER_STATES.ATTACK_RECOVERY) {
      return blendRigPose(action, readyPose, easeInOutCubic(attack.elapsed / Math.max(1, timings.recovery ?? 240)));
    }
    return readyPose;
  }

  getHitPose(time, phase, intensity, readyPose = BASE_RIG_POSE) {
    const armRecovery = blendRigPose(
      { ...readyPose, ...chogArmTargetPose("guard") },
      { ...readyPose, ...chogArmTargetPose("hit") },
      intensity,
    );
    return {
      ...armRecovery,
      leadLegRotation: (readyPose.leadLegRotation ?? BASE_RIG_POSE.leadLegRotation) - 0.06 * intensity,
      rearLegRotation: (readyPose.rearLegRotation ?? BASE_RIG_POSE.rearLegRotation) + 0.08 * intensity,
      torsoRotation: 0.11 * intensity,
      headRotation: -0.045 * intensity,
      torsoX: -2 * intensity,
      torsoY: 1.2 * intensity,
    };
  }

  getCrouchPose(time, phase, readyPose = BASE_RIG_POSE) {
    const settle = Math.sin((time / 1000) * 3.8 + phase) * 0.012;
    return {
      ...readyPose,
      // Drop from the hips and bend the knees, keeping the gloves protecting
      // the face for the slip/crouch shown in the reference clip.
      leadArmRotation: readyPose.leadArmRotation - 0.07,
      rearArmRotation: readyPose.rearArmRotation - 0.035,
      leadArmLowerRotation: readyPose.leadArmLowerRotation - 0.05,
      rearArmLowerRotation: readyPose.rearArmLowerRotation - 0.07,
      leadArmY: (readyPose.leadArmY ?? 0) - 1.5,
      rearArmY: (readyPose.rearArmY ?? 0) - 1.5,
      // Bend the knees relative to the base stance and keep the torso drop shallow.
      leadLegRotation: (readyPose.leadLegRotation ?? BASE_RIG_POSE.leadLegRotation) - 0.12,
      rearLegRotation: (readyPose.rearLegRotation ?? BASE_RIG_POSE.rearLegRotation) + 0.10,
      leadLegLowerRotation: (readyPose.leadLegLowerRotation ?? BASE_RIG_POSE.leadLegLowerRotation) + 0.22,
      rearLegLowerRotation: (readyPose.rearLegLowerRotation ?? BASE_RIG_POSE.rearLegLowerRotation) - 0.22,
      leadLegY: readyPose.leadLegY ?? 0,
      rearLegY: (readyPose.rearLegY ?? 0) - 1.2,
      torsoRotation: (readyPose.torsoRotation ?? 0) + 0.025 + settle,
      torsoX: (readyPose.torsoX ?? 0) - 1,
      torsoY: (readyPose.torsoY ?? 0) + 1,
      headRotation: (readyPose.headRotation ?? 0) - 0.04,
      headY: (readyPose.headY ?? 0) + 1.5,
    };
  }

  getPlayerRigPose(time, grounded, moving) {
    const rig = this.playerVisual.rig;
    const state = this.playerCharacter.stateMachine.currentName;
    const attack = this.playerCharacter.attack;
    const locomotionPose = this.getPlayerReadyPose(time, rig.phase);
    const readyPose = { ...locomotionPose, ...chogArmTargetPose("guard") };
    if (state !== CHARACTER_STATES.DEFEATED) rig.koStartedAt = 0;
    if (attack && ATTACK_STATES.has(state)) return this.getAttackPose(attack, state, time, rig.phase, readyPose);
    if (state === CHARACTER_STATES.DEFEATED) {
      if (!rig.koStartedAt) rig.koStartedAt = time || 1;
      const koAge = Math.max(0, time - rig.koStartedAt);
      // Shared with the online renderer so both modes use the same fall arc.
      return createChogKnockoutPose(readyPose, koAge);
    }
    if (state === CHARACTER_STATES.HITSTUN) {
      const duration = Math.max(1, combatData.timing.hitstunMs);
      const age = duration - this.playerCharacter.hitstunRemaining;
      return this.getHitPose(time, rig.phase, impactEnvelope(age, duration), readyPose);
    }
    if (grounded && state !== CHARACTER_STATES.JUMP && this.playerCharacter.input.crouch) {
      return this.getCrouchPose(time, rig.phase, readyPose);
    }
    if (state === CHARACTER_STATES.JUMP || !grounded) {
      const vmax = Math.abs(combatData.movement.jumpVelocity);
      const p = Phaser.Math.Clamp((this.player.body.velocity.y + vmax) / (2 * vmax), 0, 1);
      const guard = {
        leadArmRotation: locomotionPose.leadArmRotation,
        rearArmRotation: locomotionPose.rearArmRotation,
        leadArmLowerRotation: locomotionPose.leadArmLowerRotation,
        rearArmLowerRotation: locomotionPose.rearArmLowerRotation,
      };
      const launch = {
        ...locomotionPose,
        ...guard,
        leadLegRotation: 0.0,
        leadLegLowerRotation: 0.05,
        rearLegRotation: -0.45,
        rearLegLowerRotation: 0.35,
        leadLegY: 2,
        rearLegY: 2,
        torsoY: -2,
      };
      const tuck = {
        ...locomotionPose,
        ...guard,
        // Softer tuck: draw both knees inward without a flat lead-thigh block.
        leadLegRotation: -0.8,
        leadLegLowerRotation: 1.66,
        rearLegRotation: -1.1,
        rearLegLowerRotation: 1.02,
        leadLegY: -4,
        rearLegY: -3,
        torsoRotation: -0.02,
        torsoY: -3,
      };
      const reach = {
        ...locomotionPose,
        ...guard,
        // Return to the narrow base stance before the landing compression.
        torsoY: -2,
      };

      if (p < 0.2) return blendRigPose(launch, tuck, easeInOutCubic(p / 0.2));
      if (p <= 0.55) {
        const armFloat = Math.sin((time / 1000) * 6) * 0.02;
        return {
          ...tuck,
          leadArmRotation: tuck.leadArmRotation + armFloat,
          rearArmRotation: tuck.rearArmRotation - armFloat,
        };
      }
      return blendRigPose(tuck, reach, easeInOutCubic((p - 0.55) / 0.45));
    }
    if (rig.landingUntil > time) {
      const landing = blendRigPose(
        locomotionPose,
        this.getCrouchPose(time, rig.phase, locomotionPose),
        0.8,
      );
      const progress = 1 - ((rig.landingUntil - time) / 180);
      if (progress < 0.3) {
        return blendRigPose(rig.landingFromPose ?? locomotionPose, landing, easeInOutCubic(progress / 0.3));
      }
      return blendRigPose(landing, locomotionPose, easeInOutCubic((progress - 0.3) / 0.7));
    }
    if (moving || this.walkBlend > 0.02) return locomotionPose;
    return readyPose;
  }

  getOpponentRigPose(time) {
    const rig = this.opponentVisual.rig;
    const readyPose = { ...this.getReadyPose(time, rig.phase, false), ...chogArmTargetPose("guard") };
    if (this.opponentCombatant?.hp <= 0) {
      if (!rig.koStartedAt) rig.koStartedAt = time || 1;
      const koAge = Math.max(0, time - rig.koStartedAt);
      return createChogKnockoutPose(readyPose, koAge);
    }
    rig.koStartedAt = 0;
    if (this.incomingAttack) {
      const pattern = this.incomingAttack;
      const elapsed = Phaser.Math.Clamp(pattern.telegraphMs - pattern.timeLeft, 0, pattern.telegraphMs);
      const attack = {
        slot: pattern.slot ?? pattern.animationSlot,
        ability: pattern.ability,
        auraFamily: pattern.auraFamily,
        motion: pattern.motion,
        timing: pattern.timing,
        elapsed,
      };
      if (elapsed < attack.timing.startup) return this.getAttackPose(attack, CHARACTER_STATES.ATTACK_STARTUP, time, rig.phase, readyPose);
      if (elapsed < attack.timing.startup + attack.timing.active) {
        attack.elapsed = elapsed - attack.timing.startup;
        return this.getAttackPose(attack, CHARACTER_STATES.ATTACK_ACTIVE, time, rig.phase, readyPose);
      }
      attack.elapsed = elapsed - attack.timing.startup - attack.timing.active;
      return this.getAttackPose(attack, CHARACTER_STATES.ATTACK_RECOVERY, time, rig.phase, readyPose);
    }
    if (rig.hitReactUntil > time) {
      const duration = rig.hitReactDuration ?? 180;
      const age = duration - (rig.hitReactUntil - time);
      return this.getHitPose(time, rig.phase, impactEnvelope(age, duration));
    }
    return readyPose;
  }

  updateHealthBars(force = false) {
    const values = [
      { key: "player", hp: this.playerCombatant.hp, max: this.playerCombatant.maxHp, fg: this.playerBar, ghost: this.playerGhostBar },
      { key: "opponent", hp: this.opponentCombatant.hp, max: this.opponentCombatant.maxHp, fg: this.opponentBar, ghost: this.opponentGhostBar },
    ];
    for (const item of values) {
      const ratio = Phaser.Math.Clamp(item.hp / item.max, 0, 1);
      item.fg.width = this.healthBarWidth * ratio;
      if (force) {
        this.ghostHp[item.key] = item.hp;
        this.ghostPending[item.key] = false;
      }
      if (this.ghostHp[item.key] > item.hp && !this.ghostPending[item.key]) {
        this.ghostPending[item.key] = true;
        this.time.delayedCall(160, () => {
          this.ghostHp[item.key] = item.hp;
          this.ghostPending[item.key] = false;
        });
      }
      const ghostRatio = Phaser.Math.Clamp(this.ghostHp[item.key] / item.max, 0, 1);
      item.ghost.width = Phaser.Math.Linear(item.ghost.width, this.healthBarWidth * ghostRatio, 0.12);
    }
  }

  createHud() {
    const textStyle = { fontFamily: "system-ui, sans-serif", color: "#16324A" };
    const identity = this.playerBattleDNA.identity;
    const stats = this.playerBattleDNA.stats;
    const token = identity.tokenId ? ` · Chog #${identity.tokenId}` : "";
    this.add.text(32, 56, `${identity.name || "Practice Chog"}${token} · ${identity.tier} Battle DNA · ATK ${stats.attack} · DEF ${stats.defense} · SPD ${stats.speed}`, { ...textStyle, fontSize: "13px", fontStyle: "700" }).setScrollFactor(0);
    const baseName = this.playerBattleDNA.abilitySet.base?.name ?? "Base Ability";
    const specialName = this.playerBattleDNA.abilitySet.special?.name ?? "Signature Ability";
    this.add.text(32, 80, `1 ${baseName}  ·  2 ${specialName}`, { ...textStyle, fontSize: "12px", fontStyle: "700" }).setScrollFactor(0);
    this.playerHpText = this.add.text(32, 120, "", { ...textStyle, fontSize: "14px" }).setScrollFactor(0);
    this.playerCooldownText = this.add.text(32, 182, "", { ...textStyle, fontSize: "12px" }).setScrollFactor(0);
    this.statusText = this.add.text(this.arenaWidth / 2, this.arenaHeight - 38, "", { ...textStyle, fontSize: "16px", align: "center" }).setOrigin(0.5).setScrollFactor(0).setDepth(30);
    this.matchHudText = this.add.text(this.arenaWidth / 2, 22, "", {
      ...textStyle, fontSize: "16px", fontStyle: "800", align: "center", color: "#16324A",
    }).setOrigin(0.5).setScrollFactor(0).setDepth(31);
    this.matchOverlay = this.add.container(this.arenaWidth / 2, this.arenaHeight / 2).setDepth(50).setScrollFactor(0).setVisible(false);
    const overlayShade = this.add.rectangle(0, 0, 520, 144, 0x10131b, 0.88).setStrokeStyle(2, 0xf0b53a, 0.95);
    this.matchOverlayTitle = this.add.text(0, -28, "ROUND OVER", {
      ...textStyle, fontSize: "30px", fontStyle: "900", color: "#f0b53a", align: "center",
    }).setOrigin(0.5);
    this.matchOverlayDetail = this.add.text(0, 22, "", {
      ...textStyle, fontSize: "15px", fontStyle: "800", color: "#ffffff", align: "center",
    }).setOrigin(0.5);
    this.matchOverlay.add([overlayShade, this.matchOverlayTitle, this.matchOverlayDetail]);

    this.playerGhostBar = this.add.rectangle(32, 106, 300, 18, 0xffffff, 0.32).setOrigin(0, 0.5).setScrollFactor(0).setDepth(10);
    this.playerBar = this.add.rectangle(32, 106, 300, 18, 0x53d769, 1).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11);
    this.playerEnergyBar = this.add.rectangle(32, 145, 300, 10, 0x39d96a, 1).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11);
    this.playerEnergyGhostBar = this.add.rectangle(32, 145, 300, 10, 0xffffff, 0.12).setOrigin(0, 0.5).setScrollFactor(0).setDepth(10);
    this.playerEnergyText = this.add.text(32, 156, "", { ...textStyle, fontSize: "11px" }).setScrollFactor(0).setDepth(12);

    this.opponentGhostBar = this.add.rectangle(0, 106, 300, 18, 0xffffff, 0.32).setOrigin(0, 0.5).setScrollFactor(0).setDepth(10);
    this.opponentBar = this.add.rectangle(0, 106, 300, 18, 0xf04b61, 1).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11);
    this.opponentEnergyBar = this.add.rectangle(0, 145, 300, 10, 0xb89eff, 1).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11);
    this.opponentEnergyGhostBar = this.add.rectangle(0, 145, 300, 10, 0xffffff, 0.12).setOrigin(0, 0.5).setScrollFactor(0).setDepth(10);
    this.opponentEnergyText = this.add.text(0, 156, "", { ...textStyle, fontSize: "11px", align: "right" }).setOrigin(1, 0).setScrollFactor(0).setDepth(12);
    this.opponentLabel = this.add.text(0, 120, "OPPONENT", { ...textStyle, fontSize: "14px" }).setScrollFactor(0);
    this.positionHud(this.arenaWidth, this.arenaHeight);
  }

  updateHud() {
    const hp = Math.max(0, Math.round(this.playerCombatant.hp));
    const energy = Math.round(this.playerCombatant.energy);
    const energyRatio = Phaser.Math.Clamp(this.playerCombatant.energy / this.playerCombatant.maxEnergy, 0, 1);
    const opponentEnergy = Math.round(this.opponentCombatant.energy);
    const opponentEnergyRatio = Phaser.Math.Clamp(this.opponentCombatant.energy / this.opponentCombatant.maxEnergy, 0, 1);
    this.playerHpText.setText(`HP ${hp}/${this.playerCombatant.maxHp}`);
    this.playerEnergyBar.width = this.healthBarWidth * energyRatio;
    this.opponentEnergyBar.width = this.healthBarWidth * opponentEnergyRatio;
    this.playerEnergyText.setText(`MP ${energy}%  •  Basic 5%  •  Base 10%  •  Special 35%`);
    this.opponentEnergyText.setText(`BOT MP ${opponentEnergy}%`);

    if (this.matchHudText) {
      const seconds = Math.ceil(this.match.timeRemainingMs / 1000);
      this.matchHudText.setText(`ROUND ${this.match.round}/${this.match.totalRounds}  ·  ${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}  ·  ${this.match.wins.player}-${this.match.wins.opponent}`);
    }

    const basic = getCooldownRemaining(this.playerCombatant, "basic");
    const base = getCooldownRemaining(this.playerCombatant, "base");
    const special = getCooldownRemaining(this.playerCombatant, "special");
    const cooldownLabel = (name, value) => value > 0 ? `${name} ${(value / 1000).toFixed(1)}s` : `${name} READY`;
    this.playerCooldownText.setText(`${cooldownLabel("F", basic)}  •  ${cooldownLabel("1", base)}  •  ${cooldownLabel("2", special)}`);
  }

  showStatus(message, holdMs = 650, fadeMs = 350) {
    this.statusText.setText(message).setAlpha(1);
    this.tweens.killTweensOf(this.statusText);
    this.tweens.add({ targets: this.statusText, alpha: 0, delay: holdMs, duration: fadeMs });
  }

  createArena() {
    const width = this.arenaWidth;
    const height = this.arenaHeight;
    const floorY = this.floorY;
    const bg = this.arenaBackground ?? this.add.graphics();
    bg.clear();

    // Keep the sky, distant treeline and floor visually distinct. The old
    // oversized circular trees made the whole backdrop look like repeating
    // columns behind the fighters.
    bg.fillGradientStyle(0x9bc9e8, 0x9bc9e8, 0xd8eff7, 0xd8eff7, 1);
    bg.fillRect(0, 0, width, height);

    bg.fillStyle(0x85b3a1, 0.15);
    bg.fillEllipse(width * 0.22, floorY * 0.78, width * 0.62, floorY * 0.42);
    bg.fillEllipse(width * 0.78, floorY * 0.8, width * 0.66, floorY * 0.38);

    const horizon = floorY * 0.55;
    const treePositions = [0.04, 0.15, 0.28, 0.42, 0.58, 0.72, 0.86, 0.97];
    for (let i = 0; i < treePositions.length; i += 1) {
      const x = width * treePositions[i];
      const radius = height * ([0.045, 0.052, 0.04, 0.048][i % 4]);
      const canopyY = horizon + (i % 3) * 8;
      bg.fillStyle(0x6d9b70, 0.25);
      bg.fillRect(x - 7, canopyY + radius * 0.45, 14, Math.max(45, floorY - canopyY - radius * 0.35));
      bg.fillCircle(x, canopyY, radius);
      bg.fillCircle(x - radius * 0.62, canopyY + radius * 0.28, radius * 0.72);
      bg.fillCircle(x + radius * 0.58, canopyY + radius * 0.25, radius * 0.78);
    }

    bg.fillStyle(0xcfe3a4, 1);
    bg.fillRect(0, floorY - 2, width, height - floorY + 2);
    bg.fillStyle(0x92b66c, 1);
    bg.fillRect(0, floorY, width, 12);
    this.arenaBackground = bg;

    const arenaGlow = this.arenaGlow ?? this.add.graphics();
    arenaGlow.clear();
    arenaGlow.fillStyle(0xffffff, 0.11);
    arenaGlow.fillEllipse(width / 2, floorY - 3, Math.min(1050, width * 0.85), height * 0.25);
    this.arenaGlow = arenaGlow;
    if (!this.arenaLabel) {
      this.arenaLabel = this.add.text(0, 0, "TRAINING ARENA", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "14px",
        color: "#16324A",
      }).setOrigin(0.5);
    }
    this.arenaLabel.setPosition(width / 2, height * 0.21);
  }

  positionHud(width, height) {
    if (!this.statusText) return;
    this.healthBarWidth = Math.min(300, Math.max(100, (width - 96) / 2));
    this.statusText.setPosition(width / 2, height - 38);
    this.matchHudText.setPosition(width / 2, 22);
    this.matchOverlay.setPosition(width / 2, height / 2);
    const opponentX = width - 32 - this.healthBarWidth;
    this.opponentGhostBar.setPosition(opponentX, 106).setSize(this.healthBarWidth, 18);
    this.opponentBar.setPosition(opponentX, 106).setSize(this.healthBarWidth, 18);
    this.opponentEnergyBar.setPosition(opponentX, 145).setSize(this.healthBarWidth, 10);
    this.opponentEnergyGhostBar.setPosition(opponentX, 145).setSize(this.healthBarWidth, 10);
    this.opponentEnergyText.setPosition(opponentX + this.healthBarWidth, 156);
    this.opponentLabel.setPosition(opponentX, 120);
    this.playerGhostBar.setSize(this.healthBarWidth, 18);
    this.playerBar.setSize(this.healthBarWidth, 18);
    this.playerEnergyBar.setSize(this.healthBarWidth, 10);
    this.playerEnergyGhostBar.setSize(this.healthBarWidth, 10);
    this.updateHealthBars(true);
  }

  resizeArena(gameSize) {
    const width = Number(gameSize?.width || this.scale.width);
    const height = Number(gameSize?.height || this.scale.height);
    if (!width || !height || !this.player) return;
    const oldWidth = this.arenaWidth;
    const oldHeight = this.arenaHeight;
    const playerX = this.player.x / oldWidth * width;
    const playerY = height * (this.player.y / oldHeight);
    this.arenaWidth = width;
    this.arenaHeight = height;
    this.floorY = Math.round(height * (FLOOR_Y / GAME_HEIGHT));
    this.player.setPosition(playerX, playerY);
    this.opponent.setPosition(width - (oldWidth - this.opponent.x) / oldWidth * width, this.floorY - 72);
    this.opponent.refreshBody();
    this.playerVisual.setPosition(this.player.x, this.player.y - 55);
    this.opponentVisual.setPosition(this.opponent.x, this.floorY - 120);
    this.floor.setPosition(width / 2, this.floorY + (height - this.floorY) / 2);
    this.floor.setDisplaySize(width, Math.max(60, height - this.floorY)).refreshBody();
    this.physics.world.setBounds(0, 0, width, height);
    this.cameras.main.setBounds(0, 0, width, height).centerOn(width / 2, height / 2);
    this.createArena();
    this.positionHud(width, height);
  }

  createChogVisual(x, y, mirrored) {
    return buildChogVisual(this, x, y, mirrored);
  }
}

document.querySelectorAll("[data-practice-hold]").forEach((button) => {
  const direction = button.dataset.practiceHold;
  const setDirection = (pressed) => { practiceTouchInput[direction] = pressed; };
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    button.setPointerCapture?.(event.pointerId);
    setDirection(true);
  });
  for (const eventName of ["pointerup", "pointercancel", "lostpointercapture", "pointerleave"]) {
    button.addEventListener(eventName, () => setDirection(false));
  }
});

document.querySelectorAll("[data-practice-action]").forEach((button) => {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    practiceTouchActions.add(button.dataset.practiceAction);
  });
});

window.addEventListener("blur", () => {
  practiceTouchInput.left = false;
  practiceTouchInput.right = false;
  practiceTouchActions.clear();
});

const config = {
  type: Phaser.AUTO,
  parent: "game",
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: "#111318",
  physics: { default: "arcade", arcade: { gravity: { y: 0 }, debug: false } },
  scale: { mode: Phaser.Scale.RESIZE, width: GAME_WIDTH, height: GAME_HEIGHT },
  scene: [BootScene, ArenaScene],
};

new Phaser.Game(config);
