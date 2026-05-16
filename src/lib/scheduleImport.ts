// Schedule import: parses a Kronos "Wall Schedule" export (PDF or image)
// into team members with status, role, seniority, weekly shifts and
// time-off. PDFs use the embedded text layer (most accurate); images and
// scanned PDFs fall back to Tesseract OCR with word positions.

export interface ParsedMember {
  name: string;
  status: 'FT' | 'PT';
  role?: string;
  seniorityDate?: string;
  shifts: string[]; // length 7, Sun..Sat
  timeOff: { date: string; type: 'Paid' | 'Unpaid'; note?: string }[];
  unavailable: string[]; // length 7
}

export interface ImportResult {
  members: ParsedMember[];
  warnings: string[];
  source: 'pdf-text' | 'ocr';
}

interface Tok { text: string; x: number; y: number }

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { pdfjsLib?: any; Tesseract?: any }
}

const TIME_RANGE =
  /(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]?\.?\s*[-–—to]+\s*(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]?\.?/;

export function normalizeShift(raw: string): string | null {
  const m = raw.match(TIME_RANGE);
  if (!m) return null;
  const h1 = parseInt(m[1], 10);
  const m1 = m[2] || '00';
  const ap1 = m[3].toUpperCase();
  const h2 = parseInt(m[4], 10);
  const m2 = m[5] || '00';
  const ap2 = m[6].toUpperCase();
  if (h1 < 1 || h1 > 12 || h2 < 1 || h2 > 12) return null;
  return `${h1}:${m1} ${ap1}M - ${h2}:${m2} ${ap2}M`;
}

function empty7(): string[] { return ['', '', '', '', '', '', '']; }

// Group tokens into visual text lines by Y proximity.
function toLines(tokens: Tok[]): { y: number; toks: Tok[] }[] {
  if (tokens.length === 0) return [];
  const sorted = [...tokens].sort((a, b) => a.y - b.y || a.x - b.x);
  const ys = sorted.map(t => t.y).sort((a, b) => a - b);
  const diffs: number[] = [];
  for (let i = 1; i < ys.length; i++) { const d = ys[i] - ys[i - 1]; if (d > 0) diffs.push(d); }
  diffs.sort((a, b) => a - b);
  const medianGap = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 6;
  const tol = Math.max(2, medianGap * 1.5);

  const lines: { y: number; toks: Tok[] }[] = [];
  for (const t of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(t.y - last.y) <= tol) {
      last.toks.push(t);
      last.y = (last.y * (last.toks.length - 1) + t.y) / last.toks.length;
    } else {
      lines.push({ y: t.y, toks: [t] });
    }
  }
  for (const l of lines) l.toks.sort((a, b) => a.x - b.x);
  return lines;
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function parseTokens(tokens: Tok[], warnings: string[]): ParsedMember[] {
  const lines = toLines(tokens);
  if (lines.length === 0) return [];

  // Locate the header row and the X centres of the 7 day columns.
  let dayCenters: number[] | null = null;
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const centers: number[] = new Array(7).fill(NaN);
    let hits = 0;
    for (const tk of lines[i].toks) {
      const w = tk.text.toLowerCase().replace(/[^a-z]/g, '').slice(0, 3);
      const d = WEEKDAYS.indexOf(w);
      if (d >= 0 && isNaN(centers[d])) { centers[d] = tk.x; hits++; }
    }
    if (hits >= 5) {
      // Fill any missed day centres by even spacing between known ones.
      const known = centers.map((c, idx) => ({ c, idx })).filter(o => !isNaN(o.c));
      if (known.length >= 2) {
        const first = known[0], last = known[known.length - 1];
        const step = (last.c - first.c) / (last.idx - first.idx);
        for (let d = 0; d < 7; d++) if (isNaN(centers[d])) centers[d] = first.c + step * (d - first.idx);
        dayCenters = centers;
        headerIdx = i;
        break;
      }
    }
  }

  if (!dayCenters) {
    warnings.push('Could not detect the day-of-week header row. Make sure the export shows Sun–Sat columns.');
    return [];
  }

  const gap = (dayCenters[6] - dayCenters[0]) / 6;
  const labelCutoff = dayCenters[0] - gap * 0.6; // left of this = name/role/total area

  function colForX(x: number): number {
    let best = 0, bestD = Infinity;
    for (let d = 0; d < 7; d++) {
      const dist = Math.abs(x - dayCenters![d]);
      if (dist < bestD) { bestD = dist; best = d; }
    }
    return best;
  }

  const NAME_RE = /^([A-Za-z][A-Za-z'.-]+),\s*([A-Za-z][A-Za-z'.-]+)(?:\s+([A-Za-z]))?/;
  const SENIORITY_RE = /\b([FP])\s*(\d{4}-\d{2}-\d{2})\b/;
  const ROLE_RE = /\bwr[_\s]?([A-Za-z][A-Za-z_ ]+)/i;

  // Member block boundaries: a line whose label area begins a "Last, First".
  const starts: number[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const labelToks = lines[i].toks.filter(t => t.x < labelCutoff);
    if (labelToks.length === 0) continue;
    const labelText = labelToks.map(t => t.text).join(' ').replace(/\s+/g, ' ').trim();
    if (/^<?\s*open\s*shift/i.test(labelText)) { starts.push(-(i + 1)); continue; } // mark skip
    if (NAME_RE.test(labelText)) starts.push(i);
  }
  const realStarts = starts.filter(s => s >= 0);
  if (realStarts.length === 0) {
    warnings.push('No employee rows detected. The layout may differ from a Kronos Wall Schedule export.');
    return [];
  }

  const allStops = [...starts.map(s => Math.abs(s) - (s < 0 ? 1 : 0)), lines.length].sort((a, b) => a - b);

  const members: ParsedMember[] = [];
  for (const startLine of realStarts) {
    const nextStop = allStops.find(s => s > startLine) ?? lines.length;
    const block = lines.slice(startLine, nextStop);

    const labelText = block
      .flatMap(l => l.toks.filter(t => t.x < labelCutoff))
      .map(t => t.text).join(' ').replace(/\s+/g, ' ').trim();

    const nameM = labelText.match(NAME_RE);
    if (!nameM) continue;
    if (/open shift/i.test(labelText)) continue;
    const name = `${nameM[2]}${nameM[3] ? ' ' + nameM[3] : ''} ${nameM[1]}`.trim();

    const sen = labelText.match(SENIORITY_RE);
    const status: 'FT' | 'PT' = sen && sen[1].toUpperCase() === 'F' ? 'FT' : 'PT';
    const seniorityDate = sen ? sen[2] : undefined;

    let role: string | undefined;
    const roleM = labelText.match(ROLE_RE);
    if (roleM) {
      role = roleM[1].replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
        .split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }

    const shifts = empty7();
    const unavailable = empty7();
    const timeOff: ParsedMember['timeOff'] = [];

    for (const ln of block) {
      // Build per-column text for this visual line.
      const byCol: string[] = ['', '', '', '', '', '', ''];
      for (const tk of ln.toks) {
        if (tk.x < labelCutoff) continue;
        const c = colForX(tk.x);
        byCol[c] += (byCol[c] ? ' ' : '') + tk.text;
      }
      for (let d = 0; d < 7; d++) {
        const cell = byCol[d];
        if (!cell) continue;
        if (/paid\s*day\s*off/i.test(cell)) {
          if (!timeOff.some(t => t.note === 'Paid Day Off' && t.date === dayDate(d))) {
            timeOff.push({ date: dayDate(d), type: 'Paid', note: 'Paid Day Off' });
          }
          if (!unavailable[d]) unavailable[d] = 'Time Off';
          continue;
        }
        if (/\bunpaid\b/i.test(cell) && !TIME_RANGE.test(cell)) {
          if (!timeOff.some(t => t.note === 'Unpaid' && t.date === dayDate(d))) {
            timeOff.push({ date: dayDate(d), type: 'Unpaid', note: 'Unpaid' });
          }
          if (!unavailable[d]) unavailable[d] = 'Time Off';
          continue;
        }
        if (!shifts[d]) {
          const norm = normalizeShift(cell);
          if (norm) shifts[d] = norm;
        }
      }
    }

    members.push({ name, status, role, seniorityDate, shifts, timeOff, unavailable });
  }

  // Header day dates (e.g. "05/17") for time-off dates; assume the year that
  // keeps the week closest to today.
  function dayDate(d: number): string {
    const tok = lines[headerIdx].toks.find(t => {
      const w = t.text.toLowerCase().replace(/[^a-z]/g, '').slice(0, 3);
      return WEEKDAYS[d] === w;
    });
    // Look for an MM/DD near that weekday token on the header line.
    const around = lines[headerIdx].toks
      .filter(t => tok && Math.abs(t.x - tok.x) < gap * 0.9)
      .map(t => t.text).join(' ');
    const md = around.match(/(\d{1,2})[/-](\d{1,2})/);
    if (!md) return '';
    const mm = md[1].padStart(2, '0');
    const dd = md[2].padStart(2, '0');
    const yr = new Date().getFullYear();
    return `${yr}-${mm}-${dd}`;
  }

  if (members.length === 0) {
    warnings.push('Detected the table but could not read any employee rows clearly.');
  }
  return members;
}

async function tokensFromPdf(file: File): Promise<{ tokens: Tok[]; hadText: boolean }> {
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib) throw new Error('PDF engine not loaded. Check your connection and try again.');
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const tokens: Tok[] = [];
  let pageOffset = 0;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    for (const item of content.items as any[]) {
      const str = (item.str || '').trim();
      if (!str) continue;
      const x = item.transform[4];
      const y = pageOffset + (viewport.height - item.transform[5]);
      tokens.push({ text: str, x, y });
    }
    pageOffset += viewport.height + 50;
  }
  return { tokens, hadText: tokens.length > 20 };
}

async function ocrToTokens(source: File | HTMLCanvasElement, warnings: string[]): Promise<Tok[]> {
  const Tesseract = window.Tesseract;
  if (!Tesseract) throw new Error('OCR engine not loaded. Check your connection and try again.');
  const result = await Tesseract.recognize(source, 'eng', {}, { blocks: true });
  const data = result.data || {};
  const tokens: Tok[] = [];

  const pushWord = (w: any) => {
    const text = (w.text || '').trim();
    const bb = w.bbox || w.boundingBox;
    if (text && bb) tokens.push({ text, x: bb.x0 ?? bb.left ?? 0, y: bb.y0 ?? bb.top ?? 0 });
  };

  if (Array.isArray(data.words) && data.words.length) {
    data.words.forEach(pushWord);
  } else if (Array.isArray(data.blocks) && data.blocks.length) {
    for (const b of data.blocks)
      for (const par of b.paragraphs || [])
        for (const ln of par.lines || [])
          for (const w of ln.words || []) pushWord(w);
  } else if (Array.isArray(data.lines) && data.lines.length) {
    data.lines.forEach((ln: any, i: number) => {
      const text = (ln.text || '').trim();
      const bb = ln.bbox || {};
      if (text) text.split(/\s+/).forEach((wt: string, j: number) =>
        tokens.push({ text: wt, x: (bb.x0 ?? 0) + j * 40, y: bb.y0 ?? i * 20 }));
    });
  }

  if (tokens.length === 0 && typeof data.text === 'string') {
    warnings.push('OCR returned no word positions; column accuracy may be reduced. A PDF export gives the best results.');
    data.text.split('\n').forEach((line: string, i: number) => {
      line.trim().split(/\s{2,}|\t/).forEach((seg, j) => {
        const s = seg.trim();
        if (s) tokens.push({ text: s, x: j * 120, y: i * 20 });
      });
    });
  }
  return tokens;
}

async function renderPdfToCanvas(file: File): Promise<HTMLCanvasElement[]> {
  const pdfjsLib = window.pdfjsLib;
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const canvases: HTMLCanvasElement[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    canvases.push(canvas);
  }
  return canvases;
}

export async function importScheduleFile(file: File): Promise<ImportResult> {
  const warnings: string[] = [];
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

  if (isPdf) {
    const { tokens, hadText } = await tokensFromPdf(file);
    if (hadText) {
      const members = parseTokens(tokens, warnings);
      if (members.length > 0) return { members, warnings, source: 'pdf-text' };
      warnings.push('No rows found in the PDF text layer; retrying with OCR.');
    }
    // Scanned PDF — OCR each rendered page.
    const canvases = await renderPdfToCanvas(file);
    const all: Tok[] = [];
    let offset = 0;
    for (const c of canvases) {
      const t = await ocrToTokens(c, warnings);
      t.forEach(tk => all.push({ ...tk, y: tk.y + offset }));
      offset += c.height + 50;
    }
    return { members: parseTokens(all, warnings), warnings, source: 'ocr' };
  }

  const tokens = await ocrToTokens(file, warnings);
  return { members: parseTokens(tokens, warnings), warnings, source: 'ocr' };
}
