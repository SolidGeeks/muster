import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import {
  type Report, type Template, fmtDur, fmtLong, fmtSla, fmtHM, fmtT, LOG_LABEL, reportStatusLabel
} from '@muster/core';

const PT = 2.8346; // points per mm

function fromBase64(b64: string): Uint8Array {
  if (typeof atob === 'function') return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Uint8Array((globalThis as any).Buffer.from(b64, 'base64'));
}
const A4 = { w: 595.28, h: 841.89 };
const M = 18 * PT;
const CW = A4.w - 2 * M;
const BOTTOM = A4.h - 26 * PT;

const hex = (h: string): RGB => {
  const c = /^#[0-9a-f]{6}$/i.test(h) ? h.slice(1) : '121413';
  return rgb(parseInt(c.slice(0, 2), 16) / 255, parseInt(c.slice(2, 4), 16) / 255, parseInt(c.slice(4, 6), 16) / 255);
};
const INK = hex('#121413'), MUT = hex('#69706B'), RULE = hex('#DFE1DC'), FAINT = hex('#EBECE8'), CRIT = hex('#CC2A1E'), OK = hex('#127548'), WARN = hex('#9A6500'), HEADRULE = hex('#C9CCC6');

/** Standard PDF fonts only cover WinAnsi. Map or drop anything else. */
export function pdfText(s: unknown): string {
  return String(s ?? '')
    .replace(/→/g, '->').replace(/[−‐‑]/g, '-').replace(/[  ]/g, ' ').replace(/\t/g, '  ')
    .replace(/[^\x20-\x7E\xA1-\xFF\n“”‘’—–…•€·]/g, '');
}

interface Fonts { reg: PDFFont; bold: PDFFont; ital: PDFFont; mono: PDFFont; monoBold: PDFFont }

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of pdfText(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let line = '';
    for (const w of words) {
      const cand = line ? line + ' ' + w : w;
      if (font.widthOfTextAtSize(cand, size) <= width) { line = cand; continue; }
      if (line) out.push(line);
      if (font.widthOfTextAtSize(w, size) <= width) { line = w; continue; }
      // Break a very long word.
      let chunk = '';
      for (const ch of w) {
        if (font.widthOfTextAtSize(chunk + ch, size) > width) { out.push(chunk); chunk = ch; } else chunk += ch;
      }
      line = chunk;
    }
    out.push(line);
  }
  return out;
}

interface Col { head: string; width: number; align?: 'left' | 'right'; font?: keyof Fonts; size?: number }

export async function renderReportPdf(t: Template, r: Report): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const f: Fonts = {
    reg: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold),
    ital: await doc.embedFont(StandardFonts.HelveticaOblique), mono: await doc.embedFont(StandardFonts.Courier),
    monoBold: await doc.embedFont(StandardFonts.CourierBold)
  };
  const ACC = hex(t.accent);
  const d = r.data;
  let page: PDFPage = doc.addPage([A4.w, A4.h]);
  let y = M;

  const text = (s: string, x: number, yy: number, font: PDFFont, size: number, color: RGB, align: 'left' | 'right' = 'left') => {
    const str = pdfText(s);
    const dx = align === 'right' ? x - font.widthOfTextAtSize(str, size) : x;
    page.drawText(str, { x: dx, y: A4.h - yy, size, font, color });
  };
  const line = (x1: number, yy: number, x2: number, color: RGB, th = 0.6) => page.drawLine({ start: { x: x1, y: A4.h - yy }, end: { x: x2, y: A4.h - yy }, thickness: th, color });
  const newPage = () => { page = doc.addPage([A4.w, A4.h]); y = M; };
  const ensure = (h: number) => { if (y + h > BOTTOM) newPage(); };
  const para = (s: string, size: number, color: RGB, font: PDFFont) => {
    const lh = size * 1.42;
    String(s || '').split(/\n{2,}/).forEach((p, i) => {
      if (i) y += size * 0.6;
      for (const l of wrap(p.replace(/\n/g, ' '), font, size, CW)) { ensure(lh); text(l, M, y + size, font, size, color); y += lh; }
    });
  };
  const table = (cols: Col[], rows: string[][], colorFor?: (ri: number, ci: number) => RGB | undefined) => {
    const pad = 4.5, size = 8.5, lh = size * 1.32;
    const drawHead = () => {
      ensure(18);
      let x = M;
      for (const c of cols) { text(c.head, c.align === 'right' ? x + c.width - 6 : x, y + 9, f.monoBold, 6.5, MUT, c.align || 'left'); x += c.width; }
      y += 13; line(M, y, M + CW, HEADRULE, 0.8);
    };
    drawHead();
    rows.forEach((row, ri) => {
      const cells = row.map((v, ci) => wrap(v, f[cols[ci].font || 'reg'], cols[ci].size || size, cols[ci].width - 8));
      const h = Math.max(...cells.map(c => c.length)) * lh + pad * 2;
      if (y + h > BOTTOM) { newPage(); drawHead(); }
      let x = M;
      cells.forEach((lines, ci) => {
        const c = cols[ci], cs = c.size || size, font = f[c.font || 'reg'];
        const color = colorFor?.(ri, ci) || INK;
        lines.forEach((l, li) => text(l, c.align === 'right' ? x + c.width - 6 : x, y + pad + cs + li * lh, font, cs, color, c.align || 'left'));
        x += c.width;
      });
      y += h; line(M, y, M + CW, FAINT, 0.5);
    });
  };

  // Accent band and header
  page.drawRectangle({ x: 0, y: A4.h - 2.2 * PT, width: A4.w, height: 2.2 * PT, color: ACC });
  let logoDone = false;
  if (t.logo) {
    try {
      const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(t.logo);
      if (m) {
        const bytes = fromBase64(m[2]);
        const img = /png/i.test(m[1]) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        let h = 10 * PT, w = h * img.width / img.height;
        if (w > 55 * PT) { w = 55 * PT; h = w * img.height / img.width; }
        page.drawImage(img, { x: M, y: A4.h - y - h, width: w, height: h });
        logoDone = true;
      }
    } catch { logoDone = false; }
  }
  if (!logoDone) text(t.org, M, y + 19, f.bold, 13, INK);
  if (t.classification) {
    const label = pdfText(t.classification).toUpperCase();
    const tw = f.monoBold.widthOfTextAtSize(label, 7) + 12;
    page.drawRectangle({ x: A4.w - M - tw, y: A4.h - (y + 4.5 + 17), width: tw, height: 17, borderColor: CRIT, borderWidth: 0.8 });
    text(label, A4.w - M - 6, y + 16, f.monoBold, 7, CRIT, 'right');
  }
  y += 14 * PT; line(M, y, A4.w - M, RULE, 0.8); y += 9 * PT;
  text(r.num, M, y, f.mono, 9, ACC); y += 8 * PT;
  const titleLines = wrap(d.name, f.bold, 21, CW);
  titleLines.forEach(l => { text(l, M, y + 4, f.bold, 21, INK); y += 24; });
  text(`Incident report · ${d.ref}${d.mode === 'exercise' ? ' (exercise)' : ''} · ${d.pbCode} ${d.pbName} v${d.v}`, M, y + 4, f.reg, 10, MUT);
  y += 7 * PT;

  const withSla = d.steps.filter(s => s.sla), met = withSla.filter(s => !s.breach).length;
  const sevC = ({ Low: OK, Medium: WARN, High: CRIT, Critical: CRIT } as Record<string, RGB>)[r.severity] || INK;
  const meta: [string, string][] = [['Severity', r.severity], ['Status', reportStatusLabel(d.status)], ['Declared', fmtLong(d.startedAt)], ['Duration', fmtDur(d.duration)], ['SLAs met', withSla.length ? `${met} / ${withSla.length}` : '-'], ['Author', r.author]];
  line(M, y, A4.w - M, INK, 1.1);
  meta.forEach(([k, v], i) => {
    const cx = M + (i % 3) * (CW / 3), cy = y + Math.floor(i / 3) * 13 * PT;
    text(k.toUpperCase(), cx, cy + 5 * PT, f.mono, 6.5, MUT);
    text(v, cx, cy + 10 * PT, f.bold, 9.5, k === 'Severity' ? sevC : INK);
  });
  line(M, y + 13 * PT, A4.w - M, RULE); line(M, y + 26 * PT, A4.w - M, RULE);
  y += 36 * PT;

  const sections: Record<string, () => void> = {
    summary: () => para(r.summary, 10.5, INK, f.reg),
    notes: () => r.notes ? para(r.notes, 10, INK, f.reg) : para('No analyst notes.', 9.5, MUT, f.ital),
    timeline: () => table(
      [{ head: 'UTC', width: 40, font: 'mono' }, { head: 'T+', width: 38, font: 'mono' }, { head: 'TYPE', width: 50, font: 'mono', size: 6.5 }, { head: 'EVENT', width: CW - 128 }],
      d.timeline.map(l => [fmtHM(d.startedAt + l.t), fmtT(l.t).slice(2), LOG_LABEL[l.kind] || '', l.msg + (l.by ? ` (${l.by})` : '')]),
      (ri, ci) => { const k = d.timeline[ri].kind; if (k === 'crit') return CRIT; if (ci === 2) return k === 'ok' ? OK : k === 'warn' ? WARN : MUT; return undefined; }
    ),
    sla: () => {
      if (!d.steps.length) return para('No steps were completed.', 9.5, MUT, f.ital);
      table(
        [{ head: 'STEP', width: CW - 245 }, { head: 'OWNER', width: 75 }, { head: 'TARGET', width: 50, align: 'right', font: 'mono' }, { head: 'ACTUAL', width: 70, align: 'right', font: 'mono' }, { head: 'STATUS', width: 50, align: 'right', font: 'bold' }],
        d.steps.map(s => [`${s.code}  ${s.title}`, s.role || '-', s.sla ? fmtSla(s.sla) : '-', fmtDur(s.dur), !s.sla ? '-' : s.breach ? 'Breached' : 'Met']),
        (ri, ci) => { const s = d.steps[ri]; return ci === 4 && s.sla ? (s.breach ? CRIT : OK) : undefined; }
      );
      if (withSla.length) { y += 10; para(`${met} of ${withSla.length} SLAs met.`, 8.5, MUT, f.reg); }
    },
    decisions: () => {
      if (!d.decisions.length) return para('No decisions recorded.', 9.5, MUT, f.ital);
      for (const x of d.decisions) {
        ensure(13 * PT);
        text(wrap(x.q, f.reg, 10, CW - 100)[0] || '', M, y + 11, f.reg, 10, INK);
        text(x.a.toUpperCase(), A4.w - M, y + 11, f.monoBold, 8.5, INK, 'right');
        text('Led to ' + x.to, M, y + 25, f.reg, 8.5, MUT);
        y += 12 * PT; line(M, y, A4.w - M, FAINT, 0.5); y += 2 * PT;
      }
    },
    signoff: () => {
      ensure(30 * PT);
      const w = (CW - 12 * PT) / 3;
      [['Prepared by', r.author], ['Reviewed by', ''], ['Approved by', '']].forEach(([k, v], i) => {
        const x = M + i * (w + 6 * PT);
        text(k.toUpperCase(), x, y + 3 * PT, f.mono, 6.5, MUT);
        if (v) text(v, x, y + 9 * PT, f.bold, 10, INK);
        line(x, y + 20 * PT, x + w, INK, 0.8);
        text('DATE', x, y + 25 * PT, f.mono, 6.5, MUT);
      });
      y += 28 * PT;
    }
  };

  t.sections.filter(s => s.on).forEach((s, i) => {
    ensure(24 * PT);
    text(String(i + 1).padStart(2, '0'), M, y, f.mono, 8, ACC);
    text(s.title, M + 9 * PT, y, f.bold, 12, INK);
    y += 3 * PT; line(M, y, A4.w - M, RULE); y += 5 * PT;
    sections[s.key]?.();
    y += 9 * PT;
  });

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    page = p;
    line(M, A4.h - 16 * PT, A4.w - M, RULE);
    wrap(t.footer, f.reg, 7, CW - 160).slice(0, 2).forEach((l, li) => text(l, M, A4.h - 11.5 * PT + li * 9, f.reg, 7, MUT));
    text(`${r.num}  ·  ${i + 1}/${pages.length}`, A4.w - M, A4.h - 11.5 * PT, f.mono, 7, MUT, 'right');
  });
  doc.setTitle(pdfText(`${r.num} ${d.name}`));
  doc.setSubject('Incident report');
  doc.setAuthor(pdfText(r.author));
  doc.setCreator('Muster');
  doc.setProducer('Muster');
  return doc.save();
}
