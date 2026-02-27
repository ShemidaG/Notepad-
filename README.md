# Notepad + Folders + Calendar + Tasks (MVP)

Local-first productivity web app inspired by Notion/Obsidian/Google Tasks-lite.

## Setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Architecture Overview

- `server.js`: tiny Node static server for local development.
- `index.html`: 3-column UI shell (left tree, center editor, right calendar/tasks).
- `app/main.js`: application logic (state, IndexedDB persistence, rendering, command palette, import/export).
- `app/styles.css`: layout and component styling.


## New Features

- Responsive compact calendar in the right sidebar with weekday labels and per-day task/event dot indicators.
- Collapsible folder tree with per-workspace persisted collapse/expand state (drag and drop still supported).
- Workspace profile/theme settings: avatar emoji/image, app font selection, custom background image, dim slider, blur toggle/strength.
- Notion-style banner controls per note: adjustable banner height and vertical position slider.
- Live clock widget with timezone presets and 12/24-hour toggle, persisted per workspace.
- Structured recurrence UI for tasks: none, daily, weekly (custom weekdays + quick weekdays/weekends), monthly date selection.
- Linked note field for tasks/events, with clickable note chips in Today panel.
- Editor toolbar upgrades: font family selector, text color, and highlight color while preserving existing formatting actions.

## Features Included

- Workspaces: create/rename/delete/switch.
- Folder + note tree with nesting.
- CRUD for folders/notes.
- Drag-and-drop move/reorder notes/folders via native HTML5 DnD.
- Rich-text editor (contenteditable + formatting toolbar).
- Inline checkbox items with completion strike-through.
- Image paste/upload into note with resizable wrappers.
- Banner image upload/change/remove for each note.
- Monthly calendar UI + date selection + Go to Today.
- Tasks with recurrence (daily/weekly/monthly).
- Events with start/end datetime.
- Today panel for selected date.
- Task completion persistence.
- Import/Export all app data as a single JSON file.
- Import mode chooser (Merge/Replace).
- Command palette (`Ctrl/Cmd+K`) with quick actions and note search/open.
- Search notes by title + content.

## Data Storage

Data is stored in browser IndexedDB database `notepad_mvp_db` with object stores:

- `workspaces`
- `folders`
- `notes`
- `tasks`
- `events`
- `images` (Blob storage)
- `meta` (active workspace)

Images are stored as `Blob`s in IndexedDB and referenced by IDs from notes.

## Known Limitations

- Uses native `execCommand` + `contenteditable` for rich text (lightweight MVP, not TipTap).
- Native HTML5 drag-and-drop instead of dnd-kit.
- Not built with Next.js/Tailwind due dependency install restrictions in this execution environment.
- No cloud sync, auth, or multi-device conflict resolution.
