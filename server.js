const express = require("express");
const bodyParser = require("body-parser");
const { NodeSSH } = require("node-ssh");
const { DefaultAzureCredential } = require("@azure/identity");
const { SecretClient } = require("@azure/keyvault-secrets");

const app = express();
const ssh = new NodeSSH();
const PORT = process.env.PORT || 3000;

// Enable static frontend hosting
app.use(express.static("public"));
app.use(bodyParser.json({ limit: "1mb" }));

// VPN server details
const vpnHosts = {
  exos: { host: "135.236.23.132", username: "ubuntu" },
  matrix: { host: "132.220.32.199", username: "ubuntu" },
  atimo: { host: "132.220.15.55", username: "ubuntu" },
};

// Azure Key Vault config
const keyVaultName = process.env.KEYVAULT_NAME || "kv-ovpn-webapp-dev";
const vaultUrl = `https://${keyVaultName}.vault.azure.net`;
const secretClient = new SecretClient(vaultUrl, new DefaultAzureCredential());

async function getSshPrivateKey() {
  const secret = await secretClient.getSecret("ssh-private-key");
  return secret.value;
}

// API route: generate OpenVPN certs
app.post("/api/generate", async (req, res) => {
  const { clientName, serverName } = req.body;

  if (!clientName || !serverName || !vpnHosts[serverName]) {
    return res
      .status(400)
      .json({ error: "Missing or invalid clientName/serverName" });
  }

  const { host, username } = vpnHosts[serverName];

  try {
    const sshPrivateKey = await getSshPrivateKey();

    await ssh.connect({
      host,
      username,
      privateKey: sshPrivateKey,
    });

    const scriptPath = `/etc/openvpn/generate-client.sh`;
    const certPath = `/etc/openvpn/client-certs/${clientName}`;

    // Generate the client certs
    await ssh.execCommand(`bash ${scriptPath} ${clientName}`);

    // Read cert files
    const ca = (await ssh.execCommand(`cat ${certPath}/ca.crt`)).stdout.trim();
    const cert = (
      await ssh.execCommand(`cat ${certPath}/${clientName}.crt`)
    ).stdout.trim();
    const key = (
      await ssh.execCommand(`cat ${certPath}/${clientName}.key`)
    ).stdout.trim();

    res.json({ ca, cert, key });
  } catch (err) {
    console.error("Failed to generate certs:", err);
    res
      .status(500)
      .json({ error: "Internal error while generating certificates." });
  } finally {
    ssh.dispose();
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
