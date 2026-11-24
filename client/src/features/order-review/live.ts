import {useEffect,useEffectEvent,useState} from 'react';
import {io} from 'socket.io-client';

export function useOrderUpdates(tenantId:string,branchId:string,workspace:boolean|'tables',
 refresh:(isCurrent:()=>boolean)=>Promise<boolean>,loadOnMount=false,onAnnouncement?:(event:unknown)=>void){
 const [live,setLive]=useState(false);
 const read=useEffectEvent(refresh);
 const announce=useEffectEvent((event:unknown)=>onAnnouncement?.(event));
 useEffect(()=>{
  let active=true,reading=false;
  let scheduled:ReturnType<typeof setTimeout>|undefined;
  const socket=io({path:'/restrodock-live',addTrailingSlash:false,
   auth:{tenantId,branchId,...(workspace===true?{kitchen:true}:workspace==='tables'?{tableService:true}:{})},transports:['websocket'],
   autoConnect:false,reconnectionDelayMax:10000,
  });
  async function sync(){
   if(!active||document.hidden)return;
   if(reading){schedule();return;}
   reading=true;
   try{if(!await read(()=>active))schedule();}
   finally{reading=false;}
  }
  function schedule(){
   if(!active||scheduled)return;
   scheduled=setTimeout(()=>{scheduled=undefined;void sync();},250);
  }
  socket.on('connect',()=>{setLive(true);schedule();});
  socket.on('disconnect',()=>{setLive(false);schedule();});
  socket.on('connect_error',()=>setLive(false));
  socket.on('branch-orders:changed',(event:unknown)=>{
   if(event&&typeof event==='object'&&'version' in event&&event.version===1)schedule();
  });
  socket.on('service:announcement',event=>{if(active)announce(event);});
  socket.connect();
  if(loadOnMount)schedule();
  let ticks=0;
  const poll=setInterval(()=>{
   ticks++;
   if(!socket.connected||ticks%3===0)void sync();
  },10000);
  document.addEventListener('visibilitychange',schedule);
  return ()=>{
   active=false;
   clearTimeout(scheduled);
   clearInterval(poll);
   document.removeEventListener('visibilitychange',schedule);
   socket.removeAllListeners().disconnect();
  };
 },[tenantId,branchId,workspace,loadOnMount]);
 return live;
}
