import axios, { AxiosError } from 'axios';
import type { ApiEnvelope, CaseExtractResponse, Citation, LegalAnalysis, LegalCase, LegalDocument, LegalSearchResponse, DocumentType } from '../types/api';

// Dev: talk to the local backend. Production: same-origin '/api/v1' (Vercel rewrites it to the backend,
// see vercel.json). Set VITE_API_BASE_URL only if the backend has its own HTTPS URL.
const baseURL: string = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? 'http://localhost:5000' : '');
export const api = axios.create({ baseURL: `${baseURL.replace(/\/$/, '')}/api/v1`, timeout: 120_000, headers: { 'Content-Type': 'application/json' } });
api.interceptors.response.use((r) => r, (error: AxiosError<{message?: string; details?: unknown}>) => {
  const status = error.response?.status;
  const message = (Array.isArray(error.response?.data?.details) ? (error.response!.data!.details as {field:string;message:string}[]).map(d=>d.message).join('; ') : '') || error.response?.data?.message || (status === 404 ? 'The requested item was not found.' : status === 429 ? 'Too many requests. Please wait a moment.' : status && status >= 500 ? 'The service is having trouble. Please try again.' : error.code === 'ECONNABORTED' ? 'The request timed out. Please try again.' : !error.response ? 'Cannot reach NyayaAI. Check the backend URL and your connection.' : error.message);
  return Promise.reject(new Error(message));
});
const data = <T,>(r: { data: ApiEnvelope<T> }) => r.data.data;

export const backend = {
  health: async () => data(await api.get<ApiEnvelope<{services?: {database: string; geminiConfigured: boolean}}>>('/health')),
  analyze: async (query: string, caseContext: Record<string, unknown> = {}) => data(await api.post<ApiEnvelope<LegalAnalysis>>('/legal/analyze', { query, caseContext })),
  search: async (query: string) => data(await api.post<ApiEnvelope<LegalSearchResponse>>('/legal/search', { query, topK: 8, mode: 'hybrid' })),
  extractCase: async (conversation: {role: 'user' | 'assistant'; content: string}[], caseId?: string) => data(await api.post<ApiEnvelope<CaseExtractResponse>>('/cases/extract', { conversation, ...(caseId ? {caseId} : {}) })),
  getCase: async (id: string) => data(await api.get<ApiEnvelope<LegalCase>>(`/cases/${id}`)),
  correctCase: async (id: string, field: string, value: unknown) => data(await api.patch<ApiEnvelope<{case: LegalCase}>>(`/cases/${id}/correct`, { corrections: [{field, value}] })),
  generateDocument: async (documentType: DocumentType, caseId?: string) => data(await api.post<ApiEnvelope<LegalDocument>>('/documents/generate', { documentType, ...(caseId ? {caseId} : {}) })),
  getDocument: async (id: string) => data(await api.get<ApiEnvelope<LegalDocument>>(`/documents/${id}`)),
  fillPlaceholders: async (id: string, fills: Record<string, string>) => data(await api.patch<ApiEnvelope<LegalDocument>>(`/documents/${id}/fill-placeholders`, { fills })),
  confirmDocument: async (id: string) => data(await api.post<ApiEnvelope<{documentId: string; status: string}>>(`/documents/${id}/confirm`)),
  finalizeDocument: async (id: string) => data(await api.post<ApiEnvelope<{downloadUrl: string}>>(`/documents/${id}/finalize`)),
  downloadDocument: async (id: string) => api.get(`/documents/${id}/download`, { responseType: 'blob' }),
};

export function citationLabel(c: Citation) { return `${c.actName}${c.sectionNumber ? ` · Section ${c.sectionNumber}` : ''}`; }
