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

// VPN server lookup
const vpnHosts = {
  exos: { host: "135.236.23.132", username: "appsvc_ovpn" },
  matrix: { host: "132.220.32.199", username: "appsvc_ovpn" },
  atimo: { host: "132.220.15.55", username: "appsvc_ovpn" },
};

const { DefaultAzureCredential } = require("@azure/identity");
const { SecretClient } = require("@azure/keyvault-secrets");

// ✅ Inject your UMI Client ID from an environment variable
const managedIdentityClientId = process.env.MANAGED_IDENTITY_CLIENT_ID;

const keyVaultName = process.env.KEYVAULT_NAME || "kv-ovpn-webapp-dev";
const vaultUrl = `https://${keyVaultName}.vault.azure.net`;

// ✅ Use UMI-aware credential
const credential = new DefaultAzureCredential({
  managedIdentityClientId: managedIdentityClientId,
});

// ✅ SecretClient using UMI credential
const secretClient = new SecretClient(vaultUrl, credential);

async function getSshPrivateKey() {
  const secret = await secretClient.getSecret("ssh-private-key");
  return secret.value;
}

// Logging to file
const logDir = "/var/log/ovpn-web";
const logFile = path.join(logDir, "generate.log");

function logToFile(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  try {
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(logFile, line);
  } catch (err) {
    console.error("⚠️ Failed to write log:", err.message);
  }
}

// Main endpoint
app.post("/api/generate", async (req, res) => {
  const { clientName, serverName, customerNetwork, azureSubnet } = req.body;
  logToFile(
    `📥 Request: clientName=${clientName}, serverName=${serverName}, customerNetwork=${customerNetwork}, azureSubnet=${azureSubnet}`
  );

  if (!clientName || !serverName || !vpnHosts[serverName]) {
    logToFile("❌ Invalid request parameters");
    return res
      .status(400)
      .json({ error: "Missing or invalid clientName/serverName" });
  }

  const { host, username } = vpnHosts[serverName];

  try {
    const sshPrivateKey = await getSshPrivateKey();
    logToFile("🔐 SSH private key retrieved from Key Vault");

    await ssh.connect({ host, username, privateKey: sshPrivateKey });
    logToFile(`✅ SSH connected to ${host} as ${username}`);

    const scriptPath = "/etc/openvpn/generate-client.sh";
    const certPath = `/etc/openvpn/client-certs/${clientName}`;

    const command = `bash ${scriptPath} ${clientName} "${
      customerNetwork || ""
    }" "${azureSubnet || ""}"`.trim();
    logToFile(`▶️ Executing: ${command}`);
    const { stdout, stderr } = await ssh.execCommand(command);
    if (stdout) logToFile(`ℹ️ stdout: ${stdout}`);
    if (stderr) logToFile(`⚠️ stderr: ${stderr}`);

    // Read cert files
    const ca = (await ssh.execCommand(`cat ${certPath}/ca.crt`)).stdout.trim();
    const cert = (
      await ssh.execCommand(`cat ${certPath}/${clientName}.crt`)
    ).stdout.trim();
    const key = (
      await ssh.execCommand(`cat ${certPath}/${clientName}.key`)
    ).stdout.trim();

    if (!ca || !cert || !key)
      throw new Error("Cert contents are empty or missing");

    logToFile(`✅ Certs fetched successfully for ${clientName}`);
    res.json({ ca, cert, key });
  } catch (err) {
    console.error("❌ Error during generation:", err);
    logToFile(`❌ Exception: ${err.message}`);
    res
      .status(500)
      .json({ error: "Internal error while generating certificates." });
  } finally {
    ssh.dispose();
    logToFile("🔌 SSH connection closed\n");
  }
});

// Startup
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  logToFile("🟢 Server started");
});
