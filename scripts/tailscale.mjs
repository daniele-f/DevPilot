import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { isIPv4 } from "node:net";

export function tailscaleAddress(status, interfaces) {
  const localAddresses = Object.values(interfaces).flat().map((entry) => entry.address);
  const address = status.TailscaleIPs?.find((value) => {
    const octets = value.split(".").map(Number);
    return isIPv4(value) && octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127 && localAddresses.includes(value);
  });
  if (status.BackendState !== "Running" || !address)
    throw new Error("Connect Tailscale on this PC and sign in before starting DevPilot in Tailscale mode.");
  return address;
}

export function detectTailscaleAddress() {
  const installed = join(process.env.ProgramFiles || "C:/Program Files", "Tailscale", "tailscale.exe");
  const executable = process.platform === "win32" && existsSync(installed) ? installed : "tailscale";
  let status;
  try {
    status = JSON.parse(execFileSync(executable, ["status", "--json"], {
      encoding: "utf8", windowsHide: true, timeout: 10000, stdio: ["ignore", "pipe", "pipe"],
    }));
  } catch {
    throw new Error("Could not read Tailscale status. Install/open Tailscale and connect this PC, then try again.");
  }
  return tailscaleAddress(status, networkInterfaces());
}
