const express = require("express");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { DefaultAzureCredential } = require("@azure/identity");
const { SecretClient } = require("@azure/keyvault-secrets");

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

// Helper: map server name to IP
function getServerIP(name) {
  const serverIPs = {
    app1: "1.2.3.4",
    app2: "2.3.4.5",
    app3: "3.4.5.6",
  };
  return serverIPs[name] || "0.0.0.0";
}

// Azure Key Vault helper to get SSH private key
async function getSSHKeyFromVault(vaultName, secretName) {
  const credential = new DefaultAzureCredential();
  const vaultUrl = `https://${vaultName}.vault.azure.net`;
  const client = new SecretClient(vaultUrl, credential);
  const secret = await client.getSecret(secretName);
  return secret.value;
}

// Route to serve the form (optional if you have index.html in /public)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// POST /connect - generate OpenVPN config and include SSH info
app.post("/connect", async (req, res) => {
  const { server, customerName, azureSubnet, customerNetwork } = req.body;

  if (!server || !customerName || !azureSubnet || !customerNetwork) {
    return res.status(400).send("Missing required fields.");
  }

  const vaultName = process.env.KEYVAULT_NAME;
  const secretName = process.env.SSH_SECRET_NAME;

  if (!vaultName || !secretName) {
    return res.status(500).send("Key Vault environment variables not set.");
  }

  try {
    // Fetch SSH private key from Key Vault
    const sshPrivateKey = await getSSHKeyFromVault(vaultName, secretName);
    console.log(
      `SSH private key fetched (first 30 chars): ${sshPrivateKey.substring(
        0,
        30
      )}...`
    );

    // Build SSH config comments
    const serverIPs = {
      app1: "1.2.3.4",
      app2: "2.3.4.5",
      app3: "3.4.5.6",
    };

    let sshConfigSection = "# SSH Configurations:\n";
    for (const [name, ip] of Object.entries(serverIPs)) {
      sshConfigSection += `# ${name} - ssh -i /path/to/private_key appsvc_ovpn@${ip}\n`;
    }

    // Build the OpenVPN config text
    const vpnConfig = `
client
dev tun
proto udp
remote ${getServerIP(server)} 1194
resolv-retry infinite
nobind
persist-key
persist-tun
remote-cert-tls server
cipher AES-256-CBC
verb 4

# Custom Metadata
# Customer Name: ${customerName}
# Azure Subnet: ${azureSubnet}
# Customer Network: ${customerNetwork}

${sshConfigSection}
`;

    // Create a temporary file
    const fileName = `${customerName.replace(/\s+/g, "_")}_openvpn.ovpn`;
    const tempPath = path.join(os.tmpdir(), fileName);

    // Write the file and send for download
    fs.writeFile(tempPath, vpnConfig, (err) => {
      if (err) {
        console.error("Error writing file:", err);
        return res.status(500).send("Failed to generate config.");
      }

      res.download(tempPath, fileName, (err) => {
        if (err) {
          console.error("Download error:", err);
        }
        // Clean up temp file after download
        fs.unlink(tempPath, () => {});
      });
    });
  } catch (error) {
    console.error("Error in /connect:", error);
    res.status(500).send("Failed to retrieve SSH key or generate config.");
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
