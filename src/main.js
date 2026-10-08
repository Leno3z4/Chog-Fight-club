import Phaser from "phaser";
import "./style.css";

const GAME_WIDTH = 1280;
const GAME_HEIGHT = 720;
const WORLD_WIDTH = 1600;
const FLOOR_Y = 610;

class ArenaScene extends Phaser.Scene {
  constructor() {
    super("ArenaScene");
    this.player = null;
    this.playerVisual = null;
    this.opponentVisual = null;
    this.cursors = null;
    this.keys = null;
  }

  create() {
    this.createArena();
    this.createPlaceholderChogTextures();

    this.player = this.physics.add.sprite(360, FLOOR_Y - 72, "chog-hitbox");
    this.player.setSize(96, 120);
    this.player.setOffset(16, 0);
    this.player.setGravityY(1250);
    this.player.setCollideWorldBounds(true);
    this.player.setDragX(900);
    this.player.setMaxVelocity(360, 900);

    this.playerVisual = this.createChogVisual(360, FLOOR_Y - 120, false);
    this.opponentVisual = this.createChogVisual(1080, FLOOR_Y - 120, true);

    const floor = this.physics.add.staticImage(WORLD_WIDTH / 2, FLOOR_Y + 30, "floor");
    floor.setDisplaySize(WORLD_WIDTH, 60);
    floor.refreshBody();

    this.physics.add.collider(this.player, floor);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys({
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      jump: Phaser.Input.Keyboard.KeyCodes.SPACE,
      jumpW: Phaser.Input.Keyboard.KeyCodes.W,
    });

    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, GAME_HEIGHT);
    this.cameras.main.centerOn(GAME_WIDTH / 2, GAME_HEIGHT / 2);

    this.add
      .text(32, 28, "CHOG FIGHT CLUB", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "22px",
        fontStyle: "700",
        color: "#ffffff",
      })
      .setScrollFactor(0);

    this.add
      .text(32, 58, "A / D or ← / → to move  •  SPACE / W / ↑ to jump", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "15px",
        color: "#c8ccd4",
      })
      .setScrollFactor(0);

    this.add
      .text(GAME_WIDTH - 32, 32, "ENGINE PROTOTYPE", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "13px",
        color: "#8f96a3",
      })
      .setOrigin(1, 0)
      .setScrollFactor(0);
  }

  update() {
    if (!this.player) return;

    const left = this.cursors.left.isDown || this.keys.left.isDown;
    const right = this.cursors.right.isDown || this.keys.right.isDown;

    if (left) {
      this.player.setVelocityX(-260);
    } else if (right) {
      this.player.setVelocityX(260);
    } else {
      this.player.setVelocityX(0);
    }

    const grounded = this.player.body.blocked.down || this.player.body.touching.down;
    const jumpPressed =
      Phaser.Input.Keyboard.JustDown(this.cursors.up) ||
      Phaser.Input.Keyboard.JustDown(this.keys.jump) ||
      Phaser.Input.Keyboard.JustDown(this.keys.jumpW);

    if (jumpPressed && grounded) {
      this.player.setVelocityY(-620);
    }

    this.player.x = Phaser.Math.Clamp(this.player.x, 150, WORLD_WIDTH - 150);

    this.playerVisual.x = this.player.x;
    this.playerVisual.y = this.player.y - 55;

    const moving = Math.abs(this.player.body.velocity.x) > 5;
    const airborne = !grounded;
    const targetScaleX = airborne ? 1.04 : moving ? 1.02 : 1;
    const targetScaleY = airborne ? 1.08 : moving ? 0.98 : 1;

    const facing = this.player.body.velocity.x < -5 ? -1 : 1;
    this.playerVisual.scaleX = Phaser.Math.Linear(
      this.playerVisual.scaleX,
      targetScaleX * facing,
      0.16
    );
    this.playerVisual.scaleY = Phaser.Math.Linear(
      this.playerVisual.scaleY,
      targetScaleY,
      0.16
    );

    this.opponentVisual.y = FLOOR_Y - 120 + Math.sin(this.time.now / 500) * 3;
  }

  createArena() {
    const bg = this.add.graphics();

    // Fixed side-on battle backdrop. Final environment art will replace this prototype.
    bg.fillGradientStyle(0x9bc9e8, 0x9bc9e8, 0xd8eff7, 0xd8eff7, 1);
    bg.fillRect(0, 0, WORLD_WIDTH, GAME_HEIGHT);

    // Distant silhouettes create the first hint of 2.5D depth.
    bg.fillStyle(0x6d9b70, 0.34);
    for (let x = 40; x < WORLD_WIDTH; x += 170) {
      bg.fillCircle(x, 300, 90);
      bg.fillRect(x - 18, 300, 36, 180);
    }

    bg.fillStyle(0xcfe3a4, 1);
    bg.fillRect(0, FLOOR_Y - 2, WORLD_WIDTH, GAME_HEIGHT - FLOOR_Y + 2);

    bg.fillStyle(0x92b66c, 1);
    bg.fillRect(0, FLOOR_Y, WORLD_WIDTH, 20);

    const arenaGlow = this.add.graphics();
    arenaGlow.fillStyle(0xffffff, 0.11);
    arenaGlow.fillEllipse(WORLD_WIDTH / 2, FLOOR_Y - 3, 1050, 180);

    this.add
      .text(WORLD_WIDTH / 2, 120, "TRAINING ARENA", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "14px",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setAlpha(0.65);
  }

  createPlaceholderChogTextures() {
    const hitbox = this.make.graphics({ x: 0, y: 0, add: false });
    hitbox.fillStyle(0xffffff, 0);
    hitbox.fillRect(0, 0, 128, 128);
    hitbox.generateTexture("chog-hitbox", 128, 128);
    hitbox.destroy();

    const floor = this.make.graphics({ x: 0, y: 0, add: false });
    floor.fillStyle(0xffffff, 1);
    floor.fillRect(0, 0, WORLD_WIDTH, 60);
    floor.generateTexture("floor", WORLD_WIDTH, 60);
    floor.destroy();
  }

  createChogVisual(x, y, mirrored) {
    const container = this.add.container(x, y);

    const shadow = this.add.ellipse(0, 113, 150, 24, 0x30452e, 0.22);
    const body = this.add.ellipse(0, 0, 150, 170, 0xd9a72f, 1);
    const belly = this.add.ellipse(0, 28, 112, 116, 0xe7bd4e, 1);

    const leftArm = this.add.ellipse(-72, 25, 42, 72, 0xd9a72f, 1);
    leftArm.setAngle(12);
    const rightArm = this.add.ellipse(72, 25, 42, 72, 0xd9a72f, 1);
    rightArm.setAngle(-12);

    const leftFoot = this.add.ellipse(-45, 87, 48, 26, 0x9a6a22, 1);
    const rightFoot = this.add.ellipse(45, 87, 48, 26, 0x9a6a22, 1);

    const leftEye = this.add.ellipse(-25, -20, 20, 28, 0x171717, 1);
    const rightEye = this.add.ellipse(25, -20, 20, 28, 0x171717, 1);
    const leftHighlight = this.add.circle(-22, -25, 4, 0xffffff, 0.9);
    const rightHighlight = this.add.circle(28, -25, 4, 0xffffff, 0.9);
    const mouth = this.add.ellipse(0, 18, 30, 13, 0x5c2a1d, 1);

    container.add([
      shadow,
      leftArm,
      rightArm,
      leftFoot,
      rightFoot,
      body,
      belly,
      leftEye,
      rightEye,
      leftHighlight,
      rightHighlight,
      mouth,
    ]);

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
  physics: {
    default: "arcade",
    arcade: {
      gravity: { y: 0 },
      debug: false,
    },
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
  },
  scene: [ArenaScene],
};

new Phaser.Game(config);
