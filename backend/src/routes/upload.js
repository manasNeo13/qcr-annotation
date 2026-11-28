import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { HttpError } from '../lib/httpError.js';
import { requireAuth } from '../middleware/auth.js';
import { requireGrnUpload } from '../middleware/permissions.js';
import { repo } from '../repos/index.js';

/** Upload: NHQ / admin roles + split team only (all clients). */
const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // exceljs reads .xlsx only (old binary .xls → re-save as .xlsx).
    const accepted = file.mimetype.includes('spreadsheetml') || file.originalname.toLowerCase().endsWith('.xlsx');
    cb(accepted ? null : new HttpError(400, 'Only Excel .xlsx files are accepted (re-save .xls as .xlsx)'), accepted);
  },
});

const SHEET_NAME = 'OCR vs GRN';

// 0-based column indices in the "OCR vs GRN" sheet
const COL = {
  request_id:        13, // Neophyte Request ID
  cap_batch:         15, // Captured Batch
  cap_mfd:           16, // Captured MFG
  cap_exp:           17, // Captured EXP
  cap_mrp:           18, // Captured MRP
  sub_batch:         20, // Submitted Batch
  sub_mfd:           21, // Submitted MFG
  sub_exp:           22, // Submitted EXP
  sub_mrp:           23, // Submitted MRP
  batch_changed:     29, // Batch Changed   (Yes/No → boolean)
  batch_change_type: 30, // Batch Change Type
  mfd_changed:       31, // MFG Changed     (Yes/No → boolean)
  exp_changed:       32, // EXP Changed     (Yes/No → boolean)
  exp_change_type:   33, // Expiry Change Type
  mrp_changed:       34, // MRP Changed     (Yes/No → boolean)
  any_changed:       35, // Any Changed (Batch/EXP/MRP) (Yes/No → boolean)
};

/** exceljs cell value → plain value (formula → its result, rich text / link → text). */
const plain = (v) => {
  if (v == null || typeof v !== 'object' || v instanceof Date) return v;
  if ('result' in v) return plain(v.result);
  if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
  if ('text' in v) return plain(v.text);
  if ('error' in v) return null;
  return null;
};

/** Sheet → rows of 0-based cell arrays (header first), like a plain table. */
function sheetRows(ws) {
  const rows = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    // row.values is 1-based → drop slot 0.
    const vals = Array.isArray(row.values) ? row.values.slice(1) : [];
    rows.push(vals.map(plain));
  });
  return rows;
}

/** Excel Date → 'YYYY-MM-DD' or null */
const toDate = (v) => {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  return null;
};

/** 'Yes' → true, anything else → false */
const toBool = (v) => typeof v === 'string' && v.trim().toLowerCase() === 'yes';

/** Non-empty trimmed string or null */
const toStr = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

/** Finite number or null */
const toNum = (v) => {
  if (v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};

function parseRow(row) {
  const request_id = toStr(row[COL.request_id]);
  if (!request_id) return null;

  const batch_changed     = toBool(row[COL.batch_changed]);
  const mfd_changed       = toBool(row[COL.mfd_changed]);
  const exp_changed       = toBool(row[COL.exp_changed]);
  const mrp_changed       = toBool(row[COL.mrp_changed]);
  const any_changed       = toBool(row[COL.any_changed]);

  return {
    request_id,
    captured_data: {
      batch: toStr(row[COL.cap_batch]),
      mrp:   toNum(row[COL.cap_mrp]),
      exp:   toDate(row[COL.cap_exp]),
      mfd:   toDate(row[COL.cap_mfd]),
    },
    submitted_data: {
      batch: toStr(row[COL.sub_batch]),
      mrp:   toNum(row[COL.sub_mrp]),
      exp:   toDate(row[COL.sub_exp]),
      mfd:   toDate(row[COL.sub_mfd]),
    },
    batch_changed,
    batch_change_type: toStr(row[COL.batch_change_type]),
    mfd_changed,
    exp_changed,
    exp_change_type:   toStr(row[COL.exp_change_type]),
    mrp_changed,
    any_changed,
    edited: batch_changed || mfd_changed || exp_changed || mrp_changed,
  };
}

/**
 * POST /api/upload_client_revalidate_data
 * Body: multipart/form-data, field "file" = Excel workbook.
 * Reads the "OCR vs GRN" sheet → session_results.grn of each capture's latest scan.
 */
router.post('/', requireAuth, requireGrnUpload, upload.single('file'), async (req, res) => {
  if (!req.file) {
    throw new HttpError(400, 'No file uploaded — send the Excel as form-data field "file"');
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(req.file.buffer);
  } catch {
    throw new HttpError(422, 'Could not read this file — is it a valid .xlsx?');
  }

  const ws = workbook.getWorksheet(SHEET_NAME);
  if (!ws) throw new HttpError(422, `Sheet "${SHEET_NAME}" not found in the uploaded workbook`);

  const rows = sheetRows(ws);

  // rows[0] is the header row
  const totalRows = Math.max(rows.length - 1, 0);
  const records = rows.slice(1).map(parseRow).filter(Boolean);
  if (!records.length) {
    return res.json({ message: 'No data rows found', inserted: 0, updated: 0, skipped: 0 });
  }

  const { inserted, updated, autoApproved = 0, byDay = [] } = await repo.sessionResults.upsertGrnData(records);
  res.json({
    message: `Processed ${records.length} of ${totalRows} rows`,
    inserted,
    updated,
    autoApproved,
    byDay,
    skipped: totalRows - records.length,
  });
});

export default router;
