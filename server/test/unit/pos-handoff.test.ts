import assert from 'node:assert/strict';
import test from 'node:test';
import {createPosExport, type PosAdapter} from '../../src/modules/pos/handoff.js';

const scope = {tenantId: 'tenant-a', branchId: 'branch-a', diningSessionId: 'session-a', revision: 1};
const orders = [{
  id: 'order-a', status: 'SERVED', estimatedTotalMinor: 9999,
  items: [{nameSnapshot: 'Dal', quantity: 1, portionNameSnapshot: null, addOnSnapshots: [], unitPriceMinor: 9999}],
  guestPhone: 'private',
}];

test('POS export keeps amounts in paise and excludes unrelated guest fields', () => {
  const packet = createPosExport(scope, orders);
  assert.equal(packet.schemaVersion, 1);
  assert.equal(packet.currency, 'INR');
  assert.equal(packet.orders[0]?.estimatedTotalMinor, 9999);
  assert.equal(Object.hasOwn(packet.orders[0]!, 'guestPhone'), false);
  assert.notEqual(packet.idempotencyKey, createPosExport({...scope, revision: 2}, orders).idempotencyKey);
  assert.notEqual(packet.idempotencyKey, createPosExport({...scope, tenantId: 'tenant-b'}, orders).idempotencyKey);
});

test('stub accepts one handoff per key and rejects a conflicting replay', async () => {
  const receipts = new Map<string, string>();
  const adapter: PosAdapter = {
    async deliver(packet) {
      const body = JSON.stringify(packet);
      const previous = receipts.get(packet.idempotencyKey);
      if (previous && previous !== body) return {status: 'rejected'};
      receipts.set(packet.idempotencyKey, body);
      return {status: 'accepted', externalReference: 'receipt-1'};
    },
  };
  const packet = createPosExport(scope, orders);
  const receipt = await adapter.deliver(packet);
  assert.deepEqual(await adapter.deliver(createPosExport(scope, orders)), receipt);
  assert.deepEqual(await adapter.deliver({...packet, orders: []}), {status: 'rejected'});
  assert.equal(receipts.size, 1);
});
