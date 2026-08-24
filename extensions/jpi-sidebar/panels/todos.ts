import { truncate } from "../format.ts";
import type { SidebarSnapshot, TodoItem, TodoStatus } from "../state.ts";
import type { ThemeLike } from "../theme.ts";

const GLYPHS: Record<TodoStatus, string> = {
  completed: "✓",
  in_progress: "●",
  pending: "○",
};

const GLYPH_COLORS: Record<TodoStatus, string> = {
  completed: "success",
  in_progress: "accent",
  pending: "muted",
};

function renderTodoLine(todo: TodoItem, width: number, theme: ThemeLike): string {
  const glyph = theme.fg(GLYPH_COLORS[todo.status], GLYPHS[todo.status]);
  const contentMax = Math.max(0, width - 2);
  return `${glyph} ${truncate(todo.content, contentMax)}`;
}

export function renderTodosPanel(state: SidebarSnapshot, width: number, theme: ThemeLike): string[] {
  if (state.todos.length === 0) return [theme.fg("dim", "  (no todos)")];
  return state.todos.map((todo) => renderTodoLine(todo, width, theme));
}
