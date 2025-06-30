# WebSocket Console Documentation

## Overview

The OpenVPN Configurator includes a real-time console interface that provides immediate feedback during the certificate generation and configuration process. This is implemented using secure WebSocket connections (WSS) and a modern, terminal-style interface. The console provides a clear, color-coded view of the configuration process and automatically clears between operations for better readability.

## Features

- Real-time operation feedback
- Auto-clearing between operations
- Color-coded message types
- Secure WSS-only connections
- Automatic reconnection
- Responsive design (800px width, adapts to mobile)
- Timestamp for each message
- Auto-scrolling

## Technical Implementation

### Security

- Enforces HTTPS-only access
- Uses secure WebSocket (WSS) protocol
- Server-side certificate validation
- Connection attempt verification
- Automatic protocol detection and enforcement

### WebSocket Server

```javascript
// Server-side implementation
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

### Console Features

- Real-time operation updates
- Color-coded message types:
  - Success messages (green)
  - Error messages (red)
  - Info messages (blue)
- Timestamp for each log entry
- Automatic scrolling
- Overflow handling
- Responsive design
- Connection status indicators

## Message Types

1. **Success Messages**
   - Connection established
   - Configuration completed
   - Certificate generation completed

2. **Info Messages**
   - Operation progress
   - Network configurations
   - Processing steps

3. **Error Messages**
   - Connection failures
   - Validation errors
   - Process failures

## WebSocket Protocol

### Connection Flow

1. **Protocol Detection**:

   ```javascript
   if (window.location.protocol === 'https:') {
     ws = new WebSocket(`wss://${window.location.host}`);
   }
   ```

2. **Message Format**:
   ```javascript
   {
     timestamp: ISO8601 string,
     message: string,
     type: 'success' | 'error' | 'info'
   }
   ```

3. **Connection Lifecycle**:
   - Initial connection establishment
   - Server-side validation (WSS-only)
   - Proxy compatibility check
   - Keep-alive with ping/pong
   - Graceful reconnection
   - Clean disconnection

### Error Handling

1. **Connection Events**:
   - Connection loss detection
   - Automatic 5-second retry
   - Error message parsing
   - Connection state monitoring

2. **Server-Side Validation**:

   ```javascript
   verifyClient: ({ req, secure }) => {
     const isSecure = secure || req.headers['x-forwarded-proto'] === 'https';
     return isSecure;
   }
   ```

3. **Client-Side Recovery**:
   - Automatic reconnection logic
   - Event handler preservation
   - Error logging and display
   - User feedback during reconnection

4. **Keep-Alive Mechanism**:
   - 30-second ping interval
   - Pong response tracking
   - Connection health monitoring
   - Automatic cleanup

## Console UI

### Styling

```css
.console-container {
  background-color: #1e1e1e;
  max-width: 600px;
  height: 600px;
  overflow-y: auto;
}

.console-output {
  font-family: "Consolas", "Monaco", monospace;
  color: #00ff00;
  white-space: pre-wrap;
}
```

### Message Colors

- Success: `#00ff00`
- Error: `#ff4444`
- Info: `#00bfff`
- Timestamp: `#888888`

## Local Development

### HTTPS Setup Options

1. Using mkcert (Recommended):

   ```bash
   mkcert localhost
   ```

2. Using OpenSSL:

   ```bash
   openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout private.key -out certificate.pem
   ```

3. Using local-ssl-proxy:

   ```bash
   npm install -g local-ssl-proxy
   local-ssl-proxy --source 3001 --target 8080
   ```

### Browser Compatibility

- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Full support
- Mobile browsers: Responsive design support

## Best Practices

1. **Security**
   - Always use HTTPS in production
   - Validate all incoming messages
   - Implement connection timeouts
   - Handle reconnection gracefully

2. **Performance**
   - Limit message frequency
   - Implement message queuing
   - Clean up disconnected clients
   - Monitor memory usage

3. **User Experience**
   - Clear error messages
   - Visual feedback for connection status
   - Automatic scrolling for new messages
   - Responsive design considerations

## Troubleshooting

Common issues and solutions:

1. **Connection Failures**
   - Verify HTTPS configuration
   - Check certificate validity
   - Confirm WebSocket port access
   - Review proxy settings

2. **Message Display Issues**
   - Clear console buffer periodically
   - Verify message format
   - Check browser console for errors
   - Validate CSS styling

3. **Security Warnings**
   - Verify certificate configuration
   - Check HTTPS setup
   - Review Content Security Policy
   - Validate WebSocket protocol
