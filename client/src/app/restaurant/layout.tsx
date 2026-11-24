import type {ReactNode} from 'react';
import '../restaurant-admin.css';

export default function RestaurantLayout({children}:{children:ReactNode}){
 return <div className="rd-admin-route">{children}</div>;
}
