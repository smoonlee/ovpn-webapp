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
- Secure WSS-only communication protocol
- Color-coded message types (success/error/info)
- Automatic reconnection handling
- Connection status indicators
- Responsive console design

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

The following environment variables need to be configured:

```env
PORT=8080 # Optional, defaults to 8080
KEY_VAULT_NAME=your-keyvault-name
SSH_SECRET_NAME=your-ssh-key-secret-name
SSH_USERNAME=appsvc_ovpn # Optional, defaults to appsvc_ovpn
OVPN_SERVER1_IP=xxx.xxx.xxx.xxx
OVPN_SERVER2_IP=xxx.xxx.xxx.xxx
OVPN_SERVER3_IP=xxx.xxx.xxx.xxx
```

## Installation

1. Clone the repository

2. Install dependencies:

   ```bash
   npm install
   ```

3. Set up environment variables

4. Start the server:

   ```bash
   npm start
   ```

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

## Security Features

The application implements several security measures:

- Azure Managed Identity authentication
- Secure key storage in Azure Key Vault
- SSH key-based authentication
- Input validation for CIDR notation
- Timeout handling for SSH commands

## Architecture

The application utilizes the following components:

- Express.js for the web server
- Azure Identity for authentication
- Azure Key Vault for secret management
- SSH2 for remote server configuration
- Custom CIDR validation and network calculations

## Error Handling

The application includes comprehensive error handling for:

- Invalid network configurations
- SSH connection failures
- Command execution timeouts
- Certificate generation issues
- Azure Key Vault access problems

## Logging

Logs are stored in two locations:

- Application logs via console.log
- Operation logs in `/var/log/ovpnsetup/{customerName}.log` on the OpenVPN server

## Security Considerations

1. Always use HTTPS in production
2. Implement proper authentication for the web interface
3. Regularly rotate SSH keys
4. Monitor Azure Key Vault access logs
5. Keep OpenVPN and Easy-RSA up to date

## Contributing

1. Fork the repository
2. Create a feature branch
3. Submit a pull request with a detailed description of changes

## License

[Add your license here]
