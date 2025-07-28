// =========================
// Imports & Configuration
// =========================
const path = require("path");
const fs = require("fs").promises;
const express = require("express");
const compression = require("compression");
const http = require("http");
const WebSocket = require("ws");
const { Client } = require("ssh2");
const { SecretClient } = require("@azure/keyvault-secrets");
const helmet = require("helmet");

//const { DefaultAzureCredential } = require("@azure/identity");
const { ManagedIdentityCredential } = require("@azure/identity");

// Load environment variables in development
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config({
    path: path.join(__dirname, ".env.local"),
  });
}

const app = express();
const PORT = process.env.PORT || 8080;
const keyVaultUrl = `https://${process.env.KEY_VAULT_NAME}.vault.azure.net`;
//const credential = new DefaultAzureCredential();
const credential = new ManagedIdentityCredential(process.env.CLIENT_ID);
const secretClient = new SecretClient(keyVaultUrl, credential);

// =========================
// Middleware
// =========================
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(compression());
app.use(helmet());

// =========================
// Server List & IP Mapping
// =========================
const serverList = [
  {
    key: "app1",
    name: process.env.OVPN_SERVER1_NAME || "undefined",
    ipPublic: process.env.OVPN_SERVER1_IP_PUBLIC || "undefined",
    ipPrivate: process.env.OVPN_SERVER1_IP_PRIVATE || "undefined",
  },
  {
    key: "app2",
    name: process.env.OVPN_SERVER2_NAME || "undefined",
    ipPublic: process.env.OVPN_SERVER2_IP_PUBLIC || "undefined",
    ipPrivate: process.env.OVPN_SERVER2_IP_PRIVATE || "undefined",
  },
  {
    key: "app3",
    name: process.env.OVPN_SERVER3_NAME || "undefined",
    ipPublic: process.env.OVPN_SERVER3_IP_PUBLIC || "undefined",
    ipPrivate: process.env.OVPN_SERVER3_IP_PRIVATE || "undefined",
  },
];

const serverIPs = {
  app1: process.env.OVPN_SERVER1_IP_PRIVATE,
  app2: process.env.OVPN_SERVER2_IP_PRIVATE,
  app3: process.env.OVPN_SERVER3_IP_PRIVATE,
};

// =========================
// API Endpoints
// =========================
// List available OpenVPN servers
app.get("/api/servers", (req, res) => {
  console.log("/api/servers env:", {
    OVPN_SERVER1_NAME: process.env.OVPN_SERVER1_NAME,
    OVPN_SERVER1_IP_PUBLIC: process.env.OVPN_SERVER1_IP_PUBLIC,
    OVPN_SERVER1_IP_PRIVATE: process.env.OVPN_SERVER1_IP_PRIVATE,
    OVPN_SERVER2_NAME: process.env.OVPN_SERVER2_NAME,
    OVPN_SERVER2_IP_PUBLIC: process.env.OVPN_SERVER2_IP_PUBLIC,
    OVPN_SERVER2_IP_PRIVATE: process.env.OVPN_SERVER2_IP_PRIVATE,
    OVPN_SERVER3_NAME: process.env.OVPN_SERVER3_NAME,
    OVPN_SERVER3_IP_PUBLIC: process.env.OVPN_SERVER3_IP_PUBLIC,
    OVPN_SERVER3_IP_PRIVATE: process.env.OVPN_SERVER3_IP_PRIVATE,
  });
  res.json(serverList);
});

// =========================
// Utility Functions
// =========================

// Sanitize user input for safety
function sanitizeInput(input, label = "input") {
  if (!/^[a-zA-Z0-9_-]+$/.test(input)) {
    throw new Error(
      `Invalid ${label}: only letters, numbers, dashes, and underscores are allowed`
    );
  }
  return input;
}

// Validate CIDR notation
function validateCIDR(cidr) {
  const cidrRegex = /^\d{1,3}(\.\d{1,3}){3}\/([0-9]|[1-2][0-9]|3[0-2])$/;
  if (!cidrRegex.test(cidr)) throw new Error("Invalid CIDR format");
  const parts = cidr.split("/")[0].split(".").map(Number);
  if (parts.some((num) => num < 0 || num > 255))
    throw new Error("Invalid IP address in CIDR");
}

// Convert CIDR to network and mask
function cidrToNetworkAndMask(cidr) {
  const [ip, bits] = cidr.split("/");
  const numBits = parseInt(bits);
  const maskParts = Array(4)
    .fill(0)
    .map((_, i) => {
      const remainingBits = Math.max(0, Math.min(8, numBits - i * 8));
      return 256 - Math.pow(2, 8 - remainingBits);
    });
  return { network: ip, mask: maskParts.join(".") };
}

// Retrieve SSH key from Azure Key Vault
async function getSSHKey(name) {
  const secret = await secretClient.getSecret(name);
  if (!secret.value.startsWith("-----BEGIN"))
    throw new Error("Invalid SSH key format");
  return secret.value;
}

// Establish SSH connection to server
async function connectSSH(serverKey, key) {
  const serverIP = serverIPs[serverKey];
  const username = process.env.SSH_USERNAME || "undefined";
  console.log(`[connectSSH] serverKey: ${serverKey}`);
  console.log(`[connectSSH] serverIP: ${serverIP}`);
  console.log(`[connectSSH] username: ${username}`);
  console.log(
    `[connectSSH] SSH key collected from KeyVault: ${
      !!key && key.startsWith("-----BEGIN")
    }`
  );
  if (!serverIP)
    throw new Error(
      `Unknown server key or missing private IP (serverKey: ${serverKey}, serverIP: ${serverIP})`
    );
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on("ready", () => {
        const serverName =
          process.env[`OVPN_SERVER${serverKey.slice(-1)}_NAME`] || serverKey;
        broadcast(`SSH connection to ${serverName} (${serverIP})`, "success");
        resolve(conn);
      })
      .on("error", reject)
      .connect({
        host: serverIP,
        username,
        privateKey: key,
        algorithms: {
          kex: [
            "curve25519-sha256",
            "curve25519-sha256@libssh.org",
            "ecdh-sha2-nistp256",
            "ecdh-sha2-nistp384",
            "ecdh-sha2-nistp521",
            "diffie-hellman-group-exchange-sha256",
          ],
        },
      });
  });
}

// Execute a command over SSH
function execCommand(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let output = "";
      const timeout = setTimeout(() => {
        stream.end();
        reject(new Error(`Command timeout: ${cmd}`));
      }, 30000);

      stream.on("data", (data) => (output += data));
      stream.stderr.on("data", (data) => (output += data));
      stream.on("close", () => {
        clearTimeout(timeout);
        resolve(output.trim());
      });
      stream.on("exit", (code) => {
        if (code !== 0)
          reject(new Error(`Command failed [${code}]: ${cmd}\n${output}`));
      });
    });
  });
}

// WebSocket broadcast utility
const connections = new Set();
function broadcast(msg, type = "info") {
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    message: msg,
    type,
  });
  connections.forEach(
    (ws) => ws.readyState === WebSocket.OPEN && ws.send(payload)
  );
}

// =========================
// Main Workflow: Connect & Generate OpenVPN Profile
// =========================
app.post("/connect", async (req, res) => {
  // Extract request parameters
  const { server, customerName, customerNetwork, azureSubnet } = req.body;
  const keyName = process.env.SSH_SECRET_NAME;

  try {
    // Step 1: Validate input
    console.log(`[POST /connect] Incoming server key: ${server}`);
    console.log(`[POST /connect] serverIPs mapping:`, serverIPs);
    if (!serverIPs[server])
      throw new Error(
        `Unknown server (server: ${server}, serverIPs: ${JSON.stringify(
          serverIPs
        )})`
      );
    sanitizeInput(customerName, "customer name");
    validateCIDR(customerNetwork);
    validateCIDR(azureSubnet);

    // Step 2: Get SSH key and connect
    const sshKey = await getSSHKey(keyName);
    const conn = await connectSSH(server, sshKey);
    const [_, bits] = customerNetwork.split("/");
    const cust = cidrToNetworkAndMask(customerNetwork);
    const az = cidrToNetworkAndMask(azureSubnet);

    // Step 3: Cleanup previous configuration
    broadcast(""); // Add a line break before cleanup message
    broadcast("Cleaning up previous configuration...");
    function broadcastEcho(msg) {
      broadcast(msg);
      return `echo \"${msg}\"`;
    }

    // Pre-check: If certificate exists, revoke and clean up
    const certExistsCmd = `test -f /etc/openvpn/easy-rsa/pki/issued/${customerName}.crt && echo \"EXISTS\" || echo \"NOT_EXISTS\"`;
    const certExists = await execCommand(conn, certExistsCmd);

    if (certExists === "EXISTS") {
      // Check for CCD profile existence
      const ccdExistsCmd = `test -f /etc/openvpn/ccd/${customerName} && echo \"CCD_EXISTS\" || echo \"CCD_NOT_EXISTS\"`;
      const ccdExists = await execCommand(conn, ccdExistsCmd);

      // Run easy-rsa commands with working directory
      await execCommand(conn, `cd /etc/openvpn/easy-rsa && sudo ./easyrsa --batch revoke '${customerName}'`);
      await execCommand(conn, broadcastEcho(`Certificate for ${customerName} revoked`));
      await execCommand(conn, `cd /etc/openvpn/easy-rsa && sudo ./easyrsa --batch gen-crl`);
      await execCommand(conn, `cd /etc/openvpn/easy-rsa && sudo rm -f pki/private/'${customerName}'.key pki/issued/'${customerName}'.crt pki/reqs/'${customerName}'.req`);
      await execCommand(conn, broadcastEcho(`Removed keys and certificates for ${customerName}`));
      if (ccdExists === "CCD_EXISTS") {
        await execCommand(conn, `sudo rm -f /etc/openvpn/ccd/'${customerName}'`);
        await execCommand(conn, broadcastEcho(`Removed CCD profile for ${customerName}`));
      } else {
        await execCommand(conn, broadcastEcho(`No CCD profile found for ${customerName}`));
      }
      await execCommand(conn, `sudo ip route del '${cust.network}/${bits}'`);
      await execCommand(conn, broadcastEcho(`Removed route for ${cust.network}/${bits} on tun0`));
      await execCommand(conn, `cd /etc/openvpn/easy-rsa && sudo chown -R '${process.env.SSH_USERNAME}': pki`);
    } else {
      broadcast(`No certificate found for ${customerName}`);
    }

    // Step 4: Generate new certificates
    broadcast("");
    broadcast("Generating certificates...");
    await execCommand(conn, `cd /etc/openvpn/easy-rsa && sudo ./easyrsa --batch gen-req ${customerName} nopass`);
    
    // Retrieve the CA password from Azure Key Vault and sign the client certificate
    const caPasswordSecretName = process.env.CA_PASSWORD;
    const caPasswordSecret = await secretClient.getSecret(caPasswordSecretName);
    const caPassword = caPasswordSecret.value || "";
    await execCommand(
      conn,
      `cd /etc/openvpn/easy-rsa && echo '${caPassword}' | sudo ./easyrsa --batch sign-req client ${customerName}`
    );

    // Step 5: Create CCD profile (refactored to avoid heredoc)
    broadcast("Creating CCD profile...");
    await execCommand(conn, `echo 'ifconfig-push ${cust.network} ${cust.mask}' | sudo tee /etc/openvpn/ccd/${customerName}`);
    broadcast(`Added ifconfig-push for: ${cust.network}/${bits}`);
    await execCommand(conn, `echo 'push "route ${az.network} ${az.mask}"' | sudo tee -a /etc/openvpn/ccd/${customerName}`);
    broadcast(`Added push route for Azure subnet: ${az.network}/${bits}`);

    // Step 6: Add route to tun0
    broadcast(`Adding route ${cust.network}/${bits} to tun0...`);
    // Check if route already exists
    const routeCheckCmd = `ip route | grep -w '${cust.network}/${bits}'`;
    let routeExists = false;
    try {
      const routeCheckResult = await execCommand(conn, routeCheckCmd);
      routeExists = !!routeCheckResult;
    } catch (e) {
      // If grep returns no result, execCommand may throw; treat as route not existing
      routeExists = false;
    }
    if (routeExists) {
      broadcast(`Error: Route ${cust.network}/${bits} already exists on tun0`, "error");
    } else {
      try {
        await execCommand(conn, `sudo ip route add ${cust.network}/${bits} dev tun0`);
      } catch (e) {
        broadcast(`Warning: Could not add route ${cust.network}/${bits} to tun0: ${e.message}`, "warning");
      }
    }

    // Step 7: Collect certificates and keys
    // Parallelize certificate/key retrieval for performance
    const [caCert, clientCertRaw, clientKey] = await Promise.all([
      execCommand(conn, `sudo cat /etc/openvpn/easy-rsa/pki/ca.crt`),
      execCommand(conn, `sudo cat /etc/openvpn/easy-rsa/pki/issued/${customerName}.crt`),
      execCommand(conn, `sudo cat /etc/openvpn/easy-rsa/pki/private/${customerName}.key`)
    ]);
    // Extract only the certificate block
    const certMatch = clientCertRaw.match(
      /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/
    );
    const clientCert = certMatch ? certMatch[0] : "";
    conn.end();

    // Step 8: Build OpenVPN profile
    const profile = [
      "client",
      "dev tun",
      "proto udp",
      `remote ${serverIPs[server]} 1194`,
      "resolv-retry infinite",
      "nobind",
      "persist-key",
      "persist-tun",
      "remote-cert-tls server",
      "cipher AES-256-GCM",
      "auth SHA256",
      "key-direction 1",
      "verb 4",
      "",
      "<ca>",
      caCert.trim(),
      "</ca>",
      "<cert>",
      clientCert.trim(),
      "</cert>",
      "<key>",
      clientKey.trim(),
      "</key>",
    ].join("\n");

    // Step 9: Send profile as response
    res.set({
      "Content-Type": "application/x-openvpn-profile",
      "Content-Disposition": `attachment; filename=\"${customerName}.ovpn\"`,
    });
    res.send(profile);

  } catch (err) {
    console.error("[Error]", err);
    // Provide more detailed error context
    let errorContext = {};
    if (err instanceof Error) {
      errorContext = {
        name: err.name,
        message: err.message,
        stack: err.stack,
      };
    } else {
      errorContext = { message: String(err) };
    }
    res.status(500).json({ error: errorContext.message || "Unknown error", details: errorContext });
  }
});

// =========================
// WebSocket Server Setup
// =========================
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, clientTracking: true });

wss.on("connection", (ws) => {
  ws.isAlive = true;
  connections.add(ws);
  ws.send(
    JSON.stringify({ message: "Connected to WebSocket", type: "success" })
  );
  ws.on("pong", () => (ws.isAlive = true));
  ws.on("close", () => connections.delete(ws));
});

// Heartbeat for WebSocket connections
setInterval(() => {
  connections.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// =========================
// Start HTTP Server
// =========================
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
