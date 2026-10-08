import Phaser from "phaser";
import "./style.css";
import { BootScene } from "./bootScene.js";
import { buildBattleDNA } from "./game/battleDNA.js";
import combatData from "./game/data/combat.json";
import { CHARACTER_STATES, createCharacterStates } from "./game/characterStates.js";
import { StateMachine } from "./game/stateMachine.js";
import { InputBuffer } from "./game/inputBuffer.js";
import {
  canUseOffensiveAction,
  createCombatant,
  getCooldownRemaining,
  jump as engineJump,
  move as engineMove,
  resolveBaseAbility,
  resolveBasicAttack,
  resolveDefenseAbility,
  resolveIncomingAttack,
  resolveSpecialAbility,
  updateCombatant,
  updateMovement,
} from "./game/combatEngine.js";

const GAME_WIDTH = 1280;
const GAME_HEIGHT = 720;
const WORLD_WIDTH = 1600;
const FLOOR_Y = 610;

const PLAYER_METADATA = {
  tokenId: 561, name: "Blaze", Tier: "Legendary", Base: "1:1", Form: "Chog", Skin: "Red",
  Body: "Tuxedo", Eyes: "Angry", Head: "Crown", Aura: "Burning Aura", Background: "Blood Red",
  Mouth: "Smile", Side: "Left", Naked: "No",
};

const OPPONENT_METADATA = {
  tokenId: 973, name: "Test Water", Tier: "Common", Base: "Origin", Form: "Chog", Skin: "Blue",
  Body: "Stripes", Eyes: "Happy", Head: "Wizard Hat", Aura: "Aqua Aura", Background: "Aqua",
  Mouth: "Smile", Side: "Right", Naked: "No",
};

class ArenaScene extends Phaser.Scene {
  constructor() {
    super("ArenaScene");
    this.FLOOR_Y = FLOOR_Y;
    this.player = null;
    this.opponent = null;
    this.playerVisual = null;
    this.opponentVisual = null;
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
    this.wasGrounded = true;
    this.ghostHp = { player: 100, opponent: 100 };
    this.ghostPending = { player: false, opponent: false };
  }

  create() {
    this.createArena();
    this.playerCombatant = createCombatant(buildBattleDNA(PLAYER_METADATA));
    this.opponentCombatant = createCombatant(buildBattleDNA(OPPONENT_METADATA));

    this.player = this.physics.add.sprite(360, FLOOR_Y - 72, "chog-hitbox");
    this.player.setSize(96, 120).setOffset(16, 0).setGravityY(combatData.movement.gravity).setCollideWorldBounds(true);
    this.player.setDragX(900).setMaxVelocity(360, 900);

    this.opponent = this.physics.add.staticSprite(1080, FLOOR_Y - 72, "chog-hitbox");
    this.opponent.setVisible(false);

    this.playerVisual = this.createChogVisual(360, FLOOR_Y - 120, false);
    this.opponentVisual = this.createChogVisual(1080, FLOOR_Y - 120, true);
    this.playerHurtbox = this.createHurtbox(this.player);
    this.opponentHurtbox = this.createHurtbox(this.opponent);

    const floor = this.physics.add.staticImage(WORLD_WIDTH / 2, FLOOR_Y + 30, "floor");
    floor.setDisplaySize(WORLD_WIDTH, 60).refreshBody();
    this.physics.add.collider(this.player, floor);

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
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, GAME_HEIGHT);
    this.cameras.main.centerOn(GAME_WIDTH / 2, GAME_HEIGHT / 2);
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
    this.updateVisuals(time);
    this.updateHealthBars();
    this.updateHud();
  }

  captureInput() {
    const left = this.cursors.left.isDown || this.keys.left.isDown;
    const right = this.cursors.right.isDown || this.keys.right.isDown;
    this.playerCharacter.input.left = left;
    this.playerCharacter.input.right = right;

    if (Phaser.Input.Keyboard.JustDown(this.keys.basic)) this.inputBuffer.push("basic");
    if (Phaser.Input.Keyboard.JustDown(this.keys.base)) this.inputBuffer.push("base");
    if (Phaser.Input.Keyboard.JustDown(this.keys.special)) this.inputBuffer.push("special");
    if (Phaser.Input.Keyboard.JustDown(this.keys.defense)) this.inputBuffer.push("defense");
    if (Phaser.Input.Keyboard.JustDown(this.cursors.up) || Phaser.Input.Keyboard.JustDown(this.keys.jump) || Phaser.Input.Keyboard.JustDown(this.keys.jumpW)) {
      this.inputBuffer.push("jump");
    }
  }

  applyMovement() {
    const state = this.playerCharacter.stateMachine.currentName;
    const canMove = [CHARACTER_STATES.IDLE, CHARACTER_STATES.WALK, CHARACTER_STATES.JUMP].includes(state);
    if (!canMove) {
      if (state !== CHARACTER_STATES.HITSTUN) this.player.setVelocityX(0);
      return;
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
      if (cooldown > 0) this.showStatus(`${slot.toUpperCase()} RELOADING — ${(cooldown / 1000).toFixed(1)}s`);
      else this.showStatus("ENERGY RECHARGING");
      return;
    }

    if (Math.abs(this.player.x - this.opponent.x) > 310) {
      this.showStatus("OUT OF RANGE");
      return;
    }

    const facing = this.player.x <= this.opponent.x ? 1 : -1;
    this.playerCharacter.stateMachine.change(CHARACTER_STATES.ATTACK_STARTUP, {
      attack: {
        slot,
        facing,
        elapsed: 0,
        hit: false,
        hitbox: null,
        timing: combatData.timing[slot],
        animationFrameDriven: false,
      },
    });
  }

  checkPlayerHit(sequence) {
    if (sequence.hit || !sequence.hitbox || !this.opponentHurtbox.active) return;
    if (!this.physics.overlap(sequence.hitbox, this.opponentHurtbox)) return;
    sequence.hit = true;

    let result;
    try {
      if (sequence.slot === "basic") result = resolveBasicAttack(this.playerCombatant, this.opponentCombatant);
      else if (sequence.slot === "base") result = resolveBaseAbility(this.playerCombatant, this.opponentCombatant);
      else result = resolveSpecialAbility(this.playerCombatant, this.opponentCombatant);
    } catch (error) {
      this.showStatus(error.message);
      return;
    }

    this.onHit({
      attacker: this.player,
      defender: this.opponent,
      defenderVisual: this.opponentVisual,
      result,
      heavy: sequence.slot === "special",
    });
  }

  useDefense() {
    if (this.playerCharacter.stateMachine.currentName !== CHARACTER_STATES.IDLE && this.playerCharacter.stateMachine.currentName !== CHARACTER_STATES.WALK) return;
    try {
      const result = resolveDefenseAbility(this.playerCombatant);
      this.showStatus(`DEFENSE — ${result.blockPercent}% BLOCK`);
      this.flashDefense(this.playerVisual);
    } catch (error) {
      this.showStatus(error.message);
    }
  }

  updateIncomingAttack(delta) {
    if (this.incomingAttack) {
      this.incomingAttack.timeLeft -= delta;
      if (this.incomingAttack.timeLeft <= 0) {
        const attack = this.incomingAttack;
        this.incomingAttack = null;
        const result = resolveIncomingAttack(this.opponentCombatant, this.playerCombatant, attack);
        attack.visual.destroy();
        if (result.evaded) {
          this.showStatus("EVADED — PERFECT JUMP");
          this.createDust(this.player.x, this.player.y + 55);
        } else {
          this.onHit({
            attacker: this.opponent,
            defender: this.player,
            defenderVisual: this.playerVisual,
            result,
            heavy: false,
          });
        }
      }
      return;
    }

    if ([CHARACTER_STATES.ATTACK_STARTUP, CHARACTER_STATES.ATTACK_ACTIVE, CHARACTER_STATES.ATTACK_RECOVERY].includes(this.playerCharacter.stateMachine.currentName)) return;
    this.nextOpponentAttack -= delta;
    if (this.nextOpponentAttack <= 0) {
      this.nextOpponentAttack = 2200;
      const facing = this.opponent.x < this.player.x ? 1 : -1;
      const visual = this.add.rectangle(this.opponent.x + facing * 90, FLOOR_Y - 55, 180, 10, 0x7b61ff, 0.9).setDepth(5);
      this.incomingAttack = {
        timeLeft: 550,
        visual,
        action: "opponent-basic",
        damageClass: "basic",
        type: "burst",
        canBeEvaded: true,
      };
      this.showStatus("INCOMING — JUMP TO EVADE");
    }
  }

  onHit({ attacker, defender, defenderVisual, result, heavy }) {
    const damage = Math.round(result.damage ?? 0);
    if (damage <= 0) return;
    this.showDamageNumber(defender.x, defender.y - 75, damage);
    this.createHitSparks(defender.x, FLOOR_Y - 75);
    this.flashHit(defenderVisual);
    const direction = defender.x >= attacker.x ? 1 : -1;
    if (defender === this.player) {
      this.player.setVelocityX(direction * 180);
      this.playerCharacter.stateMachine.change(CHARACTER_STATES.HITSTUN);
    }
    this.cameras.main.shake(heavy ? 120 : 70, heavy ? 0.007 : 0.004);
    this.applyHitstop(heavy ? combatData.timing.hitstop.heavy : combatData.timing.hitstop.normal);
    this.showStatus(`HIT — ${damage} DAMAGE`);
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

  flashHit(visual) {
    const flash = visual.list.find((item) => item.getData?.("flash"));
    if (!flash) return;
    flash.setAlpha(0.95);
    this.tweens.add({ targets: flash, alpha: 0, duration: 90, ease: "Linear" });
  }

  flashDefense(visual) {
    const flash = visual.list.find((item) => item.getData?.("flash"));
    if (!flash) return;
    flash.setAlpha(0.35);
    this.tweens.add({ targets: flash, alpha: 0, duration: combatData.timing.defense.recovery });
  }

  showDamageNumber(x, y, damage) {
    const text = this.add.text(x, y, `-${damage}`, {
      fontFamily: "system-ui, sans-serif", fontSize: "28px", fontStyle: "900",
      color: "#ff3366", stroke: "#111318", strokeThickness: 5,
    }).setOrigin(0.5).setDepth(20);
    this.tweens.add({ targets: text, y: y - 75, alpha: 0, scale: 1.35, duration: 600, ease: "Power2", onComplete: () => text.destroy() });
  }

  createHitSparks(x, y) {
    for (let i = 0; i < 7; i += 1) {
      const spark = this.add.circle(x, y, Phaser.Math.Between(3, 6), 0xffffff, 1).setDepth(18);
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const distance = Phaser.Math.Between(35, 75);
      this.tweens.add({
        targets: spark,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
        alpha: 0,
        scale: 0.2,
        duration: 240,
        ease: "Quad.easeOut",
        onComplete: () => spark.destroy(),
      });
    }
  }

  createDust(x, y) {
    for (let i = 0; i < 5; i += 1) {
      const dust = this.add.circle(x + Phaser.Math.Between(-25, 25), y, Phaser.Math.Between(5, 9), 0xffffff, 0.35).setDepth(4);
      this.tweens.add({ x: dust.x + Phaser.Math.Between(-30, 30), y: y - Phaser.Math.Between(8, 22), alpha: 0, scale: 1.4, duration: 280, onComplete: () => dust.destroy(), targets: dust });
    }
  }

  flashAttackTelegraph(facing) {
    const slash = this.add.rectangle(this.player.x + facing * 95, this.player.y - 65, 110, 9, 0xffffff, 0.9).setDepth(15);
    slash.setAngle(facing * 12);
    this.tweens.add({ targets: slash, scaleX: 1.25, alpha: 0, duration: 120, onComplete: () => slash.destroy() });
  }

  updateVisuals(time) {
    this.updateHurtboxes();
    this.playerVisual.x = this.player.x;
    this.playerVisual.y = this.player.y - 55;
    this.opponentVisual.x = this.opponent.x;
    this.opponentVisual.y = FLOOR_Y - 120 + Math.sin(time / 500) * 3;
    const grounded = this.player.body.blocked.down || this.player.body.touching.down;
    const moving = Math.abs(this.player.body.velocity.x) > 5;
    const facing = this.player.body.velocity.x < -5 ? -1 : 1;
    if (![CHARACTER_STATES.ATTACK_STARTUP, CHARACTER_STATES.ATTACK_ACTIVE, CHARACTER_STATES.ATTACK_RECOVERY].includes(this.playerCharacter.stateMachine.currentName)) {
      const targetX = (grounded ? (moving ? 1.02 : 1) : 1.04) * facing;
      const targetY = grounded ? (moving ? 0.98 : 1) : 1.08;
      this.playerVisual.scaleX = Phaser.Math.Linear(this.playerVisual.scaleX, targetX, 0.16);
      this.playerVisual.scaleY = Phaser.Math.Linear(this.playerVisual.scaleY, targetY, 0.16);
    }
    if (!this.wasGrounded && grounded) this.createDust(this.player.x, FLOOR_Y - 3);
    this.wasGrounded = grounded;
  }

  updateHealthBars(force = false) {
    const values = [
      { key: "player", hp: this.playerCombatant.hp, max: this.playerCombatant.maxHp, fg: this.playerBar, ghost: this.playerGhostBar },
      { key: "opponent", hp: this.opponentCombatant.hp, max: this.opponentCombatant.maxHp, fg: this.opponentBar, ghost: this.opponentGhostBar },
    ];
    for (const item of values) {
      const ratio = Phaser.Math.Clamp(item.hp / item.max, 0, 1);
      item.fg.width = 300 * ratio;
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
      item.ghost.width = Phaser.Math.Linear(item.ghost.width, 300 * ghostRatio, 0.12);
    }
  }

  createHud() {
    const textStyle = { fontFamily: "system-ui, sans-serif", color: "#ffffff" };
    this.add.text(32, 28, "CHOG FIGHT CLUB", { ...textStyle, fontSize: "22px", fontStyle: "700" }).setScrollFactor(0);
    this.add.text(32, 58, "A / D or ← / → move  •  SPACE / W / ↑ jump  •  F basic  •  1 base  •  2 special  •  3 defense", { ...textStyle, fontSize: "14px", color: "#c8ccd4" }).setScrollFactor(0);
    this.playerHpText = this.add.text(32, 178, "", { ...textStyle, fontSize: "14px" }).setScrollFactor(0);
    this.playerEnergyText = this.add.text(32, 218, "", { ...textStyle, fontSize: "13px", color: "#b8ffca" }).setScrollFactor(0);
    this.playerCooldownText = this.add.text(32, 238, "", { ...textStyle, fontSize: "12px", color: "#c8ccd4" }).setScrollFactor(0);
    this.statusText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 38, "", { ...textStyle, fontSize: "16px", align: "center" }).setOrigin(0.5).setScrollFactor(0).setDepth(30);

    this.playerGhostBar = this.add.rectangle(32, 162, 300, 18, 0xffffff, 0.32).setOrigin(0, 0.5).setScrollFactor(0).setDepth(10);
    this.playerBar = this.add.rectangle(32, 162, 300, 18, 0x53d769, 1).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11);
    this.playerEnergyBar = this.add.rectangle(32, 202, 300, 10, 0x39d96a, 1).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11);
    this.add.rectangle(32, 202, 300, 10, 0xffffff, 0.12).setOrigin(0, 0.5).setScrollFactor(0).setDepth(10);

    this.opponentGhostBar = this.add.rectangle(GAME_WIDTH - 332, 162, 300, 18, 0xffffff, 0.32).setOrigin(0, 0.5).setScrollFactor(0).setDepth(10);
    this.opponentBar = this.add.rectangle(GAME_WIDTH - 332, 162, 300, 18, 0xf04b61, 1).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11);
    this.add.text(GAME_WIDTH - 332, 178, "OPPONENT", { ...textStyle, fontSize: "14px" }).setScrollFactor(0);
  }

  updateHud() {
    const hp = Math.max(0, Math.round(this.playerCombatant.hp));
    const energy = Math.round(this.playerCombatant.energy);
    const shield = 0;
    const energyRatio = Phaser.Math.Clamp(this.playerCombatant.energy / this.playerCombatant.maxEnergy, 0, 1);
    this.playerHpText.setText(`HP ${hp}/${this.playerCombatant.maxHp}${shield ? `  •  SHIELD ${shield}` : ""}`);
    this.playerEnergyBar.width = 300 * energyRatio;
    this.playerEnergyText.setText(`ENERGY ${energy}%  •  Basic 5%  •  Base 10%  •  Special 35%`);

    const basic = getCooldownRemaining(this.playerCombatant, "basic");
    const base = getCooldownRemaining(this.playerCombatant, "base");
    const special = getCooldownRemaining(this.playerCombatant, "special");
    const cooldownLabel = (name, value) => value > 0 ? `${name} ${(value / 1000).toFixed(1)}s` : `${name} READY`;
    this.playerCooldownText.setText(`${cooldownLabel("F", basic)}  •  ${cooldownLabel("1", base)}  •  ${cooldownLabel("2", special)}`);
  }

  showStatus(message) {
    this.statusText.setText(message).setAlpha(1);
    this.tweens.killTweensOf(this.statusText);
    this.tweens.add({ targets: this.statusText, alpha: 0, delay: 650, duration: 350 });
  }

  createArena() {
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x9bc9e8, 0x9bc9e8, 0xd8eff7, 0xd8eff7, 1);
    bg.fillRect(0, 0, WORLD_WIDTH, GAME_HEIGHT);
    bg.fillStyle(0x6d9b70, 0.34);
    for (let x = 40; x < WORLD_WIDTH; x += 170) { bg.fillCircle(x, 300, 90); bg.fillRect(x - 18, 300, 36, 180); }
    bg.fillStyle(0xcfe3a4, 1); bg.fillRect(0, FLOOR_Y - 2, WORLD_WIDTH, GAME_HEIGHT - FLOOR_Y + 2);
    bg.fillStyle(0x92b66c, 1); bg.fillRect(0, FLOOR_Y, WORLD_WIDTH, 20);
    const arenaGlow = this.add.graphics(); arenaGlow.fillStyle(0xffffff, 0.11); arenaGlow.fillEllipse(WORLD_WIDTH / 2, FLOOR_Y - 3, 1050, 180);
    this.add.text(WORLD_WIDTH / 2, 120, "TRAINING ARENA", { fontFamily: "system-ui, sans-serif", fontSize: "14px", color: "#ffffff" }).setOrigin(0.5).setAlpha(0.65);
  }

  createChogVisual(x, y, mirrored) {
    const container = this.add.container(x, y);
    const shadow = this.add.ellipse(0, 113, 150, 24, 0x30452e, 0.22);
    const body = this.add.ellipse(0, 0, 150, 170, 0xd9a72f, 1);
    const belly = this.add.ellipse(0, 28, 112, 116, 0xe7bd4e, 1);
    const leftArm = this.add.ellipse(-72, 25, 42, 72, 0xd9a72f, 1); leftArm.setAngle(12);
    const rightArm = this.add.ellipse(72, 25, 42, 72, 0xd9a72f, 1); rightArm.setAngle(-12);
    const leftFoot = this.add.ellipse(-45, 87, 48, 26, 0x9a6a22, 1);
    const rightFoot = this.add.ellipse(45, 87, 48, 26, 0x9a6a22, 1);
    const leftEye = this.add.ellipse(-25, -20, 20, 28, 0x171717, 1);
    const rightEye = this.add.ellipse(25, -20, 20, 28, 0x171717, 1);
    const leftHighlight = this.add.circle(-22, -25, 4, 0xffffff, 0.9);
    const rightHighlight = this.add.circle(28, -25, 4, 0xffffff, 0.9);
    const mouth = this.add.ellipse(0, 18, 30, 13, 0x5c2a1d, 1);
    const flash = this.add.ellipse(0, 0, 155, 175, 0xffffff, 1).setAlpha(0).setData("flash", true);
    container.add([shadow, leftArm, rightArm, leftFoot, rightFoot, body, belly, leftEye, rightEye, leftHighlight, rightHighlight, mouth, flash]);
    container.setScale(mirrored ? -1 : 1, 1);
    return container;
  }
}

const config = {
  type: Phaser.AUTO,
  parent: "game",
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: "#111318",
  physics: { default: "arcade", arcade: { gravity: { y: 0 }, debug: false } },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: GAME_WIDTH, height: GAME_HEIGHT },
  scene: [BootScene, ArenaScene],
};

new Phaser.Game(config);
