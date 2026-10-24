/** The model server cannot be reached: not running, wrong host, or the browser blocked it (CORS). */
export class AdapterUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AdapterUnavailableError';
  }
}

/** The server answered but does not have the requested model (for Ollama: not pulled yet). */
export class ModelMissingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ModelMissingError';
  }
}
