import {readPlanAccess,requireAdvancedControls} from '../platform/plan-access.js';
import type {Prisma} from '@prisma/client';
import type {Database} from '../../db.js';
import {createHash} from 'node:crypto';
import {type SetupView,type Catalogue,weeklyHours,type profileInput,type safetyInput,type posInput,type flagsInput,type categoryInput,type itemInput,type importInput,type menuAvailabilityInput,type staffRoleInput} from '@restrodock/contracts';
import type {z} from 'zod';
import {HttpError} from '../auth/session.js';
import {configurationChecks} from './readiness.js';
import {requireSetupScope,type SetupScope} from './scope.js';
type Tx=Prisma.TransactionClient;
const emptyHours=()=>Array.from({length:7},(_,day)=>({day,closed:true,opens:'09:00',closes:'22:00',closesNextDay:false}));
export function managementRepository(db:Database,scope:SetupScope) {
 requireSetupScope(scope);
 const owned={tenantId:scope.tenantId,branchId:scope.branchId};
 const branchWhere={tenantId:scope.tenantId,id:scope.branchId};
 const imageUrl=(path:string,hash:string)=>`/api/v1/restaurant/manage/${path}?tenantId=${scope.tenantId}&branchId=${scope.branchId}&v=${hash}`;
 async function audit(tx:Tx,action:string,resourceReference:string){
  await tx.controlAudit.create({data:{actorId:scope.userId,tenantId:scope.tenantId,action,resourceReference}});
  await tx.auditEvent.create({data:{...owned,actorReference:scope.userId,action,resourceReference}});
 }
 async function claim(tx:Tx,kind:'setupVersion'|'menuRevision',version:number){const changed=await tx.branch.updateMany({where:{...branchWhere,[kind]:version},data:{[kind]:{increment:1}}});if(changed.count!==1)throw new HttpError(409,'STALE_VERSION','This branch changed. Refresh it before retrying.');}
 async function setup(source:Tx|Database=db):Promise<SetupView>{
  const branch=await source.branch.findFirstOrThrow({where:branchWhere,include:{settings:true,logo:{select:{sha256:true}}}});
  const staff=await source.membership.findMany({where:{tenantId:scope.tenantId,access:{some:{branchId:scope.branchId}}},select:{id:true,role:true,active:true,_count:{select:{access:true}},user:{select:{email:true,active:true}}},orderBy:{id:'asc'},take:200});
  const settings=branch.settings;
  const hoursResult=weeklyHours.safeParse(settings?.businessHours);
  const hours=hoursResult.success?hoursResult.data:emptyHours();
  const profile={displayName:settings?.displayName??'',address:settings?.address??'',contactEmail:settings?.contactEmail??'',contactPhone:settings?.contactPhone??''};
  const checklist=configurationChecks({displayName:settings?.displayName??null,address:settings?.address??null,contactEmail:settings?.contactEmail??null,contactPhone:settings?.contactPhone??null,businessHours:settings?.businessHours,safetyConfigured:settings?.safetyConfigured??false,posConfigured:settings?.posConfigured??false,posName:settings?.posName??null,posInstructions:settings?.posInstructions??null,roles:staff.filter(member=>member.active&&member.user.active).map(member=>member.role)});
  const planAccess=await readPlanAccess(source,scope.tenantId);
  return {planAccess,version:branch.setupVersion,branch:{id:branch.id,name:branch.name,timezone:branch.timezone,active:branch.active,orderingPaused:branch.orderingPaused},profile,hours,lastSeatingMinutes:settings?.lastSeatingMinutes===15?15:settings?.lastSeatingMinutes===30?30:null,safety:{maxItemQuantity:settings?.maxItemQuantity??10,maxOrderQuantity:settings?.maxOrderQuantity??30,maxOrderValueMinor:settings?.maxOrderValueMinor??500000,approvalQuantity:settings?.approvalQuantity??null,approvalValueMinor:settings?.approvalValueMinor??null,pinExpiryMinutes:settings?.pinExpiryMinutes??15,configured:settings?.safetyConfigured??false},pos:{posName:settings?.posName??'',posInstructions:settings?.posInstructions??'',configured:settings?.posConfigured??false},flags:{assistanceEnabled:settings?.assistanceEnabled??false,menuPhotosEnabled:settings?.menuPhotosEnabled??true},logoUrl:branch.logo?imageUrl('logo',branch.logo.sha256):null,staff:staff.map(member=>({membershipId:member.id,email:member.user.email,role:member.role,active:member.active&&member.user.active,canChangeRole:member.role!=='RESTAURANT_ADMIN'&&member.active&&member.user.active&&member._count.access===1})),checklist,configurationReady:checklist.every(check=>check.complete),submittedAt:settings?.submittedAt?.toISOString()??null,activationAllowed:false};
 }
 async function saveSetup(version:number,action:string,work:(tx:Tx)=>Promise<unknown>,reference=scope.branchId){await db.$transaction(async tx=>{
  if(action==='BRANCH_CONFIGURATION_SUBMITTED'||action==='BRANCH_SAFETY_UPDATED')
   await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${scope.tenantId}::uuid FOR UPDATE`;
  await claim(tx,'setupVersion',version);await tx.branchSettings.upsert({where:{tenantId_branchId:owned},create:owned,update:{submittedAt:null}});await work(tx);await audit(tx,action,reference);},{maxWait:10000,timeout:15000});return setup();}
 async function catalogue(preview=false):Promise<Catalogue>{
  const branch=await db.branch.findFirstOrThrow({where:branchWhere,select:{menuRevision:true,settings:{select:{menuPhotosEnabled:true}}}});
  const categories=await db.menuCategory.findMany({where:{...owned,...(preview?{archived:false}:{})},orderBy:[{sortOrder:'asc'},{id:'asc'}],take:40,select:{id:true,name:true,sortOrder:true,archived:true}});
  const rows=await db.menuItem.findMany({where:{...owned,...(preview?{state:'PUBLISHED',reviewRequired:false,category:{archived:false}}:{})},orderBy:[{sortOrder:'asc'},{id:'asc'}],take:200,select:{id:true,categoryId:true,name:true,description:true,priceMinor:true,foodType:true,available:true,state:true,sortOrder:true,source:true,reviewRequired:true,variants:{orderBy:{sortOrder:'asc'},select:{name:true,priceMinor:true,available:true}},addons:{orderBy:{sortOrder:'asc'},select:{name:true,priceMinor:true,available:true}},photo:{select:{sha256:true}}}});
  return {revision:branch.menuRevision,categories,items:rows.map(({photo,...item})=>({...item,foodType:item.foodType as Catalogue['items'][number]['foodType'],state:item.state as Catalogue['items'][number]['state'],photoUrl:photo&&(!preview||branch.settings?.menuPhotosEnabled!==false)?imageUrl(`items/${item.id}/photo`,photo.sha256):null}))};
 }
 async function menuWrite(revision:number,action:string,reference:string,work:(tx:Tx)=>Promise<unknown>){await db.$transaction(async tx=>{await claim(tx,'menuRevision',revision);await work(tx);await audit(tx,action,reference);},{maxWait:10000,timeout:15000});return catalogue();}
 async function itemExists(source:Tx|Database,id:string){const item=await source.menuItem.findFirst({where:{...owned,id}});if(!item)throw new HttpError(404,'NOT_FOUND','Menu item not found in this branch.');return item;}
 return {
  setup,catalogue,
  async auditPage(cursor?:string){
   const branch=await db.branch.findFirstOrThrow({where:branchWhere,select:{timezone:true}});
   const anchor=cursor?await db.auditEvent.findFirst({where:{...owned,id:cursor},select:{id:true,createdAt:true}}):null;
   if(cursor&&!anchor)throw new HttpError(404,'NOT_FOUND','This audit page is unavailable. Reload branch activity.');
   const rows=await db.auditEvent.findMany({
    where:{...owned,...(anchor?{OR:[{createdAt:{lt:anchor.createdAt}},{createdAt:anchor.createdAt,id:{lt:anchor.id}}]}:{})},
    orderBy:[{createdAt:'desc'},{id:'desc'}],take:31,
    select:{id:true,action:true,resourceReference:true,actorReference:true,createdAt:true},
   });
   const events=rows.slice(0,30).map(row=>({
    id:row.id,action:row.action,resource:row.resourceReference,createdAt:row.createdAt,
    actor:row.actorReference==='GUEST'||row.actorReference==='guest-checkout'?'Guest':
     /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.actorReference)?'Staff':'System',
   }));
   return {events,timezone:branch.timezone,nextCursor:rows.length>30?events.at(-1)!.id:null};
  },
  changeStaffRole:(id:string,input:z.infer<typeof staffRoleInput>)=>saveSetup(input.version,'BRANCH_STAFF_ROLE_CHANGED',async tx=>{
   await tx.$queryRaw`SELECT id FROM "Membership" WHERE "tenantId"=${owned.tenantId}::uuid AND id=${id}::uuid FOR UPDATE`;
   const member=await tx.membership.findFirst({where:{id,tenantId:owned.tenantId,active:true,user:{active:true},role:{not:'RESTAURANT_ADMIN'},access:{some:{branchId:owned.branchId}}},select:{id:true,_count:{select:{access:true}}}});
   if(!member)throw new HttpError(403,'FORBIDDEN','Only active staff assigned to this branch can be edited.');
   if(member._count.access!==1)throw new HttpError(409,'MULTI_BRANCH_ROLE','This role applies across multiple branches. Ask your platform administrator to coordinate the change.');
   await tx.membership.update({where:{id:member.id},data:{role:input.role}});
  },id),
  bulkAvailability:(input:z.infer<typeof menuAvailabilityInput>)=>menuWrite(input.revision,input.available?'MENU_ITEMS_AVAILABLE':'MENU_ITEMS_SOLD_OUT',scope.branchId,async tx=>{
   const changed=await tx.menuItem.updateMany({
    where:{...owned,id:{in:input.ids},state:'PUBLISHED',reviewRequired:false,category:{archived:false}},
    data:{available:input.available},
   });
   if(changed.count!==input.ids.length)throw new HttpError(409,'MENU_SELECTION_CHANGED','Only published items in this branch can be updated. Reload the menu and try again.');
  }),
  saveProfile:(input:z.infer<typeof profileInput>)=>saveSetup(input.version,'BRANCH_PROFILE_UPDATED',async tx=>{await tx.branch.update({where:{id:scope.branchId},data:{name:input.branchName,timezone:input.timezone}});await tx.branchSettings.update({where:{tenantId_branchId:owned},data:{displayName:input.displayName||null,address:input.address||null,contactEmail:input.contactEmail||null,contactPhone:input.contactPhone||null}});}),
  saveHours:(input:{version:number;hours:z.infer<typeof weeklyHours>;lastSeatingMinutes?:15|30|null|undefined})=>saveSetup(input.version,'BRANCH_HOURS_UPDATED',tx=>tx.branchSettings.update({where:{tenantId_branchId:owned},data:{businessHours:input.hours,...(input.lastSeatingMinutes===undefined?{}:{lastSeatingMinutes:input.lastSeatingMinutes})}})),
  saveSafety:(input:z.infer<typeof safetyInput>)=>saveSetup(input.version,'BRANCH_SAFETY_UPDATED',async tx=>{
   if(input.approvalQuantity!=null||input.approvalValueMinor!=null){
    const subscription=await tx.subscription.findUnique({where:{tenantId:scope.tenantId},select:{planCode:true}});
    requireAdvancedControls(subscription?.planCode);
   }
   await tx.branchSettings.update({where:{tenantId_branchId:owned},data:{maxItemQuantity:input.maxItemQuantity,maxOrderQuantity:input.maxOrderQuantity,maxOrderValueMinor:input.maxOrderValueMinor,...(input.approvalQuantity===undefined?{}:{approvalQuantity:input.approvalQuantity}),...(input.approvalValueMinor===undefined?{}:{approvalValueMinor:input.approvalValueMinor}),pinExpiryMinutes:input.pinExpiryMinutes,safetyConfigured:true}});
  }),
  savePos:(input:z.infer<typeof posInput>)=>saveSetup(input.version,'BRANCH_POS_UPDATED',tx=>tx.branchSettings.update({where:{tenantId_branchId:owned},data:{posName:input.posName||null,posInstructions:input.posInstructions||null,posConfigured:true}})),
  saveFlags:(input:z.infer<typeof flagsInput>)=>saveSetup(input.version,'BRANCH_FLAGS_UPDATED',async tx=>{if(!input.orderingPaused)throw new HttpError(409,'SERVICE_LOCKED','Unpausing service requires later activation and operational acceptance.');await tx.branch.update({where:{id:scope.branchId},data:{orderingPaused:true}});await tx.branchSettings.update({where:{tenantId_branchId:owned},data:{assistanceEnabled:input.assistanceEnabled,menuPhotosEnabled:input.menuPhotosEnabled}});}),
  submit:(version:number)=>saveSetup(version,'BRANCH_CONFIGURATION_SUBMITTED',async tx=>{
   const current=await setup(tx);
   if(!current.configurationReady)throw new HttpError(409,'CONFIGURATION_INCOMPLETE','Complete the required profile, hours, accepted staff roles, safety and POS settings before submitting.');
   // Serialize against a concurrent platform suspension. Approval already happened
   // during onboarding, so a complete configuration activates branch staff access.
   const tenant=await tx.tenant.findUniqueOrThrow({where:{id:scope.tenantId},select:{status:true}});
   if(tenant.status==='SUSPENDED')throw new HttpError(409,'TENANT_SUSPENDED','This restaurant is suspended. Ask the Platform Admin to review its status.');
   if(tenant.status==='DRAFT')await tx.tenant.update({where:{id:scope.tenantId},data:{status:'TRIAL',version:{increment:1}}});
   const branch=await tx.branch.findFirstOrThrow({where:branchWhere,select:{active:true}});
   await tx.branchSettings.update({where:{tenantId_branchId:owned},data:{submittedAt:new Date()}});
   if(!branch.active){
    if(current.planAccess&&!current.planAccess.canOpenTables)throw new HttpError(409,'SUBSCRIPTION_ENDED','Renew the subscription before activating an outlet.');
    if(current.planAccess&&current.planAccess.outletLimit!==null&&current.planAccess.activeOutlets>=current.planAccess.outletLimit)
     throw new HttpError(409,'PLAN_OUTLET_LIMIT','This plan has reached its active outlet limit.');
    await tx.branch.update({where:{id:scope.branchId},data:{active:true,orderingPaused:true}});
    await audit(tx,'BRANCH_AUTO_ACTIVATED',scope.branchId);
   }
  }),
  saveCategory:(input:z.infer<typeof categoryInput>,id?:string)=>menuWrite(input.revision,'MENU_CATEGORY_SAVED',id??scope.branchId,async tx=>{if(id){const category=await tx.menuCategory.findFirst({where:{...owned,id}});if(!category)throw new HttpError(404,'NOT_FOUND','Category not found in this branch.');if(input.archived&&await tx.menuItem.count({where:{...owned,categoryId:id,state:{not:'ARCHIVED'}}}))throw new HttpError(409,'CATEGORY_NOT_EMPTY','Archive or move this category’s items first.');await tx.menuCategory.update({where:{id},data:{name:input.name,sortOrder:input.sortOrder,archived:input.archived}});}else{if(await tx.menuCategory.count({where:owned})>=40)throw new HttpError(409,'CATEGORY_LIMIT','This branch supports up to 40 categories, including archived records.');await tx.menuCategory.create({data:{...owned,name:input.name,sortOrder:input.sortOrder,archived:false}});}}),
  saveItem:(input:z.infer<typeof itemInput>,id?:string)=>menuWrite(input.revision,'MENU_ITEM_SAVED',id??scope.branchId,async tx=>{
   const existing=id?await itemExists(tx,id):null;
   const category=await tx.menuCategory.findFirst({where:{...owned,id:input.categoryId,archived:false}});if(!category)throw new HttpError(404,'NOT_FOUND','Choose an unarchived category from this branch.');
   if(input.state==='PUBLISHED'&&(input.foodType==='UNSPECIFIED'||existing?.reviewRequired))throw new HttpError(409,'MENU_REVIEW_REQUIRED','Confirm the food classification and review any imported draft before publishing.');
   const {revision:_,variants,addons,...fields}=input;void _;
   const data={...fields,...(fields.state==='ARCHIVED'?{available:false}:{})};
   if(!existing&&await tx.menuItem.count({where:owned})>=200)throw new HttpError(409,'ITEM_LIMIT','This branch supports up to 200 items, including archived records.');
   const item=existing?await tx.menuItem.update({where:{id:existing.id},data}):await tx.menuItem.create({data:{...owned,...data}});
   await tx.menuVariant.deleteMany({where:{...owned,menuItemId:item.id}});await tx.menuAddon.deleteMany({where:{...owned,menuItemId:item.id}});
   for(const [sortOrder,option] of variants.entries())await tx.menuVariant.create({data:{...owned,menuItemId:item.id,...option,sortOrder}});
   for(const [sortOrder,option] of addons.entries())await tx.menuAddon.create({data:{...owned,menuItemId:item.id,...option,sortOrder}});
  }),
  archiveItem:(id:string,revision:number)=>menuWrite(revision,'MENU_ITEM_ARCHIVED',id,async tx=>{await itemExists(tx,id);await tx.menuItem.update({where:{id},data:{state:'ARCHIVED',available:false}});}),
  reviewItem:(id:string,revision:number)=>menuWrite(revision,'MENU_IMPORT_REVIEWED',id,async tx=>{const item=await itemExists(tx,id);if(item.foodType==='UNSPECIFIED'||item.priceMinor<1||item.state==='ARCHIVED')throw new HttpError(409,'MENU_REVIEW_REQUIRED','Edit this draft and confirm its food type and price before review.');await tx.menuItem.update({where:{id},data:{reviewRequired:false,reviewedAt:new Date()}});}),
  async importDrafts(input:z.infer<typeof importInput>){
   const {revision:_,...payload}=input;void _;const payloadHash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
   await db.$transaction(async tx=>{
    // Serialize on branch revision before testing a reusable import key, including concurrent retries.
    await tx.$queryRaw`SELECT id FROM "Branch" WHERE "tenantId"=${scope.tenantId}::uuid AND id=${scope.branchId}::uuid FOR UPDATE`;
    const old=await tx.menuImport.findUnique({where:{tenantId_branchId_requestKey:{...owned,requestKey:input.requestKey}}});
    if(old){if(old.payloadHash!==payloadHash)throw new HttpError(409,'IMPORT_KEY_CONFLICT','This import key was already used with different content.');return;}
    await claim(tx,'menuRevision',input.revision);
    if(!await tx.menuCategory.findFirst({where:{...owned,id:input.categoryId,archived:false}}))throw new HttpError(404,'NOT_FOUND','Choose an unarchived category from this branch.');
    if(await tx.menuItem.count({where:owned})+input.rows.length>200)throw new HttpError(409,'ITEM_LIMIT','This import would exceed the branch item limit.');
    for(const row of input.rows)await tx.menuItem.create({data:{...owned,categoryId:input.categoryId,...row,state:'DRAFT',source:'IMPORT',reviewRequired:true,available:false}});
    await tx.menuImport.create({data:{...owned,requestKey:input.requestKey,payloadHash,itemCount:input.rows.length}});await audit(tx,'MENU_DRAFTS_IMPORTED',input.requestKey);
   },{maxWait:10000,timeout:15000});return catalogue();
  },
  async logo(){return db.branchLogo.findUnique({where:{tenantId_branchId:owned}});},
  async photo(id:string){await itemExists(db,id);return db.menuPhoto.findUnique({where:{tenantId_branchId_menuItemId:{...owned,menuItemId:id}}});},
  saveLogo:(version:number,image:{bytes:Uint8Array<ArrayBuffer>;width:number;height:number;sha256:string})=>saveSetup(version,'BRANCH_LOGO_UPDATED',tx=>tx.branchLogo.upsert({where:{tenantId_branchId:owned},create:{...owned,...image},update:image})),
  removeLogo:(version:number)=>saveSetup(version,'BRANCH_LOGO_REMOVED',tx=>tx.branchLogo.deleteMany({where:owned})),
  savePhoto:(id:string,revision:number,image:{bytes:Uint8Array<ArrayBuffer>;width:number;height:number;sha256:string})=>menuWrite(revision,'MENU_PHOTO_UPDATED',id,async tx=>{await itemExists(tx,id);if(!await tx.menuPhoto.findUnique({where:{tenantId_branchId_menuItemId:{...owned,menuItemId:id}}})&&await tx.menuPhoto.count({where:owned})>=50)throw new HttpError(409,'PHOTO_LIMIT','This branch supports up to 50 item photos. Remove an unused photo first.');await tx.menuPhoto.upsert({where:{tenantId_branchId_menuItemId:{...owned,menuItemId:id}},create:{...owned,menuItemId:id,...image},update:image});}),
  removePhoto:(id:string,revision:number)=>menuWrite(revision,'MENU_PHOTO_REMOVED',id,async tx=>{await itemExists(tx,id);await tx.menuPhoto.deleteMany({where:{...owned,menuItemId:id}});}),
  async removeStaff(membershipId:string,version:number){return saveSetup(version,'BRANCH_STAFF_REMOVED',async tx=>{const member=await tx.membership.findFirst({where:{id:membershipId,tenantId:scope.tenantId,access:{some:{branchId:scope.branchId}}}});if(!member||member.role==='RESTAURANT_ADMIN')throw new HttpError(403,'FORBIDDEN','Only non-administrator assignments in this branch can be removed here.');await tx.branchAccess.delete({where:{tenantId_branchId_membershipId:{...owned,membershipId}}});});}
 };
}
