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
import { applyChogPose, createChogVisual as buildChogVisual, flashChog } from "./game/chogRig.js";
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
const FIGHTER_FOOT_ANCHOR = 120;

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

const practiceTouchInput = { left: false, right: false };
const practiceTouchActions = new Set();

const OPPONENT_METADATA = {
  tokenId: 973, name: "Test Water", Tier: "Common", Base: "Origin", Form: "Chog", Skin: "Blue",
  Body: "Stripes", Eyes: "Happy", Head: "Wizard Hat", Aura: "Aqua Aura", Background: "Aqua",
  Mouth: "Smile", Side: "Right", Naked: "No",
};

const BASE_RIG_POSE = {
  leadArmRotation: -0.82, rearArmRotation: -0.48,
  // Bend at the elbows so the fists sit forward instead of hanging below
  // the shoulders or stretching the arms into a straight line.
  leadArmLowerRotation: -0.75, rearArmLowerRotation: -0.82,
  leadLegRotation: -0.08, rearLegRotation: 0.10,
  leadLegLowerRotation: 0, rearLegLowerRotation: 0,
  torsoRotation: 0, headRotation: 0,
  leadArmX: 3, leadArmY: 0, rearArmX: -2, rearArmY: 0,
  leadLegX: 6, leadLegY: 0, rearLegX: -6, rearLegY: 0,
  torsoX: 0, torsoY: 0, headX: 0, headY: 0,
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
  return Object.fromEntries(Object.keys(BASE_RIG_POSE).map((key) => [
    key,
    Phaser.Math.Linear(from[key] ?? 0, to[key] ?? 0, t),
  ]));
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
    this.lastPlayerPose = { ...BASE_RIG_POSE };
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
    this.playerPanel = null;
    this.opponentPanel = null;
    this.opponentHpText = null;
    this.opponentMetaText = null;
    this.opponentHintText = null;
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
    this.arenaWidth = this.scale.width || GAME_WIDTH;
    this.arenaHeight = this.scale.height || GAME_HEIGHT;
    this.floorY = Math.round(this.arenaHeight * (FLOOR_Y / GAME_HEIGHT));
    this.fighterScale = Phaser.Math.Clamp(Math.min(this.arenaWidth / GAME_WIDTH, this.arenaHeight / GAME_HEIGHT), 0.55, 1);
    this.createArena();
    this.playerBattleDNA = buildBattleDNA(getPracticeMetadata());
    this.opponentBattleDNA = buildBattleDNA(OPPONENT_METADATA);
    this.playerCombatant = createCombatant(this.playerBattleDNA);
    this.opponentCombatant = createCombatant(this.opponentBattleDNA);

    const spawnGap = Math.min(340, Math.max(150, this.arenaWidth * 0.26));
    this.player = this.physics.add.sprite(this.arenaWidth / 2 - spawnGap / 2, this.floorY - 72, "chog-hitbox");
    this.player.setSize(96, 120).setOffset(16, 0).setGravityY(combatData.movement.gravity).setCollideWorldBounds(true);
    this.player.setDragX(1850).setMaxVelocity(combatData.movement.walkSpeed, 900);

    this.opponent = this.physics.add.staticSprite(this.arenaWidth / 2 + spawnGap / 2, this.floorY - 72, "chog-hitbox");
    this.opponent.setVisible(false);
    this.fighterCollider = this.physics.add.collider(this.player, this.opponent);

    this.playerVisual = this.createChogVisual(this.player.x, this.player.body.bottom - FIGHTER_FOOT_ANCHOR, false);
    this.opponentVisual = this.createChogVisual(this.opponent.x, this.floorY - 120, true);
    this.playerVisual.setScale(this.fighterScale, this.fighterScale);
    this.opponentVisual.setScale(-this.fighterScale, this.fighterScale);
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
      basic: Phaser.Input.Keyboard.KeyCodes.F,
      base: Phaser.Input.Keyboard.KeyCodes.ONE,
      special: Phaser.Input.Keyboard.KeyCodes.TWO,
      defense: Phaser.Input.Keyboard.KeyCodes.THREE,
    });

    this.playerCharacter = {
      scene: this,
      combatant: this.playerCombatant,
      input: { left: false, right: false },
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
    const edgeMargin = FIGHTER_FOOT_ANCHOR * this.fighterScale;
    this.physics.world.setBounds(edgeMargin, 0, Math.max(1, this.arenaWidth - edgeMargin * 2), this.arenaHeight);
    this.scale.on("resize", this.resizeArena, this);
  }

  update(time, delta) {
    if (!this.player) return;
    const dt = delta / 1000;
    updateCombatant(this.playerCombatant, delta);
    updateCombatant(this.opponentCombatant, delta);
    updateMovement(this.playerCombatant, dt);
    this.captureInput();
    this.applyMovement();
    this.playerCharacter.stateMachine.update(delta);
    this.processBufferedInput();
    this.updateIncomingAttack(delta);
    this.updateVisuals(time, delta);
    this.updateHealthBars();
    this.updateHud();
  }

  captureInput() {
    const left = this.cursors.left.isDown || this.keys.left.isDown || practiceTouchInput.left;
    const right = this.cursors.right.isDown || this.keys.right.isDown || practiceTouchInput.right;
    this.playerCharacter.input.left = left;
    this.playerCharacter.input.right = right;

    if (Phaser.Input.Keyboard.JustDown(this.keys.basic) || practiceTouchActions.delete("basic")) this.inputBuffer.push("basic");
    if (Phaser.Input.Keyboard.JustDown(this.keys.base) || practiceTouchActions.delete("base")) this.inputBuffer.push("base");
    if (Phaser.Input.Keyboard.JustDown(this.keys.special) || practiceTouchActions.delete("special")) this.inputBuffer.push("special");
    if (Phaser.Input.Keyboard.JustDown(this.keys.defense) || practiceTouchActions.delete("defense")) this.inputBuffer.push("defense");
    if (Phaser.Input.Keyboard.JustDown(this.cursors.up) || Phaser.Input.Keyboard.JustDown(this.keys.jump) || Phaser.Input.Keyboard.JustDown(this.keys.jumpW) || practiceTouchActions.delete("jump")) {
      this.inputBuffer.push("jump");
    }
  }

  applyMovement() {
    const state = this.playerCharacter.stateMachine.currentName;
    const canMove = [CHARACTER_STATES.IDLE, CHARACTER_STATES.WALK, CHARACTER_STATES.JUMP].includes(state);
    if (!canMove) {
      this.player.setAccelerationX(0);
      if (state !== CHARACTER_STATES.HITSTUN) this.player.setVelocityX(0);
      return;
    }

    const acceleration = combatData.movement.walkSpeed * 12;
    if (this.playerCharacter.input.left) {
      this.playerFacing = -1;
      this.player.setAccelerationX(-acceleration);
      engineMove(this.playerCombatant, "left");
    } else if (this.playerCharacter.input.right) {
      this.playerFacing = 1;
      this.player.setAccelerationX(acceleration);
      engineMove(this.playerCombatant, "right");
    } else if (state !== CHARACTER_STATES.JUMP) {
      this.player.setAccelerationX(0);
      engineMove(this.playerCombatant, "idle");
    } else {
      this.player.setAccelerationX(0);
    }
  }

  processBufferedInput() {
    const state = this.playerCharacter.stateMachine.currentName;
    const canAct = state === CHARACTER_STATES.IDLE || state === CHARACTER_STATES.WALK;
    if (!canAct || this.playerCharacter.hitstunRemaining > 0) return;

    const bufferedAttack = this.inputBuffer.consume(["special", "base", "basic"]);
    if (bufferedAttack) {
      this.startAttack(bufferedAttack.action);
      return;
    }

    const defense = this.inputBuffer.consume("defense");
    if (defense) {
      this.useDefense();
      return;
    }

    const jump = this.inputBuffer.consume("jump");
    const grounded = this.player.body.blocked.down || this.player.body.touching.down;
    if (jump && grounded) this.playerCharacter.stateMachine.change(CHARACTER_STATES.JUMP);
  }

  startAttack(slot) {
    const state = this.playerCharacter.stateMachine.currentName;
    if (![CHARACTER_STATES.IDLE, CHARACTER_STATES.WALK].includes(state)) return;

    if (!canUseOffensiveAction(this.playerCombatant, slot)) {
      const cooldown = getCooldownRemaining(this.playerCombatant, slot);
      if (cooldown > 0) this.showStatus(`${slot.toUpperCase()} RELOADING: ${(cooldown / 1000).toFixed(1)}s`);
      else this.showStatus("ENERGY RECHARGING");
      return;
    }

    if (Math.abs(this.player.x - this.opponent.x) > 310) {
      this.showStatus("OUT OF RANGE");
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
    this.playerCharacter.stateMachine.change(CHARACTER_STATES.ATTACK_STARTUP, {
      attack: {
        slot,
        ability,
        auraFamily,
        moveName,
        facing,
        elapsed: 0,
        hit: false,
        hitbox: null,
        timing: combatData.timing[slot],
        animationFrameDriven: false,
        resourceCommitted: true,
      },
    });
  }

  checkPlayerHit(sequence) {
    if (sequence.hit || !sequence.hitbox || !this.opponentHurtbox.active) return;
    if (!canHitTargetInFront(this.player.x, this.opponent.x, sequence.facing)) return;
    if (!this.physics.overlap(sequence.hitbox, this.opponentHurtbox)) return;
    sequence.hit = true;

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
        const result = resolveIncomingAttack(this.opponentCombatant, this.playerCombatant, attack);
        attack.visual?.destroy();
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

    if ([CHARACTER_STATES.ATTACK_STARTUP, CHARACTER_STATES.ATTACK_ACTIVE, CHARACTER_STATES.ATTACK_RECOVERY].includes(this.playerCharacter.stateMachine.currentName)) return;
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
      this.playerCharacter.stateMachine.change(CHARACTER_STATES.HITSTUN);
    }
    this.cameras.main.shake(counter ? 120 : heavy ? 120 : 70, counter ? 0.006 : heavy ? 0.007 : 0.004);
    this.applyHitstop(counter ? 85 : heavy ? combatData.timing.hitstop.heavy : combatData.timing.hitstop.normal);
    this.showStatus(counter ? `COUNTER! ${damage} DAMAGE` : `HIT: ${damage} DAMAGE`, counter ? 900 : 650, counter ? 300 : 350);
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
    this.updateHurtboxes();
    this.playerVisual.x = this.player.x;
    this.playerVisual.y = this.player.body.bottom - FIGHTER_FOOT_ANCHOR;
    this.opponentVisual.x = this.opponent.x;
    this.opponentVisual.y = this.floorY - 120;
    const grounded = this.player.body.blocked.down || this.player.body.touching.down;
    const state = this.playerCharacter.stateMachine.currentName;
    const moving = grounded && state === CHARACTER_STATES.WALK && (this.playerCharacter.input.left || this.playerCharacter.input.right);
    const walkTarget = moving ? 1 : 0;
    const walkRate = moving ? 13 : 18;
    this.walkBlend = Phaser.Math.Linear(this.walkBlend, walkTarget, 1 - Math.exp(-walkRate * (delta / 1000)));
    if (!ATTACK_STATES.has(state)) {
      const targetX = (grounded ? (moving ? 1.02 : 1) : 1.04) * this.playerFacing * this.fighterScale;
      const targetY = (grounded ? (moving ? 0.98 : 1) : 1.08) * this.fighterScale;
      const blend = 1 - Math.exp(-12 * (delta / 1000));
      this.playerVisual.scaleX = Phaser.Math.Linear(this.playerVisual.scaleX, targetX, blend);
      this.playerVisual.scaleY = Phaser.Math.Linear(this.playerVisual.scaleY, targetY, blend);
    }
    if (!this.wasGrounded && grounded) {
      this.createDust(this.player.x, this.floorY - 3);
      this.playerVisual.rig.landingUntil = time + 150;
      this.playerVisual.rig.landingFromPose = { ...this.lastPlayerPose };
    }
    this.wasGrounded = grounded;

    const playerPose = this.getPlayerRigPose(time, grounded, moving);
    applyChogPose(this.playerVisual.rig, playerPose);
    this.lastPlayerPose = { ...playerPose };
    applyChogPose(this.opponentVisual.rig, this.getOpponentRigPose(time));
  }

  getReadyPose(time, phase, moving = false) {
    const idleWave = Math.sin((time / 1000) * 2.2 + phase);
    if (!moving) {
      return {
        ...BASE_RIG_POSE,
        leadArmRotation: BASE_RIG_POSE.leadArmRotation + idleWave * 0.028,
        rearArmRotation: BASE_RIG_POSE.rearArmRotation - idleWave * 0.022,
        leadLegRotation: BASE_RIG_POSE.leadLegRotation + idleWave * 0.018,
        rearLegRotation: BASE_RIG_POSE.rearLegRotation - idleWave * 0.018,
        torsoRotation: idleWave * 0.015,
        torsoY: -Math.max(0, idleWave) * 2,
        headRotation: idleWave * 0.008,
      };
    }

    const stridePhase = (time / 1000) * 7.2 + phase;
    const stride = Math.sin(stridePhase);
    const leadLift = Math.max(0, stride) ** 2;
    const rearLift = Math.max(0, -stride) ** 2;
    const bodyBob = 0.5 - (Math.cos(2 * stridePhase) * 0.5);
    return {
      ...BASE_RIG_POSE,
      leadArmRotation: BASE_RIG_POSE.leadArmRotation - (stride * 0.11),
      rearArmRotation: BASE_RIG_POSE.rearArmRotation + (stride * 0.11),
      leadLegRotation: BASE_RIG_POSE.leadLegRotation + stride * 0.11,
      rearLegRotation: BASE_RIG_POSE.rearLegRotation - stride * 0.11,
      leadLegX: BASE_RIG_POSE.leadLegX + stride * 6,
      rearLegX: BASE_RIG_POSE.rearLegX - stride * 6,
      leadLegY: -leadLift * 4,
      rearLegY: -rearLift * 4,
      torsoRotation: -stride * 0.025,
      headRotation: stride * 0.012,
      torsoY: -bodyBob * 2,
    };
  }

  getPlayerReadyPose(time, phase) {
    return blendRigPose(BASE_RIG_POSE, this.getReadyPose(time, phase, true), this.walkBlend);
  }

  getAttackPose(attack, state, time, phase, readyPose = BASE_RIG_POSE) {
    const windUp = { ...readyPose };
    const action = { ...readyPose };
    const abilityType = attack.ability?.type ?? attack.motion ?? "burst";
    const power = attack.slot === "special" ? 1 : attack.slot === "base" ? 0.72 : 0.42;

    windUp.leadArmRotation -= 0.12 + power * 0.12;
    windUp.rearArmRotation += 0.10 + power * 0.06;
    windUp.torsoRotation = -0.035 * power;
    windUp.torsoY -= 2 + power * 2;
    windUp.leadLegRotation -= 0.02 * power;
    windUp.rearLegRotation += 0.025 * power;

    if (attack.slot === "basic") {
      action.leadArmRotation -= 0.65;
      action.leadArmX += 12;
      action.rearArmRotation += 0.08;
      action.torsoRotation = -0.09;
      action.torsoX += 4;
      action.leadLegRotation = -0.05;
      action.rearLegRotation = 0.07;
    } else if (abilityType === "control" || abilityType === "disruption") {
      action.leadArmRotation -= 0.45 * power;
      action.rearArmRotation += 0.52 * power;
      action.leadArmX += 5 * power;
      action.rearArmX -= 2 * power;
      action.torsoRotation = -0.08 * power;
      action.torsoY -= 6 * power;
      action.leadLegRotation = -0.08 * power;
      action.rearLegRotation = 0.10 * power;
      action.leadLegX += 4 * power;
      action.rearLegX -= 2 * power;
    } else if (abilityType === "mobility") {
      action.leadArmRotation -= 0.70 * power;
      action.rearArmRotation += 0.45 * power;
      action.torsoRotation = -0.18 * power;
      action.torsoX += 10 * power;
      action.leadLegRotation = -0.20 * power;
      action.rearLegRotation = 0.14 * power;
      action.leadLegX += 8 * power;
      action.rearLegX -= 5 * power;
    } else if (abilityType === "defense") {
      action.leadArmRotation -= 0.25 * power;
      action.rearArmRotation += 0.25 * power;
      action.torsoY -= 3 * power;
    } else {
      action.leadArmRotation -= 0.38 * power;
      action.rearArmRotation += 0.46 * power;
      action.leadArmX += 7 * power;
      action.rearArmX -= 7 * power;
      action.torsoRotation = -0.13 * power;
      action.torsoX += 3 * power;
      action.leadLegRotation = -0.13 * power;
      action.rearLegRotation = 0.15 * power;
      action.leadLegX += 8 * power;
      action.rearLegX -= 8 * power;
    }

    action.headRotation = -0.015;
    action.torsoY -= 1 * power;

    const timings = attack.timing ?? {};
    if (state === CHARACTER_STATES.ATTACK_STARTUP) {
      return blendRigPose(readyPose, windUp, easeInOutCubic(attack.elapsed / Math.max(1, timings.startup ?? 150)));
    }
    if (state === CHARACTER_STATES.ATTACK_ACTIVE) {
      const activeWindow = Math.min(timings.active ?? 100, 95);
      return blendRigPose(windUp, action, easeInOutCubic(attack.elapsed / Math.max(1, activeWindow)));
    }
    if (state === CHARACTER_STATES.ATTACK_RECOVERY) {
      return blendRigPose(action, readyPose, easeInOutCubic(attack.elapsed / Math.max(1, timings.recovery ?? 240)));
    }
    return readyPose;
  }

  getHitPose(time, phase, intensity, readyPose = BASE_RIG_POSE) {
    return {
      ...readyPose,
      leadArmRotation: readyPose.leadArmRotation - 0.12 * intensity,
      rearArmRotation: readyPose.rearArmRotation - 0.16 * intensity,
      leadLegRotation: -0.06 * intensity,
      rearLegRotation: 0.08 * intensity,
      torsoRotation: 0.11 * intensity,
      headRotation: -0.045 * intensity,
      torsoX: -2 * intensity,
      torsoY: 1.2 * intensity,
    };
  }

  getPlayerRigPose(time, grounded, moving) {
    const rig = this.playerVisual.rig;
    const state = this.playerCharacter.stateMachine.currentName;
    const attack = this.playerCharacter.attack;
    const readyPose = this.getPlayerReadyPose(time, rig.phase);
    if (attack && ATTACK_STATES.has(state)) return this.getAttackPose(attack, state, time, rig.phase, readyPose);
    if (state === CHARACTER_STATES.HITSTUN) {
      const duration = Math.max(1, combatData.timing.hitstunMs);
      const age = duration - this.playerCharacter.hitstunRemaining;
      return this.getHitPose(time, rig.phase, impactEnvelope(age, duration), readyPose);
    }
    if (state === CHARACTER_STATES.JUMP || !grounded) {
      return {
        ...readyPose,
        leadArmRotation: readyPose.leadArmRotation - 0.18,
        rearArmRotation: readyPose.rearArmRotation + 0.16,
        leadLegRotation: -0.18,
        rearLegRotation: 0.16,
        leadLegY: -3,
        rearLegY: -2,
        torsoRotation: -0.04,
      };
    }
    if (rig.landingUntil > time) {
      const landing = {
        ...readyPose,
        leadLegRotation: -0.07,
        rearLegRotation: 0.08,
        leadLegY: 1,
        rearLegY: 1,
        torsoRotation: -0.04,
        torsoY: 2,
        leadArmRotation: readyPose.leadArmRotation + 0.035,
        rearArmRotation: readyPose.rearArmRotation - 0.03,
      };
      const progress = 1 - ((rig.landingUntil - time) / 150);
      if (progress < 0.3) {
        return blendRigPose(rig.landingFromPose ?? readyPose, landing, easeInOutCubic(progress / 0.3));
      }
      return blendRigPose(landing, readyPose, easeInOutCubic((progress - 0.3) / 0.7));
    }
    return readyPose;
  }

  getOpponentRigPose(time) {
    const rig = this.opponentVisual.rig;
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
      if (elapsed < attack.timing.startup) return this.getAttackPose(attack, CHARACTER_STATES.ATTACK_STARTUP, time, rig.phase);
      if (elapsed < attack.timing.startup + attack.timing.active) {
        attack.elapsed = elapsed - attack.timing.startup;
        return this.getAttackPose(attack, CHARACTER_STATES.ATTACK_ACTIVE, time, rig.phase);
      }
      attack.elapsed = elapsed - attack.timing.startup - attack.timing.active;
      return this.getAttackPose(attack, CHARACTER_STATES.ATTACK_RECOVERY, time, rig.phase);
    }
    if (rig.hitReactUntil > time) {
      const duration = rig.hitReactDuration ?? 180;
      const age = duration - (rig.hitReactUntil - time);
      return this.getHitPose(time, rig.phase, impactEnvelope(age, duration));
    }
    return this.getReadyPose(time, rig.phase, false);
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
    const textStyle = { fontFamily: "system-ui, sans-serif", color: "#f4f1ff" };
    const identity = this.playerBattleDNA.identity;
    const stats = this.playerBattleDNA.stats;
    const playerName = identity.name || "Practice Chog";
    const token = identity.tokenId ? ` · #${identity.tokenId}` : "";
    this.playerPanel = this.add.rectangle(0, 0, 320, 154, 0x10131e, 0.9).setOrigin(0, 0).setScrollFactor(0).setDepth(8).setStrokeStyle(1, 0x9172ff, 0.62);
    this.opponentPanel = this.add.rectangle(0, 0, 320, 154, 0x10131e, 0.9).setOrigin(0, 0).setScrollFactor(0).setDepth(8).setStrokeStyle(1, 0xf06076, 0.58);
    this.playerAccent = this.add.rectangle(0, 0, 3, 23, 0x9b7aff, 1).setOrigin(0, 0).setScrollFactor(0).setDepth(12);
    this.playerNameText = this.add.text(0, 0, `${playerName.slice(0, 14)}${token}`, { ...textStyle, fontSize: "16px", fontStyle: "800" }).setScrollFactor(0).setDepth(12);
    this.playerMetaText = this.add.text(0, 0, `${identity.tier}  ·  ATK ${stats.attack}  ·  DEF ${stats.defense}  ·  SPD ${stats.speed}`, { ...textStyle, color: "#c2bad2", fontSize: "11px", fontStyle: "600" }).setScrollFactor(0).setDepth(12);
    const baseName = this.playerBattleDNA.abilitySet.base?.name ?? "Base Ability";
    const specialName = this.playerBattleDNA.abilitySet.special?.name ?? "Signature Ability";
    this.playerAbilityText = this.add.text(0, 0, `1 ${baseName}  ·  2 ${specialName}`, { ...textStyle, color: "#ddd5ed", fontSize: "11px", fontStyle: "700" }).setScrollFactor(0).setDepth(12);
    this.playerHpText = this.add.text(0, 0, "", { ...textStyle, fontSize: "11px", fontStyle: "800" }).setScrollFactor(0).setDepth(12);
    this.playerEnergyText = this.add.text(0, 0, "", { ...textStyle, color: "#d6d0e4", fontSize: "10px", fontStyle: "700" }).setScrollFactor(0).setDepth(12);
    this.playerCooldownText = this.add.text(0, 0, "", { ...textStyle, color: "#c2bad2", fontSize: "10px", fontStyle: "700" }).setScrollFactor(0).setDepth(12);
    this.statusText = this.add.text(this.arenaWidth / 2, this.arenaHeight - 34, "", { ...textStyle, fontSize: "16px", fontStyle: "800", align: "center", backgroundColor: "#11131ddd", padding: { x: 14, y: 8 } }).setOrigin(0.5).setScrollFactor(0).setDepth(30);
    this.playerGhostBar = this.add.rectangle(0, 0, 300, 12, 0xffffff, 0.18).setOrigin(0, 0.5).setScrollFactor(0).setDepth(10);
    this.playerBar = this.add.rectangle(0, 0, 300, 12, 0x69e08b, 1).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11);
    this.playerEnergyGhostBar = this.add.rectangle(0, 0, 300, 7, 0xffffff, 0.14).setOrigin(0, 0.5).setScrollFactor(0).setDepth(10);
    this.playerEnergyBar = this.add.rectangle(0, 0, 300, 7, 0x9b7aff, 1).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11);
    this.opponentGhostBar = this.add.rectangle(0, 0, 300, 12, 0xffffff, 0.18).setOrigin(0, 0.5).setScrollFactor(0).setDepth(10);
    this.opponentBar = this.add.rectangle(0, 0, 300, 12, 0xf06076, 1).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11);
    this.opponentLabel = this.add.text(0, 0, "PRACTICE BOT", { ...textStyle, fontSize: "15px", fontStyle: "800" }).setScrollFactor(0).setDepth(12);
    this.opponentMetaText = this.add.text(0, 0, "", { ...textStyle, color: "#c2bad2", fontSize: "11px", fontStyle: "700" }).setScrollFactor(0).setDepth(12);
    this.opponentHpText = this.add.text(0, 0, "", { ...textStyle, fontSize: "11px", fontStyle: "800" }).setScrollFactor(0).setDepth(12);
    this.opponentHintText = this.add.text(0, 0, "WATCH TELEGRAPHS  ·  PARRY / EVADE", { ...textStyle, color: "#c2bad2", fontSize: "10px", fontStyle: "700" }).setScrollFactor(0).setDepth(12);
    this.opponentMetaText.setText(`${this.opponentBattleDNA.identity.tier}  ·  ATK ${this.opponentBattleDNA.stats.attack}  ·  DEF ${this.opponentBattleDNA.stats.defense}`);
    this.positionHud(this.arenaWidth, this.arenaHeight);
  }

  updateHud() {
    const hp = Math.max(0, Math.round(this.playerCombatant.hp));
    const energy = Math.round(this.playerCombatant.energy);
    const energyRatio = Phaser.Math.Clamp(this.playerCombatant.energy / this.playerCombatant.maxEnergy, 0, 1);
    this.playerHpText.setText(`VITALITY  ${hp} / ${this.playerCombatant.maxHp}`);
    this.playerEnergyBar.width = this.healthBarWidth * energyRatio;
    const compact = this.arenaWidth < 560;
    this.playerEnergyText.setText(compact ? `ENERGY ${energy}%` : `ENERGY ${energy}%  •  BASIC 5%  ·  BASE 10%  ·  SPECIAL 35%`);

    const basic = getCooldownRemaining(this.playerCombatant, "basic");
    const base = getCooldownRemaining(this.playerCombatant, "base");
    const special = getCooldownRemaining(this.playerCombatant, "special");
    const cooldownLabel = (name, value) => value > 0 ? `${name} ${(value / 1000).toFixed(1)}s` : `${name} READY`;
    this.playerCooldownText.setText(compact
      ? `F ${basic > 0 ? `${(basic / 1000).toFixed(0)}s` : "✓"}  1 ${base > 0 ? `${(base / 1000).toFixed(0)}s` : "✓"}  2 ${special > 0 ? `${(special / 1000).toFixed(0)}s` : "✓"}`
      : `${cooldownLabel("F", basic)}  •  ${cooldownLabel("1", base)}  •  ${cooldownLabel("2", special)}`);
    this.opponentHpText.setText(`RIVAL HP  ${Math.max(0, Math.round(this.opponentCombatant.hp))} / ${this.opponentCombatant.maxHp}`);
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

    // Dark tournament lighting keeps attention on the supplied layered Chog art.
    bg.fillGradientStyle(0x171223, 0x171223, 0x39274e, 0x171821, 1);
    bg.fillRect(0, 0, width, height);
    bg.fillStyle(0x9b7aff, 0.1);
    bg.fillEllipse(width * 0.5, floorY * 0.42, width * 0.78, height * 0.68);
    bg.fillStyle(0x0a0b12, 0.86);
    bg.fillRect(0, floorY * 0.54, width, floorY * 0.4);

    // Distant audience silhouettes add scale without competing with fighters.
    const crowdTop = floorY * 0.57;
    bg.fillStyle(0x080910, 0.58);
    for (let index = 0; index < 28; index += 1) {
      const x = (index / 27) * width;
      const bob = (index % 4) * 3;
      bg.fillCircle(x, crowdTop + 13 + bob, 5 + (index % 3));
      bg.fillRoundedRect(x - 7, crowdTop + 20 + bob, 14, 24, 5);
    }

    for (const [x, tint] of [[width * 0.22, 0x9b7aff], [width * 0.78, 0xffc45f]]) {
      bg.fillStyle(tint, 0.025);
      bg.fillTriangle(x - 12, 0, x + 12, 0, x + width * 0.16, floorY * 0.78);
      bg.fillStyle(0xffffff, 0.8);
      bg.fillRoundedRect(x - 13, height * 0.035, 26, 5, 3);
    }

    bg.fillStyle(0x292530, 1);
    bg.fillRect(0, floorY, width, height - floorY);
    bg.fillStyle(0x17161f, 1);
    bg.fillRect(0, floorY + 14, width, height - floorY - 14);
    bg.fillStyle(0x9b7aff, 0.9);
    bg.fillRect(0, floorY, width, 4);
    bg.fillStyle(0xffc45f, 0.9);
    bg.fillRect(0, floorY + 4, width, 2);
    bg.lineStyle(2, 0xc9b5f4, 0.15);
    bg.strokeRect(width * 0.12, floorY + 29, width * 0.76, Math.max(12, height - floorY - 54));
    bg.lineStyle(1, 0xc9b5f4, 0.12);
    bg.lineBetween(width / 2, floorY + 29, width / 2, height);
    bg.fillStyle(0xffc45f, 0.55);
    bg.fillCircle(width / 2, floorY + 30, 4);
    this.arenaBackground = bg;

    const arenaGlow = this.arenaGlow ?? this.add.graphics();
    arenaGlow.clear();
    arenaGlow.fillStyle(0x9b7aff, 0.09);
    arenaGlow.fillEllipse(width / 2, floorY - 3, Math.min(1050, width * 0.85), height * 0.25);
    this.arenaGlow = arenaGlow;
    if (!this.arenaLabel) {
      this.arenaLabel = this.add.text(0, 0, "TRAINING ARENA", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        fontStyle: "700",
        color: "#e7defa",
      }).setOrigin(0.5);
    }
    this.arenaLabel.setPosition(width / 2, this.floorY * 0.42).setVisible(width > 760 && height > 540);
  }

  positionHud(width, height) {
    if (!this.statusText) return;
    this.healthBarWidth = Math.min(300, Math.max(88, (width - 112) / 2));
    const margin = Math.max(16, Math.min(32, width * 0.025));
    const panelWidth = this.healthBarWidth + 32;
    const panelTop = 58;
    const left = margin + 16;
    const right = width - margin - panelWidth + 16;
    const compact = width < 560;
    const touchLayout = window.matchMedia("(pointer: coarse), (max-width: 760px)").matches;
    this.playerPanel.setPosition(margin, panelTop).setSize(panelWidth, 154);
    this.opponentPanel.setPosition(width - margin - panelWidth, panelTop).setSize(panelWidth, 154);
    this.playerAccent.setPosition(left, panelTop + 10);
    this.playerNameText.setPosition(left + 12, panelTop + 8).setFontSize(compact ? "12px" : "16px");
    const identity = this.playerBattleDNA.identity;
    const stats = this.playerBattleDNA.stats;
    this.playerMetaText.setPosition(left + 12, panelTop + 31).setFontSize(compact ? "8px" : "10px")
      .setText(compact ? `${identity.tier} · ATK ${stats.attack}` : `${identity.tier} · ATK ${stats.attack} · DEF ${stats.defense} · SPD ${stats.speed}`);
    this.playerAbilityText.setText(compact ? "1 BASE · 2 SPECIAL" : `1 ${this.playerBattleDNA.abilitySet.base?.name ?? "Base"} · 2 ${this.playerBattleDNA.abilitySet.special?.name ?? "Special"}`);
    this.opponentHintText.setText(compact ? "PARRY · EVADE" : "WATCH TELEGRAPHS · PARRY / EVADE");
    this.playerHpText.setPosition(left, panelTop + 52).setFontSize(compact ? "9px" : "11px");
    this.playerGhostBar.setPosition(left, panelTop + 71).setSize(this.healthBarWidth, 12);
    this.playerBar.setPosition(left, panelTop + 71).setSize(this.healthBarWidth, 12);
    this.playerEnergyText.setPosition(left, panelTop + 88).setFontSize(compact ? "8px" : "10px");
    this.playerEnergyGhostBar.setPosition(left, panelTop + 105).setSize(this.healthBarWidth, 7);
    this.playerEnergyBar.setPosition(left, panelTop + 105).setSize(this.healthBarWidth, 7);
    this.playerAbilityText.setPosition(left, panelTop + 114).setFontSize(compact ? "8px" : "10px");
    this.playerCooldownText.setPosition(left, panelTop + 134).setFontSize(compact ? "8px" : "9px");
    this.opponentLabel.setPosition(right, panelTop + 10).setFontSize(compact ? "11px" : "15px");
    this.opponentMetaText.setPosition(right, panelTop + 34).setFontSize(compact ? "8px" : "10px");
    this.opponentHpText.setPosition(right, panelTop + 52).setFontSize(compact ? "9px" : "11px");
    this.opponentGhostBar.setPosition(right, panelTop + 71).setSize(this.healthBarWidth, 12);
    this.opponentBar.setPosition(right, panelTop + 71).setSize(this.healthBarWidth, 12);
    this.opponentHintText.setPosition(right, panelTop + 98).setFontSize(compact ? "7px" : "9px");
    this.statusText.setPosition(width / 2, height - (touchLayout ? (width < 380 ? 148 : 126) : 34));
    this.statusText.setFontSize(compact ? "12px" : "16px");
    this.statusText.setFixedSize(Math.max(140, width - 40), 34);
    this.updateHealthBars(true);
  }

  resizeArena(gameSize) {
    const width = Number(gameSize?.width || this.scale.width);
    const height = Number(gameSize?.height || this.scale.height);
    if (!width || !height || !this.player) return;
    const oldWidth = this.arenaWidth;
    const playerX = this.player.x / oldWidth * width;
    const nextFloorY = Math.round(height * (FLOOR_Y / GAME_HEIGHT));
    const playerY = this.player.y + (nextFloorY - this.floorY);
    this.arenaWidth = width;
    this.arenaHeight = height;
    this.floorY = nextFloorY;
    this.fighterScale = Phaser.Math.Clamp(Math.min(width / GAME_WIDTH, height / GAME_HEIGHT), 0.55, 1);
    this.player.setPosition(playerX, playerY);
    this.opponent.setPosition(width - (oldWidth - this.opponent.x) / oldWidth * width, this.floorY - 72);
    this.opponent.refreshBody();
    this.playerVisual.setPosition(this.player.x, this.player.body.bottom - FIGHTER_FOOT_ANCHOR).setScale(this.playerFacing * this.fighterScale, this.fighterScale);
    this.opponentVisual.setPosition(this.opponent.x, this.floorY - FIGHTER_FOOT_ANCHOR).setScale(-this.fighterScale, this.fighterScale);
    this.floor.setPosition(width / 2, this.floorY + (height - this.floorY) / 2);
    this.floor.setDisplaySize(width, Math.max(60, height - this.floorY)).refreshBody();
    const edgeMargin = FIGHTER_FOOT_ANCHOR * this.fighterScale;
    this.physics.world.setBounds(edgeMargin, 0, Math.max(1, width - edgeMargin * 2), height);
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
