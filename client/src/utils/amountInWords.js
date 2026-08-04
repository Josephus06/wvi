// Spells a peso amount the way a Payment Voucher has to read it:
//   13303.92 -> "THIRTEEN THOUSAND THREE HUNDRED THREE PESOS and NINETY TWO CENTAVOS ONLY"
//
// Matches the wording of the vouchers this replaces: no "AND" between hundreds and tens
// ("THREE HUNDRED THREE", not "THREE HUNDRED AND THREE"), tens hyphen-free ("NINETY TWO"),
// a lowercase "and" joining pesos to centavos, and "ONLY" to close.
const ONES = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
  'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN',
  'EIGHTEEN', 'NINETEEN'];
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
// Indexed by group of three digits, so 1 = thousand, 2 = million, and so on.
const SCALES = ['', 'THOUSAND', 'MILLION', 'BILLION', 'TRILLION'];

function underThousand(n) {
  const parts = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) parts.push(`${ONES[hundreds]} HUNDRED`);
  if (rest < 20) {
    if (rest) parts.push(ONES[rest]);
  } else {
    const tens = Math.floor(rest / 10);
    const ones = rest % 10;
    parts.push(ones ? `${TENS[tens]} ${ONES[ones]}` : TENS[tens]);
  }
  return parts.join(' ');
}

export function numberToWords(value) {
  let n = Math.floor(Math.abs(Number(value) || 0));
  if (n === 0) return 'ZERO';
  const groups = [];
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }
  if (groups.length > SCALES.length) return null; // beyond TRILLION -- caller shows digits
  return groups
    .map((g, i) => (g ? `${underThousand(g)}${SCALES[i] ? ` ${SCALES[i]}` : ''}` : null))
    .filter(Boolean)
    .reverse()
    .join(' ');
}

export function amountInWords(value) {
  const amount = Number(value) || 0;
  // Round to centavos first, so 0.995 reads as ONE PESO rather than ZERO PESOS 100 CENTAVOS.
  const totalCentavos = Math.round(Math.abs(amount) * 100);
  const pesos = Math.floor(totalCentavos / 100);
  const centavos = totalCentavos % 100;

  const pesoWords = numberToWords(pesos);
  if (pesoWords === null) return `${amount.toFixed(2)} PESOS ONLY`;

  const sign = amount < 0 ? 'MINUS ' : '';
  const pesoLabel = pesos === 1 ? 'PESO' : 'PESOS';
  if (!centavos) return `${sign}${pesoWords} ${pesoLabel} ONLY`;

  const centavoLabel = centavos === 1 ? 'CENTAVO' : 'CENTAVOS';
  return `${sign}${pesoWords} ${pesoLabel} and ${numberToWords(centavos)} ${centavoLabel} ONLY`;
}
