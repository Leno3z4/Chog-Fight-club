import { buildAbilitySet, TIERS } from "./abilities.js";
import { resolveTraitGroups } from "./traitGroups.js";

const BASE_STATS = {
  hp: 100,
  attack: 20,
  defense: 14,
  speed: 14,
  accuracy: 90,
  energy: 3,
};

const BODY_MODIFIERS = {
  Toad: { hp: 8 },
  Tuxedo: { defense: 3 },
  "White tuxedo": { defense: 3 },
  Boner: { hp: 5 },
};

const EYE_MODIFIERS = {
  Angry: { attack: 3 },
  Happy: { accuracy: 3 },
  Round: { accuracy: 2 },
  "Red Round Eye": { attack: 2 },
  "Green laser": { accuracy: 4 },
  "cyan laser": { accuracy: 4 },
};

const SKIN_MODIFIERS = {
  Yellow: { attack: 1 },
  Red: { attack: 2 },
  Blue: { defense: 2 },
  Green: { hp: 3 },
  Purple: { energy: 1 },
  Pink: { speed: 1 },
};

const TIER_STAT_BONUS = {
  Common: 0,
  Uncommon: 2,
  Rare: 4,
  Epic: 6,
  Legendary: 8,
};

function normalizedMetadata(metadata) {
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .sort(([a], [b]) => a.localeCompare(b))
  );
}

// Small deterministic integer hash. Browser-safe and sufficient for bounded
// variation; the normalized metadata itself remains the source of identity.
function deterministicNumber(metadata, salt) {
  const input = `${JSON.stringify(normalizedMetadata(metadata))}:${salt}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function applyModifier(stats, modifier = {}) {
  for (const [key, value] of Object.entries(modifier)) {
    if (key in stats) stats[key] += value;
  }
}

export function buildBattleDNA(metadata) {
  const normalized = normalizedMetadata(metadata);
  const groups = resolveTraitGroups(normalized);
  const stats = { ...BASE_STATS };
  const tierBonus = TIER_STAT_BONUS[normalized.Tier] ?? 0;

  stats.hp += tierBonus * 2;
  stats.attack += tierBonus;
  stats.defense += tierBonus;
  stats.speed += Math.floor(tierBonus / 2);

  applyModifier(stats, BODY_MODIFIERS[normalized.Body]);
  applyModifier(stats, EYE_MODIFIERS[normalized.Eyes]);
  applyModifier(stats, SKIN_MODIFIERS[normalized.Skin]);

  const variation = deterministicNumber(normalized, "battle-variation");
  stats.speed += variation % 2;
  stats.accuracy += variation % 3 === 0 ? 2 : 0;

  const abilitySet = buildAbilitySet(normalized);
  const tier = TIERS[normalized.Tier] ?? TIERS.Common;

  return {
    version: 1,
    identity: {
      tokenId: normalized.tokenId ?? normalized.token_id ?? null,
      name: normalized.name ?? null,
      tier: normalized.Tier ?? "Common",
    },
    traits: normalized,
    groups,
    stats,
    abilitySet,
    ceilings: {
      powerMultiplier: tier.power,
      complexity: tier.complexity,
    },
    seed: deterministicNumber(normalized, "battle-seed").toString(16),
  };
}
