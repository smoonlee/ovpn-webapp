const express = require("express");
const fs = require("fs").promises;
const path = require("path");
const { DefaultAzureCredential } = require("@azure/identity");
const { SecretClient } = require("@azure/keyvault-secrets");
const { Client } = require("ssh2");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const PORT = process.env.PORT || 8080;

// Azure Key Vault
const keyVaultName = process.env.KEY_VAULT_NAME;
const keyVaultUrl = `https://${keyVaultName}.vault.azure.net`;
const credential = new DefaultAzureCredential();
const secretClient = new SecretClient(keyVaultUrl, credential);

// Middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Server IPs (from env)
const serverIPs = {
  app1: process.env.OVPN_SERVER1_IP,
  app2: process.env.OVPN_SERVER2_IP,
  app3: process.env.OVPN_SERVER3_IP,
};

// --- Helpers ---

function sanitizeInput(input, label = "input") {
  if (!/^[a-zA-Z0-9_-]+$/.test(input)) {
    throw new Error(
      `Invalid ${label}: only letters, numbers, dashes, and underscores are allowed`
    );
  }
  return input;
}

function validateCIDR(cidr) {
  const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/([0-9]|[1-2][0-9]|3[0-2])$/;
  if (!cidrRegex.test(cidr)) {
    throw new Error("Invalid CIDR format");
  }

  const [ip, bits] = cidr.split("/");
  const parts = ip.split(".");
  const validIP = parts.every((part) => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255;
  });

  if (!validIP) {
    throw new Error("Invalid IP address in CIDR");
  }

  return true;
}

function cidrToNetworkAndMask(cidr) {
  const [ip, bits] = cidr.split("/");
  const numBits = parseInt(bits, 10);
  const maskParts = [];

  for (let i = 0; i < 4; i++) {
    if (i * 8 < numBits) {
      if ((i + 1) * 8 <= numBits) {
        maskParts.push(255);
      } else {
        const remainingBits = numBits - i * 8;
        maskParts.push(256 - Math.pow(2, 8 - remainingBits));
      }
    } else {
      maskParts.push(0);
    }
  }

  return { network: ip, mask: maskParts.join(".") };
}

async function getSSHKey(keyName) {
  const secret = await secretClient.getSecret(keyName);
  return secret.value;
}

function connectSSH(serverIP, privateKey) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on("ready", () => resolve(conn))
      .on("error", (err) => reject(err))
      .connect({
        host: serverIP,
        username: process.env.SSH_USERNAME || "appsvc_ovpn",
        privateKey,
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

function execCommand(connection, cmd) {
  return new Promise((resolve, reject) => {
    const TIMEOUT_MS = 30000;
    let output = "";

    connection.exec(cmd, (err, stream) => {
      if (err) return reject(err);

      const timeout = setTimeout(() => {
        stream.end();
        reject(new Error(`Command timed out: ${cmd}`));
      }, TIMEOUT_MS);

      stream.on("data", (data) => (output += data.toString()));
      stream.stderr.on("data", (data) => (output += data.toString()));

      stream.on("close", () => {
        clearTimeout(timeout);
        resolve(output.trim());
      });

      stream.on("exit", (code) => {
        if (code !== 0) {
          reject(new Error(`Command failed: ${cmd}\nOutput: ${output}`));
        }
      });
    });
  });
}

// --- Main Connect Route ---

app.post("/connect", async (req, res) => {
  const { server, customerName, customerNetwork, azureSubnet } = req.body;
  const keyName = process.env.SSH_SECRET_NAME;

  try {
    // Validate Inputs
    if (
      !server ||
      !customerName ||
      !customerNetwork ||
      !azureSubnet ||
      !keyName
    ) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    sanitizeInput(customerName, "customer name");
    validateCIDR(customerNetwork);
    validateCIDR(azureSubnet);

    const serverIP = serverIPs[server];
    if (!serverIP) return res.status(404).json({ error: "Server not found" });

    const sshKey = await getSSHKey(keyName);
    const connection = await connectSSH(serverIP, sshKey);

    try {
      // Convert Networks
      const custInfo = cidrToNetworkAndMask(customerNetwork);
      const azInfo = cidrToNetworkAndMask(azureSubnet);
      const bits = customerNetwork.split("/")[1];

      // Ensure log dir exists
      await execCommand(connection, "mkdir -p /var/log/ovpnsetup");

      // Clean up previous state
      await execCommand(connection, `rm -f /etc/openvpn/ccd/${customerName}`);
      await execCommand(
        connection,
        `cd /etc/openvpn/easy-rsa && ./easyrsa --batch revoke ${customerName} || true`
      );
      await execCommand(
        connection,
        `rm -f /etc/openvpn/easy-rsa/pki/private/${customerName}.key`
      );
      await execCommand(
        connection,
        `rm -f /etc/openvpn/easy-rsa/pki/issued/${customerName}.crt`
      );
      await execCommand(
        connection,
        `rm -f /etc/openvpn/easy-rsa/pki/reqs/${customerName}.req`
      );
      await execCommand(
        connection,
        `sudo ip route del ${custInfo.network}/${bits} dev tun0 || true`
      );

      // Generate cert
      await execCommand(
        connection,
        `cd /etc/openvpn/easy-rsa && ./easyrsa --batch gen-req ${customerName} nopass`
      );
      await execCommand(
        connection,
        `cd /etc/openvpn/easy-rsa && ./easyrsa --batch sign-req client ${customerName}`
      );

      // CCD
      const ccd = `ifconfig-push ${custInfo.network} ${custInfo.mask}\npush "route ${azInfo.network} ${azInfo.mask}"`;
      await execCommand(
        connection,
        `echo "${ccd}" > /etc/openvpn/ccd/${customerName}`
      );

      // Add route
      await execCommand(
        connection,
        `sudo ip route add ${custInfo.network}/${bits} dev tun0`
      );

      // Read certs
      const clientKey = await execCommand(
        connection,
        `cat /etc/openvpn/easy-rsa/pki/private/${customerName}.key`
      );
      const clientCert = await execCommand(
        connection,
        `cat /etc/openvpn/easy-rsa/pki/issued/${customerName}.crt`
      );
      const caCert = await execCommand(
        connection,
        `cat /etc/openvpn/easy-rsa/pki/ca.crt`
      );

      const ovpn = [
        "client",
        "dev tun",
        "proto tcp",
        `remote ${serverIP} 1194`,
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

      res.set({
        "Content-Type": "application/x-openvpn-profile",
        "Content-Disposition": `attachment; filename="${customerName}.ovpn"`,
      });
      return res.send(ovpn);
    } finally {
      connection.end();
    }
  } catch (err) {
    console.error("[Error]", err);
    return res
      .status(500)
      .json({ error: "Connection failed", details: err.message });
  }
});

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// WebSocket connections store
const connections = new Set();

// WebSocket connection handling
wss.on("connection", (ws) => {
  connections.add(ws);

  ws.on("close", () => {
    connections.delete(ws);
  });
});

// Broadcast to all connected clients
function broadcast(message, type = "info") {
  const messageData = JSON.stringify({
    timestamp: new Date().toISOString(),
    message,
    type,
  });

  connections.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageData);
    }
  });
}

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
