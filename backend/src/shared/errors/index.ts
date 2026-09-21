/**
 * Shared Application Errors
 */

export class TenantIsolationError extends Error {
  readonly statusCode = 404;

  constructor(message: string) {
    super(message);
    this.name = 'TenantIsolationError';
  }
}
