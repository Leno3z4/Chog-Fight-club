// Website-only Battle DNA preview. Final combat calculations remain on the separate game-engine branch.
const TIER_BONUS = { Common: 0, Uncommon: 2, Rare: 4, Epic: 6, Legendary: 8 };

function pickAbility(metadata) {
  const signal = `${metadata?.Aura ?? ""} ${metadata?.Background ?? ""} ${metadata?.Skin ?? ""}`.toLowerCase();
  if (/fire|flame|ember|red/.test(signal)) return "Ember Strike";
  if (/water|aqua|blue|ice/.test(signal)) return "Pressure Wave";
  if (/electric|shock|lightning|yellow/.test(signal)) return "Static Snap";
  if (/shadow|smoke|dark|purple/.test(signal)) return "Shadow Feint";
  if (/green|nature|leaf/.test(signal)) return "Thorn Rush";
  return "Focused Strike";
}

export function buildRosterPreview(metadata = {}) {
  const tierBonus = TIER_BONUS[metadata.Tier] ?? 0;
  const stats = {
    hp: 100 + tierBonus * 2,
    attack: 20 + tierBonus,
    defense: 14 + tierBonus,
    speed: 14 + Math.floor(tierBonus / 2),
    accuracy: 90,
    energy: 3,
  };
  if (metadata.Body === "Toad") stats.hp += 8;
  if (metadata.Body === "Tuxedo" || metadata.Body === "White tuxedo") stats.defense += 3;
  if (metadata.Eyes === "Angry") stats.attack += 3;
  if (metadata.Eyes === "Happy") stats.accuracy += 3;
  if (metadata.Skin === "Red") stats.attack += 2;
  if (metadata.Skin === "Blue") stats.defense += 2;
  if (metadata.Skin === "Green") stats.hp += 3;
  if (metadata.Skin === "Pink") stats.speed += 1;

  return {
    stats,
    abilitySet: {
      base: { name: pickAbility(metadata) },
      special: { name: tierBonus >= 6 ? "Signature Burst" : "Trait Surge" },
    },
  };
}
