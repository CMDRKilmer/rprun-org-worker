// src/db/repositories/notes.repo.ts
import type { D1Database } from '@cloudflare/workers-types';
import { mapNote, type NoteRow } from '../mappers';
import type { TaskNote } from '../../types';
import { generateId } from '../../utils/id';

export async function listNotesByTask(db: D1Database, taskId: string): Promise<TaskNote[]> {
  const result = await db
    .prepare('SELECT * FROM task_notes WHERE task_id = ? ORDER BY created_at ASC')
    .bind(taskId)
    .all<NoteRow>();
  return (result.results ?? []).map(mapNote);
}

export async function createNote(
  db: D1Database,
  taskId: string,
  authorId: string,
  authorUsername: string,
  content: string,
): Promise<TaskNote> {
  const id = generateId();
  await db
    .prepare(
      'INSERT INTO task_notes (id, task_id, author_id, author_username, content) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(id, taskId, authorId, authorUsername, content)
    .run();
  const row = await db
    .prepare('SELECT * FROM task_notes WHERE id = ?')
    .bind(id)
    .first<NoteRow>();
  if (!row) throw new Error('Note creation failed');
  return mapNote(row);
}
