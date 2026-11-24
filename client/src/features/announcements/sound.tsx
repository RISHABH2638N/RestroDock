'use client';

import {useEffect,useId,useRef,useState} from 'react';

export function useServiceSound(){
 const [voices,setVoices]=useState<SpeechSynthesisVoice[]>([]);
 const [voiceId,setVoiceId]=useState('');
 const [enabled,setEnabled]=useState(false);
 const [error,setError]=useState('');
 const selectId=useId();
 const synth=useRef<SpeechSynthesis|null>(null);
 const queue=useRef(new Set<SpeechSynthesisUtterance>());
 const heard=useRef(new Set<string>());

 useEffect(()=>{
  const speaker=window.speechSynthesis;
  if(!speaker)return;
  synth.current=speaker;
  const load=()=>setVoices(speaker.getVoices().filter(voice=>/^hi(?:-|$)/i.test(voice.lang)));
  load();
  speaker.addEventListener('voiceschanged',load);
  const pending=queue.current;
  return ()=>{
   speaker.removeEventListener('voiceschanged',load);
   if(pending.size)speaker.cancel();
   pending.clear();
   synth.current=null;
  };
 },[]);

 const voice=voices.find(item=>item.voiceURI===voiceId)??voices[0];

 function speak(text:string){
  if(!voice||!synth.current||queue.current.size>=12)return;
  const utterance=new SpeechSynthesisUtterance(text);
  utterance.voice=voice;
  utterance.lang=voice.lang;
  utterance.onend=()=>queue.current.delete(utterance);
  utterance.onerror=event=>{
   queue.current.delete(utterance);
   if(event.error!=='canceled'&&event.error!=='interrupted'){
    setError('Sound could not play. Check your device voice settings and try again.');
    setEnabled(false);
    if(queue.current.size)synth.current?.cancel();
    queue.current.clear();
   }
  };
  queue.current.add(utterance);
  synth.current.speak(utterance);
 }

 function receive(event:unknown){
  if(!enabled||!event||typeof event!=='object'||!('id' in event)||!('text' in event)||
   typeof event.id!=='string'||typeof event.text!=='string'||event.text.length>6000||heard.current.has(event.id))return;
  if(heard.current.size>=200){
   const oldest=heard.current.values().next().value;
   if(oldest)heard.current.delete(oldest);
  }
  heard.current.add(event.id);
  speak(event.text);
 }

 function toggle(){
  setError('');
  if(enabled){
   if(queue.current.size)synth.current?.cancel();
   queue.current.clear();
   setEnabled(false);
   return;
  }
  setEnabled(true);
  speak('आवाज़ चालू है।');
 }

 return {receive,controls:<div className="review-section-heading">
  {voice?<><label htmlFor={selectId}>Hindi voice{' '}
   <select id={selectId} value={voice.voiceURI} onChange={event=>setVoiceId(event.target.value)}>
    {voices.map(item=><option key={item.voiceURI} value={item.voiceURI}>{item.name}</option>)}
   </select>
  </label><button type="button" className="button secondary" onClick={toggle}>{enabled?'Mute announcements':'Enable sound'}</button></>:
   <p className="muted">Install a Hindi voice in your device settings to enable announcements.</p>}
  {error&&<p role="status">{error}</p>}
 </div>};
}
