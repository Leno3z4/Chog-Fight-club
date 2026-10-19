const AURA_PALETTE = {
  flame: { color: 0xff713f, accent: 0xffd166 },
  water: { color: 0x37bfe8, accent: 0xc4f4ff },
  wind: { color: 0x57d7bf, accent: 0xd9fff7 },
  electric: { color: 0xf1ce37, accent: 0xffffff },
  nature: { color: 0x69c66f, accent: 0xcfffaa },
  royal: { color: 0xe5b84f, accent: 0xffefb4 },
  radiant: { color: 0xf1d45f, accent: 0xffffff },
  arcane: { color: 0xa98af0, accent: 0xe4d9ff },
  shadow: { color: 0x896bc9, accent: 0xd0bdff },
  neutral: { color: 0x68cfe2, accent: 0xe6fbff },
};

const EFFECT_SHAPE = {
  burst: "burst",
  control: "wave",
  sustain: "orbit",
  mobility: "dash",
  defense: "ward",
  disruption: "glyph",
  counter: "reversal",
  balanced: "burst",
};

const SLOT_NAME = {
  basic: "Basic Attack",
  base: "Base Ability",
  special: "Special Ability",
  defense: "Defense Ability",
};

export function getAttackPresentation({ slot = "basic", ability = null, auraFamily = "neutral" } = {}) {
  const family = ability?.auraFamily ?? auraFamily;
  const palette = AURA_PALETTE[family] ?? AURA_PALETTE.neutral;
  const type = ability?.type ?? "burst";
  const scale = slot === "special" ? 1.55 : slot === "base" ? 1 : slot === "defense" ? 0.9 : 0.62;
  const hasAuraVfx = slot !== "basic";

  return {
    abilityId: ability?.id ?? null,
    name: ability?.name ?? SLOT_NAME[slot] ?? "Fighter Move",
    family: AURA_PALETTE[family] ? family : "neutral",
    type,
    shape: EFFECT_SHAPE[type] ?? "burst",
    color: palette.color,
    accent: palette.accent,
    scale,
    hasAuraVfx,
    particleCount: slot === "special" ? 12 : slot === "base" ? 8 : 0,
  };
}

export function getAttackCue({ slot = "basic", ability = null, auraFamily = "neutral", canBeEvaded = true } = {}) {
  const { name } = getAttackPresentation({ slot, ability, auraFamily });
  const response = canBeEvaded === false ? "DEFEND" : "JUMP OR DEFEND";
  return `${name.toUpperCase()}: ${response}`;
}
