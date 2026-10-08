// Combat-facing interpretation of Chog metadata.
// These are game design mappings, not properties claimed by the NFT collection.

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

// Backgrounds are grouped by combat expression rather than treated as elements.
// Common backgrounds intentionally have broad, readable roles; rare backgrounds can
// later become special-case synergies without changing the resolver architecture.
export const BACKGROUND_GROUPS = {
  burst: ["Blood Red", "Afternoon Orange", "Lemon Yellow", "Bright Yellow", "Gold"],
  control: ["Aqua", "Deep Aqua", "Sky Blue", "Aqua Blue", "Deep Blue", "Noble Blue"],
  sustain: ["Fresh Green", "Lime Green", "Mint", "Aqua Mint", "Green"],
  mobility: ["Light Purple", "Soft Lavender", "Rosie", "Rose Pink", "Light Magenta"],
  defense: ["Coral Pink", "Peach Pink", "Rosy Pink", "Lemon", "Sunlight"],
  disruption: ["Radioactive", "Deep Purple", "Magenta", "Supreme Purple", "Mon"],
};

export const ARCHETYPE_GROUPS = {
  origin: ["Origin", "Chog"],
  skull: ["Skull"],
};

export function findGroup(value, groups) {
  if (!value) return "neutral";
  for (const [group, values] of Object.entries(groups)) {
    if (values.includes(value)) return group;
  }
  return "neutral";
}

export function resolveTraitGroups(metadata) {
  return {
    auraFamily: findGroup(metadata.Aura, AURA_GROUPS),
    backgroundStyle: findGroup(metadata.Background, BACKGROUND_GROUPS),
    archetype: findGroup(metadata.Form ?? metadata.Base, ARCHETYPE_GROUPS),
  };
}
