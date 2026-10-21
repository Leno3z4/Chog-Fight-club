function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

/**
 * Fast extension followed by a quadratic ease-in recovery.
 * progress is normalized to the whole strike window.
 */
export function punchPulse(progress, extensionEnd = 0.3, recoveryEnd = 0.85) {
  const p = clamp01(progress);
  const extension = Math.max(0.01, Math.min(0.98, Number(extensionEnd) || 0.3));
  const recovery = Math.max(extension + 0.01, Math.min(1, Number(recoveryEnd) || 0.85));

  if (p >= recovery) return 0;
  if (p <= extension) {
    return Math.sin((p / extension) * Math.PI * 0.5);
  }

  const recoveryProgress = (p - extension) / (recovery - extension);
  return clamp01(1 - recoveryProgress * recoveryProgress);
}

/**
 * Apply one strike pulse only inside a segment of a combo timeline.
 */
export function punchWindowPulse(progress, windowStart, windowEnd, extensionEnd = 0.3, recoveryEnd = 0.85) {
  const p = Number(progress);
  const start = Number(windowStart);
  const end = Number(windowEnd);
  if (![p, start, end].every(Number.isFinite) || end <= start || p < start || p >= end) return 0;

  return punchPulse((p - start) / (end - start), extensionEnd, recoveryEnd);
}
