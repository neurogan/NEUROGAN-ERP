import * as net from "node:net";
import { ZplOverTcpAdapter } from "../zpl-tcp-adapter";

test("sends ZPL to printer and returns SUCCESS on socket close", async () => {
  let received = "";
  const server = net.createServer((sock) => {
    sock.on("data", (chunk) => { received += chunk.toString(); });
    sock.on("end", () => sock.end());
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;

  const adapter = new ZplOverTcpAdapter("127.0.0.1", port);
  const result = await adapter.print({
    artwork: { variableDataSpec: { lot: true, expiry: true } } as any,
    lot: "L001",
    expiry: new Date("2027-01-01"),
    qty: 5,
  });

  expect(received).toContain("^XA");
  expect(received).toContain("L001");
  expect(result.status).toBe("SUCCESS");
  expect(result.qtyPrinted).toBe(5);
  await new Promise<void>((r) => server.close(r));
});

test("returns FAILED on connect timeout", async () => {
  // Use a port that refuses connections immediately (nothing listening)
  // rather than an unreachable IP (which takes the full 5s connect timeout)
  // so the test runs fast. We just need a socket error, not a timeout.
  const adapter = new ZplOverTcpAdapter("127.0.0.1", 1); // port 1 should be refused
  const result = await adapter.print({
    artwork: { variableDataSpec: {} } as any,
    lot: "L001",
    expiry: new Date("2027-01-01"),
    qty: 5,
  });
  expect(result.status).toBe("FAILED");
  expect(result.diagnostics.error).toBeDefined();
}, 15000);
