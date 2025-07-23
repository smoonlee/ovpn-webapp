const path = require("path");
const fs = require("fs").promises;

const express = require("express");
const compression = require("compression");
const http = require("http");
const WebSocket = require("ws");

const { Client } = require("ssh2");
const { DefaultAzureCredential } = require("@azure/identity");
const { SecretClient } = require("@azure/keyvault-secrets");

if (process.env.NODE_ENV !== "production") {
  require("dotenv").config({
    path: path.join(__dirname, ".env.local"),
  });
}

const app = express();
const PORT = process.env.PORT || 8080;
const keyVaultUrl = `https://${process.env.KEY_VAULT_NAME}.vault.azure.net`;
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
app.use(compression());


const serverList = [
  {
    key: "app1",
    name: process.env.OVPN_SERVER1_NAME || "undefined",
    ipPublic: process.env.OVPN_SERVER1_IP_PUBLIC || "undefined",
    ipPrivate: process.env.OVPN_SERVER1_IP_PRIVATE || "undefined",
  },
  {
    key: "app2",
    name: process.env.OVPN_SERVER2_NAME || "undefined2",
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

function sanitizeInput(input, label = "input") {
  if (!/^[a-zA-Z0-9_-]+$/.test(input)) {
    throw new Error(
      `Invalid ${label}: only letters, numbers, dashes, and underscores are allowed`
    );
  }
  return input;
}

function validateCIDR(cidr) {
  const cidrRegex = /^\d{1,3}(\.\d{1,3}){3}\/([0-9]|[1-2][0-9]|3[0-2])$/;
  if (!cidrRegex.test(cidr)) throw new Error("Invalid CIDR format");
  const parts = cidr.split("/")[0].split(".").map(Number);
  if (parts.some((num) => num < 0 || num > 255))
    throw new Error("Invalid IP address in CIDR");
}

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

async function getSSHKey(name) {
  const secret = await secretClient.getSecret(name);
  if (!secret.value.startsWith("-----BEGIN"))
    throw new Error("Invalid SSH key format");
  return secret.value;
}

async function connectSSH(serverKey, key) {
  const serverIP = serverIPs[serverKey];
  const username = process.env.SSH_USERNAME || "undefined";
  console.log(`[connectSSH] serverKey: ${serverKey}`);
  console.log(`[connectSSH] serverIP: ${serverIP}`);
  console.log(`[connectSSH] username: ${username}`);
  console.log(`[connectSSH] SSH key collected from KeyVault: ${!!key && key.startsWith("-----BEGIN")}`);
  if (!serverIP) throw new Error(`Unknown server key or missing private IP (serverKey: ${serverKey}, serverIP: ${serverIP})`);
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on("ready", () => resolve(conn))
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

app.post("/connect", async (req, res) => {
  const { server, customerName, customerNetwork, azureSubnet } = req.body;
  const keyName = process.env.SSH_SECRET_NAME;

  try {
    console.log(`[POST /connect] Incoming server key: ${server}`);
    console.log(`[POST /connect] serverIPs mapping:`, serverIPs);
    if (!serverIPs[server]) throw new Error(`Unknown server (server: ${server}, serverIPs: ${JSON.stringify(serverIPs)})`);
    sanitizeInput(customerName, "customer name");
    validateCIDR(customerNetwork);
    validateCIDR(azureSubnet);

    const sshKey = await getSSHKey(keyName);
    const conn = await connectSSH(server, sshKey);
    const [_, bits] = customerNetwork.split("/");
    const cust = cidrToNetworkAndMask(customerNetwork);
    const az = cidrToNetworkAndMask(azureSubnet);

    broadcast("Cleaning up previous configuration...");
    await execCommand(
      conn,
      `bash -c '
      cd /etc/openvpn/easy-rsa &&
      ./easyrsa --batch revoke ${customerName} || true &&
      echo "Certificate for ${customerName} revoked" &&
      ./easyrsa --batch gen-crl &&
      rm -f pki/private/${customerName}.key pki/issued/${customerName}.crt pki/reqs/${customerName}.req &&
      echo "Removed keys and certificates for ${customerName}" &&
      rm -f /etc/openvpn/ccd/${customerName} &&
      echo "Removed  ${customerName} CCD profile for ${customerName}" &&
      sudo ip route del ${cust.network}/${bits} dev tun0 || true
      echo "Removed ${customerName} route for ${cust.network}/${bits} on tun0"
    '`
    );

    broadcast("Generating certificates...");
    await execCommand(
      conn,
      `cd /etc/openvpn/easy-rsa && ./easyrsa --batch gen-req ${customerName} nopass`
    );
    await execCommand(
      conn,
      `cd /etc/openvpn/easy-rsa && ./easyrsa --batch sign-req client ${customerName}`
    );

    broadcast("Creating CCD profile...");
    await execCommand(
      conn,
      `cat <<EOF > /etc/openvpn/ccd/${customerName}
ifconfig-push ${cust.network} ${cust.mask}
push 'route ${az.network} ${az.mask}'
EOF`
    );

    broadcast("Adding route to tun0...");
    await execCommand(
      conn,
      `sudo ip route add ${cust.network}/${bits} dev tun0`
    );

    const clientKey = await execCommand(
      conn,
      `cat /etc/openvpn/easy-rsa/pki/private/${customerName}.key`
    );
    const clientCert = await execCommand(
      conn,
      `cat /etc/openvpn/easy-rsa/pki/issued/${customerName}.crt`
    );
    const caCert = await execCommand(
      conn,
      `cat /etc/openvpn/easy-rsa/pki/ca.crt`
    );

    conn.end();

    const profile = [
      "client",
      "dev tun",
      "proto tcp",
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

    res.set({
      "Content-Type": "application/x-openvpn-profile",
      "Content-Disposition": `attachment; filename=\"${customerName}.ovpn\"`,
    });
    res.send(profile);
  } catch (err) {
    console.error("[Error]", err);
    res.status(500).json({ error: "Failed to connect", details: err.message });
  }
});

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

setInterval(() => {
  connections.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
