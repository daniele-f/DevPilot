# Tailscale phone access

Goal: Let the user start a private development frontend on the PC's Tailscale IPv4 address, sharing the existing local database.

Design: A separate Windows launcher passes `--tailscale`. Detect the installed Tailscale CLI and connected IPv4 address; bind Angular only to that address. Proxy API requests to loopback with the target Host header. Permit the exact frontend origin for API routes only. Keep normal startup and MCP/OAuth loopback restrictions. No service is started during configuration.

Alternatives: Tailscale Serve adds HTTPS but requires extra tailnet setup; binding all interfaces exposes development on the LAN. A direct Tailscale interface binding fits the requested phone access with fewer changes.

Implementation:
- [x] Add regression tests for origin restrictions and connected address detection.
- [x] Add Tailscale settings helper, launcher flag, proxy configuration and Windows entry point.
- [x] Verify local tests and syntax; document user startup and firewall troubleshooting. Leave service stopped. Phone/browser end-to-end verification is left to the user's launch.

Validation: all 14 local API tests passed; Node syntax checks passed. The installed Tailscale client and local interface report `100.66.101.70`. No development service was launched during this configuration.
