import Phaser from "phaser";
import { BootScene } from "./bootScene.js";
import { applyChogPose, createChogVisual, flashChog } from "./game/chogRig.js";

const WIDTH = 960;
const HEIGHT = 540;
const SCALE = 0.66;
const GUARD = {
  leadArmRotation: -2.24,
  rearArmRotation: -2.42,
  leadLegRotation: 0,
  rearLegRotation: 0,
  torsoRotation: 0,
  headRotation: 0,
};
const ACCENTS = { challenger: 0xffc94a, opponent: 0xa98aff };

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

class OnlineBootScene extends BootScene {
  create() {
    this.createPlaceholderTextures();
    this.scene.start("LiveArenaScene");
  }
}

class LiveArenaScene extends Phaser.Scene {
  constructor() {
    super("LiveArenaScene");
    this.latestState = null;
    this.viewerRole = null;
    this.fighters = {};
    this.readyForState = false;
    this.finishedOverlay = null;
  }

  create() {
    this.drawRing();
    for (const role of ["challenger", "opponent"]) this.createFighter(role);
    this.finishedOverlay = this.add.container(WIDTH / 2, HEIGHT / 2).setDepth(1000).setVisible(false);
    const shade = this.add.rectangle(0, 0, WIDTH, HEIGHT, 0x090a0d, 0.78);
    const title = this.add.text(0, -18, "MATCH OVER", {
      fontFamily: "system-ui, sans-serif", fontSize: "32px", fontStyle: "900",
      color: "#ffffff", stroke: "#111318", strokeThickness: 5,
    }).setOrigin(0.5);
    this.finishedText = this.add.text(0, 24, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "17px", fontStyle: "700",
      color: "#f0b53a", stroke: "#111318", strokeThickness: 4,
    }).setOrigin(0.5);
    this.finishedOverlay.add([shade, title, this.finishedText]);
    this.readyForState = true;
    if (this.latestState) this.applySnapshot();
  }

  drawRing() {
    const background = this.add.graphics();
    background.fillGradientStyle(0x17101f, 0x17101f, 0x0b1119, 0x0b1119, 1);
    background.fillRect(0, 0, WIDTH, HEIGHT);
    background.fillStyle(0x0a0d13, 0.9);
    background.fillEllipse(WIDTH / 2, 430, 920, 190);

    const ring = this.add.graphics();
    ring.fillStyle(0x1a1a25, 1);
    ring.fillRect(78, 84, 804, 352);
    ring.lineStyle(2, 0x7967a5, 0.9);
    ring.strokeRect(76, 82, 808, 356);
    ring.lineStyle(1, 0x34313d, 0.9);
    for (const y of [154, 238, 322]) {
      ring.lineBetween(86, y, 874, y);
    }
    ring.lineStyle(5, 0xf0b53a, 0.82);
    ring.lineBetween(82, 148, 878, 148);
    ring.lineStyle(4, 0xa38cff, 0.82);
    ring.lineBetween(82, 326, 878, 326);
    ring.fillStyle(0xf0b53a, 1);
    for (const [x, y] of [[76, 82], [884, 82], [76, 438], [884, 438]]) {
      ring.fillRoundedRect(x - 8, y - 8, 16, 16, 4);
    }
    ring.lineStyle(1, 0xf5f2ea, 0.18);
    ring.strokeRect(115, 112, 730, 294);

    this.add.text(WIDTH / 2, 38, "CHOG FIGHT CLUB · LIVE RING", {
      fontFamily: "system-ui, sans-serif", fontSize: "13px", fontStyle: "700",
      color: "#f5f2ea", letterSpacing: 2,
    }).setOrigin(0.5);
    this.add.text(WIDTH / 2, 474, "TWO PLAYERS · SERVER-SYNCED", {
      fontFamily: "system-ui, sans-serif", fontSize: "11px", fontStyle: "700",
      color: "#d0c7e4", letterSpacing: 1,
    }).setOrigin(0.5);
  }

  createFighter(role) {
    const x = role === "challenger" ? 250 : 710;
    const y = 265;
    const root = createChogVisual(this, x, y, role === "opponent");
    root.setScale((role === "opponent" ? -1 : 1) * SCALE, SCALE);
    root.setDepth(100 + y);
    const accent = ACCENTS[role];
    const name = this.add.text(x, y - 146, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "14px", fontStyle: "800",
      color: "#ffffff", stroke: "#090a0d", strokeThickness: 5,
    }).setOrigin(0.5).setDepth(700);
    const dna = this.add.text(x, y - 126, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "11px", fontStyle: "700",
      color: role === "challenger" ? "#ffe2a0" : "#e4d8ff", stroke: "#090a0d", strokeThickness: 4,
    }).setOrigin(0.5).setDepth(700);
    const marker = this.add.circle(x, y - 106, 4, accent).setDepth(700);
    this.fighters[role] = {
      root,
      name,
      dna,
      marker,
      targetX: x,
      targetY: y,
      facing: role === "challenger" ? 1 : -1,
      action: "idle",
      actionStartedAt: 0,
      actionUntil: 0,
      flashUntil: 0,
      previousFlashUntil: 0,
      connected: false,
      username: role === "challenger" ? "Challenger" : "Opponent",
      fighterName: "Chog",
      tokenId: "",
      tier: "Common",
      ability: "Focused Strike",
      attack: 20,
      defense: 14,
      speed: 14,
      stridePhase: role === "challenger" ? 0 : 1.7,
    };
  }

  setSnapshot(state, viewerRole) {
    this.latestState = state;
    this.viewerRole = viewerRole;
    if (this.readyForState) this.applySnapshot();
  }

  applySnapshot() {
    const state = this.latestState;
    if (!state) return;
    for (const role of ["challenger", "opponent"]) {
      const source = state.players?.[role];
      const fighter = this.fighters[role];
      if (!source || !fighter) continue;
      fighter.targetX = clamp(Number(source.x ?? fighter.targetX), 50, WIDTH - 50);
      fighter.targetY = clamp(Number(source.y ?? fighter.targetY), 150, HEIGHT - 92);
      fighter.facing = Number(source.facing) < 0 ? -1 : 1;
      fighter.action = source.action || "idle";
      fighter.actionStartedAt = Number(source.actionStartedAt || 0);
      fighter.actionUntil = Number(source.actionUntil || 0);
      fighter.flashUntil = Number(source.flashUntil || 0);
      fighter.connected = Boolean(source.connected);
      fighter.username = source.username || (role === "challenger" ? "Challenger" : "Opponent");
      fighter.fighterName = source.fighterName || "Chog";
      fighter.tokenId = String(source.tokenId || "");
      fighter.tier = source.tier || "Common";
      fighter.ability = source.ability || "Focused Strike";
      fighter.attack = Number(source.attack || 20);
      fighter.defense = Number(source.defense || 14);
      fighter.speed = Number(source.speed || 14);

      if (fighter.flashUntil > fighter.previousFlashUntil) {
        flashChog(this, fighter.root.rig, 0xffffff, 90);
        fighter.previousFlashUntil = fighter.flashUntil;
      }
      const who = role === this.viewerRole ? "YOU" : "RIVAL";
      const tokenLabel = fighter.tokenId ? ` · Chog #${fighter.tokenId}` : "";
      fighter.name.setText(`${who} · @${fighter.username}${tokenLabel}`);
      fighter.dna.setText(`${fighter.fighterName} · ${fighter.tier} · ${fighter.ability} · ATK ${fighter.attack}`);
      fighter.marker.setFillStyle(fighter.connected ? ACCENTS[role] : 0x777780);
    }
    const winner = state.winnerRole === this.viewerRole ? "You won the live match." : "The live match has ended.";
    this.finishedText.setText(winner);
    this.finishedOverlay.setVisible(state.status === "FINISHED");
  }

  update(_time, delta) {
    const now = Date.now();
    const blend = 1 - Math.exp(-delta / 72);
    for (const role of ["challenger", "opponent"]) {
      const fighter = this.fighters[role];
      if (!fighter) continue;
      const root = fighter.root;
      const fromX = root.x;
      root.x = Phaser.Math.Linear(root.x, fighter.targetX, blend);
      root.y = Phaser.Math.Linear(root.y, fighter.targetY, blend);
      root.setScale((fighter.facing < 0 ? -1 : 1) * SCALE, SCALE);
      root.setDepth(100 + root.y);
      const moved = Math.abs(root.x - fromX) > 0.2;
      const stride = Math.sin(now * 0.0065 + fighter.stridePhase);
      const guard = {
        ...GUARD,
        leadArmRotation: GUARD.leadArmRotation - (moved ? stride * 0.035 : 0),
        rearArmRotation: GUARD.rearArmRotation + (moved ? stride * 0.035 : 0),
        leadLegRotation: moved ? stride * 0.1 : 0,
        rearLegRotation: moved ? -stride * 0.1 : 0,
        leadLegX: moved ? stride * 5 : 0,
        rearLegX: moved ? -stride * 5 : 0,
        torsoRotation: moved ? -stride * 0.015 : 0,
        torsoY: moved ? -(0.5 - Math.cos(2 * (now * 0.0065 + fighter.stridePhase)) * 0.5) * 1.2 : 0,
      };
      let pose = guard;
      const actionAge = now - fighter.actionStartedAt;
      const duration = Math.max(1, fighter.actionUntil - fighter.actionStartedAt);
      if ((fighter.action === "attack" || fighter.action === "special") && actionAge >= 0 && actionAge < duration) {
        const pulse = Math.sin(Math.PI * clamp(actionAge / duration, 0, 1));
        const heavy = fighter.action === "special";
        pose = {
          ...guard,
          leadArmRotation: GUARD.leadArmRotation - pulse * (heavy ? 1.05 : 0.68),
          leadArmX: pulse * (heavy ? 16 : 11),
          rearArmRotation: GUARD.rearArmRotation + pulse * 0.035,
          leadLegRotation: -pulse * (heavy ? 0.07 : 0.045),
          rearLegRotation: pulse * (heavy ? 0.1 : 0.07),
          leadLegX: pulse * 6,
          rearLegX: -pulse * 3,
          torsoRotation: -pulse * (heavy ? 0.1 : 0.07),
          torsoX: pulse * (heavy ? 6 : 4),
          headRotation: -pulse * 0.02,
        };
      } else if (fighter.action === "dash" && actionAge >= 0 && actionAge < duration) {
        const pulse = Math.sin(Math.PI * clamp(actionAge / duration, 0, 1));
        pose = {
          ...guard,
          leadArmRotation: GUARD.leadArmRotation - pulse * 0.18,
          rearArmRotation: GUARD.rearArmRotation + pulse * 0.12,
          torsoRotation: -pulse * 0.09,
          torsoX: pulse * 7,
          leadLegRotation: -pulse * 0.12,
          rearLegRotation: pulse * 0.14,
        };
      }
      if (fighter.flashUntil > now) {
        const react = Math.max(0, Math.sin(Math.PI * clamp((fighter.flashUntil - now) / 230, 0, 1)));
        pose = {
          ...pose,
          leadArmRotation: pose.leadArmRotation - 0.12 * react,
          rearArmRotation: pose.rearArmRotation - 0.16 * react,
          leadLegRotation: pose.leadLegRotation - 0.06 * react,
          rearLegRotation: pose.rearLegRotation + 0.08 * react,
          torsoRotation: pose.torsoRotation + 0.11 * react,
          headRotation: pose.headRotation - 0.045 * react,
          torsoX: (pose.torsoX || 0) - 2 * react,
          torsoY: (pose.torsoY || 0) + 1.2 * react,
        };
      }
      applyChogPose(root.rig, pose);
      fighter.name.setPosition(root.x, root.y - 146);
      fighter.dna.setPosition(root.x, root.y - 126);
      fighter.marker.setPosition(root.x, root.y - 106);
    }
  }

}

export function createLiveArena(parent) {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: "#090a0d",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: WIDTH,
      height: HEIGHT,
    },
    render: { antialias: true },
    scene: [OnlineBootScene, LiveArenaScene],
  });
  if (game.canvas) {
    game.canvas.setAttribute("aria-label", "Live two-player Chog arena. Fighter movement and health are synchronized from the match server.");
    game.canvas.setAttribute("tabindex", "0");
  }
  return {
    setState(state, viewerRole) {
      const scene = game.scene.getScene("LiveArenaScene");
      if (scene) scene.setSnapshot(state, viewerRole);
    },
    destroy() {
      game.destroy(true);
    },
  };
}
