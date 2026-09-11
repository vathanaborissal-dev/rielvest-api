/**
 * A small RFC 4180 reader. The MEF datasets are plain, comma-separated and
 * occasionally quoted (company names contain commas), which this covers without
 * pulling in a dependency.
 */
export function parseCsv(text: string): string[][] {
  // Strip a UTF-8 BOM — several MEF exports carry one.
  const input = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** Reads a CSV with a header row into keyed records. */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  const header = rows[0];
  if (!header) return [];
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    header.forEach((key, index) => {
      record[key.trim()] = (row[index] ?? '').trim();
    });
    return record;
  });
}
