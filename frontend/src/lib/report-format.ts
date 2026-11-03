/**
 * Report document model + pure exporters (CSV / Markdown / HTML / JSON).
 * No DOM or API dependencies so these can be unit-tested in Node.
 */

export interface ReportKpi {
  label: string;
  value: string | number;
}

export interface ReportTable {
  columns: string[];
  rows: (string | number)[][];
}

export interface ReportSection {
  title: string;
  kpis?: ReportKpi[];
  table?: ReportTable;
  note?: string;
}

export interface ReportDoc {
  title: string;
  subtitle: string;
  generatedAt: string;
  periodLabel: string;
  sections: ReportSection[];
}

// ------------------------------------------------------------------- CSV

function csvCell(v: string | number): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(doc: ReportDoc): string {
  const lines: string[] = [];
  lines.push(csvCell(doc.title));
  lines.push(`${csvCell('Subtitle')},${csvCell(doc.subtitle)}`);
  lines.push(`${csvCell('Period')},${csvCell(doc.periodLabel)}`);
  lines.push(`${csvCell('Generated at')},${csvCell(doc.generatedAt)}`);
  for (const s of doc.sections) {
    lines.push('');
    lines.push(csvCell(s.title.toUpperCase()));
    if (s.note) lines.push(csvCell(`Note: ${s.note}`));
    for (const k of s.kpis ?? []) {
      lines.push(`${csvCell(k.label)},${csvCell(k.value)}`);
    }
    if (s.table) {
      lines.push(s.table.columns.map(csvCell).join(','));
      for (const row of s.table.rows) {
        lines.push(row.map(csvCell).join(','));
      }
    }
  }
  return lines.join('\n');
}

// -------------------------------------------------------------- Markdown

function mdCell(v: string | number): string {
  return String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

export function toMarkdown(doc: ReportDoc): string {
  const out: string[] = [];
  out.push(`# ${doc.title}`);
  out.push('');
  out.push(`**${doc.subtitle}**`);
  out.push('');
  out.push(`- Period: ${doc.periodLabel}`);
  out.push(`- Generated at: ${doc.generatedAt}`);
  for (const s of doc.sections) {
    out.push('');
    out.push(`## ${s.title}`);
    if (s.note) {
      out.push('');
      out.push(`> ${s.note}`);
    }
    if (s.kpis?.length) {
      out.push('');
      for (const k of s.kpis) out.push(`- **${k.label}:** ${k.value}`);
    }
    if (s.table) {
      out.push('');
      out.push(`| ${s.table.columns.map(mdCell).join(' | ')} |`);
      out.push(`| ${s.table.columns.map(() => '---').join(' | ')} |`);
      for (const row of s.table.rows) {
        out.push(`| ${row.map(mdCell).join(' | ')} |`);
      }
    }
  }
  out.push('');
  return out.join('\n');
}

// ------------------------------------------------------------------ HTML

function esc(v: string | number): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Standalone, print-friendly HTML document styled after Amazon Quick. */
export function toHtml(doc: ReportDoc): string {
  const sections = doc.sections
    .map((s) => {
      const note = s.note ? `<p class="note">${esc(s.note)}</p>` : '';
      const kpis = s.kpis?.length
        ? `<div class="kpis">${s.kpis
            .map((k) => `<div class="kpi"><div class="kpi-label">${esc(k.label)}</div><div class="kpi-value">${esc(k.value)}</div></div>`)
            .join('')}</div>`
        : '';
      const table = s.table
        ? `<table><thead><tr>${s.table.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${s.table.rows
            .map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`
        : '';
      return `<section><h2>${esc(s.title)}</h2>${note}${kpis}${table}</section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: Inter, -apple-system, "Segoe UI", sans-serif; color: #16191F; margin: 0; background: #F6F6F7; }
  .page { max-width: 960px; margin: 0 auto; padding: 40px 32px; }
  header.report { border-bottom: 3px solid #6842FF; padding-bottom: 16px; margin-bottom: 24px; }
  h1 { font-size: 24px; font-weight: 600; margin: 0 0 4px; }
  .subtitle { color: #69707D; font-size: 14px; margin: 0 0 10px; }
  .meta { color: #69707D; font-size: 12px; }
  .meta strong { color: #16191F; font-weight: 600; }
  section { background: #fff; border: 1px solid #E9E9EC; border-radius: 10px; padding: 20px 24px; margin-bottom: 16px; page-break-inside: avoid; }
  h2 { font-size: 15px; font-weight: 600; margin: 0 0 12px; color: #414650; }
  .note { color: #69707D; font-size: 12px; font-style: italic; }
  .kpis { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
  .kpi { border: 1px solid #E9E9EC; border-radius: 8px; padding: 10px 14px; min-width: 130px; }
  .kpi-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #69707D; font-weight: 600; }
  .kpi-value { font-size: 20px; font-weight: 700; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; background: #F7F5FF; color: #414650; font-weight: 600; }
  th, td { border: 1px solid #E9E9EC; padding: 6px 10px; vertical-align: top; }
  tr:nth-child(even) td { background: #FAFAFB; }
  footer { color: #69707D; font-size: 11px; text-align: center; padding: 8px 0 24px; }
  @media print {
    body { background: #fff; }
    .page { padding: 0; max-width: none; }
    section { border: none; padding: 12px 0; border-bottom: 1px solid #E9E9EC; border-radius: 0; }
  }
</style>
</head>
<body>
<div class="page">
<header class="report">
  <h1>${esc(doc.title)}</h1>
  <p class="subtitle">${esc(doc.subtitle)}</p>
  <p class="meta"><strong>Period:</strong> ${esc(doc.periodLabel)} &nbsp;·&nbsp; <strong>Generated:</strong> ${esc(doc.generatedAt)}</p>
</header>
${sections}
<footer>Generated by Quick Usage Monitor</footer>
</div>
</body>
</html>`;
}

// ------------------------------------------------------------------ JSON

export function toJson(doc: ReportDoc): string {
  return JSON.stringify(doc, null, 2);
}
