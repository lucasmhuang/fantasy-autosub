// The base of the codebase's typed errors. A subclass names itself with a literal `name`, which the
// logger writes and a minified build keeps. A cause must be an Error, because the logger keeps only
// an Error's message, name, stack and allowlisted fields, but writes any other cause in full.
export abstract class AppError extends Error {
  abstract override readonly name: string;

  constructor(message: string, options?: { cause?: Error }) {
    super(message, options);
  }
}
