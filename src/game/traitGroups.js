// Combat-facing interpretation of Chog metadata.
// These are game-design mappings built from the supplied Chog Genesis metadata,
// not properties claimed by the NFT collection itself.

export const AURA_GROUPS = {
  flame: ["Burning Aura", "Fiery Aura", "Fire"],
  water: ["Aqua Aura", "Cool Aura"],
  wind: ["Wind"],
  electric: ["Electric Shock"],
  nature: ["Green Aura", "Mint", "Rose Scent"],
  royal: ["Royal Aura", "Royal Blue Aura", "Royal Blue", "White Aura"],
  arcane: ["Purple", "Light Purple", "Violet", "Pink Mist", "Rose Aura"],
  shadow: ["Smoke", "Clean", "Yellow Aura"],
};

// The source metadata contains 32 named backgrounds. We turn their visual/theme
// identity into a combat expression so Background affects how an Aura behaves,
// rather than becoming another raw damage element.
export const BACKGROUND_GROUPS = {
  burst: [
    "Blood Red", "Afternoon Orange", "Lemon Yellow", "Bright Yellow", "Gold",
  ],
  control: [
    "Aqua", "Deep Aqua", "Sky Blue", "Aqua Blue", "Deep Blue", "Noble Blue",
  ],
  sustain: [
    "Fresh Green", "Lime Green", "Mint", "Aqua Mint",
  ],
  mobility: [
    "Light Purple", "Soft Lavender", "Rosie", "Rose Pink", "Light Magenta",
  ],
  defense: [
    "Coral Pink", "Peach Pink", "Rosy Pink", "Lemon", "Sunlight",
  ],
  disruption: [
    "Radioactive", "Deep Purple", "Magenta", "Supreme Purple", "Mon",
  ],
};

export const ARCHETYPE_GROUPS = {
  origin: ["Origin", "Chog"],
  skull: ["Skull"],
};

// Aura answers WHAT kind of power the Chog expresses.
// Background answers HOW that power is expressed.
// This matrix is deliberately behavior-first: the same Aura can produce a
// different matchup pattern depending on its Background.
export const AURA_BACKGROUND_MATRIX = {
  flame: {
    burst: "ignition",
    control: "scorch-field",
    sustain: "heated-recovery",
    mobility: "afterburn",
    defense: "heat-guard",
    disruption: "flashpoint",
  },
  water: {
    burst: "pressure-wave",
    control: "tidal-bind",
    sustain: "renewal-current",
    mobility: "flow-step",
    defense: "mist-guard",
    disruption: "undertow",
  },
  wind: {
    burst: "razor-gale",
    control: "crosswind",
    sustain: "tailwind",
    mobility: "gale-step",
    defense: "wind-screen",
    disruption: "vacuum-cut",
  },
  electric: {
    burst: "arc-strike",
    control: "static-field",
    sustain: "charge-cycle",
    mobility: "flash-step",
    defense: "current-shield",
    disruption: "overload",
  },
  nature: {
    burst: "thorn-burst",
    control: "root-snare",
    sustain: "verdant-pulse",
    mobility: "vine-step",
    defense: "bark-guard",
    disruption: "spore-lock",
  },
  royal: {
    burst: "regal-command",
    control: "edict-bind",
    sustain: "royal-restoration",
    mobility: "sovereign-step",
    defense: "royal-aegis",
    disruption: "decree-break",
  },
  arcane: {
    burst: "prism-lance",
    control: "arcane-fold",
    sustain: "mana-weave",
    mobility: "phase-shift",
    defense: "prism-ward",
    disruption: "spellbreak",
  },
  shadow: {
    burst: "smoke-burst",
    control: "hollow-bind",
    sustain: "shade-recovery",
    mobility: "smoke-step",
    defense: "smoke-screen",
    disruption: "hollow-mark",
  },
  neutral: {
    burst: "focused-strike",
    control: "steady-pressure",
    sustain: "second-wind",
    mobility: "quick-step",
    defense: "steady-guard",
    disruption: "interrupt",
  },
};

export function findGroup(value, groups) {
  if (!value) return "neutral";
  for (const [group, values] of Object.entries(groups)) {
    if (values.includes(value)) return group;
  }
  return "neutral";
}

export function resolveTraitGroups(metadata) {
  const auraFamily = findGroup(metadata.Aura, AURA_GROUPS);
  const backgroundStyle = findGroup(metadata.Background, BACKGROUND_GROUPS);

  return {
    auraFamily,
    backgroundStyle,
    archetype: findGroup(metadata.Form ?? metadata.Base, ARCHETYPE_GROUPS),
    expression:
      AURA_BACKGROUND_MATRIX[auraFamily]?.[backgroundStyle]
      ?? AURA_BACKGROUND_MATRIX.neutral[backgroundStyle]
      ?? "focused-strike",
  };
}
