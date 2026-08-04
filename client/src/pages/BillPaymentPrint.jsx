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
// "Aug 03, 2026" -- the long form the voucher header uses.
function longDate(v) {
  return v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) : '';
}
// "07/31/2026" -- the short form used inside the applied-bills table.
function shortDate(v) {
  return v ? new Date(v).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '';
}

// The Payment Voucher hand-out that accompanies a Bill Payment -- letterhead, who was paid,
// what it settled, the amount spelled out, and the four sign-off boxes. Laid out to match the
// voucher this replaces, but the company block is driven by COMPANY (client/.env) rather than
// hardcoded, so it follows whoever the system is branded for.
export default function BillPaymentPrint() {
  const { id } = useParams();
  const [bp, setBp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [logoOk, setLogoOk] = useState(true);

  useEffect(() => {
    api.get(`/bill-payments/${id}`).then(({ data }) => { setBp(data); setLoading(false); });
  }, [id]);

  if (loading || !bp) return <LoadingSpinner />;

  // Credit lines offset the payment rather than being paid out, so only the bill lines are
  // itemised here -- the same rows the voucher's table is meant to show.
  const billLines = (bp.lines || []).filter((l) => l.vendor_bill_id);
  const total = billLines.reduce((s, l) => s + Number(l.applied_amount || 0), 0);

  return (
    <div className="estimate-print">
      <div className="print-toolbar">
        <button className="btn btn-primary" onClick={() => window.print()}>Print</button>
      </div>

      <div className="print-sheet">
        <div className="print-letterhead">
          {/* Drop the company logo in as client/public/company-logo.png. Falling back to the
              name keeps the voucher usable (and printable) when no logo file is present. */}
          {logoOk
            ? <img src="/company-logo.png" alt={COMPANY.name} className="print-logo-img" onError={() => setLogoOk(false)} />
            : <div className="print-logo">{COMPANY.name}</div>}
          <div className="print-company-address">
            <strong>{COMPANY.name}</strong><br />
            {COMPANY.addressLine1}{COMPANY.addressLine1 && <br />}
            {COMPANY.addressLine2}{COMPANY.addressLine2 && <br />}
            {COMPANY.phone && <>Tel. {COMPANY.phone}<br /></>}
            {COMPANY.website}
          </div>
        </div>

        <h2 className="print-title">Payment Voucher</h2>

        <div className="print-info-grid">
          <div>
            <div><strong>Date :</strong> {longDate(bp.date_created)}</div>
            <div><strong>Paid To :</strong> {bp.supplier_name || ''}</div>
            <div><strong>Payee Name :</strong> {bp.payee_name || bp.supplier_name || ''}</div>
            <div><strong>Memo :</strong> {bp.memo || ''}</div>
          </div>
          <div>
            {/* The cheque number identifies the payment when one was issued; otherwise the
                operator's reference, and failing both the voucher's own number. */}
            <div><strong>Ref # :</strong> {bp.check_no || bp.reference_no || bp.bill_payment_no}</div>
            <div><strong>Amount in words :</strong> {amountInWords(total)}</div>
          </div>
        </div>

        <table className="print-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th className="num">Orig Amount</th>
              <th className="num">Amount Due</th>
              <th className="num">Applied</th>
            </tr>
          </thead>
          <tbody>
            {billLines.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center' }}>No bills applied.</td></tr>
            )}
            {billLines.map((l) => (
              <tr key={l.id}>
                <td>{shortDate(l.vb_date_created)}</td>
                <td>{l.vb_memo || l.vb_reference_no || l.bill_no}</td>
                <td className="num">{money(l.vb_gross_amount)}</td>
                <td className="num">{money(l.amount_due_before ?? l.vb_gross_amount)}</td>
                <td className="num">{money(l.applied_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="print-voucher-total"><strong>Total : {money(total)}</strong></div>

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
