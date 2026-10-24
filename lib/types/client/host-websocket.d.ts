/** Desktop sockets use the injected Host origin; web URLs retain their proxy directory. */
export declare function websocketRoute(route: string, sessionId: string, pageBase: string, streamBase?: string): string;
export declare function hostWebSocketUrl(route: string, sessionId: string): string;
