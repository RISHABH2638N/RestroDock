'use client';

import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {
 checkoutReceiptSchema,checkoutRequestSchema,maxCartLines,maxCartQuantity,maxLineQuantity,maxNoteLength,
 type CheckoutRequest,type GuestView,type QrContext,
} from '@restrodock/contracts';
import {ArrowRight, BellRing, Minus, Plus, Search, ShoppingBag} from 'lucide-react';
import {OrderTracker} from './order-tracker';
import {AccessError,accessRequest,errorText} from '../access/api';
import {
 clearCartDraft,estimateLine,formatEstimate,readCartDraft,saveCartDraft,secureRandomUuid,type DraftLine,type MenuItem,
} from './cart-draft';
import {clearCheckoutState,readCheckoutState,saveCheckoutState,type CheckoutState} from './checkout-storage';

function LineEditor({item,line,limit,onSave,onCancel}:{
 item:MenuItem;
 line:DraftLine|undefined;
 limit:number;
 onSave:(selection:Omit<DraftLine,'id'|'itemId'>)=>void;
 onCancel:()=>void;
}){
 const firstVariant=item.variants.find(option=>option.available)?.name??null;
 const [variant,setVariant]=useState(line?.variant&&item.variants.some(option=>option.name===line.variant&&option.available)?line.variant:firstVariant);
 const [addons,setAddons]=useState(line?.addons.filter(name=>item.addons.some(option=>option.name===name&&option.available))??[]);
 const [quantity,setQuantity]=useState(String(line?.quantity??1));
 const [note,setNote]=useState(line?.note??'');
 const formId=useId();
 const count=Number(quantity);
 const validQuantity=Number.isInteger(count)&&count>=1&&count<=limit;
 const amount=validQuantity?estimateLine(item,{variant,addons,quantity:count}):null;

 function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(amount!==null)onSave({variant,addons,quantity:count,note:note.trim()});
 }

 return <form className="guest-line-editor" onSubmit={submit}>
  <h4>{line?'Edit':'Customize'} {item.name}</h4>
  {item.variants.length>0&&<fieldset>
   <legend>Portion</legend>
   {item.variants.map(option=><label key={option.name} className="guest-option">
    <input type="radio" name={formId} checked={variant===option.name} disabled={!option.available}
     onChange={()=>setVariant(option.name)}/>
    <span>{option.name} · {formatEstimate(option.priceMinor)}{option.available?'':' · Sold out'}</span>
   </label>)}
  </fieldset>}
  {item.addons.length>0&&<fieldset>
   <legend>Add-ons per item</legend>
   {item.addons.map(option=><label key={option.name} className="guest-option">
    <input type="checkbox" checked={addons.includes(option.name)} disabled={!option.available}
     onChange={event=>setAddons(event.target.checked?[...addons,option.name]:addons.filter(name=>name!==option.name))}/>
    <span>{option.name} · +{formatEstimate(option.priceMinor)}{option.available?'':' · Sold out'}</span>
   </label>)}
  </fieldset>}
  <div>
   <label className="guest-field" htmlFor={formId+'-quantity'}>Quantity</label>
   <div className="guest-quantity-control">
    <button type="button" className="button secondary" aria-label="Decrease quantity" disabled={!validQuantity||count<=1} onClick={()=>setQuantity(String(count-1))}><Minus size={17} aria-hidden="true"/></button>
    <input id={formId+'-quantity'} type="number" inputMode="numeric" min={1} max={limit} step={1} required
     aria-describedby={formId+'-quantity-range'} value={quantity} onChange={event=>setQuantity(event.target.value)}/>
    <button type="button" className="button secondary" aria-label="Increase quantity" disabled={!validQuantity||count>=limit} onClick={()=>setQuantity(String(count+1))}><Plus size={17} aria-hidden="true"/></button>
   </div>
   <small id={formId+'-quantity-range'} className="guest-item-detail">Choose 1 to {limit}.</small>
  </div>
  <label className="guest-field">Preparation note (optional)
   <textarea rows={2} maxLength={maxNoteLength} value={note} onChange={event=>setNote(event.target.value)}
    placeholder="For example, mild spice"/>
  </label>
  <div className="guest-editor-actions">
   <button type="submit" className="button primary">
    {line?'Save changes':'Add to cart'}{amount===null?'':' · '+formatEstimate(amount)}
   </button>
   <button type="button" className="button secondary" onClick={onCancel}>Cancel</button>
  </div>
 </form>;
}

function isSelectable(item:MenuItem){
 return item.available&&(!item.variants.length||item.variants.some(option=>option.available));
}

const editableRejections=['CHECKOUT_MENU_CHANGED','CHECKOUT_QUANTITY_LIMIT','CHECKOUT_VALUE_LIMIT','CHECKOUT_SESSION_LIMIT','CHECKOUT_PAUSED','CHECKOUT_RATE_LIMIT'];

export function MenuCart({context,guest,onRefresh,onVerify,draftId,readOnly=false}:{context:QrContext;guest:GuestView|null;onRefresh:()=>void;onVerify?:(submit:(guest:GuestView)=>void)=>void;draftId?:string;readOnly?:boolean}){
 const cartId=guest?.cartId;
 const storageId=readOnly?undefined:cartId??(context.deferredVerification?draftId:undefined);
 const cartAvailable=!readOnly&&(!!cartId||!!context.deferredVerification);
 const [category,setCategory]=useState('');
 const [search,setSearch]=useState('');
 const [lines,setLines]=useState<DraftLine[]>(()=>{
  const saved=storageId?readCartDraft():null;
  return saved&&saved.cartId===storageId?saved.lines:[];
 });
 const [editing,setEditing]=useState<string|number|null>(null);
 const [notice,setNotice]=useState('');
 const [canSave,setCanSave]=useState(true);
 const [checkout,setCheckout]=useState<CheckoutState|null>(()=>{
  const saved=cartId?readCheckoutState():null;
  return saved?.cartId===cartId?saved:null;
 });
 const [submitting,setSubmitting]=useState(false);
 const [checkoutError,setCheckoutError]=useState('');
 const [menuChanged,setMenuChanged]=useState(false);
 const submitInFlight=useRef(false);
 const receiptHeading=useRef<HTMLHeadingElement>(null);
 const errorMessage=useRef<HTMLParagraphElement>(null);
 const cartHeading=useRef<HTMLHeadingElement>(null);
 const cartShortcut=useRef<HTMLButtonElement>(null);
 const editingTrigger=useRef<HTMLButtonElement>(null);

 useEffect(()=>{
  if(storageId)setCanSave(saveCartDraft(storageId,lines));
 },[storageId,lines]);
 useEffect(()=>{
  const saved=readCheckoutState();
  if(cartId&&saved&&saved.cartId!==cartId)clearCheckoutState();
 },[cartId]);
 useEffect(()=>{setMenuChanged(false);setCheckoutError('');},[context.items]);
 useEffect(()=>{
  if(checkout?.status==='confirmed')receiptHeading.current?.focus();
 },[checkout]);
 useEffect(()=>{
  if(checkoutError)errorMessage.current?.focus();
 },[checkoutError]);

 const query=search.trim().toLowerCase();
 const visible=context.items.filter(item=>(!category||category===item.categoryId)
  &&(!query||[item.name,item.description].some(text=>text.toLowerCase().includes(query))));
 const menu=new Map(context.items.map(item=>[item.id,item]));
 const pending=checkout?.status==='pending'?checkout.request:null;
 const estimates=lines.map(line=>({line,item:menu.get(line.itemId),amount:estimateLine(menu.get(line.itemId),line)}));
 const cartRows=pending?pending.lines.map(({expectedUnitPriceMinor,...line},index)=>({
  line:{...line,id:index+1},item:menu.get(line.itemId),amount:expectedUnitPriceMinor*line.quantity,
 })):estimates;
 const quantity=cartRows.reduce((sum,row)=>sum+row.line.quantity,0);
 const total=cartRows.reduce((sum,row)=>sum+(row.amount??0),0);
 const needsReview=!pending&&estimates.some(row=>row.amount===null);
 const availableSpace=maxCartQuantity-quantity;
 const canAdd=lines.length<maxCartLines&&availableSpace>0;

 const [assistance,setAssistance]=useState('');
 const [asking,setAsking]=useState(false);
 async function requestAssistance(){
  if(!guest?.orderingEnabled||asking)return;
  setAsking(true);setAssistance('');
  try{
   const result=await accessRequest('/guest/assistance',{method:'POST',csrf:guest.csrfToken,body:{}});
   if(!result||typeof result!=='object'||!('saved' in result)||result.saved!==true)throw Error('Could not confirm the request.');
   setAssistance('Help requested. Please give staff a moment.');
  }catch(error){setAssistance(errorText(error));}
  finally{setAsking(false);}
 }
 const receiptOnly=checkout?.status==='confirmed'&&lines.length===0;
 const canSubmit=(guest?.orderingEnabled??!!onVerify)&&(!!pending||!!lines.length&&!needsReview&&!menuChanged&&editing===null);

 async function submitOrder(verified:GuestView|null=guest){
  if(!canSubmit||submitInFlight.current)return;
  if(!verified){onVerify?.(value=>void submitOrder(value));return;}
  if(!verified.orderingEnabled)return;
  let request:CheckoutRequest;
  if(pending)request=pending;
  else{
   const key=secureRandomUuid();
   if(!key){
    setCheckoutError('This browser cannot securely create an order attempt. Try an updated browser or ask staff for help.');
    return;
   }
   const parsed=checkoutRequestSchema.safeParse({
    key,cartId:verified.cartId,
    lines:estimates.map(({line,amount})=>({
     itemId:line.itemId,variant:line.variant,addons:line.addons,quantity:line.quantity,note:line.note,
     expectedUnitPriceMinor:amount===null?-1:amount/line.quantity,
    })),
   });
   if(!parsed.success||new TextEncoder().encode(JSON.stringify(parsed.data)).length>16*1024){
    setCheckoutError('This cart is too large to submit. Remove some selections or shorten your notes.');
    return;
   }
   request=parsed.data;
  }
  const attempt={status:'pending',cartId:verified.cartId,request} as const;
  if(!saveCheckoutState(attempt)){
   setCheckoutError('This tab could not save the checkout attempt. Enable tab storage or ask staff for help.');
   return;
  }
  submitInFlight.current=true;
  setSubmitting(true);
  setCheckoutError('');
  setCheckout(attempt);
  const ownsAttempt=()=>{
   const saved=readCheckoutState();
   return saved?.status==='pending'&&saved.cartId===verified.cartId&&saved.request.key===request.key;
  };
  try{
   const receipt=checkoutReceiptSchema.parse(await accessRequest('/guest/orders',{method:'POST',csrf:verified.csrfToken,body:request}));
   if(!ownsAttempt())return;
   const confirmation={status:'confirmed',cartId:verified.cartId,receipt} as const;
   clearCartDraft();
   saveCheckoutState(confirmation);
   setLines([]);
   setCheckout(confirmation);
  }catch(error){
   if(!ownsAttempt())return;
   if(error instanceof AccessError&&editableRejections.includes(error.code)){
    clearCheckoutState();
    setCheckout(null);
    setMenuChanged(error.code==='CHECKOUT_MENU_CHANGED');
    setCheckoutError(errorText(error));
   }else{
    setCheckoutError(error instanceof AccessError&&[401,403,404].includes(error.status)
     ?'Could not confirm this order. Ask staff to check the attempt before submitting again.'
     :'Could not confirm this order. Retry this same submission to check whether it was saved.');
   }
  }finally{
   submitInFlight.current=false;
   setSubmitting(false);
  }
 }

 function goTo(heading:HTMLHeadingElement|null){
  heading?.focus();
  heading?.scrollIntoView?.({block:'start'});
 }

 function editLine(item:MenuItem,line?:DraftLine){
  return <LineEditor key={line?.id??item.id} item={item} line={line}
   limit={Math.min(maxLineQuantity,availableSpace+(line?.quantity??0))}
   onCancel={()=>{setEditing(null);editingTrigger.current?.focus();}}
   onSave={selection=>{
    const updated={...selection,itemId:item.id,id:line?.id??Math.max(0,...lines.map(row=>row.id))+1};
    setLines(line?lines.map(row=>row.id===line.id?updated:row):[...lines,updated]);
    setEditing(null);
    setNotice(line?'Cart item updated.':item.name+' added to your cart.');
    const reachesLimit=!line&&(lines.length+1===maxCartLines||quantity+selection.quantity===maxCartQuantity);
    (reachesLimit?cartShortcut:editingTrigger).current?.focus();
   }}/>;
 }

 return <section className="guest-menu guest-cart-workspace">
  <div className="guest-menu-header">
   <h2>Restaurant menu</h2>
   {guest?.orderingEnabled&&!guest.awaitingWaiter&&context.assistanceEnabled&&<button type="button" className="button secondary" disabled={asking} onClick={()=>void requestAssistance()}><BellRing size={17} aria-hidden="true"/> Request staff help</button>}
   {assistance&&<p role="status">{assistance}</p>}
  </div>
   {cartAvailable&&<button ref={cartShortcut} type="button" className="button guest-cart-shortcut" onClick={()=>goTo(receiptOnly?receiptHeading.current:cartHeading.current)}>
    <ShoppingBag size={19} aria-hidden="true"/> <span>{receiptOnly?'Track your order':`View cart · ${quantity} · ${formatEstimate(total)}`}</span> <ArrowRight size={18} aria-hidden="true"/>
   </button>}
  {notice&&<p className="sr-only" role="status">{notice}</p>}
  <div className={cartAvailable?'guest-menu-layout guest-menu-layout-with-cart':'guest-menu-layout'}>
   <div className="guest-menu-catalogue">
    {context.items.length>0&&<>
     <label className="guest-field guest-search"><span className="sr-only">Search menu</span><Search size={19} aria-hidden="true"/>
      <input type="search" placeholder="Search dishes" value={search} onChange={event=>{setSearch(event.target.value);setEditing(null);}}/>
     </label>
     <div className="guest-category-filter" role="group" aria-label="Menu categories">
      {[{id:'',name:'All categories'},...context.categories].map(group=><button
       key={group.id} type="button" className="button secondary" aria-pressed={category===group.id}
       onClick={()=>{setCategory(group.id);setEditing(null);}}>{group.name}</button>)}
     </div>
    </>}
    {context.items.length===0?<p className="guest-menu-empty">No reviewed menu items have been published yet.</p>
     :visible.length===0?<p className="guest-menu-empty">No items match these filters.</p>
     :context.categories.map(group=>{
      const items=visible.filter(item=>item.categoryId===group.id);
      return items.length>0&&<section key={group.id}>
       <h3>{group.name}</h3>
       <ul>{items.map(item=>{
        const selectable=isSelectable(item);
        const availableVariants=item.variants.filter(option=>option.available);
        const startingPrice=availableVariants.length?Math.min(...availableVariants.map(option=>option.priceMinor)):item.priceMinor;
        return <li key={item.id} className="guest-menu-item">
         <div className="guest-item-row">
          <div><p className="guest-diet" data-diet={item.foodType}>{item.foodType==='NON_VEG'?'Non-vegetarian':item.foodType==='VEG'?'Vegetarian':item.foodType}</p>
           <h4>{item.name}</h4>
           {item.description&&<p>{item.description}</p>}
           {!selectable&&<p className="guest-sold-out">Sold out</p>}
           {!cartId&&item.variants.length>0&&<p className="guest-item-detail">Portions: {item.variants.map(option=>option.name+' '+formatEstimate(option.priceMinor)+(option.available?'':' (sold out)')).join(' · ')}</p>}
           {!cartId&&item.addons.length>0&&<p className="guest-item-detail">Add-ons: {item.addons.map(option=>option.name+' +'+formatEstimate(option.priceMinor)+(option.available?'':' (sold out)')).join(' · ')}</p>}
          </div>
          <div className="guest-item-action">
           <strong className="guest-price">{availableVariants.length?'From ':''}{formatEstimate(startingPrice)}</strong>
           {cartAvailable&&selectable&&<button type="button" className="button secondary"
            aria-label={'Customize '+item.name} aria-expanded={editing===item.id} disabled={!canAdd||!!pending}
            onClick={event=>{editingTrigger.current=event.currentTarget;setEditing(editing===item.id?null:item.id);}}><Plus size={16} aria-hidden="true"/> Customize</button>}
          </div>
         </div>
         {cartAvailable&&selectable&&editing===item.id&&editLine(item)}
        </li>;
       })}</ul>
      </section>;
     })}
   </div>
   {cartAvailable&&<aside className="guest-cart" aria-labelledby="guest-cart-title">
    <h3 id="guest-cart-title" ref={cartHeading} tabIndex={-1}>Your cart</h3>
    {guest?.orderingEnabled&&<OrderTracker key={guest.cartId} guest={guest}
     receipt={checkout?.status==='confirmed'?checkout.receipt:null} heading={receiptHeading}/>}
    {!cartRows.length&&!receiptOnly&&<div className="guest-empty-cart"><ShoppingBag size={24} aria-hidden="true"/><p>Add dishes from the menu to start your order.</p></div>}
    {!canSave&&<p className="guest-waiting">Tab storage is unavailable. Refreshing may clear this draft.</p>}
    {!canAdd&&!pending&&<p>Cart limit reached. Edit or remove an item to add more.</p>}
    {needsReview&&<p className="guest-waiting">Review unavailable selections. They are excluded from the estimate.</p>}
    <ul>{cartRows.map(({item,line,amount})=><li className="guest-cart-line" key={line.id}>
     <div className="guest-cart-line-summary">
      <strong>{line.quantity} × {item?.name??(pending?'Menu item':'Removed menu item')}</strong>
      {amount===null?<p className="guest-sold-out">Selection unavailable</p>:<strong className="guest-price">{formatEstimate(amount)}</strong>}
     </div>
     {(line.variant||line.addons.length>0)&&<p>{[line.variant,...line.addons].filter(Boolean).join(' · ')}</p>}
     {line.note&&<p className="guest-item-detail">Note: {line.note}</p>}
     {!pending&&<div className="guest-editor-actions">
      {item&&isSelectable(item)&&<button type="button" className="button secondary"
       aria-expanded={editing===line.id} aria-label={'Edit '+item.name}
       onClick={event=>{editingTrigger.current=event.currentTarget;setEditing(editing===line.id?null:line.id);}}>Edit</button>}
      <button type="button" className="button secondary" aria-label={'Remove '+(item?.name??'menu item')}
       onClick={()=>{setLines(lines.filter(row=>row.id!==line.id));setEditing(null);setNotice('Item removed from cart.');goTo(cartHeading.current);}}>Remove</button>
     </div>}
     {!pending&&item&&isSelectable(item)&&editing===line.id&&editLine(item,line)}
    </li>)}</ul>
    {!receiptOnly&&<>
     <div className="guest-cart-total"><strong>{pending?'Estimate for this attempt':'Estimated total'}</strong><strong className="guest-price">{formatEstimate(total)}</strong></div>
     <p className="guest-item-detail">{pending?'Retry uses these selections and this estimate.':'The restaurant provides the final bill.'}</p>
    </>}
    {(guest?.orderingEnabled||onVerify||pending)&&<div className="guest-checkout-actions">
     {checkoutError&&<p className="access-error" role="alert" tabIndex={-1} ref={errorMessage}>{checkoutError}</p>}
     {pending&&!checkoutError&&!submitting&&<p>There is an unconfirmed submission. Retry it before changing this cart.</p>}
     {pending&&!guest?.orderingEnabled&&<p>Checkout is unavailable. Ask staff before starting another order.</p>}
     {guest?.orderingEnabled&&lines.length>0&&!pending&&<p>Orders that need approval are reviewed by restaurant staff.</p>}
     {menuChanged&&<button className="button secondary" type="button" onClick={()=>{setMenuChanged(false);setCheckoutError('');onRefresh();}}>Refresh menu</button>}
     {(guest?.orderingEnabled||onVerify)&&(lines.length>0||pending)&&<button className="button primary" type="button"
      disabled={!canSubmit||submitting} onClick={()=>void submitOrder()}>
      {submitting?'Submitting order…':pending?'Retry same submission':guest?'Submit order':'Place order'}
     </button>}
    </div>}
   </aside>}
  </div>
 </section>;
}
