import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import EntityPicker from '../components/EntityPicker';
import LoadingSpinner from '../components/LoadingSpinner';

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
}
function accountLabel(a) { return a ? `${a.account_code} — ${a.account_name}` : ''; }
function wtaxLabel(w) { return w ? `${w.code} — ${w.name} (${w.rate}%)` : ''; }
function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

// Amount is the line's net-of-tax figure -- Tax Amount, Gross Amount and the withholding
// deduction all derive from it. Display-only: the server recomputes every figure from
// amount + tax rate on Save and never trusts what's shown here.
function computeLine(l, wtaxRate) {
  const amount = Number(l.amount) || 0;
  const taxAmount = amount * ((Number(l.tax_rate) || 0) / 100);
  const grossAmount = amount + taxAmount;
  const wtaxAmount = l.is_withhold ? amount * (Number(wtaxRate || 0) / 100) : 0;
  return { tax_amount: taxAmount, gross_amount: grossAmount, wtax_amount: wtaxAmount, amount_due: grossAmount - wtaxAmount };
}

// Mirrors the real standalone "Vendor Bill > Create" form (#/vendor_bill_crud, reached from
// Saved Vendor Bills' "Add Vendor Bill" button) -- a bill entered directly against a vendor
// with no Purchase Order behind it. Its lines are Chart of Accounts expense lines, not item
// lines, so the Account field here is the payable being credited (defaulting to Accounts
// Payable - Trade, as on the real screen) while each line carries its own debit account.
export default function VendorBillCreate() {
  const navigate = useNavigate();

  const [suppliers, setSuppliers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [taxes, setTaxes] = useState([]);
  const [terms, setTerms] = useState([]);
  const [withholdingTaxes, setWithholdingTaxes] = useState([]);

  const [dateCreated, setDateCreated] = useState(new Date().toISOString().slice(0, 10));
  const [supplier, setSupplier] = useState(null);
  const [account, setAccount] = useState(null);
  const [referenceNo, setReferenceNo] = useState('');
  const [officeLocation, setOfficeLocation] = useState(null);
  const [term, setTerm] = useState(null);
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState([]);
  const [wtax, setWtax] = useState(null);
  const [tab, setTab] = useState('expenses');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/suppliers'),
      api.get('/lookups/chart-of-accounts'),
      api.get('/lookups/locations'),
      api.get('/lookups/departments'),
      api.get('/lookups/taxes'),
      api.get('/lookups/payment-terms'),
      api.get('/lookups/withholding-taxes'),
    ]).then(([supRes, acctRes, locRes, deptRes, taxRes, termRes, wtaxRes]) => {
      setSuppliers(supRes.data);
      setAccounts(acctRes.data);
      setLocations(locRes.data);
      setDepartments(deptRes.data);
      setTaxes(taxRes.data);
      setTerms(termRes.data);
      setWithholdingTaxes(wtaxRes.data);
      // Accounts Payable - Trade (20100) is the default the real form opens with, but that
      // code only exists in the originating system's chart -- fall back to whatever this
      // company numbers its trade payable as, and to nothing if it has none.
      setAccount(
        acctRes.data.find((a) => a.account_code === '20100')
        || acctRes.data.find((a) => /^accounts payable/i.test(a.account_name || ''))
        || null
      );
      setLoading(false);
    });
  }, []);

  const wtaxRate = wtax ? Number(wtax.rate) : 0;
  const computedLines = useMemo(() => lines.map((l) => ({ ...l, ...computeLine(l, wtaxRate) })), [lines, wtaxRate]);

  const subtotal = computedLines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const taxAmount = computedLines.reduce((s, l) => s + l.tax_amount, 0);
  const grossAmount = computedLines.reduce((s, l) => s + l.gross_amount, 0);
  const wtaxAmountTotal = computedLines.reduce((s, l) => s + l.wtax_amount, 0);
  const amountDue = grossAmount - wtaxAmountTotal;
  const dateDue = term ? addDays(dateCreated, term.no_of_days) : dateCreated;

  function addLine() {
    setLines((prev) => [...prev, {
      key: prev.reduce((m, l) => Math.max(m, l.key), 0) + 1,
      account_id: '', description: '', department_id: '', amount: 0, tax_code_id: '', tax_rate: 0, is_withhold: false,
    }]);
  }
  function updateLine(key, patch) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  async function handleSave() {
    setError('');
    if (!supplier) { setError('Select a Vendor.'); return; }
    const submitted = lines.filter((l) => l.account_id && Number(l.amount) > 0);
    if (!submitted.length) { setError('Add at least one expense line with an Account and an Amount.'); return; }

    setSaving(true);
    try {
      const { data } = await api.post('/vendor-bills', {
        supplier_id: supplier.id,
        date_created: dateCreated,
        term_id: term?.id || null,
        reference_no: referenceNo || null,
        account_id: account?.id || null,
        office_location_id: officeLocation?.id || null,
        memo,
        wtax_id: wtax?.id || null,
        expense_lines: submitted.map((l) => ({
          account_id: l.account_id,
          description: l.description || null,
          department_id: l.department_id || null,
          amount: l.amount,
          tax_code_id: l.tax_code_id || null,
          is_withhold: l.is_withhold,
        })),
      });
      navigate(`/vendor-bills/${data.id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingSpinner />;

  return (
    <div>
      <div className="page-header">
        <h1>Vendor Bill — Create</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => navigate('/vendor-bills')}>Back to Lists</button>
          <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? <LoadingSpinner inline size="sm" label="Saving..." /> : 'Save'}
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <div className="review-grid" style={{ gridTemplateColumns: '1fr 1fr 260px' }}>
          <div>
            <div className="field"><label>Date</label><input type="date" value={dateCreated} onChange={(e) => setDateCreated(e.target.value)} /></div>
            <div className="field">
              <label>Vendor</label>
              <EntityPicker
                label="Vendor" items={suppliers} value={supplier?.id || ''} getLabel={(s) => s?.name}
                columns={[{ key: 'name', label: 'Name' }]} searchKeys={['name']}
                onSelect={setSupplier}
              />
            </div>
            <div className="field">
              <label>Account</label>
              <EntityPicker
                label="Account" items={accounts} value={account?.id || ''} getLabel={accountLabel}
                columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }, { key: 'account_type', label: 'Type' }]}
                searchKeys={['account_code', 'account_name']}
                onSelect={setAccount}
              />
            </div>
            <div className="field"><label>Reference #</label><input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} /></div>
          </div>
          <div>
            {/* Date Due is the Term's no_of_days off the Date -- read-only here and recomputed
                server-side on Save, so the two can never disagree. */}
            <div className="field"><label>Date Due</label><input readOnly tabIndex={-1} value={dateDue} /></div>
            <div className="field">
              <label>Office Location</label>
              <EntityPicker
                label="Office Location" items={locations} value={officeLocation?.id || ''} getLabel={(l) => l.location_name}
                columns={[{ key: 'location_name', label: 'Name' }]} searchKeys={['location_name']}
                onSelect={setOfficeLocation}
              />
            </div>
            <div className="field">
              <label>Term</label>
              <EntityPicker
                label="Term" items={terms} value={term?.id || ''} getLabel={(t) => t?.term_name}
                columns={[{ key: 'term_name', label: 'Term' }, { key: 'no_of_days', label: 'Days' }]} searchKeys={['term_name']}
                onSelect={setTerm}
              />
            </div>
            <div className="field"><label>Memo</label><textarea rows={3} value={memo} onChange={(e) => setMemo(e.target.value)} /></div>
          </div>
          <div className="card" style={{ background: 'var(--surface-2, #f3f4f6)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Sub Total</span><span className="hi">{money(subtotal)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Discount Amount</span><span className="hi">{money(0)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Net of Tax</span><span className="hi">{money(subtotal)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Tax Amount</span><span className="hi">{money(taxAmount)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Gross Amount</span><span className="hi">{money(grossAmount)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Withholding Tax Amount</span><span className="hi">{money(wtaxAmountTotal)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Amount</span><span className="hi">{money(grossAmount)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}><span>Amount Due</span><span>{money(amountDue)}</span></div>
          </div>
        </div>
      </div>

      <div className="status-tabs" style={{ marginTop: 20 }}>
        <button className={`status-tab ${tab === 'expenses' ? 'active' : ''}`} onClick={() => setTab('expenses')}>Expenses {money(grossAmount)}</button>
        <button className={`status-tab ${tab === 'wtax' ? 'active' : ''}`} onClick={() => setTab('wtax')}>Withholding Tax {money(wtaxAmountTotal)}</button>
      </div>

      {tab === 'expenses' && (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Account</th><th>Description</th><th>Department</th><th>Amount</th>
                  <th>Tax Code</th><th>Tax Amount</th><th>Gross Amount</th>
                  <th>Apply Withholding Tax</th><th>Withholding Tax Amount</th><th>Amount Due</th><th></th>
                </tr>
              </thead>
              <tbody>
                {computedLines.length === 0 && (
                  <tr><td colSpan={11} className="muted" style={{ textAlign: 'center', padding: 20 }}>No expense lines yet.</td></tr>
                )}
                {computedLines.map((l) => (
                  <tr key={l.key}>
                    <td>
                      <EntityPicker
                        label="Account" items={accounts} value={l.account_id} getLabel={accountLabel}
                        columns={[{ key: 'account_code', label: 'Code' }, { key: 'account_name', label: 'Name' }, { key: 'account_type', label: 'Type' }]}
                        searchKeys={['account_code', 'account_name']}
                        onSelect={(a) => updateLine(l.key, { account_id: a.id })}
                      />
                    </td>
                    <td>
                      <input
                        style={{ minWidth: 160 }}
                        value={l.description}
                        onChange={(e) => updateLine(l.key, { description: e.target.value })}
                      />
                    </td>
                    <td>
                      <EntityPicker
                        label="Department" items={departments} value={l.department_id} getLabel={(d) => d.name}
                        columns={[{ key: 'name', label: 'Name' }]} searchKeys={['name']}
                        onSelect={(d) => updateLine(l.key, { department_id: d.id })}
                      />
                    </td>
                    <td>
                      <input
                        type="number" step="0.01" style={{ width: 110 }}
                        value={l.amount}
                        onChange={(e) => updateLine(l.key, { amount: e.target.value })}
                      />
                    </td>
                    <td>
                      <EntityPicker
                        label="Tax Code" items={taxes} value={l.tax_code_id} getLabel={(t) => `${t.code} (${t.rate}%)`}
                        columns={[{ key: 'code', label: 'Code' }, { key: 'rate', label: 'Rate %' }]} searchKeys={['code']}
                        onSelect={(t) => updateLine(l.key, { tax_code_id: t.id, tax_rate: t.rate })}
                      />
                    </td>
                    <td>{money(l.tax_amount)}</td>
                    <td>{money(l.gross_amount)}</td>
                    <td>
                      <input
                        type="checkbox" checked={!!l.is_withhold}
                        onChange={(e) => updateLine(l.key, { is_withhold: e.target.checked })}
                      />
                    </td>
                    <td>{money(l.wtax_amount)}</td>
                    <td>{money(l.amount_due)}</td>
                    <td><button type="button" className="btn btn-sm btn-danger" onClick={() => removeLine(l.key)}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn btn-primary" style={{ marginTop: 10 }} onClick={addLine}>Add</button>
        </div>
      )}

      {tab === 'wtax' && (
        <div className="card">
          <div className="review-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="field">
              <label>Withholding Tax</label>
              <EntityPicker
                label="Withholding Tax" items={withholdingTaxes} value={wtax?.id || ''} getLabel={wtaxLabel}
                columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'rate', label: 'Rate %' }]}
                searchKeys={['code', 'name']}
                onSelect={setWtax}
              />
            </div>
            <div className="field"><label>Withholding Tax Description</label><input readOnly tabIndex={-1} value={wtax?.name || ''} /></div>
            <div className="field"><label>Withholding Tax Amount</label><input readOnly tabIndex={-1} value={money(wtaxAmountTotal)} /></div>
          </div>
        </div>
      )}
    </div>
  );
}
