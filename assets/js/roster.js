/**
 * AttendEase — student list import.
 *
 * Lecturers upload the Excel sheet they already keep (StudentID + Name) or a
 * CSV/TSV export. No npm dependency is needed: .xlsx is a ZIP of XML files, so
 * the two parts we care about (shared strings and the first worksheet) are
 * inflated with the browser's own DecompressionStream.
 */

const HEADER_ID = /^(student\s*id|student\s*no|reg(istration)?\s*(no|number)?|id|adm(ission)?\s*(no|number)?)$/i;
const HEADER_NAME = /^(name|full\s*name|student\s*name)$/i;

function decodeEntities(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

function textOf(xml) {
  const parts = [];
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>/gi;
  let match;
  while ((match = re.exec(xml))) parts.push(decodeEntities(match[1]));
  return parts.join('');
}

/* ------------------------------------------------------------------ */
/* Row shaping                                                         */
/* ------------------------------------------------------------------ */

/** Turn cell rows into { regNo, name } entries, skipping headers/duplicates. */
export function rowsToStudents(rows) {
  const entries = [];
  const invalid = [];
  const seen = new Set();

  for (const cells of rows) {
    if (!cells || !cells.some((cell) => String(cell || '').trim())) continue;
    const values = cells.map((cell) => String(cell == null ? '' : cell).trim());
    let regNo = values[0] || '';
    let name = values[1] || '';

    // Ignore a header row such as "StudentID | Name".
    if (HEADER_ID.test(regNo) && (HEADER_NAME.test(name) || !name)) continue;
    if (!regNo && name) {
      invalid.push(values.join(' | '));
      continue;
    }
    if (!regNo) continue;

    if (!name) {
      invalid.push(values.join(' | '));
      continue;
    }

    const key = regNo.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ regNo, name: name.replace(/\s+/g, ' ') });
  }

  return { entries, invalid };
}

/* ------------------------------------------------------------------ */
/* CSV / TSV                                                           */
/* ------------------------------------------------------------------ */

function splitCsvLine(line, delimiter) {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      out.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

export function parseRosterText(text) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return { entries: [], invalid: [] };

  const first = lines[0];
  const counts = [
    [',', (first.match(/,/g) || []).length],
    ['\t', (first.match(/\t/g) || []).length],
    [';', (first.match(/;/g) || []).length]
  ].sort((a, b) => b[1] - a[1]);
  const delimiter = counts[0][1] > 0 ? counts[0][0] : null;

  const rows = lines.map((line) => {
    if (delimiter) return splitCsvLine(line, delimiter);
    // Fallback: "S001 Paul Oduor" on one line.
    const match = line.trim().match(/^(\S+)\s+(.+)$/);
    return match ? [match[1], match[2]] : [line.trim()];
  });

  return rowsToStudents(rows);
}

/* ------------------------------------------------------------------ */
/* XLSX (minimal ZIP + SpreadsheetML reader)                           */
/* ------------------------------------------------------------------ */

function readU16(view, offset) {
  return view.getUint16(offset, true);
}

function readU32(view, offset) {
  return view.getUint32(offset, true);
}

function findEndOfCentralDirectory(view) {
  const max = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let offset = view.byteLength - 22; offset >= max; offset--) {
    if (readU32(view, offset) === 0x06054b50) return offset;
  }
  return -1;
}

function centralDirectory(view) {
  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) throw new Error('This file is not a readable Excel workbook.');

  const count = readU16(view, eocd + 10);
  let offset = readU32(view, eocd + 16);
  const entries = new Map();

  for (let i = 0; i < count; i++) {
    if (offset + 46 > view.byteLength || readU32(view, offset) !== 0x02014b50) break;
    const method = readU16(view, offset + 10);
    const compressedSize = readU32(view, offset + 20);
    const nameLength = readU16(view, offset + 28);
    const extraLength = readU16(view, offset + 30);
    const commentLength = readU16(view, offset + 32);
    const localOffset = readU32(view, offset + 42);
    const nameBytes = new Uint8Array(view.buffer, view.byteOffset + offset + 46, nameLength);
    const name = new TextDecoder('utf-8').decode(nameBytes);
    entries.set(name, { method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('This browser cannot open .xlsx directly. Save the sheet as CSV and upload that instead.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntry(view, entry) {
  if (!entry) return null;
  const offset = entry.localOffset;
  if (readU32(view, offset) !== 0x04034b50) throw new Error('The workbook is damaged.');
  const nameLength = readU16(view, offset + 26);
  const extraLength = readU16(view, offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const raw = new Uint8Array(view.buffer, view.byteOffset + start, entry.compressedSize);
  const bytes = entry.method === 0 ? raw : await inflateRaw(raw);
  return new TextDecoder('utf-8').decode(bytes);
}

function columnIndex(ref) {
  const letters = String(ref || '').replace(/[^A-Z]/gi, '').toUpperCase();
  let value = 0;
  for (const ch of letters) value = value * 26 + (ch.charCodeAt(0) - 64);
  return value - 1;
}

function parseSheetXml(xml, shared) {
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(xml))) {
    const cells = [];
    const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1]))) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const type = (attrs.match(/\bt="([^"]+)"/i) || [])[1] || '';
      const ref = (attrs.match(/\br="([^"]+)"/i) || [])[1] || '';
      let value = '';

      if (type === 's') {
        const index = Number((body.match(/<v>([\s\S]*?)<\/v>/i) || [])[1]);
        value = Number.isInteger(index) ? shared[index] || '' : '';
      } else if (type === 'inlineStr') {
        value = textOf(body);
      } else {
        value = decodeEntities((body.match(/<v>([\s\S]*?)<\/v>/i) || [])[1] || '');
      }

      const index = columnIndex(ref);
      if (index >= 0) cells[index] = value;
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

async function readXlsx(file) {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const entries = centralDirectory(view);

  let shared = [];
  const sharedName = [...entries.keys()].find((name) => /sharedStrings\.xml$/i.test(name));
  if (sharedName) {
    const xml = await readZipEntry(view, entries.get(sharedName));
    shared = [];
    const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
    let match;
    while ((match = siRe.exec(xml || ''))) shared.push(textOf(match[1]));
  }

  const sheetName = [...entries.keys()].find((name) => /xl\/worksheets\/sheet\d*\.xml$/i.test(name));
  if (!sheetName) throw new Error('The workbook has no readable worksheet.');
  const sheet = await readZipEntry(view, entries.get(sheetName));
  return parseSheetXml(sheet || '', shared);
}

/** Read an uploaded .xlsx/.csv/.tsv/.txt file and return roster entries. */
export async function readRosterFile(file) {
  const name = String(file && file.name ? file.name : '').toLowerCase();
  if (name.endsWith('.xls') && !name.endsWith('.xlsx')) {
    throw new Error('Old .xls workbooks are not supported. Save as .xlsx or CSV and try again.');
  }
  if (name.endsWith('.xlsx')) {
    const rows = await readXlsx(file);
    return rowsToStudents(rows);
  }
  const text = await file.text();
  return parseRosterText(text);
}
