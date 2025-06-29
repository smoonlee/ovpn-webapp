const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// Map server names to their public IPs
const serverIPs = {
    app1: '1.2.3.4',
    app2: '2.3.4.5',
    app3: '3.4.5.6'
};

router.post('/', (req, res) => {
    const { server, customerName, azureSubnet, customerNetwork } = req.body;

    // Get the public IP for the selected server
    const serverIP = serverIPs[server];

    if (!serverIP) {
        return res.status(400).send('Invalid server selected.');
    }

    // Generate OpenVPN config file content
    const configFileContent = `
client
dev tun
proto udp
remote ${serverIP} 1194
resolv-retry infinite
nobind
persist-key
persist-tun
remote-cert-tls server
auth-user-pass
<ca>
# Insert CA certificate here
</ca>
<cert>
# Insert client certificate here
</cert>
<key>
# Insert client key here
</key>
`;

    // Ensure the temp folder exists
    const tempDir = path.join(__dirname, '..', 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir);
    }

    // Create a temporary file for the config
    const filePath = path.join(tempDir, `${customerName}-config.ovpn`);
    fs.writeFileSync(filePath, configFileContent);

    // Send the file as a download
    res.download(filePath, `${customerName}-config.ovpn`, (err) => {
        if (err) {
            console.error('Error sending file:', err);
            res.status(500).send('Error generating config file.');
        }

        // Clean up the temporary file
        fs.unlinkSync(filePath);
    });
});

module.exports = router;