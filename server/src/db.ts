import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
export function createDatabase(url:string,options:{connectionTimeoutMillis?:number}={}) {
  if (!url) return null;
  // Keep certificate verification enabled. Use sslmode=verify-full in Neon URLs.
  return new PrismaClient({ adapter:new PrismaPg({ connectionString:url, max:5, connectionTimeoutMillis:options.connectionTimeoutMillis??3000, idleTimeoutMillis:10000 }) });
}
export type Database = NonNullable<ReturnType<typeof createDatabase>>;
