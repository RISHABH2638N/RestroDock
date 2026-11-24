'use client';

import {useState,type ReactNode} from 'react';

export function BulkSelection({title,items,busy,children,onApply}:{
 title:string;
 items:readonly {id:string;label:string}[];
 busy:boolean;
 children:ReactNode;
 onApply:(ids:string[],fields:FormData)=>Promise<boolean>;
}){
 const [selected,setSelected]=useState<string[]>([]);
 const ids=selected.filter(id=>items.some(item=>item.id===id));
 if(!items.length)return null;
 return <details className="rd-panel rd-bulk">
  <summary>{title}</summary>
  <form className="access-form" onSubmit={async event=>{
   event.preventDefault();
   if(busy||!ids.length)return;
   if(await onApply(ids,new FormData(event.currentTarget)))setSelected([]);
  }}>
   <p className="access-help">{ids.length} selected · up to 20 per update</p>
   <ul className="rd-bulk-list" aria-label="Records to update">
    {items.map(item=><li key={item.id}><label>
     <input type="checkbox" checked={ids.includes(item.id)} disabled={busy||(!ids.includes(item.id)&&ids.length>=20)}
      onChange={event=>{const checked=event.target.checked;setSelected(previous=>checked?[...ids,item.id]:previous.filter(id=>id!==item.id));}}/>
     {item.label}
    </label></li>)}
   </ul>
   {children}
   <button className="button primary" disabled={busy||!ids.length}>Apply to selected</button>
  </form>
 </details>;
}
