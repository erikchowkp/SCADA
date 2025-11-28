---
description: Restore file from Git history
---

# Git Restore Workflow

Use this workflow to restore files from Git history.

## Restore a specific file to last committed version:

1. **Check the file status**
```bash
git status
```

2. **Restore the file** (replace `path/to/file` with actual file path)
```bash
git checkout -- path/to/file
```

## Restore all files to last commit:

1. **Restore everything**
```bash
git checkout .
```

## View file history:

1. **See commit history**
```bash
git log --oneline -n 10
```

2. **See changes in a specific file**
```bash
git log --follow -- path/to/file
```

3. **Restore file from specific commit** (replace `COMMIT_HASH`)
```bash
git checkout COMMIT_HASH -- path/to/file
```

## Notes:
- This will overwrite local changes with the version from Git
- Make sure you really want to restore before running
