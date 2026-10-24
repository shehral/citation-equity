// The WHATWG URL class exists in every runtime the engine runs in (browsers, Node 24), but the
// engine compiles without DOM or Node types. This declares the part of it the engine uses.
declare class URL {
  constructor(url: string, base?: string);
  readonly hostname: string;
  readonly protocol: string;
}
