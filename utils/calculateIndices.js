// utils/calculateIndices.js
const THRESHOLDS = {
  // BIS 10500:2012 standards (mg/L)
  lead: 0.01,        // BIS limit
  cadmium: 0.003,    // BIS limit
  arsenic: 0.01,     // BIS limit
  chromium: 0.05,    // BIS limit
  mercury: 0.001,    // BIS limit
  uranium: 0.03,     // WHO provisional guideline (~30 µg/L = 0.03 mg/L)
  iron: 0.3,         // Desirable limit

  // Other parameters
  fluoride: 1.0,     // Desirable limit
  nitrate: 45,       // BIS limit
  pH_min: 6.5,       // Lower limit
  pH_max: 8.5,       // Upper limit
  tds: 500           // Desirable limit (mg/L)
};

function computeIndices(sample = {}) {
  const metals = sample.metals || {};
  const waterQuality = sample.waterQuality || {};

  // Filter only metals that exist in THRESHOLDS and sample
  const metalKeys = Object.keys(metals).filter(
    (m) => metals[m] !== undefined && THRESHOLDS[m] !== undefined
  );

  // --- Heavy Metal Pollution Index (HPI) ---
  let hpiSum = 0;
  metalKeys.forEach((m) => {
    hpiSum += (Number(metals[m]) || 0) / THRESHOLDS[m] * 100;
  });
  const hpi = metalKeys.length ? Number((hpiSum).toFixed(3)) : 0;

  // --- Metal Index (MI) ---
  const mi = metalKeys.length
    ? Number(((metalKeys.reduce((sum, m) => sum + (Number(metals[m]) || 0), 0) / metalKeys.length) * 10).toFixed(3))
    : 0;

  // --- Contamination Degree (CD) ---
  const cd = metalKeys.length
    ? Number((metalKeys.reduce((sum, m) => sum + ((Number(metals[m]) || 0) / THRESHOLDS[m]), 0)).toFixed(3))
    : 0;

  // --- Other parameters ---
  const pH = Number(waterQuality.pH) || 7;
  const tds = Number(waterQuality.tds) || 0;
  const fluoride = Number(waterQuality.fluoride) || 0;
  const nitrate = Number(waterQuality.nitrate) || 0;

  // --- Categorization ---
  let category = "safe";

  // Check threshold exceedances
  const exceedsMetal = metalKeys.some((m) => (Number(metals[m]) || 0) > THRESHOLDS[m]);

  const exceedsOther =
    fluoride > THRESHOLDS.fluoride * 1.5 ||
    nitrate > THRESHOLDS.nitrate ||
    tds > THRESHOLDS.tds * 2 ||
    pH < THRESHOLDS.pH_min ||
    pH > THRESHOLDS.pH_max;

  if (hpi > 100 || mi > 1 || cd > 3 || exceedsMetal || exceedsOther) {
    category = "unsafe";
  } else if (hpi > 50 || mi > 0.5 || cd > 1.5) {
    category = "moderate";
  }

  return { hpi, mi, cd, category };
}

module.exports = computeIndices;
