export class E2ERunError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'E2ERunError';
    this.code = code;
    Object.assign(this, details);
  }
}
