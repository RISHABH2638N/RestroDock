import {pageMetadata} from '../lib/site-metadata';
export const metadata=pageMetadata('QR Ordering and Restaurant Operations | RestroDock', 'Manage table QR ordering, coordinate kitchen and service teams, and track restaurant operations with RestroDock.', '/');
import Link from 'next/link';
import {ArrowRight, ChefHat, QrCode, ReceiptText, ShieldCheck, Workflow, Plug} from 'lucide-react';
import {MenuStory} from '../features/landing/menu-story';
import {Pricing} from '../features/landing/pricing';


const questions = [
 ['Do guests need an account?', 'Guests scan the table QR code to open the menu without an account. In the ordering pilot, a waiter confirms the first order before it reaches the kitchen.'],
 ['Can we keep our current POS?', 'Yes. Your cashier can use the RestroDock order summary to prepare the official invoice in your existing POS.'],
 ['How do we get started?', 'Register your restaurant for review. Once approved, set up your menu, tables and staff in Restaurant Admin.'],
 ['How does annual pricing work?', 'The yearly option shows an equivalent monthly rate and the full charge for 12 months. Plans are assigned by the Platform Admin.'],
 ['Where do my team members sign in?', 'Open Login and select Staff login. Team members use the account they set up through their invitation.'],
];
const features = [
 {icon: QrCode, title: 'No-App Guest Ordering', description: 'Guests scan the table QR and browse the menu. In the ordering pilot, a waiter confirms the first order at the table.', sample: ['Table 07', 'Paneer tikka · 2', 'Order sent'], tone:'ready'},
 {icon: ChefHat, title: 'Kitchen Queue', description: 'A focused ticket view for the kitchen team to move items through Preparing and Ready.', sample: ['Ticket #024', 'Table 07 · 2 items', 'Preparing'], tone:'preparing'},
 {icon: ReceiptText, title: 'Seamless POS Handoff', description: 'Cashiers use a consolidated table summary to issue the official bill in their existing POS.', sample: ['Table 07 summary', '2 items · ₹560 estimate', 'Bill requested'], tone:'neutral'},
];

export default function Home() {
 return <div className="rd-home">
  <section className="rd-home-hero" aria-labelledby="landing-title">
   <div className="rd-enterprise-inner">
    <h1 id="landing-title">Digitize Your Dining Floor.<br/><em>Keep Your Existing POS.</em></h1>
    <p>The all-in-one platform for QR ordering, live kitchen syncing, and seamless cashier handoffs. Built for independent restaurants.</p>
    <div className="landing-actions">
     <Link href="/register" className="landing-button">Register your restaurant <ArrowRight size={18} aria-hidden="true"/></Link>
     <a href="#pricing" className="landing-button rd-outline">View Pricing</a>
    </div>
    <p className="rd-trial-note">Applications are reviewed before activation.</p>
    <figure id="demo" className="rd-device-flow">
     <div className="rd-device-sequence">
      {features.map(({icon:Icon,sample,tone},index)=><div className="rd-device-step" key={tone}>
       <div className={`rd-device rd-device-${tone}`}>
        <div className="rd-device-bar"><Icon size={16} aria-hidden="true"/>{['Guest order','Kitchen queue','Cashier summary'][index]}</div>
        <strong>{sample[0]}</strong><p>{sample[1]}</p><span className="rd-demo-status" data-tone={tone}>{sample[2]}</span>
       </div>
      </div>)}
     </div>
    <figcaption>Illustrative product flow · Sample restaurant, ticket and order data</figcaption>
    </figure>
   </div>
  </section>
  <div className="rd-trust" aria-label="Platform capabilities">
   <span><ShieldCheck size={19} aria-hidden="true"/>Waiter-confirmed first orders</span>
   <span><Workflow size={19} aria-hidden="true"/>Kitchen status updates</span>
   <span><Plug size={19} aria-hidden="true"/>Works alongside your POS</span>
  </div>
  <section className="rd-home-features" id="product" aria-labelledby="product-title">
   <div className="rd-home-section-head"><h2 id="product-title">From table to kitchen to bill</h2><p>See the intended guest, kitchen and cashier flow together. The screens and sample tickets are illustrative; feature availability depends on restaurant setup and rollout.</p></div>
   <div className="rd-home-feature-grid" id="how-it-works">
    {features.map(({icon: Icon, title, description, sample, tone}) => <article key={title}>
     <Icon size={24} strokeWidth={1.7} aria-hidden="true"/>
     <h3>{title}</h3><p>{description}</p>
     <div className="rd-feature-preview"><strong>{sample[0]}</strong><span>{sample[1]}</span><span className="rd-demo-status" data-tone={tone}>{sample[2]}</span></div>
    </article>)}
   </div>
   <details className="rd-menu-demo"><summary>Try the sample QR menu</summary><MenuStory/></details>
  </section>
  <Pricing/>
  <section id="faq" className="rd-home-faq" aria-labelledby="faq-title">
   <div><h2 id="faq-title">Frequently asked questions</h2><p>What to know before setting up your restaurant.</p></div>
   <div>{questions.map(([question,answer])=><details key={question}>
    <summary>{question}</summary><p>{answer}</p>
   </details>)}</div>
  </section>
  <section className="rd-home-close" aria-labelledby="start-title">
   <h2 id="start-title">Stop dropping tickets. Start serving faster.</h2>
   <Link href="/register" className="landing-button">Register your restaurant <ArrowRight size={18} aria-hidden="true"/></Link>
  </section>
 </div>;
}
