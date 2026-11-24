import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { AlertCircle, Inbox, LockKeyhole, WifiOff } from 'lucide-react';
export function Button({variant='primary',className='',type='button',...props}:ButtonHTMLAttributes<HTMLButtonElement>&{variant?:'primary'|'secondary'|'quiet'}) {
 return <button {...props} type={type} className={`ui-button ui-button--${variant} ${className}`}/>;
}
export type Tone='neutral'|'success'|'warning'|'danger';
export function Badge({children,tone='neutral'}:{children:ReactNode;tone?:Tone}) {return <span className={`ui-badge ui-badge--${tone}`}>{children}</span>;}
export function Notice({children,tone='neutral'}:{children:ReactNode;tone?:Tone}) {return <div className={`ui-notice ui-notice--${tone}`}><AlertCircle size={17} aria-hidden="true"/><div>{children}</div></div>;}
export function EmptyState({title,children}:{title:string;children:ReactNode}) {return <div className="ui-state"><Inbox size={28} aria-hidden="true"/><h3>{title}</h3><p>{children}</p></div>;}
export function LoadingState(){return <div className="ui-loading" role="status" aria-label="Loading preview" aria-busy="true"><span className="sr-only">Loading preview content…</span>{[1,2,3].map(n=><div className="ui-skeleton" key={n} aria-hidden="true"/>)}</div>;}
export function ErrorState({retry}:{retry:()=>void}) {return <div className="ui-state" role="alert"><AlertCircle size={28} aria-hidden="true"/><h3>This preview could not load.</h3><p>Try again to return to the normal sample view.</p><Button variant="secondary" onClick={retry}>Retry preview</Button></div>;}
export function OfflineState({retry}:{retry:()=>void}) {return <div className="ui-state"><WifiOff size={28} aria-hidden="true"/><h3>Connection unavailable</h3><p>In the real workflow, refresh authoritative status after reconnecting. This scenario is simulated; no action has been queued.</p><Button variant="secondary" onClick={retry}>Preview reconnection</Button></div>;}
export function LockedState(){return <div className="ui-state"><LockKeyhole size={28} aria-hidden="true"/><h3>Verified staff access required</h3><p>Authentication and assigned-branch permissions must be checked before any operational action.</p><Button disabled>Sign-in planned for Day 5</Button></div>;}
export function FieldError({children,id}:{children:ReactNode;id:string}) {return <p className="ui-field-error" role="alert" id={id}>{children}</p>;}
