import {pageMetadata} from '../../lib/site-metadata';
export const metadata=pageMetadata('Privacy Policy | RestroDock', 'Learn how RestroDock handles restaurant, staff and guest information.', '/privacy');


export default function Privacy(){
 return <article className="public-policy">
  <h1>Privacy</h1>
  <p className="public-policy-note">Draft for review before public launch.</p>
  <h2>Information used by the service</h2>
  <p>Restaurant applications use contact and business details for review and setup. Staff use account details to sign in to their assigned workspaces. Guests provide their name and mobile number when verifying table entry. Orders and bill requests are associated with the table session.</p>
  <h2>Session cookies</h2>
  <p>RestroDock uses session cookies to keep staff signed in and to recognize verified guests at their table.</p>
  <h2>Questions about your information</h2>
  <p>For questions about a guest order or the details supplied at a restaurant, contact that restaurant. Staff should contact their restaurant administrator for account questions.</p>
 </article>;
}
