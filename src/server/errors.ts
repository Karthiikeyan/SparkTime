export type ServiceErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid"
  | "conflict"
  | "too_large"
  | "rate_limited"
  | "unsupported_media"
  | "storage_error";

const STATUS: Record<ServiceErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  conflict: 409,
  too_large: 413,
  rate_limited: 429,
  unsupported_media: 415,
  storage_error: 502,
};

/**
 * Expected, user-facing failures. Messages are safe to show to the admin;
 * anything that is not a ServiceError is reported as a generic 500.
 */
export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly details?: Record<string, string>;

  constructor(code: ServiceErrorCode, message: string, details?: Record<string, string>) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return STATUS[this.code];
  }
}

export const notFound = (what = "Resource") => new ServiceError("not_found", `${what} not found.`);
export const invalid = (message: string, details?: Record<string, string>) => new ServiceError("invalid", message, details);
export const conflict = (message: string, details?: Record<string, string>) => new ServiceError("conflict", message, details);

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}
