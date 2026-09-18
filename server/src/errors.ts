export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly error: string,
    message: string,
    public readonly extra: { code?: number; details?: unknown } = {}
  ) { super(message); }
  toJSON() {
    const out: Record<string, unknown> = { error: this.error, message: this.message };
    if (this.extra.code !== undefined) out.code = this.extra.code;
    if (this.extra.details !== undefined) out.details = this.extra.details;
    return out;
  }
}
export const notFound = (what: string, id: string) => new ApiError(404, `${what}_not_found`, `${what} ${id} not found`);
export const badRequest = (error: string, message: string, details?: unknown) => new ApiError(400, error, message, { details });
