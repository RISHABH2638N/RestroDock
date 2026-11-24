'use client';
import {useState} from 'react';
import {Anchor, Check} from 'lucide-react';
const examples={
 'Small plates':[{name:'Paneer tikka',description:'Charred peppers, mint chutney',price:'₹280',type:'Vegetarian'},{name:'Hara bhara kebab',description:'Spinach, peas, toasted spices',price:'₹220',type:'Vegetarian'},{name:'Chicken malai tikka',description:'Creamy marinade, tandoor finish',price:'₹340',type:'Non-vegetarian'}],
 'From the kitchen':[{name:'Dal tadka',description:'Yellow lentils, cumin tempering',price:'₹240',type:'Vegetarian'},{name:'Dum biryani',description:'Seasonal vegetables, fragrant rice',price:'₹320',type:'Vegetarian'}]
};
export function MenuStory(){
 const [category,setCategory]=useState<keyof typeof examples>('Small plates');
 return <figure className="menu-story" aria-labelledby="menu-story-caption"><div className="menu-story-top"><span><Anchor size={19}/> Your restaurant</span><span>Menu editor</span></div><div className="menu-story-sheet"><div className="menu-story-title"><div><h2>Menu preview</h2><p>Browse sample dishes by category.</p></div></div><div className="menu-story-filters" role="group" aria-label="Illustrative menu categories">{(Object.keys(examples) as (keyof typeof examples)[]).map(name=><button key={name} type="button" aria-pressed={category===name} onClick={()=>setCategory(name)}>{name}</button>)}</div><div className="menu-story-items" aria-live="polite" aria-atomic="true">{examples[category].map(item=><div className="menu-story-item" key={item.name}><div><span className="menu-story-food"><span aria-hidden="true" className={`menu-story-food-mark ${item.type==='Vegetarian'?'veg':'non-veg'}`}/>{item.type}</span><h3>{item.name}</h3><p>{item.description}</p></div><strong>{item.price}</strong></div>)}</div><div className="menu-story-bottom"><Check size={15}/> Categories, options & availability</div></div><figcaption id="menu-story-caption">Illustrative menu · Sample items and INR estimates. No orders are placed.</figcaption></figure>;
}
