export type ServiceAnnouncement = {
 id:string;
 kind:'new-order'|'ready'|'assistance'|'confirmation';
 text:string;
};

export function newOrderAnnouncement(id:string,label:string,items:readonly {name:string;quantity:number}[]):ServiceAnnouncement {
 const quantities=new Map<string,number>();
 for(const {name,quantity} of items) quantities.set(name,(quantities.get(name)??0)+quantity);
 const list=new Intl.ListFormat('hi-IN').format([...quantities].map(([name,count])=>count+' '+name));
 return {id:'order:'+id,kind:'new-order',text:`${spokenTable(label)} से नया ऑर्डर आया है। ${list}।`};
}

export function spokenTable(label:string){
 return 'टेबल '+label.replace(/^table\s+/i,'');
}
