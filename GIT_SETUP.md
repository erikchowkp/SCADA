# Git and GitHub Setup Guide for SCADA Project

Git has been successfully installed on your system. Follow these steps to complete the setup:

## Step 1: Restart Your Terminal

**Close and reopen your PowerShell/terminal or restart VS Code** so that Git is recognized in your PATH.

## Step 2: Configure Git with Your GitHub Account

Open PowerShell in the SCADA directory and run:

```powershell
git config --global user.email "chowkinpong@gmail.com"
git config --global user.name "Erik Chow"
```

## Step 3: Initialize the Git Repository

```powershell
cd C:\Users\erik.chow\Desktop\SCADA
git init
```

## Step 4: Make Your First Commit

```powershell
git add .
git commit -m "Initial commit: SCADA system with mimic builder"
```

## Step 5: Create a GitHub Repository

1. Go to [GitHub](https://github.com) and log in with your Google account (chowkinpong@gmail.com)
2. Click the "+" icon in the top right and select "New repository"
3. Name it something like `scada-system` or `industrial-scada`
4. **Important:** Do NOT initialize with README, .gitignore, or license (we already have these locally)
5. Click "Create repository"

## Step 6: Connect Your Local Repository to GitHub

After creating the repository on GitHub, you'll see instructions. Run these commands:

```powershell
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git branch -M main
git push -u origin main
```

Replace `YOUR_USERNAME` and `YOUR_REPO_NAME` with the actual values from your GitHub repository.

## Step 7: Authentication

The first time you push, Git will ask for authentication. Since you use Google login for GitHub:

1. Use **Personal Access Token** instead of password
2. Go to GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
3. Generate a new token with `repo` permissions
4. Use the token as your password when prompted

## What's Been Done

✅ Git installed via winget  
✅ `.gitignore` created to exclude:
   - `node_modules/`
   - `events.json` (can get very large)
   - `server.lock`
   - Log files
   - IDE and OS files

## Benefits

Once set up, you'll be able to:
- **Track all changes** to your code with full history
- **Recover any previous version** of any file
- **Collaborate** with others (if needed)
- **Backup** your code to GitHub
- **Work on multiple features** using branches

## Need Help?

After restarting your terminal, let me know and I can help you run these commands step by step!
