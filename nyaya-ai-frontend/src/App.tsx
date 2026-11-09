import { Navigate, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Shell } from './components/Shell';
import { Chat } from './pages/Chat';
import { Cases } from './pages/Cases';
import { CaseDetail } from './pages/CaseDetail';
import { Documents } from './pages/Documents';
import { Legal } from './pages/Legal';
import { Settings } from './pages/Settings';
export default function App(){return <ErrorBoundary><Routes><Route element={<Shell/>}><Route index element={<Chat/>}/><Route path="cases" element={<Cases/>}/><Route path="cases/:id" element={<CaseDetail/>}/><Route path="documents" element={<Documents/>}/><Route path="legal" element={<Legal/>}/><Route path="settings" element={<Settings/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Route></Routes></ErrorBoundary>}
