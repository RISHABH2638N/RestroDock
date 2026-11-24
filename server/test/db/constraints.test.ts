import { test,after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile,readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const db=new PGlite();
const migrationRoot=new URL('../../prisma/migrations/',import.meta.url);
for(const entry of (await readdir(migrationRoot,{withFileTypes:true})).filter(e=>e.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)))await db.exec(await readFile(new URL(`${entry.name}/migration.sql`,migrationRoot),'utf8'));
after(async()=>{await db.close();});
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function rejected(sql:string,code:string){await assert.rejects(db.query(sql),(e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&e.code===code);}
await db.exec(`
INSERT INTO "Tenant" (id,slug,name) VALUES ('${id(1)}','a','A'),('${id(2)}','b','B');
INSERT INTO "Branch" (id,"tenantId",name) VALUES ('${id(11)}','${id(1)}','A1'),('${id(12)}','${id(2)}','B1'),('${id(13)}','${id(1)}','A2');
INSERT INTO "User" (id,email) VALUES ('${id(21)}','fixture@example.test');
INSERT INTO "Membership" (id,"tenantId","userId",role) VALUES ('${id(31)}','${id(1)}','${id(21)}','CHEF');
INSERT INTO "MenuCategory" (id,"tenantId","branchId",name) VALUES ('${id(41)}','${id(1)}','${id(11)}','A menu');
INSERT INTO "MenuItem" (id,"tenantId","branchId","categoryId",name,"priceMinor") VALUES ('${id(51)}','${id(1)}','${id(11)}','${id(41)}','A item',10000);
INSERT INTO "RestaurantTable" (id,"tenantId","branchId",label,seats) VALUES ('${id(61)}','${id(1)}','${id(11)}','Table 1',4);
INSERT INTO "DiningSession" (id,"tenantId","branchId","tableId","expiresAt") VALUES ('${id(71)}','${id(1)}','${id(11)}','${id(61)}',now()+interval '1 hour');
INSERT INTO "GuestSession" (id,"tenantId","branchId","diningSessionId","tokenHash","displayName","expiresAt") VALUES ('${id(81)}','${id(1)}','${id(11)}','${id(71)}',repeat('a',64),'Fixture guest',now()+interval '1 hour');
INSERT INTO "Order" (id,"tenantId","branchId","diningSessionId","guestSessionId","idempotencyKey","requestHash","estimatedTotalMinor") VALUES ('${id(91)}','${id(1)}','${id(11)}','${id(71)}','${id(81)}','once',repeat('b',64),10000);
`);
test('migration applies and same-tenant order relation persists',async()=>{const result=await db.query('SELECT count(*)::int AS n FROM "Order"');assert.equal((result.rows[0] as {n:number}).n,1);});
test('duplicate tenant slug rejected',async()=>rejected(`INSERT INTO "Tenant" (id,slug,name) VALUES ('${id(3)}','a','other')`,'23505'));
test('membership cannot be assigned to another tenant branch',async()=>rejected(`INSERT INTO "BranchAccess" ("tenantId","branchId","membershipId") VALUES ('${id(2)}','${id(12)}','${id(31)}')`,'23503'));
test('cross-tenant menu category reference rejected',async()=>rejected(`INSERT INTO "MenuItem" (id,"tenantId","branchId","categoryId",name,"priceMinor") VALUES ('${id(52)}','${id(2)}','${id(12)}','${id(41)}','attack',100)`,'23503'));
test('same-tenant cross-branch menu category rejected',async()=>rejected(`INSERT INTO "MenuItem" (id,"tenantId","branchId","categoryId",name,"priceMinor") VALUES ('${id(53)}','${id(1)}','${id(13)}','${id(41)}','attack',100)`,'23503'));
test('negative menu price rejected',async()=>rejected(`UPDATE "MenuItem" SET "priceMinor"=-1 WHERE id='${id(51)}'`,'23514'));
test('invalid table capacity rejected',async()=>rejected(`UPDATE "RestaurantTable" SET seats=0 WHERE id='${id(61)}'`,'23514'));
test('cross-tenant QR table reference rejected',async()=>rejected(`INSERT INTO "QrCode" (id,"tenantId","branchId","tableId","secretHash") VALUES ('${id(101)}','${id(2)}','${id(12)}','${id(61)}',repeat('c',64))`,'23503'));
test('cross-tenant dining table reference rejected',async()=>rejected(`INSERT INTO "DiningSession" (id,"tenantId","branchId","tableId","expiresAt") VALUES ('${id(72)}','${id(2)}','${id(12)}','${id(61)}',now()+interval '1 hour')`,'23503'));
test('second active table session rejected',async()=>rejected(`INSERT INTO "DiningSession" (id,"tenantId","branchId","tableId","expiresAt") VALUES ('${id(73)}','${id(1)}','${id(11)}','${id(61)}',now()+interval '1 hour')`,'23505'));
test('cross-tenant guest session reference rejected',async()=>rejected(`INSERT INTO "GuestSession" (id,"tenantId","branchId","diningSessionId","tokenHash","displayName","expiresAt") VALUES ('${id(82)}','${id(2)}','${id(12)}','${id(71)}',repeat('d',64),'attack',now()+interval '1 hour')`,'23503'));
test('idempotency key cannot create a duplicate order',async()=>rejected(`INSERT INTO "Order" (id,"tenantId","branchId","diningSessionId","guestSessionId","idempotencyKey","requestHash","estimatedTotalMinor") VALUES ('${id(92)}','${id(1)}','${id(11)}','${id(71)}','${id(81)}','once',repeat('b',64),10000)`,'23505'));
test('order cannot use a guest from another dining session',async()=>{
 await db.exec(`INSERT INTO "DiningSession" (id,"tenantId","branchId","tableId",state,"expiresAt","closedAt") VALUES ('${id(74)}','${id(1)}','${id(11)}','${id(61)}','CLOSED',now()+interval '1 hour',now());`);
 await rejected(`INSERT INTO "Order" (id,"tenantId","branchId","diningSessionId","guestSessionId","idempotencyKey","requestHash","estimatedTotalMinor") VALUES ('${id(93)}','${id(1)}','${id(11)}','${id(74)}','${id(81)}','attack',repeat('e',64),10000)`,'23503');
});
test('negative order total rejected',async()=>rejected(`UPDATE "Order" SET "estimatedTotalMinor"=-1 WHERE id='${id(91)}'`,'23514'));
test('zero order quantity rejected',async()=>rejected(`INSERT INTO "OrderItem" (id,"tenantId","branchId","orderId","menuItemId","nameSnapshot","unitPriceMinor",quantity) VALUES ('${id(111)}','${id(1)}','${id(11)}','${id(91)}','${id(51)}','sample',100,0)`,'23514'));
test('cross-tenant order line reference rejected',async()=>rejected(`INSERT INTO "OrderItem" (id,"tenantId","branchId","orderId","menuItemId","nameSnapshot","unitPriceMinor",quantity) VALUES ('${id(112)}','${id(2)}','${id(12)}','${id(91)}','${id(51)}','attack',100,1)`,'23503'));
test('cross-tenant POS handoff rejected',async()=>rejected(`INSERT INTO "BillingHandoff" (id,"tenantId","branchId","diningSessionId",revision,"summarySnapshot") VALUES ('${id(121)}','${id(2)}','${id(12)}','${id(71)}',1,'{}')`,'23503'));
test('served order does not imply external settlement',async()=>{await db.exec(`UPDATE "Order" SET status='SERVED' WHERE id='${id(91)}'; INSERT INTO "BillingHandoff" (id,"tenantId","branchId","diningSessionId",revision,"summarySnapshot") VALUES ('${id(122)}','${id(1)}','${id(11)}','${id(71)}',1,'{}');`);const result=await db.query(`SELECT status FROM "BillingHandoff" WHERE id='${id(122)}'`);assert.equal((result.rows[0] as {status:string}).status,'NOT_HANDED_OFF');});
test('duplicate handoff revision rejected',async()=>rejected(`INSERT INTO "BillingHandoff" (id,"tenantId","branchId","diningSessionId",revision,"summarySnapshot") VALUES ('${id(123)}','${id(1)}','${id(11)}','${id(71)}',1,'{}')`,'23505'));
test('V1 branch cannot silently switch billing ownership',async()=>rejected(`UPDATE "Branch" SET "billingMode"='BUILT_IN' WHERE id='${id(11)}'`,'23514'));
test('closed table session releases active-session uniqueness',async()=>{await db.exec(`UPDATE "DiningSession" SET state='CLOSED',"closedAt"=now() WHERE id='${id(71)}'; INSERT INTO "DiningSession" (id,"tenantId","branchId","tableId","expiresAt") VALUES ('${id(75)}','${id(1)}','${id(11)}','${id(61)}',now()+interval '1 hour');`);});

test('canonical tenant slug check rejects uppercase/whitespace variants',async()=>rejected(`INSERT INTO "Tenant" (id,slug,name) VALUES ('${id(9)}','Invalid Slug','sample')`,'23514'));
test('QR secret hash check rejects non-hex token material',async()=>rejected(`INSERT INTO "QrCode" (id,"tenantId","branchId","tableId","secretHash") VALUES ('${id(102)}','${id(1)}','${id(11)}','${id(61)}',repeat('g',64))`,'23514'));
test('guest token hash check rejects non-hex material',async()=>rejected(`UPDATE "GuestSession" SET "tokenHash"=repeat('z',64) WHERE id='${id(81)}'`,'23514'));
test('request hash check rejects non-hex material',async()=>rejected(`UPDATE "Order" SET "requestHash"=repeat('x',64) WHERE id='${id(91)}'`,'23514'));

const applicationColumns='id,"restaurantName","branchName","ownerName",email,phone,city,address,"passwordHash","trackingHash","payloadHash","expiresAt"';
const applicationValues=(n:number,email='pending@synthetic.test')=>`'${id(n)}','Synthetic','Main','Owner','${email}','9999999999','City','Test address','scrypt$131072$8$1$${'0'.repeat(32)}$${'0'.repeat(128)}','${n.toString(16).padStart(64,'0')}','${'e'.repeat(64)}',now()+interval '7 days'`;
test('pending registration uniqueness is scoped to canonical email and completed history releases it',async()=>{await db.exec(`INSERT INTO "RegistrationRequest" (${applicationColumns}) VALUES (${applicationValues(501)})`);await rejected(`INSERT INTO "RegistrationRequest" (${applicationColumns}) VALUES (${applicationValues(502)})`,'23505');await db.exec(`UPDATE "RegistrationRequest" SET status='EXPIRED',"passwordHash"=NULL WHERE id='${id(501)}'`);await db.exec(`INSERT INTO "RegistrationRequest" (${applicationColumns}) VALUES (${applicationValues(502)})`);});
test('registration cannot claim approval without a reviewed account and branch',async()=>rejected(`UPDATE "RegistrationRequest" SET status='APPROVED',"passwordHash"=NULL WHERE id='${id(502)}'`,'23514'));
test('rejected registration requires a non-null meaningful reason and cleared password',async()=>rejected(`UPDATE "RegistrationRequest" SET status='REJECTED',"passwordHash"=NULL,"reviewedAt"=now(),"reviewedById"='${id(21)}' WHERE id='${id(502)}'`,'23514'));
test('expired registration cannot retain its proposed credential hash',async()=>rejected(`UPDATE "RegistrationRequest" SET status='EXPIRED' WHERE id='${id(502)}'`,'23514'));
test('registration tracking and password hashes are constrained',async()=>{await rejected(`UPDATE "RegistrationRequest" SET "trackingHash"='${'g'.repeat(64)}' WHERE id='${id(502)}'`,'23514');await rejected(`UPDATE "RegistrationRequest" SET "passwordHash"='plaintext' WHERE id='${id(502)}'`,'23514');});
test('registration versions and expiration bounds cannot be invalid',async()=>{await rejected(`UPDATE "RegistrationRequest" SET version=0 WHERE id='${id(502)}'`,'23514');await rejected(`UPDATE "RegistrationRequest" SET "expiresAt"="createdAt" WHERE id='${id(502)}'`,'23514');});
test('registration rejects noncanonical contact email',async()=>rejected(`INSERT INTO "RegistrationRequest" (${applicationColumns}) VALUES (${applicationValues(503,'UPPER@SYNTHETIC.TEST')})`,'23514'));
test('approved registration cannot attach a branch from another tenant',async()=>rejected(`UPDATE "RegistrationRequest" SET status='APPROVED',"passwordHash"=NULL,"reviewedAt"=now(),"reviewedById"='${id(21)}',"ownershipConfirmed"=true,"tenantId"='${id(1)}',"branchId"='${id(12)}',"applicantUserId"='${id(21)}' WHERE id='${id(502)}'`,'23503'));

test('table entry revision cannot be zero',async()=>rejected(`UPDATE "Branch" SET "tableRevision"=0 WHERE id='${id(11)}'`,'23514'));
test('table sections and row versions are constrained',async()=>{await rejected(`UPDATE "RestaurantTable" SET section=' ' WHERE id='${id(61)}'`,'23514');await rejected(`UPDATE "RestaurantTable" SET version=0 WHERE id='${id(61)}'`,'23514');});
test('a physical table cannot have two current QR secrets',async()=>{await db.exec(`INSERT INTO "QrCode" (id,"tenantId","branchId","tableId","secretHash") VALUES ('${id(501)}','${id(1)}','${id(11)}','${id(61)}',repeat('1',64))`);await rejected(`INSERT INTO "QrCode" (id,"tenantId","branchId","tableId","secretHash") VALUES ('${id(502)}','${id(1)}','${id(11)}','${id(61)}',repeat('2',64))`,'23505');await db.exec(`UPDATE "QrCode" SET "revokedAt"=now() WHERE id='${id(501)}'; INSERT INTO "QrCode" (id,"tenantId","branchId","tableId","secretHash") VALUES ('${id(503)}','${id(1)}','${id(11)}','${id(61)}',repeat('3',64))`);});
test('entry-pilot sessions require valid hashed PIN material and bounded expiry',async()=>{await rejected(`UPDATE "DiningSession" SET "entryOnly"=true WHERE id='${id(75)}'`,'23514');await rejected(`UPDATE "DiningSession" SET "pinVersion"=0 WHERE id='${id(71)}'`,'23514');});
test('legacy sessions remain explicitly non-pilot after additive migration',async()=>{const result=await db.query(`SELECT "entryOnly" FROM "DiningSession" WHERE id='${id(71)}'`);assert.equal((result.rows[0] as {entryOnly:boolean}).entryOnly,false);});
test('checkout opt-in cannot reclassify a legacy service session',async()=>{
 const result=await db.query<{checkoutPilot:boolean}>(`SELECT "checkoutPilot" FROM "DiningSession" WHERE id='${id(71)}'`);
 assert.equal(result.rows[0]?.checkoutPilot,false);
 await rejected(`UPDATE "DiningSession" SET "checkoutPilot"=true WHERE id='${id(71)}'`,'23514');
});
test('snapshot fields preserve legacy defaults and enforce their shape',async()=>{
 const row=await db.query<{portionPriceMinor:number|null;preparationNote:string;addOnSnapshots:unknown[]}>
  (`INSERT INTO "OrderItem" (id,"tenantId","branchId","orderId","menuItemId","nameSnapshot","unitPriceMinor",quantity)
     VALUES ('${id(111)}','${id(1)}','${id(11)}','${id(91)}','${id(51)}','Legacy fixture',10000,1)
     RETURNING "portionPriceMinor","preparationNote","addOnSnapshots"`);
 assert.deepEqual(row.rows[0],{portionPriceMinor:null,preparationNote:'',addOnSnapshots:[]});
 await rejected(`UPDATE "OrderItem" SET "portionPriceMinor"=10001 WHERE id='${id(111)}'`,'23514');
 await rejected(`UPDATE "OrderItem" SET "addOnSnapshots"='{}' WHERE id='${id(111)}'`,'23514');
});

test('checkout intake belongs to one valid branch and has a positive version',async()=>{
 const insert=(tenant:number,branch:number,version:number)=>`INSERT INTO "CheckoutIntake" ("tenantId","branchId",version) VALUES ('${id(tenant)}','${id(branch)}',${version})`;
 await rejected(insert(1,12,1),'23503');
 await rejected(insert(1,11,0),'23514');
 await db.exec(insert(1,11,1));
 await rejected(insert(1,11,1),'23505');
 const saved=await db.query<{paused:boolean}>(`SELECT paused FROM "CheckoutIntake" WHERE "branchId"='${id(11)}'`);
 assert.equal(saved.rows[0]?.paused,false);
});
test('legacy orders keep empty signals and review reason must have a review timestamp',async()=>{
 const saved=await db.query<{n:number;reason:string|null;reviewedAt:Date|null}>(`SELECT cardinality("riskSignals") AS n,"reviewReason" AS reason,"reviewedAt" FROM "Order" WHERE id='${id(91)}'`);
 assert.deepEqual(saved.rows[0],{n:0,reason:null,reviewedAt:null});
 await rejected(`UPDATE "Order" SET "reviewReason"='VERIFIED_AT_TABLE' WHERE id='${id(91)}'`,'23514');
 await rejected(`UPDATE "Order" SET "reviewedAt"=now() WHERE id='${id(91)}'`,'23514');
});

test('an unsettled handoff cannot have a payment method',async()=>rejected(`UPDATE "BillingHandoff" SET "paymentMethod"='CASH' WHERE id='${id(122)}'`,'23514'));

test('synthetic backup restores order and tenant boundaries in a fresh database',async()=>{
 const backup=await db.dumpDataDir('gzip');
 const restored=await PGlite.create({loadDataDir:backup});
 try{
  const orders=await restored.query('SELECT id, "tenantId" FROM "Order" WHERE id=$1',[id(91)]);
  assert.deepEqual(orders.rows,[{id:id(91),tenantId:id(1)}]);
  const tenants=await restored.query('SELECT id FROM "Tenant" WHERE id IN ($1,$2) ORDER BY id',[id(1),id(2)]);
  assert.deepEqual(tenants.rows,[{id:id(1)},{id:id(2)}]);
 }finally{await restored.close();}
});
