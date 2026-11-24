import type {z} from 'zod';
import type {Prisma} from '@prisma/client';
import type {Database} from '../db.js';
import {platformAnalyticsPageSize,type platformDirectoryQuerySchema} from '@restrodock/contracts';

const day=86_400_000;
export function platformWindow(days:number,now=new Date()){
 const today=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());
 return {now,from:new Date(today-(days-1)*day),until:new Date(today+day),renewalEnd:new Date(now.getTime()+30*day)};
}
type Window=ReturnType<typeof platformWindow>;
const qrTable={archived:false,qrCodes:{some:{revokedAt:null}}} satisfies Prisma.RestaurantTableWhereInput;
const publicQrBranch={active:true,tableEntryPublished:true,tables:{some:qrTable}} satisfies Prisma.BranchWhereInput;
const orderRange=(range:Window)=>({gte:range.from,lt:range.until});
const pending=(range:Window)=>({status:'PENDING',expiresAt:{gt:range.now}} as const);
const attentionWhere=(range:Window)=>({
 setup:{status:'DRAFT'},
 qr:{status:{in:['ACTIVE','TRIAL']},branches:{some:{active:true,OR:[{tableEntryPublished:false},{tables:{none:qrTable}}]}}},
 renewal:{status:{not:'SUSPENDED'},subscription:{is:{status:{in:['ACTIVE','TRIAL']},endsAt:{gte:range.now,lte:range.renewalEnd}}}},
 idle:{status:{in:['ACTIVE','TRIAL']},branches:{some:publicQrBranch}},
} satisfies Record<string,Prisma.TenantWhereInput>);

function idleRestaurants(range:Window):Prisma.TenantWhereInput{
 const orderedTable={sessions:{some:{orders:{some:{createdAt:orderRange(range)}}}}} satisfies Prisma.RestaurantTableWhereInput;
 const orderedBranch={tables:{some:orderedTable}} satisfies Prisma.BranchWhereInput;
 return {...attentionWhere(range).idle,AND:[{branches:{none:orderedBranch}}]};
}

export async function platformOverview(db:Database,range:Window){
 const activityWhere={createdAt:orderRange(range)};
 const attention=attentionWhere(range);
 const [statuses,branches,tables,qrTables,plans,unassigned,received,approved,rejected,pendingCount,setup,qr,renewal,activity,activeTenants,idle]=await Promise.all([
  db.tenant.groupBy({by:['status'],_count:{_all:true}}),
  db.branch.count(),
  db.restaurantTable.count({where:{archived:false}}),
  db.restaurantTable.count({where:qrTable}),
  db.subscription.groupBy({by:['planCode','status'],_count:{_all:true},orderBy:[{planCode:'asc'},{status:'asc'}]}),
  db.tenant.count({where:{subscription:{is:null}}}),
  db.registrationRequest.count({where:activityWhere}),
  db.registrationRequest.count({where:{status:'APPROVED',reviewedAt:orderRange(range)}}),
  db.registrationRequest.count({where:{status:'REJECTED',reviewedAt:orderRange(range)}}),
  db.registrationRequest.count({where:pending(range)}),
  db.tenant.count({where:attention.setup}),db.tenant.count({where:attention.qr}),db.tenant.count({where:attention.renewal}),
  db.$queryRaw<{date:string;orders:number}[]>`
    SELECT to_char("createdAt" AT TIME ZONE 'UTC','YYYY-MM-DD') AS date, count(*)::int AS orders
    FROM "Order" WHERE "createdAt" >= ${range.from} AND "createdAt" < ${range.until}
    GROUP BY 1 ORDER BY 1
  `,
  db.order.groupBy({by:['tenantId'],where:activityWhere}),
  db.tenant.count({where:idleRestaurants(range)}),
 ]);
 const restaurants={DRAFT:0,TRIAL:0,ACTIVE:0,SUSPENDED:0};
 for(const row of statuses)restaurants[row.status]=row._count._all;
 const planRows:{plan:string|null;status:(typeof plans)[number]['status']|null;count:number}[]=plans.map(row=>({plan:row.planCode,status:row.status,count:row._count._all}));
 planRows.push({plan:null,status:null,count:unassigned});
 const counts=new Map(activity.map(row=>[row.date,row.orders]));
 const days=[];
 for(let t=range.from.getTime();t<range.until.getTime();t+=day){
  const date=new Date(t).toISOString().slice(0,10);
  days.push({date,orders:counts.get(date)??0});
 }
 return {from:days[0]!.date,to:days.at(-1)!.date,restaurants,branches,tables,qrTables,plans:planRows,
  applications:{received,approved,rejected,pending:pendingCount},attention:{setup,qr,renewal,idle},
  activity:{restaurants:activeTenants.length,total:days.reduce((sum,row)=>sum+row.orders,0),days}};
}

export async function platformDirectory(db:Database,range:Window,query:z.infer<typeof platformDirectoryQuerySchema>){
 const where:Prisma.TenantWhereInput={AND:[
  ...(query.q?[{OR:[{name:{contains:query.q,mode:'insensitive' as const}},{slug:{contains:query.q,mode:'insensitive' as const}}]}]:[]),
  ...(query.status?[{status:query.status}]:[]),
  ...(query.plan?[{subscription:query.plan==='~unassigned'?{is:null}:{is:{planCode:query.plan}}}]:[]),
  ...(query.attention?[query.attention==='idle'?idleRestaurants(range):attentionWhere(range)[query.attention]]:[]),
 ]};
 const [total,tenants]=await Promise.all([db.tenant.count({where}),db.tenant.findMany({where,skip:(query.page-1)*platformAnalyticsPageSize,take:platformAnalyticsPageSize,orderBy:[{name:'asc'},{id:'asc'}],select:{
  id:true,name:true,slug:true,status:true,subscription:{select:{planCode:true,status:true,endsAt:true}},_count:{select:{branches:true}},
 }})]);
 const tenantId={in:tenants.map(tenant=>tenant.id)};
 const [tables,qr,orders]=await Promise.all([
  db.restaurantTable.groupBy({by:['tenantId'],where:{tenantId,archived:false},_count:{_all:true}}),
  db.restaurantTable.groupBy({by:['tenantId'],where:{tenantId,...qrTable},_count:{_all:true}}),
  db.order.groupBy({by:['tenantId'],where:{tenantId,createdAt:orderRange(range)},_count:{_all:true}}),
 ]);
 const byTenant=(rows:typeof tables)=>new Map(rows.map(row=>[row.tenantId,row._count._all]));
 const tableCounts=byTenant(tables),qrCounts=byTenant(qr),orderCounts=byTenant(orders);
 return {total,items:tenants.map(({subscription,_count,...tenant})=>({...tenant,plan:subscription?.planCode??null,subscriptionStatus:subscription?.status??null,endsAt:subscription?.endsAt?.toISOString()??null,
  branches:_count.branches,tables:tableCounts.get(tenant.id)??0,qrTables:qrCounts.get(tenant.id)??0,orders:orderCounts.get(tenant.id)??0}))};
}

export async function platformBranches(db:Database,range:Window,tenantId:string){
 const [branches,qr,orders]=await Promise.all([
  db.branch.findMany({where:{tenantId},orderBy:[{name:'asc'},{id:'asc'}],select:{id:true,name:true,active:true,tableEntryPublished:true,_count:{select:{tables:{where:{archived:false}}}}}}),
  db.restaurantTable.groupBy({by:['branchId'],where:{tenantId,...qrTable},_count:{_all:true}}),
  db.order.groupBy({by:['branchId'],where:{tenantId,createdAt:orderRange(range)},_count:{_all:true}}),
 ]);
 const qrCounts=new Map(qr.map(row=>[row.branchId,row._count._all]));
 const orderCounts=new Map(orders.map(row=>[row.branchId,row._count._all]));
 return {items:branches.map(branch=>({id:branch.id,name:branch.name,active:branch.active,published:branch.tableEntryPublished,tables:branch._count.tables,qrTables:qrCounts.get(branch.id)??0,orders:orderCounts.get(branch.id)??0}))};
}
