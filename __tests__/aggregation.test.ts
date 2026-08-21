import { MemoryStore } from '../src/db/memoryStore';
import { answerQuestion } from '../src/qa/qa';
import { computeAggregate, detectAggregateIntent, primaryAmount } from '../src/qa/aggregation';
import { Entity, SearchResult } from '../src/types';
import { makeRecord } from './helpers';

const NOW = new Date('2026-08-13T10:00:00');

function amount(value: string): Entity {
  return { type: 'amount', raw: `₹${value}`, value, confidence: 0.95 };
}

describe('detectAggregateIntent', () => {
  it('detects sum questions', () => {
    expect(detectAggregateIntent('total spent on Swiggy in July', NOW)?.kind).toBe('sum');
    expect(detectAggregateIntent('how much did I spend on Uber', NOW)?.kind).toBe('sum');
  });

  it('detects count/max/min', () => {
    expect(detectAggregateIntent('how many times did I order from Zomato', NOW)?.kind).toBe('count');
    expect(detectAggregateIntent('biggest payment this month', NOW)?.kind).toBe('max');
    expect(detectAggregateIntent('cheapest order from Blinkit', NOW)?.kind).toBe('min');
  });

  it('returns null for retrieval questions', () => {
    expect(detectAggregateIntent("what's my train PNR for Saturday", NOW)).toBeNull();
  });

  it('resolves month windows to the most recent occurrence', () => {
    const july = detectAggregateIntent('total spent in July', NOW)!.monthWindow!;
    expect(new Date(july.fromDate).getMonth()).toBe(6);
    expect(new Date(july.fromDate).getFullYear()).toBe(2026);

    const september = detectAggregateIntent('total spent in September', NOW)!.monthWindow!;
    expect(new Date(september.fromDate).getFullYear()).toBe(2025); // Sept 2026 hasn't happened yet
  });
});

describe('computeAggregate', () => {
  function asResults(records: ReturnType<typeof makeRecord>[]): SearchResult[] {
    return records.map(r => ({ screenshot: r, score: 1, matchedBy: ['keyword'], snippet: null }));
  }

  it('sums primary amounts of money-category screenshots within the window', () => {
    const july = new Date('2026-07-10').getTime();
    const records = [
      makeRecord({ ocrText: 'Swiggy ₹250', category: 'payment', entities: [amount('250')], takenAt: july }),
      makeRecord({ ocrText: 'Swiggy ₹350', category: 'payment', entities: [amount('350')], takenAt: july }),
      makeRecord({ ocrText: 'Swiggy meme', category: 'meme_other', entities: [amount('999')], takenAt: july }),
      makeRecord({
        ocrText: 'Swiggy ₹500 in Aug',
        category: 'payment',
        entities: [amount('500')],
        takenAt: new Date('2026-08-05').getTime(),
      }),
    ];
    const intent = detectAggregateIntent('total spent on swiggy in July', NOW)!;
    const answer = computeAggregate(intent, asResults(records))!;
    expect(answer.text).toContain('₹600');
    expect(answer.used).toHaveLength(2);
  });

  it('returns null when no amounts exist so the caller can fall through', () => {
    const intent = detectAggregateIntent('total spent on swiggy', NOW)!;
    const records = [makeRecord({ ocrText: 'no money here', category: 'chat' })];
    expect(computeAggregate(intent, asResults(records))).toBeNull();
  });

  it('uses the largest amount in a screenshot as the primary amount', () => {
    const rec = makeRecord({
      ocrText: 'bill',
      category: 'bill',
      entities: [amount('50'), amount('1178')],
    });
    expect(primaryAmount(rec)).toBe(1178);
  });
});

describe('answerQuestion with aggregation', () => {
  it('answers sum questions deterministically without the LLM', async () => {
    const store = new MemoryStore();
    await store.init();
    const july = new Date('2026-07-15').getTime();
    await store.upsertScreenshot(
      makeRecord({ ocrText: 'Swiggy order payment successful', category: 'payment', entities: [amount('250')], takenAt: july }),
    );
    await store.upsertScreenshot(
      makeRecord({ ocrText: 'Swiggy payment done', category: 'payment', entities: [amount('350')], takenAt: july }),
    );

    const qa = await answerQuestion(store, 'total spent on Swiggy in July', undefined, NOW);
    expect(qa.degradedToSearch).toBe(false);
    expect(qa.answer).toContain('₹600');
    expect(qa.citations).toHaveLength(2);
  });
});
