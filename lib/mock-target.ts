export type DeliveryOutcome = {
  attempted: number;
  accepted: number;
  retried: number;
  failed: number;
  events: Array<{ record: string; status: 'accepted' | 'retried' | 'failed'; detail: string }>;
};

/**
 * A deterministic target client for a reliable, recordable demo. The third
 * record receives one transient failure then succeeds on retry.
 */
export async function deliverToMockTarget(recordIds: string[]): Promise<DeliveryOutcome> {
  const events: DeliveryOutcome['events'] = [];
  for (const [index, record] of recordIds.entries()) {
    if (index === 2) {
      events.push({ record, status: 'retried', detail: '429 rate limit; accepted on retry' });
      continue;
    }
    events.push({ record, status: 'accepted', detail: '201 upsert accepted' });
  }
  await new Promise((resolve) => setTimeout(resolve, 450));
  return { attempted: recordIds.length, accepted: recordIds.length, retried: recordIds.length > 2 ? 1 : 0, failed: 0, events };
}
