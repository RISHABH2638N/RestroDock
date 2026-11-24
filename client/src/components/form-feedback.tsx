'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {z} from 'zod';
import {AccessError,errorText} from '../features/access/api';
export function useFormFeedback(busy:boolean,normalise:(field:string)=>string=(field)=>field){
 const prefix=useId();const form=useRef<HTMLFormElement|null>(null),pending=useRef(false);
 const [state,setState]=useState<{owner:string;issues:{field:string;message:string}[]}>({owner:'',issues:[]});
 const id=(field:string)=>`${prefix}-${field.replaceAll('.','-')}`;
 function report(element:HTMLFormElement,error:unknown){const issues=error instanceof z.ZodError?error.issues.map(issue=>({field:normalise(issue.path.join('.')),message:issue.message})):error instanceof AccessError&&error.fields.length?error.fields.map(issue=>({field:normalise(issue.field),message:issue.message})):[{field:error instanceof SyntaxError?'rows':'',message:errorText(error)}];form.current=element;pending.current=true;setState({owner:element.dataset.validation??'',issues});}
 useEffect(()=>{if(busy||!pending.current||!form.current)return;pending.current=false;const first=state.issues[0];const target=first?.field?form.current.elements.namedItem(first.field):null;if(target instanceof HTMLElement)target.focus();else (form.current.querySelector('[data-form-errors]') as HTMLElement|null)?.focus();},[state,busy]);
 return {state,id,report,clear:()=>{pending.current=false;setState({owner:'',issues:[]});},props:(owner:string,field:string)=>state.owner===owner&&state.issues.some(issue=>issue.field===field)?{'aria-invalid':true as const,'aria-describedby':id(field)}:{}};
}
export function FormErrorSummary({feedback,owner}:{feedback:ReturnType<typeof useFormFeedback>;owner:string}){if(feedback.state.owner!==owner||!feedback.state.issues.length)return null;const grouped=new Map<string,string[]>();for(const issue of feedback.state.issues)grouped.set(issue.field,[...(grouped.get(issue.field)??[]),issue.message]);return <div role="alert" tabIndex={-1} data-form-errors className="access-error"><p>Check these fields:</p><ul>{[...grouped].map(([field,messages])=><li id={feedback.id(field)} key={field}>{messages.join(' ')}</li>)}</ul></div>;}
