'use client';
import Link from 'next/link';
import {BrandLogo} from './brand-logo';
import {useEffect,useRef,useState,type KeyboardEvent} from 'react';
import {usePathname} from 'next/navigation';
import {ShieldCheck,Store,ChefHat,LogOut,ArrowRight,Clock3,Users,BookOpen,Eye,QrCode,ChartNoAxesColumn,Menu,X,ClipboardCheck,LayoutDashboard,TableProperties,HandHelping,ReceiptText,History} from 'lucide-react';
import {type StaffIdentity} from '@restrodock/contracts';
import {PublicFrame} from './public-frame';
import {SessionGate,useVerifiedSession} from '../features/access/session';
import {assignedMemberships,isStaffRole,staffTitles,staffHome,staffSectionsFor,workspacesFor,workspaceForPath,workspacePath,defaultWorkspace,type Workspace} from '../features/access/policy';

import {restaurantSections} from '../features/restaurant/sections';

const navigationOrder=['order-review','tables','menu','menu-preview','staff','profile','hours','safety-pos','analytics','audit'];
const restaurantIcons={profile:Store,hours:Clock3,'safety-pos':ShieldCheck,staff:Users,menu:BookOpen,'menu-preview':Eye,tables:QrCode,'order-review':ClipboardCheck,analytics:ChartNoAxesColumn,audit:History};
const labels={platform:'Restaurants & plans',restaurant:'Restaurant workspace',staff:'Staff workspace'};
const icons={platform:ShieldCheck,restaurant:Store,staff:ChefHat};
export function Shell({children,uxPreviewEnabled=false}:{children:React.ReactNode;uxPreviewEnabled?:boolean}){
 const path=usePathname();
 const workspace=workspaceForPath(path);
 if(!workspace&&path!=='/workspace')return <PublicFrame guest={path==='/q'||path.startsWith('/q/')}>{uxPreviewEnabled&&path.startsWith('/design')&&<p className="studio-scope-note">Development UX studio · Synthetic examples only</p>}{children}</PublicFrame>;
 return <SessionGate showSessionBar={false} publicFallback>{identity=><WorkspaceFrame identity={identity} path={path}>{children}</WorkspaceFrame>}</SessionGate>;
}
export function WorkspaceFrame({identity,path,children}:{identity:StaffIdentity;path:string;children:React.ReactNode}){
 const session=useVerifiedSession(),workspaces=workspacesFor(identity),current=workspaceForPath(path);
 const developer=path==='/workspace';
 const staff=assignedMemberships(identity).filter(member=>isStaffRole(member.role));
 const staffNavigation=staffSectionsFor(identity);
 const staffSection=staffNavigation.find(section=>section.href===path);
 const permitted=developer?identity.platformAdmin:current!==null&&workspaces.includes(current)&&(current!=='staff'||path==='/staff'||!!staffSection);
 const staffRole=staff[0]?.role;
 const staffTitle=staffRole&&isStaffRole(staffRole)&&staff.every(member=>member.role===staffRole)?staffTitles[staffRole as keyof typeof staffTitles]:labels.staff;
 const name=(kind:Workspace)=>kind==='staff'?staffTitle:labels[kind];
 const currentSection=restaurantSections.find(section=>section.href===path);
 const activeLabel=permitted?(current==='restaurant'?currentSection?.label??'Overview':developer?'Development diagnostics':current==='platform'?platformEntries.find(entry=>entry.href===path)?.label??labels.platform:current==='staff'?staffSection?.label??labels.staff:name(current!)):'Workspace access';
 const restaurant=permitted&&current==='restaurant';
 const staffWorkspace=permitted&&current==='staff';
 const themed=restaurant||staffWorkspace||(permitted&&current==='platform');
 const caption=restaurant?'Restaurant admin':current==='platform'?'Platform admin':staffTitle;
 const entries=restaurant?restaurantEntries:current==='platform'?platformEntries:staffNavigation.map(entry=>({...entry,Icon:staffIcons[entry.icon]}));
 const scope=developer||current==='platform'?'PLATFORM ADMIN':'YOUR WORKSPACES';
 const [drawerOpen,setDrawerOpen]=useState(false);
 const toggle=useRef<HTMLButtonElement>(null);
 const closeButton=useRef<HTMLButtonElement>(null);
 const restoreFocus=useRef(false);

 useEffect(()=>{setDrawerOpen(false);},[path]);
 useEffect(()=>{
   const viewport=window.matchMedia?.('(max-width: 640px)');
   function closeOnDesktop(event:MediaQueryListEvent){
     if(!event.matches)setDrawerOpen(false);
   }
   viewport?.addEventListener('change',closeOnDesktop);
   return ()=>viewport?.removeEventListener('change',closeOnDesktop);
 },[]);
 useEffect(()=>{
   if(drawerOpen)closeButton.current?.focus();
   else if(restoreFocus.current){
     restoreFocus.current=false;
     toggle.current?.focus();
   }
 },[drawerOpen]);

 function closeDrawer(){
   if(!drawerOpen)return;
   restoreFocus.current=true;
   setDrawerOpen(false);
 }

 function handleDrawerKeys(event:KeyboardEvent<HTMLElement>){
   if(!drawerOpen)return;
   if(event.key==='Escape'){
     event.preventDefault();
     closeDrawer();
   }
   if(event.key!=='Tab')return;
   const controls=event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
   const first=controls[0],last=controls[controls.length-1];
   if(event.shiftKey&&document.activeElement===first){
     event.preventDefault();
     last?.focus();
   }else if(!event.shiftKey&&document.activeElement===last){
     event.preventDefault();
     first?.focus();
   }
 }

 return <div className={`app-shell role-shell${themed?' restaurant-shell':''}${staffWorkspace?' staff-shell':''}`}>
  <a className="skip-link" href="#main" inert={drawerOpen}>Skip to content</a>
  {drawerOpen&&<div className="workspace-drawer-backdrop" aria-hidden="true" onClick={closeDrawer}/>}
  <aside className="sidebar workspace-drawer" id="workspace-drawer"
    role={drawerOpen?'dialog':undefined} aria-modal={drawerOpen||undefined}
    aria-label={drawerOpen?'Workspace menu':undefined} onKeyDown={handleDrawerKeys}>
    <div className="workspace-drawer-header">
      <Link className="brand" href="/" aria-label="RestroDock home" onClick={closeDrawer}><BrandLogo/></Link>
      <button ref={closeButton} type="button" className="workspace-drawer-close" aria-label="Close workspace menu" onClick={closeDrawer}><X size={19} aria-hidden="true"/></button>
    </div>
    {themed?<OperationsNavigation path={path} caption={caption} entries={entries} onSelect={closeDrawer}
      others={workspaces.filter(kind=>kind!==current).map(kind=>({kind,label:name(kind),href:kind==='staff'?staffHome(identity):workspacePath[kind]}))}/>
    :<><div className="workspace-label">{permitted?scope:'YOUR WORKSPACES'}</div><nav aria-label="Workspace navigation">{workspaces.flatMap(kind=>{
      const Icon=icons[kind];
      const links=kind==='platform'?platformEntries:
        kind==='staff'?staffNavigation.map(entry=>({...entry,Icon:staffIcons[entry.icon]})):[{href:workspacePath[kind],label:name(kind),Icon}];
      return links.map(entry=>{
        const active=kind===current&&permitted&&entry.href===path;
        const EntryIcon=entry.Icon;
        return <Link key={entry.href} href={entry.href} aria-current={active?'page':undefined} className={active?'nav-link selected':'nav-link'} onClick={closeDrawer}>
          <EntryIcon size={18} aria-hidden="true"/><span>{entry.label}</span>
        </Link>;
      });
    })}</nav></>}
    <p className="workspace-drawer-account">{identity.email}</p>
  </aside>
  <div className="main-wrap" inert={drawerOpen}>
    <header className="topbar">
      <span>{activeLabel}</span>
      <button ref={toggle} type="button" className="restaurant-nav-toggle" aria-label={'Workspace menu, '+activeLabel}
        aria-expanded={drawerOpen} aria-controls="workspace-drawer" onClick={()=>setDrawerOpen(true)}>
        <Menu size={19} aria-hidden="true"/><span>{activeLabel}</span>
      </button>
      <div className="role-account"><span title={identity.email}>{identity.email}</span><button className="text-button" disabled={session?.signingOut} onClick={()=>void session?.signOut()}><LogOut size={15}/>{session?.signingOut?'Signing out…':'Sign out'}</button></div>
    </header>
    <main id="main" tabIndex={-1}>{session?.error&&<p role="alert" className="access-error">{session.error}</p>}{permitted?children:<section className="access-auth"><h1>{workspaces.length?'Workspace access required':'No workspace assigned'}</h1><p>{workspaces.length?'Your account does not have permission for this workspace. Open one of your assigned workspaces.':'Ask your administrator to check your account membership and branch assignment.'}</p>{workspaces.length>0&&<Link className="button primary" href={defaultWorkspace(identity)}>Open my workspace <ArrowRight size={16}/></Link>}</section>}</main>
    {!themed&&<footer>RestroDock<span>Existing POS owns official invoices and payment collection.</span></footer>}
  </div>
 </div>;
}


const platformEntries=[
 {href:'/super-admin',label:labels.platform,Icon:ShieldCheck},
 {href:'/super-admin/registrations',label:'Registration requests',Icon:ClipboardCheck},
 {href:'/super-admin/analytics',label:'Platform Analytics',Icon:ChartNoAxesColumn},
];
const staffIcons={tables:TableProperties,assistance:HandHelping,kitchen:ChefHat,review:ClipboardCheck,billing:ReceiptText,History};
const restaurantEntries=[
 {href:'/restaurant',label:'Overview',Icon:LayoutDashboard},
 ...[...restaurantSections].sort((a,b)=>navigationOrder.indexOf(a.key)-navigationOrder.indexOf(b.key)).map(section=>({...section,Icon:restaurantIcons[section.key]})),
];

function OperationsNavigation({path,caption,entries,others,onSelect}:{path:string;caption:string;entries:readonly {href:string;label:string;Icon:typeof Store}[];others:{kind:Workspace;label:string;href:string}[];onSelect:()=>void}){
 return <nav className="restaurant-nav" aria-label="Workspace navigation">
  <div className="restaurant-nav-caption">{caption}</div>
  {entries.map(({href,label,Icon})=>{
    const active=href===path;
    return <Link key={href} href={href} aria-current={active?'page':undefined} className={`nav-link${active?' selected':''}`} onClick={onSelect}>
      <Icon size={17} aria-hidden="true"/><span>{label}</span>
    </Link>;
  })}
  {others.length>0&&<div className="restaurant-nav-switch"><div className="restaurant-nav-caption">Other workspaces</div>{others.map(({kind,label,href})=>{
    const Icon=icons[kind];
    return <Link className="nav-link" key={kind} href={href} onClick={onSelect}><Icon size={17} aria-hidden="true"/><span>{label}</span></Link>;
  })}</div>}
 </nav>;
}
