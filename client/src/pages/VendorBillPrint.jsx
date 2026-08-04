import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import { COMPANY } from '../config/company';
import { amountInWords } from '../utils/amountInWords';

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
}
function longDate(v) {
  return v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) : '';
}

// Vendor Bill hand-out, sharing the Payment Voucher's sheet: same letterhead, same header
// block, same sign-off strip. Where the voucher itemises the bills a payment settled, this
// prints the bill's GL Impact -- the journal entry it posts -- which is what an approver is
// actually checking before signing.
export default function VendorBillPrint() {
  const { id } = useParams();
  const [vb, setVb] = useState(null);
  const [loading, setLoading] = useState(true);
  const [logoOk, setLogoOk] = useState(true);

  useEffect(() => {
    api.get(`/vendor-bills/${id}`).then(({ data }) => { setVb(data); setLoading(false); });
  }, [id]);

  if (loading || !vb) return <LoadingSpinner />;

  const gl = vb.gl_impact || [];
  const debitTotal = gl.reduce((s, r) => s + Number(r.debit || 0), 0);
  const creditTotal = gl.reduce((s, r) => s + Number(r.credit || 0), 0);

  return (
    <div className="estimate-print">
      <div className="print-toolbar">
        <button className="btn btn-primary" onClick={() => window.print()}>Print</button>
      </div>

      <div className="print-sheet voucher-sheet">
        <div className="print-letterhead">
          {logoOk && (
            <img src="/company-logo.png" alt={COMPANY.name} className="print-logo-img" onError={() => setLogoOk(false)} />
          )}
          <div className="print-company-address">
            <strong>{COMPANY.name}</strong><br />
            {COMPANY.addressLine1}{COMPANY.addressLine1 && <br />}
            {COMPANY.addressLine2}{COMPANY.addressLine2 && <br />}
            {COMPANY.phone && <>Tel. {COMPANY.phone}<br /></>}
            {COMPANY.website}
          </div>
        </div>

        <h2 className="print-title">Vendor Bill</h2>

        <div className="voucher-grid">
          <dl className="voucher-fields">
            <dt>Date :</dt><dd>{longDate(vb.date_created)}</dd>
            <dt>Vendor :</dt><dd>{vb.supplier_name || ''}</dd>
            <dt>Account :</dt><dd>{vb.account_code ? `${vb.account_code} — ${vb.account_name}` : ''}</dd>
            <dt>Memo :</dt><dd>{vb.memo || ''}</dd>
          </dl>
          <dl className="voucher-fields">
            <dt>Bill # :</dt><dd>{vb.bill_no}</dd>
            <dt>Reference # :</dt><dd>{vb.reference_no || ''}</dd>
            <dt>Date Due :</dt><dd>{longDate(vb.date_due)}{vb.term ? ` (${vb.term})` : ''}</dd>
            {/* The bill's face value, not its outstanding balance -- the balance moves as
                payments land, and a printed document should not go stale. */}
            <dt>Amount in words :</dt><dd>{amountInWords(vb.gross_amount)}</dd>
          </dl>
        </div>

        <table className="print-table">
          <thead>
            <tr>
              <th>Account Code</th>
              <th>Account Title</th>
              <th className="num">Debit</th>
              <th className="num">Credit</th>
            </tr>
          </thead>
          <tbody>
            {gl.length === 0 && (
              <tr><td colSpan={4} style={{ textAlign: 'center' }}>No GL impact.</td></tr>
            )}
            {gl.map((r, i) => (
              <tr key={i}>
                <td>{r.account_code}</td>
                <td>{r.account_name}</td>
                <td className="num">{r.debit ? money(r.debit) : ''}</td>
                <td className="num">{r.credit ? money(r.credit) : ''}</td>
              </tr>
            ))}
            {gl.length > 0 && (
              <tr>
                <td /><td />
                <td className="num"><strong>{money(debitTotal)}</strong></td>
                <td className="num"><strong>{money(creditTotal)}</strong></td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="print-voucher-total"><strong>Amount Due : {money(vb.amount_due)}</strong></div>

        <div className="print-signatures">
          <div>Prepared By:</div>
          <div>Checked By:</div>
          <div>Approved By:</div>
          <div>Received By:</div>
        </div>
      </div>
    </div>
  );
}
