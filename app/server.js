const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const { DefaultAzureCredential } = require("@azure/identity");
const { SecretClient } = require("@azure/keyvault-secrets");
const { Client } = require("ssh2");
const { body, validationResult } = require("express-validator");
const winston = require("winston");

const app = express();
const PORT = process.env.PORT || 3000;

// Configure logging
const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" }),
  ],
});

// Middleware
app.use(express.json());
app.use(express.static("../public"));

// Configuration
const keyVaultUrl = process.env.KEY_VAULT_URL;
const vmHostname = process.env.VM_HOSTNAME;
const vmUsername = process.env.VM_USERNAME;
const sshKeySecretName = "ssh-private-key";

const applicationConfigs = {
  app1: { startIp: "10.0.1.0" },
  app2: { startIp: "10.0.2.0" },
  app3: { startIp: "10.0.3.0" },
};

// Initialize Azure Key Vault client with Managed Identity
const credential = new DefaultAzureCredential();
const secretClient = new SecretClient(keyVaultUrl, credential);

// Validation middleware
const validateRequest = [
  body("clientId").isString().trim().notEmpty(),
  body("application").isIn(["app1", "app2", "app3"]),
  body("azureSubnet").matches(/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/),
  body("clientSubnet").matches(/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/),
];

// Generate OpenVPN config
async function generateOpenVPNConfig(params) {
  try {
    // Get SSH private key from Key Vault
    const privateKey = await secretClient.getSecret(sshKeySecretName);

    return new Promise((resolve, reject) => {
      const conn = new Client();

      conn
        .on("ready", () => {
          const command = `sudo ovpn-generate-config.sh ${params.clientId} ${params.application} ${params.azureSubnet} ${params.clientSubnet}`;

          conn.exec(command, (err, stream) => {
            if (err) {
              logger.error("SSH exec error:", err);
              reject(err);
              return;
            }

            let config = "";
            stream
              .on("data", (data) => {
                config += data;
              })
              .on("end", () => {
                resolve(config);
              })
              .stderr.on("data", (data) => {
                logger.error("SSH stderr:", data.toString());
              });
          });
        })
        .on("error", (err) => {
          logger.error("SSH connection error:", err);
          reject(err);
        })
        .connect({
          host: vmHostname,
          username: vmUsername,
          privateKey: privateKey.value,
          algorithms: {
            kex: [
              "ecdh-sha2-nistp256",
              "ecdh-sha2-nistp384",
              "ecdh-sha2-nistp521",
              "diffie-hellman-group-exchange-sha256",
            ],
          },
        });
    });
  } catch (error) {
    logger.error("Error generating OpenVPN config:", error);
    throw error;
  }
}

// API endpoint to generate OpenVPN config
app.post(
  "/api/generate-config",
  validateRequest,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { clientId, application, azureSubnet, clientSubnet } = req.body;

      // Check if application exists
      if (!applicationConfigs[application]) {
        return res.status(400).json({ error: "Invalid application" });
      }

      const config = await generateOpenVPNConfig({
        clientId,
        application,
        azureSubnet,
        clientSubnet,
      });

      res.setHeader("Content-Type", "application/x-openvpn-profile");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=${clientId}-${application}.ovpn`
      );
      res.send(config);
    } catch (error) {
      logger.error("Error in generate-config endpoint:", error);
      res
        .status(500)
        .json({ error: "Failed to generate OpenVPN configuration" });
    }
  }
);

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy" });
});

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
