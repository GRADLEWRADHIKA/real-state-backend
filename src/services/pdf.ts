/**
 * Server-side PDFs (jsPDF running in Node): payment receipts and tabular report exports.
 * The dashboard and the app both download these, so a receipt is byte-for-byte the same everywhere.
 */
import fs from 'node:fs';
import path from 'node:path';
import { jsPDF } from 'jspdf';
import { amountInWords, fmtDateLong, rs, type ReceiptData } from '@estateflow/shared';
import { config } from '../config.js';

type RGB = [number, number, number];
const GREEN: RGB = [15, 81, 50];
const GOLD: RGB = [197, 157, 9];
const INK: RGB = [28, 27, 24];
const MUTED: RGB = [120, 113, 108];

let logo: string | null | undefined;
function logoData() {
  if (logo !== undefined) return logo;
  try {
    logo = `data:image/png;base64,${fs.readFileSync(path.join(config.assetsDir, 'logo.png')).toString('base64')}`;
  } catch {
    logo = null;
  }
  return logo;
}

const ascii = (s: string | null | undefined) => (s ?? '').replace(/₹/g, 'Rs. ').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

export function receiptFileName(r: Pick<ReceiptData, 'receipt_number' | 'code'>) {
  return `${(r.receipt_number ?? r.code).replace(/\//g, '-')}.pdf`;
}

/** Vector A4 receipt. */
export function receiptPdf(r: ReceiptData): Buffer {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 48;
  doc.setProperties({ title: `Receipt ${r.receipt_number ?? r.code}`, creator: 'EstateFlow CRM' });

  // Header band
  doc.setFillColor(...GREEN);
  doc.rect(0, 0, W, 110, 'F');
  const img = logoData();
  if (img) doc.addImage(img, 'PNG', M, 22, 66, 66);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text(ascii(r.company.name) || 'Starwiz Realty Pvt. Ltd.', M + 82, 46);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const addr = doc.splitTextToSize(ascii(r.company.address), 300);
  doc.text(addr, M + 82, 61);
  doc.text([r.company.phone, r.company.email, r.company.website].filter(Boolean).join('  |  '), M + 82, 61 + addr.length * 10 + 2);
  doc.setTextColor(...GOLD);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(r.status === 'Completed' ? 'PAYMENT RECEIPT' : r.status === 'Pending' ? 'PAYMENT ACKNOWLEDGEMENT' : 'PAYMENT FAILED', W - M, 46, { align: 'right' });
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(r.receipt_number ?? r.code, W - M, 62, { align: 'right' });
  doc.text(fmtDateLong(r.payment_date), W - M, 75, { align: 'right' });
  if (r.company.gstin) doc.text(`GSTIN ${r.company.gstin}`, W - M, 88, { align: 'right' });

  // Parties
  let y = 150;
  doc.setTextColor(...MUTED);
  doc.setFontSize(8);
  doc.text('RECEIVED FROM', M, y);
  doc.text('PROPERTY', W / 2 + 10, y);
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(ascii(r.customer.name), M, y + 17);
  doc.text(ascii(`${r.property_project ?? ''} · ${r.property_unit ?? ''}`), W / 2 + 10, y + 17);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  const caddr = doc.splitTextToSize(ascii([r.customer.address, r.customer.phone, r.customer.email].filter(Boolean).join('\n')), W / 2 - M - 20);
  doc.text(caddr, M, y + 32);
  doc.text([ascii(r.property_name), `Customer ID: ${r.customer.code}`, r.company.rera ? `RERA: ${r.company.rera}` : ''].filter(Boolean), W / 2 + 10, y + 32);

  // Payment table
  y = 250;
  doc.setFillColor(246, 245, 241);
  doc.rect(M, y, W - 2 * M, 26, 'F');
  doc.setTextColor(...MUTED);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('DESCRIPTION', M + 12, y + 17);
  doc.text('METHOD', M + 250, y + 17);
  doc.text('AMOUNT', W - M - 12, y + 17, { align: 'right' });
  y += 26;
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text(ascii(`${r.type}${r.installment_label ? ` - ${r.installment_label}` : ''}`), M + 12, y + 22);
  doc.text(rs(r.amount), W - M - 12, y + 22, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.text(r.method, M + 250, y + 22);
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text(ascii(`Txn ID: ${r.code}${r.reference ? `   ·   Ref: ${r.reference}` : ''}`), M + 12, y + 38);
  y += 54;
  doc.setDrawColor(231, 229, 224);
  doc.line(M, y, W - M, y);

  // Totals
  const row = (label: string, value: string, bold = false, color: RGB = INK) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 11 : 9.5);
    doc.setTextColor(...MUTED);
    doc.text(label, W - M - 220, y);
    doc.setTextColor(...color);
    doc.text(value, W - M - 12, y, { align: 'right' });
    y += bold ? 22 : 18;
  };
  y += 22;
  row(r.status === 'Completed' ? 'Amount received' : 'Amount (awaiting clearance)', rs(r.amount), true, GREEN);
  row('Total property value', rs(r.customer.total_value));
  row('Paid to date', rs(r.paid_to_date));
  row('Outstanding balance', rs(r.outstanding_after), true);

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text(amountInWords(r.amount).replace('Rupees', 'Amount in words: Rupees'), M, y + 10);

  // Signature
  y += 70;
  doc.setDrawColor(200, 196, 188);
  doc.line(W - M - 180, y, W - M, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(`For ${ascii(r.company.name) || 'Starwiz Realty Pvt. Ltd.'}`, W - M, y + 14, { align: 'right' });
  doc.text('Authorised signatory', W - M, y + 26, { align: 'right' });
  if (r.recorded_by_name) doc.text(`Recorded by ${ascii(r.recorded_by_name)}`, M, y + 26);

  doc.setFontSize(8);
  doc.text('This is a computer-generated receipt and is valid subject to realisation of the payment.', M, 800);
  doc.text('Generated by EstateFlow CRM', W - M, 800, { align: 'right' });
  return Buffer.from(doc.output('arraybuffer'));
}

export interface PdfColumn {
  label: string;
  width: number;
  align?: 'left' | 'right';
}

/** Landscape A4 table report with a branded header and page numbers. */
export function tablePdf(opts: { title: string; subtitle?: string; company: string; columns: PdfColumn[]; rows: (string | number)[][]; totals?: (string | number)[] }): Buffer {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  const scale = (W - 2 * M) / opts.columns.reduce((s, c) => s + c.width, 0);
  const cols = opts.columns.map((c) => ({ ...c, width: c.width * scale }));
  doc.setProperties({ title: opts.title, creator: 'EstateFlow CRM' });

  const header = () => {
    doc.setFillColor(...GREEN);
    doc.rect(0, 0, W, 64, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text(ascii(opts.title), M, 30);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(ascii([opts.company, opts.subtitle].filter(Boolean).join('  ·  ')), M, 47);
    doc.text(`Generated ${fmtDateLong(new Date().toISOString())}`, W - M, 47, { align: 'right' });
    let x = M;
    doc.setFillColor(246, 245, 241);
    doc.rect(M, 80, W - 2 * M, 22, 'F');
    doc.setTextColor(...MUTED);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    for (const c of cols) {
      doc.text(c.label.toUpperCase(), c.align === 'right' ? x + c.width - 6 : x + 6, 94, { align: c.align === 'right' ? 'right' : 'left' });
      x += c.width;
    }
    return 116;
  };

  const drawRow = (cells: (string | number)[], y: number, bold = false) => {
    let x = M;
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...INK);
    cols.forEach((c, i) => {
      const text = doc.splitTextToSize(ascii(String(cells[i] ?? '')), c.width - 10)[0] ?? '';
      doc.text(text, c.align === 'right' ? x + c.width - 6 : x + 6, y, { align: c.align === 'right' ? 'right' : 'left' });
      x += c.width;
    });
  };

  let y = header();
  if (!opts.rows.length) {
    doc.setTextColor(...MUTED);
    doc.setFont('helvetica', 'normal');
    doc.text('No records for this period.', M + 6, y);
  }
  for (const r of opts.rows) {
    if (y > H - 50) {
      doc.addPage();
      y = header();
    }
    drawRow(r, y);
    doc.setDrawColor(236, 234, 229);
    doc.line(M, y + 6, W - M, y + 6);
    y += 18;
  }
  if (opts.totals) {
    if (y > H - 50) {
      doc.addPage();
      y = header();
    }
    drawRow(opts.totals, y + 4, true);
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 18, { align: 'right' });
    doc.text('EstateFlow CRM', M, H - 18);
  }
  return Buffer.from(doc.output('arraybuffer'));
}

export interface RefundPdfData {
  receipt_number: string;
  refund_date: string;
  customer: { name: string; code: string; phone: string; address?: string | null };
  property?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  paid_total: number;
  deduction: number;
  deduction_reason?: string | null;
  refund_amount: number;
  method: string;
  reference?: string | null;
  company: { name: string; address: string; phone: string; email: string; website: string };
}

/** Refund receipt for a cancelled booking: what was paid, what was deducted and why, and what was returned. */
export function refundPdf(r: RefundPdfData): Buffer {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 48;
  doc.setProperties({ title: `Refund ${r.receipt_number}`, creator: 'EstateFlow CRM' });
  doc.setFillColor(...GREEN);
  doc.rect(0, 0, W, 110, 'F');
  const img = logoData();
  if (img) doc.addImage(img, 'PNG', M, 22, 66, 66);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text(ascii(r.company.name) || 'Starwiz Realty', M + 82, 46);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const addr = doc.splitTextToSize(ascii(r.company.address), 300);
  doc.text(addr, M + 82, 61);
  doc.text([r.company.phone, r.company.email, r.company.website].filter(Boolean).join('  |  '), M + 82, 61 + addr.length * 10 + 2);
  doc.setTextColor(...GOLD);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('REFUND RECEIPT', W - M, 46, { align: 'right' });
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`No. ${r.receipt_number}`, W - M, 62, { align: 'right' });
  doc.text(`Date ${fmtDateLong(r.refund_date)}`, W - M, 75, { align: 'right' });

  let y = 150;
  doc.setTextColor(28, 27, 24);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Refunded to', M, y);
  doc.text('Booking', W / 2 + 10, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text([ascii(r.customer.name), `Customer ID ${r.customer.code}`, r.customer.phone, ascii(r.customer.address ?? '')].filter(Boolean), M, y + 16);
  doc.text(
    [ascii(r.property ?? ''), r.cancelled_at ? `Cancelled ${fmtDateLong(r.cancelled_at)}` : '', ascii(r.cancel_reason ?? '')].filter(Boolean).map((t) => doc.splitTextToSize(t, W / 2 - M - 10)).flat(),
    W / 2 + 10,
    y + 16,
  );

  y = 260;
  const row = (label: string, value: string, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 12 : 10.5);
    doc.text(label, M, y);
    doc.text(value, W - M, y, { align: 'right' });
    y += bold ? 26 : 22;
  };
  doc.setDrawColor(225, 222, 216);
  doc.line(M, y - 16, W - M, y - 16);
  row('Total paid towards the booking', rs(r.paid_total));
  row(`Less deduction${r.deduction_reason ? ` (${ascii(r.deduction_reason)})` : ''}`, r.deduction ? `- ${rs(r.deduction)}` : rs(0));
  doc.line(M, y - 12, W - M, y - 12);
  y += 4;
  row('Amount refunded', rs(r.refund_amount), true);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`In words: ${ascii(amountInWords(r.refund_amount))}`, M, y);
  y += 18;
  doc.text(`Paid by ${r.method}${r.reference ? `  ·  Ref ${ascii(r.reference)}` : ''}`, M, y);

  y = 560;
  doc.setFontSize(9);
  doc.setTextColor(110, 106, 99);
  doc.text('This refund settles the cancelled booking above. Please keep this receipt for your records.', M, y);
  doc.setTextColor(28, 27, 24);
  doc.text('Authorised signatory', W - M, y + 60, { align: 'right' });
  doc.text(ascii(r.company.name), W - M, y + 74, { align: 'right' });
  return Buffer.from(doc.output('arraybuffer'));
}
