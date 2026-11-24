import type {Prisma, Subscription} from '@prisma/client';
import {planEntitlements} from '@restrodock/contracts';
import {HttpError} from '../auth/session.js';

type SubscriptionAccess=Pick<Subscription,'planCode'|'status'|'endsAt'>;

export function canOpenTables(subscription:SubscriptionAccess|null,now=new Date()){
 return !subscription||(subscription.status!=='EXPIRED'&&subscription.status!=='SUSPENDED'&&
  (!subscription.endsAt||subscription.endsAt>now));
}

export async function readPlanAccess(db:Prisma.TransactionClient,tenantId:string){
 const [subscription,activeOutlets]=await Promise.all([
  db.subscription.findUnique({where:{tenantId}}),
  db.branch.count({where:{tenantId,active:true}}),
 ]);
 return {
  planCode:subscription?.planCode??'Unassigned',
  ...planEntitlements(subscription?.planCode),
  activeOutlets,
  canOpenTables:canOpenTables(subscription),
  endsAt:subscription?.endsAt?.toISOString()??null,
 };
}

export function requireAdvancedControls(planCode:string|null|undefined){
 if(!planEntitlements(planCode).advancedControls)
  throw new HttpError(403,'PLAN_FEATURE_REQUIRED','Upgrade to Growth or Pro for this feature.');
}
