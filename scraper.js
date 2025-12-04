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


  // "15/10" → "YYYY-10-15"
  function normalizeDate(s) {
    if (!s) return "";
    s = s.replace(/\u00A0/g, " ").trim(); // collapse &nbsp;

    const pad = (n) => String(n).padStart(2, "0");
    const now = new Date();
    const thisYear = now.getFullYear();

    // 1) ISO inside text: YYYY-MM-DD
    let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) {
      const y = +m[1], mo = +m[2], d = +m[3];
      return `${y}-${pad(mo)}-${pad(d)}`;
    }

    // 2) EU formats inside text: DD/MM[/YY] or DD.MM[.YY]
    m = s.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/);
    if (m) {
      let d = +m[1], mo = +m[2];
      let y = m[3] ? +m[3] : thisYear;
      if (y < 100) y += 2000; // e.g., 24 -> 2024

      // If year was missing and the date would be in the future, assume it was last year
      if (!m[3]) {
        let candidate = new Date(y, mo - 1, d);
        if (candidate > now) y -= 1;
      }
      return `${y}-${pad(mo)}-${pad(d)}`;
    }

    // 3) Fallback: return trimmed original
    return s;
  }

  // Try multiple selectors to be resilient
  function collectCards() {
    // Primary (from your snippet)
    let cards = $$('.timelineV2Event');
    if (cards.length) return cards;

    // Fallbacks (class name drift)
    cards = $$('[class*="timelineV2Event"]');
    if (cards.length) return cards;

    // Very defensive: look for title+subtitle+price pattern near a “timeline” container
    const timeline = document.querySelector('[data-testid="timeline"], .timeline, [class*="timeline"]') || document;
    return $$('h2, .title, [class*="title"]', timeline)
      .map(h => h.closest('div, li, article'))
      .filter(Boolean)
      .filter(box =>
        box.querySelector('h2,[class*="title"]') &&
        (box.querySelector('p,[class*="subtitle"]')) &&
        (box.querySelector('.timelineV2Event__price p, .timelineV2Event__price, [class*="price"]'))
      );
  }

  function extractRow(card) {
    const amountEl =
      card.querySelector('.timelineV2Event__price p') ||
      card.querySelector('.timelineV2Event__price') ||
      card.querySelector('[class*="price"] p, [class*="price"]');

    const title = (card.querySelector('.timelineV2Event__title') ||
      card.querySelector('h2,[class*="title"]'))?.textContent?.trim() ?? "";

    const dateRaw = (card.querySelector('.timelineV2Event__subtitle') ||
      card.querySelector('p,[class*="subtitle"]'))?.textContent ?? "";

    const amountRaw = amountEl?.textContent ?? "";
    const canceled = amountEl?.classList?.contains("timelineV2Event__canceled") ? "yes" : "no";

    // NEW: detect “Saving executed” (case‑insensitive, tolerant to extra spaces)
    const saving = /(saving\s+executed|saveback|round\s+up)/i.test(dateRaw) ? "yes" : "no";

    return {
      date: normalizeDate(dateRaw),
      title,
      amount: normalizeAmount(amountRaw),
      canceled,
      saving,        // NEW
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

    const cards = collectCards();
    if (!cards.length) {
      alert('Broker CSV Exporter: found 0 events. If this page uses a different view, scroll the list first and try again.');
      return;
    }

    const rows = cards.map(extractRow).filter(r => r.title || r.amount || r.date);
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
