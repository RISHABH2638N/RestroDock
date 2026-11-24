import type {ReactNode} from 'react';

export function AdminPanel({title,description,actions,children,className=''}:{
 title:string;
 description?:string;
 actions?:ReactNode;
 children:ReactNode;
 className?:string;
}){
 return <section className={`rd-admin-panel ${className}`} aria-label={title}>
  <header className="rd-admin-panel-heading">
   <div><h2>{title}</h2>{description&&<p>{description}</p>}</div>
   {actions&&<div className="rd-admin-actions">{actions}</div>}
  </header>
  {children}
 </section>;
}
