// Combat-facing interpretation of the supplied Chog Genesis metadata.
// These are game-design mappings, not properties claimed by the NFT collection.
// The source contains 22 Aura values and 32 Background values across 1,969 NFTs.

export const AURA_GROUPS = {
  flame: ["Burning Aura", "Fiery Aura", "Fire"],
  water: ["Aqua Aura", "Cool Aura"],
  wind: ["Wind"],
  electric: ["Electric Shock"],
  nature: ["Green Aura", "Mint", "Rose Scent"],
  royal: ["Royal Aura", "Royal Blue Aura", "Royal Blue"],
  radiant: ["Clean", "White Aura", "Yellow Aura"],
  arcane: ["Purple", "Light Purple", "Violet", "Pink Mist", "Rose Aura"],
  shadow: ["Smoke"],
};

// Background is deliberately a behavior modifier rather than a second element.
// These groups cover every Background value present in the supplied collection.
export const BACKGROUND_GROUPS = {
  burst: [
    "Blood Red", "Red Sky", "Afternoon Orange", "Lemon Yellow", "Bright Yellow", "Gold",
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
  radioactive: ["Radioactive"],
  special: ["1:1"],
};

// Aura answers WHAT kind of power the Chog expresses.
// Background answers HOW that power behaves.
// The matrix produces a stable combat-expression key; abilities can then be
// authored around that key without hard-coding a unique ability for every NFT.
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
  radiant: {
    burst: "radiant-flare",
    control: "purifying-bind",
    sustain: "cleanse-pulse",
    mobility: "light-step",
    defense: "radiant-ward",
    disruption: "reveal-mark",
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
  const archetype = findGroup(metadata.Form ?? metadata.Base, ARCHETYPE_GROUPS);

  return {
    auraFamily,
    backgroundStyle,
    archetype,
    expression:
      AURA_BACKGROUND_MATRIX[auraFamily]?.[backgroundStyle]
      ?? AURA_BACKGROUND_MATRIX.neutral[backgroundStyle]
      ?? "focused-strike",
  };
}
