import { jump as engineJump } from "./combatEngine.js";
import combatData from "./data/combat.json";
import { CharacterState } from "./stateMachine.js";

export const CHARACTER_STATES = {
  IDLE: "idle",
  WALK: "walk",
  JUMP: "jump",
  ATTACK_STARTUP: "attack-startup",
  ATTACK_ACTIVE: "attack-active",
  ATTACK_RECOVERY: "attack-recovery",
  HITSTUN: "hitstun",
};

class IdleState extends CharacterState {
  update(character) {
    if (character.hitstunRemaining > 0) return;
    if (character.input.right || character.input.left) character.stateMachine.change(CHARACTER_STATES.WALK);
  }
}

class WalkState extends CharacterState {
  update(character) {
    if (character.hitstunRemaining > 0) return;
    if (!character.input.right && !character.input.left) character.stateMachine.change(CHARACTER_STATES.IDLE);
  }
}

class JumpState extends CharacterState {
  enter(character) {
    engineJump(character.combatant);
    character.scene.player.setVelocityY(combatData.movement.jumpVelocity);
    character.scene.showStatus("JUMP — EVADE WINDOW");
    character.scene.createDust(character.scene.player.x, character.scene.FLOOR_Y - 3);
  }

  update(character) {
    const grounded = character.scene.player.body.blocked.down || character.scene.player.body.touching.down;
    if (grounded && character.scene.player.body.velocity.y >= 0) {
      character.combatant.airborne = false;
      character.stateMachine.change(character.input.left || character.input.right ? CHARACTER_STATES.WALK : CHARACTER_STATES.IDLE);
    }
  }
}

class AttackStartupState extends CharacterState {
  enter(character, payload) {
    character.attack = payload.attack;
    character.attack.elapsed = 0;
    character.scene.showStatus(payload.attack.slot === "basic" ? "BASIC — WIND UP" : `${payload.attack.slot.toUpperCase()} — WIND UP`);
    character.scene.tweens.add({
      targets: character.scene.playerVisual,
      scaleX: 1.08 * payload.attack.facing,
      scaleY: 0.94,
      duration: payload.attack.timing.startup,
      ease: "Quad.easeOut",
    });
  }

  update(character, delta) {
    character.attack.elapsed += delta;
    if (character.attack.elapsed >= character.attack.timing.startup) character.stateMachine.change(CHARACTER_STATES.ATTACK_ACTIVE);
  }
}

class AttackActiveState extends CharacterState {
  enter(character) {
    character.attack.elapsed = 0;
    character.attack.hitbox = character.scene.createAttackHitbox(character.attack.facing, character.attack.slot);
    character.scene.flashAttackTelegraph(character.attack.facing);
    character.scene.showStatus("ACTIVE — HITBOX LIVE");
  }

  update(character, delta) {
    character.attack.elapsed += delta;
    character.scene.checkPlayerHit(character.attack);
    if (character.attack.elapsed >= character.attack.timing.active) character.stateMachine.change(CHARACTER_STATES.ATTACK_RECOVERY);
  }

  exit(character) {
    if (character.attack?.hitbox) character.attack.hitbox.destroy();
    if (character.attack) character.attack.hitbox = null;
  }
}

class AttackRecoveryState extends CharacterState {
  enter(character) {
    character.attack.elapsed = 0;
  }

  update(character, delta) {
    character.attack.elapsed += delta;
    if (character.attack.elapsed >= character.attack.timing.recovery) {
      character.attack = null;
      character.attackCooldown = 0;
      character.scene.playerVisual.scaleY = 1;
      character.stateMachine.change(character.input.left || character.input.right ? CHARACTER_STATES.WALK : CHARACTER_STATES.IDLE);
    }
  }
}

class HitstunState extends CharacterState {
  enter(character) {
    character.hitstunRemaining = combatData.timing.hitstunMs;
  }

  update(character, delta) {
    character.hitstunRemaining = Math.max(0, character.hitstunRemaining - delta);
    if (character.hitstunRemaining === 0) character.stateMachine.change(character.input.left || character.input.right ? CHARACTER_STATES.WALK : CHARACTER_STATES.IDLE);
  }
}

export function createCharacterStates(character) {
  return character.stateMachine
    .add(CHARACTER_STATES.IDLE, new IdleState())
    .add(CHARACTER_STATES.WALK, new WalkState())
    .add(CHARACTER_STATES.JUMP, new JumpState())
    .add(CHARACTER_STATES.ATTACK_STARTUP, new AttackStartupState())
    .add(CHARACTER_STATES.ATTACK_ACTIVE, new AttackActiveState())
    .add(CHARACTER_STATES.ATTACK_RECOVERY, new AttackRecoveryState())
    .add(CHARACTER_STATES.HITSTUN, new HitstunState());
}
