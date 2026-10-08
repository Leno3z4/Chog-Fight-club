import Phaser from "phaser";

const WORLD_WIDTH = 1600;

export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
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

    // Add real Chog sprite sheets/audio here as they arrive. The arena remains
    // fully playable with generated placeholders until those assets exist.
  }

  create() {
    this.createPlaceholderTextures();
    this.scene.start("ArenaScene");
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
