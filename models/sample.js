const mongoose=require("mongoose");

const sampleSchema = new mongoose.Schema({
  sampleId: { type: String, required: true, unique: true },

  // batchId: { type: String, required: true },
  
  // Location details
  state: { type: String },
  district: { type: String },
  block: { type: String },
  village: { type: String },
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  location: {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], default: [0, 0] }
  },
  
  // Water quality parameters
  waterQuality: {
    pH: { type: Number, default: 0 },
    tds: { type: Number, default: 0 },
    hardness: { type: Number, default: 0 },
    fluoride: { type: Number, default: 0 },
    nitrate: { type: Number, default: 0 }
  },
  
  // Heavy metals
  metals: {
    lead: { type: Number, default: 0 },
    uranimun: { type: Number, default: 0 },
    arsenic: { type: Number, default: 0 },
    iron: { type: Number, default: 0 },
    mercury: { type: Number, default: 0 },
    cadmium: { type: Number, default: 0 },
    chromium: { type: Number, default: 0 }
  },
  
  // Keep existing indices
  indices: {
    hpi: { type: Number, default: 0 },
    mi:  { type: Number, default: 0 },
    cd:  { type: Number, default: 0 }
  },
  category: { type: String, enum: ["safe", "moderate", "unsafe"], default: "safe" },
  
  // Add sampling details
  samplingDate: { type: Date },
  wellType: { type: String }
}, { timestamps: true });

sampleSchema.index({ location: "2dsphere" });
sampleSchema.index({ category: 1 });
sampleSchema.index({ state: 1, district: 1 });

module.exports = mongoose.model("Sample", sampleSchema);