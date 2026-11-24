'use client';
import {z} from 'zod';
import {useFormFeedback as useSharedFormFeedback} from '../../components/form-feedback';
import {rupeesToMinor} from '@restrodock/contracts';
import {errorText} from '../access/api';
function controlName(path:string){
 const hours=/^hours\.(\d+)(?:\.(opens|closes|closed|closesNextDay))?/.exec(path);
 if(hours)return `${hours[2]==='opens'?'opens':hours[2]==='closed'?'closed':hours[2]==='closesNextDay'?'next':'closes'}-${hours[1]}`;
 if(path==='hours')return 'opens-0';
 if(path==='priceMinor')return 'price';
 if(path==='maxOrderValueMinor')return 'maxOrderValue';
 if(path==='variants'||path==='addons')return path+'.0.price';
 return path.replace(/\.priceMinor$/,'.price');
}
export function moneyInput(value:string,path:(string|number)[]){try{return rupeesToMinor(value);}catch(error){throw new z.ZodError([{code:'custom',path,message:errorText(error)}]);}}
export {FormErrorSummary} from '../../components/form-feedback';
export function useFormFeedback(busy:boolean){return useSharedFormFeedback(busy,controlName);}
