import { ErrorCode, type ErrorPayload } from "@bridge-packet/shared";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly requestId?: string;

  constructor(code: ErrorCode, message: string, requestId?: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.requestId = requestId;
  }

  toPayload(): ErrorPayload {
    return {
      code: this.code,
      message: this.message,
      requestId: this.requestId,
    };
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function toAppError(error: unknown, requestId?: string): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(ErrorCode.INTERNAL_ERROR, error.message, requestId);
  }

  return new AppError(ErrorCode.INTERNAL_ERROR, "Unknown error", requestId);
}
