import * as pdfjsLib from 'pdfjs-dist';
import { createWorker } from 'tesseract.js';
import { MandatoryDocType, UserDocStatus } from '../types/telecom';

// Configure pdfjs worker
if (typeof window !== 'undefined' && 'Worker' in window) {
  // Use CDN worker or standard fallback
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version || '3.11.174'}/pdf.worker.min.js`;
}

export interface DocDurationConfig {
  type: MandatoryDocType;
  label: string;
  defaultMonths: number;
}

export const DEFAULT_DOC_DURATIONS: Record<MandatoryDocType, number> = {
  ASO: 12,
  NR10: 24,
  NR35: 24,
  NR06: 12,
  PCMSO: 12,
  PGR: 12,
  CNH: 60,
  CRLV: 12,
  PRIMEIROS_SOCORROS: 24,
  CONTRATO_TRABALHO: 24,
  RG: 120,
};

export interface ExtractedDateResult {
  suggestedDate: string; // YYYY-MM-DD
  rawDateText: string;
  origin: 'validade_lida' | 'calculada_emissao' | 'manual';
  originDescription: string;
  extractedTextPreview: string;
  confidence: 'high' | 'medium' | 'low';
}

const MONTH_NAME_MAP: Record<string, string> = {
  janeiro: '01',
  jan: '01',
  fevereiro: '02',
  fev: '02',
  marco: '03',
  março: '03',
  mar: '03',
  abril: '04',
  abr: '04',
  maio: '05',
  mai: '05',
  junho: '06',
  jun: '06',
  julho: '07',
  jul: '07',
  agosto: '08',
  ago: '08',
  setembro: '09',
  set: '09',
  outubro: '10',
  out: '10',
  novembro: '11',
  nov: '11',
  dezembro: '12',
  dez: '12',
};

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function parseDateToIso(dayStr: string, monthStr: string, yearStr: string): string | null {
  let day = parseInt(dayStr, 10);
  let month = parseInt(monthStr, 10);
  let year = parseInt(yearStr, 10);

  if (isNaN(day) || isNaN(year)) return null;

  // Handle month by name if not numeric
  if (isNaN(month)) {
    const cleanM = normalizeText(monthStr).trim();
    if (MONTH_NAME_MAP[cleanM]) {
      month = parseInt(MONTH_NAME_MAP[cleanM], 10);
    } else {
      return null;
    }
  }

  if (year < 100) {
    year += year > 50 ? 1900 : 2000;
  }

  if (year < 1980 || year > 2050 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

export function addMonthsToIsoDate(isoDate: string, months: number): string {
  try {
    const [y, m, d] = isoDate.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setMonth(date.getMonth() + months);
    const resY = date.getFullYear();
    const resM = String(date.getMonth() + 1).padStart(2, '0');
    const resD = String(date.getDate()).padStart(2, '0');
    return `${resY}-${resM}-${resD}`;
  } catch {
    return isoDate;
  }
}

export function evaluateDocStatus(expiresAt?: string): {
  status: UserDocStatus;
  statusLabel: string;
  daysRemaining: number | null;
} {
  if (!expiresAt || !expiresAt.trim()) {
    return {
      status: 'PENDENTE',
      statusLabel: 'Pendente',
      daysRemaining: null,
    };
  }

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [y, m, d] = expiresAt.split('-').map(Number);
    const expDate = new Date(y, m - 1, d);
    expDate.setHours(0, 0, 0, 0);

    const diffMs = expDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return {
        status: 'VENCIDO',
        statusLabel: 'Vencido',
        daysRemaining: diffDays,
      };
    }
    if (diffDays <= 30) {
      return {
        status: 'A_VENCER',
        statusLabel: 'Vence em breve',
        daysRemaining: diffDays,
      };
    }
    return {
      status: 'VALIDADO',
      statusLabel: 'Válido',
      daysRemaining: diffDays,
    };
  } catch {
    return {
      status: 'PENDENTE',
      statusLabel: 'Pendente',
      daysRemaining: null,
    };
  }
}

/**
 * Extract text from PDF file using pdfjs-dist
 */
export async function extractTextFromPdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  let fullText = '';

  for (let pageNum = 1; pageNum <= Math.min(pdf.numPages, 5); pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const strings = content.items
      .map((item: any) => (item.str ? item.str : ''))
      .filter(Boolean);
    fullText += `\n${strings.join(' ')}`;
  }

  return fullText.trim();
}

/**
 * OCR on an Image File or Canvas using Tesseract.js (Portuguese)
 */
export async function extractTextViaOcr(fileOrBlob: File | Blob): Promise<string> {
  const worker = await createWorker('por');
  try {
    const ret = await worker.recognize(fileOrBlob);
    await worker.terminate();
    return ret.data.text || '';
  } catch (err) {
    console.error('OCR Error:', err);
    try {
      await worker.terminate();
    } catch {}
    return '';
  }
}

/**
 * Render first page of PDF to image and run OCR if text layer was empty
 */
export async function extractTextFromScannedPdf(file: File): Promise<string> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    if (pdf.numPages === 0) return '';

    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    await (page.render as any)({ canvasContext: ctx, viewport }).promise;

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png')
    );
    if (!blob) return '';

    return await extractTextViaOcr(blob);
  } catch (err) {
    console.error('Error rendering scanned PDF for OCR:', err);
    return '';
  }
}

/**
 * Intelligent parser to locate validity or emission dates in document text
 */
export function findDatesInDocumentText(
  rawText: string,
  docType: MandatoryDocType,
  durationsConfig: Record<MandatoryDocType, number> = DEFAULT_DOC_DURATIONS
): ExtractedDateResult | null {
  if (!rawText || !rawText.trim()) return null;

  const normalized = normalizeText(rawText);

  // Regex 1: DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const NUMERIC_DATE_REGEX = /\b([0-3]?[0-9])[\/\-\.]([0-1]?[0-9])[\/\-\.]((?:19|20)\d{2}|\d{2})\b/g;

  // Regex 2: "DD de [mês] de YYYY"
  const TEXTUAL_DATE_REGEX = /\b([0-3]?[0-9])\s+de\s+([a-zç]+)\s+de\s+((?:19|20)\d{2})\b/g;

  // Validity keywords (High priority)
  const validityKeywords = [
    'validade',
    'valido ate',
    'vencimento',
    'val ate',
    'val:',
    'vcto',
    'data de validade',
    'proximo exame',
    'proxima avaliacao',
    'expira em',
    'data limite',
  ];

  // Issue / Realization keywords (Secondary priority)
  const issueKeywords = [
    'data de emissao',
    'emitido em',
    'data de realizacao',
    'realizado em',
    'realizada em',
    'data do exame',
    'data de conclusao',
    'concluido em',
    'data da realizacao',
    'emissao',
    'data:',
  ];

  // Search for explicit validity dates first
  for (const kw of validityKeywords) {
    const kwPos = normalized.indexOf(kw);
    if (kwPos !== -1) {
      // Look around the keyword window (120 chars forward)
      const windowText = normalized.slice(kwPos, kwPos + 120);

      // Check numeric date
      const numMatches = [...windowText.matchAll(NUMERIC_DATE_REGEX)];
      if (numMatches.length > 0) {
        const match = numMatches[0];
        const iso = parseDateToIso(match[1], match[2], match[3]);
        if (iso) {
          return {
            suggestedDate: iso,
            rawDateText: match[0],
            origin: 'validade_lida',
            originDescription: `Lida diretamente do documento após "${kw.toUpperCase()}"`,
            extractedTextPreview: windowText.slice(0, 90),
            confidence: 'high',
          };
        }
      }

      // Check textual date
      const textMatches = [...windowText.matchAll(TEXTUAL_DATE_REGEX)];
      if (textMatches.length > 0) {
        const match = textMatches[0];
        const iso = parseDateToIso(match[1], match[2], match[3]);
        if (iso) {
          return {
            suggestedDate: iso,
            rawDateText: match[0],
            origin: 'validade_lida',
            originDescription: `Lida diretamente do documento após "${kw.toUpperCase()}"`,
            extractedTextPreview: windowText.slice(0, 90),
            confidence: 'high',
          };
        }
      }
    }
  }

  // Search for issue / realization dates if no explicit validity found
  const durationMonths = durationsConfig[docType] || DEFAULT_DOC_DURATIONS[docType] || 12;

  for (const kw of issueKeywords) {
    const kwPos = normalized.indexOf(kw);
    if (kwPos !== -1) {
      const windowText = normalized.slice(kwPos, kwPos + 120);

      const numMatches = [...windowText.matchAll(NUMERIC_DATE_REGEX)];
      if (numMatches.length > 0) {
        const match = numMatches[0];
        const iso = parseDateToIso(match[1], match[2], match[3]);
        if (iso) {
          const calculatedDate = addMonthsToIsoDate(iso, durationMonths);
          return {
            suggestedDate: calculatedDate,
            rawDateText: match[0],
            origin: 'calculada_emissao',
            originDescription: `Calculada a partir da data de emissão (${match[0]} + ${durationMonths} meses)`,
            extractedTextPreview: windowText.slice(0, 90),
            confidence: 'medium',
          };
        }
      }

      const textMatches = [...windowText.matchAll(TEXTUAL_DATE_REGEX)];
      if (textMatches.length > 0) {
        const match = textMatches[0];
        const iso = parseDateToIso(match[1], match[2], match[3]);
        if (iso) {
          const calculatedDate = addMonthsToIsoDate(iso, durationMonths);
          return {
            suggestedDate: calculatedDate,
            rawDateText: match[0],
            origin: 'calculada_emissao',
            originDescription: `Calculada a partir da data de emissão (${match[0]} + ${durationMonths} meses)`,
            extractedTextPreview: windowText.slice(0, 90),
            confidence: 'medium',
          };
        }
      }
    }
  }

  // Fallback: search for any date in the entire document text
  const allNumMatches = [...normalized.matchAll(NUMERIC_DATE_REGEX)];
  if (allNumMatches.length > 0) {
    // Pick the latest future date if available, or calculate from the latest found date
    for (const match of allNumMatches) {
      const iso = parseDateToIso(match[1], match[2], match[3]);
      if (iso) {
        const calculatedDate = addMonthsToIsoDate(iso, durationMonths);
        return {
          suggestedDate: calculatedDate,
          rawDateText: match[0],
          origin: 'calculada_emissao',
          originDescription: `Calculada a partir da data encontrada no texto (${match[0]} + ${durationMonths} meses)`,
          extractedTextPreview: rawText.slice(0, 90),
          confidence: 'low',
        };
      }
    }
  }

  return null;
}

/**
 * High-level function to scan a document file (PDF or image) and return suggested validity date
 */
export async function analyzeDocumentValidity(
  file: File,
  docType: MandatoryDocType,
  durationsConfig?: Record<MandatoryDocType, number>
): Promise<{
  result: ExtractedDateResult | null;
  extractedText: string;
  methodUsed: 'pdf_text' | 'pdf_ocr' | 'image_ocr';
}> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  let text = '';
  let method: 'pdf_text' | 'pdf_ocr' | 'image_ocr' = isPdf ? 'pdf_text' : 'image_ocr';

  if (isPdf) {
    try {
      text = await extractTextFromPdf(file);
    } catch (err) {
      console.warn('PDF text extraction failed, trying OCR...', err);
    }

    // If PDF text layer is very short or empty, attempt scanned OCR
    if (!text || text.length < 20) {
      method = 'pdf_ocr';
      text = await extractTextFromScannedPdf(file);
    }
  } else {
    method = 'image_ocr';
    text = await extractTextViaOcr(file);
  }

  const result = findDatesInDocumentText(text, docType, durationsConfig);

  return {
    result,
    extractedText: text,
    methodUsed: method,
  };
}
