# Technical Documentation

## System Architecture

### Overview

The OpenVPN Web Application is a Node.js-based system that automates the process of creating and managing OpenVPN client configurations. It integrates with Azure Key Vault for secure key management and uses SSH for remote OpenVPN server configuration.

### Components

1. **Web Server (Express.js)**
   - Handles HTTP requests
   - Serves static files
   - Processes client configuration requests
   - Manages error responses

2. **Azure Integration**
   - Uses DefaultAzureCredential for authentication
   - Integrates with Azure Key Vault for SSH key storage
   - Supports managed identity authentication

3. **SSH Management**
   - Uses SSH2 library for secure connections
   - Implements timeout handling
   - Manages command execution
   - Handles connection cleanup

4. **Network Configuration**
   - CIDR notation validation
   - Network/mask conversion utilities
   - Route management
   - IP configuration generation

## Detailed Component Documentation

### 1. Network Utilities

#### CIDR to Network/Mask Conversion

```javascript
function cidrToNetworkAndMask(cidr)
```

Converts CIDR notation to network and subnet mask format.

- Input: CIDR string (e.g., "192.168.1.0/24")
- Output: Object with network and mask properties
- Used for: OpenVPN client configuration and routing

#### CIDR Validation

```javascript
function validateCIDR(cidr)
```

Validates CIDR notation format and values.

- Checks format using regex
- Validates IP address ranges
- Validates subnet mask bits
- Throws detailed error messages

### 2. SSH Management

#### Connection Establishment

```javascript
async function connectSSH(serverIP, privateKey)
```

Establishes SSH connections to OpenVPN servers.

- Uses SSH2 client library
- Implements promise-based connection handling
- Configures secure key exchange algorithms
- Handles connection events

#### Command Execution

```javascript
const execCommand = (cmd) => { ... }
```

Executes commands on remote servers with:

- Timeout handling (30 seconds)
- Output buffering
- Error handling
- Exit code validation

### 3. Certificate Management

The application manages OpenVPN certificates through the following process:

1. **Cleanup Phase**
   - Removes existing certificates
   - Cleans up CCD configurations
   - Removes existing routes

2. **Certificate Generation**
   - Generates certificate request
   - Signs certificate with CA
   - Creates CCD profile
   - Configures routing

3. **Configuration Assembly**
   - Combines certificates and keys
   - Generates OpenVPN configuration
   - Adds routing information
   - Sets security parameters

### 4. WebSocket Implementation

#### Server-Side WebSocket

```javascript
const wss = new WebSocket.Server({
  server,
  clientTracking: true,
  handshakeTimeout: 10000,
  verifyClient: ({ req, secure }) => {
    const isSecure = secure || req.headers['x-forwarded-proto'] === 'https';
    return isSecure;
  }
});
```

The WebSocket server implementation provides:

1. **Security Features**
   - WSS-only connections enforced
   - Connection verification
   - Proxy-awareness
   - Handshake timeout protection

2. **Client Management**
   - Connection tracking
   - Health monitoring
   - Automatic cleanup
   - Connection state management

3. **Communication Protocol**
   - JSON message format
   - Timestamped messages
   - Message type categorization
   - Progress broadcasting

4. **Error Handling**
   - Connection failure recovery
   - Error message propagation
   - Clean disconnection handling
   - Resource cleanup

The WebSocket implementation follows these security principles:

1. **Connection Security**
   - WSS protocol enforcement
   - HTTPS requirement
   - Proxy-aware security checks
   - Connection validation

2. **Message Security**
   - No sensitive data transmission
   - Progress information only
   - Validated message format
   - Sanitized output

3. **Resource Management**
   - Connection timeouts
   - Automatic resource cleanup
   - Memory leak prevention
   - Connection monitoring

## Deployment Guide

### Prerequisites Configuration

1. **Azure Key Vault Setup**
   - Create a Key Vault instance
   - Configure access policies
   - Store SSH private key
   - Enable managed identity access

2. **OpenVPN Server Preparation**
   - Install OpenVPN
   - Configure Easy-RSA
   - Set up CCD directory
   - Configure server routing

### Application Deployment

1. **Environment Configuration**
   - Set required environment variables
   - Configure logging paths
   - Set up Azure credentials
   - Configure server IPs

2. **Security Configuration**
   - Enable HTTPS
   - Configure firewall rules
   - Set up network security groups
   - Enable logging and monitoring

## Troubleshooting Guide

### Common Issues

1. **Certificate Generation Failures**
   - Check Easy-RSA permissions
   - Verify CA certificate validity
   - Check available disk space
   - Review error logs

2. **Connection Issues**
   - Verify SSH key permissions
   - Check network connectivity
   - Verify Azure Key Vault access
   - Review timeout settings

3. **Routing Problems**
   - Validate CIDR notations
   - Check route conflicts
   - Verify OpenVPN server routing
   - Review CCD configurations

### Logging

#### Application Logs

- Location: Console output
- Content: Connection attempts, operations, errors
- Format: ISO timestamp with message

#### Operation Logs

- Location: `/var/log/ovpnsetup/{customerName}.log`
- Content: Certificate operations, route changes
- Format: ISO timestamp with operation details

## Security Considerations

### Authentication

1. **Azure Authentication**
   - Use managed identities
   - Implement proper RBAC
   - Regular credential rotation
   - Monitor access patterns

2. **SSH Security**
   - Use key-based authentication only
   - Implement strict key permissions
   - Regular key rotation
   - Monitor failed attempts

### Network Security

1. **Client Configuration**
   - Validate all network inputs
   - Prevent network conflicts
   - Implement route restrictions
   - Monitor network usage

2. **Server Security**
   - Implement firewall rules
   - Regular security updates
   - Monitor system logs
   - Implement access controls

## Maintenance Procedures

### Regular Maintenance

1. **Certificate Management**
   - Monitor certificate expiration
   - Regular CA maintenance
   - Clean up revoked certificates
   - Verify CRL updates

2. **System Updates**
   - Regular dependency updates
   - Security patch application
   - OpenVPN version updates
   - System package updates

### Backup Procedures

1. **Configuration Backup**
   - Regular CA backup
   - Configuration file backup
   - Key material backup
   - Database backup (if applicable)

2. **Recovery Procedures**
   - CA recovery process
   - Configuration restoration
   - Key material restoration
   - Service verification
