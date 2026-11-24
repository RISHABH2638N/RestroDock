import {platformDirectoryQuerySchema,platformPeriodSchema} from '@restrodock/contracts';
import {platformOverview,platformDirectory,platformBranches,platformWindow} from '../../repositories/platform-analytics.js';
import {requestPasswordReset,resetPassword} from './recovery.js';
import {requireAdvancedControls} from '../platform/plan-access.js';
import {subscriptionStatuses} from '@restrodock/contracts';
import {readAnalytics} from '../../repositories/analytics.js';
import {allowsClientOrigin} from '../../config.js';
import {kitchenRouter} from '../tables/kitchen.js';
import {orderReviewRouter} from '../tables/review.js';
import {tableRouter,publicEntryRouter} from '../tables/router.js';
import {Router,type Request,type Response,type NextFunction} from 'express';
import {rateLimit} from 'express-rate-limit';
import {z} from 'zod';
import type {Database} from '../../db.js';
import type {Config} from '../../config.js';
import {authenticate,HttpError,platformOnly,setSessionCookie,sessionLifetimeMs,cookieName,readSessionToken,type Identity} from './session.js';
import {csrfFor,equalToken,randomToken,tokenHash,verifyPassword} from './crypto.js';
import {acceptInvitation,validInvitation,issueInvitation} from './invitations.js';
import {planCodes,tenantDetail,createTenant,changeTenant} from '../platform/service.js';
import {scopeForVerifiedUser} from '../../security/membership.js';
import {createManagementRouter} from '../restaurant/router.js';
import {menuRepository} from '../../repositories/menu.js';
import {billingModeSchema,registrationInput,registrationStatusInput,registrationStatuses,registrationDecisionInput} from '@restrodock/contracts';
import {submitRegistration,publicRegistrationStatus,listRegistrations,registrationDetail,decideRegistration} from '../registration/service.js';
const email=z.email().max(254).transform(s=>s.toLowerCase());
const password=z.string().min(15).max(128);
const token=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const uuid=z.uuid();
const selection=z.object({tenantId:uuid,branchId:uuid}).strict();
function writeOrigin(req:Request,config:Config) {
 const binary=req.method==='PUT'&&/^\/api\/v1\/restaurant\/manage\/(logo|items\/[a-f0-9-]{36}\/photo)$/.test(req.originalUrl.split('?')[0]??'');
 if(!allowsClientOrigin(config,req.headers.origin)||(!req.is('application/json')&&!binary))throw new HttpError(403,'CSRF_DENIED','Use the configured RestroDock page to submit this action.');
}
import type {NotifyBranchOrders} from '../../realtime.js';
export function createAccessRouter(config:Config,database:Database|null,notify?:NotifyBranchOrders) {
 const router=Router();
 const passwordResetRequestLimit=rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:'draft-8',legacyHeaders:false,message:{error:{code:'RESET_RATE_LIMITED',message:'Too many reset requests from this network. Wait before trying again.'}}});
 const passwordResetCompleteLimit=rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:'draft-8',legacyHeaders:false,message:{error:{code:'RESET_RATE_LIMITED',message:'Too many reset attempts from this network. Wait before trying again.'}}});
 const publicEntryRouterInstance=publicEntryRouter(database,config,notify);
 const db=()=>{if(!database)throw new HttpError(503,'DATABASE_UNAVAILABLE','Configure the server database and restart before signing in.');return database;};
 const identity=(res:Response)=>res.locals.identity as Identity;
 const auth=async(req:Request,res:Response,next:NextFunction)=>{
  if(!readSessionToken(req,config))throw new HttpError(401,'AUTH_REQUIRED','Sign in to continue.');
  res.locals.identity=await authenticate(db(),req,config);
  if(!['GET','HEAD','OPTIONS'].includes(req.method)){
   writeOrigin(req,config);
   if(!equalToken(req.get('x-csrf-token')??'',identity(res).csrfToken))throw new HttpError(403,'CSRF_DENIED','Your security token is missing or expired. Refresh the page.');
  }
  next();
 };
 router.use('/auth',rateLimit({windowMs:15*60*1000,limit:60,standardHeaders:'draft-8',legacyHeaders:false,message:{error:{code:'AUTH_RATE_LIMITED',message:'Too many authentication requests. Try again later.'}}}));
 const registrationNetworkLimit=rateLimit({
  windowMs:15*60*1000,limit:40,standardHeaders:'draft-8',legacyHeaders:false,
  message:{error:{code:'REGISTRATION_RATE_LIMITED',message:'Too many registration attempts from this network. Try again shortly.'}},
 });
 const registrationSubmission=registrationInput.extend({companyWebsite:z.string().max(512).optional()});
 router.post('/registrations',registrationNetworkLimit,rateLimit({windowMs:60*60*1000,limit:10,keyGenerator:req=>{const value=email.safeParse(req.body?.email);return tokenHash(value.success?`registration:${value.data}`:'registration:invalid');},standardHeaders:'draft-8',legacyHeaders:false,message:{error:{code:'REGISTRATION_RATE_LIMITED',message:'Too many registration attempts. Wait before trying again.'}}}),async(req,res)=>{writeOrigin(req,config);
  const {companyWebsite,...application}=registrationSubmission.parse(req.body);
  if(companyWebsite)throw new HttpError(400,'REGISTRATION_INVALID','Please resubmit the registration form.');
  res.status(201).json(await submitRegistration(db(),application));});
 router.post('/registrations/status',rateLimit({windowMs:15*60*1000,limit:60,keyGenerator:req=>{const value=registrationStatusInput.safeParse(req.body);return tokenHash(value.success?`tracking:${value.data.trackingSecret}`:'tracking:invalid');},standardHeaders:'draft-8',legacyHeaders:false,message:{error:{code:'TRACKING_RATE_LIMITED',message:'Too many status checks. Wait before trying again.'}}}),async(req,res)=>{writeOrigin(req,config);res.json(await publicRegistrationStatus(db(),registrationStatusInput.parse(req.body).trackingSecret));});
 router.post('/auth/password-reset/request',passwordResetRequestLimit,async(req,res)=>{
  writeOrigin(req,config);
  const input=z.object({email}).strict().parse(req.body);
  if(!config.BREVO_API_KEY)throw new HttpError(503,'RECOVERY_UNAVAILABLE','Email recovery is unavailable. Contact your administrator.');
  await requestPasswordReset(db(),config,input.email);
  res.status(202).json({accepted:true});
 });
 router.post('/auth/password-reset/complete',passwordResetCompleteLimit,async(req,res)=>{
  writeOrigin(req,config);
  const input=z.object({token,password}).strict().parse(req.body);
  await resetPassword(db(),input.token,input.password);
  res.clearCookie(cookieName(config),{path:'/',httpOnly:true,sameSite:'strict',secure:config.NODE_ENV==='production'});
  res.json({updated:true});
 });
 router.post('/auth/login',async(req,res)=>{
  writeOrigin(req,config);
  const input=z.object({email,password:z.string().min(1).max(128),portal:z.enum(['platform','restaurant','staff']),rememberDevice:z.boolean().optional()}).strict().parse(req.body);
  const key=tokenHash(`login:${input.email}`),now=new Date();
  const previous=await db().authThrottle.findUnique({where:{key}});
  if(previous&&previous.windowStart.getTime()>now.getTime()-15*60*1000&&previous.failures>=6)throw new HttpError(429,'LOGIN_LOCKED','Too many failed sign-in attempts. Wait 15 minutes before trying again.');
  if(previous&&previous.windowStart.getTime()<=now.getTime()-15*60*1000)await db().authThrottle.deleteMany({where:{key,windowStart:{lte:new Date(now.getTime()-15*60*1000)}}});
  const user=await db().user.findUnique({where:{email:input.email},});
  const verified=await verifyPassword(input.password,user?.passwordHash??null);
  if(!verified||!user?.active){
   await db().authThrottle.upsert({where:{key},create:{key,failures:1,windowStart:now},update:{failures:{increment:1}}});
   throw new HttpError(401,'INVALID_CREDENTIALS','Email or password is incorrect.');
  }
  await db().authThrottle.deleteMany({where:{key}});
  let rememberDevice=false;
  const value=randomToken();
  const old=readSessionToken(req,config);
  await db().$transaction(async tx=>{
   const [current]=await tx.$queryRaw<{passwordHash:string|null;active:boolean}[]>`SELECT "passwordHash", active FROM "User" WHERE id=${user.id}::uuid FOR UPDATE`;
   if(!current?.active||current.passwordHash!==user.passwordHash)throw new HttpError(401,'INVALID_CREDENTIALS','Email or password is incorrect.');
   const platform=await tx.platformAdmin.findUnique({where:{userId:user.id},select:{active:true}});
   const permitted=input.portal==='platform'?platform?.active:
    await tx.membership.findFirst({where:{userId:user.id,active:true,tenant:{status:{not:'SUSPENDED'}},
     access:{some:{}},role:input.portal==='restaurant'?'RESTAURANT_ADMIN':{in:['CHEF','WORKER','CASHIER','MANAGER']}},
     select:{id:true}});
   if(!permitted)throw new HttpError(403,'PORTAL_FORBIDDEN','This account cannot sign in to the selected portal. Choose the portal assigned to you.');
   rememberDevice=input.rememberDevice===true&&!platform?.active;
   if(old)await tx.staffSession.updateMany({where:{userId:user.id,tokenHash:tokenHash(old)},data:{revokedAt:now}});
   await tx.staffSession.create({data:{userId:user.id,tokenHash:tokenHash(value),rememberDevice,expiresAt:new Date(now.getTime()+sessionLifetimeMs(rememberDevice))}});
  });
  setSessionCookie(res,config,value,rememberDevice);
  res.json({signedIn:true,csrfToken:csrfFor(value)});
 });
 router.post('/auth/invitations/preview',async(req,res)=>{writeOrigin(req,config);const input=z.object({token}).strict().parse(req.body);const invitation=await validInvitation(db(),input.token);res.json({email:invitation.email,restaurant:invitation.tenant.name,branch:invitation.branch.name,role:invitation.role,expiresAt:invitation.expiresAt});});
 router.post('/auth/invitations/accept',async(req,res)=>{writeOrigin(req,config);const input=z.object({token,password}).strict().parse(req.body);res.json(await acceptInvitation(db(),input.token,input.password));});
 router.get('/auth/me',auth,async(req,res)=>{
  const current=identity(res);
  const memberships=await db().membership.findMany({where:{userId:current.user.id,active:true,tenant:{status:{not:'SUSPENDED'}}},select:{role:true,tenant:{select:{id:true,name:true,status:true}},access:{select:{branch:{select:{id:true,name:true,active:true}}}}}});
  res.json({email:current.user.email,platformAdmin:!!current.user.platformAdmin?.active,csrfToken:current.csrfToken,expiresAt:current.session.expiresAt,memberships});
 });
 router.post('/auth/logout',auth,async(_req,res)=>{await db().staffSession.update({where:{id:identity(res).session.id},data:{revokedAt:new Date()}});res.clearCookie(cookieName(config),{httpOnly:true,secure:config.NODE_ENV==='production',sameSite:'strict',path:'/'});res.json({signedOut:true});});
 router.use((req,res,next)=>{if(req.path.startsWith('/table-entry/')||req.path.startsWith('/guest/'))return publicEntryRouterInstance(req,res,next);next();});
 router.use(['/super-admin','/restaurant','/staff'],auth);
 if(database){
  router.use('/restaurant/tables',tableRouter(database,config,'restaurant',notify));
  router.use('/staff/tables',tableRouter(database,config,'staff',notify));
 }
 if(database){
  router.use('/restaurant/order-review',orderReviewRouter(database,config,'RESTAURANT_ADMIN',notify));
  router.use('/staff/order-review',orderReviewRouter(database,config,'STAFF',notify));
 }
 if(database)router.use('/staff/kitchen',kitchenRouter(database,config,notify));
 if(database)router.use('/restaurant/manage',createManagementRouter(database));
 router.use('/super-admin',(_req,res,next)=>{platformOnly(identity(res));next();});
 router.get('/super-admin/analytics',async(req,res)=>{
  const {days}=platformPeriodSchema.parse(req.query);
  res.json(await platformOverview(db(),platformWindow(Number(days))));
 });
 router.get('/super-admin/analytics/restaurants',async(req,res)=>{
  const query=platformDirectoryQuerySchema.parse(req.query);
  res.json(await platformDirectory(db(),platformWindow(Number(query.days)),query));
 });
 router.get('/super-admin/analytics/restaurants/:id/branches',async(req,res)=>{
  const {days}=platformPeriodSchema.parse(req.query);
  res.json(await platformBranches(db(),platformWindow(Number(days)),uuid.parse(req.params.id)));
 });
 router.get('/super-admin/registrations',async(req,res)=>{const query=z.object({status:z.enum(registrationStatuses).default('PENDING'),cursor:uuid.optional()}).strict().parse(req.query);res.json(await listRegistrations(db(),query));});
 router.get('/super-admin/registrations/:id',async(req,res)=>res.json(await registrationDetail(db(),uuid.parse(req.params.id))));
 router.post('/super-admin/registrations/:id/decision',async(req,res)=>res.json(await decideRegistration(db(),identity(res).user.id,uuid.parse(req.params.id),registrationDecisionInput.parse(req.body))));
 router.get('/super-admin/tenants',async(req,res)=>{
  const query=z.object({cursor:uuid.optional(),q:z.string().trim().max(80).optional()}).strict().parse(req.query);
  const items=await db().tenant.findMany({where:query.q?{OR:[{name:{contains:query.q,mode:'insensitive'}},{slug:{contains:query.q}}]}:{},orderBy:[{createdAt:'desc'},{id:'desc'}],take:26,...(query.cursor?{cursor:{id:query.cursor},skip:1}:{}),select:{id:true,name:true,slug:true,status:true,version:true,createdAt:true,subscription:{select:{planCode:true,status:true}}}});
  res.json({items:items.slice(0,25),nextCursor:items.length>25?items[24]!.id:null});
 });
 router.post('/super-admin/tenants',async(req,res)=>{
  const input=z.object({name:z.string().trim().min(2).max(160),slug:z.string().min(2).max(80).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),branchName:z.string().trim().min(2).max(160),adminEmail:email,planCode:z.enum(planCodes)}).strict().parse(req.body);
  const result=await createTenant(db(),identity(res).user.id,input);
  res.status(201).json({tenant:await tenantDetail(db(),result.tenantId),invitation:{...result.invitation,link:`${config.CLIENT_ORIGIN}/accept-invite#${result.invitation.token}`}});
 });
 router.get('/super-admin/tenants/:id',async(req,res)=>res.json(await tenantDetail(db(),uuid.parse(req.params.id))));
 router.patch('/super-admin/tenants/:id',async(req,res)=>{
  const input=z.object({version:z.number().int().positive(),status:z.enum(['DRAFT','SUSPENDED','TRIAL','ACTIVE']).optional(),planCode:z.enum(planCodes).optional(),billingMode:billingModeSchema.optional(),subscriptionStatus:z.enum(subscriptionStatuses).optional(),endsOn:z.iso.date().nullable().optional()}).strict()
   .refine(v=>v.status||v.planCode||v.billingMode)
   .refine(v=>(v.subscriptionStatus===undefined&&v.endsOn===undefined)||v.planCode,{message:'Select a plan when updating subscription details.'}).parse(req.body);
  res.json(await changeTenant(db(),identity(res).user.id,uuid.parse(req.params.id),input));
 });
 router.post('/super-admin/tenants/:id/invitations',async(req,res)=>{
  const id=uuid.parse(req.params.id);const input=z.object({email,branchId:uuid}).strict().parse(req.body);
  const branch=await db().branch.findFirst({where:{id:input.branchId,tenantId:id,tenant:{status:{not:'SUSPENDED'}}}});
  if(!branch)throw new HttpError(404,'NOT_FOUND','An available branch was not found.');
  const invitation=await db().$transaction(tx=>issueInvitation(tx,{tenantId:id,branchId:branch.id,email:input.email,role:'RESTAURANT_ADMIN',actorId:identity(res).user.id}));
  res.status(201).json({...invitation,link:`${config.CLIENT_ORIGIN}/accept-invite#${invitation.token}`});
 });
 async function restaurantAccess(req:Request,res:Response) {
  const selected=selection.parse(req.method==='GET'?req.query:{tenantId:req.body?.tenantId,branchId:req.body?.branchId});
  const member=await db().membership.findFirst({where:{userId:identity(res).user.id,tenantId:selected.tenantId,active:true,role:'RESTAURANT_ADMIN',tenant:{status:{not:'SUSPENDED'}},access:{some:{branchId:selected.branchId}}},include:{tenant:{select:{name:true,status:true}},access:{where:{branchId:selected.branchId},select:{branch:{select:{id:true,name:true,active:true,orderingPaused:true}}}}}});
  if(!member)throw new HttpError(403,'FORBIDDEN','Restaurant administrator access to this branch is required.');
  return {selected,member};
 }
 router.get('/restaurant/analytics',async(req,res)=>{
  const {tenantId,branchId,start,end,period}=selection.extend({
   start:z.iso.date().optional(),end:z.iso.date().optional(),period:z.literal('today').optional(),
  }).strict().parse(req.query);
  if(period&&(start||end)){
   throw new HttpError(400,'INVALID_REPORT_RANGE','Choose Today or select a custom date range.');
  }
  if((start===undefined)!==(end===undefined)||(start&&end&&(end<start||Date.parse(end)-Date.parse(start)>=31*86400000))){
   throw new HttpError(400,'INVALID_REPORT_RANGE','Select a start and end date covering up to 31 days.');
  }
  let scope;
  try{scope=await scopeForVerifiedUser(db(),identity(res).user.id,tenantId,branchId);}
  catch{throw new HttpError(403,'ANALYTICS_FORBIDDEN','Analytics requires an active branch assignment.');}
  if(scope.role!=='RESTAURANT_ADMIN')throw new HttpError(403,'ANALYTICS_FORBIDDEN','Analytics requires Restaurant Admin access.');
  const subscription=await db().subscription.findUnique({where:{tenantId:scope.tenantId},select:{planCode:true}});
  requireAdvancedControls(subscription?.planCode);
  res.set('Cache-Control','private, no-store').json(await readAnalytics(db(),scope,{start,end,period}));
 });
 router.get('/restaurant/context',async(req,res)=>{const {member}=await restaurantAccess(req,res);res.json({restaurant:member.tenant,branch:member.access[0]!.branch,role:member.role,setupOnly:member.tenant.status==='DRAFT',message:'Account and branch permissions are verified. Open setup and menu management below. Tables and secure entry are available as an explicitly published entry pilot; guest ordering remains disabled.'});});
 router.get('/restaurant/menu',async(req,res)=>{const {selected}=await restaurantAccess(req,res);let scope;try{scope=await scopeForVerifiedUser(db(),identity(res).user.id,selected.tenantId,selected.branchId);}catch{throw new HttpError(403,'BRANCH_UNAVAILABLE','This branch is not active.');}res.json({items:await menuRepository(db(),scope).list()});});
 router.post('/restaurant/invitations',async(req,res)=>{
  const {selected}=await restaurantAccess(req,res);
  const input=z.object({tenantId:uuid,branchId:uuid,email,role:z.enum(['MANAGER','CHEF','WORKER','CASHIER'])}).strict().parse(req.body);
  const invitation=await db().$transaction(tx=>issueInvitation(tx,{...selected,email:input.email,role:input.role,actorId:identity(res).user.id}));
  res.status(201).json({...invitation,link:`${config.CLIENT_ORIGIN}/accept-invite#${invitation.token}`});
 });
 router.get('/staff/context',async(req,res)=>{
  const selected=selection.parse(req.query);let scope;
  try{scope=await scopeForVerifiedUser(db(),identity(res).user.id,selected.tenantId,selected.branchId);}catch{throw new HttpError(403,'FORBIDDEN','Active tenant membership and explicit branch assignment are required.');}
  if(!['MANAGER','CHEF','WORKER','CASHIER'].includes(scope.role))throw new HttpError(403,'FORBIDDEN','An assigned staff role is required for this workspace.');
  res.json({role:scope.role,tenantId:scope.tenantId,branchId:scope.branchId,message:'Staff identity and branch access verified. Live kitchen operations are scheduled for Days 14–15.'});
 });
 return router;
}
