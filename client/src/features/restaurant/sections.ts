export const restaurantSections = [
  {key:'profile', href:'/restaurant/profile', label:'Profile', description:'Manage your restaurant identity, contact details and branch location.'},
  {key:'hours', href:'/restaurant/hours', label:'Hours', description:'Set the weekly opening hours for this branch.'},
  {key:'safety-pos', href:'/restaurant/safety-pos', label:'Safety & POS', description:'Manage order limits, table PIN validity and the handoff to your billing system.'},
  {key:'staff', href:'/restaurant/staff', label:'Manage staff', description:'Review branch assignments and invite staff with the right role.'},
  {key:'menu', href:'/restaurant/menu', label:'Menu', description:'Manage categories, items, prices and availability.'},
  {key:'menu-preview', href:'/restaurant/menu-preview', label:'Menu preview', description:'Review the published menu for this branch.'},
  {key:'order-review', href:'/restaurant/order-review', label:'Order review', description:'Confirm orders and manage intake.'},
  {key:'tables', href:'/restaurant/tables', label:'Tables & QR', description:'Print table QR cards and manage active sessions.'},
  {key:'audit', href:'/restaurant/audit', label:'Audit log', description:'Review recent activity for the selected branch.'},
  {key:'analytics', href:'/restaurant/analytics', label:'Analytics', description:'Branch reporting.'},
] as const;

export type RestaurantSection = (typeof restaurantSections)[number]['key'];
export type RestaurantSettingsSection = Exclude<RestaurantSection,'tables'|'order-review'>;
export type RestaurantEditorSection = Exclude<RestaurantSettingsSection,'analytics'|'audit'>;
