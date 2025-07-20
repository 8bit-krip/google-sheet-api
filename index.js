const express = require('express');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const SHEET_ID = process.env.SHEET_ID;
const API_KEY = process.env.API_KEY;
const SHEET_NAME = 'Sheet1';

if (!SHEET_ID || !API_KEY) {
  throw new Error("Missing SHEET_ID or API_KEY in .env");
}

app.use(cors());

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // max 100 requests per minute per IP
});
app.use('/api/', limiter);

// Cache variables
let cache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 30 * 1000; // 30 seconds

// Parser function
function parseSheetData(rows) {
  const headers = rows[0];
  const data = {};

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const serviceName = row[0];
    if (!serviceName) continue;

    data[serviceName] = {
      [headers[1]]: row[1] === "-" || row[1] === "null" ? null : Number(row[1]),
      [headers[2]]: row[2] === "-" ? null : Number(row[2]),
      [headers[3]]: row[3] === "-" ? null : row[3],
      [headers[4]]: row[4] === "-" ? null : row[4]
    };
  }

  return { [SHEET_NAME]: data };
}

// Fetch with caching
async function fetchSheetData() {
  const now = Date.now();

  if (cache && now - cacheTimestamp < CACHE_DURATION) {
    return cache;
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}?key=${API_KEY}`;
  const response = await axios.get(url);
  const jsonData = parseSheetData(response.data.values);

  cache = jsonData;
  cacheTimestamp = now;
  return jsonData;
}

// Routes
app.get('/', (req, res) => {
  res.send('✅ Google Sheet API is running. Use /api/sheet-data');
});

app.get('/api/sheet-data', async (req, res) => {
  try {
    const jsonData = await fetchSheetData();
    res.json(jsonData);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sheet data', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
