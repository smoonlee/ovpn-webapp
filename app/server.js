const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const { NodeSSH } = require("node-ssh");
const { DefaultAzureCredential } = require("@azure/identity");
const { SecretClient } = require("@azure/keyvault-secrets");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));
app.use(bodyParser.json({ limit: "1mb" }));

const vpnHosts = {
  exos: { host: "20.4.208.94", username: "appsvc_ovpn" },
  matrix: { host: "132.220.32.199", username: "appsvc_ovpn" },
  atimo: { host: "132.220.15.55", username: "appsvc_ovpn" },
};

const managedIdentityClientId = process.env.MANAGED_IDENTITY_CLIENT_ID;
const keyVaultName = process.env.KEYVAULT_NAME || "kv-ovpn-webapp-dev";
const vaultUrl = `https://${keyVaultName}.vault.azure.net`;

const credential = new DefaultAzureCredential({
  managedIdentityClientId: managedIdentityClientId,
});

const secretClient = new SecretClient(vaultUrl, credential);

async function getSshPrivateKey() {
  const secret = await secretClient.getSecret("ssh-private-key");
  return secret.value;
}

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

app.post("/api/generate", async (req, res) => {
  const { clientName, serverName, customerNetwork, azureSubnet } = req.body;
  const logs = [];

  function log(message) {
    logs.push(message);
    logToFile(message);
  }

  log(
    `📥 Request: clientName=${clientName}, serverName=${serverName}, customerNetwork=${customerNetwork}, azureSubnet=${azureSubnet}`
  );

  if (!clientName || !serverName || !vpnHosts[serverName]) {
    log("❌ Invalid request parameters");
    return res.status(400).json({
      error: "Missing or invalid clientName/serverName",
      logs,
    });
  }

  const { host, username } = vpnHosts[serverName];
  const ssh = new NodeSSH();

  try {
    log("🔐 Retrieving SSH private key from Key Vault...");
    const sshPrivateKey = await getSshPrivateKey();
    log("🔐 SSH private key retrieved from Key Vault");

    log(`🔌 Connecting to SSH host ${host} as user ${username}...`);
    await ssh.connect({ host, username, privateKey: sshPrivateKey });
    log(`✅ SSH connected to ${host} as ${username}`);

    const scriptPath = "/etc/openvpn/generate-client.sh";
    const certPath = `/etc/openvpn/client-certs/${clientName}`;

    const command = `bash ${scriptPath} ${clientName} "${
      customerNetwork || ""
    }" "${azureSubnet || ""}"`.trim();
    log(`▶️ Executing: ${command}`);

    const { stdout, stderr } = await ssh.execCommand(command);
    if (stdout) log(`ℹ️ stdout: ${stdout}`);
    if (stderr) log(`⚠️ stderr: ${stderr}`);

    const ca = (await ssh.execCommand(`cat ${certPath}/ca.crt`)).stdout.trim();
    const cert = (
      await ssh.execCommand(`cat ${certPath}/${clientName}.crt`)
    ).stdout.trim();
    const key = (
      await ssh.execCommand(`cat ${certPath}/${clientName}.key`)
    ).stdout.trim();

    if (!ca || !cert || !key)
      throw new Error("Cert contents are empty or missing");

    log(`✅ Certs fetched successfully for ${clientName}`);

    res.json({ ca, cert, key, logs });
  } catch (err) {
    console.error("❌ Error during generation:", err);
    log(`❌ Exception: ${err.message}`);
    res
      .status(500)
      .json({ error: "Internal error while generating certificates.", logs });
  } finally {
    ssh.dispose();
    log("🔌 SSH connection closed\n");
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  logToFile("🟢 Server started");
});
