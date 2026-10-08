import Phaser from "phaser";
import "./style.css";
import { buildBattleDNA } from "./game/battleDNA.js";
import {
  createCombatant,
  jump as engineJump,
  move as engineMove,
  resolveBaseAbility,
  resolveBasicAttack,
  resolveDefenseAbility,
  resolveIncomingAttack,
  resolveSpecialAbility,
  updateMovement,
} from "./game/combatEngine.js";

const GAME_WIDTH = 1280;
const GAME_HEIGHT = 720;
const WORLD_WIDTH = 1600;
const FLOOR_Y = 610;
const ATTACK_COOLDOWN = 550;
const ATTACK_PHASES = { startup: 120, active: 100, recovery: 220 };

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
    this.playerHpText = null;
    this.playerEnergyText = null;
    this.statusText = null;
    this.playerBar = null;
    this.playerGhostBar = null;
    this.opponentBar = null;
    this.opponentGhostBar = null;
    this.attackSequence = null;
    this.incomingAttack = null;
    this.nextOpponentAttack = 1800;
    this.attackCooldown = 0;
    this.wasGrounded = true;
    this.ghostHp = { player: 0, opponent: 0 };
    this.ghostPending = { player: false, opponent: false };
  }

  create() {
    this.createArena();
    this.createPlaceholderChogTextures();
    this.playerCombatant = createCombatant(buildBattleDNA(PLAYER_METADATA));
    this.opponentCombatant = createCombatant(buildBattleDNA(OPPONENT_METADATA));

    this.player = this.physics.add.sprite(360, FLOOR_Y - 72, "chog-hitbox");
    this.player.setSize(96, 120).setOffset(16, 0).setGravityY(1250).setCollideWorldBounds(true);
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
    this.attackCooldown = Math.max(0, this.attackCooldown - delta);
    updateMovement(this.playerCombatant, dt);
    this.updatePlayerMovement();
    this.updateAttackSequence(delta);
    this.updateIncomingAttack(delta);
    this.updateVisuals(time);
    this.updateHealthBars();
    this.updateHud();
  }

  updatePlayerMovement() {
    const left = this.cursors.left.isDown || this.keys.left.isDown;
    const right = this.cursors.right.isDown || this.keys.right.isDown;
    if (left) {
      this.player.setVelocityX(-260);
      engineMove(this.playerCombatant, "left");
    } else if (right) {
      this.player.setVelocityX(260);
      engineMove(this.playerCombatant, "right");
    } else {
      this.player.setVelocityX(0);
      engineMove(this.playerCombatant, "idle");
    }

    const grounded = this.player.body.blocked.down || this.player.body.touching.down;
    const jumpPressed = Phaser.Input.Keyboard.JustDown(this.cursors.up) ||
      Phaser.Input.Keyboard.JustDown(this.keys.jump) || Phaser.Input.Keyboard.JustDown(this.keys.jumpW);

    if (jumpPressed && grounded && !this.attackSequence) {
      this.player.setVelocityY(-620);
      engineJump(this.playerCombatant);
      this.showStatus("JUMP — EVADE WINDOW");
      this.createDust(this.player.x, FLOOR_Y - 3);
    }

    if (Phaser.Input.Keyboard.JustDown(this.keys.basic)) this.startAttack("basic");
    if (Phaser.Input.Keyboard.JustDown(this.keys.base)) this.startAttack("base");
    if (Phaser.Input.Keyboard.JustDown(this.keys.special)) this.startAttack("special");
    if (Phaser.Input.Keyboard.JustDown(this.keys.defense)) this.useDefense();

    if (!this.wasGrounded && grounded) this.createDust(this.player.x, FLOOR_Y - 3);
    this.wasGrounded = grounded;
  }

  startAttack(slot) {
    if (this.attackCooldown > 0 || this.attackSequence) return;
    if (Math.abs(this.player.x - this.opponent.x) > 310) {
      this.showStatus("OUT OF RANGE");
      return;
    }
    this.attackSequence = {
      slot,
      phase: "startup",
      elapsed: 0,
      hit: false,
      hitbox: null,
      facing: this.player.x <= this.opponent.x ? 1 : -1,
    };
    this.showStatus(slot === "basic" ? "BASIC — WIND UP" : `${slot.toUpperCase()} — WIND UP`);
    this.tweens.add({
      targets: this.playerVisual,
      scaleX: 1.08 * this.attackSequence.facing,
      scaleY: 0.94,
      duration: ATTACK_PHASES.startup,
      ease: "Quad.easeOut",
    });
  }

  updateAttackSequence(delta) {
    const sequence = this.attackSequence;
    if (!sequence) return;
    sequence.elapsed += delta;

    if (sequence.phase === "startup" && sequence.elapsed >= ATTACK_PHASES.startup) {
      sequence.phase = "active";
      sequence.elapsed = 0;
      sequence.hitbox = this.createAttackHitbox(sequence.facing);
      this.flashAttackTelegraph(sequence.facing);
      this.showStatus("ACTIVE — HITBOX LIVE");
    }

    if (sequence.phase === "active") {
      this.checkPlayerHit(sequence);
      if (sequence.elapsed >= ATTACK_PHASES.active) {
        if (sequence.hitbox) sequence.hitbox.destroy();
        sequence.hitbox = null;
        sequence.phase = "recovery";
        sequence.elapsed = 0;
      }
    } else if (sequence.phase === "recovery" && sequence.elapsed >= ATTACK_PHASES.recovery) {
      this.attackSequence = null;
      this.attackCooldown = ATTACK_COOLDOWN;
      this.playerVisual.scaleY = 1;
    }
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
    if (this.attackSequence) return;
    try {
      const result = resolveDefenseAbility(this.playerCombatant);
      this.showStatus(`DEFENSE — SHIELD ${result.shield}`);
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

    if (this.attackSequence) return;
    this.nextOpponentAttack -= delta;
    if (this.nextOpponentAttack <= 0) {
      this.nextOpponentAttack = 2200;
      const facing = this.opponent.x < this.player.x ? 1 : -1;
      const visual = this.add.rectangle(this.opponent.x + facing * 90, FLOOR_Y - 55, 180, 10, 0x7b61ff, 0.9);
      visual.setDepth(5);
      this.incomingAttack = {
        timeLeft: 550,
        visual,
        action: "opponent-basic",
        power: this.opponentCombatant.dna.stats.attack,
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
    if (defender === this.player) this.player.setVelocityX(direction * 180);
    this.cameras.main.shake(heavy ? 120 : 70, heavy ? 0.007 : 0.004);
    this.applyHitstop(heavy ? 70 : 45);
    this.showStatus(`HIT — ${damage} DAMAGE`);
  }

  createAttackHitbox(facing) {
    const zone = this.add.zone(this.player.x + facing * 82, this.player.y - 50, 110, 95);
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
    if (this.attackSequence?.hitbox) {
      const facing = this.attackSequence.facing;
      this.attackSequence.hitbox.setPosition(this.player.x + facing * 82, this.player.y - 50);
    }
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
    this.tweens.add({ targets: flash, alpha: 0, duration: 220 });
  }

  showDamageNumber(x, y, damage) {
    const text = this.add.text(x, y, `-${damage}`, {
      fontFamily: "system-ui, sans-serif",
      fontSize: "28px",
      fontStyle: "900",
      color: "#ff3366",
      stroke: "#111318",
      strokeThickness: 5,
    }).setOrigin(0.5).setDepth(20);
    this.tweens.add({
      targets: text,
      y: y - 75,
      alpha: 0,
      scale: 1.35,
      duration: 600,
      ease: "Power2",
      onComplete: () => text.destroy(),
    });
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
      this.tweens.add({
        targets: dust,
        x: dust.x + Phaser.Math.Between(-30, 30),
        y: y - Phaser.Math.Between(8, 22),
        alpha: 0,
        scale: 1.4,
        duration: 280,
        onComplete: () => dust.destroy(),
      });
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
    if (!this.attackSequence) {
      const targetX = (grounded ? (moving ? 1.02 : 1) : 1.04) * facing;
      const targetY = grounded ? (moving ? 0.98 : 1) : 1.08;
      this.playerVisual.scaleX = Phaser.Math.Linear(this.playerVisual.scaleX, targetX, 0.16);
      this.playerVisual.scaleY = Phaser.Math.Linear(this.playerVisual.scaleY, targetY, 0.16);
    }
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
    this.playerEnergyText = this.add.text(32, 202, "", { ...textStyle, fontSize: "14px", color: "#c8ccd4" }).setScrollFactor(0);
    this.statusText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 38, "", { ...textStyle, fontSize: "16px", align: "center" }).setOrigin(0.5).setScrollFactor(0).setDepth(30);

    this.playerGhostBar = this.add.rectangle(32, 162, 300, 18, 0xffffff, 0.32).setOrigin(0, 0.5).setScrollFactor(0).setDepth(10);
    this.playerBar = this.add.rectangle(32, 162, 300, 18, 0x53d769, 1).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11);
    this.opponentGhostBar = this.add.rectangle(GAME_WIDTH - 332, 162, 300, 18, 0xffffff, 0.32).setOrigin(0, 0.5).setScrollFactor(0).setDepth(10);
    this.opponentBar = this.add.rectangle(GAME_WIDTH - 332, 162, 300, 18, 0xf04b61, 1).setOrigin(0, 0.5).setScrollFactor(0).setDepth(11);
    this.add.text(GAME_WIDTH - 332, 178, "OPPONENT", { ...textStyle, fontSize: "14px" }).setScrollFactor(0);
  }

  updateHud() {
    const hp = Math.max(0, Math.round(this.playerCombatant.hp));
    const shield = Math.round(this.playerCombatant.shield);
    this.playerHpText.setText(`HP ${hp}/${this.playerCombatant.maxHp}${shield ? `  •  SHIELD ${shield}` : ""}`);
    this.playerEnergyText.setText(`Energy ${this.playerCombatant.energy}  •  1 Base  •  2 Special  •  3 Defense`);
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

  createPlaceholderChogTextures() {
    const hitbox = this.make.graphics({ x: 0, y: 0, add: false }); hitbox.fillStyle(0xffffff, 0); hitbox.fillRect(0, 0, 128, 128); hitbox.generateTexture("chog-hitbox", 128, 128); hitbox.destroy();
    const floor = this.make.graphics({ x: 0, y: 0, add: false }); floor.fillStyle(0xffffff, 1); floor.fillRect(0, 0, WORLD_WIDTH, 60); floor.generateTexture("floor", WORLD_WIDTH, 60); floor.destroy();
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
  scene: [ArenaScene],
};

new Phaser.Game(config);
