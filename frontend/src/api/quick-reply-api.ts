/**
 * quick-reply-api.ts — API client for QuickReply message templates.
 */
import { api } from './index';

export type QuickReplyCategory = 'payment' | 'address' | 'pricing' | 'policy' | 'general';

export interface QuickReply {
  id: string;
  orgId: string;
  shortcut: string;
  title: string;
  content: string;
  category: QuickReplyCategory;
  createdById?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: { id: string; fullName: string } | null;
}

export interface CreateQuickReplyInput {
  shortcut: string;
  title: string;
  content: string;
  category?: QuickReplyCategory;
}

export interface UpdateQuickReplyInput {
  shortcut?: string;
  title?: string;
  content?: string;
  category?: QuickReplyCategory;
}

export async function fetchQuickReplies(params?: {
  category?: string;
  search?: string;
}): Promise<QuickReply[]> {
  const res = await api.get('/api/v1/quick-replies', { params });
  return res.data?.quickReplies || [];
}

export async function createQuickReply(data: CreateQuickReplyInput): Promise<QuickReply> {
  const res = await api.post('/api/v1/quick-replies', data);
  return res.data;
}

export async function updateQuickReply(
  id: string,
  data: UpdateQuickReplyInput
): Promise<QuickReply> {
  const res = await api.put(`/api/v1/quick-replies/${id}`, data);
  return res.data;
}

export async function deleteQuickReply(id: string): Promise<boolean> {
  const res = await api.delete(`/api/v1/quick-replies/${id}`);
  return !!res.data?.success;
}
