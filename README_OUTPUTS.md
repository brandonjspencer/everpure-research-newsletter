# Everpure Notion HTML Parser

This folder contains the first working parser output for the uploaded `Everpure.html` export.

## Files

- `metadata.json` — page-level metadata, source links, linked Notion pages, and intro context
- `weeks.json` — normalized weekly records
- `decks.json` — deduplicated Google Slides deck references extracted from the page
- `summary.json` — high-level parse summary
- `manifest.json` — paths to the generated outputs

## Parser script

The parser script is located at:

- `/mnt/data/everpure_parser.py`

## Usage

```bash
python /mnt/data/everpure_parser.py /path/to/Everpure.html --output-dir /path/to/output
```

## Output model

Each weekly record includes:

- `record_id`
- `week_date`
- `section_family`
- `deck` (`url`, `file_id`)
- `images`
- `content_groups`
  - `findings`
  - `testing_concepts`
  - `in_process`
  - `initiatives_on_deck`
  - `weekly_progress`
  - `needs`
  - `next_steps`
  - `other`
- `linked_pages`
- `linked_files`
- `toggles`

Nested bullets are preserved using `children` plus a `level` field.

## Current limitations

- It parses the saved HTML export, not a live Notion page fetch.
- Collapsed Notion toggles are represented as collapsed placeholders; hidden child content is not available unless it exists in the saved HTML.
- `section_family` currently reflects the visible major section context found in this export; this file resolved entirely to `weekly_rundown` for the parsed dated entries.
