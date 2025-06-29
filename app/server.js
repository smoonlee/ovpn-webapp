const express = require("express");
const fs = require("fs").promises;
const path = require("path");
const os = require("os");
const { exec } = require("child_process");
const { DefaultAzureCredential } = require("@azure/identity");
const { SecretClient } = require("@azure/keyvault-secrets");
const { Client } = require('ssh2');

const app = express();
const PORT = process.env.PORT || 8080;

// Azure Key Vault configuration
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

// Server IP mapping
const serverIPs = {
  app1: "20.4.208.94",
  app2: "2.3.4.5",
  app3: "3.4.5.6",
};

// Function to retrieve SSH key from Key Vault
async function getSSHKey(keyName) {
  try {
    const secret = await secretClient.getSecret(keyName);
    return secret.value;
  } catch (error) {
    console.error('Error retrieving SSH key from Key Vault:', error.message);
    throw error;
  }
}

// Function to establish SSH connection
async function connectSSH(serverIP, privateKey) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    
    conn.on('ready', () => {
      console.log('SSH Connection established');
      resolve(conn);
    }).on('error', (err) => {
      console.error('SSH Connection error:', err);
      reject(err);
    }).connect({
      host: serverIP,
      username: process.env.SSH_USERNAME || 'appsvc_ovpn',
      privateKey: privateKey,
      algorithms: {
        kex: [
          'curve25519-sha256',
          'curve25519-sha256@libssh.org',
          'ecdh-sha2-nistp256',
          'ecdh-sha2-nistp384',
          'ecdh-sha2-nistp521',
          'diffie-hellman-group-exchange-sha256'
        ]
      }
    });
  });
}

// Connect endpoint to establish SSH connection
app.post('/connect', async (req, res) => {
  const { server } = req.body;
  const keyName = process.env.SSH_SECRET_NAME;
  
  if (!server || !keyName) {
    return res.status(400).json({ error: 'Server name and SSH_SECRET_NAME environment variable are required' });
  }

  const serverIP = serverIPs[server];
  if (!serverIP) {
    return res.status(404).json({ error: 'Server not found' });
  }

  try {
    // Retrieve SSH key from Key Vault
    const sshKey = await getSSHKey(keyName);
    
    // Establish SSH connection
    const connection = await connectSSH(serverIP, sshKey);
    
    // You might want to store the connection object in a session or handle it as needed
    res.json({ message: 'Successfully connected', server: serverIP });
    
    // Handle connection cleanup when needed
    connection.on('end', () => {
      console.log('SSH Connection ended');
    });
    
  } catch (error) {
    console.error('Connection error:', error);
    res.status(500).json({ error: 'Failed to establish connection', details: error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
