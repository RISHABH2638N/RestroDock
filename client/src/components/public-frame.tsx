'use client';
import {useRef,useState} from 'react';
import Link from 'next/link';
import {BrandLogo} from './brand-logo';
import {ArrowUpRight, Menu} from 'lucide-react';

export function PublicFrame({children,guest=false}:{children:React.ReactNode;guest?:boolean}) {
 const [open,setOpen]=useState(false);
 const toggle=useRef<HTMLButtonElement>(null);
 if(guest)return <div className="public-site guest-site">
  <a className="skip-link" href="#main">Skip to content</a>
  <main id="main" tabIndex={-1} className="public-main">{children}</main>
  <footer className="guest-footer"><Link href="/">RestroDock</Link><Link href="/privacy">Privacy Policy</Link></footer>
 </div>;
 function closeMenu(){
  if(open)toggle.current?.focus();
  setOpen(false);
 }
 return <div className="public-site">
  <a className="skip-link" href="#main">Skip to content</a>
  <header className="public-header" onKeyDown={event=>{if(event.key==='Escape')closeMenu();}}>
   <Link href="/" className="public-brand" aria-label="RestroDock home"><BrandLogo/></Link>
   <button className="public-nav-toggle" type="button" ref={toggle} aria-expanded={open} aria-controls="public-navigation" onClick={()=>setOpen(value=>!value)}>
    <Menu size={18} aria-hidden="true"/> Menu
   </button>
   <nav id="public-navigation" aria-label="Public navigation" data-open={open} onClick={event=>{if(event.target instanceof Element&&event.target.closest('a'))closeMenu();}}>
    <Link href="/#product">Features</Link>
    <Link href="/#how-it-works">How it Works</Link>
    <Link href="/#pricing">Pricing</Link>
    <Link href="/sign-in" className="public-nav-login">Log in <ArrowUpRight size={16} aria-hidden="true"/></Link>
    <Link href="/#demo" className="rd-nav-demo">View Demo</Link>
   </nav>
  </header>
  <main id="main" tabIndex={-1} className="public-main">{children}</main>
  <footer className="public-footer">
   <div><Link href="/" className="public-brand"><BrandLogo/></Link><p>QR ordering and restaurant operations.</p></div>
   <nav aria-label="Footer navigation">
    <Link href="/#how-it-works">Getting started</Link><Link href="/#pricing">Pricing</Link>
    <Link href="/terms">Terms &amp; Conditions</Link><Link href="/privacy">Privacy Policy</Link>
    <Link href="/sign-in?portal=platform">Platform Admin Login</Link><Link href="/sign-in?portal=restaurant">Restaurant Admin Login</Link><Link href="/#faq">Support</Link>
   </nav>
  </footer>
 </div>;
}
