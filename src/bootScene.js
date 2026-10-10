import Phaser from "phaser";

const WORLD_WIDTH = 1600;
const CHOG_SIZE = 250;

export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
    this.artIntegrated = false;
  }

  preload() {
    const width = this.scale.width;
    const height = this.scale.height;
    const track = this.add.rectangle(width / 2, height / 2, 360, 12, 0xffffff, 0.16);
    const bar = this.add.rectangle(width / 2 - 180, height / 2, 1, 12, 0xffffff, 0.9).setOrigin(0, 0.5);
    const label = this.add.text(width / 2, height / 2 - 34, "LOADING CHOG FIGHT CLUB", {
      fontFamily: "system-ui, sans-serif",
      fontSize: "14px",
      color: "#ffffff",
      fontStyle: "700",
    }).setOrigin(0.5);
    this.load.on("progress", (value) => { bar.width = 360 * value; });
    this.load.on("complete", () => { track.destroy(); bar.destroy(); label.destroy(); });

    const chogLayers = [
      "body", "eyes", "head", "left-arm", "left-leg", "nose", "right-arm", "right-leg",
    ];
    for (const layer of chogLayers) {
      this.load.image(`chog-${layer}`, `/images/${layer}.png`);
    }
  }

  create() {
    this.createPlaceholderTextures();
    this.scene.start("ArenaScene");
    this.game.events.on("step", this.integrateRealArt, this);
  }

  integrateRealArt() {
    if (this.artIntegrated) return;
    const arena = this.scene.get("ArenaScene");
    if (!arena?.playerVisual || !arena?.opponentVisual) return;

    arena.playerVisual.destroy(true);
    arena.opponentVisual.destroy(true);
    arena.playerVisual = this.createChogVisual(arena, arena.player.x, arena.player.y - 55, false);
    arena.opponentVisual = this.createChogVisual(arena, arena.opponent.x, arena.opponent.y - 55, true);
    this.artIntegrated = true;
    this.game.events.off("step", this.integrateRealArt, this);
  }

  createChogVisual(scene, x, y, mirrored) {
    const container = scene.add.container(x, y);
    const shadow = scene.add.ellipse(0, 119, 150, 24, 0x111318, 0.28);
    const layerOrder = [
      "left-leg",
      "right-leg",
      "body",
      "left-arm",
      "right-arm",
      "head",
      "eyes",
      "nose",
    ];

    for (const layer of layerOrder) {
      const image = scene.add.image(0, 0, `chog-${layer}`);
      image.setDisplaySize(CHOG_SIZE, CHOG_SIZE);
      image.setOrigin(0.5, 0.5);
      container.add(image);
    }

    const flash = scene.add.rectangle(0, 0, CHOG_SIZE, CHOG_SIZE, 0xffffff, 0)
      .setData("flash", true);
    container.add(flash);
    container.addAt(shadow, 0);
    container.setScale(mirrored ? -1 : 1, 1);
    return container;
  }

  createPlaceholderTextures() {
    if (!this.textures.exists("chog-hitbox")) {
      const hitbox = this.make.graphics({ x: 0, y: 0, add: false });
      hitbox.fillStyle(0xffffff, 0);
      hitbox.fillRect(0, 0, 128, 128);
      hitbox.generateTexture("chog-hitbox", 128, 128);
      hitbox.destroy();
    }

    if (!this.textures.exists("floor")) {
      const floor = this.make.graphics({ x: 0, y: 0, add: false });
      floor.fillStyle(0xffffff, 1);
      floor.fillRect(0, 0, WORLD_WIDTH, 60);
      floor.generateTexture("floor", WORLD_WIDTH, 60);
      floor.destroy();
    }
  }
}
