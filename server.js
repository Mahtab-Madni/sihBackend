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
app.use(cors());

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

    // calculate indices
    const indicesResult = computeIndices(sampleData);
    sampleData.indices = {
      hpi: indicesResult.hpi,
      mi: indicesResult.mi,
      cd: indicesResult.cd,
    };
    sampleData.category = indicesResult.category;

  sampleData.location = { type: "Point", coordinates: [sampleData.longitude, sampleData.latitude] };
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
    const jsonArray = await csv().fromFile(req.file.path);

    const docs = jsonArray.map((row) => {
      const metals = {
        lead: parseFloat(row.lead),
        cadmium: parseFloat(row.cadmium),
        arsenic: parseFloat(row.arsenic),
        chromium: parseFloat(row.chromium),
      };
      const sampleData = {
      sampleId: row.sampleId,
      latitude: parseFloat(row.latitude),
      longitude: parseFloat(row.longitude),
      metals,
      location: { type: "Point", coordinates: [parseFloat(row.longitude), parseFloat(row.latitude)] }
      };

      const indices = computeIndices(sampleData);
      sampleData.indices = {
        hpi: indices.hpi,
        mi: indices.mi,
        cd: indices.cd,
      };
      sampleData.category = indices.category;
      return sampleData;
    });

await Sample.insertMany(docs, { ordered: false }); // inserts valid rows even if some fail


    const fs = require("fs");
    fs.unlinkSync(req.file.path); // deletes uploaded CSV

    res.json({ message: "✅ Bulk upload successful", count: docs.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to upload CSV" });
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


// ---------- START SERVER ----------
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
