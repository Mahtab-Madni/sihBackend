// server.js
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const csv = require("csvtojson");
require("dotenv").config();

const computeIndices = require("./utils/calculateIndices");

const Sample = require("./models/sample");

const app = express();
const PORT = process.env.PORT || 5000;

// ---------- MIDDLEWARE ----------
app.use(express.json());
app.use(cors({
  origin: "http://localhost:8080", // linking fortened server during development
}));

// ---------- MONGODB ----------
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Error:", err));

// ---------- ROUTES ----------
// ✅ 1. Add a single sample
app.post("/api/samples", async (req, res) => {
  try {
    let sampleData = req.body;

    // Calculate indices
    const indicesResult = computeIndices(sampleData);
    sampleData.indices = {
      hpi: indicesResult.hpi,
      mi: indicesResult.mi,
      cd: indicesResult.cd,
    };
    sampleData.category = indicesResult.category;

    // Set location
    sampleData.location = { 
      type: "Point", 
      coordinates: [sampleData.longitude, sampleData.latitude] 
    };
    
    const newSample = new Sample(sampleData);
    const saved = await newSample.save();
    res.status(201).json({ message: "✅ Sample added", data: saved });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error while adding sample" });
  }
});

// ✅ 2. Get all samples
app.get("/api/samples", async (req, res) => {
  try {
    const samples = await Sample.find().sort({ createdAt: -1 });
    res.json(samples);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch samples" });
  }
});

// ✅ 3. Summary stats
app.get("/api/summary", async (req, res) => {
  try {
    const totalSamples = await Sample.countDocuments();

    const categories = await Sample.aggregate([
      { $group: { _id: "$category", count: { $sum: 1 } } },
    ]);

    const avgIndices = await Sample.aggregate([
      {
        $group: {
          _id: null,
          avgHPI: { $avg: "$indices.hpi" },
          avgMI: { $avg: "$indices.mi" },
          avgCD: { $avg: "$indices.cd" },
        },
      },
    ]);

    res.json({
      totalSamples,
      categories,
      averages: avgIndices[0] || {},
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get summary" });
  }
});

// ✅ 4. Upload CSV (Bulk)
const upload = multer({ dest: "uploads/" });

app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const jsonArray = await csv().fromFile(req.file.path);
    console.log("First row of CSV:", jsonArray[0]); // DEBUG

    const docs = jsonArray.map((row, index) => {
      // Parse coordinates with multiple fallbacks
      const lat = parseFloat(row.Latitude || row.LAT || row.latitude) || 0;
      const lng = parseFloat(row.Longitude || row.LONG || row.longitude) || 0;
      console.log(`Row ${index}: Lat=${lat}, Lng=${lng}`);

      // --- Basic water quality (non-metals) ---
      const waterQuality = {
        pH: parseFloat(row.pH) || 7,
        tds: parseFloat(row["EC (µS/cm at 25 °C)"]) || 0,
        hardness: parseFloat(row["Total Hardness (mg/L)"]) || 0,
        fluoride: parseFloat(row["F (mg/L)"]) || 0,
        nitrate: parseFloat(row["NO3 (mg/L)"]) || 0,
      };

      // --- Metals block ---
      const metals = {
        // Given as ppb → convert to mg/L
        arsenic: row["As (ppb)"] && row["As (ppb)"] !== "-"
          ? parseFloat(row["As (ppb)"]) / 1000
          : 0,

        uranium: row["U (ppb)"] && row["U (ppb)"] !== "-"
          ? parseFloat(row["U (ppb)"]) / 1000
          : 0,

        // Iron already in ppm (≈ mg/L)
        iron: row["Fe (ppm)"] && row["Fe (ppm)"] !== "-"
          ? parseFloat(row["Fe (ppm)"])
          : 0,

        // CSV doesn’t have these, set 0 for now
        lead: 0,
        cadmium: 0,
        chromium: 0,
        mercury: 0,
      };

      // Remove negatives → set to 0
      Object.keys(metals).forEach((m) => {
        if (metals[m] < 0 || isNaN(metals[m])) metals[m] = 0;
      });

      // --- Build sample object ---
      const sampleData = {
        sampleId: row["S. No."] || `SAMPLE-${Date.now()}-${index}`,
        state: row.State || "",
        district: row.District || "",
        block: "",
        village: row.Location || "",
        latitude: lat,
        longitude: lng,
        samplingDate: row.Year ? new Date(row.Year, 0, 1) : new Date(),
        wellType: "Groundwater",
        waterQuality,
        metals,
        location: {
          type: "Point",
          coordinates: [lng, lat], // IMPORTANT: [lng, lat]
        },
      };

      // Compute indices
      const indices = computeIndices({ metals });
      sampleData.indices = {
        hpi: indices.hpi,
        mi: indices.mi,
        cd: indices.cd,
      };
      sampleData.category = indices.category;

      return sampleData;
    });

    // Insert into Mongo
    const result = await Sample.insertMany(docs, { ordered: false });

    // Delete uploaded file
    const fs = require("fs");
    fs.unlinkSync(req.file.path);

    console.log(`✅ Successfully uploaded ${result.length} samples`);
    res.json({
      message: "✅ Bulk upload successful",
      count: result.length,
    });
  } catch (err) {
    console.error("Upload error:", err);
    if (req.file) {
      const fs = require("fs");
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: "Failed to upload CSV", details: err.message });
  }
});

// ✅ 5. Chart data: pollution indices trend
app.get("/api/charts/pollution-indices", async (req, res) => {
  try {
    const data = await Sample.aggregate([
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          avgHPI: { $avg: "$indices.hpi" },
          avgMI: { $avg: "$indices.mi" },
          avgCD: { $avg: "$indices.cd" },
        },
      },
      { $sort: { "_id": 1 } },
    ]);

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch chart data" });
  }
});

// ✅ 6. Contamination distribution (per metal)
app.get("/api/contamination-distribution", async (req, res) => {
  try {
    const distribution = await Sample.aggregate([
      {
        $group: {
          _id: null,
          avgLead: { $avg: "$metals.lead" },
          avgCadmium: { $avg: "$metals.cadmium" },
          avgArsenic: { $avg: "$metals.arsenic" },
          avgChromium: { $avg: "$metals.chromium" },
        },
      },
    ]);
    res.json(distribution[0] || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch contamination data" });
  }
});

// ✅ 7. Map data
app.get("/api/map", async (req, res) => {
  try {
    const geoData = await Sample.find(
      {},
      {
        sampleId: 1,
        latitude: 1,
        longitude: 1,
        category: 1,
        "indices.hpi": 1,
      }
    );

    res.json(
      geoData.map((s) => ({
        id: s._id,
        sampleId: s.sampleId,
        lat: s.latitude,
        lng: s.longitude,
        category: s.category,
        hpi: s.indices?.hpi || 0,
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch map data" });
  }
});

// Update a sample
app.put("/api/samples/:id", async (req, res) => {
  try {
    const sampleId = req.params.id;
    const updates = req.body;

    if (updates.latitude && updates.longitude) {
      updates.location = { type: "Point", coordinates: [updates.longitude, updates.latitude] };
    }

    // Recompute indices if metals changed
    if (updates.metals) {
      const indices = computeIndices({ metals: updates.metals });
      updates.indices = {
        hpi: indices.hpi,
        mi: indices.mi,
        cd: indices.cd,
      };
      updates.category = indices.category;
    }

    const updated = await Sample.findByIdAndUpdate(sampleId, updates, { new: true });
    res.json({ message: "✅ Sample updated", data: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update sample" });
  }
});

// ✅ Update a sample by sampleId (user-friendly)
app.put("/api/samples/by-sampleid/:sampleId", async (req, res) => {
  try {
    const { sampleId } = req.params;
    const updates = req.body;

    // Find the sample by sampleId first
    const existingSample = await Sample.findOne({ sampleId: sampleId });
    
    if (!existingSample) {
      return res.status(404).json({ error: `Sample with sampleId '${sampleId}' not found` });
    }

    // Update location if coordinates changed
    if (updates.latitude && updates.longitude) {
      updates.location = { 
        type: "Point", 
        coordinates: [updates.longitude, updates.latitude] 
      };
    }

    // Recompute indices if metals or waterQuality changed
    if (updates.metals || updates.waterQuality) {
      // Merge existing data with updates for calculation
      const dataForCalculation = {
        metals: updates.metals || existingSample.metals,
        waterQuality: updates.waterQuality || existingSample.waterQuality
      };
      
      const indices = computeIndices(dataForCalculation);
      updates.indices = {
        hpi: indices.hpi,
        mi: indices.mi,
        cd: indices.cd,
      };
      updates.category = indices.category;
    }

    // Update the sample
    const updated = await Sample.findOneAndUpdate(
      { sampleId: sampleId }, 
      updates, 
      { new: true }
    );
    
    res.json({ 
      message: `✅ Sample '${sampleId}' updated successfully`, 
      data: updated 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update sample" });
  }
});

// Delete a sample
app.delete("/api/samples/:id", async (req, res) => {
  try {
    const deleted = await Sample.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Sample not found" });
    res.json({ message: "✅ Sample deleted", data: deleted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete sample" });
  }
});

// ✅ 8. Get samples by state/district
app.get("/api/samples/location", async (req, res) => {
  try {
    const { state, district } = req.query;
    const query = {};
    if (state) query.state = state;
    if (district) query.district = district;
    
    const samples = await Sample.find(query).sort({ createdAt: -1 });
    res.json(samples);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch samples by location" });
  }
});

// ✅ 9. Get unique states and districts
app.get("/api/locations", async (req, res) => {
  try {
    const states = await Sample.distinct("state");
    const districts = await Sample.distinct("district");
    res.json({ states, districts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch locations" });
  }
});

// ✅ 10. Water quality distribution
app.get("/api/water-quality-distribution", async (req, res) => {
  try {
    const distribution = await Sample.aggregate([
      {
        $group: {
          _id: null,
          avgpH: { $avg: "$waterQuality.pH" },
          avgTDS: { $avg: "$waterQuality.tds" },
          avgFluoride: { $avg: "$waterQuality.fluoride" },
          avgNitrate: { $avg: "$waterQuality.nitrate" }
        }
      }
    ]);
    res.json(distribution[0] || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch water quality data" });
  }
});

// ---------- START SERVER ----------
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
