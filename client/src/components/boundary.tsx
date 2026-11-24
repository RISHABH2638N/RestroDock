import Link from 'next/link';
import { LockKeyhole, ArrowLeft } from 'lucide-react';
export function Boundary({title,description,day}:{title:string;description:string;day:string}) {
 return <section className="boundary-page"><LockKeyhole size={30}/><h1>{title}</h1><p>{description}</p><div className="boundary-detail"><h2>Planned for {day}</h2><p>Day 1 provides the application foundation. This route does not authenticate users, load private tenant records or accept operational actions.</p></div><Link className="button primary" href="/"><ArrowLeft size={16}/>Back to workspace</Link></section>;
}
