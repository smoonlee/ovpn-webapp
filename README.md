# OpenVPN Web Application

A Node.js web application for managing OpenVPN client configurations and certificates. This application provides a web interface to generate client certificates and OpenVPN configuration files with proper routing settings.

## Features

### Core Features

- Automated OpenVPN client certificate generation
- Custom client configuration (CCD) profile creation
- Secure SSH-based remote configuration
- Azure Key Vault integration for secure key storage
- Automatic route configuration for client networks
- Support for multiple OpenVPN servers

### Real-Time Console

- Live operation progress via WebSocket connection
- Auto-clearing console between operations
- Large 800px width for better readability
- Color-coded message types (success/error/info)
- Timestamped entries with auto-scrolling
- Secure WSS-only communication protocol
- Automatic reconnection handling
- Connection status indicators
- Responsive design for mobile devices

### Security

- HTTPS-only access enforcement
- WSS-only WebSocket connections
- Azure Key Vault integration
- Secure SSH key management
- Detailed logging and monitoring

## Prerequisites

- Node.js 14.x or higher
- OpenVPN server with Easy-RSA setup
- Azure Key Vault instance
- SSH access to OpenVPN servers


## Environment Variables

Copy `.env.local` from `app/` as a template for your environment variables. Example:

```env
# Azure Key Vault name (without https:// and .vault.azure.net)
KEY_VAULT_NAME=kv-bwc-openvpn-dev-weu

# Client ID for Managed Identity (optional, used for user-assigned identities)
CLIENT_ID=''

# SSH secret name stored in Key Vault
SSH_SECRET_NAME=ssh-private-key

# SSH username for connecting to OpenVPN server
SSH_USERNAME=appsvc_ovpn

# OpenVPN server IPs and names for frontend dropdown
OVPN_SERVER1_NAME=Matrix
OVPN_SERVER1_IP_PUBLIC=108.141.179.115
OVPN_SERVER1_IP_PRIVATE=10.0.0.68
OVPN_SERVER2_NAME=Exos
OVPN_SERVER2_IP_PUBLIC=2.3.4.5
OVPN_SERVER2_IP_PRIVATE=10.0.0.69
OVPN_SERVER3_NAME=Atimo
OVPN_SERVER3_IP_PUBLIC=3.4.5.6
OVPN_SERVER3_IP_PRIVATE=10.0.0.70

# Optional: Port for Express server (default 8080)
PORT=8080

# Secret name for CA password in Azure Key Vault (used for certificate signing)
EASYRSA_PASS_SECRET_NAME=ca-password
```

**Note:** All secrets (SSH key, CA password) must be present in Azure Key Vault. The app uses Managed Identity for authentication.


## Installation & Development

1. Clone the repository
2. `cd app`
3. Install dependencies:
   ```bash
   npm install
   ```
4. Copy and edit `.env.local` as needed for your environment.
5. Start the server:
   ```bash
   npm start
   ```
   For development with auto-reload:
   ```bash
   npm run dev
   ```

The app will be available at `http://localhost:8080` (or your configured port).

2. Install dependencies:

   ```bash
   npm install
   ```

3. Set up environment variables

4. Start the server:

   ```bash
   npm start
   ```


## Web UI & Real-Time Console

- Modern responsive UI for generating OpenVPN profiles
- Dropdown for server selection (populated from environment)
- Live console output (WebSocket, color-coded, timestamped)
- Input validation for CIDR and customer name
- Download of generated `.ovpn` profile on success
- Console auto-clears between operations

## API Endpoints

### POST /connect

Creates a new OpenVPN client configuration.

Request body:

```json
{
  "server": "app1",          // Server identifier (app1, app2, or app3)
  "customerName": "client1", // Client identifier
  "customerNetwork": "192.168.1.0/24", // Client's network in CIDR notation
  "azureSubnet": "10.0.0.0/24"        // Azure subnet in CIDR notation
}
```

Response:

- Success: OpenVPN configuration file (.ovpn)
- Error: JSON object with error details


## Azure Integration & Security Features


- Azure Managed Identity authentication (uses `@azure/identity`)
- Secure key storage in Azure Key Vault (`@azure/keyvault-secrets`)
- SSH key-based authentication to OpenVPN servers
- All sensitive operations (SSH, CA signing) use secrets from Key Vault
- Input validation for CIDR and customer name
- Timeout handling for SSH commands


## Architecture

- Express.js for the web server
- Azure Identity for authentication
- Azure Key Vault for secret management
- SSH2 for remote server configuration
- WebSocket for real-time console
- Custom CIDR validation and network calculations


## Error Handling

- Invalid network configurations
- SSH connection failures
- Command execution timeouts
- Certificate generation issues
- Azure Key Vault access problems


## Logging

- Application logs via `console.log` (server-side)
- Real-time operation logs via WebSocket (browser console)
- Operation logs in `/var/log/ovpnsetup/{customerName}.log` on the OpenVPN server


## Security Considerations

1. Always use HTTPS in production
2. Implement authentication for the web interface (not included by default)
3. Regularly rotate SSH keys and CA passwords
4. Monitor Azure Key Vault access logs
5. Keep OpenVPN and Easy-RSA up to date


## Troubleshooting & Tips

- If you see errors about missing secrets, check your Azure Key Vault and Managed Identity permissions.
- For local development, ensure `.env.local` is present and correct.
- The app logs all major steps to the browser console and server log for easier debugging.
- For Azure deployment, ensure the app service has access to the Key Vault and the correct environment variables are set.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Submit a pull request with a detailed description of changes


## License

[Add your license here]
