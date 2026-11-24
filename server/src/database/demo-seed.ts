import type {Database} from '../db.js';
export class DemoSeedError extends Error {}
export const demoTenants=[1,2].map(index=>({
 tenantId:`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`,
 branchId:`10000000-0000-4000-8000-${String(index).padStart(12,'0')}`,
 categoryId:`20000000-0000-4000-8000-${String(index).padStart(12,'0')}`,
 itemId:`30000000-0000-4000-8000-${String(index).padStart(12,'0')}`,
 tableId:`40000000-0000-4000-8000-${String(index).padStart(12,'0')}`,
 userId:`50000000-0000-4000-8000-${String(index).padStart(12,'0')}`,
 membershipId:`60000000-0000-4000-8000-${String(index).padStart(12,'0')}`,
 name:index===1?'Salimar Darbar':'Isolation Test Restaurant',slug:index===1?'salimar-darbar':'isolation-test-restaurant',
 email:`fixture-admin-${index}@restrodock.example.invalid`,itemName:`Synthetic restaurant ${index} item`,priceMinor:index===1?10000:12500
}));
export async function seedDemoDatabase(db:Database) {
 await db.$transaction(async tx=>{
  for(const f of demoTenants){
   const tenant=await tx.tenant.findUnique({where:{id:f.tenantId}});
   if(tenant&&(tenant.status!=='DRAFT'||tenant.slug!==f.slug))throw new DemoSeedError('Refusing to seed: a reserved fixture tenant is activated or has conflicting ownership.');
   const branch=await tx.branch.findUnique({where:{id:f.branchId}});
   if(branch&&(branch.tenantId!==f.tenantId||branch.active||!branch.orderingPaused))throw new DemoSeedError('Refusing to seed: a fixture branch has conflicting ownership or is activated.');
   const category=await tx.menuCategory.findUnique({where:{id:f.categoryId}});
   const item=await tx.menuItem.findUnique({where:{id:f.itemId}});
   const table=await tx.restaurantTable.findUnique({where:{id:f.tableId}});
   for(const record of [category,item,table])if(record&&(record.tenantId!==f.tenantId||record.branchId!==f.branchId))throw new DemoSeedError('Refusing to seed: a fixture record belongs to a different tenant or branch.');
   if(item&&item.available)throw new DemoSeedError('Refusing to seed: a fixture menu item has been activated.');
   const user=await tx.user.findUnique({where:{id:f.userId}});
   if(user&&(user.email!==f.email||user.active||user.passwordHash))throw new DemoSeedError('Refusing to seed: a fixture user is active, has credentials or has conflicting ownership.');
   const membership=await tx.membership.findUnique({where:{id:f.membershipId}});
   if(membership&&(membership.tenantId!==f.tenantId||membership.userId!==f.userId||membership.active||membership.role!=='RESTAURANT_ADMIN'))throw new DemoSeedError('Refusing to seed: a fixture membership has been activated or changed.');
   await tx.tenant.upsert({where:{id:f.tenantId},update:{},create:{id:f.tenantId,name:f.name,slug:f.slug,status:'DRAFT'}});
   await tx.branch.upsert({where:{id:f.branchId},update:{},create:{id:f.branchId,tenantId:f.tenantId,name:'Synthetic pilot branch',active:false,orderingPaused:true}});
   await tx.menuCategory.upsert({where:{id:f.categoryId},update:{},create:{id:f.categoryId,tenantId:f.tenantId,branchId:f.branchId,name:'Sample category'}});
   await tx.menuItem.upsert({where:{id:f.itemId},update:{},create:{id:f.itemId,tenantId:f.tenantId,branchId:f.branchId,categoryId:f.categoryId,name:f.itemName,priceMinor:f.priceMinor,available:false}});
   await tx.restaurantTable.upsert({where:{id:f.tableId},update:{},create:{id:f.tableId,tenantId:f.tenantId,branchId:f.branchId,label:'Sample table',seats:4}});
   await tx.user.upsert({where:{id:f.userId},update:{},create:{id:f.userId,email:f.email,active:false,passwordHash:null}});
   await tx.membership.upsert({where:{id:f.membershipId},update:{},create:{id:f.membershipId,tenantId:f.tenantId,userId:f.userId,role:'RESTAURANT_ADMIN',active:false}});
   await tx.branchAccess.upsert({where:{tenantId_branchId_membershipId:{tenantId:f.tenantId,branchId:f.branchId,membershipId:f.membershipId}},update:{},create:{tenantId:f.tenantId,branchId:f.branchId,membershipId:f.membershipId}});
  }
 },{timeout:15000});
 return {tenants:2,branches:2,inactiveUsers:2,inactiveMemberships:2,liveQrCodes:0,orders:0};
}
