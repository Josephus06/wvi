import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import { amountInWords } from '../utils/amountInWords';

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
}

// Cheque overlay for a Bill Payment. Unlike the Voucher this is NOT a document in its own
// right -- it prints onto pre-printed cheque stock, so the page is deliberately near-empty
// and every field is positioned to land inside a box that is already on the paper.
//
// Nothing else may print: no letterhead, no logo, no table, no borders. Anything extra lands
// across the bank's own artwork.
//
// Alignment is driven by the --chq-* variables in index.css (millimetres from the top-left of
// the sheet). Cheque stock differs between banks, so those are the knobs to nudge -- print
// one onto plain paper, hold it against a real cheque, and adjust.
export default function BillPaymentCheque() {
  const { id } = useParams();
  const [bp, setBp] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/bill-payments/${id}`).then(({ data }) => { setBp(data); setLoading(false); });
  }, [id]);

  if (loading || !bp) return <LoadingSpinner />;

  // The cheque carries its own date, which is the point of post-dating; fall back to the
  // payment date when none was entered.
  const d = new Date(bp.check_date || bp.date_created);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = String(d.getFullYear());

  const amount = Number(bp.total_amount || 0);

  return (
    <div className="cheque-print">
      <div className="print-toolbar">
        <button className="btn btn-primary" onClick={() => window.print()}>Print</button>
        <span className="muted" style={{ marginLeft: 12, fontSize: 12 }}>
          Load a blank cheque in the printer. Print one on plain paper first and hold it against
          a cheque to check alignment.
        </span>
      </div>

      <div className="cheque-sheet">
        {/* Date digits are spaced to drop one per box in the cheque's MM DD YYYY grid. */}
        <div className="chq-date">
          <span className="chq-date-group">{mm}</span>
          <span className="chq-date-group">{dd}</span>
          <span className="chq-date-group">{yyyy}</span>
        </div>

        <div className="chq-payee">{bp.payee_name || bp.supplier_name || ''}</div>
        <div className="chq-amount">{money(amount)}</div>
        <div className="chq-words">{amountInWords(amount)}</div>
      </div>
    </div>
  );
}
