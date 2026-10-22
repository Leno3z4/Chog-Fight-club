import fightTrackUrl from "../../music/fight.wav";
import bossFightTrackUrl from "../../music/bossfight_.mp3";
import { chooseBattleMusicMode } from "./battleMusicState.js";

let battleAudio = null;
let activeMode = null;
let battleActive = false;
let playWasBlocked = false;
let unlockHandler = null;

function removeUnlockHandler() {
  if (!unlockHandler || typeof window === "undefined") return;
  window.removeEventListener("pointerdown", unlockHandler);
  window.removeEventListener("keydown", unlockHandler);
  unlockHandler = null;
}

function installUnlockHandler() {
  if (unlockHandler || typeof window === "undefined") return;
  unlockHandler = () => {
    removeUnlockHandler();
    if (!battleActive || !battleAudio) return;
    playWasBlocked = false;
    attemptPlayback();
  };
  window.addEventListener("pointerdown", unlockHandler, { once: true });
  window.addEventListener("keydown", unlockHandler, { once: true });
}

function attemptPlayback() {
  if (!battleActive || !battleAudio || !battleAudio.paused || playWasBlocked) return;
  try {
    const playback = battleAudio.play();
    if (playback && typeof playback.then === "function") {
      playback.then(() => {
        playWasBlocked = false;
        removeUnlockHandler();
      }).catch(() => {
        playWasBlocked = true;
        installUnlockHandler();
      });
    }
  } catch {
    playWasBlocked = true;
    installUnlockHandler();
  }
}

export function syncBattleMusic(matchState = {}) {
  const mode = chooseBattleMusicMode(matchState);
  if (mode === "stop") {
    stopBattleMusic();
    return mode;
  }

  battleActive = true;
  if (battleAudio && activeMode === mode) {
    attemptPlayback();
    return mode;
  }

  if (battleAudio) {
    battleAudio.pause();
    battleAudio.removeAttribute("src");
    battleAudio.load();
  }

  const url = mode === "bossfight" ? bossFightTrackUrl : fightTrackUrl;
  battleAudio = new Audio(url);
  battleAudio.loop = true;
  battleAudio.preload = "auto";
  battleAudio.volume = 0.32;
  activeMode = mode;
  playWasBlocked = false;
  attemptPlayback();
  return mode;
}

export function stopBattleMusic() {
  battleActive = false;
  playWasBlocked = false;
  removeUnlockHandler();
  if (battleAudio) {
    battleAudio.pause();
    battleAudio.currentTime = 0;
    battleAudio.removeAttribute("src");
    battleAudio.load();
  }
  battleAudio = null;
  activeMode = null;
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", stopBattleMusic);
}
