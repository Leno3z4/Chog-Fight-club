import Phaser from "phaser";
import bodyUrl from "../images/body.png";
import eyesUrl from "../images/eyes.png";
import headUrl from "../images/head.png";
import mouthUrl from "../images/mouth.png";
import leftFootUrl from "../images/left foot.png";
import leftHandUrl from "../images/left hand.png";
import leftLowerArmUrl from "../images/left lower hand.png";
import leftUpperArmUrl from "../images/left upper hand.png";
import leftLowerLegUrl from "../images/left lower leg.png";
import leftUpperLegUrl from "../images/left upper leg.png";
import rightFootUrl from "../images/right leg.png";
import rightHandUrl from "../images/right hand.png";
import rightLowerArmUrl from "../images/right lower hand.png";
import rightUpperArmUrl from "../images/right upper hand.png";
import rightLowerLegUrl from "../images/right lower leg.png";
import rightUpperLegUrl from "../images/right upper leg.png";
import arenaBackgroundUrl from "../images/Purple Neon Arena Battleground.png";
import battleHudFrameUrl from "../images/health and mp bar.png";
import deadChogUrl from "../images/dead.png";

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

    const chogLayers = {
      body: bodyUrl,
      eyes: eyesUrl,
      head: headUrl,
      mouth: mouthUrl,
      "left-foot": leftFootUrl,
      "left-hand": leftHandUrl,
      "left-lower-arm": leftLowerArmUrl,
      "left-upper-arm": leftUpperArmUrl,
      "left-lower-leg": leftLowerLegUrl,
      "left-upper-leg": leftUpperLegUrl,
      "right-foot": rightFootUrl,
      "right-hand": rightHandUrl,
      "right-lower-arm": rightLowerArmUrl,
      "right-upper-arm": rightUpperArmUrl,
      "right-lower-leg": rightLowerLegUrl,
      "right-upper-leg": rightUpperLegUrl,
    };

    for (const [layer, url] of Object.entries(chogLayers)) {
      this.load.image(`chog-${layer}`, url);
    }
    // Use the artwork supplied in /images for the arena, fighter HUD, and knockout state.
    this.load.image("arena-background", arenaBackgroundUrl);
    this.load.image("health-mp-frame", battleHudFrameUrl);
    this.load.image("dead-chog", deadChogUrl);
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
