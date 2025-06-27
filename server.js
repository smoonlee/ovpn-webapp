const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const { NodeSSH } = require("node-ssh");
const { DefaultAzureCredential } = require("@azure/identity");
const { SecretClient } = require("@azure/keyvault-secrets");

const app = express();
const ssh = new NodeSSH();
const PORT = process.env.PORT || 3000;

// Static frontend hosting
app.use(express.static("public"));
app.use(bodyParser.json({ limit: "1mb" }));

// VPN server details
const vpnHosts = {
  exos: { host: "135.236.23.132", username: "appsvc_ovpn" },
  matrix: { host: "132.220.32.199", username: "appsvc_ovpn" },
  atimo: { host: "132.220.15.55", username: "appsvc_ovpn" },
};

// Azure Key Vault setup
const keyVaultName = process.env.KEYVAULT_NAME || "kv-ovpn-webapp-dev";
const vaultUrl = `https://${keyVaultName}.vault.azure.net`;
const secretClient = new SecretClient(vaultUrl, new DefaultAzureCredential());

async function getSshPrivateKey() {
  const secret = await secretClient.getSecret("ssh-private-key");
  return secret.value;
}

// Log file configuration
const logDir = "/var/log/ovpn-web";
const logFile = path.join(logDir, "generate.log");

function logToFile(message) {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${message}\n`;

  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    fs.appendFileSync(logFile, entry);
  } catch (err) {
    console.error("Log write failed:", err.message);
  }
}

// API route
app.post("/api/generate", async (req, res) => {
  const { clientName, serverName, customerNetwork } = req.body;

  logToFile(
    `➡️ Request received: clientName=${clientName}, serverName=${serverName}, customerNetwork=${customerNetwork}`
  );

  if (!clientName || !serverName || !vpnHosts[serverName]) {
    logToFile(`❌ Invalid parameters`);
    return res
      .status(400)
      .json({ error: "Missing or invalid clientName/serverName" });
  }

  const { host, username } = vpnHosts[serverName];

  try {
    const sshPrivateKey = await getSshPrivateKey();
    logToFile(`🔐 SSH private key retrieved from Key Vault`);

    await ssh.connect({ host, username, privateKey: sshPrivateKey });
    logToFile(`✅ SSH connected to ${host} as ${username}`);

    const scriptPath = `/etc/openvpn/generate-client.sh`;
    const certPath = `/etc/openvpn/client-certs/${clientName}`;
    const command = `bash ${scriptPath} ${clientName} ${
      customerNetwork || ""
    }`.trim();

    logToFile(`▶️ Running script: ${command}`);
    const { stdout, stderr } = await ssh.execCommand(command);
    if (stderr) logToFile(`⚠️ Script stderr: ${stderr}`);
    if (stdout) logToFile(`ℹ️ Script stdout: ${stdout}`);

    // Retrieve certs
    const ca = (await ssh.execCommand(`cat ${certPath}/ca.crt`)).stdout.trim();
    const cert = (
      await ssh.execCommand(`cat ${certPath}/${clientName}.crt`)
    ).stdout.trim();
    const key = (
      await ssh.execCommand(`cat ${certPath}/${clientName}.key`)
    ).stdout.trim();

    if (!ca || !cert || !key) {
      throw new Error("One or more cert files are missing or empty.");
    }

    logToFile(`✅ Certs retrieved successfully for ${clientName}`);
    res.json({ ca, cert, key });
  } catch (err) {
    console.error("❌ Error:", err);
    logToFile(`❌ Exception: ${err.message}`);
    res
      .status(500)
      .json({ error: "Internal error while generating certificates." });
  } finally {
    ssh.dispose();
    logToFile(`🔌 SSH session closed\n`);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
  logToFile("🟢 Server started");
});
