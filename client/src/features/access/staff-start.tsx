'use client';

import Link from 'next/link';
import {useEffect} from 'react';
import {useRouter} from 'next/navigation';
import {SessionGate} from './session';
import {assignedMemberships,isStaffRole,staffHome} from './policy';

export function StaffStart(){
 return <SessionGate showSessionBar={false}>{identity=>{
  const destination=staffHome(identity);
  if(destination!=='/staff')return <OpenWorkspace href={destination}/>;
  const hasBranch=assignedMemberships(identity).some(member=>isStaffRole(member.role)&&member.access.length>0);
  return <section className="access-empty">
   <h1>{hasBranch?'Branch not active':'No staff branch assigned'}</h1>
   <p>{hasBranch?'Ask your restaurant administrator to activate your branch.':'Ask your restaurant administrator for a branch assignment.'}</p>
  </section>;
 }}</SessionGate>;
}

function OpenWorkspace({href}:{href:string}){
 const router=useRouter();
 useEffect(()=>router.replace(href),[href,router]);
 return <p role="status" className="access-note"><Link href={href}>Open your workspace</Link></p>;
}
