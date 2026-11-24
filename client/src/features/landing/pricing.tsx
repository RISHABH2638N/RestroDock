'use client';

import Link from 'next/link';
import {useState} from 'react';
import {ArrowRight} from 'lucide-react';

const plans = [
 {name: 'Starter', monthly: 999, yearlyMonthly: 799, audience: 'The essentials for one restaurant outlet.', includes: ['1 outlet', 'Table QR ordering', 'Kitchen queue', 'Existing POS handoff']},
 {name: 'Growth', monthly: 1499, yearlyMonthly: 1299, audience: 'More insight and control for one growing outlet.', includes: ['Everything in Starter', 'Detailed analytics', 'Manager approval thresholds']},
 {name: 'Pro', monthly: 1999, yearlyMonthly: 1799, audience: 'A shared view across a small restaurant group.', includes: ['Everything in Growth', 'Up to 3 outlets', 'Branch-level reporting']},
];
const format = new Intl.NumberFormat('en-IN');

export function Pricing() {
 const [yearly, setYearly] = useState(false);

 return <section className="rd-home-pricing" id="pricing" aria-labelledby="pricing-title">
  <div className="rd-home-section-head">
   <h2 id="pricing-title">Find your plan</h2>
   <p>Compare monthly and yearly prices before applying.</p>
  </div>
  <fieldset className="rd-home-period">
   <legend className="sr-only">Billing period</legend>
   <label><input type="radio" name="billing-period" checked={!yearly} onChange={() => setYearly(false)}/>Monthly</label>
   <label><input type="radio" name="billing-period" checked={yearly} onChange={() => setYearly(true)}/>Annually <span>Save ₹2,400/year</span></label>
  </fieldset>
  <div className="rd-home-plans" aria-live="polite">
   {plans.map(plan => <article key={plan.name} className="rd-home-plan">
    <h3>{plan.name}{plan.name==='Growth'&&<span className="rd-plan-pick">Recommended</span>}</h3>
    <p>{plan.audience}</p>
    <div className="rd-home-price">₹{format.format(yearly ? plan.yearlyMonthly : plan.monthly)}<span> / month</span></div>
    <p>{yearly ? `₹${format.format(plan.yearlyMonthly * 12)} billed yearly` : 'Billed monthly'}</p>
    <ul aria-label={`${plan.name} plan includes`}>
     {plan.includes.map(item => <li key={item}>{item}</li>)}
    </ul>
   </article>)}
  </div>
  <div className="rd-home-pricing-action">
   <Link href="/register" className="landing-button">Apply for restaurant access <ArrowRight size={18} aria-hidden="true"/></Link>
   <p>Applications are reviewed before account activation.</p>
  </div>
 </section>;
}
