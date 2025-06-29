const express = require('express');
const { ManagedIdentityCredential } = require('@azure/identity');
const { SecretClient } = require('@azure/keyvault-secrets');

// Express app setup
const app = express();
app.use(express.json());
app.use(express.static('public'));

// Azure Key Vault configuration
const KEY_VAULT_NAME = process.env.KEY_VAULT_NAME;
const MANAGED_IDENTITY_CLIENT_ID = process.env.MANAGED_IDENTITY_CLIENT_ID;
const SSH_KEY_SECRET_NAME = process.env.SSH_KEY_SECRET_NAME || 'ssh-key-secret';

if (!KEY_VAULT_NAME) {
    throw new Error('KEY_VAULT_NAME environment variable is required');
}

if (!MANAGED_IDENTITY_CLIENT_ID) {
    throw new Error('MANAGED_IDENTITY_CLIENT_ID environment variable is required');
}

// Initialize Key Vault client with User Managed Identity
const credential = new ManagedIdentityCredential(MANAGED_IDENTITY_CLIENT_ID);
const keyVaultUrl = `https://${KEY_VAULT_NAME}.vault.azure.net`;
const secretClient = new SecretClient(keyVaultUrl, credential);

// Middleware for error handling
app.use((err, req, res, next) => {
    console.error('Error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
});

// Route to get SSH key from Key Vault
app.get('/api/ssh-key', async (req, res) => {
    try {
        // Implement retry logic with exponential backoff
        const maxRetries = 3;
        let currentTry = 0;
        let lastError = null;

        while (currentTry < maxRetries) {
            try {
                console.log(`Attempting to fetch SSH key secret (attempt ${currentTry + 1}/${maxRetries})`);
                const secret = await secretClient.getSecret(SSH_KEY_SECRET_NAME);
                return res.json({ success: true, key: secret.value });
            } catch (error) {
                lastError = error;
                if (error.code === 'REQUEST_SEND_ERROR') {
                    // Exponential backoff
                    const waitTime = Math.pow(2, currentTry) * 1000;
                    console.log(`Retrying after ${waitTime}ms...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    currentTry++;
                } else {
                    // Non-retriable error
                    throw error;
                }
            }
        }
        throw lastError;
    } catch (error) {
        console.error('Failed to fetch SSH key:', error.message);
        
        // Send appropriate error response based on the error type
        if (error.code === 'SecretNotFound') {
            res.status(404).json({ error: 'SSH key secret not found in Key Vault' });
        } else if (error.code === 'Unauthorized') {
            res.status(401).json({ error: 'Not authorized to access Key Vault' });
        } else {
            res.status(500).json({ error: 'Failed to fetch SSH key' });
        }
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'healthy' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Using Key Vault: ${keyVaultUrl}`);
});