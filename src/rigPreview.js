import Phaser from "phaser";
import { BootScene } from "./bootScene.js";
import {
  applyChogPose,
  chogArmTargetPose,
  getChogBlockArmTargets,
  getChogDoublePunchArmTargets,
  createChogVisual,
} from "./game/chogRig.js";

const WIDTH = 1600;
const HEIGHT = 960;
const POSES = ["guard", "jab", "cross", "double-jab", "double-cross", "block", "walk", "jump"];
const QUERY = new URLSearchParams(window.location.search);
const FACING_FILTER = QUERY.get("facing");
const POSE_FILTER = QUERY.get("pose");
const VISIBLE_POSES = POSES.includes(POSE_FILTER) ? [POSE_FILTER] : POSES;
const FACINGS = FACING_FILTER === "left" || FACING_FILTER === "right"
  ? [FACING_FILTER]
  : ["right", "left"];

function getPose(name) {
  // These arm-angle values remain the existing walk/jump preview poses. No
  // target-driven boxing values are added to either locomotion pose.
  const legacyLocomotion = {
    leadArmRotation: -0.04,
    leadArmLowerRotation: -1.14,
    rearArmRotation: -1.24,
    rearArmLowerRotation: -1.18,
    leadArmX: 0,
    leadArmY: 0,
    rearArmX: 16,
    rearArmY: 0,
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
      ...legacyLocomotion,
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
      ...legacyLocomotion,
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
  if (name === "guard") return chogArmTargetPose("guard");
  if (name === "jab") {
    return {
      ...chogArmTargetPose("jab"),
      torsoRotation: -0.14,
      torsoX: 8,
      torsoY: -1,
      leadLegRotation: -0.26,
      rearLegRotation: -0.42,
      leadLegX: 8,
    };
  }
  if (name === "cross" || name === "double-cross") {
    return {
      ...chogArmTargetPose("cross"),
      torsoRotation: -0.22,
      torsoX: 13,
      torsoY: -2,
      leadLegRotation: -0.10,
      rearLegRotation: -0.34,
      rearLegX: 6,
    };
  }
  if (name === "double-jab") return getChogDoublePunchArmTargets(0.20);
  if (name === "block") return getChogBlockArmTargets(0.48);
  return {
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
    const closeUp = VISIBLE_POSES.length === 1;
    this.add.text(36, 24, "CHOG BOXING ARM RIG · BOTH-FACING VISUAL CHECK", {
      fontFamily: "system-ui, sans-serif",
      fontSize: "22px",
      fontStyle: "800",
      color: "#f2f4fa",
    });
    this.add.text(36, 54, "Glove-center IK · smooth jab→guard→cross · high block · original walk/jump poses retained", {
      fontFamily: "system-ui, sans-serif",
      fontSize: "12px",
      color: "#9ba7bb",
    });

    FACINGS.forEach((facing, rowIndex) => {
      const rowTop = closeUp ? 130 : bothFacings ? 104 + rowIndex * 420 : 190;
      const rowCenterY = closeUp ? 530 : rowTop + 217;
      this.add.text(36, rowTop - 7, facing === "right" ? "RIGHT-FACING · PLAYER" : "LEFT-FACING · OPPONENT", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "13px",
        fontStyle: "800",
        color: facing === "right" ? "#7ed9bd" : "#ff9d88",
      });

      VISIBLE_POSES.forEach((name, column) => {
        const x = closeUp ? WIDTH / 2 : 104 + column * 199;
        const panel = this.add.rectangle(x, rowCenterY, closeUp ? 900 : 186, closeUp ? 760 : 394, 0x151b27, 1)
          .setStrokeStyle(1, 0x2d3648, 1);
        panel.setDepth(-2);
        this.add.text(x, rowTop + 15, name.toUpperCase().replaceAll("-", " "), {
          fontFamily: "system-ui, sans-serif",
          fontSize: "11px",
          fontStyle: "800",
          color: "#e5eaf3",
        }).setOrigin(0.5, 0.5);
        this.add.rectangle(x, closeUp ? rowTop + 700 : rowTop + 348, closeUp ? 720 : 162, 2, 0x2b3a37, 1);
        const root = createChogVisual(this, x, closeUp ? rowTop + 385 : rowTop + 227, facing === "left");
        const scale = closeUp ? 0.96 : 0.72;
        root.setScale(facing === "left" ? -scale : scale, scale);
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
