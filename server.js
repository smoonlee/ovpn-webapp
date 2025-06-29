const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const { NodeSSH } = require("node-ssh");
const { DefaultAzureCredential } = require("@azure/identity");
const { SecretClient } = require("@azure/keyvault-secrets");

const app = express();
const PORT = process.env.PORT || 3000;

// Static frontend hosting
app.use(express.static("public"));
app.use(bodyParser.json({ limit: "1mb" }));

// VPN server lookup
const vpnHosts = {
  exos: { host: "20.4.208.94", username: "appsvc_ovpn" },
  matrix: { host: "132.220.32.199", username: "appsvc_ovpn" },
  atimo: { host: "132.220.15.55", username: "appsvc_ovpn" },
};

// Managed Identity Client ID (for User-Assigned Managed Identity)
const managedIdentityClientId = process.env.MANAGED_IDENTITY_CLIENT_ID;

// Azure Key Vault info
const keyVaultName = process.env.KEYVAULT_NAME || "kv-ovpn-webapp-dev";
const vaultUrl = `https://${keyVaultName}.vault.azure.net`;

// Create credential once
const credential = new DefaultAzureCredential({
  managedIdentityClientId: managedIdentityClientId,
});

const secretClient = new SecretClient(vaultUrl, credential);

async function getSshPrivateKey() {
  try {
    const secret = await secretClient.getSecret("ssh-private-key");
    logToFile("✅ Successfully retrieved SSH key from Key Vault");
    if (!secret.value || secret.value.trim() === '') {
      throw new Error("SSH key from Key Vault is empty");
    }
    return secret.value;
  } catch (err) {
    logToFile(`❌ Failed to get SSH key from Key Vault: ${err.message}`);
    throw new Error(`Key Vault error: ${err.message}`);
  }
}

// Logging
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

// Function to validate IP network
function isValidNetwork(network) {
  if (!network) return true; // Optional parameter
  const ipNetworkRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
  if (!ipNetworkRegex.test(network)) return false;

  const [ip, mask] = network.split("/");
  const maskNum = parseInt(mask);
  if (maskNum < 0 || maskNum > 32) return false;

  const parts = ip.split(".");
  return parts.every((part) => {
    const num = parseInt(part);
    return num >= 0 && num <= 255;
  });
}

// Function to create CCD configuration
async function createCcdConfig(ssh, clientName, customerNetwork, azureSubnet) {
  try {
    const ccdDir = "/etc/openvpn/ccd";
    const ccdPath = `${ccdDir}/${clientName}`;

    // Ensure CCD directory exists
    await ssh.execCommand(`sudo mkdir -p ${ccdDir}`);

    let ccdContent = "";

    if (customerNetwork && isValidNetwork(customerNetwork)) {
      const [network, mask] = customerNetwork.split("/");
      ccdContent += `iroute ${network} ${mask}\n`;
    }

    if (azureSubnet && isValidNetwork(azureSubnet)) {
      const [network, mask] = azureSubnet.split("/");
      ccdContent += `push "route ${network} ${mask}"\n`;
    }

    if (ccdContent) {
      await ssh.execCommand(`echo '${ccdContent}' | sudo tee ${ccdPath}`);
      await ssh.execCommand(`sudo chmod 644 ${ccdPath}`);
      return true;
    }

    return false;
  } catch (err) {
    throw new Error(`Failed to create CCD config: ${err.message}`);
  }
}

// Function to test SSH key format
function validateSshKey(key) {
  // Basic SSH private key format check
  const isRsa = key.includes('-----BEGIN RSA PRIVATE KEY-----');
  const isOpenssh = key.includes('-----BEGIN OPENSSH PRIVATE KEY-----');
  const isEc = key.includes('-----BEGIN EC PRIVATE KEY-----');
  const isDsa = key.includes('-----BEGIN DSA PRIVATE KEY-----');
  const isPkcs8 = key.includes('-----BEGIN PRIVATE KEY-----');

  if (!isRsa && !isOpenssh && !isEc && !isDsa && !isPkcs8) {
    throw new Error('Invalid SSH key format');
  }
  
  return true;
}

// Main API endpoint
app.post("/api/generate", async (req, res) => {
  const { clientName, serverName, customerNetwork, azureSubnet } = req.body;
  logToFile(
    `📥 Request: clientName=${clientName}, serverName=${serverName}, customerNetwork=${customerNetwork}, azureSubnet=${azureSubnet}`
  );

  // Validate inputs
  if (!clientName || !serverName || !vpnHosts[serverName]) {
    logToFile("❌ Invalid request parameters");
    return res
      .status(400)
      .json({ error: "Missing or invalid clientName/serverName" });
  }

  if (customerNetwork && !isValidNetwork(customerNetwork)) {
    logToFile("❌ Invalid customer network format");
    return res.status(400).json({ error: "Invalid customer network format" });
  }

  if (azureSubnet && !isValidNetwork(azureSubnet)) {
    logToFile("❌ Invalid Azure subnet format");
    return res.status(400).json({ error: "Invalid Azure subnet format" });
  }

  const { host, username } = vpnHosts[serverName];
  const ssh = new NodeSSH();

  try {
    logToFile(`🔄 Starting SSH connection process to ${host}`);
    
    // Get and validate SSH key
    const sshPrivateKey = await getSshPrivateKey();
    
    try {
      validateSshKey(sshPrivateKey);
      logToFile("✅ SSH key format validation passed");
    } catch (err) {
      logToFile(`❌ SSH key validation failed: ${err.message}`);
      throw new Error(`Invalid SSH key format: ${err.message}`);
    }

    // Test DNS resolution
    try {
      logToFile(`🔄 Testing DNS resolution for ${host}`);
      await new Promise((resolve, reject) => {
        require('dns').resolve(host, (err, addresses) => {
          if (err) {
            logToFile(`❌ DNS resolution failed for ${host}: ${err.message}`);
            reject(new Error(`DNS resolution failed: ${err.message}`));
          } else {
            logToFile(`✅ DNS resolved ${host} to ${addresses.join(', ')}`);
            resolve(addresses);
          }
        });
      });
    } catch (err) {
      throw new Error(`Host resolution failed: ${err.message}`);
    }

    // Attempt SSH connection with timeout and detailed logging
    try {
      logToFile(`🔄 Attempting SSH connection to ${host} as ${username}`);
      await ssh.connect({
        host,
        username,
        privateKey: sshPrivateKey,
        readyTimeout: 20000, // 20 second timeout
        debug: (message) => logToFile(`📡 SSH Debug: ${message}`),
      });
      logToFile(`✅ SSH connected to ${host} as ${username}`);
    } catch (err) {
      logToFile(`❌ SSH connection failed: ${err.message}`);
      throw new Error(`SSH connection failed: ${err.message}`);
    }

    const scriptPath = "/etc/openvpn/generate-client.sh";
    const certPath = `/etc/openvpn/client-certs/${clientName}`;

    // Generate certificates
    const command = `bash ${scriptPath} ${clientName} "${
      customerNetwork || ""
    }" "${azureSubnet || ""}"`.trim();
    logToFile(`▶️ Executing: ${command}`);

    const { stdout, stderr } = await ssh.execCommand(command);
    if (stdout) logToFile(`ℹ️ stdout: ${stdout}`);
    if (stderr) logToFile(`⚠️ stderr: ${stderr}`);

    // Create CCD configuration if needed
    if (customerNetwork || azureSubnet) {
      logToFile("📝 Creating CCD configuration...");
      const ccdCreated = await createCcdConfig(
        ssh,
        clientName,
        customerNetwork,
        azureSubnet
      );
      if (ccdCreated) {
        logToFile("✅ CCD configuration created successfully");
      }
    }

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

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  logToFile("🟢 Server started");
});
