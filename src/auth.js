#!/usr/bin/env node
import { google } from 'googleapis'
import { createServer } from 'http'
import { exec } from 'child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import chalk from 'chalk'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const CREDENTIALS_PATH = join(ROOT, 'credentials.json')
const AUTH_DIR = join(ROOT, 'auth')
const SCOPES = ['https://www.googleapis.com/auth/youtube']
const REDIRECT_PORT = 3000
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`

function loadCredentials() {
  if (!existsSync(CREDENTIALS_PATH)) {
    console.error(chalk.red('credentials.json not found.'))
    console.error(chalk.yellow('Download it from Google Cloud Console → APIs & Services → Credentials → your OAuth 2.0 Client ID → Download JSON'))
    process.exit(1)
  }
  const raw = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8'))
  const creds = raw.installed ?? raw.web
  if (!creds) {
    console.error(chalk.red('Invalid credentials.json format. Expected "installed" or "web" key.'))
    process.exit(1)
  }
  return creds
}

function createOAuthClient(creds) {
  return new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    REDIRECT_URI
  )
}

function openBrowser(url) {
  const platform = process.platform
  const cmd =
    platform === 'win32' ? `start "" "${url}"` :
    platform === 'darwin' ? `open "${url}"` :
    `xdg-open "${url}"`
  exec(cmd, (err) => {
    if (err) {
      console.log(chalk.yellow('Could not open browser automatically. Please open this URL manually:'))
      console.log(chalk.cyan(url))
    }
  })
}

function waitForCode() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`)
      if (url.pathname !== '/oauth2callback') {
        res.writeHead(404)
        res.end()
        return
      }
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body><h2>Authorization denied. You can close this tab.</h2></body></html>')
        server.close()
        reject(new Error(`Authorization denied: ${error}`))
        return
      }

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body><h2>Authorization successful! You can close this tab.</h2></body></html>')
      server.close()
      resolve(code)
    })

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${REDIRECT_PORT} is already in use. Please free it and try again.`))
      } else {
        reject(err)
      }
    })

    server.listen(REDIRECT_PORT)
  })
}

export async function login(account) {
  if (account !== 'source' && account !== 'dest') {
    console.error(chalk.red(`Invalid account "${account}". Use "source" or "dest".`))
    process.exit(1)
  }

  const creds = loadCredentials()
  const oauth2Client = createOAuthClient(creds)

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  })

  console.log(chalk.cyan(`\nLogging in ${chalk.bold(account)} account...`))
  console.log(chalk.gray('Opening browser for authorization...'))
  openBrowser(authUrl)

  let code
  try {
    code = await waitForCode()
  } catch (err) {
    console.error(chalk.red(`Login failed: ${err.message}`))
    process.exit(1)
  }

  let tokens
  try {
    const { tokens: t } = await oauth2Client.getToken(code)
    tokens = t
  } catch (err) {
    console.error(chalk.red(`Failed to exchange authorization code: ${err.message}`))
    process.exit(1)
  }

  mkdirSync(AUTH_DIR, { recursive: true })
  const tokenPath = join(AUTH_DIR, `${account}.json`)
  writeFileSync(tokenPath, JSON.stringify(tokens, null, 2))

  console.log(chalk.green(`\n✓ Logged in successfully! Tokens saved to auth/${account}.json`))
}

export async function getAuthClient(account) {
  const tokenPath = join(AUTH_DIR, `${account}.json`)
  if (!existsSync(tokenPath)) {
    console.error(chalk.red(`No credentials found for "${account}" account.`))
    console.error(chalk.yellow(`Run: yttransfer login ${account}`))
    process.exit(1)
  }

  const creds = loadCredentials()
  const oauth2Client = createOAuthClient(creds)
  const tokens = JSON.parse(readFileSync(tokenPath, 'utf8'))
  oauth2Client.setCredentials(tokens)

  oauth2Client.on('tokens', (newTokens) => {
    const existing = JSON.parse(readFileSync(tokenPath, 'utf8'))
    writeFileSync(tokenPath, JSON.stringify({ ...existing, ...newTokens }, null, 2))
  })

  // Proactively refresh if the access token is expired or about to expire (within 60s)
  if (tokens.expiry_date && tokens.expiry_date < Date.now() + 60_000) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken()
      writeFileSync(tokenPath, JSON.stringify(credentials, null, 2))
      oauth2Client.setCredentials(credentials)
    } catch (err) {
      console.error(chalk.red(`Failed to refresh token for "${account}" account: ${err.message}`))
      console.error(chalk.yellow(`Re-authenticate with: yttransfer login ${account}`))
      process.exit(1)
    }
  }

  return oauth2Client
}
