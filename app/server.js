const express = require("express");
const fs = require("fs");
const path = require("path");
const os = require("os");
const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public")); // for your HTML/CSS if served from /public

// Route to serve the form (optional if using static HTML)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Handle form submission
app.post("/connect", (req, res) => {
  const { server, customerName, azureSubnet, customerNetwork } = req.body;

  if (!server || !customerName || !azureSubnet || !customerNetwork) {
    return res.status(400).send("Missing required fields.");
  }

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
`;

  // Create a temporary file
  const fileName = `${customerName.replace(/\s+/g, "_")}_openvpn.ovpn`;
  const tempPath = path.join(os.tmpdir(), fileName);

  fs.writeFile(tempPath, vpnConfig, (err) => {
    if (err) {
      console.error("Error writing file:", err);
      return res.status(500).send("Failed to generate config.");
    }

    res.download(tempPath, fileName, (err) => {
      if (err) {
        console.error("Download error:", err);
      }

      // Clean up temp file
      fs.unlink(tempPath, () => {});
    });
  });
});

// Helper: map server name to IP
function getServerIP(name) {
  const serverIPs = {
    app1: "1.2.3.4",
    app2: "2.3.4.5",
    app3: "3.4.5.6",
  };
  return serverIPs[name] || "0.0.0.0";
}

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
