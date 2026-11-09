import { AlertCircle, Check, Copy, ExternalLink, LoaderCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Citation } from '../types/api';
import { citationLabel } from '../services/api';

export function Notice({children, tone='info'}:{children:ReactNode; tone?:'info'|'error'}) { return <div className={`notice ${tone}`}><AlertCircle size={17}/><span>{children}</span></div>; }
export function Loading({label='Loading…'}:{label?:string}) { return <div className="loading"><LoaderCircle className="spin" size={18}/>{label}</div>; }
export function Markdown({children}:{children:string}) { return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown></div>; }
export function Citations({items}:{items?:Citation[]}) { if(!items?.length) return null; return <section className="citation-block"><div className="eyebrow">VERIFIED SOURCES</div>{items.map((c,i)=><a className="citation" key={`${c.citationKey}-${i}`} href={c.sourceUrl || undefined} target="_blank" rel="noreferrer"><span className="citation-index">{i+1}</span><span><strong>{citationLabel(c)}</strong><small>{c.documentTitle || c.sourceType || 'Retrieved legal source'}</small></span>{c.sourceUrl && <ExternalLink size={15}/>}</a>)}</section>; }
export function CopyButton({text}:{text:string}) { const [copied,setCopied]=useState(false); return <button className="icon-button" aria-label="Copy response" onClick={async()=>{await navigator.clipboard.writeText(text);setCopied(true);setTimeout(()=>setCopied(false),1300)}}>{copied?<Check size={16}/>:<Copy size={16}/>}</button>; }
export function EmptyState({icon, title, description, action}:{icon:ReactNode;title:string;description:string;action?:ReactNode}) { return <div className="empty-state"><div className="empty-icon">{icon}</div><h2>{title}</h2><p>{description}</p>{action}</div>; }
