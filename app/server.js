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

// Load server IPs from environment variables
const serverIPs = {
  app1: process.env.OVPN_SERVER1_IP,
  app2: process.env.OVPN_SERVER2_IP,
  app3: process.env.OVPN_SERVER3_IP,
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

// Function to validate CIDR notation
function validateCIDR(cidr) {
  const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
  if (!cidrRegex.test(cidr)) {
    throw new Error("Invalid CIDR format");
  }
  const [ip, bits] = cidr.split("/");
  const parts = ip.split(".");
  const validIP = parts.every((part) => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255;
  });
  const validBits = parseInt(bits, 10) >= 0 && parseInt(bits, 10) <= 32;
  if (!validIP || !validBits) {
    throw new Error("Invalid IP address or subnet mask bits");
  }
}

// Connect endpoint to establish SSH connection
app.post("/connect", async (req, res) => {
  const { server, customerName, customerNetwork, azureSubnet } = req.body;
  const keyName = process.env.SSH_SECRET_NAME;

  // Validate required fields
  if (!server || !keyName || !customerName || !customerNetwork || !azureSubnet) {
    return res.status(400).json({
      error:
        "Server name, customer name, customer network, Azure subnet, and SSH_SECRET_NAME are required",
    });
  }

  // Validate CIDR formats
  try {
    validateCIDR(customerNetwork);
    validateCIDR(azureSubnet);
  } catch (error) {
    return res.status(400).json({ error: error.message });
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
      // Simple logging function that doesn't use SSH commands
      const logToConsole = (message) => {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] ${message}`);
      };

      // Function to execute SSH commands with proper error handling
      const execCommand = (cmd) => {
        logToConsole(`Executing command: ${cmd}`);
        return new Promise((resolve, reject) => {
          let timeoutId;
          const TIMEOUT_MS = 30000; // 30 seconds

          connection.exec(cmd, async (err, stream) => {
            if (err) {
              logToConsole(`Error executing command: ${cmd}\nError: ${err.message}`);
              reject(err);
              return;
            }

            let output = "";

            // Set timeout
            timeoutId = setTimeout(() => {
              stream.end();
              const timeoutError = `Command timed out after ${
                TIMEOUT_MS / 1000
              } seconds: ${cmd}\nPartial output: ${output}`;
              logToConsole(timeoutError);
              reject(new Error(timeoutError));
            }, TIMEOUT_MS);

            stream.on("data", (data) => { output += data;});

            stream.stderr.on("data", (data) => { output += data; });

            stream.on("close", () => {
              clearTimeout(timeoutId);
              logToConsole(`Command completed: ${cmd}\nOutput: ${output}`);
              resolve(output);
            });

            stream.on("exit", (code, signal) => {
              if (code !== 0) {
                clearTimeout(timeoutId);
                const errorMsg = `Command failed with code ${code}: ${cmd}\nOutput: ${output}`;
                logToConsole(errorMsg);
                reject(new Error(errorMsg));
              }
            });
          });
        });
      };

      // Function to write to log file
      const writeToLog = async (message) => {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${message}`;
        logToConsole(logEntry);
        // First ensure the directory exists
        await execCommand("mkdir -p /var/log/ovpnsetup");
        // Then write the log
        return execCommand(
          `echo "${logEntry}" >> /var/log/ovpnsetup/${customerName}.log`
        );
      };

      // Create logging directory if it doesn't exist
      console.log("[Debug] Creating initial logging directory");
      await execCommand("mkdir -p /var/log/ovpnsetup");

      // Cleanup existing certificates and configuration if they exist
      console.log("[Debug] Cleaning up any existing certificates and configuration");
      await writeToLog(`Cleaning up existing configuration for customer: ${customerName}`);
      
      // Remove existing CCD file
      await execCommand(`rm -f /etc/openvpn/ccd/${customerName}`);
      
      // Remove existing certificates and key
      await execCommand(`cd /etc/openvpn/easy-rsa && ./easyrsa --batch revoke ${customerName} || true`);
      await execCommand(`rm -f /etc/openvpn/easy-rsa/pki/private/${customerName}.key`);
      await execCommand(`rm -f /etc/openvpn/easy-rsa/pki/issued/${customerName}.crt`);
      await execCommand(`rm -f /etc/openvpn/easy-rsa/pki/reqs/${customerName}.req`);
      
      // Remove existing routes (ignoring errors if route doesn't exist)
      const existingRoute = await execCommand(`ip route show | grep "^${customerNetworkInfo.network}/${customerNetwork.split("/")[1]} dev tun0" || true`);
      if (existingRoute.trim()) {
        await execCommand(`sudo ip route del ${customerNetworkInfo.network}/${customerNetwork.split("/")[1]} dev tun0 || true`);
      }

      // Execute certificate creation commands
      console.log("[Debug] Starting certificate creation process");
      await writeToLog(`Starting certificate creation process for customer: ${customerName}`);

      console.log("[Debug] Generating certificate request");
      await execCommand(`cd /etc/openvpn/easy-rsa && ./easyrsa --batch gen-req ${customerName} nopass`);

      console.log("[Debug] Signing certificate request");
      await execCommand(`cd /etc/openvpn/easy-rsa && ./easyrsa --batch sign-req client ${customerName}`);

      // Create CCD profile
      const customerNetworkInfo = cidrToNetworkAndMask(customerNetwork);
      const azureSubnetInfo = cidrToNetworkAndMask(azureSubnet);

      const ccdContent = [
        `ifconfig-push ${customerNetworkInfo.network} ${customerNetworkInfo.mask}`,
        `push "route ${azureSubnetInfo.network} ${azureSubnetInfo.mask}"`,
      ].join("\n");

      console.log("[Debug] Creating CCD profile");
      await execCommand(`echo "${ccdContent}" > /etc/openvpn/ccd/${customerName}`);

    // Add IP route for client network via tun0
    console.log("[Debug] Adding IP route");
    await writeToLog(`Adding IP route for client network: ${customerNetworkInfo.network}/${customerNetwork.split("/")[1]}`);

    console.log("[Debug] Executing IP route command");
    await execCommand(`sudo ip route add ${customerNetworkInfo.network}/${customerNetwork.split("/")[1]} dev tun0`);

      // Read generated certificates
      console.log("[Debug] Reading client key");
      const clientKey = await execCommand(`cat /etc/openvpn/easy-rsa/pki/private/${customerName}.key | awk '/BEGIN PRIVATE KEY/,/END PRIVATE KEY/'`);
      
      console.log("[Debug] Reading client certificate");
      // Using grep -A and sed to get just the certificate content
      const clientCert = await execCommand(`cat /etc/openvpn/easy-rsa/pki/issued/${customerName}.crt | grep -A 1000 "BEGIN CERTIFICATE" | grep -B 1000 "END CERTIFICATE" | grep -v "Signature Algorithm" | grep -v "Data:" | grep -v "Serial Number:" | grep -v "Version:" | grep -v "Issuer:" | grep -v "Validity" | grep -v "Subject:" | grep -v "Not " | grep -v "Public Key" | grep -v "Modulus:" | grep -v "Subject Public" | grep -v "Exponent:" | grep -v "X509v3" | grep -v "keyid:" | grep -v "DirName:" | grep -v "serial:" | grep -v "Digital" | grep -v "CA:" | grep -v "Signature Value:" | sed '/^[[:space:]]*$/d'`);
      
      console.log("[Debug] Reading CA certificate");
      const caCert = await execCommand(`cat /etc/openvpn/easy-rsa/pki/ca.crt | awk '/BEGIN CERTIFICATE/,/END CERTIFICATE/'`);

      // Create OVPN configuration
      const ovpnConfig = [
        "client",
        "dev tun",
        "proto tcp",
        "remote " + serverIP + " 1194",
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
        "",
        "<cert>",
        clientCert.trim(),
        "</cert>",
        "",
        "<key>",
        clientKey.trim(),
        "</key>",
        "",
      ].join("\n");

      // Close the connection
      connection.end();

      res.set({
        'Content-Type': 'application/x-openvpn-profile',
        'Content-Disposition': `attachment; filename="${customerName}.ovpn"`,
      });
      res.send(ovpnConfig);
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
