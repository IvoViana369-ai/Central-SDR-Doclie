/** Porta de log estruturado (implementada com pino nas aplicações). */
export interface Logger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
