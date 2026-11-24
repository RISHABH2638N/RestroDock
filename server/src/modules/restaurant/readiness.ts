import {weeklyHours} from '@restrodock/contracts';
export function configurationChecks(input:{displayName:string|null;address:string|null;contactEmail:string|null;contactPhone:string|null;businessHours:unknown;safetyConfigured:boolean;posConfigured:boolean;posName:string|null;posInstructions:string|null;roles:string[]}) {
 const hours=weeklyHours.safeParse(input.businessHours);
 return [
  {key:'profile',label:'Restaurant name, address and contact details',complete:!!input.displayName&&!!input.address&&!!input.contactEmail&&!!input.contactPhone},
  {key:'hours',label:'Weekly hours with at least one open day',complete:hours.success&&hours.data.some(day=>!day.closed)},
  ...['CHEF','WORKER','CASHIER'].map(role=>({key:role.toLowerCase(),label:`Active ${role.toLowerCase()} assigned to this branch`,complete:input.roles.includes(role)})),
  {key:'safety',label:'Quantity, value and PIN settings acknowledged',complete:input.safetyConfigured},
  {key:'pos',label:'Manual POS owner and workflow acknowledged',complete:input.posConfigured&&!!input.posName&&!!input.posInstructions}
 ];
}
