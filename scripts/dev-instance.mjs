import { createServer } from "node:net";
/** An OS-owned socket prevents simultaneous launchers and is released on exit/crash. */
export async function acquireDevInstance({ port = 4204 } = {}) {
  const server = createServer((socket) => socket.end());
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
  } catch (error) {
    if (error.code === "EADDRINUSE")
      throw new Error(
        "DevPilot is already running. Use the original command window, or stop it with Ctrl+C before starting again.",
      );
    throw error;
  }
  return server;
}
