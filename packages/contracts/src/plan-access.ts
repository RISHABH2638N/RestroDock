import {z} from 'zod';

export const planAccessSchema=z.object({
 planCode:z.string(),
 outletLimit:z.number().int().positive().nullable(),
 activeOutlets:z.number().int().nonnegative(),
 advancedControls:z.boolean(),
 canOpenTables:z.boolean(),
 endsAt:z.string().nullable(),
});

export function planEntitlements(planCode:string|null|undefined){
 // Existing trials and restaurants without an assigned plan retain pilot access.
 switch(planCode){
  case 'STARTER': return {outletLimit:1,advancedControls:false};
  case 'GROWTH': return {outletLimit:1,advancedControls:true};
  case 'PRO': return {outletLimit:3,advancedControls:true};
  case 'TRIAL':
  case null:
  case undefined: return {outletLimit:null,advancedControls:true};
  default: return {outletLimit:1,advancedControls:false};
 }
}
