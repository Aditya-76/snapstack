import { classify, inferSourceApp } from '../src/pipeline/classifier';

describe('classify', () => {
  it('classifies UPI payment confirmations', () => {
    const r = classify('Payment Successful ₹450 paid to Ravi Kirana via UPI. UTR: 221812345678. PhonePe');
    expect(r.category).toBe('payment');
    expect(r.confidence).toBeGreaterThan(0.6);
  });

  it('classifies electricity bills', () => {
    const r = classify('BESCOM Electricity Bill. Bill Amount ₹1,178. Due Date 20/08/2026. Units consumed: 210');
    expect(r.category).toBe('bill');
  });

  it('classifies train tickets', () => {
    const r = classify('IRCTC E-Ticket PNR: 4521067893 Train 12628 Coach B3 Departure 06:10 Platform 4');
    expect(r.category).toBe('booking');
  });

  it('classifies Aadhaar as id_document', () => {
    const r = classify('Government of India आधार 1234 5678 9012 DOB: 01/01/1990 UIDAI');
    expect(r.category).toBe('id_document');
  });

  it('classifies coupons', () => {
    const r = classify('Flat 60% OFF! Use code SWIGGY60. Valid till 31 Aug. Min order ₹199');
    expect(r.category).toBe('code_coupon');
  });

  it('classifies job posts', () => {
    const r = classify('We are hiring! React Native developer. 3+ years experience. CTC 18 LPA. Apply now on LinkedIn');
    expect(r.category).toBe('job_listing');
  });

  it('falls back to meme_other for low-text screenshots', () => {
    const r = classify('lol');
    expect(r.category).toBe('meme_other');
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('flags ambiguous longer text for LLM fallback', () => {
    const r = classify(
      'This is a long paragraph of ordinary text that talks about nothing in particular but goes on long enough',
    );
    expect(r.category).toBe('meme_other');
    expect(r.ambiguous).toBe(true);
  });
});

describe('inferSourceApp', () => {
  it('detects the app from content', () => {
    expect(inferSourceApp('PhonePe payment successful')).toBe('PhonePe');
    expect(inferSourceApp('Order #123 from swiggy is on the way')).toBe('Swiggy');
    expect(inferSourceApp('plain text')).toBeNull();
  });
});
