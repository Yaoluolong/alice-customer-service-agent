import { createAliceServer } from "../../../src/app";
import type { Server } from "http";
import { AddressInfo } from "net";

export interface TestServer {
  server: Server;
  port: number;
  baseUrl: string;
  close: () => Promise<void>;
}

export const startTestServer = (): Promise<TestServer> => {
  return new Promise((resolve, reject) => {
    const server = createAliceServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        server,
        port,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((res, rej) => server.close((err) => (err ? rej(err) : res())))
      });
    });
    server.on("error", reject);
  });
};
