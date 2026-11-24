import Link from 'next/link';

export default function NotFound(){
 return <section className="boundary-page">
  <h1>Page unavailable</h1>
  <p>Check the address or return to the RestroDock home page.</p>
  <Link className="button primary" href="/">Back to home</Link>
 </section>;
}
