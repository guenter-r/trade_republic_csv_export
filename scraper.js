(async () => {
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // Auto-scroll to trigger lazy loading / virtualization
  async function autoloadAll(container) {
    const el = container || document.scrollingElement || document.documentElement;
    let last = -1, stable = 0;
    for (let i = 0; i < 50; i++) {
      el.scrollTop = el.scrollHeight;
      await new Promise(r => setTimeout(r, 350));
      const h = el.scrollHeight;
      if (h === last) stable++; else stable = 0;
      last = h;
      if (stable >= 3) break; // nothing more loads
    }
    // go back to top so you stay oriented
    el.scrollTop = 0;
  }

  function csvEscape(v) {
    const s = (v ?? "").toString().trim();
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function normalizeAmount(s) {
    if (!s) return "";
    s = s.replace(/\s+/g, " ").trim();

    // detect sign rule: explicit "+" means positive, no "+" means negative
    let sign = -1; // default negative
    if (s.includes("+")) sign = 1;
    if (s.includes("-")) sign = -1; // keep explicit negatives negative

    // strip currency symbols etc.
    s = s.replace(/[^\d,.\-]/g, "");

    // normalize decimal separator
    if (s.includes(",") && s.includes(".")) {
      const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
      const decimalIsComma = lastComma > lastDot;
      s = s.replace(decimalIsComma ? /\./g : /,/g, "");
      s = s.replace(decimalIsComma ? /,/ : /\./, ".");
    } else if (s.includes(",")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }

    let n = Number(s);
    if (!Number.isFinite(n)) return "";
    n *= sign;
    return n.toString();
  }

  // Enhanced collector: returns {type: 'divider'|'event', element, yearContext?}
  function collectTimelineStructure() {
    const timelineLis = $$('li.timeline__entry'); // All <li> in order
    const structure = [];
    let currentYear = new Date().getFullYear();

    timelineLis.forEach(li => {
      if (li.classList.contains('-isMonthDivider') || li.classList.contains('-isNewSection')) {
        const dividerText = li.querySelector('.timelineMonthDivider')?.textContent?.trim();
        if (dividerText === 'This month') {
          currentYear = new Date().getFullYear();
        } else {
          // Parse "December 2025" → 2025
          const yearMatch = dividerText?.match(/\\d{4}$/);
          currentYear = yearMatch ? parseInt(yearMatch[0], 10) : new Date().getFullYear();
        }
        structure.push({ type: 'divider', element: li, yearContext: currentYear });
      } else {
        const card = li.querySelector('.timelineV2Event');
        if (card) {
          structure.push({ type: 'event', element: li, yearContext: currentYear });
        }
      }
    });

    return structure.filter(item => item.type === 'event'); // Only events
  }

  // Updated: normalizeDate now takes explicit year
  function normalizeDate(s, explicitYear) {
    if (!s) return "";
    s = s.replace(/\u00A0/g, " ").trim();
    const pad = (n) => String(n).padStart(2, "0");

    // 1) ISO: YYYY-MM-DD
    let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) {
      const y = +m[1], mo = +m[2], d = +m[3];
      return `${y}-${pad(mo)}-${pad(d)}`;
    }

    // 2) EU: DD/MM or DD/MM/YY → use explicitYear if no year given
    m = s.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/);
    if (m) {
      let d = +m[1], mo = +m[2];
      let y = m[3] ? (+m[3] < 100 ? +m[3] + 2000 : +m[3]) : explicitYear;
      // Future check only if no explicit year
      if (!m[3]) {
        let candidate = new Date(y, mo - 1, d);
        if (candidate > new Date()) y -= 1;
      }
      return `${y}-${pad(mo)}-${pad(d)}`;
    }

    return s;
  }

  // Updated extractor uses context
  function extractRow(structuredItem) {
    const { element, yearContext } = structuredItem;
    const card = element.querySelector('.timelineV2Event');
    const amountEl = card?.querySelector('.timelineV2Event__price p') || card?.querySelector('[class*="price"]');
    const title = (card?.querySelector('.timelineV2Event__title') || card?.querySelector('h2,[class*="title"]'))?.textContent?.trim() ?? "";
    const dateRaw = (card?.querySelector('.timelineV2Event__subtitle') || card?.querySelector('p,[class*="subtitle"]'))?.textContent ?? "";
    const amountRaw = amountEl?.textContent ?? "";
    const canceled = amountEl?.classList?.contains("timelineV2Event__canceled") ? "yes" : "no";
    const saving = /(saving\s+executed|saveback|round\s+up)/i.test(dateRaw) ? "yes" : "no";

    return {
      date: normalizeDate(dateRaw, yearContext),
      title,
      amount: normalizeAmount(amountRaw),
      canceled,
      saving
    };
  }


  function toCSV(rows) {
    const header = ["date", "title", "amount", "canceled", "saving/saveback/roundUp"]; // NEW
    return [header.map(csvEscape).join(",")]
      .concat(
        rows.map(r =>
          [r.date, r.title, r.amount, r.canceled, r.saving]  // NEW
            .map(csvEscape).join(",")
        )
      )
      .join("\n");
  }

  async function run() {
    // trying to scroll page - not working yet
    const container =
      document.querySelector('aside, .side, .sidebar, [data-testid="timeline"], .timeline, main') || null;

    await autoloadAll(container);

    const structure = collectTimelineStructure();
    if (!structure.length) {
      alert('Broker CSV Exporter: found 0 events. If this page uses a different view, scroll the list first and try again.');
      return;
    }
    const rows = structure.map(extractRow).filter(r => r.title || r.amount || r.date);

    if (!rows.length) {
      alert('Broker CSV Exporter: elements found, but no data extracted. The class names may have changed.');
      return;
    }

    const csv = toCSV(rows);

    // Download via Blob link (no downloads permission needed)
    const ts = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const fname = `transactions_${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.csv`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: fname });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);

    console.log(`Broker CSV Exporter: exported ${rows.length} rows`);
  }

  try {
    await run();
  } catch (err) {
    console.error("Broker CSV Exporter error:", err);
    alert("Broker CSV Exporter error: " + (err && err.message ? err.message : err));
  }
})();
