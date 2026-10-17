/* =========================================================
   Avtalskollen – PDF-läsning
   ---------------------------------------------------------
   Läser ut text ur en PDF med Mozillas pdf.js. Allt sker
   lokalt i webbläsaren; filen laddas aldrig upp någonstans.
   ========================================================= */

(function () {
  'use strict';

  const PDFJS_VERSION = '3.11.174';

  function getLib() {
    const lib = window.pdfjsLib;
    if (!lib) {
      throw new PdfError('PDF-läsaren kunde inte laddas. Kontrollera internetanslutningen och ladda om sidan.');
    }
    if (!lib.GlobalWorkerOptions.workerSrc) {
      lib.GlobalWorkerOptions.workerSrc =
        `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;
    }
    return lib;
  }

  class PdfError extends Error {}

  function isPdf(file) {
    return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  }

  /** Bygger rader av textbitarna på en sida utifrån deras position. */
  function pageToText(items) {
    let out = '';
    let lastY = null, lastEndX = null, lastHeight = 0;

    for (const item of items) {
      if (typeof item.str !== 'string') continue;
      const x = item.transform[4];
      const y = item.transform[5];
      const h = Math.abs(item.height || item.transform[3] || 0);

      if (lastY !== null) {
        const dy = Math.abs(y - lastY);
        if (dy > Math.max(2, lastHeight * 0.5)) {
          // Ny rad – och tom rad om avståndet är stort (nytt stycke)
          out = out.replace(/[ \t]+$/, '');
          if (dy > lastHeight * 1.8) out = out.replace(/\n*$/, '\n\n');
          else if (!out.endsWith('\n')) out += '\n';
        } else if (lastEndX !== null && x - lastEndX > 1 && !/\s$/.test(out) && !/^\s/.test(item.str)) {
          out += ' ';
        }
      }

      out += item.str;
      if (item.hasEOL) out += '\n';

      if (item.str.trim() || item.hasEOL) {
        lastY = y;
        lastEndX = x + (item.width || 0);
        lastHeight = h || lastHeight;
      }
    }
    return out;
  }

  /**
   * Fogar ihop rader som bara brutits av sidbredden, så att en mening
   * som fortsätter på nästa rad blir en sammanhängande mening igen.
   * Korta rader (rubriker) och rader som slutar med skiljetecken behålls.
   */
  function joinWrappedLines(text) {
    const lines = text.split('\n');
    const longest = Math.max(...lines.map(l => l.length));
    const wrapLimit = Math.min(55, longest * 0.6);
    let out = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i], next = lines[i + 1];
      out += line;
      if (next === undefined) break;
      const wrapped = line.length >= wrapLimit && next.trim() && !/[.:;!?]$/.test(line.trim());
      out += wrapped ? ' ' : '\n';
    }
    return out;
  }

  function cleanText(text) {
    const tidy = text
      .replace(/­/g, '')                    // mjuka bindestreck
      .replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2')   // avstavning vid radbrytning
      .replace(/[ \t ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return joinWrappedLines(tidy);
  }

  /**
   * Läser ut texten ur en PDF-fil.
   * @param {File|Blob|ArrayBuffer} source
   * @param {(page:number, total:number) => void} [onProgress]
   * @returns {Promise<{ text: string, pages: number }>}
   */
  async function extractText(source, onProgress) {
    const lib = getLib();
    const data = source instanceof ArrayBuffer ? source : await source.arrayBuffer();

    let doc;
    try {
      doc = await lib.getDocument({ data, isEvalSupported: false }).promise;
    } catch (err) {
      if (err && err.name === 'PasswordException') {
        throw new PdfError('PDF:en är lösenordsskyddad. Öppna den, kopiera texten och klistra in den i stället.');
      }
      throw new PdfError('Filen kunde inte läsas som PDF. Den kan vara skadad.');
    }

    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      if (onProgress) onProgress(i, doc.numPages);
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(pageToText(content.items));
      page.cleanup();
    }
    await doc.destroy();

    const text = cleanText(pages.join('\n\n'));
    if (text.replace(/\s/g, '').length < 20 * doc.numPages) {
      throw new PdfError('PDF:en verkar vara inskannad och innehåller ingen läsbar text. Använd en OCR-funktion (t.ex. ”Kopiera text” i mobilkameran) och klistra in texten.');
    }
    return { text, pages: doc.numPages };
  }

  window.AvtalsPdf = { extractText, isPdf, PdfError };
})();
