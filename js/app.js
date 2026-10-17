/* =========================================================
   Avtalskollen – analysmotor och gränssnitt
   ========================================================= */

(function () {
  'use strict';

  const { common, types, findAll } = window.AvtalsRules;
  const SEVERITY_RANK = { high: 4, medium: 3, low: 2, ok: 1 };
  const SEVERITY_LABEL = { high: 'Allvarlig', medium: 'Varning', low: 'Notera', ok: 'Bra', missing: 'Saknas' };
  const SCORE_WEIGHTS = { high: -15, medium: -8, low: -3, missing: -4, ok: 2 };

  // =========================================================
  // ANALYS
  // =========================================================

  function detectType(text) {
    let best = 'hantverkare', bestScore = -1;
    for (const [key, def] of Object.entries(types)) {
      const score = def.keywords.reduce((sum, re) => sum + findAll(text, re).length, 0);
      if (score > bestScore) { best = key; bestScore = score; }
    }
    return best;
  }

  function runPatterns(text, patterns) {
    return patterns.flatMap(re => findAll(text, re)).map(h => ({ start: h.start, end: h.end }));
  }

  function analyze(text, chosenType) {
    const typeKey = chosenType === 'auto' ? detectType(text) : chosenType;
    const def = types[typeKey];
    const findings = [];

    // Fällor (gemensamma + typspecifika)
    for (const rule of [...def.traps, ...common.traps]) {
      let result = null;
      if (rule.check) {
        result = rule.check(text);
      } else {
        const matches = runPatterns(text, rule.patterns);
        if (matches.length) result = { matches };
      }
      if (!result || !result.matches.length) continue;
      const severity = result.severity || rule.severity;
      findings.push({
        id: rule.id,
        kind: severity === 'ok' ? 'ok' : 'trap',
        severity,
        title: result.title || rule.title,
        explanation: result.explanation || rule.explanation,
        advice: severity === 'ok' ? '' : rule.advice,
        law: rule.law,
        question: severity === 'ok' ? '' : rule.question,
        matches: dedupeMatches(result.matches)
      });
    }

    // Saknade skydd
    for (const rule of [...def.missing, ...common.missing]) {
      if (runPatterns(text, rule.patterns).length) continue;
      findings.push({ id: rule.id, kind: 'missing', severity: 'missing', title: rule.title,
        explanation: rule.explanation, advice: rule.advice, question: rule.question, matches: [] });
    }

    // Bra klausuler
    for (const rule of [...def.good, ...common.good]) {
      const matches = runPatterns(text, rule.patterns);
      if (!matches.length) continue;
      findings.push({ id: rule.id, kind: 'ok', severity: 'ok', title: rule.title,
        explanation: rule.explanation, matches: dedupeMatches(matches) });
    }

    const order = { high: 0, medium: 1, low: 2, missing: 3, ok: 4 };
    findings.sort((a, b) => order[a.severity] - order[b.severity]);

    let score = 100;
    for (const f of findings) score += SCORE_WEIGHTS[f.severity] || 0;
    score = Math.max(0, Math.min(100, score));

    return { typeKey, typeName: def.name, typeIcon: def.icon, findings, score };
  }

  function dedupeMatches(matches) {
    const sorted = [...matches].sort((a, b) => a.start - b.start || b.end - a.end);
    const out = [];
    for (const m of sorted) {
      const last = out[out.length - 1];
      if (last && m.start < last.end) last.end = Math.max(last.end, m.end);
      else out.push({ ...m });
    }
    return out;
  }

  // =========================================================
  // HJÄLPFUNKTIONER
  // =========================================================

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Hela meningen runt en träff, max ~220 tecken */
  function sentenceAround(text, match) {
    let s = match.start, e = match.end;
    while (s > 0 && !/[.\n]/.test(text[s - 1]) && match.start - s < 120) s--;
    while (e < text.length && !/[.\n]/.test(text[e]) && e - match.end < 120) e++;
    if (e < text.length && text[e] === '.') e++;
    let q = text.slice(s, e).trim();
    if (q.length > 220) q = q.slice(0, 217) + '…';
    return q;
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // =========================================================
  // RENDERING
  // =========================================================

  let lastText = '';
  let lastResult = null;

  function render(text, result) {
    lastText = text;
    lastResult = result;
    const { findings, score } = result;

    // Sammanfattning
    const traps = findings.filter(f => f.kind === 'trap');
    const counts = {
      high: traps.filter(f => f.severity === 'high').length,
      medium: traps.filter(f => f.severity === 'medium').length,
      low: traps.filter(f => f.severity === 'low').length + findings.filter(f => f.kind === 'missing').length,
      ok: findings.filter(f => f.kind === 'ok').length
    };
    $('#countHigh').textContent = counts.high;
    $('#countMed').textContent = counts.medium;
    $('#countLow').textContent = counts.low;
    $('#countOk').textContent = counts.ok;
    $('#detectedType').textContent = `${result.typeIcon} ${result.typeName}`;

    let verdict, verdictText, color;
    if (counts.high === 0 && score >= 80) {
      verdict = 'Ser bra ut'; color = 'var(--ok)';
      verdictText = 'Vi hittade inga allvarliga fällor. Läs ändå igenom fynden och se till att allt viktigt står skriftligt.';
    } else if (score >= 60) {
      verdict = 'Några saker att se över'; color = 'var(--low)';
      verdictText = 'Avtalet innehåller villkor som kan bli dyra. Ställ frågorna nedan innan du skriver på.';
    } else if (score >= 35) {
      verdict = 'Var försiktig'; color = 'var(--medium)';
      verdictText = 'Flera villkor är till din nackdel. Förhandla eller be om ett bättre avtal innan du skriver på.';
    } else {
      verdict = 'Skriv inte på än!'; color = 'var(--high)';
      verdictText = 'Avtalet innehåller många allvarliga fällor. Kräv ändringar, jämför med andra alternativ eller kontakta konsumentvägledningen.';
    }
    $('#verdictTitle').textContent = verdict;
    $('#verdictText').textContent = verdictText;

    const ring = $('#scoreRing');
    const circumference = 2 * Math.PI * 52;
    ring.style.stroke = color;
    ring.style.strokeDashoffset = circumference;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      ring.style.strokeDashoffset = circumference * (1 - score / 100);
    }));
    animateNumber($('#scoreNumber'), score);

    renderFindings(text, findings);
    renderDocument(text, findings);
    renderQuestions(findings);
  }

  function animateNumber(el, target) {
    const start = performance.now(), dur = 800;
    const step = now => {
      const t = Math.min(1, (now - start) / dur);
      el.textContent = Math.round(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function renderFindings(text, findings) {
    const list = $('#findingsList');
    if (!findings.length) {
      list.innerHTML = '<li class="empty">Inga fynd. Prova att klistra in mer av avtalet.</li>';
      return;
    }
    list.innerHTML = findings.map((f, i) => {
      const badgeClass = f.kind === 'missing' ? 'missing' : f.severity;
      const quote = f.matches.length
        ? `<p class="finding-quote" data-jump="${i}" title="Visa i avtalet">”${escapeHtml(sentenceAround(text, f.matches[0]))}”${f.matches.length > 1 ? ` <strong>(+${f.matches.length - 1} till)</strong>` : ''}</p>`
        : '';
      const collapsed = f.kind === 'ok' || f.kind === 'missing' ? ' collapsed' : '';
      return `
        <li class="finding ${f.kind === 'missing' ? 'low' : f.severity}${collapsed}" id="finding-${i}" data-filter="${filterGroup(f)}">
          <div class="finding-top" data-toggle="${i}">
            <span class="toggle-icon">▸</span>
            <span class="finding-title">${escapeHtml(f.title)}</span>
            <span class="badge ${badgeClass}">${SEVERITY_LABEL[f.kind === 'missing' ? 'missing' : f.severity]}</span>
          </div>
          ${quote}
          <div class="finding-body">
            <p>${escapeHtml(f.explanation || '')}</p>
            ${f.advice ? `<p class="finding-advice"><strong>Gör så här:</strong> ${escapeHtml(f.advice)}</p>` : ''}
            ${f.law ? `<p class="finding-law">⚖️ ${escapeHtml(f.law)}</p>` : ''}
          </div>
        </li>`;
    }).join('');
    applyFilter(currentFilter);
  }

  function filterGroup(f) {
    if (f.kind === 'missing') return 'missing';
    if (f.kind === 'ok') return 'ok';
    return f.severity === 'high' ? 'high' : 'medium';
  }

  /** Bygger avtalstexten med <mark>-taggar; vid överlapp vinner allvarligaste fyndet. */
  function renderDocument(text, findings) {
    const owner = new Int16Array(text.length).fill(-1);
    const rank = new Int8Array(text.length);
    findings.forEach((f, i) => {
      const r = SEVERITY_RANK[f.severity] || 0;
      for (const m of f.matches) {
        for (let p = m.start; p < m.end; p++) {
          if (r > rank[p]) { rank[p] = r; owner[p] = i; }
        }
      }
    });

    let html = '', p = 0;
    while (p < text.length) {
      const o = owner[p];
      let q = p;
      while (q < text.length && owner[q] === o) q++;
      const chunk = escapeHtml(text.slice(p, q));
      if (o === -1) html += chunk;
      else html += `<mark class="${findings[o].severity}" data-finding="${o}" title="${escapeHtml(findings[o].title)}">${chunk}</mark>`;
      p = q;
    }
    $('#annotatedDoc').innerHTML = html || '<span class="muted">(tomt)</span>';
  }

  function renderQuestions(findings) {
    const qs = [...new Set(findings.filter(f => f.question && f.kind !== 'ok').map(f => f.question))];
    $('#questionList').innerHTML = qs.length
      ? qs.map(q => `<li>${escapeHtml(q)}</li>`).join('')
      : '<li>Inga särskilda frågor – men be alltid om att få avtalet skriftligt.</li>';
  }

  // =========================================================
  // INTERAKTION
  // =========================================================

  let currentFilter = 'all';
  function applyFilter(filter) {
    currentFilter = filter;
    $$('.chip').forEach(c => c.classList.toggle('active', c.dataset.filter === filter));
    $$('.finding').forEach(li => { li.hidden = filter !== 'all' && li.dataset.filter !== filter; });
  }

  function focusFinding(i) {
    const li = $('#finding-' + i);
    if (!li) return;
    if (li.hidden) applyFilter('all');
    li.classList.remove('collapsed');
    li.scrollIntoView({ behavior: 'smooth', block: 'center' });
    li.classList.add('flash');
    setTimeout(() => li.classList.remove('flash'), 1200);
  }

  function focusMark(i) {
    const mark = $(`mark[data-finding="${i}"]`);
    if (!mark) return;
    const doc = $('#annotatedDoc');
    doc.scrollTo({ top: mark.offsetTop - doc.offsetTop - 60, behavior: 'smooth' });
    if (window.innerWidth < 960) mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    mark.animate([{ outline: '3px solid var(--primary)' }, { outline: '3px solid transparent' }], { duration: 1400 });
  }

  function runAnalysis() {
    const text = $('#contractText').value.trim();
    if (text.length < 40) {
      toast('Klistra in lite mer text – minst ett par meningar.');
      $('#contractText').focus();
      return;
    }
    const type = $('input[name="contractType"]:checked').value;
    const btn = $('#analyzeBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Granskar…';
    // Liten fördröjning så att knappen hinner uppdateras även för stora texter
    setTimeout(() => {
      const result = analyze(text, type);
      $('#results').hidden = false;
      render(text, result);
      btn.disabled = false;
      btn.textContent = '🔍 Granska avtalet';
      $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 250);
  }

  function updateCharCount() {
    const n = $('#contractText').value.length;
    $('#charCount').textContent = `${n.toLocaleString('sv-SE')} tecken`;
  }

  function showPdfInfo(html) {
    const el = $('#pdfInfo');
    el.hidden = !html;
    el.innerHTML = html || '';
  }

  function setPdfBusy(message) {
    $('#pdfStatus').hidden = !message;
    if (message) $('#pdfStatusText').textContent = message;
    $('#analyzeBtn').disabled = !!message;
    $('#contractText').readOnly = !!message;
  }

  async function loadPdf(file) {
    const { extractText, PdfError } = window.AvtalsPdf;
    setPdfBusy('Läser PDF…');
    try {
      const { text, pages } = await extractText(file, (page, total) =>
        setPdfBusy(`Läser sida ${page} av ${total}…`));
      $('#contractText').value = text;
      updateCharCount();
      showPdfInfo(`📄 <strong>${escapeHtml(file.name)}</strong> – ${pages} ${pages === 1 ? 'sida' : 'sidor'}, `
        + `${text.length.toLocaleString('sv-SE')} tecken utlästa. Kontrollera gärna att texten blev rätt.`);
      setPdfBusy(null);
      runAnalysis();
    } catch (err) {
      setPdfBusy(null);
      console.error(err);
      toast(err instanceof PdfError ? err.message : 'Något gick fel när PDF:en lästes.');
    }
  }

  function loadFile(file) {
    if (!file) return;
    if (window.AvtalsPdf && window.AvtalsPdf.isPdf(file)) { loadPdf(file); return; }
    if (!/^text\//.test(file.type) && !/\.txt$/i.test(file.name || '')) {
      toast('Filtypen stöds inte. Använd PDF eller .txt – eller klistra in texten.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      $('#contractText').value = reader.result;
      updateCharCount();
      showPdfInfo(null);
      toast(`”${file.name}” inläst`);
    };
    reader.readAsText(file, 'UTF-8');
  }

  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('avtalskollen-theme'); } catch (e) { /* ignorera */ }
    if (saved) document.documentElement.dataset.theme = saved;
    $('#themeToggle').addEventListener('click', () => {
      const isDark = document.documentElement.dataset.theme
        ? document.documentElement.dataset.theme === 'dark'
        : window.matchMedia('(prefers-color-scheme: dark)').matches;
      const next = isDark ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('avtalskollen-theme', next); } catch (e) { /* ignorera */ }
    });
  }

  function initMobileMenu() {
    const header = $('.site-header'), toggle = $('#menuToggle');
    const setOpen = open => {
      header.classList.toggle('nav-open', open);
      toggle.setAttribute('aria-expanded', open);
      toggle.setAttribute('aria-label', open ? 'Stäng menyn' : 'Öppna menyn');
    };
    toggle.addEventListener('click', e => { e.stopPropagation(); setOpen(!header.classList.contains('nav-open')); });
    $$('#mainNav a').forEach(a => a.addEventListener('click', () => setOpen(false)));
    document.addEventListener('click', e => { if (!header.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });
    window.matchMedia('(min-width: 761px)').addEventListener('change', e => { if (e.matches) setOpen(false); });
  }

  function init() {
    initTheme();
    initMobileMenu();

    const total = Object.values(types).reduce((s, t) => s + t.traps.length + t.missing.length + t.good.length, 0)
      + common.traps.length + common.good.length;
    $('#ruleCount').textContent = total;
    $('#typeCount').textContent = Object.keys(types).length;

    const textarea = $('#contractText');
    textarea.addEventListener('input', updateCharCount);
    textarea.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runAnalysis();
    });
    // Dra och släpp filer (PDF eller .txt)
    const wrap = $('.textarea-wrap'), overlay = $('#dropOverlay');
    const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
    ['dragenter', 'dragover'].forEach(ev => wrap.addEventListener(ev, e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      overlay.hidden = false;
    }));
    wrap.addEventListener('dragleave', e => { if (!wrap.contains(e.relatedTarget)) overlay.hidden = true; });
    wrap.addEventListener('drop', e => {
      overlay.hidden = true;
      if (e.dataTransfer.files.length) { e.preventDefault(); loadFile(e.dataTransfer.files[0]); }
    });
    // Släpp utanför rutan ska inte öppna PDF:en i webbläsaren
    ['dragover', 'drop'].forEach(ev => window.addEventListener(ev, e => { if (hasFiles(e)) e.preventDefault(); }));

    // Klistra in en kopierad fil (t.ex. PDF kopierad i Utforskaren/Finder)
    textarea.addEventListener('paste', e => {
      const file = [...(e.clipboardData?.files || [])][0];
      if (file) { e.preventDefault(); loadFile(file); }
    });

    $('#fileInput').addEventListener('change', e => { loadFile(e.target.files[0]); e.target.value = ''; });
    $('#analyzeBtn').addEventListener('click', runAnalysis);
    $('#clearBtn').addEventListener('click', () => {
      textarea.value = '';
      showPdfInfo(null);
      updateCharCount();
      $('#results').hidden = true;
      textarea.focus();
    });

    // Exempelmeny
    const exBtn = $('#exampleBtn'), exMenu = $('#exampleMenu');
    exBtn.addEventListener('click', e => {
      e.stopPropagation();
      const open = exMenu.classList.toggle('open');
      exBtn.setAttribute('aria-expanded', open);
    });
    document.addEventListener('click', () => { exMenu.classList.remove('open'); exBtn.setAttribute('aria-expanded', 'false'); });
    $$('[data-example]', exMenu).forEach(b => b.addEventListener('click', () => {
      const key = b.dataset.example;
      textarea.value = window.AvtalsExamples[key];
      $(`input[name="contractType"][value="${key}"]`).checked = true;
      updateCharCount();
      runAnalysis();
    }));

    // Fynd: expandera, hoppa till markering
    $('#findingsList').addEventListener('click', e => {
      const toggle = e.target.closest('[data-toggle]');
      if (toggle) { toggle.parentElement.classList.toggle('collapsed'); return; }
      const jump = e.target.closest('[data-jump]');
      if (jump) focusMark(jump.dataset.jump);
    });
    $('#annotatedDoc').addEventListener('click', e => {
      const mark = e.target.closest('mark[data-finding]');
      if (mark) focusFinding(mark.dataset.finding);
    });
    $$('.chip').forEach(c => c.addEventListener('click', () => applyFilter(c.dataset.filter)));

    $('#printBtn').addEventListener('click', () => window.print());
    $('#copyBtn').addEventListener('click', async () => {
      const qs = $$('#questionList li').map((li, i) => `${i + 1}. ${li.textContent}`).join('\n');
      const textOut = `Frågor inför avtalet (${lastResult ? lastResult.typeName : ''}):\n\n${qs}`;
      try { await navigator.clipboard.writeText(textOut); toast('Frågorna är kopierade 📋'); }
      catch (e) { toast('Kunde inte kopiera – markera texten manuellt.'); }
    });

    // Flikar
    $$('.tab').forEach(tab => tab.addEventListener('click', () => {
      $$('.tab').forEach(t => { t.classList.toggle('active', t === tab); t.setAttribute('aria-selected', t === tab); });
      $$('.tab-panel').forEach(p => { const on = p.dataset.panel === tab.dataset.tab; p.hidden = !on; p.classList.toggle('active', on); });
    }));
  }

  document.addEventListener('DOMContentLoaded', init);

  // Exponera för test i konsolen
  window.Avtalskollen = { analyze, detectType, loadFile };
})();
