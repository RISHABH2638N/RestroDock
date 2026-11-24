import {pageMetadata} from '../../lib/site-metadata';
export const metadata=pageMetadata('Terms and Conditions | RestroDock', 'Read the terms for using RestroDock’s restaurant ordering and operations tools.', '/terms');


export default function Terms(){
 return <article className="public-policy">
  <h1>Terms &amp; Conditions</h1>
  <p className="public-policy-note">Draft for review before public launch.</p>
  <h2>Restaurant accounts</h2>
  <p>Use the service for restaurants you are authorized to manage. Keep sign-in details and invitation links private. Restaurant administrators manage staff access and keep menu prices, availability and restaurant details current.</p>
  <h2>Guest ordering</h2>
  <p>Use a table QR code and PIN only for the dining session staff assign to you. Do not place fraudulent orders, interfere with service or attempt to access another restaurant’s information.</p>
  <h2>Pricing and billing</h2>
  <p>RestroDock displays subscription prices and tracks manually assigned plans. Confirm payment and renewal terms with the service operator. The restaurant issues its official invoice and handles payment through its existing POS. Order estimates can differ from that invoice.</p>
  <h2>Support</h2>
  <p>For questions about an order or bill, contact the restaurant. For staff access, contact your restaurant administrator.</p>
 </article>;
}
