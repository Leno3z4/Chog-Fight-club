import Phaser from "phaser";
import { BootScene } from "./bootScene.js";
import { applyChogPose, chogArmTargetPose, createChogKnockoutPose, createChogVisual, flashChog } from "./game/chogRig.js";
import { punchPulse, punchWindowPulse } from "./game/punchEasing.js";

const WIDTH = 960;
const HEIGHT = 540;
const SCALE = 0.66;
const GUARD = {
  // Match solo mode: a relaxed right/lead guard with the left/rear glove home.
  leadArmRotation: -0.04,
  leadArmLowerRotation: -1.14,
  // The wrist target, not a shoulder translation, keeps the rear glove at guard level.
  rearArmRotation: -1.24,
  rearArmLowerRotation: -1.18,
  leadLegRotation: -0.14,
  leadLegLowerRotation: 0.0,
  rearLegRotation: -0.5,
  rearLegLowerRotation: 0.68,
  leadArmX: 0,
  leadArmY: 0,
  rearArmX: 0,
  rearArmY: 0,
  leadLegX: 0,
  leadLegY: 0,
  rearLegX: 0,
  rearLegY: 0,
  torsoRotation: 0,
  torsoX: 0,
  torsoY: 0,
  headRotation: 0,
  headX: 0,
  headY: 0,
};
const ACCENTS = { challenger: 0xffc94a, opponent: 0xa98aff };

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function blendPose(from, to, progress) {
  const t = clamp(progress, 0, 1);
  const eased = t * t * (3 - 2 * t);
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  return Object.fromEntries([...keys].map((key) => [
    key,
    (from[key] ?? 0) + ((to[key] ?? 0) - (from[key] ?? 0)) * eased,
  ]));
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
    this.finishedTitle = null;
    this.roundHudText = null;
    this.projectileVisuals = new Map();
    this.latestProjectiles = [];
    this.roundInfo = null;
    this.battleHud = {};
    this.avatarUrls = { challenger: "", opponent: "" };
  }

  create() {
    this.drawRing();
    for (const role of ["challenger", "opponent"]) this.createFighter(role);
    this.finishedOverlay = this.add.container(WIDTH / 2, HEIGHT / 2).setDepth(1000).setVisible(false);
    const shade = this.add.rectangle(0, 0, WIDTH, HEIGHT, 0x090a0d, 0.78);
    this.finishedTitle = this.add.text(0, -18, "MATCH OVER", {
      fontFamily: "system-ui, sans-serif", fontSize: "32px", fontStyle: "900",
      color: "#ffffff", stroke: "#111318", strokeThickness: 5,
    }).setOrigin(0.5);
    this.finishedText = this.add.text(0, 24, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "17px", fontStyle: "700",
      color: "#f0b53a", stroke: "#111318", strokeThickness: 4,
    }).setOrigin(0.5);
    this.finishedOverlay.add([shade, this.finishedTitle, this.finishedText]);
    this.readyForState = true;
    this.applyHudAvatars();
    this.updateBattleHud();
    if (this.latestState) this.applySnapshot();
  }

  drawRing() {
    if (this.textures.exists("arena-background")) {
      this.arenaBackgroundImage = this.add.image(WIDTH / 2, HEIGHT / 2, "arena-background")
        .setDisplaySize(WIDTH, HEIGHT).setDepth(-100);
    } else {
      const background = this.add.graphics().setDepth(-100);
      background.fillGradientStyle(0x17101f, 0x17101f, 0x0b1119, 0x0b1119, 1);
      background.fillRect(0, 0, WIDTH, HEIGHT);
      background.fillStyle(0x0a0d13, 0.9);
      background.fillEllipse(WIDTH / 2, 430, 920, 190);
      const ring = this.add.graphics().setDepth(0);
      ring.fillStyle(0x1a1a25, 1);
      ring.fillRect(78, 84, 804, 352);
      ring.lineStyle(2, 0x7967a5, 0.9);
      ring.strokeRect(76, 82, 808, 356);
      ring.lineStyle(1, 0x34313d, 0.9);
      for (const y of [154, 238, 322]) ring.lineBetween(86, y, 874, y);
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
      this.add.text(WIDTH / 2, 24, "CHOG FIGHT CLUB · LIVE RING", {
        fontFamily: "system-ui, sans-serif", fontSize: "12px", fontStyle: "700",
        color: "#f5f2ea", letterSpacing: 2,
      }).setOrigin(0.5).setDepth(700);
      this.add.text(WIDTH / 2, 474, "TWO PLAYERS · SERVER-SYNCED", {
        fontFamily: "system-ui, sans-serif", fontSize: "11px", fontStyle: "700",
        color: "#d0c7e4", letterSpacing: 1,
      }).setOrigin(0.5).setDepth(700);
    }
    this.createBattleHud();
    this.roundHudText = this.add.text(WIDTH / 2, WIDTH * 0.09, "R1/3 · 01:00 · 0-0", {
      fontFamily: "system-ui, sans-serif", fontSize: "11px", fontStyle: "900",
      color: "#291839", align: "center",
    }).setOrigin(0.5).setDepth(2012);
  }

  createBattleHud() {
    const healthY = WIDTH * 0.026;
    const manaY = WIDTH * 0.047;
    const healthWidth = WIDTH * 0.327;
    const healthHeight = WIDTH * 0.018;
    const manaWidth = WIDTH * 0.143;
    const manaHeight = WIDTH * 0.009;
    const leftX = WIDTH * 0.074;
    const rightX = WIDTH * 0.586;
    const leftMpX = WIDTH * 0.257;
    const rightMpX = WIDTH * 0.586;
    const avatarY = WIDTH * 0.09;
    const avatarSize = WIDTH * 0.074;
    for (const role of ["challenger", "opponent"]) {
      const rightSide = role === "opponent";
      const healthX = rightSide ? rightX + healthWidth : leftX;
      const healthOrigin = rightSide ? 1 : 0;
      const healthTrack = this.add.rectangle(healthX, healthY, healthWidth, healthHeight, 0x17131f, 0.94)
        .setOrigin(healthOrigin, 0.5).setDepth(1980).setScrollFactor(0);
      const healthGhost = this.add.rectangle(healthX, healthY, healthWidth, healthHeight, 0xffffff, 0.30)
        .setOrigin(healthOrigin, 0.5).setDepth(1981).setScrollFactor(0);
      const healthFill = this.add.rectangle(healthX, healthY, healthWidth, healthHeight, 0x22d35a, 1)
        .setOrigin(healthOrigin, 0.5).setDepth(1982).setScrollFactor(0);
      const manaX = rightSide ? rightMpX : leftMpX;
      const manaTrack = this.add.rectangle(manaX, manaY, manaWidth, manaHeight, 0x504657, 1)
        .setOrigin(0, 0.5).setDepth(1980).setScrollFactor(0);
      const manaFill = this.add.rectangle(manaX, manaY, manaWidth, manaHeight, 0x050505, 1)
        .setOrigin(0, 0.5).setDepth(1982).setScrollFactor(0);
      const name = this.add.text(0, healthY, "", {
        fontFamily: "system-ui, sans-serif", fontSize: "11px", fontStyle: "900",
        color: "#ffffff", stroke: "#080611", strokeThickness: 3,
        align: rightSide ? "right" : "left",
      }).setOrigin(rightSide ? 1 : 0, 0.5).setScrollFactor(0).setDepth(2011);
      const hpText = this.add.text(0, healthY, "", {
        fontFamily: "system-ui, sans-serif", fontSize: "10px", fontStyle: "800",
        color: "#ffffff", stroke: "#080611", strokeThickness: 3,
        align: rightSide ? "left" : "right",
      }).setOrigin(rightSide ? 0 : 1, 0.5).setScrollFactor(0).setDepth(2011);
      const mpText = this.add.text(0, manaY, "", {
        fontFamily: "system-ui, sans-serif", fontSize: "9px", fontStyle: "800",
        color: "#ffffff", stroke: "#080611", strokeThickness: 3,
      }).setScrollFactor(0).setDepth(2011);
      const avatarX = WIDTH * (rightSide ? 0.91 : 0.09);
      this.battleHud[role] = {
        healthTrack, healthGhost, healthFill, manaTrack, manaFill, name, hpText, mpText,
        healthWidth, healthHeight, manaWidth, manaHeight, healthY, manaY, avatarX, avatarY, avatarSize,
        avatar: null, avatarMask: null, avatarUrl: "",
        healthX: rightSide ? rightX : leftX,
        manaX, rightSide,
      };
    }
    if (this.textures.exists("health-mp-frame")) {
      this.battleHudFrame = this.add.image(0, 0, "health-mp-frame")
        .setOrigin(0, 0).setDisplaySize(WIDTH, WIDTH * (1640 / 2360))
        .setBlendMode(Phaser.BlendModes.SCREEN).setDepth(2000).setScrollFactor(0);
    }
  }

  createHudAvatar(role, textureKey) {
    const hud = this.battleHud[role];
    if (!hud) return;
    hud.avatar?.destroy();
    hud.avatarMask?.destroy();
    const avatar = this.add.image(hud.avatarX, hud.avatarY, textureKey)
      .setDisplaySize(hud.avatarSize, hud.avatarSize).setScrollFactor(0).setDepth(2005);
    const maskShape = this.make.graphics({ x: 0, y: 0, add: false });
    maskShape.fillStyle(0xffffff, 1).fillCircle(hud.avatarX, hud.avatarY, hud.avatarSize / 2);
    avatar.setMask(maskShape.createGeometryMask());
    hud.avatar = avatar;
    hud.avatarMask = maskShape;
  }

  setAvatars(avatars = {}) {
    this.avatarUrls = { ...this.avatarUrls, ...avatars };
    if (this.readyForState) this.applyHudAvatars();
  }

  applyHudAvatars() {
    for (const role of ["challenger", "opponent"]) {
      const hud = this.battleHud[role];
      if (!hud) continue;
      const url = String(this.avatarUrls[role] || "");
      if (!hud.avatar) this.createHudAvatar(role, "chog-head");
      if (!url || url === hud.avatarUrl) continue;
      hud.avatarUrl = url;
      const key = `live-discord-avatar-${role}`;
      if (this.textures.exists(key)) {
        this.createHudAvatar(role, key);
        continue;
      }
      this.load.image(key, url);
      this.load.once(`filecomplete-image-${key}`, () => {
        if (this.textures.exists(key)) this.createHudAvatar(role, key);
      });
      this.load.start();
    }
  }

  updateBattleHud() {
    for (const role of ["challenger", "opponent"]) {
      const fighter = this.fighters[role];
      const hud = this.battleHud[role];
      if (!fighter || !hud) continue;
      const hp = Math.max(0, Number(fighter.hp || 0));
      const maxHp = Math.max(1, Number(fighter.maxHp || 100));
      const hpRatio = clamp(hp / maxHp, 0, 1);
      const energy = Math.max(0, Math.round(Number(fighter.energy || 0)));
      const maxEnergy = Math.max(1, Math.round(Number(fighter.maxEnergy || 100)));
      const energyRatio = clamp(energy / maxEnergy, 0, 1);
      hud.healthFill.width = hud.healthWidth * hpRatio;
      hud.healthGhost.width = hud.healthWidth * hpRatio;
      hud.manaFill.width = hud.manaWidth * energyRatio;
      hud.name.setText(`@${fighter.username || (role === "challenger" ? "Challenger" : "Opponent")} · Chog #${fighter.tokenId || "—"}`);
      hud.hpText.setText(`HP ${Math.round(hp)}/${Math.round(maxHp)}`);
      hud.mpText.setText(`MP ${energy}%`);
      if (hud.rightSide) {
        hud.name.setPosition(hud.healthX + hud.healthWidth - WIDTH * 0.008, hud.healthY);
        hud.hpText.setPosition(hud.healthX + WIDTH * 0.008, hud.healthY);
      } else {
        hud.name.setPosition(hud.healthX + WIDTH * 0.008, hud.healthY);
        hud.hpText.setPosition(hud.healthX + hud.healthWidth - WIDTH * 0.008, hud.healthY);
      }
      hud.mpText.setPosition(hud.manaX + WIDTH * 0.008, hud.manaY);
    }
    if (this.battleHudFrame) this.battleHudFrame.setDepth(2000);
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
      hp: 100,
      maxHp: 100,
      energy: 100,
      maxEnergy: 100,
      jumpHeight: 0,
      stridePhase: role === "challenger" ? 0 : 1.7,
      strideDistance: 0,
      gaitBlend: 0,
      walkDir: 1,
      walkDirBlend: 1,
      koStartedAt: 0,
    };
  }

  setSnapshot(state, viewerRole) {
    this.latestState = state;
    this.viewerRole = viewerRole;
    this.latestProjectiles = state?.projectiles || [];
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
      const nextHp = Number(source.hp ?? 100);
      if (nextHp <= 0 && fighter.hp > 0) {
        fighter.koStartedAt = Date.now();
      } else if (nextHp > 0) {
        fighter.koStartedAt = 0;
      } else if (!fighter.koStartedAt) {
        // A player may reconnect after the KO transition already happened.
        fighter.koStartedAt = Date.now();
      }
      fighter.hp = nextHp;
      fighter.maxHp = Number(source.maxHp ?? 100);
      fighter.energy = Number(source.energy ?? 100);
      fighter.maxEnergy = Number(source.maxEnergy ?? 100);
      fighter.jumpHeight = Math.max(0, Number(source.jumpHeight || 0));

      if (fighter.flashUntil > fighter.previousFlashUntil) {
        flashChog(this, fighter.root.rig, 0xffffff, 90);
        fighter.previousFlashUntil = fighter.flashUntil;
      }
      fighter.name.setText(`${fighter.fighterName} · ${fighter.tier}`);
      fighter.dna.setText(`ATK ${fighter.attack} · DEF ${fighter.defense} · SPD ${fighter.speed}`);
      fighter.marker.setFillStyle(fighter.connected ? ACCENTS[role] : 0x777780);
    }

    this.updateBattleHud();
    const wins = state.roundWins || { challenger: 0, opponent: 0 };
    const remaining = Math.ceil(Math.max(0, Number(state.timeRemainingMs ?? 60_000)) / 1000);
    if (this.roundHudText) {
      this.roundHudText.setText(
        `ROUND ${state.round || 1}/${state.totalRounds || 3} · ${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")} · ${wins.challenger || 0}-${wins.opponent || 0}`,
      );
    }

    if (state.status === "FINISHED") {
      this.finishedTitle.setText(state.matchDraw ? "MATCH DRAW" : state.winnerRole === this.viewerRole ? "VICTORY" : "DEFEAT");
      this.finishedText.setText(state.matchDraw
        ? "Three rounds complete · score " + (wins.challenger || 0) + "-" + (wins.opponent || 0)
        : "Three rounds complete · score " + (wins.challenger || 0) + "-" + (wins.opponent || 0));
      this.finishedOverlay.setVisible(true);
    } else if (state.phase === "ROUND_OVER") {
      this.finishedTitle.setText(state.koRole ? "K.O.!" : "ROUND OVER");
      const roundWinner = state.roundWinnerRole
        ? (state.roundWinnerRole === this.viewerRole ? "You win" : "Opponent wins")
        : "Round draw";
      this.finishedText.setText(roundWinner + " · score " + (wins.challenger || 0) + "-" + (wins.opponent || 0));
      this.finishedOverlay.setVisible(true);
    } else {
      this.finishedOverlay.setVisible(false);
    }
  }

  update(_time, delta) {
    const now = Date.now();
    const blend = 1 - Math.exp(-delta / 72);
    for (const role of ["challenger", "opponent"]) {
      const fighter = this.fighters[role];
      if (!fighter) continue;
      const root = fighter.root;
      const fromX = root.x;
      const fromY = root.y;
      root.x = Phaser.Math.Linear(root.x, fighter.targetX, blend);
      root.y = Phaser.Math.Linear(root.y, fighter.targetY - fighter.jumpHeight, blend);
      root.setScale((fighter.facing < 0 ? -1 : 1) * SCALE, SCALE);
      root.setDepth(100 + root.y);
      const horizontalDelta = root.x - fromX;
      const horizontalTravel = Math.abs(horizontalDelta);
      const moved = horizontalTravel > 0.2;
      fighter.strideDistance += horizontalTravel;
      if (moved) {
        fighter.walkDir = Math.sign(horizontalDelta) * (fighter.facing < 0 ? -1 : 1) || fighter.walkDir;
      }
      fighter.walkDirBlend += (fighter.walkDir - fighter.walkDirBlend) * (1 - Math.exp(-delta / 85));
      const gaitTarget = moved ? 1 : 0;
      fighter.gaitBlend += (gaitTarget - fighter.gaitBlend) * (1 - Math.exp(-delta / 90));
      const gait = clamp(fighter.gaitBlend, 0, 1);
      // Walk cycles are distance-driven, not clock-driven. A phase shift swaps
      // the leading foot for backsteps while the hands remain tight to the chin.
      const u = (fighter.strideDistance / 56) % 1;
      const directionPhase = (u * Math.PI * 2) + fighter.stridePhase
        + ((1 - fighter.walkDirBlend) / 2) * Math.PI;
      const stride = Math.sin(directionPhase);
      const leadLift = Math.max(0, Math.cos(directionPhase)) ** 2 * gait;
      const rearLift = Math.max(0, -Math.cos(directionPhase)) ** 2 * gait;
      const bodyBob = 0.5 - Math.cos(2 * directionPhase) * 0.5;
      const idlePhase = now * 0.002 + fighter.stridePhase;
      const idleWave = Math.sin(idlePhase) * (1 - gait);
      const guard = {
        ...GUARD,
        ...chogArmTargetPose("guard"),
        leadArmRotation: GUARD.leadArmRotation + stride * 0.025 * gait + idleWave * 0.006,
        rearArmRotation: GUARD.rearArmRotation - stride * 0.025 * gait - idleWave * 0.006,
        leadArmLowerRotation: GUARD.leadArmLowerRotation + stride * 0.012 * gait,
        rearArmLowerRotation: GUARD.rearArmLowerRotation - stride * 0.012 * gait,
        leadArmY: -leadLift * 0.8,
        rearArmY: -rearLift * 0.8,
        leadLegRotation: GUARD.leadLegRotation - stride * 0.34 * gait,
        rearLegRotation: GUARD.rearLegRotation + stride * 0.34 * gait,
        leadLegLowerRotation: GUARD.leadLegLowerRotation + leadLift * 0.35,
        rearLegLowerRotation: GUARD.rearLegLowerRotation + rearLift * 0.35,
        leadLegY: -leadLift * 4,
        rearLegY: -rearLift * 4 - (fighter.walkDirBlend < 0 ? gait : 0),
        torsoRotation: -0.03 * fighter.walkDirBlend + Math.sin(idlePhase) * 0.006 * (1 - gait),
        torsoX: stride * gait,
        torsoY: -bodyBob * 2 * gait - Math.max(0, Math.sin(idlePhase)) * 0.4 * (1 - gait),
        headRotation: stride * 0.01 * gait,
      };
      const boxerGuard = { ...guard, ...chogArmTargetPose("guard") };
      const guardTargets = chogArmTargetPose("guard");
      let pose = gait > 0.02 ? guard : boxerGuard;
      const actionAge = now - fighter.actionStartedAt;
      const duration = Math.max(1, fighter.actionUntil - fighter.actionStartedAt);
      const activeAction = actionAge >= 0 && actionAge < duration;
      if (fighter.hp <= 0) {
        const koAge = Math.max(0, now - (fighter.koStartedAt || now));
        // Match the solo fall arc; knockout state itself is still server-owned.
        pose = createChogKnockoutPose(boxerGuard, koAge);
      } else if (fighter.action === "jump" && activeAction) {
        const p = clamp(actionAge / duration, 0, 1);
        const launch = {
          ...guard,
          leadLegRotation: 0.0,
          leadLegLowerRotation: 0.05,
          rearLegRotation: -0.45,
          rearLegLowerRotation: 0.35,
          leadLegY: 2,
          rearLegY: 2,
          torsoY: -2,
        };
        const tuck = {
          ...guard,
          leadLegRotation: -0.8,
          leadLegLowerRotation: 1.66,
          rearLegRotation: -1.1,
          rearLegLowerRotation: 1.02,
          leadLegY: -4,
          rearLegY: -3,
          torsoRotation: -0.02,
          torsoY: -3,
        };
        const reach = { ...guard, torsoY: -2 };
        if (p < 0.2) pose = blendPose(launch, tuck, p / 0.2);
        else if (p <= 0.55) {
          const armFloat = Math.sin(now * 0.006) * 0.012;
          pose = { ...tuck, leadArmRotation: tuck.leadArmRotation + armFloat, rearArmRotation: tuck.rearArmRotation - armFloat };
        } else {
          pose = blendPose(tuck, reach, (p - 0.55) / 0.45);
        }
      } else if ((fighter.action === "attack" || fighter.action === "base" || fighter.action === "special") && activeAction) {
        const phase = clamp(actionAge / duration, 0, 1);
        const heavy = fighter.action === "special" || fighter.action === "base";
        const startupRatio = fighter.action === "special" ? 0.60 : 0.50;
        // Heavy attacks visibly load back first, then release, then recover.
        // The server can cancel this wind-up before the projectile is released.
        const pulse = !heavy
          ? punchPulse(phase)
          : phase < startupRatio
            ? -Math.sin((phase / startupRatio) * Math.PI / 2) * 0.24
            : phase < 0.80
              ? Math.sin(Math.PI * ((phase - startupRatio) / (0.80 - startupRatio)))
              : 0;
        const attackTargets = chogArmTargetPose("jab");
        pose = {
          ...guard,
          ...blendPose(guardTargets, attackTargets, pulse),
          leadLegRotation: GUARD.leadLegRotation - pulse * (heavy ? 0.10 : 0.12),
          rearLegRotation: GUARD.rearLegRotation + pulse * (heavy ? 0.12 : 0.08),
          leadLegLowerRotation: GUARD.leadLegLowerRotation + pulse * 0.12,
          rearLegLowerRotation: GUARD.rearLegLowerRotation - pulse * 0.08,
          leadLegX: pulse * 7,
          rearLegX: -pulse * 3,
          torsoRotation: -pulse * (heavy ? 0.13 : 0.12),
          torsoX: pulse * (heavy ? 7 : 8),
          torsoY: -pulse * (heavy ? 3 : 1.4),
          headRotation: -pulse * 0.025,
        };
      } else if (fighter.action === "doubleAttack" && activeAction) {
        const t = clamp(actionAge / duration, 0, 1);
        const jabPulse = punchWindowPulse(t, 0, 0.25);
        const crossPulse = punchWindowPulse(t, 0.44, 0.80);
        const jabTargets = blendPose(guardTargets, chogArmTargetPose("jab"), jabPulse);
        const crossTargets = blendPose(guardTargets, chogArmTargetPose("cross"), crossPulse);
        const comboTargets = crossPulse > 0 ? crossTargets : jabTargets;
        pose = {
          ...guard,
          ...comboTargets,
          leadLegRotation: GUARD.leadLegRotation - jabPulse * 0.12 - crossPulse * 0.10,
          rearLegRotation: GUARD.rearLegRotation + jabPulse * 0.08 + crossPulse * 0.16,
          leadLegLowerRotation: GUARD.leadLegLowerRotation + jabPulse * 0.12,
          rearLegLowerRotation: GUARD.rearLegLowerRotation - crossPulse * 0.15,
          leadLegX: jabPulse * 8,
          rearLegX: crossPulse * 6 - jabPulse * 3,
          torsoRotation: -jabPulse * 0.12 - crossPulse * 0.22,
          torsoX: jabPulse * 8 + crossPulse * 13,
          torsoY: -jabPulse * 1.4 - crossPulse * 2,
          headRotation: -jabPulse * 0.03 - crossPulse * 0.04,
        };
      } else if ((fighter.action === "block" || fighter.action === "defense") && activeAction) {
        pose = { ...boxerGuard, ...chogArmTargetPose("block") };
      } else if (fighter.action === "dash" && activeAction) {
        const pulse = Math.sin(Math.PI * clamp(actionAge / duration, 0, 1));
        pose = {
          ...guard,
          leadArmRotation: GUARD.leadArmRotation - pulse * 0.12,
          rearArmRotation: GUARD.rearArmRotation - pulse * 0.06,
          leadArmLowerRotation: GUARD.leadArmLowerRotation - pulse * 0.08,
          rearArmLowerRotation: GUARD.rearArmLowerRotation - pulse * 0.08,
          torsoRotation: -pulse * 0.11,
          torsoX: pulse * 7,
          torsoY: pulse * 3,
          leadLegRotation: GUARD.leadLegRotation - pulse * 0.16,
          rearLegRotation: GUARD.rearLegRotation + pulse * 0.18,
          leadLegLowerRotation: GUARD.leadLegLowerRotation + pulse * 0.35,
          rearLegLowerRotation: GUARD.rearLegLowerRotation - pulse * 0.30,
        };
      }
      if (fighter.flashUntil > now) {
        const react = Math.max(0, Math.sin(Math.PI * clamp((fighter.flashUntil - now) / 230, 0, 1)));
        const currentTargets = Object.fromEntries(Object.keys(guardTargets).map((key) => [
          key,
          pose[key] ?? guardTargets[key],
        ]));
        pose = {
          ...pose,
          ...blendPose(currentTargets, chogArmTargetPose("hit"), react),
          leadLegRotation: pose.leadLegRotation - 0.06 * react,
          rearLegRotation: pose.rearLegRotation + 0.08 * react,
          torsoRotation: pose.torsoRotation + 0.11 * react,
          headRotation: pose.headRotation - 0.045 * react,
          torsoX: (pose.torsoX || 0) - 2 * react,
          torsoY: (pose.torsoY || 0) + 1.2 * react,
        };
      }
      applyChogPose(root.rig, pose);
      const knockedOut = fighter.hp <= 0;
      root.setVisible(!knockedOut);
      if (knockedOut) {
        const deadSize = 260;
        if (!fighter.deadVisual) {
          fighter.deadVisual = this.add.image(root.x, root.y, "dead-chog")
            .setDisplaySize(deadSize, deadSize).setVisible(false);
        }
        fighter.deadVisual.setVisible(true).setDisplaySize(deadSize, deadSize)
          .setPosition(root.x - deadSize * 0.08, HEIGHT * 0.76 - deadSize * 0.36)
          .setDepth(100 + root.y + 1);
      } else if (fighter.deadVisual) {
        fighter.deadVisual.setVisible(false);
      }
      fighter.name.setPosition(root.x, root.y - 105);
      fighter.dna.setPosition(root.x, root.y - 85);
      fighter.marker.setPosition(root.x, root.y - 66);
    }

    const activeIds = new Set();
    for (const projectile of this.latestProjectiles) {
      activeIds.add(projectile.id);
      let visual = this.projectileVisuals.get(projectile.id);
      if (!visual) {
        const color = projectile.slot === "special" ? 0xffc94a
          : projectile.ownerRole === "challenger" ? ACCENTS.challenger : ACCENTS.opponent;
        visual = this.add.container(projectile.x, projectile.y).setDepth(650);
        visual.add(this.add.circle(0, 0, Math.max(9, projectile.radius || 11), color, 0.28).setStrokeStyle(2, color, 0.95));
        visual.add(this.add.circle(0, 0, 4, 0xffffff, 0.95));
        visual.add(this.add.ellipse(-8, 0, 15, 4, color, 0.8));
        this.projectileVisuals.set(projectile.id, visual);
      }
      visual.setPosition(projectile.x, projectile.y);
    }
    for (const [id, visual] of this.projectileVisuals) {
      if (activeIds.has(id)) continue;
      visual.destroy();
      this.projectileVisuals.delete(id);
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
    setAvatars(avatars) {
      const scene = game.scene.getScene("LiveArenaScene");
      if (scene) scene.setAvatars(avatars);
    },
    destroy() {
      game.destroy(true);
    },
  };
}
