const axios = require('axios');
const { parse } = require('csv-parse/sync');

/**
 * Extracts Google Spreadsheet ID and GID (tab ID) from a URL or raw ID string.
 * @param {string} input - Google sheet URL or ID.
 * @returns {{ id: string, gid: string|null }}
 */
function extractSpreadsheetId(input) {
  if (!input) return { id: '', gid: null };
  const trimmed = input.trim();
  
  // If full URL
  const match = trimmed.match(/\/d\/([a-zA-Z0-9-_]+)/);
  const id = match ? match[1] : trimmed;

  const gidMatch = trimmed.match(/gid=([0-9]+)/);
  const gid = gidMatch ? gidMatch[1] : null;

  return { id, gid };
}

/**
 * Constructs public CSV export URL for Google Sheet.
 * @param {string} urlOrId - Google sheet URL or ID.
 * @param {string} [sheetName] - Optional tab name.
 * @returns {string} - Public CSV export URL.
 */
function getCsvExportUrl(urlOrId, sheetName = '') {
  const { id, gid } = extractSpreadsheetId(urlOrId);
  
  let baseUrl = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv`;

  if (sheetName && String(sheetName).trim()) {
    const sName = String(sheetName).trim();
    if (/^\d+$/.test(sName)) {
      baseUrl += `&gid=${sName}`;
    } else {
      baseUrl += `&sheet=${encodeURIComponent(sName)}`;
    }
  } else if (gid) {
    baseUrl += `&gid=${gid}`;
  }
  return baseUrl;
}

/**
 * Intelligently detects the header row index (0-indexed) in raw CSV rows.
 * @param {Array<Array<string>>} rawRows 
 * @param {string} [preferredPhoneCol] 
 * @returns {number}
 */
function detectHeaderRowIndex(rawRows, preferredPhoneCol = '') {
  if (!rawRows || rawRows.length === 0) return 0;

  const phoneKeywords = ['phone', 'mobile', 'whatsapp', 'tel', 'contact', 'number', 'phonenumber', 'cell', 'telepon', 'hp'];
  if (preferredPhoneCol) {
    phoneKeywords.unshift(preferredPhoneCol.trim().toLowerCase());
  }

  // Scan first 10 rows to find the row containing a phone keyword header
  for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
    const row = rawRows[i];
    if (!Array.isArray(row) || row.length === 0) continue;

    const rowStrings = row.map(cell => String(cell || '').trim().toLowerCase());
    
    // Check if any cell matches a phone keyword
    const hasPhoneCol = rowStrings.some(cell => 
      phoneKeywords.some(kw => cell.includes(kw))
    );

    if (hasPhoneCol) {
      return i; // Found header row index!
    }
  }

  // Fallback: Return first row with more than 1 non-empty column
  for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
    const nonCount = rawRows[i].filter(cell => String(cell || '').trim().length > 0).length;
    if (nonCount > 1) return i;
  }

  return 0;
}

/**
 * Fetches and parses Google Spreadsheet data.
 * @param {string} urlOrId - Google sheet URL or ID.
 * @param {Object} [options]
 * @param {string} [options.sheetName]
 * @param {number} [options.headerRow] - Optional 1-indexed header row (e.g. 2 for line 2)
 * @param {string} [options.phoneColumn]
 * @returns {Promise<{ headers: string[], rows: Object[], totalRows: number, headerRowIndex: number }>}
 */
async function fetchSheetData(urlOrId, options = {}) {
  const csvUrl = getCsvExportUrl(urlOrId, options.sheetName);
  
  try {
    const response = await axios.get(csvUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/csv,text/plain,*/*'
      },
      timeout: 15000
    });

    const csvContent = response.data;
    if (typeof csvContent !== 'string' || csvContent.includes('<!DOCTYPE html>') || csvContent.includes('Accounts.google.com')) {
      throw new Error('Spreadsheet is private or invalid. Make sure "Anyone with the link can view" is enabled on the Google Sheet.');
    }

    const rawRows = parse(csvContent, {
      columns: false,
      skip_empty_lines: true,
      trim: true
    });

    if (!rawRows || rawRows.length === 0) {
      return { headers: [], rows: [], totalRows: 0, headerRowIndex: 1 };
    }

    // Determine header row index (explicit options.headerRow or auto-detected)
    let headerIdx = options.headerRow ? (options.headerRow - 1) : detectHeaderRowIndex(rawRows, options.phoneColumn);
    if (headerIdx < 0 || headerIdx >= rawRows.length) headerIdx = 0;

    const headers = rawRows[headerIdx].map(h => String(h || '').trim());

    // Build row objects for rows following the header row
    const rows = [];
    for (let i = headerIdx + 1; i < rawRows.length; i++) {
      const rowArr = rawRows[i];
      if (!rowArr || rowArr.length === 0) continue;
      
      const rowObj = {};
      let hasData = false;
      headers.forEach((headerName, colIdx) => {
        if (headerName) {
          const val = rowArr[colIdx] !== undefined ? String(rowArr[colIdx]).trim() : '';
          rowObj[headerName] = val;
          if (val) hasData = true;
        }
      });
      if (hasData) rows.push(rowObj);
    }

    return {
      headers,
      rows,
      totalRows: rows.length,
      headerRowIndex: headerIdx + 1
    };
  } catch (err) {
    if (err.response && err.response.status === 404) {
      throw new Error(`Google Sheet not found (404). Check Spreadsheet ID: ${urlOrId}`);
    }
    throw new Error(`Failed to fetch Google Sheet data: ${err.message}`);
  }
}

/**
 * Intelligently finds phone number column from headers.
 * @param {string[]} headers 
 * @param {string} [preferredColumn] 
 * @returns {string|null}
 */
function findPhoneColumn(headers, preferredColumn = '') {
  if (!headers || headers.length === 0) return null;

  // 1. Direct match with preferred column
  if (preferredColumn) {
    const exact = headers.find(h => h.trim().toLowerCase() === preferredColumn.trim().toLowerCase());
    if (exact) return exact;
  }

  // 2. Common keywords
  const phoneKeywords = ['phone', 'mobile', 'whatsapp', 'tel', 'contact', 'number', 'phonenumber', 'cell', 'telepon', 'hp'];
  for (const kw of phoneKeywords) {
    const match = headers.find(h => h.trim().toLowerCase().includes(kw));
    if (match) return match;
  }

  // 3. Fallback to first header
  return headers[0] || null;
}

/**
 * Replaces placeholders like {Name}, {Phone}, {Date} in message template.
 * @param {string} template 
 * @param {Object} rowData 
 * @returns {string}
 */
function substituteTemplate(template, rowData) {
  if (!template) return '';
  if (!rowData || typeof rowData !== 'object') return template;

  return template.replace(/\{([^}]+)\}/g, (match, key) => {
    const trimmedKey = key.trim();
    // Look up key in rowData case-insensitively
    const actualKey = Object.keys(rowData).find(
      k => k.trim().toLowerCase() === trimmedKey.toLowerCase()
    );
    if (actualKey && rowData[actualKey] !== undefined && rowData[actualKey] !== null) {
      return String(rowData[actualKey]);
    }
    return match; // keep original {key} if not found in data
  });
}

module.exports = {
  extractSpreadsheetId,
  getCsvExportUrl,
  fetchSheetData,
  findPhoneColumn,
  substituteTemplate
};
