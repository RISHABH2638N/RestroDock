import type {OrderRiskSignal} from '@prisma/client';
import type {Owned,Tx} from './repository.js';

// This row serializes intake across tables without a Branch write lock.
// Checkout locks Branch for shared reads, then table, then intake. Pause only locks intake.
export async function lockIntake(tx:Tx,owned:Owned){
 const {tenantId,branchId}=owned;
 await tx.$executeRaw`
  INSERT INTO "CheckoutIntake" ("tenantId","branchId") VALUES (${tenantId}::uuid,${branchId}::uuid)
  ON CONFLICT ("tenantId","branchId") DO NOTHING
 `;
 const [intake]=await tx.$queryRaw<{paused:boolean;version:number}[]>`
  SELECT paused,version FROM "CheckoutIntake"
  WHERE "tenantId"=${tenantId}::uuid AND "branchId"=${branchId}::uuid FOR UPDATE
 `;
 if(!intake)throw new Error('Checkout intake row was not locked.');
 return intake;
}

export const branchBurstLimit=20;
export const tableBurstLimit=4;
export const intakeWindowMs=60_000;

export function checkoutRisk({quantity,value,quantityLimit,valueLimit,tableCount,branchCount,repeated}:{
 quantity:number;value:number;quantityLimit:number|null;valueLimit:number|null;tableCount:number;branchCount:number;repeated:boolean;
}){
 const signals:OrderRiskSignal[]=[];
 if(quantityLimit!==null&&quantity>quantityLimit)signals.push('LARGE_QUANTITY');
 if(valueLimit!==null&&value>valueLimit)signals.push('HIGH_VALUE');
 if(tableCount>=2)signals.push('TABLE_BURST');
 if(branchCount>=8)signals.push('BRANCH_BURST');
 if(repeated)signals.push('REPEATED_CART');
 return signals;
}
