import {weeklyHours} from '@restrodock/contracts';
export function seatingOpen(hours:unknown, timezone:string, cutoff:number){
  const schedule=weeklyHours.safeParse(hours);
  if(!schedule.success)return false;
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
  const part=(key:string)=>parts.find(value=>value.type===key)?.value;
  const day=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(part('weekday')??'');
  const minute=Number(part('hour'))*60+Number(part('minute'));
  const clock=(value:string)=>Number(value.slice(0,2))*60+Number(value.slice(3));
  return schedule.data.some(slot=>{
   if(slot.closed)return false;
   const elapsed=slot.day===day?minute:(slot.day+1)%7===day&&slot.closesNextDay?minute+1440:-1;
   return elapsed>=clock(slot.opens)&&elapsed<clock(slot.closes)+(slot.closesNextDay?1440:0)-cutoff;
  });
 }

