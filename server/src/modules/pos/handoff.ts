import type {Prisma} from '@prisma/client';

type HandoffScope = {
  tenantId: string;
  branchId: string;
  diningSessionId: string;
  revision: number;
};

type HandoffOrder = {
  id: string;
  status: string;
  estimatedTotalMinor: number;
  items: {
    nameSnapshot: string;
    quantity: number;
    portionNameSnapshot: string | null;
    addOnSnapshots: Prisma.JsonValue;
    unitPriceMinor: number;
  }[];
};

export function createPosExport(scope: HandoffScope, orders: HandoffOrder[]) {
  const {tenantId, branchId, diningSessionId, revision} = scope;
  return {
    schemaVersion: 1 as const,
    idempotencyKey: `restrodock:${tenantId}:${branchId}:${diningSessionId}:${revision}`,
    tenantId,
    branchId,
    diningSessionId,
    revision,
    currency: 'INR' as const,
    orders: orders.map(({id, status, estimatedTotalMinor, items}) => ({
      id, status, estimatedTotalMinor,
      items: items.map(({nameSnapshot, quantity, portionNameSnapshot, addOnSnapshots, unitPriceMinor}) => ({
        nameSnapshot, quantity, portionNameSnapshot, addOnSnapshots, unitPriceMinor,
      })),
    })),
  };
}

export type PosExport = ReturnType<typeof createPosExport>;

export type PosDeliveryResult =
  | {status: 'accepted'; externalReference: string}
  | {status: 'retryable'}
  | {status: 'rejected'}
  | {status: 'unknown'};

export interface PosAdapter {
  /**
   * The same key and payload must return the original receipt after acceptance.
   * A key reused with different content must be rejected.
   * Retry only retryable outcomes. Reconcile unknown outcomes before retrying.
   */
  deliver(packet: PosExport): Promise<PosDeliveryResult>;
}
