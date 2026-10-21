import Phaser from "phaser";
import { BootScene } from "./bootScene.js";
import { applyChogPose, chogArmTargetPose, createChogVisual } from "./game/chogRig.js";

const WIDTH = 1600;
const HEIGHT = 960;
const POSES = ["idle", "walk", "jab", "cross", "hit", "jump"];
const QUERY = new URLSearchParams(window.location.search);
const FACING_FILTER = QUERY.get("facing");
const FACINGS = FACING_FILTER === "left" || FACING_FILTER === "right"
  ? [FACING_FILTER]
  : ["right", "left"];

function getPose(name) {
  const oldGuard = {
    leadArmRotation: -0.04,
    leadArmLowerRotation: -1.14,
    rearArmRotation: -1.24,
    rearArmLowerRotation: -1.18,
    leadArmX: 0,
    leadArmY: 0,
    rearArmX: 0,
    rearArmY: 0,
    ...chogArmTargetPose("guard"),
    leadLegRotation: -0.14,
    leadLegLowerRotation: 0,
    rearLegRotation: -0.5,
    rearLegLowerRotation: 0.68,
    torsoRotation: 0,
    torsoX: 0,
    torsoY: 0,
  };
  if (name === "walk") {
    return {
      ...oldGuard,
      leadLegRotation: -0.42,
      rearLegRotation: -0.16,
      leadLegLowerRotation: 0.18,
      rearLegLowerRotation: 0.72,
      leadLegY: -2,
      torsoX: 1,
      torsoY: -1,
      headRotation: 0.01,
    };
  }
  if (name === "jump") {
    return {
      ...oldGuard,
      leadLegRotation: -0.8,
      leadLegLowerRotation: 1.66,
      rearLegRotation: -1.1,
      rearLegLowerRotation: 1.02,
      leadLegY: -4,
      rearLegY: -3,
      torsoRotation: -0.02,
      torsoY: -3,
    };
  }
  if (name === "idle") return { ...oldGuard, ...chogArmTargetPose("guard") };
  if (name === "jab") {
    return {
      ...oldGuard,
      ...chogArmTargetPose("jab"),
      torsoRotation: -0.14,
      torsoX: 8,
      torsoY: -1,
      leadLegRotation: -0.26,
      rearLegRotation: -0.42,
      leadLegX: 8,
    };
  }
  if (name === "cross") {
    return {
      ...oldGuard,
      ...chogArmTargetPose("cross"),
      torsoRotation: -0.22,
      torsoX: 13,
      torsoY: -2,
      leadLegRotation: -0.10,
      rearLegRotation: -0.34,
      rearLegX: 6,
    };
  }
  return {
    ...oldGuard,
    ...chogArmTargetPose("hit"),
    torsoRotation: 0.11,
    torsoX: -2,
    torsoY: 1.2,
    headRotation: -0.045,
    leadLegRotation: -0.2,
    rearLegRotation: -0.42,
  };
}

class RigPreviewBootScene extends BootScene {
  create() {
    this.createPlaceholderTextures();
    this.scene.start("RigPreviewScene");
  }
}

class RigPreviewScene extends Phaser.Scene {
  constructor() {
    super("RigPreviewScene");
  }

  create() {
    const bothFacings = FACINGS.length === 2;
    this.add.text(44, 28, "CHOG ARM RIG · VISUAL REGRESSION SHEET", {
      fontFamily: "system-ui, sans-serif",
      fontSize: "24px",
      fontStyle: "800",
      color: "#f2f4fa",
    });
    this.add.text(44, 61, "Cheek-level guard targets · gloves visible over face · same assembled rig in both facings", {
      fontFamily: "system-ui, sans-serif",
      fontSize: "13px",
      color: "#9ba7bb",
    });

    FACINGS.forEach((facing, rowIndex) => {
      const rowTop = bothFacings ? 120 + rowIndex * 418 : 210;
      const rowCenterY = rowTop + 216;
      this.add.text(46, rowTop - 9, facing === "right" ? "RIGHT-FACING · CONTROLLABLE" : "LEFT-FACING · OPPONENT", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "14px",
        fontStyle: "800",
        color: facing === "right" ? "#7ed9bd" : "#ff9d88",
      });

      POSES.forEach((name, column) => {
        const x = 138 + column * 264;
        const panel = this.add.rectangle(x, rowCenterY, 244, 390, 0x151b27, 1)
          .setStrokeStyle(1, 0x2d3648, 1);
        panel.setDepth(-2);
        this.add.text(x, rowTop + 15, name.toUpperCase(), {
          fontFamily: "system-ui, sans-serif",
          fontSize: "13px",
          fontStyle: "800",
          color: "#e5eaf3",
        }).setOrigin(0.5, 0.5);
        this.add.rectangle(x, rowTop + 348, 215, 2, 0x2b3a37, 1);
        const root = createChogVisual(this, x, rowTop + 227, facing === "left");
        root.setDepth(1);
        applyChogPose(root.rig, getPose(name));
      });
    });
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "preview",
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: "#0b0e14",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH,
    height: HEIGHT,
  },
  render: { antialias: true },
  scene: [RigPreviewBootScene, RigPreviewScene],
});

window.addEventListener("beforeunload", () => game.destroy(true), { once: true });
