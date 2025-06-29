const express = require("express");
const fs = require("fs").promises;
const path = require("path");
const os = require("os");
const { exec } = require("child_process");
const { DefaultAzureCredential } = require("@azure/identity");
const { SecretClient } = require("@azure/keyvault-secrets");
const { Client } = require("ssh2");

// Utility function to convert CIDR to network and mask
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

  return {
    network: ip,
    mask: maskParts.join("."),
  };
}

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
    console.error("Error retrieving SSH key from Key Vault:", error.message);
    throw error;
  }
}

// Function to establish SSH connection
async function connectSSH(serverIP, privateKey) {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    conn
      .on("ready", () => {
        console.log("SSH Connection established");
        resolve(conn);
      })
      .on("error", (err) => {
        console.error("SSH Connection error:", err);
        reject(err);
      })
      .connect({
        host: serverIP,
        username: process.env.SSH_USERNAME || "appsvc_ovpn",
        privateKey: privateKey,
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

// Connect endpoint to establish SSH connection
app.post("/connect", async (req, res) => {
  const { server } = req.body;
  const keyName = process.env.SSH_SECRET_NAME;

  if (!server || !keyName) {
    return res
      .status(400)
      .json({
        error:
          "Server name and SSH_SECRET_NAME environment variable are required",
      });
  }

  const serverIP = serverIPs[server];
  if (!serverIP) {
    return res.status(404).json({ error: "Server not found" });
  }

  try {
    // Retrieve SSH key from Key Vault
    const sshKey = await getSSHKey(keyName);

    // Establish SSH connection
    const connection = await connectSSH(serverIP, sshKey);

    // Execute commands to create certificates and CCD profile
    try {
      const { customerName, customerNetwork, azureSubnet } = req.body;
      if (!customerName || !customerNetwork || !azureSubnet) {
        throw new Error(
          "Customer name, customer network, and Azure subnet are required"
        );
      }

      // Create logging directory if it doesn't exist
      await execCommand("mkdir -p /var/log/ovpnsetup");

      // Function to write to log file
      const writeToLog = async (message) => {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${message}\n`;
        await execCommand(
          `echo "${logEntry}" >> /var/log/ovpnsetup/${customerName}.log`
        );
      };

      // Create a function to execute commands and handle their output
      const execCommand = (cmd) => {
        return new Promise((resolve, reject) => {
          let timeoutId;
          const TIMEOUT_MS = 30000; // 30 seconds

          connection.exec(cmd, async (err, stream) => {
            if (err) {
              await writeToLog(
                `Error executing command: ${cmd}\nError: ${err.message}`
              );
              reject(err);
              return;
            }

            let output = "";

            // Set timeout
            timeoutId = setTimeout(async () => {
              stream.end();
              const timeoutError = `Command timed out after ${
                TIMEOUT_MS / 1000
              } seconds: ${cmd}\nPartial output: ${output}`;
              await writeToLog(timeoutError);
              reject(new Error(timeoutError));
            }, TIMEOUT_MS);

            stream.on("data", (data) => {
              output += data;
            });

            stream.stderr.on("data", (data) => {
              output += data;
            });

            stream.on("close", async () => {
              clearTimeout(timeoutId);
              await writeToLog(`Command completed: ${cmd}\nOutput: ${output}`);
              resolve(output);
            });

            stream.on("exit", async (code, signal) => {
              if (code !== 0) {
                clearTimeout(timeoutId);
                const errorMsg = `Command failed with code ${code}: ${cmd}\nOutput: ${output}`;
                await writeToLog(errorMsg);
                reject(new Error(errorMsg));
              }
            });
          });
        });
      };

      // Get CA password from Key Vault
      const caPassword = await getSSHKey("ovpn-ca");

      // Execute certificate creation commands
      console.log(`Creating certificates for customer: ${customerName}`);
      await writeToLog(
        `Starting certificate creation process for customer: ${customerName}`
      );
      await execCommand(
        `cd /etc/openvpn/easy-rsa && ./easyrsa --batch gen-req ${customerName} nopass`
      );
      await execCommand(
        `cd /etc/openvpn/easy-rsa && ./easyrsa --batch sign-req client ${customerName}`
      );

      // Create CCD profile
      const customerNetworkInfo = cidrToNetworkAndMask(customerNetwork);
      const azureSubnetInfo = cidrToNetworkAndMask(azureSubnet);

      const ccdContent = [
        `ifconfig-push ${customerNetworkInfo.network} ${customerNetworkInfo.mask}`,
        `push "route ${azureSubnetInfo.network} ${azureSubnetInfo.mask}"`,
      ].join("\n");

      await execCommand(
        `echo "${ccdContent}" > /etc/openvpn/ccd/${customerName}`
      );

      // Read generated certificates
      const clientKey = await execCommand(
        `cat /etc/openvpn/easy-rsa/pki/private/${customerName}.key`
      );
      const clientCert = await execCommand(
        `cat /etc/openvpn/easy-rsa/pki/issued/${customerName}.crt`
      );
      const caCert = await execCommand("cat /etc/openvpn/easy-rsa/pki/ca.crt");

      // Close the connection
      connection.end();

      res.json({
        message: "Successfully created certificates and CCD profile",
        server: serverIP,
        certificates: {
          clientKey: clientKey.trim(),
          clientCert: clientCert.trim(),
          caCert: caCert.trim(),
        },
      });
    } catch (sshError) {
      connection.end();
      throw new Error(`SSH Command execution failed: ${sshError.message}`);
    }

    // Handle connection cleanup when needed
    connection.on("end", () => {
      console.log("SSH Connection ended");
    });
  } catch (error) {
    console.error("Connection error:", error);
    res
      .status(500)
      .json({
        error: "Failed to establish connection",
        details: error.message,
      });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
