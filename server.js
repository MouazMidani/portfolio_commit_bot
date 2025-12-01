require('dotenv').config()
const express = require('express')
const axios = require('axios')
const app = express()
const PORT = process.env.PORT || 3000

// Middleware to parse incoming JSON payloads
app.use(express.json())

// --- Configuration from .env ---
const SERVER_SECRET = process.env.SERVER_SECRET
const REPO_PO_OWNER = process.env.REPO_PO_OWNER || 'MouazMidani'
const REPO_PO_NAME = process.env.REPO_PO_NAME || 'Portfolio'
const TARGET_BRANCH = process.env.TARGET_BRANCH || 'main'
const REPO_PO_API_PAT = process.env.REPO_PO_API_PAT

const GITHUB_API_BASE = `https://api.github.com/repos/${REPO_PO_OWNER}/${REPO_PO_NAME}`

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'

// Project to repository mapping
const PROJECT_REPO_MAP = {
    'MouazMidani/testRepo': 3, // Labelify AI
    'MouazMidani/React_Practice_TrendingMovies': 5,
    'MouazMidani/React_Practice_Storify': 6,
    'MouazMidani/React_Practice_Foodies': 7
}

// -------------------------------

/**
 * Fetches grouped commits from the source repository
 */
async function fetchCommitHistory(repository, since) {
    const response = await axios.get(
        `https://api.github.com/repos/${repository}/commits`,
        {
            params: { since, per_page: 100 },
            headers: {
                'Authorization': `token ${REPO_PO_API_PAT}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        }
    )
    return response.data
}

/**
 * Groups commits by date
 */
function groupCommitsByDate(commits) {
    const grouped = {}
    
    commits.forEach(commit => {
        const date = commit.commit.author.date.split('T')[0] // YYYY-MM-DD
        if (!grouped[date]) {
            grouped[date] = []
        }
        grouped[date].push({
            message: commit.commit.message,
            sha: commit.sha.substring(0, 7),
            author: commit.commit.author.name
        })
    })
    
    return grouped
}

/**
 * Calls Gemini API to generate history entry from commits
 */
async function generateHistoryEntry(existingHistory, projectContext, newHistoryEntries) {
    const prompt = `You are an expert developer updating a portfolio project history.

    PROJECT CONTEXT:
    ${JSON.stringify(projectContext, null, 2)}

    EXISTING HISTORY ENTRIES (for reference):
    ${JSON.stringify(existingHistory.slice(-3), null, 2)}

    ${newHistoryEntries.map(h => `NEW COMMITS FOR ${h.date}: 
        ${h.dateCommits.map(c => `- ${c.message} (${c.sha})`).join('\n')}    
    `)}

    TASK: Create new history entries that follows the EXACT structure of existing entries. The entry should:
    1. Use date: "group of commits date."
    2. Create a concise, descriptive title summarizing the day's work
    3. Write a 1-2 sentence description of what was accomplished
    4. List specific accomplishments based on commit messages (be detailed and technical)
    5. Increment the id from the last entry (last id was: ${existingHistory[existingHistory.length - 1]?.id || 0})

    IMPORTANT FORMATTING RULES:
    - Return ONLY valid JSON array for all the date groups.
    - Match the exact structure of existing entries
    - Use an empty array for screenshots: []
    - Be specific about technologies and features mentioned in commits
    - Group related commits into coherent accomplishment points
    - Use technical language appropriate for a developer portfolio

    Return ONLY the JSON object for the new history entry, nothing else.`

    const response = await axios.post(
        `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
        {
            contents: [{
                parts: [{
                    text: prompt
                }]
            }],
            generationConfig: {
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 2048,
            }
        },
        {
            headers: {
                'Content-Type': 'application/json'
            }
        }
    )

    const generatedText = response.data.candidates[0].content.parts[0].text
    
    console.log('Gemini response:', generatedText)
    
    // Extract JSON from response (remove markdown code blocks if present)
    let jsonMatch = generatedText.match(/```json\s*([\s\S]*?)\s*```/)
    if (jsonMatch) {
        return JSON.parse(jsonMatch[1])
    }
    
    jsonMatch = generatedText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
        throw new Error('Failed to extract JSON from Gemini response')
    }
    
    return JSON.parse(jsonMatch[0])
}

/**
 * Finds the ProjectsData.tsx file in the repository
 */
async function findProjectsDataFile() {
    const possiblePaths = [
        'app/projectsData.json',
        'src/data/projectsData.json',
        'data/projectsData.json',
        'projectsData.json',
        'src/projectsData.json'
    ]
    
    console.log(`\nSearching for ProjectsData.tsx in ${REPO_PO_OWNER}/${REPO_PO_NAME}`)
    console.log(`Branch: ${TARGET_BRANCH}`)
    console.log(`Has PAT: ${!!REPO_PO_API_PAT}`)
    
    for (const path of possiblePaths) {
        try {
            const url = `${GITHUB_API_BASE}/contents/${path}`
            console.log(`\nTrying: ${url}?ref=${TARGET_BRANCH}`)
            
            const response = await axios.get(
                url,
                {
                    params: { ref: TARGET_BRANCH },
                    headers: {
                        'Authorization': `token ${REPO_PO_API_PAT}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                }
            )
            console.log(`✅ SUCCESS! Found ProjectsData.tsx at: ${path}`)
            return { path, data: response.data }
        } catch (error) {
            if (error.response) {
                console.log(`❌ ${path}: ${error.response.status} - ${error.response.statusText}`)
                if (error.response.data) {
                    console.log(`   Message: ${error.response.data.message}`)
                }
            } else {
                console.log(`❌ ${path}: ${error.message}`)
            }
        }
    }
    
    console.error('\n❌ Could not find ProjectsData.tsx in any location!')
    console.error('Checked paths:', possiblePaths)
    console.error('Make sure:')
    console.error('1. REPO_PO_OWNER is set to:', REPO_PO_OWNER)
    console.error('2. REPO_PO_NAME is set to:', REPO_PO_NAME)
    console.error('3. TARGET_BRANCH is set to:', TARGET_BRANCH)
    console.error('4. REPO_PO_API_PAT has correct permissions (repo scope)')
    
    throw new Error('Could not find ProjectsData.tsx in any common location')
}

/**
 * Updates the ProjectsData.tsx file with new history entries
 */
async function updateProjectsDataFile(projectId, newHistoryEntries, jsonFilePath) {
    console.log(`Fetching projectsData.json from ${jsonFilePath}...`)
    
    const getFileResponse = await axios.get(
        `${GITHUB_API_BASE}/contents/${jsonFilePath}`,
        {
            params: { ref: TARGET_BRANCH },
            headers: {
                'Authorization': `token ${REPO_PO_API_PAT}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        }
    )

    const fileData = getFileResponse.data
    const projectsData = JSON.parse(
        Buffer.from(fileData.content, 'base64').toString('utf8')
    )
    console.log("-> projectsData: ", projectsData)
    const project = projectsData.find(p => p.id === projectId)
    if (!project) {
        throw new Error(`Could not find project with id ${projectId}`)
    }
    
    project.history.push(...newHistoryEntries)
    
    await axios.put(
        `${GITHUB_API_BASE}/contents/${jsonFilePath}`,
        {
            message: `Auto-update: Add project history for ${new Date().toISOString().split('T')[0]}`,
            content: Buffer.from(JSON.stringify(projectsData, null, 2)).toString('base64'),
            sha: fileData.sha,
            branch: TARGET_BRANCH
        },
        {
            headers: {
                'Authorization': `token ${REPO_PO_API_PAT}`,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github.v3+json'
            }
        }
    )

    console.log('✅ Successfully updated projectsData.json')
}

/**
 * Parse project data from file content
 */
function parseProjectData(content, projectId) {
    try {
        // Parse the JSON content
        const projectsData = JSON.parse(content)
        
        // Find the specific project by ID
        const project = projectsData.find(p => p.id === projectId)
        
        if (!project) {
            throw new Error(`Could not find project with id ${projectId}`)
        }
        
        // Return the history entries
        return project.history || []
        
    } catch (error) {
        if (error instanceof SyntaxError) {
            throw new Error(`Invalid JSON in projectsData.json: ${error.message}`)
        }
        throw error
    }
}

/**
 * Main process function - called from your API endpoint
 */
async function processAndCommit(data) {
    const { repository, sha: sourceSha, message: sourceMessage, committer } = data
    
    try {
        console.log(`\n=== Processing commits from ${repository} ===`)
        console.log(`Target repo: ${REPO_PO_OWNER}/${REPO_PO_NAME}`)
        console.log(`Target branch: ${TARGET_BRANCH}`)
        
        // 1. Determine which project this commit belongs to
        const projectId = PROJECT_REPO_MAP[repository]
        if (!projectId) {
            console.log(`Repository ${repository} not mapped to any project. Skipping.`)
            return
        }
        
        console.log(`Mapped to project ID: ${projectId}`)
        
        // 2. Fetch recent commits (last 7 days)
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        console.log(`Fetching commits since ${sevenDaysAgo}...`)
        const commits = await fetchCommitHistory(repository, sevenDaysAgo)
        
        if (commits.length === 0) {
            console.log('No new commits to process.')
            return
        }
        
        console.log(`Found ${commits.length} commits to process.`)
        
        // 3. Group commits by date
        const groupedCommits = groupCommitsByDate(commits)
        console.log(`Grouped into ${Object.keys(groupedCommits).length} dates:`, Object.keys(groupedCommits))
        
        // 4. Fetch current project data to get existing history
        console.log('Locating ProjectsData.tsx file...')
        const { path: filePath, data: projectsFileData } = await findProjectsDataFile()
        
        const projectsContent = Buffer.from(projectsFileData.content, 'base64').toString('utf8')
        
        // Parse existing history
        const existingHistory = parseProjectData(projectsContent, projectId)
        console.log(`Found ${existingHistory.length} existing history entries.`)
        
        // Extract project context
        const projectContext = {
            title: "Project",
            description: "Portfolio project",
            technologies: [],
            features: []
        }
        
        // 5. Generate new history entries using Gemini for each date
        const newHistoryEntries = []
        console.log("-> existing History: ", existingHistory)
        for (const [date, dateCommits] of Object.entries(groupedCommits)) {
            // Check if we already have an entry for this date
            if(existingHistory){
                const existingEntry = existingHistory.find(h => h.date === date)
                if (existingEntry) {
                    console.log(`History entry for ${date} already exists. Skipping.`)
                    continue
                }
            }
            
            newHistoryEntries.push({
                date,
                dateCommits,
                existingHistory,
                projectContext
            })
        }

        console.log(`Generating history entry commits...`)
        const newHistoryResult = await generateHistoryEntry(existingHistory, projectContext, newHistoryEntries)
        
        if (newHistoryResult.length === 0) {
            console.log('No new history entries to add.')
            return
        }
        
        console.log(`Generated ${newHistoryResult.length} new history entries.`)
        
        // 6. Update the ProjectsData.tsx file
        await updateProjectsDataFile(projectId, newHistoryResult, filePath)
        
        console.log(`✅ Successfully added ${newHistoryResult.length} new history entries.`)
        
    } catch (error) {
        console.error('❌ Error in processAndCommit:', error.message)
        console.error('Stack trace:', error.stack)
        throw error
    }
}

// --- API Endpoint ---
app.post('/api/process-commit', async (req, res) => {
    const token = req.header('X-Server-Token')
    const commitData = req.body
    
    console.log('\n=== Received request to /api/process-commit ===')
    console.log('Repository:', commitData?.repository)
    
    // 1. Security Check
    if (!token || token !== SERVER_SECRET) {
        console.error('Unauthorized request received.')
        return res.status(401).json({ error: 'Unauthorized: Invalid token.' })
    }

    if (!commitData || !commitData.repository) {
        return res.status(400).json({ error: 'Bad Request: Missing commit data.' })
    }

    try {
        await processAndCommit(commitData)
        
        console.log(`✅ Successfully processed commit from ${commitData.repository}`)
        return res.status(200).json({ status: 'Success', message: 'Project history updated successfully.' })

    } catch (error) {
        console.error('❌ Error during processing:', error.message)
        return res.status(500).json({ 
            status: 'Error', 
            message: 'Server failed to update project history.', 
            details: error.message 
        })
    }
})

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'Server is running' })
})

// Debug endpoint (remove in production)
app.get('/debug', (req, res) => {
    res.status(200).json({
        REPO_PO_OWNER: REPO_PO_OWNER || 'NOT SET',
        REPO_PO_NAME: REPO_PO_NAME || 'NOT SET',
        TARGET_BRANCH: TARGET_BRANCH || 'NOT SET',
        GITHUB_API_BASE: GITHUB_API_BASE,
        HAS_PAT: !!REPO_PO_API_PAT,
        PAT_LENGTH: REPO_PO_API_PAT?.length || 0,
        HAS_GEMINI_KEY: !!GEMINI_API_KEY
    })
})

// Test GitHub API connection
app.get('/test-github', async (req, res) => {
    try {
        console.log('Testing GitHub API connection...')
        console.log('URL:', `${GITHUB_API_BASE}/contents/app/ProjectsData.tsx`)
        console.log('Branch:', TARGET_BRANCH)
        console.log('Has PAT:', !!REPO_PO_API_PAT)
        
        const response = await axios.get(
            `${GITHUB_API_BASE}/contents/app/ProjectsData.tsx`,
            {
                params: { ref: TARGET_BRANCH },
                headers: {
                    'Authorization': `token ${REPO_PO_API_PAT}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        )
        
        res.status(200).json({
            success: true,
            message: 'Successfully connected to GitHub API',
            fileFound: true,
            fileName: response.data.name,
            filePath: response.data.path,
            fileSize: response.data.size
        })
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to connect to GitHub API',
            error: error.message,
            status: error.response?.status,
            statusText: error.response?.statusText,
            githubMessage: error.response?.data?.message,
            url: `${GITHUB_API_BASE}/contents/app/ProjectsData.tsx`,
            branch: TARGET_BRANCH
        })
    }
})

// --- Server Startup ---
app.listen(PORT, () => {
    console.log(`✅ Server is running on port ${PORT}`)
    console.log(`📍 API Endpoint: /api/process-commit`)
    console.log(`🔍 Health check: /health`)
    console.log(`Target: ${REPO_PO_OWNER}/${REPO_PO_NAME} (branch: ${TARGET_BRANCH})`)
})