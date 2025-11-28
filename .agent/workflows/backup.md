---
description: Backup changes to GitHub
---

# Git Backup Workflow

Use this workflow to backup your SCADA code changes to GitHub.

## Steps:

// turbo-all

1. **Check status**
```bash
git status
```

2. **Add all changes**
```bash
git add .
```

3. **Commit changes**
```bash
git commit -m "Backup: Auto-save SCADA changes"
```

4. **Push to GitHub**
```bash
git push
```

## Notes:
- All your changes will be backed up to https://github.com/erikchowkp/SCADA
- The database (`db/historian.sqlite`) and large logs are excluded automatically
- You can view your code history on GitHub
