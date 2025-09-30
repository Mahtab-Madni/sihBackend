const mongoose = require("mongoose");

const sampleSchema = new mongoose.Schema({
  sampleId: { type: String, required: true, unique: true },
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  location: {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], default: [0, 0] } // [lon, lat]
  },
  metals: {
    lead: { type: Number, default: 0 },
    cadmium: { type: Number, default: 0 },
    arsenic: { type: Number, default: 0 },
    chromium: { type: Number, default: 0 }
  },
  indices: {
    hpi: { type: Number, default: 0 },
    mi:  { type: Number, default: 0 },
    cd:  { type: Number, default: 0 }
  },
  category: { type: String, enum: ["safe", "moderate", "unsafe"], default: "safe" }
}, { timestamps: true });

// Useful indexes for map queries and category aggregation
sampleSchema.index({ location: "2dsphere" });
sampleSchema.index({ category: 1 });

module.exports = mongoose.model("Sample", sampleSchema);
