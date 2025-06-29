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
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

// Handle POST request to /connect
app.post("/connect", (req, res) => {
  const { server, customerName, azureSubnet, customerNetwork } = req.body;

  // For demo, just send back the received data as JSON:
  res.send({
    message: "Form data received successfully",
    server,
    customerName,
    azureSubnet,
    customerNetwork,
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
