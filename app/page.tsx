'use client';

import React, { useEffect, useMemo, useState } from 'react';
import jsPDF from 'jspdf';

type Field = {
  label: string;
  hint?: string;
  value: string;
  setValue: (v: string) => void;
  right?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
function toNum(v: string) {
  const x = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(x) ? x : 0;
}
function money(n: number) {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
function money2(n: number) {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}
function pct(n: number) {
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(2)}%`;
}

function monthlyMortgagePayment(principal: number, annualRatePct: number, years: number) {
  const r = (annualRatePct / 100) / 12;
  const n = Math.max(1, Math.round(years * 12));
  if (principal <= 0) return 0;
  if (r <= 0) return principal / n;
  return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

function scoreDecision(args: {
  netCashFlow: number;
  dscr: number;
  cashOnCash: number;
  breakEvenRent: number;
  effectiveIncome: number;
  grossIncome: number;
  mortgagePI: number;
}) {
  const dscrMin = 1.2; // “screening” guardrail (not underwriting)
  const cocMin = 0.08;

  const reasons: string[] = [];
  const warnings: string[] = [];

  if (args.netCashFlow < 0) reasons.push(`Cash flow is negative (${money2(args.netCashFlow)}/mo).`);
  if (args.dscr < dscrMin) reasons.push(`DSCR is below ${dscrMin.toFixed(2)} (currently ${args.dscr.toFixed(2)}).`);

  if (args.cashOnCash < cocMin) warnings.push(`Cash-on-cash is under ${(cocMin * 100).toFixed(0)}% (${pct(args.cashOnCash)}).`);
  if (args.breakEvenRent > args.grossIncome) warnings.push(`Break-even rent is above your gross rent input.`);

  const isGo = args.netCashFlow >= 0 && args.dscr >= dscrMin;

  const primarySignals = [
    { k: 'Cash flow (monthly)', v: money2(args.netCashFlow) },
    { k: 'DSCR', v: Number.isFinite(args.dscr) ? args.dscr.toFixed(2) : '—' },
  ];

  const nextStep = isGo
    ? 'Next: verify rent comps + taxes/insurance + vacancy; then do full underwriting.'
    : 'Next: adjust price/down payment/rent/expenses until cash flow and DSCR clear the threshold.';

  return { isGo, reasons, warnings, primarySignals, nextStep, dscrMin, cocMin };
}

export default function Home() {
  // ---- Mode ----
  const [section8Mode, setSection8Mode] = useState(false);

  // ---- Purchase & financing ----
  const [purchasePrice, setPurchasePrice] = useState('500000');
  const [downPct, setDownPct] = useState('25');
  const [ratePct, setRatePct] = useState('6.75');
  const [termYears, setTermYears] = useState('30');
  const [closingCosts, setClosingCosts] = useState('0');

  // ---- Income ----
  const [monthlyRent, setMonthlyRent] = useState('4000'); // Standard rent input
  const [tenantPortionMonthly, setTenantPortionMonthly] = useState('800'); // Section 8 tenant portion
  const [hapMonthly, setHapMonthly] = useState('3200'); // Section 8 housing assistance payment
  const [otherIncome, setOtherIncome] = useState('0');

  // ---- Fixed costs ----
  const [taxesMonthly, setTaxesMonthly] = useState('520');
  const [insuranceMonthly, setInsuranceMonthly] = useState('140');
  const [hoaMonthly, setHoaMonthly] = useState('0');
  const [utilitiesMonthly, setUtilitiesMonthly] = useState('0');

  // ---- Assumptions (percent of rent/income) ----
  const [vacancyPct, setVacancyPct] = useState('5');
  const [repairsPct, setRepairsPct] = useState('5');
  const [capexPct, setCapexPct] = useState('5');
  const [mgmtPct, setMgmtPct] = useState('8');

  // ---- Section 8 guardrail reserve (simple) ----
  const [inspectionReserveMonthly, setInspectionReserveMonthly] = useState('0');

  // ---- UI ----
  const [toast, setToast] = useState<string | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);

  // Compute “rent used in calculations”
  const computedRent = useMemo(() => {
    const std = Math.max(0, toNum(monthlyRent));
    if (!section8Mode) return std;
    const tenant = Math.max(0, toNum(tenantPortionMonthly));
    const hap = Math.max(0, toNum(hapMonthly));
    return tenant + hap;
  }, [section8Mode, monthlyRent, tenantPortionMonthly, hapMonthly]);

  // Main results
  const result = useMemo(() => {
    const price = Math.max(0, toNum(purchasePrice));
    const down = clamp(toNum(downPct), 0, 100) / 100;
    const rate = clamp(toNum(ratePct), 0, 100);
    const years = Math.max(1, Math.round(toNum(termYears)));
    const close = Math.max(0, toNum(closingCosts));

    const rent = Math.max(0, computedRent);
    const other = Math.max(0, toNum(otherIncome));

    const taxes = Math.max(0, toNum(taxesMonthly));
    const ins = Math.max(0, toNum(insuranceMonthly));
    const hoa = Math.max(0, toNum(hoaMonthly));
    const utils = Math.max(0, toNum(utilitiesMonthly));

    const vacancy = clamp(toNum(vacancyPct), 0, 80) / 100;
    const repairs = clamp(toNum(repairsPct), 0, 80) / 100;
    const capex = clamp(toNum(capexPct), 0, 80) / 100;
    const mgmt = clamp(toNum(mgmtPct), 0, 30) / 100;

    const s8Reserve = section8Mode ? Math.max(0, toNum(inspectionReserveMonthly)) : 0;

    const downPayment = price * down;
    const loan = Math.max(0, price - downPayment);
    const mortgagePI = monthlyMortgagePayment(loan, rate, years);

    const grossIncome = rent + other;
    const effectiveRent = rent * (1 - vacancy);
    const effectiveIncome = effectiveRent + other;

    const percentCosts = rent * (repairs + capex + mgmt); // percent-of-rent style (screening)
    const fixedCostsNoDebt = taxes + ins + hoa + utils + s8Reserve;
    const totalExpenses = fixedCostsNoDebt + percentCosts + mortgagePI;

    const noiMonthly = effectiveIncome - (fixedCostsNoDebt + percentCosts); // NOI excludes debt
    const netCashFlow = noiMonthly - mortgagePI;

    const capRate = price > 0 ? (noiMonthly * 12) / price : NaN;
    const cashInvested = downPayment + close;
    const cashOnCash = cashInvested > 0 ? (netCashFlow * 12) / cashInvested : NaN;

    const dscr = mortgagePI > 0 ? (noiMonthly / mortgagePI) : (noiMonthly > 0 ? Infinity : NaN);

    // Break-even rent for cash flow ~= 0 (simple): solve rent so NOI == PI
    // NOI = (rent*(1-vacancy) + other) - fixed - rent*(rep+capex+mgmt)
    // Set NOI - PI = 0 => rent*(1-vacancy - rep-capex-mgmt) + other - fixed - PI = 0
    const coeff = (1 - vacancy) - (repairs + capex + mgmt);
    const breakEvenRent = coeff !== 0 ? (fixedCostsNoDebt + mortgagePI - other) / coeff : Infinity;

    const decision = scoreDecision({
      netCashFlow,
      dscr,
      cashOnCash,
      breakEvenRent,
      effectiveIncome,
      grossIncome,
      mortgagePI,
    });

    return {
      price,
      loan,
      downPayment,
      cashInvested,
      mortgagePI,
      grossIncome,
      effectiveIncome,
      fixedCostsNoDebt,
      percentCosts,
      totalExpenses,
      noiMonthly,
      netCashFlow,
      capRate,
      cashOnCash,
      dscr,
      breakEvenRent,
      decision,
    };
  }, [
    purchasePrice,
    downPct,
    ratePct,
    termYears,
    closingCosts,
    computedRent,
    otherIncome,
    taxesMonthly,
    insuranceMonthly,
    hoaMonthly,
    utilitiesMonthly,
    vacancyPct,
    repairsPct,
    capexPct,
    mgmtPct,
    section8Mode,
    inspectionReserveMonthly,
  ]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  function exportPdf() {
    const doc = new jsPDF();
    const lines: string[] = [];

    lines.push(`Deal QuickCheck (${section8Mode ? 'Section 8' : 'Standard'})`);
    lines.push(`Price: ${money(result.price)} | Loan: ${money(result.loan)} | Cash invested: ${money(result.cashInvested)}`);
    lines.push(``);
    lines.push(`PRIMARY SIGNALS`);
    lines.push(`Cash flow (mo): ${money2(result.netCashFlow)}`);
    lines.push(`DSCR: ${Number.isFinite(result.dscr) ? result.dscr.toFixed(2) : '—'}`);
    lines.push(``);
    lines.push(`KEY METRICS`);
    lines.push(`NOI (mo): ${money2(result.noiMonthly)}`);
    lines.push(`Cap rate: ${pct(result.capRate)}`);
    lines.push(`Cash-on-cash: ${pct(result.cashOnCash)}`);
    lines.push(`Break-even rent: ${money2(result.breakEvenRent)}`);
    lines.push(``);
    lines.push(`WHY ${result.decision.isGo ? 'GO' : 'NO-GO'}`);
    if (result.decision.reasons.length === 0) lines.push(`No blocking issues found for screening thresholds.`);
    result.decision.reasons.forEach((r) => lines.push(`- ${r}`));
    if (result.decision.warnings.length) {
      lines.push(``);
      lines.push(`WARNINGS`);
      result.decision.warnings.forEach((w) => lines.push(`- ${w}`));
    }
    lines.push(``);
    lines.push(`NOTE: Fast screening tool — not full underwriting.`);

    let y = 14;
    doc.setFontSize(11);
    for (const s of lines) {
      doc.text(s, 12, y);
      y += 7;
      if (y > 280) {
        doc.addPage();
        y = 14;
      }
    }
    doc.save('deal-quickcheck.pdf');
    setToast('PDF exported.');
  }

  function buildShareUrl() {
    const url = new URL(window.location.href);
    const set = (k: string, v: string) => url.searchParams.set(k, v);

    set('m', section8Mode ? 's8' : 'std');

    set('p', purchasePrice);
    set('dp', downPct);
    set('r', ratePct);
    set('t', termYears);
    set('cc', closingCosts);

    set('rent', monthlyRent);
    set('tenant', tenantPortionMonthly);
    set('hap', hapMonthly);
    set('other', otherIncome);

    set('tax', taxesMonthly);
    set('ins', insuranceMonthly);
    set('hoa', hoaMonthly);
    set('util', utilitiesMonthly);

    set('vac', vacancyPct);
    set('rep', repairsPct);
    set('capex', capexPct);
    set('mgmt', mgmtPct);

    set('s8res', inspectionReserveMonthly);

    return url.toString();
  }

  async function copyShareLink() {
    try {
      const url = buildShareUrl();
      await navigator.clipboard.writeText(url);
      setToast('Share link copied.');
    } catch {
      setToast('Could not copy link (browser blocked).');
    }
  }

  // Load from query params (sharing)
  useEffect(() => {
    const url = new URL(window.location.href);
    const qp = url.searchParams;
    if (qp.size === 0) return;

    const mode = qp.get('m');
    if (mode === 's8') setSection8Mode(true);
    if (mode === 'std') setSection8Mode(false);

    const get = (k: string, fallback: string) => qp.get(k) ?? fallback;

    setPurchasePrice(get('p', purchasePrice));
    setDownPct(get('dp', downPct));
    setRatePct(get('r', ratePct));
    setTermYears(get('t', termYears));
    setClosingCosts(get('cc', closingCosts));

    setMonthlyRent(get('rent', monthlyRent));
    setTenantPortionMonthly(get('tenant', tenantPortionMonthly));
    setHapMonthly(get('hap', hapMonthly));
    setOtherIncome(get('other', otherIncome));

    setTaxesMonthly(get('tax', taxesMonthly));
    setInsuranceMonthly(get('ins', insuranceMonthly));
    setHoaMonthly(get('hoa', hoaMonthly));
    setUtilitiesMonthly(get('util', utilitiesMonthly));

    setVacancyPct(get('vac', vacancyPct));
    setRepairsPct(get('rep', repairsPct));
    setCapexPct(get('capex', capexPct));
    setMgmtPct(get('mgmt', mgmtPct));

    setInspectionReserveMonthly(get('s8res', inspectionReserveMonthly));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fieldsPurchase: Field[] = [
    { label: 'Purchase price', hint: 'Total acquisition price.', value: purchasePrice, setValue: setPurchasePrice, right: '$', inputMode: 'numeric' },
    { label: 'Down payment', hint: 'Percent of purchase price.', value: downPct, setValue: setDownPct, right: '%', inputMode: 'decimal' },
    { label: 'Interest rate', hint: 'Annual rate (fixed).', value: ratePct, setValue: setRatePct, right: '%', inputMode: 'decimal' },
    { label: 'Loan term', hint: 'Years.', value: termYears, setValue: setTermYears, right: 'yrs', inputMode: 'numeric' },
    { label: 'Closing costs', hint: 'Cash paid at closing.', value: closingCosts, setValue: setClosingCosts, right: '$', inputMode: 'numeric' },
  ];

  const fieldsIncomeStd: Field[] = [
    { label: 'Monthly rent', hint: 'Gross monthly rent.', value: monthlyRent, setValue: setMonthlyRent, right: '$', inputMode: 'numeric' },
    { label: 'Other income', hint: 'Laundry/parking/etc.', value: otherIncome, setValue: setOtherIncome, right: '$', inputMode: 'numeric' },
  ];

  const fieldsIncomeS8: Field[] = [
    { label: 'Tenant portion', hint: 'Tenant-paid monthly portion.', value: tenantPortionMonthly, setValue: setTenantPortionMonthly, right: '$', inputMode: 'numeric' },
    { label: 'HAP payment', hint: 'Housing assistance payment (monthly).', value: hapMonthly, setValue: setHapMonthly, right: '$', inputMode: 'numeric' },
    { label: 'Other income', hint: 'Laundry/parking/etc.', value: otherIncome, setValue: setOtherIncome, right: '$', inputMode: 'numeric' },
    { label: 'Section 8 reserve', hint: 'Light buffer for inspections/turnover.', value: inspectionReserveMonthly, setValue: setInspectionReserveMonthly, right: '$', inputMode: 'numeric' },
  ];

  const fieldsFixed: Field[] = [
    { label: 'Taxes', hint: 'Monthly property taxes.', value: taxesMonthly, setValue: setTaxesMonthly, right: '$', inputMode: 'numeric' },
    { label: 'Insurance', hint: 'Monthly insurance.', value: insuranceMonthly, setValue: setInsuranceMonthly, right: '$', inputMode: 'numeric' },
    { label: 'HOA', hint: 'Monthly HOA (if any).', value: hoaMonthly, setValue: setHoaMonthly, right: '$', inputMode: 'numeric' },
    { label: 'Utilities', hint: 'Owner-paid utilities.', value: utilitiesMonthly, setValue: setUtilitiesMonthly, right: '$', inputMode: 'numeric' },
  ];

  const fieldsAssumptions: Field[] = [
    { label: 'Vacancy', hint: 'Percent of rent lost to vacancy.', value: vacancyPct, setValue: setVacancyPct, right: '%', inputMode: 'decimal' },
    { label: 'Repairs', hint: 'Percent of rent for repairs.', value: repairsPct, setValue: setRepairsPct, right: '%', inputMode: 'decimal' },
    { label: 'CapEx', hint: 'Percent of rent for capital reserves.', value: capexPct, setValue: setCapexPct, right: '%', inputMode: 'decimal' },
    { label: 'Management', hint: 'Percent of rent for management.', value: mgmtPct, setValue: setMgmtPct, right: '%', inputMode: 'decimal' },
  ];

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={styles.h1}>Deal QuickCheck</div>
          <div style={styles.sub}>
            Fast screening tool — makes the “why” behind Go / No-Go obvious. Not full underwriting.
          </div>
        </div>

        <div style={styles.badge}>
          Mode: <strong>{section8Mode ? 'Section 8' : 'Standard'}</strong>
        </div>
      </header>

      {/* Decision Banner */}
      <div
        style={{
          ...styles.verdict,
          ...(result.decision.isGo ? styles.verdictGo : styles.verdictNoGo),
        }}
      >
        <div style={styles.verdictTop}>
          <div>
            <div style={styles.verdictTitle}>
              {result.decision.isGo ? 'GO (screening)' : 'NO-GO (screening)'}
            </div>

            {/* NEW: disclaimer directly under the verdict */}
            <div style={{ marginTop: 6, fontSize: 12, color: 'rgba(255,255,255,0.72)' }}>
              This is a fast screening result based on current inputs — not a full underwriting or investment recommendation.
            </div>
          </div>

          <div style={styles.primarySignals}>
            {result.decision.primarySignals.map((s) => (
              <div key={s.k} style={styles.signalPill}>
                <span style={styles.signalKey}>{s.k}</span>
                <span style={styles.signalVal}>{s.v}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.whyBox}>
          <div style={styles.whyTitle}>Why this screens as {result.decision.isGo ? 'GO' : 'NO-GO'}:</div>

          {result.decision.reasons.length === 0 ? (
            <div style={styles.whyItem}>No blocking issues found for the screening thresholds.</div>
          ) : (
            result.decision.reasons.map((r, idx) => (
              <div key={idx} style={styles.whyItem}>• {r}</div>
            ))
          )}

          {result.decision.warnings.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={styles.warnTitle}>Warnings (not blockers):</div>
              {result.decision.warnings.map((w, idx) => (
                <div key={idx} style={styles.warnItem}>• {w}</div>
              ))}
            </div>
          )}

          <div style={styles.nextStep}>{result.decision.nextStep}</div>

          {/* UPDATED: guardrail copy */}
          <div style={styles.guardrail}>
            Guardrail: This tool is for quick screening only. Always verify rent comps, expenses, and run full underwriting before making decisions.
            {section8Mode && ' Section 8 mode is especially sensitive to inspection/turnover assumptions.'}
          </div>
        </div>
      </div>

      <section style={styles.grid2}>
        <Card title="Purchase & Financing">
          {fieldsPurchase.map((f) => (
            <FieldRow key={f.label} {...f} />
          ))}
        </Card>

        <Card title="Income & Fixed Costs">
          <div style={styles.inlineToggleRow}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.72)' }}>
              Decision is driven mainly by <strong>Cash flow</strong> + <strong>DSCR</strong>.
            </div>

            <div style={styles.toggleWrap}>
              <span style={{ opacity: section8Mode ? 0.5 : 1 }}>Standard</span>

              <button
                type="button"
                onClick={() => setSection8Mode((v) => !v)}
                style={{
                  ...styles.toggle,
                  ...(section8Mode ? styles.toggleOn : styles.toggleOff),
                }}
                aria-label="Toggle Section 8 mode"
              >
                <span
                  style={{
                    ...styles.toggleKnob,
                    transform: section8Mode ? 'translateX(22px)' : 'translateX(0)',
                  }}
                />
              </button>

              <span style={{ opacity: section8Mode ? 1 : 0.5 }}>Section 8</span>
            </div>
          </div>

          <div style={styles.divider} />

          {(section8Mode ? fieldsIncomeS8 : fieldsIncomeStd).map((f) => (
            <FieldRow key={f.label} {...f} />
          ))}

          <div style={styles.divider} />

          {fieldsFixed.map((f) => (
            <FieldRow key={f.label} {...f} />
          ))}

          <div style={{ marginTop: 10, fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>
            Rent used in calculations: <strong>{money(computedRent)}</strong>
          </div>
        </Card>
      </section>

      <section style={{ ...styles.grid2, marginTop: 16 }}>
        <Card title="Assumptions (percent of rent)">
          {fieldsAssumptions.map((f) => (
            <FieldRow key={f.label} {...f} />
          ))}
        </Card>

        <Card title="Results">
          <div style={styles.kpiGrid}>
            <KPI label="Net monthly cash flow" value={money2(result.netCashFlow)} emphasis />
            <KPI label="DSCR" value={Number.isFinite(result.dscr) ? result.dscr.toFixed(2) : '—'} emphasis />
            <KPI label="NOI (monthly)" value={money2(result.noiMonthly)} />
            <KPI label="Mortgage (P&I)" value={money2(result.mortgagePI)} />
            <KPI label="Cap rate" value={pct(result.capRate)} />
            <KPI label="Cash-on-cash (annual)" value={pct(result.cashOnCash)} />
            <KPI label="Break-even rent" value={money2(result.breakEvenRent)} />
            <KPI label="Cash invested (DP + closing)" value={money2(result.cashInvested)} />
          </div>

          <div style={styles.rowBetween}>
            <button
              onClick={() => setShowBreakdown((v) => !v)}
              style={styles.secondaryBtn}
              type="button"
            >
              {showBreakdown ? 'Hide breakdown' : 'Show breakdown'}
            </button>

            <button
              onClick={() => {
                setSection8Mode(false);
                setPurchasePrice('500000');
                setDownPct('25');
                setRatePct('6.75');
                setTermYears('30');
                setClosingCosts('0');
                setMonthlyRent('4000');
                setHapMonthly('3200');
                setTenantPortionMonthly('800');
                setInspectionReserveMonthly('0');
                setOtherIncome('0');
                setTaxesMonthly('520');
                setInsuranceMonthly('140');
                setHoaMonthly('0');
                setUtilitiesMonthly('0');
                setVacancyPct('5');
                setRepairsPct('5');
                setCapexPct('5');
                setMgmtPct('8');
              }}
              style={styles.ghostBtn}
              type="button"
            >
              Reset example
            </button>
          </div>

          {showBreakdown && (
            <div style={styles.breakdown}>
              <div style={styles.breakdownTitle}>Breakdown</div>
              <Line label="Gross monthly income" value={money2(result.grossIncome)} />
              <Line label="Effective income (after vacancy)" value={money2(result.effectiveIncome)} />
              <Line label="Fixed costs (tax/ins/hoa/utils + reserves)" value={money2(result.fixedCostsNoDebt)} />
              <Line label="Variable costs (repairs/capex/mgmt)" value={money2(result.percentCosts)} />
              <Line label="Debt service (mortgage P&I)" value={money2(result.mortgagePI)} />
              <Line label="Total monthly expenses" value={money2(result.totalExpenses)} />
            </div>
          )}

          <div style={styles.note}>
            Note: This is a quick estimator (not underwriting). Add property-level items (leasing, turnover, legal, permits, rehab, etc.) in full underwriting.
            {section8Mode && ' Section 8 mode includes a simple optional reserve to prevent “false GO” results.'}
          </div>
        </Card>
      </section>

      <Card title="Share & Export" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" style={styles.secondaryBtn} onClick={copyShareLink}>
            Share this deal
          </button>
          <button type="button" style={styles.secondaryBtn} onClick={exportPdf}>
            Export PDF
          </button>
        </div>

        {toast && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'rgba(255,255,255,0.80)' }}>
            {toast}
          </div>
        )}
      </Card>
    </div>
  );
}

function Card({
  title,
  children,
  style,
}: {
  title: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ ...styles.card, ...(style ?? {}) }}>
      <div style={styles.cardTitle}>{title}</div>
      <div>{children}</div>
    </div>
  );
}

function FieldRow({ label, hint, value, setValue, right, inputMode }: Field) {
  return (
    <label style={styles.fieldRow}>
      <div style={styles.fieldLeft}>
        <div style={styles.fieldLabel}>{label}</div>
        {hint ? <div style={styles.fieldHint}>{hint}</div> : null}
      </div>

      <div style={styles.fieldRight}>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          inputMode={inputMode ?? 'decimal'}
          style={styles.input}
        />
        <div style={styles.unit}>{right}</div>
      </div>
    </label>
  );
}

function KPI({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div style={{ ...styles.kpi, ...(emphasis ? styles.kpiEmphasis : null) }}>
      <div style={styles.kpiLabel}>{label}</div>
      <div style={styles.kpiValue}>{value}</div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.line}>
      <span style={styles.lineLabel}>{label}</span>
      <span style={styles.lineValue}>{value}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background:
      'radial-gradient(1200px 600px at 20% 0%, rgba(59,130,246,0.18), transparent 55%), radial-gradient(900px 500px at 80% 20%, rgba(34,197,94,0.14), transparent 55%), #0b1020',
    color: 'rgba(255,255,255,0.92)',
    padding: 20,
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto',
  },
  header: {
    maxWidth: 1100,
    margin: '0 auto 18px auto',
    display: 'flex',
    gap: 14,
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  h1: { fontSize: 26, fontWeight: 760, letterSpacing: 0.2 },
  sub: { marginTop: 6, color: 'rgba(255,255,255,0.72)', maxWidth: 720 },

  badge: {
    display: 'inline-flex',
    padding: '6px 10px',
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'rgba(255,255,255,0.16)',
    background: 'rgba(255,255,255,0.06)',
    fontSize: 12,
    letterSpacing: 0.2,
  },

  verdict: {
    maxWidth: 1100,
    margin: '0 auto 16px auto',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderStyle: 'solid',
    backdropFilter: 'blur(10px)',
  },
  verdictGo: {
    borderColor: 'rgba(34,197,94,0.35)',
    background: 'rgba(34,197,94,0.10)',
  },
  verdictNoGo: {
    borderColor: 'rgba(239,68,68,0.35)',
    background: 'rgba(239,68,68,0.10)',
  },
  verdictTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  verdictTitle: { fontSize: 18, fontWeight: 800, letterSpacing: 0.2 },
  primarySignals: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  signalPill: {
    display: 'flex',
    gap: 8,
    alignItems: 'baseline',
    padding: '6px 10px',
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'rgba(255,255,255,0.16)',
    background: 'rgba(0,0,0,0.18)',
  },
  signalKey: { fontSize: 12, color: 'rgba(255,255,255,0.72)' },
  signalVal: { fontSize: 13, fontWeight: 800 },

  whyBox: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: 'rgba(255,255,255,0.10)',
  },
  whyTitle: { fontSize: 13, fontWeight: 800, marginBottom: 8 },
  whyItem: { fontSize: 13, color: 'rgba(255,255,255,0.88)', marginTop: 4 },
  warnTitle: { fontSize: 12, fontWeight: 800, color: 'rgba(255,255,255,0.80)', marginBottom: 6 },
  warnItem: { fontSize: 12, color: 'rgba(255,255,255,0.72)', marginTop: 4 },
  nextStep: { marginTop: 10, fontSize: 12.5, color: 'rgba(255,255,255,0.82)', fontWeight: 650 },
  guardrail: { marginTop: 10, fontSize: 12, color: 'rgba(255,255,255,0.62)' },

  grid2: {
    maxWidth: 1100,
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: 14,
  },

  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'rgba(255,255,255,0.14)',
    background: 'rgba(255,255,255,0.06)',
    padding: 14,
    backdropFilter: 'blur(10px)',
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: 800,
    marginBottom: 10,
    color: 'rgba(255,255,255,0.90)',
  },

  fieldRow: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 12,
    padding: '10px 0',
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  fieldLeft: {},
  fieldLabel: { fontSize: 13, fontWeight: 650 },
  fieldHint: { marginTop: 4, fontSize: 12, color: 'rgba(255,255,255,0.60)' },

  fieldRight: { display: 'flex', gap: 8, alignItems: 'center' },
  input: {
    width: 120,
    padding: '8px 10px',
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'rgba(255,255,255,0.18)',
    background: 'rgba(0,0,0,0.20)',
    color: 'rgba(255,255,255,0.92)',
    outline: 'none',
  },
  unit: { width: 32, fontSize: 12, color: 'rgba(255,255,255,0.65)', textAlign: 'right' },

  divider: {
    height: 1,
    background: 'rgba(255,255,255,0.10)',
    margin: '12px 0',
  },

  inlineToggleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 8,
  },

  toggleWrap: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 10,
    fontSize: 12,
    color: 'rgba(255,255,255,0.85)',
  },
  toggle: {
    position: 'relative',
    width: 46,
    height: 24,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'rgba(255,255,255,0.18)',
    cursor: 'pointer',
    padding: 0,
    transition: 'background 0.25s ease',
    background: 'rgba(255,255,255,0.12)',
  },
  toggleOn: {
    background: 'linear-gradient(135deg, #22c55e, #16a34a)',
    borderColor: 'rgba(34,197,94,0.60)',
  },
  toggleOff: {
    background: 'rgba(255,255,255,0.12)',
  },
  toggleKnob: {
    position: 'absolute',
    top: 2,
    left: 2,
    width: 18,
    height: 18,
    borderRadius: '50%',
    background: '#ffffff',
    transition: 'transform 0.25s ease',
  },

  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
    gap: 10,
  },
  kpi: {
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'rgba(255,255,255,0.12)',
    background: 'rgba(0,0,0,0.16)',
  },
  kpiEmphasis: {
    borderColor: 'rgba(255,255,255,0.22)',
    background: 'rgba(0,0,0,0.22)',
  },
  kpiLabel: { fontSize: 12, color: 'rgba(255,255,255,0.70)' },
  kpiValue: { marginTop: 6, fontSize: 16, fontWeight: 850 },

  rowBetween: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
    marginTop: 12,
  },
  secondaryBtn: {
    padding: '9px 12px',
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'rgba(255,255,255,0.18)',
    background: 'rgba(255,255,255,0.08)',
    color: 'rgba(255,255,255,0.92)',
    cursor: 'pointer',
  },
  ghostBtn: {
    padding: '9px 12px',
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'rgba(255,255,255,0.12)',
    background: 'transparent',
    color: 'rgba(255,255,255,0.80)',
    cursor: 'pointer',
  },

  breakdown: {
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'rgba(255,255,255,0.12)',
    background: 'rgba(0,0,0,0.16)',
  },
  breakdownTitle: { fontSize: 12, fontWeight: 850, marginBottom: 8, color: 'rgba(255,255,255,0.82)' },

  line: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    padding: '8px 0',
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  lineLabel: { fontSize: 12, color: 'rgba(255,255,255,0.70)' },
  lineValue: { fontSize: 12, fontWeight: 750 },

  note: { marginTop: 12, fontSize: 12, color: 'rgba(255,255,255,0.62)' },
};
