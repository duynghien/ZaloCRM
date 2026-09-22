import type { FastifyRequest } from 'fastify';
import { boundedPositiveInt, boundedString, validOptionalDate } from '../../shared/http/request-bounds.js';
import { calendarInstant, enumInput, identifierInput, objectInput, RequestValidationError, stringInput } from '../../shared/http/request-schemas.js';

const contactStatuses = ['new', 'contacted', 'interested', 'converted', 'lost'];

function contactBody(value: unknown, creating: boolean) {
  const body = objectInput(value);
  // These fields historically support clearing a value with null on public writes.
  for (const [key, maximum] of Object.entries({ fullName: 255, phone: 50, email: 320, source: 100, notes: 10000 })) {
    if (body[key] !== undefined) stringInput(body[key], maximum, true);
  }
  if (body.status !== undefined && body.status !== null) enumInput(body.status, contactStatuses);
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.length > 100) throw new RequestValidationError('Invalid tags');
    for (const tag of body.tags) stringInput(tag, 100);
  }
  if (creating && !body.fullName && !body.phone) throw new RequestValidationError('fullName or phone is required');
}

function appointmentBody(value: unknown) {
  const body = objectInput(value);
  identifierInput(body.contactId);
  calendarInstant(body.appointmentDate);
  for (const [key, maximum] of Object.entries({ appointmentTime: 50, type: 100, notes: 10000 })) {
    if (body[key] !== undefined) stringInput(body[key], maximum, true);
  }
}

function messageBody(value: unknown) {
  const body = objectInput(value);
  identifierInput(body.zaloAccountId);
  identifierInput(body.threadId);
  if (!stringInput(body.content, 10000)) throw new RequestValidationError('content is required');
  if (body.threadType !== undefined) enumInput(body.threadType, ['user', 'group']);
  if (body.force !== undefined && typeof body.force !== 'boolean') {
    throw new RequestValidationError('Trường force phải là kiểu boolean (true hoặc false)');
  }
}

/** Validate original types before handlers; Fastify's default AJV coercion must not rewrite writes. */
export async function validatePublicRequest(request: FastifyRequest) {
  const route = request.routeOptions.url!;
  const params = request.params as Record<string, unknown>;
  if (route.includes(':id')) identifierInput(params.id);
  if (request.method === 'GET') {
    const query = request.query as Record<string, unknown>;
    if (route.endsWith('/contacts')) {
      boundedString(query.search, 200);
      if (query.status !== undefined && query.status !== '') enumInput(query.status, contactStatuses);
    }
    if (route.endsWith('/contacts') || route.endsWith('/conversations') || route.endsWith('/messages')) {
      boundedPositiveInt(query.limit, route.endsWith('/messages') ? 50 : 20, route.endsWith('/messages') ? 200 : 100);
    }
    if (route.endsWith('/appointments')) {
      const from = validOptionalDate(query.from);
      const to = validOptionalDate(query.to);
      if (from && to && from > to) throw new RequestValidationError('Invalid appointment date range');
    }
  } else if (route === '/api/public/contacts' || route === '/api/public/contacts/:id') {
    contactBody(request.body, request.method === 'POST');
  } else if (route === '/api/public/appointments') {
    appointmentBody(request.body);
  } else if (route === '/api/public/messages/send') {
    messageBody(request.body);
  }
}
