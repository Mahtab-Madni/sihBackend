// utils/calculateIndices.js
const THRESHOLDS = {
  // example thresholds — replace by your domain values if different
  lead: 0.01,
  cadmium: 0.003,
  arsenic: 0.01,
  chromium: 0.05
};

function computeIndices(sample = {}) {
  const metals = sample.metals || {};
  const lead     = Number(metals.lead)     || 0;
  const cadmium  = Number(metals.cadmium)  || 0;
  const arsenic  = Number(metals.arsenic)  || 0;
  const chromium = Number(metals.chromium) || 0;

  // Example formulas (keep or replace with your real formulas)
  const hpi = Number(((lead + cadmium + arsenic + chromium) * 100).toFixed(3));
  const mi  = Number(((lead + cadmium) * 10).toFixed(3));
  const cd  = Number((arsenic * 50).toFixed(3));

  // Categorization using thresholds (adjust thresholds to your domain)
  let category = "safe";
  if (hpi > 100 || mi > 20 || cd > 10) category = "unsafe";
  else if (hpi > 50 || mi > 10 || cd > 5) category = "moderate";

  return { hpi, mi, cd, category };
}

module.exports = computeIndices;
