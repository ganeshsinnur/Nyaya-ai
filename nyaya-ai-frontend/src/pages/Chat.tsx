import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Globe2, Scale, Sparkles, ShieldCheck, FolderPlus, Paperclip, Mic, ChevronDown, FileText } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { backend } from '../services/api';
import { useUi } from '../store/ui';
import { Citations, CopyButton, Loading, Markdown, Notice } from '../components/common';
const prompts = ['My landlord is refusing to return my security deposit.','I ordered a phone online but received a damaged product.','My employer has not paid my salary.','I want to understand my consumer rights.'];

export function Chat(){
  const {conversations,activeId,newChat,addMessage,language,setLanguage,saveCase}=useUi();
  const [text,setText]=useState(''); const [error,setError]=useState(''); const scroll=useRef<HTMLDivElement>(null);
  const convo=conversations.find(c=>c.id===activeId);
  const mutation=useMutation({mutationFn:({query}:{query:string})=>backend.analyze(query),onSuccess:(analysis)=>{if(!activeId)return;addMessage(activeId,{id:crypto.randomUUID(),role:'assistant',text:analysis.summary,at:Date.now(),analysis});setError('');},onError:(e:Error)=>setError(e.message)});
  useEffect(()=>{if(!activeId)newChat()},[activeId,newChat]);
  useEffect(()=>{scroll.current?.scrollTo({top:scroll.current.scrollHeight,behavior:'smooth'})},[convo?.messages,mutation.isPending]);
  const send=(value=text)=>{const clean=value.trim();if(!clean||mutation.isPending)return;let id=activeId;if(!id)id=newChat();addMessage(id,{id:crypto.randomUUID(),role:'user',text:clean,at:Date.now()});setText('');setError('');mutation.mutate({query:clean});};
  const extract=async()=>{if(!convo?.messages.length)return;try{const r=await backend.extractCase(convo.messages.map(m=>({role:m.role,content:m.text})));saveCase(r.caseId);setError(`Case structure saved. Keep this case ID: ${r.caseId}`)}catch(e){setError(e instanceof Error?e.message:'Could not create case')}};
  return <div className="chat-page">
    <div className="chat-scroll" ref={scroll}>
      {!convo?.messages.length ? <div className="welcome-wrap"><div className="welcome-emblem"><Scale size={25}/><span className="emblem-spark"><Sparkles size={13}/></span></div><p className="eyebrow">NYAYAAI · LEGAL HELP THAT SPEAKS YOUR LANGUAGE</p><h1>How can we help<br className="desktop-break"/> you today?</h1><p className="welcome-copy">Describe what happened in your own words. We’ll help you understand your options using relevant legal sources.</p><div className="prompt-grid">{prompts.map((p,i)=><button key={p} onClick={()=>send(p)} className="prompt-card"><span>{['⌂','◈','₹','§'][i]}</span><b>{p}</b><ArrowUp size={15}/></button>)}</div><div className="trust-row"><span><ShieldCheck size={15}/> Source-grounded answers</span><span>·</span><span>Your information is processed by the NyayaAI backend.</span></div></div> : <div className="messages">
        {convo.messages.map(m=><div key={m.id} className={`message-row ${m.role}`}><div className={`message-avatar ${m.role}`}>{m.role==='assistant'?<Scale size={16}/>:<span>You</span>}</div><article className="message-content"><div className="message-meta"><b>{m.role==='assistant'?'NyayaAI':'You'}</b><time>{new Date(m.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time></div>
          {m.role==='user'?<p className="user-text">{m.text}</p>:<><div className="answer-summary"><div className="eyebrow">UNDERSTANDING YOUR SITUATION</div><Markdown>{m.analysis?.summary||m.text}</Markdown></div>
            {m.analysis?.abstain&&<Notice>{m.analysis.abstainReason||'There is not enough verified information to answer confidently.'}</Notice>}
            {!!m.analysis?.legalProvisions?.length&&<section className="analysis-section"><div className="eyebrow">WHAT THE LAW SAYS</div>{m.analysis.legalProvisions.map(p=><div className="provision" key={p.citationKey}><b>{p.citationKey}</b><p>{p.sectionText}</p><small>{p.relevance}</small></div>)}</section>}
            {!!m.analysis?.possibleOptions?.length&&<section className="analysis-section"><div className="eyebrow">POSSIBLE OPTIONS</div><ul>{m.analysis.possibleOptions!.map((x,j)=><li key={j}>{x}</li>)}</ul></section>}
            {!!m.analysis?.recommendedNextSteps?.length&&<section className="analysis-section"><div className="eyebrow">SUGGESTED NEXT STEPS</div><ol>{m.analysis.recommendedNextSteps!.map((x,j)=><li key={j}>{x}</li>)}</ol></section>}
            {!!m.analysis?.missingInformation?.length&&<section className="analysis-section"><div className="eyebrow">DETAILS THAT WOULD HELP</div><ul>{m.analysis.missingInformation!.map((x,j)=><li key={j}>{x}</li>)}</ul></section>}
            {!!m.analysis?.uncertaintyWarnings?.length&&<Notice>{m.analysis.uncertaintyWarnings!.join(' ')}</Notice>}
            <Citations items={m.analysis?.citations||[]}/><p className="disclaimer">{m.analysis?.disclaimer}</p><div className="message-tools"><CopyButton text={m.analysis?.summary||m.text}/><button className="tool-button" onClick={()=>extract()}><FolderPlus size={14}/> Build case</button></div>
          </>}
        </article></div>)}
        {mutation.isPending&&<div className="message-row assistant"><div className="message-avatar assistant"><Scale size={16}/></div><div className="message-content"><div className="message-meta"><b>NyayaAI</b></div><Loading label="Reviewing relevant sources…"/></div></div>}
        {error&&<div className="inline-error">{error}<button onClick={()=>setError('')}>Dismiss</button></div>}
      </div>}
    </div>
    <div className="chat-bottom"><div className="composer"><textarea aria-label="Describe your legal problem" value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}}} placeholder="Describe your legal problem…" rows={2}/><div className="composer-controls"><div className="composer-left"><label className="language-select"><Globe2 size={14}/><select value={language} onChange={e=>setLanguage(e.target.value as 'English'|'हिन्दी')}><option>English</option><option>हिन्दी</option></select><ChevronDown size={12}/></label><button className="composer-utility" title="File uploads are not supported by the backend"><Paperclip size={16}/><span>Attach</span></button><button className="composer-utility" title="Voice input is not available yet"><Mic size={16}/></button></div><button className="send-button" disabled={!text.trim()||mutation.isPending} onClick={()=>send()} aria-label="Send message"><ArrowUp size={19}/></button></div></div><div className="composer-foot"><span><ShieldCheck size={13}/> No account required</span><span><FileText size={13}/> General legal information, not legal advice</span></div></div>
  </div>
}
