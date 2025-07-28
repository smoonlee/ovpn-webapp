# server.js Breakdown

This document provides a high-level overview and breakdown of the main logic and structure of `server.js` in the `ovpn-webapp` project. The file implements an Express.js server that manages OpenVPN client configuration, certificate management, and secure communication with OpenVPN servers via SSH and Azure Key Vault.

---

## 1. Imports & Configuration
- **Core Modules:** `path`, `fs`, `express`, `http`, `compression`, `helmet`, `ws` (WebSocket), `ssh2` (SSH client)
- **Azure SDK:** Uses `@azure/keyvault-secrets` and `@azure/identity` for secure secret management.
- **Environment Variables:** Loads from `.env.local` in development mode.

---

## 2. Middleware
- **Logging:** Logs all incoming requests with timestamps.
- **Parsers:** Handles URL-encoded and JSON request bodies.
- **Static Files:** Serves static files from the `public` directory.
- **Compression & Security:** Uses `compression` and `helmet` for performance and security.

---

## 3. Server List & IP Mapping
- **Server List:** Reads OpenVPN server details (name, public/private IP) from environment variables.
- **IP Mapping:** Dynamically builds a mapping of server keys to private IPs for SSH connections.

---

## 4. API Endpoints
- **GET `/api/servers`:** Returns the list of available OpenVPN servers and logs their details.
- **POST `/connect`:** Main endpoint to generate and return an OpenVPN client profile for a customer. This endpoint:
  1. **Validates input** (server key, customer name, CIDR formats).
  2. **Retrieves SSH key** from Azure Key Vault and connects to the selected OpenVPN server via SSH.
  3. **Cleans up previous configuration** (revokes old certificates, removes old routes and CCD profiles if they exist).
  4. **Generates new certificates** for the customer using Easy-RSA.
  5. **Creates a CCD profile** for the customer (static IP assignment and route push for Azure subnet).
  6. **Adds a route** for the customer network to the VPN interface (`tun0`).
  7. **Collects certificates and keys** (CA, client cert, client key) from the server.
  8. **Builds and returns** a complete OpenVPN profile as a downloadable `.ovpn` file.

---

## 5. Utility Functions
- **sanitizeInput:** Ensures user input is safe (alphanumeric, dash, underscore).
- **validateCIDR:** Checks for valid CIDR notation.
- **cidrToNetworkAndMask:** Converts CIDR to network address and subnet mask.
- **getSSHKey:** Retrieves SSH private key from Azure Key Vault.
- **connectSSH:** Establishes SSH connection to a server using the provided key.
- **execCommand:** Runs a shell command over SSH and returns the output.
- **broadcast:** Sends messages to all connected WebSocket clients.

---

## 6. WebSocket Server
- **Setup:** Creates a WebSocket server for real-time status updates to clients.
- **Broadcast:** Used throughout the workflow to send progress and error messages.
- **Heartbeat:** Maintains connection health with periodic pings.

---

## 7. Server Startup
- **HTTP Server:** Starts the Express server on the configured port.

---

## 8. Security & Best Practices
- **Secrets Management:** All sensitive credentials (SSH keys, CA passwords) are stored in Azure Key Vault.
- **Input Validation:** Strict validation for all user-supplied data.
- **Error Handling:** Detailed error responses and logging for troubleshooting.

---

## 9. Summary
This server acts as a secure, automated bridge between a web frontend and OpenVPN servers, handling the full lifecycle of client certificate management and profile generation, with real-time feedback via WebSockets and strong security practices using Azure services.
