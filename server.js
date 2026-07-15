const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const uploadsDir = path.join(__dirname, 'uploads');

fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const baseName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${baseName}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.csv', '.xls', '.xlsx'].includes(ext)) {
      cb(null, true);
      return;
    }
    cb(new Error('Unsupported file type'));
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/data', (req, res) => {
  res.json({ sales: 1250000, inventoryTurnover: 4.8, satisfaction: 92 });
});

function safeNumeric(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().replace(/[$,\s]/g, '');
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function parseCsvFile(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', reject);
  });
}

function parseXlsxFile(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: null });
}

function buildAnalysis(rows) {
  const stats = {};
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  columns.forEach((col) => {
    const numericValues = rows
      .map((row) => safeNumeric(row[col]))
      .filter((value) => value !== null);

    if (numericValues.length > 0) {
      const sum = numericValues.reduce((a, b) => a + b, 0);
      stats[col] = {
        sum,
        avg: sum / numericValues.length,
        min: Math.min(...numericValues),
        max: Math.max(...numericValues)
      };
    }
  });

  const chartColumn = columns.find((col) => Object.prototype.hasOwnProperty.call(stats, col)) || columns[0];
  const chartData = {
    labels: rows.map((row, index) => {
      const firstValue = row[columns[0]];
      return firstValue !== undefined && firstValue !== null && firstValue !== '' ? String(firstValue) : `Row ${index + 1}`;
    }),
    values: rows.map((row) => safeNumeric(row[chartColumn]) ?? 0),
    column: chartColumn
  };

  return { stats, chartData };
}

app.post('/upload', upload.single('file'), async (req, res, next) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const filePath = req.file.path;
  const ext = path.extname(req.file.originalname).toLowerCase();

  try {
    let rows = [];
    if (ext === '.csv') {
      rows = await parseCsvFile(filePath);
    } else if (ext === '.xlsx' || ext === '.xls') {
      rows = parseXlsxFile(filePath);
    } else {
      res.status(400).json({ error: 'Unsupported file type' });
      return;
    }

    const analysis = buildAnalysis(rows);
    res.json({
      rows,
      stats: analysis.stats,
      chartData: analysis.chartData,
      filename: req.file.originalname
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to parse file' });
  } finally {
    if (filePath) {
      fs.unlink(filePath, () => {});
    }
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: err.message });
    return;
  }

  if (err) {
    res.status(400).json({ error: err.message || 'Upload failed' });
    return;
  }

  next();
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
  });
}

module.exports = { app, buildAnalysis, safeNumeric, parseCsvFile, parseXlsxFile };
