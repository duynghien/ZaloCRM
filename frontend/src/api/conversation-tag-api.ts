/**
 * conversation-tag-api.ts — API client for Conversation Tags & Assignments.
 */
import { api } from './index';

export interface ConversationTag {
  id: string;
  orgId: string;
  name: string;
  color: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: {
    assignments: number;
  };
}

export interface ConversationTagAssignment {
  orgId: string;
  conversationId: string;
  tagId: string;
  assignedAt: string;
  assignedById?: string | null;
  tag: ConversationTag;
}

export interface CreateConversationTagInput {
  name: string;
  color: string;
  description?: string;
}

export interface UpdateConversationTagInput {
  name?: string;
  color?: string;
  description?: string;
}

export async function fetchConversationTags(): Promise<ConversationTag[]> {
  const res = await api.get('/api/v1/conversation-tags');
  return res.data?.tags || [];
}

export async function createConversationTag(
  data: CreateConversationTagInput
): Promise<ConversationTag> {
  const res = await api.post('/api/v1/conversation-tags', data);
  return res.data;
}

export async function updateConversationTag(
  id: string,
  data: UpdateConversationTagInput
): Promise<ConversationTag> {
  const res = await api.put(`/api/v1/conversation-tags/${id}`, data);
  return res.data;
}

export async function deleteConversationTag(id: string): Promise<boolean> {
  const res = await api.delete(`/api/v1/conversation-tags/${id}`);
  return !!res.data?.success;
}

export async function assignConversationTag(
  conversationId: string,
  tagId: string
): Promise<ConversationTagAssignment[]> {
  const res = await api.post(`/api/v1/conversations/${conversationId}/tags`, { tagId });
  return res.data?.tags || [];
}

export async function unassignConversationTag(
  conversationId: string,
  tagId: string
): Promise<ConversationTagAssignment[]> {
  const res = await api.delete(`/api/v1/conversations/${conversationId}/tags/${tagId}`);
  return res.data?.tags || [];
}
