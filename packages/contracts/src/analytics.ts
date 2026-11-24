import {z} from 'zod';

const count=z.number().int().nonnegative();
const orderMetrics=z.object({orders:count,eligible:count,estimatedMinor:count,cancelled:count,rejected:count});
export const analyticsReportSchema=z.object({
 timezone:z.string(),
 start:z.iso.date(),
 end:z.iso.date(),
 days:z.array(z.object({date:z.iso.date(),orders:count,held:count})),
 demand:z.array(z.object({name:z.string(),quantity:count})),
 drilldown:z.object({
  previousStart:z.iso.date(),
  previousEnd:z.iso.date(),
  current:orderMetrics,
  previous:orderMetrics,
  dailyValue:z.array(z.object({date:z.iso.date(),eligible:count,estimatedMinor:count})),
  hours:z.array(z.object({hour:count.max(23),orders:count})).length(24),
  menu:z.array(z.object({id:z.uuid(),name:z.string(),category:z.string(),quantity:count,estimatedMinor:count,orders:count})),
  categories:z.array(z.object({name:z.string(),quantity:count,estimatedMinor:count})),
  preparation:z.object({sample:count,medianSeconds:count.nullable(),p90Seconds:count.nullable()}),
 }),
 totals:z.object({
  orders:count,held:count,pendingReview:count,estimatedMinor:count,
  billRequests:count,confirmedSettlements:count,confirmedMinor:z.null(),
  kitchenSample:count,kitchenAverageSeconds:count.nullable(),
 }),
});
export type AnalyticsReport=z.infer<typeof analyticsReportSchema>;
