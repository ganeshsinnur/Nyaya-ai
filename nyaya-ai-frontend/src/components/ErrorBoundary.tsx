import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
export class ErrorBoundary extends Component<{children: ReactNode}, {error: Error | null}> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div style={{padding:32,maxWidth:560,margin:'10vh auto',fontFamily:'sans-serif'}}><h2>Something went wrong</h2><p>{this.state.error.message}</p><button onClick={()=>{ this.setState({error:null}); }}>Try again</button> <button onClick={()=>{ try{localStorage.removeItem('nyayaai-local-ui')}catch{} location.href='/'; }}>Reset saved chats</button></div>;
  }
}
