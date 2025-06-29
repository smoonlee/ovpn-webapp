const express = require("express");
const fs = require("fs").promises;
const path = require("path");
const os = require("os");
const { exec } = require("child_process");
const { DefaultAzureCredential } = require("@azure/identity");
const { SecretClient } = require("@azure/keyvault-secrets");

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Server IP mapping
const serverIPs = {
  app1: "20.4.208.94",
  app2: "2.3.4.5",
  app3: "3.4.5.6",
};

function getServerIP(name) {
  return serverIPs[name] || "0.0.0.0";
}

// Fetch SSH private key from Azure Key Vault
async function getSSHKeyFromVault(vaultName, secretName) {
  const credential = new DefaultAzureCredential();
  const vaultUrl = `https://${vaultName}.vault.azure.net`;
  const client = new SecretClient(vaultUrl, credential);
  const secret = await client.getSecret(secretName);
  return secret.value;
}

// POST /connect - start SSH session and respond with a message
app.post("/connect", async (req, res) => {
  console.log('Received POST request to /connect');
  console.log('Request body:', req.body);
  
  const { server, customerName, azureSubnet, customerNetwork } = req.body;

  if (!server || !customerName || !azureSubnet || !customerNetwork) {
    console.log('Missing fields:', { server, customerName, azureSubnet, customerNetwork });
    return res.status(400).send("Missing required fields.");
  }

  const vaultName = process.env.KEYVAULT_NAME;
  const secretName = process.env.SSH_SECRET_NAME;
  
  console.log('Environment Variables Check:');
  console.log('KEYVAULT_NAME:', vaultName || 'not set');
  console.log('SSH_SECRET_NAME:', secretName || 'not set');
  console.log('All environment variables:', process.env);

  if (!vaultName || !secretName) {
    return res.status(500).send("Key Vault environment variables not set.");
  }

  try {
    // Fetch SSH private key
    const sshPrivateKey = await getSSHKeyFromVault(vaultName, secretName);

    // Write private key to a temp file with proper permissions
    const tempKeyPath = path.join(
      os.tmpdir(),
      `${customerName.replace(/\s+/g, "_")}_id_rsa`
    );
    await fs.writeFile(tempKeyPath, sshPrivateKey, { mode: 0o600 });

    // Start SSH connection (server-side)
    const serverIP = getServerIP(server);
    const sshCommand = `ssh -i ${tempKeyPath} -o appsvc_ovpn@${serverIP}`;

    console.log(`Starting SSH session to ${server} at ${serverIP}...`);

    const sshProcess = exec(sshCommand, (error, stdout, stderr) => {
      if (error) {
        console.error(`SSH error: ${error.message}`);
        return;
      }
      if (stderr) {
        console.error(`SSH stderr: ${stderr}`);
      }
      console.log(`SSH stdout: ${stdout}`);
    });

    sshProcess.stdout.pipe(process.stdout);
    sshProcess.stderr.pipe(process.stderr);
    sshProcess.stdin.pipe(process.stdin);

    sshProcess.on("exit", async () => {
      await fs.unlink(tempKeyPath).catch(() => {});
      console.log("SSH session ended and private key cleaned up.");
    });

    // Respond immediately to the client
    res.json({ message: "ssh_auth completed" });
  } catch (error) {
    console.error("Error in /connect:", error);
    res.status(500).send("Failed to retrieve SSH key or start SSH session.");
  }
});

// Serve your index.html at root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
