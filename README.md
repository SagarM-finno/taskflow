# Taskflow

**Team task assignment & reminders with Google Sheets + Zoho Cliq**

A lightweight team task manager that uses Google Sheets as the backend database and Zoho Cliq for automatic reminders. No server required — runs entirely in the browser via GitHub Pages.

## Live App

Once deployed, your team accesses the app at:
```
https://YOUR_USERNAME.github.io/taskflow/
```

## How It Works

| Component | Role |
|-----------|------|
| **GitHub Pages** | Hosts the web app (this repo) |
| **Google Sheets** | Shared task database — stores all tasks, team members, settings |
| **Google OAuth** | Authenticates users so they can read/write the sheet |
| **Google Apps Script** | Runs every 5 min to check reminders and post to Zoho Cliq |

## Setup Guide (20 minutes, one-time)

### Part 1: Create the Google Sheet

1. Download `taskflow_template.xlsx` from this repo
2. Upload it to **Google Drive** → open it → **File** → **Save as Google Sheets**
3. Go to the **Team** tab and replace sample names with your actual team members
4. Go to the **Settings** tab and paste your Zoho Cliq webhook URL in cell B2
5. **Share** the sheet with your team (Editor access)

### Part 2: Set Up Zoho Cliq Reminders (Apps Script)

1. In the Google Sheet → **Extensions** → **Apps Script**
2. Delete existing code → paste the contents of `taskflow_apps_script.js`
3. Click **Save** → select **setup** from the dropdown → click **▶️ Run**
4. Approve permissions when prompted
5. Select **sendTestMessage** → click **▶️ Run** to verify

### Part 3: Deploy the Web App (GitHub Pages)

1. **Fork this repo** (or create a new repo and upload `index.html`)
2. Go to repo **Settings** → **Pages**
3. Source: **Deploy from a branch** → Branch: **main** → Folder: **/ (root)**
4. Click **Save**
5. Wait 1-2 minutes → your app is live at `https://YOUR_USERNAME.github.io/taskflow/`

### Part 4: Create Google OAuth Credentials

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project (or use existing) → Enable **Google Sheets API**
3. Go to **APIs & Services** → **OAuth consent screen**
   - User type: **Internal** (Google Workspace) or **External** (personal Gmail)
   - App name: `Taskflow` → fill in email fields → **Save and Continue**
   - Scopes: skip → **Save and Continue**
   - Test users (External only): add your team's emails → **Save and Continue**
4. Go to **Credentials** → **+ CREATE CREDENTIALS** → **OAuth client ID**
   - Type: **Web application**
   - Authorized JavaScript origins: `https://YOUR_USERNAME.github.io`
   - Click **Create** → copy the **Client ID**

### Part 5: Connect Everything

1. Open `https://YOUR_USERNAME.github.io/taskflow/`
2. Enter your **Google Sheet ID** (from the sheet URL between `/d/` and `/edit`)
3. Enter your **OAuth Client ID**
4. Click **Continue to Sign In** → **Sign in with Google**
5. Done! 🎉

## Sharing with Your Team

Send your team:
1. The app URL: `https://YOUR_USERNAME.github.io/taskflow/`
2. The Sheet ID and OAuth Client ID (they enter these once on first visit)

Each person signs in with their own Google account. Everyone sees the same tasks in real-time.

## Files

| File | Purpose |
|------|---------|
| `index.html` | The web app (deployed via GitHub Pages) |
| `taskflow_template.xlsx` | Google Sheet template — upload to Drive |
| `taskflow_apps_script.js` | Paste into Google Sheet's Apps Script for Cliq reminders |

## Features

- Create, view, and manage tasks from a beautiful dark-themed UI
- Assign tasks to team members with priority levels (High/Med/Low)
- Set due dates and reminder times
- Click status circles to cycle: To Do → In Progress → Done
- Filter by team member or status
- Auto-refreshes every 30 seconds
- Automatic Zoho Cliq notifications when reminders are due
- Works on desktop and mobile browsers
