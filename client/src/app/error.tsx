'use client';
export default function ErrorPage({reset}:{reset:()=>void}){return <section className="boundary-page"><h1>The workspace could not load.</h1><p>Try loading this view again.</p><button className="button primary" onClick={reset}>Try again</button></section>;}
