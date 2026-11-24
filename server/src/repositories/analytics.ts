import {analyticsReportSchema} from '@restrodock/contracts';
import type {Database} from '../db.js';
import {requireRole,type TenantScope} from '../security/scope.js';

export async function readAnalytics(db:Database,scope:TenantScope,range:{start?:string|undefined;end?:string|undefined;period?:'today'|undefined}){
 requireRole(scope,['RESTAURANT_ADMIN']);
 const {tenantId,branchId}=scope;
 const [row]=await db.$queryRaw<{report:unknown}[]>`
  WITH dates AS (
   SELECT timezone AS zone,
     COALESCE(${range.start??null}::date, (CURRENT_TIMESTAMP AT TIME ZONE timezone)::date-${range.period==='today'?0:6}::int) AS start_day,
     COALESCE(${range.end??null}::date, (CURRENT_TIMESTAMP AT TIME ZONE timezone)::date) AS end_day
   FROM "Branch" WHERE "tenantId"=${tenantId}::uuid AND id=${branchId}::uuid
  ), bounds AS (
   SELECT *, start_day::timestamp AT TIME ZONE zone AS start_at,
     (end_day+1)::timestamp AT TIME ZONE zone AS end_at,
     start_day-(end_day-start_day+1) AS previous_day FROM dates
  ), cohort AS (
   SELECT o.id,o.status,o."estimatedTotalMinor",o."createdAt",
     (o."createdAt" AT TIME ZONE b.zone)::date AS day,
     extract(hour FROM o."createdAt" AT TIME ZONE b.zone)::int AS hour,
     o.status NOT IN ('AWAITING_REVIEW','REJECTED','CANCELLED') AS eligible,
     cardinality(o."riskSignals")>0 OR o.status='AWAITING_REVIEW' AS held
   FROM "Order" o CROSS JOIN bounds b
   WHERE o."tenantId"=${tenantId}::uuid AND o."branchId"=${branchId}::uuid
     AND o."createdAt">=(b.previous_day::timestamp AT TIME ZONE b.zone) AND o."createdAt"<b.end_at
  ), orders AS (
   SELECT c.* FROM cohort c CROSS JOIN bounds b WHERE c."createdAt">=b.start_at
  ), comparisons AS (
   SELECT (c."createdAt">=b.start_at) AS current_period,
     jsonb_build_object('orders',count(*),'eligible',count(*) FILTER (WHERE c.eligible),
       'estimatedMinor',coalesce(sum(c."estimatedTotalMinor") FILTER (WHERE c.eligible),0),
       'cancelled',count(*) FILTER (WHERE c.status='CANCELLED'),
       'rejected',count(*) FILTER (WHERE c.status='REJECTED')) AS metrics
   FROM cohort c CROSS JOIN bounds b GROUP BY current_period
  ), hourly AS (
   SELECT hour,count(*) AS orders FROM orders GROUP BY hour
  ), menu AS (
   SELECT m.id,m.name,c.name AS category,sum(i.quantity) AS quantity,
     sum(i."unitPriceMinor"::bigint*i.quantity) AS value,count(DISTINCT o.id) AS orders
   FROM orders o JOIN "OrderItem" i ON o.id=i."orderId"
   JOIN "MenuItem" m ON m.id=i."menuItemId" AND m."tenantId"=i."tenantId" AND m."branchId"=i."branchId"
   JOIN "MenuCategory" c ON c.id=m."categoryId" AND c."tenantId"=m."tenantId" AND c."branchId"=m."branchId"
   WHERE i."tenantId"=${tenantId}::uuid AND i."branchId"=${branchId}::uuid AND o.eligible
   GROUP BY m.id,m.name,c.name
  ), categories AS (
   SELECT category,sum(quantity) AS quantity,sum(value) AS value FROM menu GROUP BY category
  ), top_menu AS (
   SELECT * FROM menu ORDER BY quantity DESC,name,id LIMIT 50
  ), volume AS (
   SELECT day,count(*) AS orders,count(*) FILTER (WHERE held) AS held,
     count(*) FILTER (WHERE eligible) AS eligible,
     coalesce(sum("estimatedTotalMinor") FILTER (WHERE eligible),0) AS value
   FROM orders GROUP BY day
  ), demand AS (
   SELECT i."nameSnapshot" AS name,sum(i.quantity) AS quantity
   FROM "OrderItem" i JOIN orders o ON o.id=i."orderId"
   WHERE i."tenantId"=${tenantId}::uuid AND i."branchId"=${branchId}::uuid
     AND o.eligible
   GROUP BY i."nameSnapshot" ORDER BY quantity DESC,name LIMIT 10
  ), timing AS (
   SELECT o.id,
     min(a."createdAt") FILTER (WHERE a.action='KITCHEN_ACCEPTED') AS accepted,
     min(a."createdAt") FILTER (WHERE a.action='KITCHEN_PREPARING') AS preparing,
     min(a."createdAt") FILTER (WHERE a.action='KITCHEN_READY') AS ready
   FROM "AuditEvent" a JOIN orders o ON a."resourceReference"=o.id::text
   WHERE a."tenantId"=${tenantId}::uuid AND a."branchId"=${branchId}::uuid
     AND a.action IN ('KITCHEN_ACCEPTED','KITCHEN_PREPARING','KITCHEN_READY') AND a."createdAt">=o."createdAt"
   GROUP BY o.id
  ), kitchen AS (
   SELECT count(*) AS sample,round(avg(extract(epoch FROM ready-accepted))) AS seconds
   FROM timing WHERE ready>=accepted
  ), prep AS (
   SELECT count(*) AS sample,
     round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ready-preparing))) AS median,
     round(percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM ready-preparing))) AS p90
   FROM timing WHERE ready>=preparing
  ), zero AS (
   SELECT '{"orders":0,"eligible":0,"estimatedMinor":0,"cancelled":0,"rejected":0}'::jsonb AS metrics
  )
  SELECT jsonb_build_object(
   'timezone',b.zone,'start',to_char(b.start_day,'YYYY-MM-DD'),'end',to_char(b.end_day,'YYYY-MM-DD'),
   'days',(SELECT jsonb_agg(jsonb_build_object(
    'date',to_char(b.start_day+n,'YYYY-MM-DD'),'orders',coalesce(v.orders,0),'held',coalesce(v.held,0)
   ) ORDER BY n) FROM generate_series(0,b.end_day-b.start_day) AS days(n)
   LEFT JOIN volume v ON v.day=b.start_day+n),
   'demand',coalesce((SELECT jsonb_agg(jsonb_build_object('name',name,'quantity',quantity) ORDER BY quantity DESC,name) FROM demand),'[]'::jsonb),
   'drilldown',jsonb_build_object(
    'previousStart',to_char(b.previous_day,'YYYY-MM-DD'),'previousEnd',to_char(b.start_day-1,'YYYY-MM-DD'),
    'current',coalesce((SELECT metrics FROM comparisons WHERE current_period),z.metrics),
    'previous',coalesce((SELECT metrics FROM comparisons WHERE NOT current_period),z.metrics),
    'dailyValue',(SELECT jsonb_agg(jsonb_build_object('date',to_char(b.start_day+n,'YYYY-MM-DD'),
      'eligible',coalesce(v.eligible,0),'estimatedMinor',coalesce(v.value,0)) ORDER BY n)
      FROM generate_series(0,b.end_day-b.start_day) AS days(n) LEFT JOIN volume v ON v.day=b.start_day+n),
    'hours',(SELECT jsonb_agg(jsonb_build_object('hour',h.n,'orders',coalesce(v.orders,0)) ORDER BY h.n)
      FROM generate_series(0,23) AS h(n) LEFT JOIN hourly v ON v.hour=h.n),
    'menu',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'category',category,
      'quantity',quantity,'estimatedMinor',value,'orders',orders) ORDER BY quantity DESC,name,id) FROM top_menu),'[]'::jsonb),
    'categories',coalesce((SELECT jsonb_agg(jsonb_build_object('name',category,'quantity',quantity,
      'estimatedMinor',value) ORDER BY quantity DESC,category) FROM categories),'[]'::jsonb),
    'preparation',jsonb_build_object('sample',p.sample,'medianSeconds',p.median,'p90Seconds',p.p90)
   ),
   'totals',jsonb_build_object(
    'orders',(SELECT count(*) FROM orders),
    'held',(SELECT count(*) FROM orders WHERE held),
    'pendingReview',(SELECT count(*) FROM orders WHERE status='AWAITING_REVIEW'),
    'estimatedMinor',(SELECT coalesce(sum("estimatedTotalMinor"),0) FROM orders WHERE eligible),
    'billRequests',(SELECT count(*) FROM "AuditEvent" a
     WHERE a."tenantId"=${tenantId}::uuid AND a."branchId"=${branchId}::uuid
       AND a.action='BILL_REQUESTED' AND a."createdAt">=b.start_at AND a."createdAt"<b.end_at),
    'confirmedSettlements',(SELECT count(DISTINCT h."diningSessionId") FROM "BillingHandoff" h
     WHERE h."tenantId"=${tenantId}::uuid AND h."branchId"=${branchId}::uuid
       AND h.status='EXTERNALLY_SETTLED' AND h."staffConfirmedAt">=b.start_at AND h."staffConfirmedAt"<b.end_at),
    'confirmedMinor',NULL,'kitchenSample',k.sample,'kitchenAverageSeconds',k.seconds
   )
  ) AS report FROM bounds b CROSS JOIN kitchen k CROSS JOIN prep p CROSS JOIN zero z
 `;
 return analyticsReportSchema.parse(row?.report);
}
