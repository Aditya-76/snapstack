import { extractEntities, findDates } from '../src/pipeline/entityExtraction';
import { Entity } from '../src/types';

const NOW = new Date('2026-08-13T10:00:00+05:30');

function byType(entities: Entity[], type: Entity['type']): Entity[] {
  return entities.filter(e => e.type === type);
}

describe('extractEntities', () => {
  it('extracts rupee amounts in common formats', () => {
    const entities = extractEntities('Paid ₹1,178.50 to Airtel. Rs. 249 recharge. Total 3500/-', NOW);
    const amounts = byType(entities, 'amount').map(e => e.value);
    expect(amounts).toContain('1178.5');
    expect(amounts).toContain('249');
    expect(amounts).toContain('3500');
  });

  it('separates due dates from plain dates using context', () => {
    const entities = extractEntities('Bill date 01/08/2026. Amount due by 20/08/2026.', NOW);
    expect(byType(entities, 'due_date').map(e => e.value)).toEqual(['2026-08-20']);
    expect(byType(entities, 'date').map(e => e.value)).toContain('2026-08-01');
  });

  it('parses textual dates day-first and month-first', () => {
    const entities = extractEntities('Journey on 20 Aug 2026. Booked Aug 5, 2026.', NOW);
    const dates = byType(entities, 'date').map(e => e.value);
    expect(dates).toContain('2026-08-20');
    expect(dates).toContain('2026-08-05');
  });

  it('resolves yearless dates to the reference year', () => {
    const entities = extractEntities('due 20 Aug', NOW);
    expect(byType(entities, 'due_date')[0].value).toBe('2026-08-20');
  });

  it('rejects impossible calendar dates', () => {
    expect(findDates('31/02/2026 45/13/2026', 2026)).toHaveLength(0);
  });

  it('extracts UPI VPAs and transaction refs', () => {
    const entities = extractEntities(
      'Paid to merchant.name@ybl UPI Ref No: 221812345678 Transaction ID: T2508131142',
      NOW,
    );
    expect(byType(entities, 'upi_id')[0].value).toBe('merchant.name@ybl');
    const txns = byType(entities, 'transaction_id').map(e => e.value);
    expect(txns).toContain('221812345678');
  });

  it('extracts 10-digit train PNRs', () => {
    const entities = extractEntities('PNR: 4521067893 Coach B3 Seat 42', NOW);
    expect(byType(entities, 'booking_id')[0].value).toBe('4521067893');
  });

  it('extracts 6-char flight booking references', () => {
    const entities = extractEntities('Booking ID: X9KJ2P IndiGo 6E-204', NOW);
    expect(byType(entities, 'booking_id')[0].value).toBe('X9KJ2P');
  });

  it('extracts Indian mobile numbers with normalization', () => {
    const entities = extractEntities('Call +91 98765 43210 or 9123456789', NOW);
    const phones = byType(entities, 'phone').map(e => e.value);
    expect(phones).toContain('+919876543210');
    expect(phones).toContain('+919123456789');
  });

  it('extracts coupon codes with expiry and skips UI stopwords', () => {
    const entities = extractEntities('Use code SWIGGY60 valid till 31 Aug 2026. Use this offer now!', NOW);
    expect(byType(entities, 'coupon_code').map(e => e.value)).toEqual(['SWIGGY60']);
    expect(byType(entities, 'coupon_expiry')[0].value).toBe('2026-08-31');
  });

  it('does not double-report UPI VPAs as emails', () => {
    const entities = extractEntities('someone@ybl and real.email@gmail.com', NOW);
    expect(byType(entities, 'email').map(e => e.value)).toEqual(['real.email@gmail.com']);
  });

  it('recognizes known merchants', () => {
    const entities = extractEntities('Swiggy order delivered', NOW);
    expect(byType(entities, 'merchant')[0].value).toBe('swiggy');
  });

  it('dedupes repeated matches', () => {
    const entities = extractEntities('₹500 and again ₹500', NOW);
    expect(byType(entities, 'amount')).toHaveLength(1);
  });
});
