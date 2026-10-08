import { resolveTraitGroups } from "./traitGroups.js";

export const TIERS = {
  Common: { power: 1, complexity: 1 },
  Uncommon: { power: 1.12, complexity: 2 },
  Rare: { power: 1.25, complexity: 3 },
  Epic: { power: 1.4, complexity: 4 },
  Legendary: { power: 1.6, complexity: 5 },
};

const POWER_FAMILIES = {
  flame: { base: { id: "ember-burst", name: "Ember Burst", type: "burst", cost: 1, power: 14, status: "burn" }, special: { id: "scorch-field", name: "Scorch Field", type: "control", cost: 3, power: 22, status: "burn" }, defense: { id: "heat-guard", name: "Heat Guard", type: "defense", cost: 2, power: 0, status: "shield" } },
  water: { base: { id: "pressure-wave", name: "Pressure Wave", type: "control", cost: 1, power: 13, status: "slow" }, special: { id: "tidal-bind", name: "Tidal Bind", type: "control", cost: 3, power: 20, status: "slow" }, defense: { id: "mist-guard", name: "Mist Guard", type: "defense", cost: 2, power: 0, status: "shield" } },
  wind: { base: { id: "razor-gale", name: "Razor Gale", type: "burst", cost: 1, power: 13, status: null }, special: { id: "gale-step", name: "Gale Step", type: "mobility", cost: 3, power: 18, status: "evade" }, defense: { id: "wind-screen", name: "Wind Screen", type: "defense", cost: 2, power: 0, status: "shield" } },
  electric: { base: { id: "arc-strike", name: "Arc Strike", type: "burst", cost: 1, power: 15, status: "stun" }, special: { id: "static-field", name: "Static Field", type: "control", cost: 3, power: 22, status: "stun" }, defense: { id: "current-shield", name: "Current Shield", type: "defense", cost: 2, power: 0, status: "shield" } },
  nature: { base: { id: "thorn-burst", name: "Thorn Burst", type: "burst", cost: 1, power: 13, status: null }, special: { id: "root-snare", name: "Root Snare", type: "control", cost: 3, power: 19, status: "slow" }, defense: { id: "bark-guard", name: "Bark Guard", type: "defense", cost: 2, power: 0, status: "shield" } },
  royal: { base: { id: "regal-command", name: "Regal Command", type: "disruption", cost: 1, power: 13, status: "weaken" }, special: { id: "decree-break", name: "Decree Break", type: "counter", cost: 3, power: 22, status: "counter" }, defense: { id: "royal-aegis", name: "Royal Aegis", type: "defense", cost: 2, power: 0, status: "shield" } },
  radiant: { base: { id: "radiant-flare", name: "Radiant Flare", type: "burst", cost: 1, power: 13, status: null }, special: { id: "reveal-mark", name: "Reveal Mark", type: "disruption", cost: 3, power: 20, status: "weaken" }, defense: { id: "radiant-ward", name: "Radiant Ward", type: "defense", cost: 2, power: 0, status: "shield" } },
  arcane: { base: { id: "prism-lance", name: "Prism Lance", type: "burst", cost: 1, power: 14, status: null }, special: { id: "arcane-fold", name: "Arcane Fold", type: "disruption", cost: 3, power: 21, status: "silence" }, defense: { id: "prism-ward", name: "Prism Ward", type: "defense", cost: 2, power: 0, status: "shield" } },
  shadow: { base: { id: "smoke-burst", name: "Smoke Burst", type: "burst", cost: 1, power: 13, status: "weaken" }, special: { id: "hollow-mark", name: "Hollow Mark", type: "disruption", cost: 3, power: 20, status: "weaken" }, defense: { id: "smoke-screen", name: "Smoke Screen", type: "defense", cost: 2, power: 0, status: "shield" } },
  neutral: { base: { id: "focused-strike", name: "Focused Strike", type: "burst", cost: 1, power: 13, status: null }, special: { id: "interrupt", name: "Interrupt", type: "disruption", cost: 3, power: 20, status: "stagger" }, defense: { id: "steady-guard", name: "Steady Guard", type: "defense", cost: 2, power: 0, status: "shield" } },
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

function buildAbility(ability, tier, groups) {
  const styleMultiplier = STYLE_MODIFIERS[groups.backgroundStyle]?.[ability.type] ?? 1;
  return {
    ...ability,
    power: Math.round(ability.power * tier.power * styleMultiplier),
    tier: tier.name,
    auraFamily: groups.auraFamily,
    backgroundStyle: groups.backgroundStyle,
    expression: groups.expression,
  };
}

export function buildAbilitySet(metadata) {
  const groups = resolveTraitGroups(metadata);
  const tier = TIERS[metadata.Tier] ?? TIERS.Common;
  const tierName = metadata.Tier ?? "Common";
  const family = POWER_FAMILIES[groups.auraFamily] ?? POWER_FAMILIES.neutral;

  const slots = {
    base: buildAbility(family.base, { ...tier, name: tierName }, groups),
    special: buildAbility(family.special, { ...tier, name: tierName }, groups),
    defense: buildAbility(family.defense, { ...tier, name: tierName }, groups),
  };

  return {
    auraFamily: groups.auraFamily,
    backgroundStyle: groups.backgroundStyle,
    expression: groups.expression,
    base: slots.base,
    special: slots.special,
    defense: slots.defense,
    abilities: [slots.base, slots.special, slots.defense],
  };
}

export { POWER_FAMILIES };
