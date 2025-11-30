require('dotenv').config()
const express = require('express')
const fetch = require('node-fetch') // Use for making API calls
const app = express()
const PORT = 3000

// Middleware to parse incoming JSON payloads
app.use(express.json())

// --- Configuration from .env ---
const SERVER_SECRET = process.env.SERVER_SECRET
const TARGET_FILE = process.env.TARGET_FILE
const REPO_PO_OWNER = process.env.REPO_PO_OWNER
const REPO_PO_NAME = process.env.REPO_PO_NAME
const TARGET_BRANCH = process.env.TARGET_BRANCH || 'main'
const REPO_PO_API_PAT = process.env.REPO_PO_API_PAT // PAT for API authentication

const GITHUB_API_BASE = `https://api.github.com/repos/${REPO_PO_OWNER}/${REPO_PO_NAME}`

// -------------------------------

/**
 * Encodes string to Base64. GitHub API requires file content to be Base64 encoded.
 * @param {string} str - The string to encode.
 * @returns {string} Base64 encoded string.
 */
function base64Encode(str) {
    return Buffer.from(str).toString('base64')
}

// --- API Endpoint (Remains similar for security) ---
app.post('/api/process-commit', async (req, res) => {
    const token = req.header('X-Server-Token')
    const commitData = req.body
    console.log("-> token ", token)
    console.log("-> SERVER_SECRET ", SERVER_SECRET)
    // 1. Security Check: Validate the shared secret token
    if (!token || token !== SERVER_SECRET) {
        console.error('Unauthorized request received.')
        return res.status(401).json({ error: 'Unauthorized: Invalid token.' })
    }

    if (!commitData || !commitData.repository) {
        return res.status(400).json({ error: 'Bad Request: Missing commit data.' })
    }

    try {
        // 2. Process and Commit using GitHub API
        // await processAndCommit(commitData);
        
        console.log(`Successfully processed commit from ${commitData.repository}`)
        return res.status(200).json({ status: 'Success', message: 'Repo PO updated via API.' })

    } catch (error) {
        console.error('Error during GitHub API operations:', error.message)
        return res.status(500).json({ status: 'Error', message: 'Server failed to commit to Repo PO.', details: error.message })
    }
})


// --- Server Startup ---
app.listen(PORT, () => {
    console.log(`✅ Server is running on port ${PORT}. Endpoint: /api/process-commit`)
})