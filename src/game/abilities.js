import { resolveTraitGroups } from "./traitGroups.js";

export const TIERS = {
  Common: { power: 1, slots: 2, complexity: 1 },
  Uncommon: { power: 1.12, slots: 2, complexity: 2 },
  Rare: { power: 1.25, slots: 3, complexity: 3 },
  Epic: { power: 1.4, slots: 3, complexity: 4 },
  Legendary: { power: 1.6, slots: 3, complexity: 5 },
};

const POWER_FAMILIES = {
  flame: {
    style: "burst",
    abilities: [
      { id: "ember-burst", name: "Ember Burst", type: "burst", cost: 2, power: 18, status: "burn" },
      { id: "heat-guard", name: "Heat Guard", type: "counter", cost: 2, power: 10, status: "burn" },
    ],
  },
  water: {
    style: "control",
    abilities: [
      { id: "tidal-bind", name: "Tidal Bind", type: "control", cost: 2, power: 10, status: "slow" },
      { id: "cooling-current", name: "Cooling Current", type: "sustain", cost: 2, power: 14, status: "shield" },
    ],
  },
  wind: {
    style: "mobility",
    abilities: [
      { id: "gale-step", name: "Gale Step", type: "mobility", cost: 1, power: 9, status: "evade" },
      { id: "crosswind", name: "Crosswind", type: "disruption", cost: 2, power: 14, status: "stagger" },
    ],
  },
  electric: {
    style: "burst",
    abilities: [
      { id: "arc-strike", name: "Arc Strike", type: "burst", cost: 2, power: 20, status: "stun" },
      { id: "static-field", name: "Static Field", type: "control", cost: 3, power: 12, status: "stun" },
    ],
  },
  nature: {
    style: "sustain",
    abilities: [
      { id: "verdant-pulse", name: "Verdant Pulse", type: "sustain", cost: 2, power: 16, status: "heal" },
      { id: "root-snare", name: "Root Snare", type: "control", cost: 2, power: 11, status: "slow" },
    ],
  },
  royal: {
    style: "defense",
    abilities: [
      { id: "royal-aegis", name: "Royal Aegis", type: "defense", cost: 2, power: 0, status: "shield" },
      { id: "regal-reversal", name: "Regal Reversal", type: "counter", cost: 3, power: 18, status: "counter" },
    ],
  },
  arcane: {
    style: "disruption",
    abilities: [
      { id: "arcane-fold", name: "Arcane Fold", type: "disruption", cost: 2, power: 12, status: "silence" },
      { id: "prism-lance", name: "Prism Lance", type: "burst", cost: 3, power: 23, status: null },
    ],
  },
  shadow: {
    style: "disruption",
    abilities: [
      { id: "smoke-step", name: "Smoke Step", type: "mobility", cost: 1, power: 8, status: "evade" },
      { id: "hollow-mark", name: "Hollow Mark", type: "disruption", cost: 2, power: 13, status: "weaken" },
    ],
  },
  neutral: {
    style: "balanced",
    abilities: [
      { id: "focused-strike", name: "Focused Strike", type: "burst", cost: 2, power: 15, status: null },
      { id: "steady-guard", name: "Steady Guard", type: "defense", cost: 2, power: 0, status: "shield" },
    ],
  },
};

const STYLE_MODIFIERS = {
  burst: { burst: 1.12, control: 0.92 },
  control: { control: 1.12, mobility: 0.9 },
  sustain: { sustain: 1.1, defense: 1.05 },
  mobility: { mobility: 1.12, burst: 0.94 },
  defense: { defense: 1.12, burst: 0.9 },
  disruption: { disruption: 1.12, sustain: 0.9 },
  balanced: {},
};

export function buildAbilitySet(metadata) {
  const groups = resolveTraitGroups(metadata);
  const tier = TIERS[metadata.Tier] ?? TIERS.Common;
  const family = POWER_FAMILIES[groups.auraFamily] ?? POWER_FAMILIES.neutral;
  const backgroundMultiplier = STYLE_MODIFIERS[groups.backgroundStyle] ?? {};

  const abilities = family.abilities.map((ability) => {
    const styleMultiplier = backgroundMultiplier[ability.type] ?? 1;
    return {
      ...ability,
      power: Math.round(ability.power * tier.power * styleMultiplier),
      tier: metadata.Tier ?? "Common",
      auraFamily: groups.auraFamily,
      backgroundStyle: groups.backgroundStyle,
    };
  });

  return {
    auraFamily: groups.auraFamily,
    backgroundStyle: groups.backgroundStyle,
    abilities: abilities.slice(0, tier.slots),
  };
}

export { POWER_FAMILIES };
