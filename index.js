const express = require('express');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// --- Configuration ---
const SHEET_ID = process.env.SHEET_ID;
const API_KEY = process.env.API_KEY;
const SHEET_NAME = 'Sheet1'; 

if (!SHEET_ID || !API_KEY) {
  throw new Error("FATAL ERROR: Missing SHEET_ID or API_KEY in your .env file.");
}

// --- Middleware ---
app.use(cors());

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, 
  max: 100, 
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// --- Caching ---
let cache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 30 * 1000; // 30 seconds

/**
 * Converts an RGB color object from the Google API into a simple color name.
 * @param {object} rgbColor - The RGB color object { red, green, blue }.
 * @returns {string} The name of the color (e.g., "Green", "Red", "Gray").
 */
function rgbToColorName(rgbColor) {
    if (!rgbColor) return 'Gray'; // Default color if none is set

    const { red = 0, green = 0, blue = 0 } = rgbColor;

    // These thresholds are based on standard Google Sheets colors.
    // Pure red is (1, 0, 0), pure green is (0, 1, 0).
    if (red > 0.8 && green < 0.2 && blue < 0.2) return 'Red';
    if (green > 0.5 && red < 0.5) return 'Green';
    
    return 'Gray'; // Default for other colors (like white, yellow, etc.)
}


/**
 * Parses the detailed grid data from Google Sheets into the desired nested JSON object.
 * @param {object} gridData The sheet data from the Google Sheets API response.
 * @returns {object} The formatted JSON data.
 */
function parseSheetData(gridData) {
    const sheet = gridData.sheets.find(s => s.properties.title === SHEET_NAME);
    if (!sheet || !sheet.data || !sheet.data[0].rowData) {
        return { [SHEET_NAME]: {} };
    }

    const rows = sheet.data[0].rowData;
    const headers = rows[0].values.map(cell => cell.formattedValue);
    const data = {};
    let currentServiceKey = null;

    const headerMap = {};
    headers.forEach((header, index) => {
        if(header) headerMap[header.trim()] = index;
    });

    for (let i = 1; i < rows.length; i++) {
        const rowData = rows[i].values || [];
        
        // Helper to get value and color from a cell by its header name
        const getCellData = (headerName) => {
            const index = headerMap[headerName];
            if (index === undefined || !rowData[index]) {
                return { value: "", color: "Gray" };
            }
            const cell = rowData[index];
            return {
                value: cell.formattedValue || "",
                color: rgbToColorName(cell.effectiveFormat?.backgroundColor)
            };
        };

        const serviceName = getCellData('Service').value;
        const subheadingName = getCellData('Subheading').value;

        if (serviceName && serviceName.trim() !== '') {
            currentServiceKey = serviceName.trim();
            data[currentServiceKey] = {
                Subheading: {},
                Compliant: Number(getCellData('Compliant').value) || null,
                Total: getCellData('Total').value,
                Mising: getCellData('Mising').value,
                '%Compliant': getCellData('% Compliant').value,
            };

            const statusC = getCellData('Status C');
            if (statusC.value) {
                data[currentServiceKey].status_C = {
                    name: statusC.value,
                    colour: statusC.color
                };
            }

            const statusE = getCellData('Status E');
            if (statusE.value) {
                data[currentServiceKey].status_E = {
                    name: statusE.value,
                    colour: statusE.color
                };
            }
        }

        if (currentServiceKey && subheadingName && subheadingName.trim() !== '') {
            if (typeof data[currentServiceKey].Subheading !== 'object') {
                data[currentServiceKey].Subheading = {};
            }
            const subheadingCell = getCellData('Subheading');
            data[currentServiceKey].Subheading[subheadingName.trim()] = {
                colour: subheadingCell.color
            };
        }
    }

    // Final cleanup
    for (const serviceKey in data) {
        if (data[serviceKey].Subheading && Object.keys(data[serviceKey].Subheading).length === 0) {
            data[serviceKey].Subheading = 0;
        }
    }

    return { [SHEET_NAME]: data };
}


/**
 * Fetches detailed grid data from the Google Sheet, including cell formatting.
 * @returns {Promise<object>} A promise that resolves to the sheet data.
 */
async function fetchSheetData() {
  const now = Date.now();

  if (cache && now - cacheTimestamp < CACHE_DURATION) {
    console.log("Serving from cache.");
    return cache;
  }

  console.log("Fetching new grid data from Google Sheets API...");
  // This URL is different. It uses the main endpoint with `includeGridData=true` to get formatting.
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?key=${API_KEY}&ranges=${SHEET_NAME}&includeGridData=true`;
  
  const response = await axios.get(url);
  const jsonData = parseSheetData(response.data);

  cache = jsonData;
  cacheTimestamp = now;
  console.log("Cache updated.");
  
  return jsonData;
}

// --- API Routes ---
app.get('/', (req, res) => {
  res.send('✅ Google Sheet API is running. Use the /api/sheet-data endpoint to get data.');
});

app.get('/api/sheet-data', async (req, res) => {
  try {
    const jsonData = await fetchSheetData();
    res.json(jsonData);
  } catch (error) {
    console.error('Error fetching or parsing sheet data:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: 'Failed to fetch sheet data', details: error.message });
  }
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
